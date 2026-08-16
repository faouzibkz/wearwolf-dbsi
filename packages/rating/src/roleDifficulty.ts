import type { RoleId } from "@loupgarou/shared";

/**
 * Default per-role difficulty coefficients (cahier de charge section 7).
 *
 * "Aucune valeur ne doit être codée en dur" is satisfied two ways: (1) this
 * is the ONLY place a per-role number appears — nothing in rating.ts or
 * performance.ts ever branches on a specific roleId — and (2) apps/server
 * seeds a `RoleDifficulty` database table from this object at first use, so
 * an admin can retune any coefficient at runtime without a redeploy (see
 * apps/server/src/rating/applyRating.ts). This object is only the fallback
 * used when a role has no row in that table yet — which is also what makes
 * a brand new role "just work" at a neutral coefficient the moment it's
 * added, without touching this file, per section 16.
 *
 * Values below are a deliberately reasonable starting point, not a claim of
 * correctness — loosely mapped onto the spec's own illustrative table
 * (Villageois 1.0, Loup 1.0, Sorcière 1.15, Voyante 1.20, harder/rarer roles
 * higher) applied to the roles that actually exist in this game (see
 * packages/shared's ROLE_IDS), since the spec's own examples (Renard,
 * Pyromane) don't exist here. Intended to be tuned by playtesting, not
 * treated as final.
 */
export const DEFAULT_ROLE_DIFFICULTY: Partial<Record<RoleId, number>> = {
  VILLAGEOIS: 1.0,
  LOUP_GAROU: 1.0,
  LOUP_BLANC: 1.1,
  LOUP_VERT: 1.25,
  SORCIERE: 1.15,
  VOYANTE: 1.2,
  SALVATEUR: 1.1,
  CHASSEUR: 1.1,
  CORBEAU: 1.15,
  MOWGLI: 1.2,
  BARBIE: 1.3,
  ALIEN: 1.35,
  PRETRE: 1.2,
};

/** Neutral coefficient used for any role with no explicit entry (see doc comment above). */
export const NEUTRAL_ROLE_DIFFICULTY = 1.0;

/**
 * `overrides` is meant to be whatever apps/server loaded from its
 * RoleDifficulty table (empty object if nothing's been configured yet) —
 * this function itself has no idea a database exists.
 */
export function getRoleDifficulty(roleId: RoleId, overrides: Partial<Record<RoleId, number>> = {}): number {
  return overrides[roleId] ?? DEFAULT_ROLE_DIFFICULTY[roleId] ?? NEUTRAL_ROLE_DIFFICULTY;
}
