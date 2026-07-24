/**
 * Core domain types shared between the game engine, the realtime server and
 * the web client. Keeping these in one place means the client and server
 * can never disagree about the shape of an event or the set of valid roles.
 *
 * IMPORTANT: nothing in this file describes *hidden* information (who has
 * which role, what a player voted, etc). Those payloads are defined
 * separately in `events.ts` with explicit Public/Admin/Private variants so
 * it's obvious at the type level which data is safe to broadcast.
 */

/** The roles the server can randomly assign at game start. */
export const ROLE_IDS = [
  "VILLAGEOIS",
  "LOUP_GAROU",
  "LOUP_BLANC",
  "SORCIERE",
  "VOYANTE",
  "SALVATEUR",
  "CHASSEUR",
  "CORBEAU",
  "MOWGLI",
] as const;

export type RoleId = (typeof ROLE_IDS)[number];

/**
 * "Chef du village" is intentionally NOT part of ROLE_IDS: it is an elected
 * title layered on top of a player's real role, never randomly assigned.
 */
export const CHEF_TITLE = "CHEF_DU_VILLAGE" as const;

export type Team = "VILLAGE" | "LOUPS";

/** Every phase the game state machine can be in. */
export const PHASES = [
  "LOBBY",
  "CHEF_CANDIDACY",
  "CHEF_DEBATE",
  "CHEF_VOTE",
  "DAY_1_DISCUSSION",
  "NIGHT",
  "MORNING",
  "DAY_DISCUSSION",
  "DAY_VOTE",
  "TIE_DEFENSE",
  "TIE_REVOTE",
  "ENDED",
] as const;

export type Phase = (typeof PHASES)[number];

export type LoupBlancRule =
  | { mode: "EVERY_NIGHT" }
  | { mode: "EVERY_SECOND_NIGHT" }
  | { mode: "SPECIFIC_NIGHTS"; nights: number[] };

export type TieResolutionRule =
  | "REPEAT_DEFENSE"
  | "NO_ELIMINATION"
  | "CHEF_DECIDES"
  | "ADMIN_DECIDES"
  | "RANDOM";

export interface TimerConfig {
  /** seconds */
  chefDebate: number;
  chefVote: number;
  day1Discussion: number;
  dayDiscussion: number;
  night: number;
  tieDefense: number;
  dayVote: number;
}

export const DEFAULT_TIMERS: TimerConfig = {
  chefDebate: 120,
  chefVote: 45,
  day1Discussion: 300,
  dayDiscussion: 240,
  night: 90,
  tieDefense: 120,
  dayVote: 45,
};

export interface GameConfig {
  /** total number of players expected (informational; lobby can flex) */
  numPlayers: number;
  /** how many of each role to assign; remaining players become VILLAGEOIS */
  roleCounts: Partial<Record<RoleId, number>>;
  timers: TimerConfig;
  loupBlancRule: LoupBlancRule;
  tieResolutionRule: TieResolutionRule;
  /** once alive player count is <= this, the Chef's vote bonus is disabled */
  chefVoteBonusThreshold: number;
  /** progression between phases: admin clicks "next" vs automatic on timer expiry */
  autoProgress: boolean;
  /** display name for the game / preset name */
  name: string;
}

export const DEFAULT_GAME_CONFIG: GameConfig = {
  numPlayers: 14,
  roleCounts: {
    LOUP_GAROU: 3,
    LOUP_BLANC: 1,
    VOYANTE: 1,
    SORCIERE: 1,
    SALVATEUR: 1,
    CHASSEUR: 1,
    CORBEAU: 1,
    MOWGLI: 1,
  },
  timers: DEFAULT_TIMERS,
  loupBlancRule: { mode: "EVERY_SECOND_NIGHT" },
  tieResolutionRule: "REPEAT_DEFENSE",
  chefVoteBonusThreshold: 6,
  autoProgress: false,
  name: "Partie sans nom",
};

export interface RoleDefinitionMeta {
  id: RoleId;
  displayName: string;
  team: Team;
  shortDescription: string;
  hasNightAction: boolean;
  hasDeathTrigger: boolean;
}

