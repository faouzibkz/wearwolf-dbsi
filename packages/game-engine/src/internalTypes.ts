import type { GameConfig, LogEntry, Phase, RoleId, Team, TieResolutionRule } from "@loupgarou/shared";

/**
 * The FULL, authoritative player record. This never leaves the server
 * process as-is — it is always sanitized down to `PlayerPublic` (shared
 * package) before being sent over a socket, except to the admin who is
 * allowed to see roles.
 */
export interface InternalPlayer {
  id: string;
  nickname: string;
  roleId: RoleId;
  isAlive: boolean;
  isChef: boolean;
  isConnected: boolean;
  isSpectator: boolean;
  joinedAt: number;
  reconnectToken: string;
  deathCause: string | null;

  // --- role-specific persistent state (kept on the player so it survives
  // reconnects and doesn't need a separate lookup table) ---
  sorciereHealUsed: boolean;
  sorcierePoisonUsed: boolean;
  salvateurLastProtectedId: string | null;
  mowgliFatherId: string | null;
  mowgliTransformed: boolean;
  /**
   * Voyante-only: how many times this player (as a Voyante) has inspected
   * each target, keyed by targetId. Needed for the Loup Blanc house rule:
   * his cover holds on a first inspection (shown as villageois) and only
   * breaks on a second inspection of him by the same Voyante.
   */
  voyanteInspectionCounts: Record<string, number>;
}

export interface NightActionSubmitted {
  playerId: string;
  actionType: string;
  targetId?: string;
}

/** Transient scratch space, rebuilt fresh every night. */
export interface NightScratch {
  nightNumber: number;
  salvateurProtectedId: string | null;
  wolfVotes: Record<string, string>;
  wolfTargetId: string | null;
  loupBlancActive: boolean;
  loupBlancTargetId: string | null;
  sorciereHealedTonight: boolean;
  sorcierePoisonedTargetId: string | null;
  sorciereHasActed: boolean;
  voyanteInspections: { voyanteId: string; targetId: string; result: "LOUP" | "NON_LOUP" }[];
  corbeauMarkTargetId: string | null;
  mowgliFatherChosen: boolean;
  submittedActions: Record<string, NightActionSubmitted>; // playerId -> action
  deaths: string[]; // resolved at end of night resolution
}

export interface ChefElectionState {
  candidates: string[]; // ids, in volunteer order
  debateOrder: string[];
  currentSpeakerIndex: number;
  votes: Map<string, string>; // voterId -> candidateId
  electedId: string | null;
}

export interface DayVoteState {
  votes: Map<string, string>; // voterId -> targetId
  round: number;
  tiedIds: string[];
}

export interface GameInternalState {
  code: string;
  config: GameConfig;
  phase: Phase;
  paused: boolean;
  players: Map<string, InternalPlayer>;
  playerOrder: string[];
  nightNumber: number;
  dayNumber: number;
  chef: ChefElectionState;
  dayVote: DayVoteState;
  corbeauMarkedPlayerId: string | null;
  nightScratch: NightScratch | null;
  logs: LogEntry[];
  phaseEndsAt: number | null;
  winner: Team | null;
  lastMorningResult: "DEATH" | "NO_DEATH" | null;
  /**
   * playerIds who died in the current in-progress resolution unit (a night
   * resolution, a day-vote elimination, or a manual tie resolution) —
   * including any chained Chasseur shot. Reset at the start of each unit
   * by GameEngine, appended to by DeathQueue.processDeaths. Sanitized to
   * `RevealedDeath[]` (name + role, no cause) in getPublicState().
   */
  lastDeathPlayerIds: string[];
  mowgliTransformedAnnounced: boolean;
  pendingMowgliReveal: boolean;
  pendingChasseurShooterIds: string[];
  pendingTieResolutionRule: TieResolutionRule | null;
  rolesRevealedToPlayers: boolean;
  createdAt: number;
}

export interface EngineContext {
  state: GameInternalState;
  getPlayer(id: string): InternalPlayer;
  getAlivePlayers(): InternalPlayer[];
  getAliveByRole(roleId: RoleId): InternalPlayer[];
  log(message: string): void;
  queueDeath(playerId: string, cause: string): void;
}
