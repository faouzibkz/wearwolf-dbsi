import type { RoleId } from "@loupgarou/shared";

/**
 * Structured, queryable history of "who did what, with what outcome" —
 * the prerequisite for cahier de charge #2 §17.4 (Performance Score v2,
 * Badges, Leaderboards), all three of which need real per-action data
 * instead of the generic survival+outcome approximation `PerformanceContext`
 * currently uses (see packages/rating/src/performance.ts).
 *
 * Deliberately a flat discriminated union rather than one event class per
 * role: this is DATA, appended to `GameInternalState.eventLog` via
 * `EngineContext.recordEvent()` (mirrors the existing `ctx.log()` pattern)
 * from whichever module first knows the final outcome — see each event's
 * own doc comment below for exactly where it's recorded and why there,
 * specifically. Consumers (Performance Score v2's per-role registry, Badge
 * evaluation) read this generically by `type`/`actorId`, never by branching
 * on which role produced it — same "generic architecture, no hardcoded
 * per-role branching outside registries" principle as FEATURES.md §16.
 *
 * `actorId` is always "the player whose action this event describes" (never
 * a bystander/target-only role) so callers can filter "every event this
 * player caused" with one predicate (`e.actorId === playerId`) regardless
 * of event type — see GameEngine.getPlayerEvents().
 */
export type GameEvent =
  | {
      type: "VOYANTE_INSPECT";
      night: number;
      actorId: string;
      targetId: string;
      targetRoleId: RoleId;
      result: "LOUP" | "NON_LOUP";
    }
  | {
      /** Recorded in NightResolver.resolveNight, once the wolf target for
       * the night is finalized — "saved" can only be known there, not at
       * PROTECT-submission time. */
      type: "SALVATEUR_PROTECT";
      night: number;
      actorId: string;
      targetId: string;
      saved: boolean;
    }
  | {
      /** The heal potion directly negates whatever the wolves' target was
       * this same night, so it's always a "save" by construction whenever
       * it's used at all (the prompt only offers HEAL when there's an
       * attacked target to save — see roles/sorciere.ts). */
      type: "SORCIERE_HEAL";
      night: number;
      actorId: string;
      targetId: string;
    }
  | {
      type: "SORCIERE_POISON";
      night: number;
      actorId: string;
      targetId: string;
      targetRoleId: RoleId;
      killedWolf: boolean;
    }
  | {
      /** One event per night per attack (wolves' collective target, and —
       * separately — the Loup Blanc's own solo target when active), not
       * per-wolf: the kill vote is a single pack decision (see
       * roles/wolfPack.ts), there's no meaningful "which wolf" to credit. */
      type: "WOLF_KILL_ATTEMPT";
      night: number;
      targetId: string;
      landed: boolean;
    }
  | {
      type: "CORBEAU_MARK";
      night: number;
      actorId: string;
      targetId: string;
    }
  | {
      type: "ALIEN_GUESS";
      night: number;
      actorId: string;
      targetId: string;
      guessedRoleId: RoleId;
      correct: boolean;
    }
  | {
      type: "LOUP_VERT_GUESS";
      night: number;
      actorId: string;
      targetId: string;
      guessedRoleId: RoleId;
      correct: boolean;
    }
  | {
      type: "CHASSEUR_SHOT";
      actorId: string;
      targetId: string;
    }
  | {
      type: "BARBIE_REVEAL";
      actorId: string;
      targetId: string;
      targetRoleId: RoleId;
      outcome: "WOLF_DIED_BARBIE_CHEF" | "BOTH_DIED";
    }
  | {
      /** Every individual vote cast, every round — "qui a voté pour qui à
       * chaque tour" per FEATURES.md §8's own description of what this
       * journal needs to carry. */
      type: "DAY_VOTE_CAST";
      day: number;
      round: number;
      actorId: string;
      targetId: string;
    }
  | {
      /** No `actorId` — an elimination is a collective village decision,
       * not any one player's action. */
      type: "DAY_VOTE_ELIMINATION";
      day: number;
      round: number;
      targetId: string;
    };

export type GameEventType = GameEvent["type"];
