import type { Server, Socket } from "socket.io";
import {
  SOCKET_EVENTS,
  DEFAULT_GAME_CONFIG,
  type AdminAuthPayload,
  type AdminCreateGamePayload,
  type AdminResolveTiePayload,
  type AdminUpdateConfigPayload,
  type ChasseurShootPayload,
  type ChefVoteCastPayload,
  type ChefVolunteerPayload,
  type DayVoteCastPayload,
  type NightActionSubmitPayload,
  type PlayerJoinPayload,
  type PlayerReconnectPayload,
  type WolfChatSendPayload,
} from "@loupgarou/shared";
import { gameRegistry } from "../gameRegistry.js";
import { config } from "../config.js";
import { listPresets, savePreset } from "../db/persistence.js";
import { broadcastGameState, notifyGame, pushChasseurPrompts, pushNightPrompts, pushRoleAssignments, roomForGame, roomForPlayer } from "./broadcast.js";
import { pushWolfRoomState, relayWolfChatMessage } from "./wolfRoom.js";
import { forceNextPhase } from "./forceNextPhase.js";
import { safeAck, type Ack, type SocketData } from "./types.js";
import { schedulePhaseTimer, clearPhaseTimer } from "./timers.js";

function sync(io: Server, engine: import("@loupgarou/game-engine").GameEngine): void {
  broadcastGameState(io, engine);
  pushChasseurPrompts(io, engine);
  if (engine.getPhase() === "NIGHT") {
    pushNightPrompts(io, engine);
    pushWolfRoomState(io, engine);
  }
  schedulePhaseTimer(io, engine);
}

export function registerSocketHandlers(io: Server): void {
  io.on("connection", (socket: Socket<any, any, any, SocketData>) => {
    socket.data.isAdmin = false;

    socket.on(SOCKET_EVENTS.ADMIN_AUTH, (payload: AdminAuthPayload, ack: Ack) => {
      safeAck(() => {
        if (payload.adminSecret !== config.adminSecret) {
          throw new Error("Code administrateur invalide.");
        }
        const engine = payload.gameCode
          ? gameRegistry.requireGame(payload.gameCode)
          : gameRegistry.create(DEFAULT_GAME_CONFIG);

        socket.data.isAdmin = true;
        socket.data.gameCode = engine.getCode();
        socket.join(roomForGame(engine.getCode()));
        gameRegistry.setAdminSocket(engine.getCode(), socket.id);
        sync(io, engine);
        return { code: engine.getCode() };
      }, ack);
    });

    socket.on(SOCKET_EVENTS.ADMIN_CREATE_GAME, (payload: AdminCreateGamePayload, ack: Ack) => {
      safeAck(() => {
        requireAdminSecretless(socket);
        const engine = gameRegistry.create(payload.config);
        socket.data.gameCode = engine.getCode();
        socket.join(roomForGame(engine.getCode()));
        gameRegistry.setAdminSocket(engine.getCode(), socket.id);
        sync(io, engine);
        return { code: engine.getCode() };
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
        // Must re-push night prompts (not just broadcast state): once the
        // wolves lock in a target, roles prompted later in priority order
        // (e.g. Sorcière) need their context refreshed with that target —
        // otherwise they're stuck looking at the stale prompt from the
        // start of the night, before any wolf had voted.
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

function requireAdminSecretless(socket: Socket<any, any, any, SocketData>) {
  if (!socket.data.isAdmin) throw new Error("Authentifiez-vous d'abord avec ADMIN_AUTH.");
}
