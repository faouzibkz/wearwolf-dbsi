import type { Server, Socket } from "socket.io";
import {
  SOCKET_EVENTS,
  DEFAULT_GAME_CONFIG,
  type AdminAuthPayload,
  type AdminCreateGamePayload,
  type AdminResolveTiePayload,
  type AdminSetSoundEffectsPayload,
  type AdminUpdateConfigPayload,
  type BarbieRevealResultPayload,
  type BarbieRevealSubmitPayload,
  type ChasseurShootPayload,
  type ChefSecondDebateChoosePayload,
  type ChefSuccessionChoosePayload,
  type ChefVoteCastPayload,
  type ChefVolunteerPayload,
  type DayVoteCastPayload,
  type LoupVertGuessSubmitPayload,
  type LoupVertStolenPowerSubmitPayload,
  type MvpResultPayload,
  type MvpStatePayload,
  type MvpVoteCastPayload,
  type NightActionSubmitPayload,
  type PlayerJoinPayload,
  type PlayerReconnectPayload,
  type WolfChatSendPayload,
} from "@loupgarou/shared";
import { gameRegistry } from "../gameRegistry.js";
import { listPresets, savePreset, finalizeGameHistory } from "../db/persistence.js";
import { applyRatingUpdates } from "../rating/applyRating.js";
import { applyBaseProgression, applyMvpBonus } from "../progression/applyProgression.js";
import { mvpVotingRegistry } from "../mvp/mvpVotingRegistry.js";
import { readSessionFromCookieHeader } from "../auth/cookies.js";
import { broadcastGameState, notifyGame, notifyPlayer, pushRoleAssignments, roomForGame, roomForPlayer } from "./broadcast.js";
import { relayWolfChatMessage } from "./wolfRoom.js";
import { forceNextPhase } from "./forceNextPhase.js";
import { safeAck, type Ack, type SocketData } from "./types.js";
import { schedulePhaseTimer, clearPhaseTimer } from "./timers.js";
import { pushAllPrompts } from "./sync.js";

/**
 * Called after every state-mutating action, no matter which one. Centralizing
 * the GAME_ENDED emission here (via the one-shot consumeGameEndedNotification)
 * means it fires exactly once no matter WHAT caused the game to end — a
 * manual admin/Chef skip, a timer auto-advancing a phase, or a player's own
 * vote completing the day-vote queue — instead of needing every individual
 * call site that could possibly end the game to remember to check.
 */
function sync(io: Server, engine: import("@loupgarou/game-engine").GameEngine): void {
  pushAllPrompts(io, engine);
  schedulePhaseTimer(io, engine);
  if (engine.consumeGameEndedNotification()) {
    io.to(roomForGame(engine.getCode())).emit(SOCKET_EVENTS.GAME_ENDED, {
      stats: engine.getEndGameStats(),
    });

    // Opens the post-game MVP vote (section 12) right away, independent of
    // everything below — every player who was in the game is eligible to
    // vote (and be voted for). No fixed deadline: it finalizes naturally
    // once everyone's voted (see MVP_VOTE_CAST below), or an admin can
    // force it via ADMIN_FORCE_MVP_FINALIZE. See mvp/mvpVotingRegistry.ts.
    const playerIds = engine.getPlayers().map((p) => p.id);
    mvpVotingRegistry.open(engine.getCode(), playerIds);
    const initialMvpState = buildMvpStatePayload(engine.getCode());
    if (initialMvpState) {
      io.to(roomForGame(engine.getCode())).emit(SOCKET_EVENTS.MVP_STATE, initialMvpState);
    }

    // Turns this finished game into durable per-account history/stats (see
    // db/persistence.ts's finalizeGameHistory doc comment). Fire-and-forget:
    // best-effort like every other DB write here, must never block or
    // delay the GAME_ENDED experience for the people at the table.
    //
    // applyRatingUpdates and applyBaseProgression both run AFTER
    // finalizeGameHistory resolves, not in parallel with it — they update
    // columns on the exact PlayerRecord rows finalizeGameHistory just
    // upserted, so those rows have to exist first. They run in parallel
    // with EACH OTHER, though: neither touches a column the other writes.
    // gameRegistry's userId map is only cleared once all three are done.
    const getUserId = (playerId: string) => gameRegistry.getPlayerUserId(playerId);
    void finalizeGameHistory(engine, getUserId)
      .then(() => Promise.all([applyRatingUpdates(engine, getUserId), applyBaseProgression(engine, getUserId)]))
      .then(() => gameRegistry.clearPlayerUserIds(playerIds));
  }
}

