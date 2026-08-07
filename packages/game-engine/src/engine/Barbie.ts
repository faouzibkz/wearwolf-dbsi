import type { RoleId } from "@loupgarou/shared";
import { ROLE_METADATA } from "@loupgarou/shared";
import type { EngineContext } from "../internalTypes";
import { processDeaths } from "./DeathQueue";

/**
 * Barbie's one-shot power (see GameEngine.useBarbiePower): mid-Day-Discussion,
 * she points at a player and their role is revealed to everyone.
 *   - A wolf: he dies, and Barbie is forcibly installed as Chef du village
 *     (even replacing a sitting Chef).
 *   - Anyone else (village-team OR the Alien): both Barbie and the target
 *     die.
 * Either way, discussion resumes immediately afterward with the casualty
 * (or casualties) removed from whatever's left of today's speaking order,
 * and — only in the wolf case — the new Chef guaranteed the closing word.
 */

export function canUsePower(ctx: EngineContext, barbieId: string): boolean {
  const player = ctx.state.players.get(barbieId);
  return Boolean(player && player.roleId === "BARBIE" && player.isAlive && !player.barbiePowerUsed);
}

export function getEligibleTargets(ctx: EngineContext, barbieId: string): string[] {
  return ctx.getAlivePlayers().filter((p) => p.id !== barbieId).map((p) => p.id);
}

export interface BarbieRevealOutcome {
  targetId: string;
  targetNickname: string;
  targetRoleId: RoleId;
  outcome: "WOLF_DIED_BARBIE_CHEF" | "BOTH_DIED";
  newChefId: string | null;
}

function isWolfRole(roleId: RoleId): boolean {
  return ROLE_METADATA[roleId].team === "LOUPS";
}

export function usePower(ctx: EngineContext, barbieId: string, targetId: string): BarbieRevealOutcome {
  if (!canUsePower(ctx, barbieId)) {
    throw new Error("Barbie ne peut pas utiliser son pouvoir maintenant (déjà utilisé, morte, ou mauvais rôle).");
  }
  if (targetId === barbieId) throw new Error("Barbie ne peut pas se désigner elle-même.");
  const barbie = ctx.getPlayer(barbieId);
  const target = ctx.getPlayer(targetId);
  if (!target.isAlive) throw new Error("La cible doit être vivante.");

  barbie.barbiePowerUsed = true;
  const targetRoleId = target.roleId; // capture before any mutation below
  const targetNickname = target.nickname;

  let deadIds: string[];
  let newChefId: string | null = null;
  let outcomeType: BarbieRevealOutcome["outcome"];

  if (isWolfRole(targetRoleId)) {
    const oldChefId = ctx.state.chef.electedId;
    processDeaths(ctx, [{ playerId: targetId, cause: "BARBIE_REVEAL_WOLF" }]);
    // If the unmasked wolf happened to be the sitting Chef, processDeaths()
    // just registered a pending Chef-succession blocker for him (see
    // DeathQueue.ts) — but Barbie is about to take the title directly, with
    // no election needed, so that pending succession must be cleared here
    // or it would dangle forever and freeze the game.
    if (ctx.state.pendingChefSuccessionDeadChefId === targetId) {
      ctx.state.pendingChefSuccessionDeadChefId = null;
    }
    if (oldChefId) ctx.getPlayer(oldChefId).isChef = false;
    barbie.isChef = true;
    ctx.state.chef.electedId = barbieId;
    ctx.log(`${barbie.nickname} (Barbie) démasque ${targetNickname} — un loup — et prend la tête du village.`);
    deadIds = [targetId];
    newChefId = barbieId;
    outcomeType = "WOLF_DIED_BARBIE_CHEF";
    applyRevealToDiscussionQueue(ctx, deadIds, oldChefId, newChefId);
  } else {
    processDeaths(ctx, [
      { playerId: targetId, cause: "BARBIE_REVEAL_MISFIRE" },
      { playerId: barbieId, cause: "BARBIE_REVEAL_MISFIRE" },
    ]);
    ctx.log(`${barbie.nickname} (Barbie) démasque ${targetNickname} — pas un loup — et meurt avec elle/lui.`);
    deadIds = [targetId, barbieId];
    outcomeType = "BOTH_DIED";
    applyRevealToDiscussionQueue(ctx, deadIds, null, null);
  }

  return { targetId, targetNickname, targetRoleId, outcome: outcomeType, newChefId };
}

/**
 * Surgically updates the in-progress DAY_1_DISCUSSION/DAY_DISCUSSION
 * speaker queue after a reveal: drops anyone who just died from whatever's
 * left to speak, and — if Barbie just became Chef — guarantees her exactly
 * one final turn, replacing the old chef's now-superseded closing-turn
 * slot (rather than leaving her with a separate, now-redundant earlier
 * turn AND a new one). Already-past turns are untouched (history doesn't
 * change).
 */
function applyRevealToDiscussionQueue(
  ctx: EngineContext,
  deadIds: string[],
  oldChefId: string | null,
  newChefId: string | null,
): void {
  const dd = ctx.state.dayDiscussion;
  if (!dd) return; // reveal used outside a discussion phase — shouldn't happen, but safe no-op

  const idx = dd.currentSpeakerIndex;
  const past = dd.order.slice(0, idx);
  let remaining = dd.order.slice(idx).filter((id) => !deadIds.includes(id));

  if (newChefId) {
    if (oldChefId) remaining = remaining.filter((id) => id !== oldChefId);
    remaining = remaining.filter((id) => id !== newChefId); // drop her own separate pending turn, if any
    remaining.push(newChefId); // guaranteed single final word
  }

  dd.order = [...past, ...remaining];
  // currentSpeakerIndex (== idx == past.length) is untouched and now
  // correctly points at remaining[0] — or past the end, if remaining is
  // now empty, which GameEngine checks for right after calling usePower().
}
