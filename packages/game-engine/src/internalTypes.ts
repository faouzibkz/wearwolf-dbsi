import type { GameConfig, LogEntry, Phase, RoleId, Team } from "@loupgarou/shared";
import type { GameEvent } from "./events";

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
  /**
   * Human-readable "Nuit N" / "Jour N" moment of death (same label format as
   * the admin log — see DeathQueue.processDeaths), or null while alive.
   * Exists purely so the account/history layer (apps/server) can persist a
   * displayable death moment per player without reaching into engine
   * internals — it never drives any game logic itself.
   */
  deathMoment: string | null;

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

  // --- Loup Vert (see engine/LoupVert.ts for the full mechanic) ---
  /** Which night (if any) he last attempted a guess — caps him at one attempt per night, from night 2 on. */
  loupVertLastGuessNight: number | null;
  /** True once he's correctly guessed CHASSEUR — permanent until he steals a different role (see LoupVert.ts). */
  loupVertHasChasseurPower: boolean;
  /** The role whose power he's currently borrowing for ONE night only (null if none, or if it was CHASSEUR — that's tracked separately above since it's permanent). */
  loupVertStolenPowerRoleId: RoleId | null;
  /** The villager he stole `loupVertStolenPowerRoleId` from — his per-player state (potions used, etc.) is what actually drives the borrowed prompt/action. */
  loupVertStolenPowerSourcePlayerId: string | null;
  /** Which night `loupVertStolenPowerRoleId` was granted — it's only usable THAT SAME night; compared against the current night to auto-expire it. */
  loupVertStolenPowerGrantedNight: number | null;
  /** Has he already used tonight's borrowed power? (Prevents reusing it if somehow prompted twice.) */
  loupVertStolenPowerUsedTonight: boolean;

  // --- Barbie (see engine/Barbie.ts) ---
  /** One-shot power, once per game. */
  barbiePowerUsed: boolean;

  // --- Alien (see engine/Alien.ts) ---
  /** Wrong guesses remaining against VILLAGE-team roles before he dies (starts at 2). */
  alienVillageChancesLeft: number;
  /** Wrong guesses remaining against LOUPS-team roles before he dies (starts at 1). */
  alienWolfChancesLeft: number;
  /** Private feedback for his own client after his most-recent guess this connection — consumed once read, never broadcast. */
  alienLastGuessResult: "CORRECT" | "WRONG" | null;

  // --- Prêtre (see roles/pretre.ts) ---
  /** One-shot power, once per game — but unlike Barbie's, usable from night 1 and any night after, at the holder's own discretion. */
  pretreShotUsed: boolean;
}

export interface NightActionSubmitted {
  playerId: string;
  actionType: string;
  targetId?: string;
  /** Only used by the Alien's "ALIEN_GUESS" action — which role he's claiming targetId holds. */
  guessedRoleId?: RoleId;
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
  /**
   * True only for the one night this was triggered via
   * GameEngine.triggerAlienNightfall (the Alien cutting a day discussion
   * short) — false for every ordinary night, including night 1. Read by
   * roles/alien.ts to make the guess mandatory on a forced night: skipping
   * a debate to reach night early only makes sense if it's spent doing
   * something, otherwise it's a strictly-dominant free action.
   */
  alienForcedNightfall: boolean;
  /**
   * SEQUENTIAL night mode only (GameConfig.nightMode) — see
   * engine/NightSequencer.ts. Computed once, at the start of this specific
   * night, by GameEngine.startNight(); always empty in SIMULTANEOUS mode
   * (nothing in that path ever reads these two fields).
   */
  sequentialSteps: RoleId[][];
  sequentialStepIndex: number;
}

export interface ChefElectionState {
  candidates: string[]; // ids, in volunteer order
  debateOrder: string[];
  currentSpeakerIndex: number;
  votes: Map<string, string>; // voterId -> candidateId
  electedId: string | null;
}

/**
 * Today's speaking order for DAY_1_DISCUSSION / DAY_DISCUSSION: the Chef
 * first and last, everyone else once in between, freshly shuffled each
 * day. Null whenever neither of those two phases is active. See
 * engine/DayDiscussion.ts and engine/SpeakerQueue.ts.
 */
