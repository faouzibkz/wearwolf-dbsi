import type { EngineContext } from "../internalTypes";
import * as SpeakerQueue from "./SpeakerQueue";

/**
 * CHEF_SECOND_DEBATE: an optional bonus round the Chef alone can trigger,
 * right after the normal Day Discussion order finishes (including his own
 * closing word). He may hand up to `config.secondDebateSlots` chosen
 * players one more speaking turn each — or nobody, if he'd rather move
 * straight to the vote. Same per-speaker queue mechanic as DayDiscussion.ts
 * / TieDefense.ts, just with a chef-picked (not shuffled) order and a
 * "hasn't chosen yet" null state up front — see GameStatePublic.secondDebateChoicePending.
 */

export function getEligibleTargets(ctx: EngineContext): string[] {
  const chefId = ctx.state.chef.electedId;
  return ctx.getAlivePlayers().filter((p) => p.id !== chefId).map((p) => p.id);
}

export function chooseSpeakers(ctx: EngineContext, playerIds: string[]): void {
  // Defensive fallback: a game whose config was saved/loaded from before
  // this field existed (an old preset, a stale admin-side draft) could have
  // `secondDebateSlots` missing entirely. `undefined` would make the limit
  // check below a silent no-op (`N > undefined` is always false) instead of
  // actually enforcing a cap — harmless on its own, but worth guarding
  // explicitly rather than relying on that coincidence.
  const max = ctx.state.config.secondDebateSlots ?? 2;
  if (playerIds.length > max) {
    throw new Error(`Le Chef peut choisir au maximum ${max} joueur(s) pour ce second débat.`);
  }
  const chefId = ctx.state.chef.electedId;
  const seen = new Set<string>();
  for (const id of playerIds) {
    if (seen.has(id)) throw new Error("Un même joueur ne peut être choisi qu'une seule fois.");
    seen.add(id);
    if (id === chefId) throw new Error("Le Chef ne peut pas se choisir lui-même.");
    const player = ctx.getPlayer(id);
    if (!player.isAlive) throw new Error("Seuls des joueurs vivants peuvent recevoir un second temps de parole.");
  }

  ctx.state.secondDebateQueue = { order: [...playerIds], currentSpeakerIndex: 0 };
  const firstId = SpeakerQueue.currentSpeakerId(ctx.state.secondDebateQueue);
  if (firstId) {
    ctx.log(`${ctx.getPlayer(firstId).nickname} reçoit un second temps de parole (accordé par le Chef).`);
  } else {
    ctx.log("Le Chef n'accorde aucun second temps de parole.");
  }
}

export function currentSpeakerId(ctx: EngineContext): string | null {
  const q = ctx.state.secondDebateQueue;
  return q ? SpeakerQueue.currentSpeakerId(q) : null;
}

/** Advances to the next bonus speaker. `done: true` means the last chosen player's turn just ended (or none were chosen). */
export function advanceSpeaker(ctx: EngineContext): { done: boolean } {
  const q = ctx.state.secondDebateQueue;
  if (!q) throw new Error("Aucun second débat en cours.");
  const result = SpeakerQueue.advance(q);
  if (!result.done) {
    const nextId = SpeakerQueue.currentSpeakerId(q)!;
    ctx.log(`${ctx.getPlayer(nextId).nickname} prend la parole (second débat).`);
  }
  return result;
}
