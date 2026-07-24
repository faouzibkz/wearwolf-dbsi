import type { RoleId, Team } from "@loupgarou/shared";
import type { EngineContext, InternalPlayer, NightActionSubmitted } from "../internalTypes";

export interface NightActionRequest {
  actionType: string;
  eligibleTargetIds: string[];
  context?: Record<string, unknown>;
}

/**
 * Extension point: every role in the game implements this interface and is
 * registered in `roles/registry.ts`. The core engine (GameEngine +
 * NightResolver) never has role-specific `if (roleId === ...)` branches —
 * it only ever calls through this interface. Adding a new role means:
 *   1. Add its id to ROLE_IDS in packages/shared/src/types.ts
 *   2. Implement RoleModule below in a new file
 *   3. Register it in registry.ts
 * No other file needs to change.
 */
export interface RoleModule {
  id: RoleId;
  team: Team;
  /** Night resolution order — lower numbers resolve first. */
  nightPriority: number;

  /** Whether a player with this role acts on the given night at all. */
  isActiveOnNight(ctx: EngineContext, nightNumber: number): boolean;

  /**
   * Build the action prompt sent to a specific player holding this role.
   * Return null if this player has nothing to do tonight (e.g. Sorcière
   * with both potions already used and no attack to react to).
   */
  buildNightPrompt?(ctx: EngineContext, player: InternalPlayer): NightActionRequest | null;

  /** Record a submitted action into the night scratch state. */
  applyNightAction?(ctx: EngineContext, actor: InternalPlayer, action: NightActionSubmitted): void;

  /** Finalize this role's effect once all its actions are in (or timed out). */
  resolve?(ctx: EngineContext): void;

  /** Death-triggered power, e.g. Chasseur. */
  onDeath?(ctx: EngineContext, player: InternalPlayer): void;
}