export interface DayDiscussionState {
  order: string[];
  currentSpeakerIndex: number;
}

/**
 * TIE_DEFENSE's speaking order: a fresh random shuffle of the tied
 * players every time a tie opens, one turn each (no repeats). Same shape
 * as DayDiscussionState — see engine/TieDefense.ts and engine/SpeakerQueue.ts.
 * Null whenever TIE_DEFENSE isn't active.
 */
export interface TieDefenseState {
  order: string[];
  currentSpeakerIndex: number;
}

/**
 * DAY_VOTE's per-player voting turn order — same shape/mechanic as the
 * other speaker queues, but each "turn" ends either when that player
 * casts their vote (immediate advance) or their per-player timer expires
 * (skipped, no vote recorded). Built fresh every time DAY_VOTE is (re)entered
 * — see engine/DayVoteQueue.ts. Null whenever DAY_VOTE isn't active.
 */
export interface DayVoteQueueState {
  order: string[];
  currentSpeakerIndex: number;
}

/**
 * CHEF_SECOND_DEBATE's bonus speaker queue — same shape/mechanic as the
 * other speaker queues, but only built once the Chef has actually chosen
 * who (if anyone) gets a bonus turn. Null while CHEF_SECOND_DEBATE is
 * active but the Chef hasn't chosen yet (see GameStatePublic.secondDebateChoicePending),
 * and also null whenever CHEF_SECOND_DEBATE isn't the current phase. See
 * engine/SecondDebate.ts.
 */
export interface SecondDebateState {
  order: string[];
  currentSpeakerIndex: number;
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
  /**
   * Snapshot of "how much time was left" the moment pause() was called, so
   * resume() can hand back exactly that much time instead of either
   * silently continuing to count down invisible pause-time against the
   * player, or granting a full fresh duration. Null whenever not paused
   * (or the current phase has no timer at all).
   */
  pausedRemainingMs: number | null;
  /**
   * 18 août 2026 (§27) — set to a playerId exactly when pauseForDisconnect()
   * is the reason `paused` is currently true, so resumeFromDisconnect() can
   * tell "we froze this for a disconnected required-actor, safe to
   * auto-resume" apart from "the admin paused this on purpose, leave it
   * alone" (see GameEngine.pauseForDisconnect's doc comment). Null whenever
   * not auto-paused for this reason.
   */
  disconnectPausedPlayerId: string | null;
  players: Map<string, InternalPlayer>;
  playerOrder: string[];
  nightNumber: number;
  dayNumber: number;
  chef: ChefElectionState;
  dayDiscussion: DayDiscussionState | null;
  tieDefense: TieDefenseState | null;
  dayVoteQueue: DayVoteQueueState | null;
  secondDebateQueue: SecondDebateState | null;
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
  /**
   * Set the moment the elected Chef du village dies (any cause). Phase
   * progression is blocked (same pattern as pendingChasseurShooterIds)
   * until the now-dead ex-Chef designates a successor via
   * GameEngine.chooseChefSuccessor(). Null when no succession is pending.
   */
  pendingChefSuccessionDeadChefId: string | null;
  rolesRevealedToPlayers: boolean;
  /** One-shot latch for GameEngine.consumeGameEndedNotification() — see that method's doc comment. */
  gameEndedNotified: boolean;
  createdAt: number;
  /**
   * Structured, append-only history of "who did what, with what outcome" —
   * see events.ts's GameEvent for the full union and why each variant is
   * recorded where it is. Never rewritten, only pushed to (via
   * EngineContext.recordEvent), and — being a plain array of plain objects —
   * needs no special handling in GameEngine.serialize()/deserialize(),
   * unlike the Map-backed fields above.
   */
  eventLog: GameEvent[];
}

export interface EngineContext {
  state: GameInternalState;
  getPlayer(id: string): InternalPlayer;
  getAlivePlayers(): InternalPlayer[];
  getAliveByRole(roleId: RoleId): InternalPlayer[];
  log(message: string): void;
  queueDeath(playerId: string, cause: string): void;
  /** Appends one structured event to GameInternalState.eventLog — see events.ts. */
  recordEvent(event: GameEvent): void;
}