/** Null if MVP voting was never opened for this game (shouldn't happen once GAME_ENDED has fired, but never worth throwing over). */
function buildMvpStatePayload(gameCode: string): MvpStatePayload | null {
  const state = mvpVotingRegistry.getState(gameCode);
  if (!state) return null;
  return {
    votesCast: state.votes.size,
    totalEligible: state.eligiblePlayerIds.size,
    votedPlayerIds: [...state.votes.keys()],
    finalized: state.finalized,
  };
}

/**
 * Shared by both the natural "everyone's voted" path and
 * ADMIN_FORCE_MVP_FINALIZE. Idempotent (mvpVotingRegistry.finalize() is),
 * so a stray double-call (e.g. the last vote lands right as an admin also
 * clicks force-finalize) can't produce two different results.
 */
function finalizeMvpVoting(io: Server, engine: import("@loupgarou/game-engine").GameEngine): void {
  const code = engine.getCode();
  const result = mvpVotingRegistry.finalize(code);
  const winners = result.winners.map((playerId) => {
    const player = engine.getPlayers().find((p) => p.id === playerId);
    return { playerId, nickname: player?.nickname ?? "?" };
  });
  const payload: MvpResultPayload = { winners };
  io.to(roomForGame(code)).emit(SOCKET_EVENTS.MVP_RESULT, payload);
  // Best-effort, same contract as every other post-game DB write — awards
  // the MVP bonus XP/mvpCount, then frees this game's in-memory vote state.
  void applyMvpBonus(code, result.winners).then(() => mvpVotingRegistry.clear(code));
}

/** Shared by ADMIN_FORCE_NEXT_PHASE and CHEF_FORCE_NEXT_PHASE — same effect, different permission check. */
function runForceNextPhase(io: Server, engine: import("@loupgarou/game-engine").GameEngine): void {
  forceNextPhase(engine);
  sync(io, engine); // also handles the GAME_ENDED emission if this just finished the game
}

