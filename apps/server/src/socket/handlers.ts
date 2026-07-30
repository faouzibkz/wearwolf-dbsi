import type { Server, Socket } from "socket.io";
import {
  SOCKET_EVENTS,
  DEFAULT_GAME_CONFIG,
  type AdminAuthPayload,
  type AdminCreateGamePayload,
  type AdminResolveTiePayload,
  type AdminSetSoundEffectsPayload,
  type AdminUpdateConfigPayload,
  type ChasseurShootPayload,
  type ChefSuccessionChoosePayload,
  type ChefVoteCastPayload,
  type ChefVolunteerPayload,
  type DayVoteCastPayload,
  type NightActionSubmitPayload,
  type PlayerJoinPayload,
  type PlayerReconnectPayload,
  type WolfChatSendPayload,
} from "@loupgarou/shared";
import { gameRegistry } from "../gameRegistry.js";
import { listPresets, savePreset } from "../db/persistence.js";
import { broadcastGameState, notifyGame, notifyPlayer, pushRoleAssignments, roomForGame, roomForPlayer } from "./broadcast.js";
import { relayWolfChatMessage } from "./wolfRoom.js";
import { forceNextPhase } from "./forceNextPhase.js";
import { safeAck, type Ack, type SocketData } from "./types.js";
import { schedulePhaseTimer, clearPhaseTimer } from "./timers.js";
import { pushAllPrompts } from "./sync.js";

function sync(io: Server, engine: import("@loupgarou/game-engine").GameEngine): void {
  pushAllPrompts(io, engine);
  schedulePhaseTimer(io, engine);
}

export function registerSocketHandlers(io: Server): void {
  io.on("connection", (socket: Socket<any, any, any, SocketData>) => {
    socket.data.isAdmin = false;

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
        const engine = gameRegistry.requireGame(payload.gameCode);
        const player = engine.addPlayer(payload.nickname);
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
        engine.setConnected(player.id, true);
        socket.data.gameCode = engine.getCode();
        socket.data.playerId = player.id;
        socket.join(roomForGame(engine.getCode()));
        socket.join(roomForPlayer(player.id));
        io.to(roomForPlayer(player.id)).emit(SOCKET_EVENTS.ROLE_ASSIGNED, {
          playerId: player.id,
          roleId: player.roleId,
        });
        sync(io, engine);
        return { roleId: player.roleId };
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
        forceNextPhase(engine);
        sync(io, engine);
        if (engine.getPhase() === "ENDED") {
          io.to(roomForGame(engine.getCode())).emit(SOCKET_EVENTS.GAME_ENDED, {
            stats: engine.getEndGameStats(),
          });
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
        sync(io, engine);
        io.to(roomForGame(engine.getCode())).emit(SOCKET_EVENTS.GAME_ENDED, {
          stats: engine.getEndGameStats(),
        });
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
        engine.castDayVote(payload.voterId ?? socket.data.playerId!, payload.targetId);
        broadcastGameState(io, engine);
      }, ack);
    });

    // -----------------------------------------------------------------
    // Night actions
    // -----------------------------------------------------------------

    socket.on(SOCKET_EVENTS.NIGHT_ACTION_SUBMIT, (payload: NightActionSubmitPayload, ack: Ack) => {
      safeAck(() => {
        const engine = requireGameFor(socket);
        const playerId = payload.playerId ?? socket.data.playerId!;
        engine.submitNightAction(playerId, payload.actionType, payload.targetId);

        // The Voyante's power is otherwise silent: her INSPECT action has
        // no other feedback channel, so tell her privately what she saw.
        if (payload.actionType === "INSPECT") {
          const result = engine.getLastVoyanteResult(playerId);
          if (result) {
            const verdict = result.result === "LOUP" ? "un Loup-Garou" : "un(e) villageois(e) (pas de loup)";
            notifyPlayer(io, playerId, "INFO", `🔮 ${result.targetNickname} est ${verdict}.`);
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

