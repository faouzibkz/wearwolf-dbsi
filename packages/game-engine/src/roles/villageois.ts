import type { RoleModule } from "./Role";

export const villageoisRole: RoleModule = {
  id: "VILLAGEOIS",
  team: "VILLAGE",
  nightPriority: 0,
  isActiveOnNight: () => false,
};
