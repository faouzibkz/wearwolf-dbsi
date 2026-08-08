import type { RoleId } from "@loupgarou/shared";
import { ROLE_METADATA } from "@loupgarou/shared";
import type { EngineContext } from "../internalTypes";
import { ROLE_REGISTRY } from "../roles/registry";
import type { NightActionRequest } from "../roles/Role";

/**
 * The Loup Vert's second night power (on top of the normal pack kill vote,
 * handled separately in roles/loupVert.ts): from night 2 on, he may guess
 * one alive village-team player's exact role. Guess right and he steals
 * that role's power — for one night only, except CHASSEUR, which has no
 * "one night" version of a death trigger, so it transfers to him
 * permanently instead (see DeathQueue.ts for the matching onDeath hook).
 * The stripped villager permanently becomes a plain Villageois either way.
 *
 * This lives outside the RoleModule/NightResolver system on purpose: a
 * player can only have ONE pending prompt at a time there, but the Loup
 * Vert needs up to three independent things available the same night (the
 * pack vote, this guess, and possibly a borrowed power) — see the
 * LOUP_VERT_GUESS_* / LOUP_VERT_STOLEN_POWER_* socket events.
 */

/** Village-team role ids he may claim a target holds. */
export function guessableRoleIds(): RoleId[] {
  return (Object.keys(ROLE_METADATA) as RoleId[]).filter((id) => ROLE_METADATA[id].team === "VILLAGE");
}

export function guessEligibleTargetIds(ctx: EngineContext, loupVertId: string): string[] {
  return ctx
    .getAlivePlayers()
    .filter((p) => p.id !== loupVertId && ROLE_METADATA[p.roleId].team === "VILLAGE")
    .map((p) => p.id);
}

function currentNight(ctx: EngineContext): number {
  return ctx.state.nightScratch?.nightNumber ?? ctx.state.nightNumber;
}

export interface LoupVertGuessOutcome {
  correct: boolean;
  /** True only when the granted power is the permanent Chasseur trigger. */
  permanent: boolean;
  /** The role whose power was granted — set only when `correct` is true. */
  grantedPowerRoleId: RoleId | null;
}

export function submitGuess(
  ctx: EngineContext,
  loupVertId: string,
  targetId: string,
  guessedRoleId: RoleId,
): LoupVertGuessOutcome {
  const loupVert = ctx.getPlayer(loupVertId);
  if (loupVert.roleId !== "LOUP_VERT") throw new Error("Seul le Loup vert peut deviner un rôle.");
  if (!loupVert.isAlive) throw new Error("Un joueur mort ne peut pas agir.");

  const nightNumber = currentNight(ctx);
  if (nightNumber < 2) throw new Error("Le Loup vert ne peut deviner qu'à partir de la nuit 2.");
  if (loupVert.loupVertLastGuessNight === nightNumber) {
    throw new Error("Le Loup vert a déjà deviné cette nuit.");
  }

  const target = ctx.getPlayer(targetId);
  if (!target.isAlive || ROLE_METADATA[target.roleId].team !== "VILLAGE") {
    throw new Error("Cible invalide pour le Loup vert — uniquement des joueurs du village, vivants.");
  }
  if (ROLE_METADATA[guessedRoleId].team !== "VILLAGE") {
    throw new Error("Le Loup vert ne peut deviner qu'un rôle du village.");
  }

  loupVert.loupVertLastGuessNight = nightNumber;
  const correct = target.roleId === guessedRoleId;

  ctx.recordEvent({
    type: "LOUP_VERT_GUESS",
    night: nightNumber,
    actorId: loupVertId,
    targetId,
    guessedRoleId,
    correct,
  });

  if (!correct) {
    ctx.log(`${loupVert.nickname} (Loup vert) a deviné un rôle, à tort.`);
    return { correct: false, permanent: false, grantedPowerRoleId: null };
  }

  if (guessedRoleId === "CHASSEUR") {
    loupVert.loupVertHasChasseurPower = true;
    loupVert.loupVertStolenPowerRoleId = null;
    loupVert.loupVertStolenPowerSourcePlayerId = null;
    loupVert.loupVertStolenPowerGrantedNight = null;
    loupVert.loupVertStolenPowerUsedTonight = false;
  } else {
    // Guessing a new (non-Chasseur) role right always supersedes whatever
    // he was holding before — including giving up a permanent Chasseur
    // trigger, per the house rule.
    loupVert.loupVertHasChasseurPower = false;
    loupVert.loupVertStolenPowerRoleId = guessedRoleId;
    loupVert.loupVertStolenPowerSourcePlayerId = targetId;
    loupVert.loupVertStolenPowerGrantedNight = nightNumber;
    loupVert.loupVertStolenPowerUsedTonight = false;
  }

  target.roleId = "VILLAGEOIS";
  ctx.log(`${loupVert.nickname} (Loup vert) a deviné juste et vole un pouvoir.`);

  return { correct: true, permanent: guessedRoleId === "CHASSEUR", grantedPowerRoleId: guessedRoleId };
}

