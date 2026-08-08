import type { RoleId } from "@loupgarou/shared";
import { DEFAULT_NIGHT_STEP_DURATIONS, DEFAULT_NIGHT_STEP_DURATION_SECONDS } from "@loupgarou/shared";
import type { EngineContext } from "../internalTypes";
import { ROLE_REGISTRY } from "../roles/registry";
import { getActiveNightRoles } from "./NightResolver";

/**
 * Cahier de charge #2, §17.1 — SEQUENTIAL night mode only (see
 * GameConfig.nightMode; SIMULTANEOUS mode never touches this file).
 *
 * Pure, stateless helpers for turning "which roles are active tonight"
 * (already correctly computed by NightResolver.getActiveNightRoles —
 * dependency-ordered, first-night-vs-every-night aware, role-presence
 * aware) into an ordered list of discrete STEPS for the admin-configured
 * sequential flow. GameEngine owns the actual step-index state
 * (nightScratch.sequentialSteps/sequentialStepIndex); everything here is a
 * pure function of an EngineContext, fully unit-testable without an engine
 * instance — same split as NightResolver.ts.
 *
 * A "step" is `RoleId[]`, not a single RoleId, because some roles share a
 * single collective decision rather than acting independently: the regular
 * Loup-Garou pack and the Loup Blanc both feed the exact same
 * `nightScratch.wolfVotes` (see roles/wolfPack.ts) and are both declared
 * with the identical nightPriority (30) specifically so they're recognized
 * as "the same vote" — see loupBlanc.ts's and loupVert.ts's own doc
 * comments ("same priority as the regular wolves' vote"). Grouping by
 * identical nightPriority turns that existing convention into the
 * sequencer's step boundaries automatically, with no per-role branching.
 *
 * Scope note (v1): Loup Vert's SECOND power (guess/steal — engine/
 * LoupVert.ts) is deliberately NOT given its own sequence step here. It
 * stays exactly as architected today: available via its own always-open
 * side channel (LOUP_VERT_GUESS_PROMPT/SUBMIT), independent of whichever
 * step is currently active, in both SIMULTANEOUS and SEQUENTIAL mode. This
 * was a deliberate simplification to ship a smaller, fully-correct v1
 * rather than invent a synthetic non-RoleModule step type under time
 * pressure — see FEATURES.md §17.1 for the full reasoning. Nothing about
 * this blocks adding a dedicated "Green Wolf" step later.
 */

/** Computes tonight's step order: getActiveNightRoles(), grouped by identical nightPriority, filtered by config.nightStepDisabled, reordered by config.nightStepOrder if set. */
export function computeNightSteps(ctx: EngineContext, nightNumber: number): RoleId[][] {
  const disabled = new Set(ctx.state.config.nightStepDisabled);
  const activeRoles = getActiveNightRoles(ctx, nightNumber).filter((role) => !disabled.has(role.id));

  const groups: RoleId[][] = [];
  for (const role of activeRoles) {
    const lastGroup = groups[groups.length - 1];
    const lastPriority = lastGroup ? ROLE_REGISTRY[lastGroup[0]!].nightPriority : null;
    if (lastGroup && lastPriority === role.nightPriority) {
      lastGroup.push(role.id);
    } else {
      groups.push([role.id]);
    }
  }

  const override = ctx.state.config.nightStepOrder;
  if (!override || override.length === 0) return groups;

  // Any group containing at least one role mentioned in the override is
  // sorted by that role's position in it (the lowest, if it has several);
  // groups that mention nothing in the override keep their original
  // relative order and sort after every explicitly-ordered group (stable
  // sort — see the doc comment above computeNightSteps's export for why
  // "unmentioned roles keep their default order, appended at the end" is
  // the documented, predictable semantics rather than an implementation
  // accident).
  const overrideIndex = (group: RoleId[]): number => {
    const indices = group.map((id) => override.indexOf(id)).filter((i) => i !== -1);
    return indices.length > 0 ? Math.min(...indices) : Number.MAX_SAFE_INTEGER;
  };
  return [...groups].sort((a, b) => overrideIndex(a) - overrideIndex(b));
}

/** Longest configured duration among a step's role ids — never cut a role's configured time short just because it shares a step with another role. */
export function stepDurationSeconds(ctx: EngineContext, roleIds: RoleId[]): number {
  const durations = roleIds.map(
    (id) =>
      ctx.state.config.nightStepDurations[id] ??
      DEFAULT_NIGHT_STEP_DURATIONS[id] ??
      DEFAULT_NIGHT_STEP_DURATION_SECONDS,
  );
  return Math.max(...durations);
}

/**
 * True once every alive holder of every role in this step's group has an
 * entry in nightScratch.submittedActions for tonight. A step with nobody
 * alive holding any of its roles (shouldn't normally happen — disabled/
 * absent roles are filtered out of computeNightSteps already — but stays
 * defensively correct) is vacuously complete.
 */
export function isStepComplete(ctx: EngineContext, roleIds: RoleId[]): boolean {
  const scratch = ctx.state.nightScratch;
  for (const roleId of roleIds) {
    for (const holder of ctx.getAliveByRole(roleId)) {
      if (!scratch?.submittedActions[holder.id]) return false;
    }
  }
  return true;
}
