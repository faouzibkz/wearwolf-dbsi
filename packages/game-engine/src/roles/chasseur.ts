import type { RoleModule } from "./Role";

/**
 * Chasseur has no night action. Its power is death-triggered: the engine
 * calls `onDeath`, which registers the player in
 * `state.pendingChasseurShooterIds`. Phase progression is blocked by
 * GameEngine while that list is non-empty; the shot itself is submitted via
 * GameEngine.submitChasseurShot(...) once the player (or admin, if
 * disconnected) picks a target.
 */
export const chasseurRole: RoleModule = {
  id: "CHASSEUR",
  team: "VILLAGE",
  nightPriority: 0,

  isActiveOnNight: () => false,

  onDeath(ctx, player) {
    if (!ctx.state.pendingChasseurShooterIds.includes(player.id)) {
      ctx.state.pendingChasseurShooterIds.push(player.id);
      ctx.log(`${player.nickname} (Chasseur) va choisir qui emporter avec lui.`);
    }
  },
};