/**
 * The stolen-power prompt, if he currently holds one usable THIS night —
 * built by calling the real role's own buildNightPrompt against the
 * victim's own stored per-player state (potions used, last-protected id,
 * inspection counts, ...), so it behaves exactly as if the victim were
 * still acting themselves.
 */
export function getStolenPowerPrompt(ctx: EngineContext, loupVertId: string): NightActionRequest | null {
  const loupVert = ctx.getPlayer(loupVertId);
  const roleId = loupVert.loupVertStolenPowerRoleId;
  const sourceId = loupVert.loupVertStolenPowerSourcePlayerId;
  if (!roleId || !sourceId) return null;
  if (loupVert.loupVertStolenPowerGrantedNight !== currentNight(ctx)) return null;
  if (loupVert.loupVertStolenPowerUsedTonight) return null;
  const source = ctx.state.players.get(sourceId);
  if (!source) return null;
  return ROLE_REGISTRY[roleId].buildNightPrompt?.(ctx, source) ?? null;
}

export function submitStolenPowerAction(
  ctx: EngineContext,
  loupVertId: string,
  actionType: string,
  targetId?: string,
): void {
  const loupVert = ctx.getPlayer(loupVertId);
  const roleId = loupVert.loupVertStolenPowerRoleId;
  const sourceId = loupVert.loupVertStolenPowerSourcePlayerId;
  if (!roleId || !sourceId) throw new Error("Aucun pouvoir volé disponible.");
  if (loupVert.loupVertStolenPowerGrantedNight !== currentNight(ctx)) {
    throw new Error("Ce pouvoir volé n'est plus disponible.");
  }
  if (loupVert.loupVertStolenPowerUsedTonight) throw new Error("Pouvoir volé déjà utilisé cette nuit.");

  const source = ctx.getPlayer(sourceId);
  const role = ROLE_REGISTRY[roleId];
  role.applyNightAction?.(ctx, source, { playerId: sourceId, actionType, targetId });
  // Some roles (Corbeau) only commit their scratch data to persistent
  // state inside resolve() — normally invoked by NightResolver.resolveNight()'s
  // standard per-role loop, but that loop only considers roles someone
  // CURRENTLY holds (getActiveNightRoles), and nobody currently holds
  // `roleId` anymore (the source was stripped to VILLAGEOIS the moment it
  // was stolen) — so it has to be called here instead, right away, or the
  // borrowed action would silently do nothing.
  role.resolve?.(ctx);

  // The Voyante's inspection result is recorded keyed by the ACTOR's id
  // (here, the stripped source's id, since that's who's state we reused) —
  // duplicate it under the Loup Vert's own id too, so the server's existing
  // "fetch this voyante's last result" lookup (GameEngine.getLastVoyanteResult)
  // finds it for HIM without needing any bespoke plumbing.
  if (roleId === "VOYANTE") {
    const inspections = ctx.state.nightScratch?.voyanteInspections ?? [];
    const last = inspections[inspections.length - 1];
    if (last && last.voyanteId === sourceId) {
      inspections.push({ ...last, voyanteId: loupVertId });
    }
  }

  loupVert.loupVertStolenPowerUsedTonight = true;
}