export function registerSocketHandlers(io: Server): void {
  io.on("connection", (socket: Socket<any, any, any, SocketData>) => {
    socket.data.isAdmin = false;

    // Game-independent clock sync: lets the client measure (and correct
    // for) drift between its own clock and this server's, so every
    // countdown it renders can be anchored to the SERVER's notion of "now"
    // instead of a possibly-skewed browser Date.now() — see
    // apps/web/src/lib/serverClock.ts for the client-side round-trip math
    // that consumes this. No game/auth context needed at all, so it's
    // registered here rather than further down with the game handlers.
    socket.on(SOCKET_EVENTS.TIME_SYNC, (_payload: unknown, ack: Ack) => {
      safeAck(() => ({ serverNow: Date.now() }), ack);
    });

    // No shared password anymore. Omitting gameCode always succeeds and
    // creates a brand new game — anyone can do this, no gate at all.
    // Supplying gameCode means "let me resume as THIS game's host," which
    // only succeeds if hostToken matches the one issued when it was
    // created (see gameRegistry.create) — that's what actually protects
    // an in-progress game's admin view now that there's no typed secret.
    socket.on(SOCKET_EVENTS.ADMIN_AUTH, (payload: AdminAuthPayload, ack: Ack) => {
      safeAck(() => {
        let engine: import("@loupgarou/game-engine").GameEngine;
        let hostToken: string;

        if (payload.gameCode) {
          engine = gameRegistry.requireGame(payload.gameCode);
          if (!gameRegistry.isValidHostToken(engine.getCode(), payload.hostToken)) {
            throw new Error("Jeton hôte invalide pour cette partie.");
          }
          hostToken = payload.hostToken!;
        } else {
          const created = gameRegistry.create(DEFAULT_GAME_CONFIG);
          engine = created.engine;
          hostToken = created.hostToken;
        }

        socket.data.isAdmin = true;
        socket.data.gameCode = engine.getCode();
        socket.join(roomForGame(engine.getCode()));
        gameRegistry.setAdminSocket(engine.getCode(), socket.id);
        sync(io, engine);
        return { code: engine.getCode(), hostToken };
      }, ack);
    });

    // For an already-authenticated host to spin up an additional game from
    // the same browser session (e.g. running two tables at once) without
    // losing their first game's admin connection.
    socket.on(SOCKET_EVENTS.ADMIN_CREATE_GAME, (payload: AdminCreateGamePayload, ack: Ack) => {
      safeAck(() => {
        requireAdmin(socket);
        const { engine, hostToken } = gameRegistry.create(payload.config);
        socket.data.gameCode = engine.getCode();
        socket.join(roomForGame(engine.getCode()));
        gameRegistry.setAdminSocket(engine.getCode(), socket.id);
        sync(io, engine);
        return { code: engine.getCode(), hostToken };
      }, ack);
    });

    socket.on(SOCKET_EVENTS.PLAYER_JOIN, (payload: PlayerJoinPayload, ack: Ack) => {
      safeAck(() => {
        // Every player must be logged into a permanent account (spec
        // section 1) — the account is the identity stats/history/rating
        // attach to; `payload.nickname` is only ever this game's disposable
        // pseudo (section 2). The account's own session cookie rides along
        // on the socket handshake automatically (see lib/socket.ts's
        // withCredentials on the client, cors credentials:true on the
        // server) — nothing about it is ever sent as part of the payload.
        const session = readSessionFromCookieHeader(socket.handshake.headers.cookie);
        if (!session) {
          throw new Error("Vous devez être connecté pour rejoindre une partie.");
        }
        const engine = gameRegistry.requireGame(payload.gameCode);
        const player = engine.addPlayer(payload.nickname);
        gameRegistry.setPlayerUserId(player.id, session.userId);
        socket.data.gameCode = engine.getCode();
        socket.data.playerId = player.id;
        socket.join(roomForGame(engine.getCode()));
        socket.join(roomForPlayer(player.id));
        sync(io, engine);
        return { playerId: player.id, reconnectToken: player.reconnectToken };
      }, ack);
    });

    socket.on(SOCKET_EVENTS.PLAYER_RECONNECT, (payload: PlayerReconnectPayload, ack: Ack) => {
      safeAck(() => {
        const engine = gameRegistry.requireGame(payload.gameCode);
        const player = engine.getPlayers().find((p) => p.id === payload.playerId);
        if (!player || player.reconnectToken !== payload.reconnectToken) {
          throw new Error("Reconnexion invalide.");
        }
        // Re-affirm the account link on every reconnect (new tab, page
        // refresh, or a server restart that wiped gameRegistry's in-memory
        // map) — same session-cookie source as PLAYER_JOIN. Best-effort: an
        // expired/missing cookie here just means this reconnect won't be
        // attributable to an account in the eventual history write; it
        // must never block someone from getting back into a game they were
        // already in.
        const session = readSessionFromCookieHeader(socket.handshake.headers.cookie);
        if (session) gameRegistry.setPlayerUserId(player.id, session.userId);
        engine.setConnected(player.id, true);
        socket.data.gameCode = engine.getCode();
        socket.data.playerId = player.id;
        socket.join(roomForGame(engine.getCode()));
        socket.join(roomForPlayer(player.id));
        const wolfTeammates = engine.getWolfTeammates(player.id);
        io.to(roomForPlayer(player.id)).emit(SOCKET_EVENTS.ROLE_ASSIGNED, {
          playerId: player.id,
          roleId: player.roleId,
          wolfTeammates,
        });
        sync(io, engine);
        return { roleId: player.roleId, wolfTeammates };
      }, ack);
    });

    socket.on("disconnect", () => {
      const { gameCode, playerId } = socket.data;
      if (!gameCode) return;
      const engine = gameRegistry.get(gameCode);
      if (!engine) return;
      if (playerId) {
        engine.setConnected(playerId, false);
        sync(io, engine);
      }
    });

    // -----------------------------------------------------------------
    // Admin game-lifecycle actions
    // -----------------------------------------------------------------

    socket.on(SOCKET_EVENTS.ADMIN_UPDATE_CONFIG, (payload: AdminUpdateConfigPayload, ack: Ack) => {
      safeAck(() => {
        const engine = requireAdminGame(socket);
        engine.updateConfig(payload.config);
        sync(io, engine);
      }, ack);
    });

    // Deliberately separate from ADMIN_UPDATE_CONFIG: sound is cosmetic and
    // togglable anytime, including mid-game, unlike role counts/timers/etc.
    socket.on(SOCKET_EVENTS.ADMIN_SET_SOUND_EFFECTS, (payload: AdminSetSoundEffectsPayload, ack: Ack) => {
      safeAck(() => {
        const engine = requireAdminGame(socket);
        engine.setSoundEffectsEnabled(payload.enabled);
        sync(io, engine);
      }, ack);
    });

    socket.on(SOCKET_EVENTS.ADMIN_START_GAME, (_payload: unknown, ack: Ack) => {
      safeAck(() => {
        const engine = requireAdminGame(socket);
        const result = engine.startGame();
        pushRoleAssignments(io, engine);
        sync(io, engine);
        return result;
      }, ack);
    });

    socket.on(SOCKET_EVENTS.ADMIN_PAUSE, (_payload: unknown, ack: Ack) => {
      safeAck(() => {
        const engine = requireAdminGame(socket);
        engine.pause();
        clearPhaseTimer(engine.getCode());
        broadcastGameState(io, engine);
      }, ack);
    });

    socket.on(SOCKET_EVENTS.ADMIN_RESUME, (_payload: unknown, ack: Ack) => {
      safeAck(() => {
        const engine = requireAdminGame(socket);
        engine.resume();
        sync(io, engine);
      }, ack);
    });

    socket.on(SOCKET_EVENTS.ADMIN_FORCE_NEXT_PHASE, (_payload: unknown, ack: Ack) => {
      safeAck(() => {
        const engine = requireAdminGame(socket);
        runForceNextPhase(io, engine);
      }, ack);
    });

    // Same underlying mechanism as ADMIN_FORCE_NEXT_PHASE, but self-serve
    // for whoever is currently the elected (and still alive) Chef du
    // village — checked live against chefId at click time, so the power
    // correctly transfers to a successor after a Chef-succession and is
    // revoked the instant the Chef dies, with no separate bookkeeping.
    socket.on(SOCKET_EVENTS.CHEF_FORCE_NEXT_PHASE, (_payload: unknown, ack: Ack) => {
      safeAck(() => {
        const engine = requireChefGame(socket);
        runForceNextPhase(io, engine);
        // Skip the toast if this skip just ended the game outright — the
        // victory screen is the more prominent (and sufficient) signal.
        if (engine.getPhase() !== "ENDED") {
          notifyGame(io, engine.getCode(), "INFO", "👑 Le Chef du village a fait avancer la partie.");
        }
      }, ack);
    });

    socket.on(SOCKET_EVENTS.ADMIN_UNDO_PHASE, (_payload: unknown, ack: Ack) => {
      safeAck(() => {
        const engine = requireAdminGame(socket);
        const undone = engine.undoPhase();
        if (!undone) throw new Error("Rien à annuler.");
        sync(io, engine);
      }, ack);
    });

    socket.on(SOCKET_EVENTS.ADMIN_END_GAME, (_payload: unknown, ack: Ack) => {
      safeAck(() => {
        const engine = requireAdminGame(socket);
        engine.endGame();
        sync(io, engine); // also handles the GAME_ENDED emission
      }, ack);
    });

    socket.on(SOCKET_EVENTS.ADMIN_REVEAL_ROLES, (_payload: unknown, ack: Ack) => {
      safeAck(() => {
        const engine = requireAdminGame(socket);
        engine.revealRolesEarly();
        broadcastGameState(io, engine);
      }, ack);
    });

    socket.on(SOCKET_EVENTS.ADMIN_FORCE_START_CHEF_ELECTION, (_payload: unknown, ack: Ack) => {
      safeAck(() => {
        const engine = requireAdminGame(socket);
        engine.forceStartChefDebate();
        sync(io, engine);
      }, ack);
    });

    socket.on(SOCKET_EVENTS.ADMIN_RESOLVE_TIE, (payload: AdminResolveTiePayload, ack: Ack) => {
      safeAck(() => {
        const engine = requireAdminGame(socket);
        const outcome = engine.resolveTieManually(payload.targetId);
        sync(io, engine);
        return outcome;
      }, ack);
    });

    socket.on(SOCKET_EVENTS.ADMIN_SAVE_PRESET, (payload: { name: string; config: unknown }, ack: Ack) => {
      safeAck(async () => {
        requireAdmin(socket);
        await savePreset(payload.name, payload.config as object);
      }, ack);
    });

    socket.on(SOCKET_EVENTS.ADMIN_LIST_PRESETS, (_payload: unknown, ack: Ack) => {
      safeAck(async () => {
        requireAdmin(socket);
        return listPresets();
      }, ack);
    });

    // -----------------------------------------------------------------
    // Chef du village election
    // -----------------------------------------------------------------

    socket.on(SOCKET_EVENTS.CHEF_VOLUNTEER, (payload: ChefVolunteerPayload, ack: Ack) => {
      safeAck(() => {
        const engine = requireGameFor(socket);
        engine.volunteerForChef(payload.playerId ?? socket.data.playerId!);
        sync(io, engine);
      }, ack);
    });

    socket.on(SOCKET_EVENTS.CHEF_DEBATE_NEXT_SPEAKER, (_payload: unknown, ack: Ack) => {
      safeAck(() => {
        const engine = requireAdminGame(socket);
        engine.advanceChefSpeaker();
        sync(io, engine);
      }, ack);
    });

    // Self-serve "passe la parole" for the chef debate — same pattern as
    // DAY_DISCUSSION_PASS_TURN / TIE_DEFENSE_PASS_TURN below.
    socket.on(SOCKET_EVENTS.CHEF_DEBATE_PASS_TURN, (_payload: unknown, ack: Ack) => {
      safeAck(() => {
        const engine = requireGameFor(socket);
        const currentSpeakerId = engine.getCurrentChefDebateSpeakerId();
        if (!socket.data.isAdmin && socket.data.playerId !== currentSpeakerId) {
          throw new Error("Ce n'est pas votre tour de parler.");
        }
        engine.advanceChefSpeaker();
        sync(io, engine);
      }, ack);
    });

    // -----------------------------------------------------------------
    // Day discussion — self-serve "passe la parole"
    // -----------------------------------------------------------------

    socket.on(SOCKET_EVENTS.DAY_DISCUSSION_PASS_TURN, (_payload: unknown, ack: Ack) => {
      safeAck(() => {
        const engine = requireGameFor(socket);
        const currentSpeakerId = engine.getCurrentDaySpeakerId();
        if (!socket.data.isAdmin && socket.data.playerId !== currentSpeakerId) {
          throw new Error("Ce n'est pas votre tour de parler.");
        }
        engine.advanceDaySpeaker();
        sync(io, engine);
      }, ack);
    });

    // -----------------------------------------------------------------
    // Barbie — one-shot mid-day-discussion reveal
    // -----------------------------------------------------------------

    socket.on(SOCKET_EVENTS.BARBIE_REVEAL_SUBMIT, (payload: BarbieRevealSubmitPayload, ack: Ack) => {
      safeAck(() => {
        const engine = requireGameFor(socket);
        const barbieId = payload.playerId ?? socket.data.playerId!;
        const barbieNickname = engine.getPlayers().find((p) => p.id === barbieId)?.nickname ?? "?";
        const outcome = engine.useBarbiePower(barbieId, payload.targetId);

        // Deliberately public and broadcast to the WHOLE room (not
        // notifyPlayer): this is the one reveal in the game that's meant to
        // be seen by everyone, in sync, so every client can play the same
        // card-flip animation at the same moment before discussion resumes.
        const resultPayload: BarbieRevealResultPayload = {
          barbieId,
          barbieNickname,
          targetId: outcome.targetId,
          targetNickname: outcome.targetNickname,
          targetRoleId: outcome.targetRoleId,
          outcome: outcome.outcome,
          newChefId: outcome.newChefId,
        };
        io.to(roomForGame(engine.getCode())).emit(SOCKET_EVENTS.BARBIE_REVEAL_RESULT, resultPayload);

        sync(io, engine);
      }, ack);
    });

    // -----------------------------------------------------------------
    // Alien — force an early nightfall from the middle of a day discussion
    // -----------------------------------------------------------------
    //
    // Deliberately silent: no BARBIE-style broadcast, no notifyGame/
    // notifyPlayer of any kind. Everyone just sees the day discussion end
    // and a normal night begin, exactly like any other end-of-day
    // transition (endDay1Discussion/endDayDiscussion) — see
    // GameEngine.triggerAlienNightfall's doc comment for why this must
    // never be attributed to anyone, on-screen or in any log a player can
    // see.
    socket.on(SOCKET_EVENTS.ALIEN_FORCE_NIGHTFALL, (_payload: unknown, ack: Ack) => {
      safeAck(() => {
        const engine = requireGameFor(socket);
        const alienId = socket.data.playerId!;
        engine.triggerAlienNightfall(alienId);
        sync(io, engine);
      }, ack);
    });

    // -----------------------------------------------------------------
    // Chef's second debate (CHEF_SECOND_DEBATE) — optional bonus turns
    // -----------------------------------------------------------------

    socket.on(SOCKET_EVENTS.CHEF_SECOND_DEBATE_CHOOSE, (payload: ChefSecondDebateChoosePayload, ack: Ack) => {
      safeAck(() => {
        const engine = requireGameFor(socket);
        const state = engine.getPublicState();
        if (!socket.data.isAdmin && socket.data.playerId !== state.chefId) {
          throw new Error("Seul le Chef du village peut accorder un second débat.");
        }
        engine.chooseSecondDebateSpeakers(payload.playerIds);
        sync(io, engine);
      }, ack);
    });

    // Self-serve "passe la parole" for a bonus speaker's own turn, same pattern as DAY_DISCUSSION_PASS_TURN.
    socket.on(SOCKET_EVENTS.CHEF_SECOND_DEBATE_PASS_TURN, (_payload: unknown, ack: Ack) => {
      safeAck(() => {
        const engine = requireGameFor(socket);
        const currentSpeakerId = engine.getCurrentSecondDebateSpeakerId();
        if (!socket.data.isAdmin && socket.data.playerId !== currentSpeakerId) {
          throw new Error("Ce n'est pas votre tour de parler.");
        }
        engine.advanceSecondDebateSpeaker();
        sync(io, engine);
      }, ack);
    });

    // -----------------------------------------------------------------
    // Tie defense — self-serve "passe la parole" (same pattern as day discussion)
    // -----------------------------------------------------------------

    socket.on(SOCKET_EVENTS.TIE_DEFENSE_PASS_TURN, (_payload: unknown, ack: Ack) => {
      safeAck(() => {
        const engine = requireGameFor(socket);
        const currentSpeakerId = engine.getCurrentTieDefenseSpeakerId();
        if (!socket.data.isAdmin && socket.data.playerId !== currentSpeakerId) {
          throw new Error("Ce n'est pas votre tour de parler.");
        }
        engine.advanceTieDefenseSpeaker();
        sync(io, engine);
      }, ack);
    });

    socket.on(SOCKET_EVENTS.CHEF_VOTE_CAST, (payload: ChefVoteCastPayload, ack: Ack) => {
      safeAck(() => {
        const engine = requireGameFor(socket);
        engine.castChefVote(payload.voterId ?? socket.data.playerId!, payload.candidateId);
        broadcastGameState(io, engine);
      }, ack);
    });

    // The admin (or an autoprogress timer) is the one that actually tallies.
    socket.on(SOCKET_EVENTS.CHEF_ELECTED, (_payload: unknown, ack: Ack) => {
      safeAck(() => {
        const engine = requireAdminGame(socket);
        const electedId = engine.tallyChefVoteAndProceed();
        sync(io, engine);
        return { electedId };
      }, ack);
    });

    // -----------------------------------------------------------------
    // Day discussion / vote
    // -----------------------------------------------------------------

    socket.on(SOCKET_EVENTS.DAY_VOTE_CAST, (payload: DayVoteCastPayload, ack: Ack) => {
      safeAck(() => {
        const engine = requireGameFor(socket);
        // castDayVote() itself enforces turn order (throws if it isn't this
        // voter's turn) and advances the per-voter queue, which may end the
        // round (tally) or the whole game — sync() (not broadcastGameState)
        // is required here so the next voter's fresh timer gets scheduled
        // and any resulting GAME_ENDED gets emitted.
        engine.castDayVote(payload.voterId ?? socket.data.playerId!, payload.targetId);
        sync(io, engine);
      }, ack);
    });

    // -----------------------------------------------------------------
    // Night actions
    // -----------------------------------------------------------------

    socket.on(SOCKET_EVENTS.NIGHT_ACTION_SUBMIT, (payload: NightActionSubmitPayload, ack: Ack) => {
      safeAck(() => {
        const engine = requireGameFor(socket);
        const playerId = payload.playerId ?? socket.data.playerId!;
        engine.submitNightAction(playerId, payload.actionType, payload.targetId, payload.guessedRoleId);

        // The Voyante's power is otherwise silent: her INSPECT action has
        // no other feedback channel, so tell her privately what she saw.
        if (payload.actionType === "INSPECT") {
          const result = engine.getLastVoyanteResult(playerId);
          if (result) {
            const verdict = result.result === "LOUP" ? "un Loup-Garou" : "un(e) villageois(e) (pas de loup)";
            notifyPlayer(io, playerId, "INFO", `🔮 ${result.targetNickname} est ${verdict}.`);
          }
        }

        // The Alien's guess is otherwise completely silent to everyone,
        // including — deliberately — the rest of the village: a correct
        // guess just looks like an ordinary death at dawn, with no hint an
        // Alien was involved. He alone gets to know whether he was right,
        // exactly like the Voyante above, via his own private channel.
        if (payload.actionType === "ALIEN_GUESS") {
          const result = engine.getAlienLastGuessResult(playerId);
          if (result === "CORRECT") {
            notifyPlayer(io, playerId, "INFO", "👽 Votre supposition était juste.");
          } else if (result === "WRONG") {
            notifyPlayer(io, playerId, "INFO", "👽 Votre supposition était fausse.");
          }
        }

        // Must re-push night prompts (not just broadcast state): once the
        // wolves lock in a target, roles prompted later in priority order
        // (e.g. Sorcière) need their context refreshed with that target —
        // otherwise they're stuck looking at the stale prompt from the
        // start of the night, before any wolf had voted. This is safe to
        // do unconditionally because pushNightPrompts (via
        // engine.getNightPrompts()) only re-sends to players who HAVEN'T
        // submitted an action yet — someone who already acted (e.g. the
        // wolves themselves) will never have their prompt reopened by a
        // later role's submission.
        sync(io, engine);
      }, ack);
    });

    // Loup Vert's two extra, independent night actions — see
    // packages/shared/src/events.ts's LOUP_VERT_* comments for why these
    // live on their own channel instead of NIGHT_ACTION_SUBMIT.
    socket.on(SOCKET_EVENTS.LOUP_VERT_GUESS_SUBMIT, (payload: LoupVertGuessSubmitPayload, ack: Ack) => {
      safeAck(() => {
        const engine = requireGameFor(socket);
        const loupVertId = payload.playerId ?? socket.data.playerId!;
        const outcome = engine.submitLoupVertGuess(loupVertId, payload.targetId, payload.guessedRoleId);

        // Secrecy requirement: NEVER announce this to the room. Only the
        // Loup Vert himself learns whether he was right (so he can play
        // on), and only the victim — on a correct guess — learns their
        // power was stolen. Everyone else sees nothing at all right now;
        // the victim's later actions (or lack thereof) just look normal.
        if (outcome.correct) {
          notifyPlayer(
            io,
            loupVertId,
            "INFO",
            outcome.permanent
              ? "🐺 Vous avez deviné juste ! Vous héritez du pouvoir de vengeance du Chasseur, pour toujours."
              : "🐺 Vous avez deviné juste ! Vous empruntez son pouvoir pour cette nuit.",
          );
          notifyPlayer(
            io,
            payload.targetId,
            "INFO",
            "🐺 Le Loup vert a deviné votre rôle et vous a volé votre pouvoir. Vous êtes désormais un(e) simple villageois(e).",
          );
        } else {
          notifyPlayer(io, loupVertId, "INFO", "🐺 Mauvaise pioche — ce n'était pas son rôle.");
        }

        sync(io, engine); // may open the LOUP_VERT_STOLEN_POWER_PROMPT this same night
      }, ack);
    });

    socket.on(
      SOCKET_EVENTS.LOUP_VERT_STOLEN_POWER_SUBMIT,
      (payload: LoupVertStolenPowerSubmitPayload, ack: Ack) => {
        safeAck(() => {
          const engine = requireGameFor(socket);
          const loupVertId = payload.playerId ?? socket.data.playerId!;
          engine.submitLoupVertStolenPowerAction(loupVertId, payload.actionType, payload.targetId);
          sync(io, engine);
        }, ack);
      },
    );

    socket.on(SOCKET_EVENTS.CHASSEUR_SHOOT, (payload: ChasseurShootPayload, ack: Ack) => {
      safeAck(() => {
        const engine = requireGameFor(socket);
        const shooterId = payload.playerId ?? socket.data.playerId!;
        engine.submitChasseurShot(shooterId, payload.targetId);
        sync(io, engine);
        if (engine.getPhase() === "ENDED") {
          io.to(roomForGame(engine.getCode())).emit(SOCKET_EVENTS.GAME_ENDED, {
            stats: engine.getEndGameStats(),
          });
        }
      }, ack);
    });

    socket.on(SOCKET_EVENTS.CHEF_SUCCESSION_CHOOSE, (payload: ChefSuccessionChoosePayload, ack: Ack) => {
      safeAck(() => {
        const engine = requireGameFor(socket);
        const deadChefId = socket.data.playerId!;
        engine.chooseChefSuccessor(deadChefId, payload.successorId);
        sync(io, engine);
        if (engine.getPhase() === "ENDED") {
          io.to(roomForGame(engine.getCode())).emit(SOCKET_EVENTS.GAME_ENDED, {
            stats: engine.getEndGameStats(),
          });
        }
      }, ack);
    });

    // -----------------------------------------------------------------
    // Wolf private chat
    // -----------------------------------------------------------------

    socket.on(SOCKET_EVENTS.WOLF_CHAT_SEND, (payload: WolfChatSendPayload, ack: Ack) => {
      safeAck(() => {
        const engine = requireGameFor(socket);
        const playerId = payload.playerId ?? socket.data.playerId!;
        relayWolfChatMessage(io, engine, playerId, payload.message);
      }, ack);
    });

    // -----------------------------------------------------------------
    // Post-game MVP vote (section 12) — opened automatically in sync()
    // above, the moment GAME_ENDED fires.
    // -----------------------------------------------------------------

    socket.on(SOCKET_EVENTS.MVP_VOTE_CAST, (payload: MvpVoteCastPayload, ack: Ack) => {
      safeAck(() => {
        const engine = requireGameFor(socket);
        const voterId = socket.data.playerId;
        if (!voterId) throw new Error("Seul un joueur ayant participé à la partie peut voter.");
        mvpVotingRegistry.castVote(engine.getCode(), voterId, payload.votedForId);

        const state = buildMvpStatePayload(engine.getCode());
        if (state) io.to(roomForGame(engine.getCode())).emit(SOCKET_EVENTS.MVP_STATE, state);

        if (mvpVotingRegistry.isComplete(engine.getCode())) {
          finalizeMvpVoting(io, engine);
        }
      }, ack);
    });

    // Safety valve for a straggler who never comes back to vote — same
    // idea as ADMIN_FORCE_NEXT_PHASE, since this vote otherwise has no
    // fixed deadline by design.
    socket.on(SOCKET_EVENTS.ADMIN_FORCE_MVP_FINALIZE, (_payload: unknown, ack: Ack) => {
      safeAck(() => {
        const engine = requireAdminGame(socket);
        finalizeMvpVoting(io, engine);
      }, ack);
    });
  });
}

function requireGameFor(socket: Socket<any, any, any, SocketData>) {
  const code = socket.data.gameCode;
  if (!code) throw new Error("Aucune partie associée à cette connexion.");
  return gameRegistry.requireGame(code);
}

function requireAdminGame(socket: Socket<any, any, any, SocketData>) {
  if (!socket.data.isAdmin) throw new Error("Action réservée à l'administrateur.");
  return requireGameFor(socket);
}

function requireAdmin(socket: Socket<any, any, any, SocketData>) {
  if (!socket.data.isAdmin) throw new Error("Action réservée à l'administrateur.");
}

/** Gate for CHEF_FORCE_NEXT_PHASE: must be the currently elected AND still-alive Chef. */
function requireChefGame(socket: Socket<any, any, any, SocketData>) {
  const engine = requireGameFor(socket);
  const state = engine.getPublicState();
  const me = state.players.find((p) => p.id === socket.data.playerId);
  if (!state.chefId || socket.data.playerId !== state.chefId || !me?.isAlive) {
    throw new Error("Action réservée au Chef du village actuellement en vie.");
  }
  return engine;
}

