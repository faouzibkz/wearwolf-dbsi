import type { EngineContext } from "../internalTypes";
import { ROLE_REGISTRY } from "../roles/registry";

const CAUSE_LABELS: Record<string, string> = {
  LOUP_GAROU_ATTACK: "attaqué par les loups-garous",
  LOUP_BLANC_ATTACK: "dévoré par le loup blanc",
  SORCIERE_POISON: "empoisonné par la sorcière",
  CHASSEUR_SHOT: "abattu par le chasseur",
  VOTE_ELIMINATION: "éliminé par le village",
  ALIEN_GUESS_CORRECT: "deviné par l'Alien",
  ALIEN_OUT_OF_CHANCES: "mort — l'Alien n'avait plus de chance",
  BARBIE_REVEAL_WOLF: "démasqué par Barbie",
  BARBIE_REVEAL_MISFIRE: "emporté par le pouvoir de Barbie",
  ADMIN_KILL: "retiré de la partie par l'administrateur",
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
    // Cahier de charge #2 §17.3 — reuses the `isSpectator` field that was
    // already part of InternalPlayer/PlayerPublic (created false, never
    // written anywhere else — confirmed by grep before this change) rather
    // than adding a parallel "isDead"/"isInAfterlife" flag: a dead player
    // IS this game's spectator from this moment on (sees the game
    // continue, can no longer act — submitNightAction/day-vote casting
    // already reject !isAlive independently of this flag — and gets
    // access to the Afterlife chat, see AfterlifeChat.ts). Never set back
    // to false: death is permanent for the rest of this game.
    player.isSpectator = true;
    player.deathCause = next.cause;
    // Same "Nuit N" / "Jour N" label format as the admin log (ctx.log below)
    // — see InternalPlayer.deathMoment's doc comment for why this lives on
    // the player instead of only in the log feed.
    player.deathMoment =
      ctx.state.phase === "NIGHT" ? `Nuit ${ctx.state.nightNumber}` : `Jour ${ctx.state.dayNumber}`;
    actuallyDied.push(player.id);
    ctx.state.lastDeathPlayerIds.push(player.id);
    ctx.log(`${player.nickname} est mort — ${CAUSE_LABELS[next.cause] ?? next.cause}.`);

    // The Chef du village title doesn't die with its holder: he gets one
    // last act — naming a successor — before the game moves on. Blocks
    // progression the same way a pending Chasseur shot does.
    if (player.isChef && [...ctx.state.players.values()].some((p) => p.isAlive)) {
      ctx.state.pendingChefSuccessionDeadChefId = player.id;
      ctx.log(`${player.nickname} était Chef du village et doit désigner un successeur.`);
    }

    const role = ROLE_REGISTRY[player.roleId];
    role.onDeath?.(ctx, player);

    // The one deliberate cross-role exception in this file: a Loup Vert who
    // correctly guessed CHASSEUR permanently holds that death trigger (see
    // engine/LoupVert.ts) even though his own roleId stays "LOUP_VERT" —
    // the real Chasseur lost it for good the moment it was stolen. Without
    // this, his stolen revenge-kill would silently vanish when he dies.
    if (player.roleId === "LOUP_VERT" && player.loupVertHasChasseurPower) {
      ROLE_REGISTRY.CHASSEUR.onDeath?.(ctx, player);
    }

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
        ctx.recordEvent({
          type: "MOWGLI_TRANSFORM",
          night: ctx.state.phase === "NIGHT" ? ctx.state.nightNumber : null,
          actorId: candidate.id,
          fatherId: player.id,
        });
      }
    }
  }

  return actuallyDied;
}
