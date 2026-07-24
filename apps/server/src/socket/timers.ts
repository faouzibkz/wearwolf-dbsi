import type { Server } from "socket.io";
import type { Phase, TimerConfig } from "@loupgarou/shared";
import type { GameEngine } from "@loupgarou/game-engine";
import { broadcastGameState, pushChasseurPrompts, pushNightPrompts } from "./broadcast.js";
import { pushWolfRoomState } from "./wolfRoom.js";
import { forceNextPhase } from "./forceNextPhase.js";

const timers = new Map<string, NodeJS.Timeout>();

const PHASE_TIMER_KEY: Partial<Record<Phase, keyof TimerConfig>> = {
  CHEF_DEBATE: "chefDebate",
  CHEF_VOTE: "chefVote",
  DAY_1_DISCUSSION: "day1Discussion",
  NIGHT: "night",
  DAY_DISCUSSION: "dayDiscussion",
  DAY_VOTE: "dayVote",
  TIE_DEFENSE: "tieDefense",
};

export function clearPhaseTimer(code: string): void {
  const t = timers.get(code);
  if (t) {
    clearTimeout(t);
    timers.delete(code);
  }
}

/**
 * Called after every state mutation. Always refreshes `phaseEndsAt` for the
 * UI countdown; only actually schedules an auto-advance if the admin has
 * `autoProgress` enabled and the game isn't paused. Because this function
 * is re-invoked after every mutation (including the timer's own
 * auto-advance), phases chain automatically end-to-end without any
 * separate "scheduler loop".
 */
export function schedulePhaseTimer(io: Server, engine: GameEngine): void {
  clearPhaseTimer(engine.getCode());
  const phase = engine.getPhase();
  const key = PHASE_TIMER_KEY[phase];

  if (!key) {
    engine.setPhaseTimer(null);
    return;
  }

  const seconds = engine.getConfig().timers[key];
  engine.setPhaseTimer(seconds);

  if (!engine.getConfig().autoProgress || engine.getPublicState().paused) return;

  const timeout = setTimeout(() => {
    try {
      if (phase === "CHEF_DEBATE") {
        engine.advanceChefSpeaker();
      } else {
        forceNextPhase(engine);
      }
      broadcastGameState(io, engine);
      pushChasseurPrompts(io, engine);
      if (engine.getPhase() === "NIGHT") {
        pushNightPrompts(io, engine);
        pushWolfRoomState(io, engine);
      }
      schedulePhaseTimer(io, engine);
    } catch (err) {
      console.error("[timer] auto-advance failed", err);
    }
  }, seconds * 1000);

  timers.set(engine.getCode(), timeout);
}
