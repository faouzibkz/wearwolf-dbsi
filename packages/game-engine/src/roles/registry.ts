import type { RoleId } from "@loupgarou/shared";
import type { RoleModule } from "./Role";
import { villageoisRole } from "./villageois";
import { loupGarouRole } from "./loupGarou";
import { loupBlancRole } from "./loupBlanc";
import { sorciereRole } from "./sorciere";
import { voyanteRole } from "./voyante";
import { salvateurRole } from "./salvateur";
import { chasseurRole } from "./chasseur";
import { corbeauRole } from "./corbeau";
import { mowgliRole } from "./mowgli";

/**
 * Single registration point for every role module. This is the ONLY file
 * (besides the role's own module) that needs to change to add a new role.
 */
export const ROLE_REGISTRY: Record<RoleId, RoleModule> = {
  VILLAGEOIS: villageoisRole,
  LOUP_GAROU: loupGarouRole,
  LOUP_BLANC: loupBlancRole,
  SORCIERE: sorciereRole,
  VOYANTE: voyanteRole,
  SALVATEUR: salvateurRole,
  CHASSEUR: chasseurRole,
  CORBEAU: corbeauRole,
  MOWGLI: mowgliRole,
};

export function getRolesByNightPriority(): RoleModule[] {
  return Object.values(ROLE_REGISTRY).sort((a, b) => a.nightPriority - b.nightPriority);
}
