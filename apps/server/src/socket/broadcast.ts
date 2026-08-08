import type { Server } from "socket.io";
import {
  SOCKET_EVENTS,
  type AdminStatePayload,
  type NightStepStatePayload,
  type RoleAssignedPayload,
} from "@loupgarou/shared";
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

/**
 * Cahier de charge #2 §17.1 — SEQUENTIAL night mode only. Public companion
 * to pushNightPrompts: tells EVERYONE (not just whoever has to act) whose
 * turn it currently is, so a player with nothing to do this step can render
 * "the village is sleeping / Le Voyante consulte ses visions..." instead of
 * a blank screen, and so the client can show a "3 / 6" progress indicator.
 * A no-op in SIMULTANEOUS mode (engine.getCurrentNightStepRoleIds() is
 * always null there — see GameEngine.isSequentialNightMode()) and outside
 * NIGHT entirely, so this is safe to call unconditionally from pushAllPrompts.
 */
export function pushNightStepState(io: Server, engine: GameEngine): void {
  if (!engine.isSequentialNightMode()) return;
  const currentStepRoleIds = engine.getCurrentNightStepRoleIds();
  const { stepIndex, totalSteps } = engine.getNightStepProgress();
  // Same fallback convention as pushNightPrompts/pushLoupVertGuessPrompts
  // above: normally schedulePhaseTimer (timers.ts) has already set a real
  // deadline by the time this fires, but fall back to "starting now, for
  // this step's own configured duration" rather than emit a deadline that
  // already looks expired if this is ever called first.
  const stepDeadlineAt = currentStepRoleIds
    ? engine.getPhaseEndsAt() ?? Date.now() + (engine.getCurrentNightStepDurationSeconds() ?? engine.getConfig().timers.night) * 1000
    : null;
  const payload: NightStepStatePayload = { currentStepRoleIds, stepIndex, totalSteps, stepDeadlineAt };
  io.to(roomForGame(engine.getCode())).emit(SOCKET_EVENTS.NIGHT_STEP_STATE, payload);
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

/**
 * The Loup Vert's guess prompt (see LOUP_VERT_GUESS_PROMPT/SUBMIT — a
 * dedicated side channel, independent of the pack's own KILL_VOTE prompt
 * on the standard NIGHT_PROMPT channel, since he can have both pending the
 * same night). Only pushed once he's actually got someone to guess about
 * and hasn't already used tonight's single attempt.
 */
export function pushLoupVertGuessPrompts(io: Server, engine: GameEngine): void {
  const deadlineAt = engine.getPhaseEndsAt() ?? Date.now() + engine.getConfig().timers.night * 1000;
  for (const player of engine.getPlayers()) {
    if (!player.isAlive || player.roleId !== "LOUP_VERT") continue;
    if (engine.hasLoupVertGuessedTonight(player.id)) continue;
    const eligibleTargetIds = engine.getLoupVertGuessEligibleTargets(player.id);
    if (eligibleTargetIds.length === 0) continue;
    io.to(roomForPlayer(player.id)).emit(SOCKET_EVENTS.LOUP_VERT_GUESS_PROMPT, {
      eligibleTargetIds,
      guessableRoleIds: engine.getLoupVertGuessableRoleIds(),
      deadlineAt,
    });
  }
}

/**
 * The Loup Vert's borrowed power prompt, if he's currently holding one
 * usable THIS night (see LOUP_VERT_STOLEN_POWER_PROMPT/SUBMIT). Reuses
 * NightPromptPayload's exact shape so the client's existing NightPromptPanel
 * renders it with no new UI code — the only twist is `roleId` here is the
 * STOLEN role (what power he's using), not his own "LOUP_VERT".
 */
export function pushLoupVertStolenPowerPrompts(io: Server, engine: GameEngine): void {
  const deadlineAt = engine.getPhaseEndsAt() ?? Date.now() + engine.getConfig().timers.night * 1000;
  for (const player of engine.getPlayers()) {
    if (!player.isAlive || player.roleId !== "LOUP_VERT") continue;
    const request = engine.getLoupVertStolenPowerPrompt(player.id);
    if (!request) continue;
    const extras = engine.getPrivateRoleExtras(player.id);
    io.to(roomForPlayer(player.id)).emit(SOCKET_EVENTS.LOUP_VERT_STOLEN_POWER_PROMPT, {
      roleId: extras.loupVertStolenPowerRoleId ?? player.roleId,
      actionType: request.actionType,
      eligibleTargetIds: request.eligibleTargetIds,
      context: request.context,
      deadlineAt,
    });
  }
}

/**
 * Role-specific private extras (Barbie's power-available flag, Alien's
 * remaining chances, Loup Vert's stolen-power status) — pushed to every
 * player's own room on every sync, unconditionally of phase, so the UI
 * always reflects the latest counters. Empty for anyone not holding one of
 * these three roles (see GameEngine.getPrivateRoleExtras).
 */
export function pushPrivateRoleState(io: Server, engine: GameEngine): void {
  for (const player of engine.getPlayers()) {
    const extras = engine.getPrivateRoleExtras(player.id);
    if (Object.keys(extras).length === 0) continue;
    io.to(roomForPlayer(player.id)).emit(SOCKET_EVENTS.PRIVATE_ROLE_STATE, extras);
  }
}

export function pushChefSuccessionPrompt(io: Server, engine: GameEngine): void {
  const deadChefId = engine.getPendingChefSuccessionDeadChefId();
  if (!deadChefId) return;
  const eligibleSuccessorIds = engine
    .getPublicState()
    .players.filter((p) => p.isAlive)
    .map((p) => p.id);
  io.to(roomForPlayer(deadChefId)).emit(SOCKET_EVENTS.CHEF_SUCCESSION_PROMPT, { eligibleSuccessorIds });
}

export function pushRoleAssignments(io: Server, engine: GameEngine): void {
  for (const player of engine.getPlayers()) {
    const payload: RoleAssignedPayload = {
      playerId: player.id,
      roleId: engine.getPlayerRole(player.id),
      wolfTeammates: engine.getWolfTeammates(player.id),
    };
    io.to(roomForPlayer(player.id)).emit(SOCKET_EVENTS.ROLE_ASSIGNED, payload);
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
