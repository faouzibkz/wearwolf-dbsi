import type { Server } from "socket.io";
import { SOCKET_EVENTS, type AdminStatePayload } from "@loupgarou/shared";
import type { GameEngine } from "@loupgarou/game-engine";
import { gameRegistry } from "../gameRegistry.js";
import { persistGame } from "../db/persistence.js";

/**
 * Every mutating handler ends by calling this. It is the ONLY place that
 * sends state to clients, which makes "never leak hidden info" a property
 * of one function instead of something every handler has to remember.
 */
export function broadcastGameState(io: Server, engine: GameEngine): void {
  const code = engine.getCode();
  io.to(roomForGame(code)).emit(SOCKET_EVENTS.GAME_STATE, engine.getPublicState());

  const adminSocketId = gameRegistry.getAdminSocket(code);
  if (adminSocketId) {
    const payload: AdminStatePayload = {
      state: engine.getPublicState(),
      roles: engine.getAdminRoles(),
      logs: engine.getLogs(),
    };
    io.to(adminSocketId).emit(SOCKET_EVENTS.ADMIN_STATE, payload);
  }

  if (engine.consumePendingMowgliReveal()) {
    io.to(roomForGame(code)).emit(SOCKET_EVENTS.NOTIFICATION, {
      type: "MOWGLI_TRANSFORMED",
      message: "Mowgli est devenu un Loup-garou.",
    });
  }

  void persistGame(engine);
}

export function pushNightPrompts(io: Server, engine: GameEngine): void {
  const prompts = engine.getNightPrompts();
  const deadlineAt = engine.getPhaseEndsAt() ?? Date.now() + engine.getConfig().timers.night * 1000;
  for (const { player, request } of prompts) {
    io.to(roomForPlayer(player.id)).emit(SOCKET_EVENTS.NIGHT_PROMPT, {
      roleId: player.roleId,
      actionType: request.actionType,
      eligibleTargetIds: request.eligibleTargetIds,
      context: request.context,
      deadlineAt,
    });
  }
}

export function pushChasseurPrompts(io: Server, engine: GameEngine): void {
  for (const shooterId of engine.getPendingChasseurShooterIds()) {
    const eligible = engine
      .getPublicState()
      .players.filter((p) => p.isAlive && p.id !== shooterId)
      .map((p) => p.id);
    io.to(roomForPlayer(shooterId)).emit(SOCKET_EVENTS.CHASSEUR_PROMPT, {
      eligibleTargetIds: eligible,
    });
  }
}

export function pushRoleAssignments(io: Server, engine: GameEngine): void {
  for (const player of engine.getPlayers()) {
    io.to(roomForPlayer(player.id)).emit(SOCKET_EVENTS.ROLE_ASSIGNED, {
      playerId: player.id,
      roleId: engine.getPlayerRole(player.id),
    });
  }
}

export function notifyGame(io: Server, code: string, type: string, message: string): void {
  io.to(roomForGame(code)).emit(SOCKET_EVENTS.NOTIFICATION, { type, message });
}

export function notifyPlayer(io: Server, playerId: string, type: string, message: string): void {
  io.to(roomForPlayer(playerId)).emit(SOCKET_EVENTS.NOTIFICATION, { type, message });
}

export function roomForGame(code: string): string {
  return `game:${code.toUpperCase()}`;
}

export function roomForPlayer(playerId: string): string {
  return `player:${playerId}`;
}
