import type { Server } from "socket.io";
import type { GameEngine } from "@loupgarou/game-engine";
import {
  broadcastGameState,
  pushChasseurPrompts,
  pushChefSuccessionPrompt,
  pushLoupVertGuessPrompts,
  pushLoupVertStolenPowerPrompts,
  pushNightPrompts,
  pushPrivateRoleState,
} from "./broadcast.js";
import { pushWolfRoomState } from "./wolfRoom.js";

/**
 * The full "tell everyone what changed" sequence, minus timer scheduling
 * (kept separate on purpose: this file must stay import-free of timers.ts,
 * which already imports FROM broadcast.ts — folding scheduling in here too
 * would create a circular import).
 *
 * Both the socket handlers' own `sync()` (apps/server/src/socket/handlers.ts)
 * and the auto-progress timer's completion handler (timers.ts) call this, so
 * the two call sites can never drift out of sync with each other again. They
 * used to: the timer's own sequence forgot pushChefSuccessionPrompt, so a
 * Chef succession triggered purely by an auto-advance timeout (nobody
 * touched a button) never actually reached the dead Chef's screen — the
 * prompt just silently never arrived, and the game sat there looking stuck.
 */
export function pushAllPrompts(io: Server, engine: GameEngine): void {
  broadcastGameState(io, engine);
  pushChasseurPrompts(io, engine);
  pushChefSuccessionPrompt(io, engine);
  if (engine.getPhase() === "NIGHT") {
    pushNightPrompts(io, engine); // includes the Alien's ALIEN_GUESS prompt — standard channel, one action/night
    pushWolfRoomState(io, engine);
    pushLoupVertGuessPrompts(io, engine);
    pushLoupVertStolenPowerPrompts(io, engine);
  }
  // Resource counters (Barbie's power-available flag, Alien's chances,
  // Loup Vert's stolen-power status) — private to each player, phase-agnostic.
  pushPrivateRoleState(io, engine);
}