/** French display metadata for the role encyclopedia + role cards. */
export const ROLE_METADATA: Record<RoleId, RoleDefinitionMeta> = {
  VILLAGEOIS: {
    id: "VILLAGEOIS",
    displayName: "Villageois",
    team: "VILLAGE",
    shortDescription:
      "Un habitant du village sans pouvoir particulier. Sa seule arme est la parole et le vote.",
    hasNightAction: false,
    hasDeathTrigger: false,
  },
  LOUP_GAROU: {
    id: "LOUP_GAROU",
    displayName: "Loup-garou",
    team: "LOUPS",
    shortDescription:
      "Se réveille chaque nuit avec les autres loups pour désigner une victime.",
    hasNightAction: true,
    hasDeathTrigger: false,
  },
  LOUP_BLANC: {
    id: "LOUP_BLANC",
    displayName: "Loup blanc",
    team: "LOUPS",
    shortDescription:
      "Un loup solitaire qui, selon la configuration, peut dévorer un loup-garou certaines nuits.",
    hasNightAction: true,
    hasDeathTrigger: false,
  },
  SORCIERE: {
    id: "SORCIERE",
    displayName: "Sorcière",
    team: "VILLAGE",
    shortDescription:
      "Possède une potion de guérison et une potion de poison, chacune utilisable une fois par partie.",
    hasNightAction: true,
    hasDeathTrigger: false,
  },
  VOYANTE: {
    id: "VOYANTE",
    displayName: "Voyante",
    team: "VILLAGE",
    shortDescription: "Chaque nuit, découvre en secret le camp d'un joueur.",
    hasNightAction: true,
    hasDeathTrigger: false,
  },
  SALVATEUR: {
    id: "SALVATEUR",
    displayName: "Salvateur",
    team: "VILLAGE",
    shortDescription:
      "Protège un joueur chaque nuit contre l'attaque des loups (jamais deux nuits de suite le même).",
    hasNightAction: true,
    hasDeathTrigger: false,
  },
  CHASSEUR: {
    id: "CHASSEUR",
    displayName: "Chasseur",
    team: "VILLAGE",
    shortDescription:
      "S'il meurt, il emporte immédiatement un autre joueur de son choix dans la tombe.",
    hasNightAction: false,
    hasDeathTrigger: true,
  },
  CORBEAU: {
    id: "CORBEAU",
    displayName: "Corbeau",
    team: "VILLAGE",
    shortDescription:
      "Désigne chaque nuit un joueur qui recevra deux votes supplémentaires le lendemain.",
    hasNightAction: true,
    hasDeathTrigger: false,
  },
  MOWGLI: {
    id: "MOWGLI",
    displayName: "Mowgli",
    team: "VILLAGE",
    shortDescription:
      "Villageois qui choisit un « père » la première nuit. Si ce père meurt, Mowgli devient loup-garou.",
    hasNightAction: true,
    hasDeathTrigger: false,
  },
};

export interface PlayerPublic {
  id: string;
  nickname: string;
  isAlive: boolean;
  isChef: boolean;
  isConnected: boolean;
  isSpectator: boolean;
  /**
   * A dead player's role becomes public knowledge (standard Loup-Garou
   * rule) — this is only ever set once `isAlive` is false. Living players'
   * roles never appear here or anywhere else in the public state.
   */
  revealedRoleId?: RoleId;
}

/**
 * Announces who just died and their role, WITHOUT revealing the mechanism
 * (no cause/attacker/protector info) — that stays admin-only. Populated
 * fresh on every night resolution, day-vote elimination, and Chasseur
 * shot; empty when nobody died.
 */
export interface RevealedDeath {
  playerId: string;
  nickname: string;
  roleId: RoleId;
}

/** Only ever sent to the admin, or to a player about themself. */
export interface PlayerPrivateRole {
  playerId: string;
  roleId: RoleId;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  dayOrNight: string; // e.g. "Nuit 2", "Jour 3"
  message: string;
}

export interface GameStatePublic {
  code: string;
  phase: Phase;
  paused: boolean;
  nightNumber: number;
  dayNumber: number;
  players: PlayerPublic[];
  chefId: string | null;
  candidates: string[];
  currentSpeakerId: string | null;
  phaseEndsAt: number | null; // epoch ms, null if no active timer
  tiedPlayerIds: string[];
  lastMorningAnnouncement: "DEATH" | "NO_DEATH" | null;
  /** Who died in the most recently resolved event (night / day vote / Chasseur shot), with role. */
  lastDeaths: RevealedDeath[];
  mowgliTransformedAnnounced: boolean;
  winner: Team | null;
}

export interface EndGameStats {
  winner: Team;
  roleReveal: { playerId: string; nickname: string; roleId: RoleId; isAlive: boolean }[];
  totalNights: number;
  totalDays: number;
  chefHistory: string[];
}
