import type { EngineContext } from "../internalTypes";
import { ROLE_REGISTRY } from "../roles/registry";

const CAUSE_LABELS: Record<string, string> = {
  LOUP_GAROU_ATTACK: "attaqué par les loups-garous",
  LOUP_BLANC_ATTACK: "dévoré par le loup blanc",
  SORCIERE_POISON: "empoisonné par la sorcière",
  CHASSEUR_SHOT: "abattu par le chasseur",
  VOTE_ELIMINATION: "éliminé par le village",
};

export interface DeathRequest {
  playerId: string;
  cause: string;
}

/**
 * Central place where players actually die. Handles, in order:
 *   1. marking the player dead + logging (admin-only log, no leaks to UI)
 *   2. death-triggered role powers (Chasseur -> registers a pending shot)
 *   3. Mowgli's father-death transformation check
 * Both night resolution and day-vote elimination (and Chasseur shots
 * themselves) funnel through this so the Mowgli/Chasseur chain reaction
 * logic only exists once.
 */
export function processDeaths(ctx: EngineContext, deaths: DeathRequest[]): string[] {
  const queue = [...deaths];
  const actuallyDied: string[] = [];

  while (queue.length > 0) {
    const next = queue.shift()!;
    const player = ctx.state.players.get(next.playerId);
    if (!player || !player.isAlive) continue;

    player.isAlive = false;
    player.deathCause = next.cause;
    actuallyDied.push(player.id);
    ctx.log(`${player.nickname} est mort — ${CAUSE_LABELS[next.cause] ?? next.cause}.`);

    const role = ROLE_REGISTRY[player.roleId];
    role.onDeath?.(ctx, player);

    for (const candidate of ctx.state.players.values()) {
      if (
        candidate.isAlive &&
        candidate.roleId === "MOWGLI" &&
        !candidate.mowgliTransformed &&
        candidate.mowgliFatherId === player.id
      ) {
        candidate.roleId = "LOUP_GAROU";
        candidate.mowgliTransformed = true;
        ctx.state.pendingMowgliReveal = true;
        ctx.log("Mowgli est devenu un Loup-garou (identité non révélée dans les logs publics).");
      }
    }
  }

  return actuallyDied;
}
