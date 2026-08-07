import type { RoleModule } from "./Role";

/**
 * Barbie has no night action at all — her one power is a day-discussion
 * reveal, usable once per game (see engine/Barbie.ts for the full
 * mechanic: GameEngine.useBarbiePower()). This module exists only so she
 * has a normal RoleModule entry (team, registry lookup, role-encyclopedia
 * metadata); NightResolver never has anything to do with her.
 */
export const barbieRole: RoleModule = {
  id: "BARBIE",
  team: "VILLAGE",
  nightPriority: 0,
  isActiveOnNight: () => false,
};
