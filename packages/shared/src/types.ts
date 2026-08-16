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
  "LOUP_VERT",
  "SORCIERE",
  "VOYANTE",
  "SALVATEUR",
  "CHASSEUR",
  "CORBEAU",
  "MOWGLI",
  "BARBIE",
  "ALIEN",
  "PRETRE",
] as const;

export type RoleId = (typeof ROLE_IDS)[number];

/**
 * "Chef du village" is intentionally NOT part of ROLE_IDS: it is an elected
 * title layered on top of a player's real role, never randomly assigned.
 */
export const CHEF_TITLE = "CHEF_DU_VILLAGE" as const;

/**
 * "SOLO" is the Alien's team: he plays against both Village and Loups and
 * never appears as a `winner` (see VictoryConditions.ts — he's deliberately
 * excluded from both the wolf-parity and all-wolves-dead counts, so his
 * presence never changes who wins between the other two teams). It only
 * shows up here for descriptive purposes (role card badge, etc).
 */
export type Team = "VILLAGE" | "LOUPS" | "SOLO";

/**
 * Every phase the game state machine can be in.
 *
 * CHEF_REVEAL and DAY_VOTE_RESULT are short, non-interactive "announcement"
 * pauses (same idea as MORNING) inserted so a fully-automatic game gives
 * the table a moment to actually read what just happened — who's Chef, who
 * got eliminated — before the clock starts on the next thing. Each has its
 * own timer (see TimerConfig) so the pause never eats into anyone's real
 * speaking/voting time.
 */
export const PHASES = [
  "LOBBY",
  "CHEF_CANDIDACY",
  "CHEF_DEBATE",
  "CHEF_VOTE",
  "CHEF_REVEAL",
  "DAY_1_DISCUSSION",
  "NIGHT",
  "MORNING",
  "DAY_DISCUSSION",
  /**
   * Optional bonus round the Chef alone can trigger, right after the normal
   * discussion order finishes (including his own closing word) and before
   * the day vote opens: he may hand up to `secondDebateSlots` chosen
   * players one more speaking turn each. He can also pick nobody, in which
   * case this phase is a no-op pass-through straight to DAY_VOTE. See
   * engine/SecondDebate.ts.
   */
  "CHEF_SECOND_DEBATE",
  "DAY_VOTE",
  "DAY_VOTE_RESULT",
  "TIE_DEFENSE",
  "ENDED",
] as const;

export type Phase = (typeof PHASES)[number];

export type LoupBlancRule =
  | { mode: "EVERY_NIGHT" }
  | { mode: "EVERY_SECOND_NIGHT" }
  | { mode: "SPECIFIC_NIGHTS"; nights: number[] };

export interface TimerConfig {
  /** seconds */
  chefDebate: number;
  chefVote: number;
  day1Discussion: number;
  dayDiscussion: number;
  night: number;
  tieDefense: number;
  /** Per voter (the day vote is a per-player turn queue, not simultaneous — see DayVoteQueue.ts), not for the whole phase. */
  dayVote: number;
  /** How long CHEF_CANDIDACY waits for volunteers before auto-picking a random Chef. */
  chefCandidacy: number;
  /** "X est élu(e) Chef" announcement pause before Day 1 discussion starts. */
  chefReveal: number;
  /** "quelqu'un est mort / personne n'est mort" announcement pause (the MORNING phase). */
  morningReveal: number;
  /** "X a été éliminé(e) / personne n'a été éliminé(e)" announcement pause after a day vote. */
  dayVoteResult: number;
  /** Safety-net deadline for a pending Chasseur shot before a random target is auto-picked. */
  chasseurShot: number;
  /** Safety-net deadline for a pending Chef succession before a random successor is auto-picked. */
  chefSuccession: number;
  /**
   * Safety-net deadline for the post-game MVP vote (see
   * apps/server/src/mvp/mvpVotingRegistry.ts): if every eligible player
   * votes before this elapses, the vote finalizes immediately and this
   * never fires (same "whoever's earliest wins" pattern as every other
   * timer here). If it elapses first — nobody voted, or only some did —
   * the vote force-finalizes with whatever ballots are in, exactly as if
   * an admin had clicked the manual override. 0 (or negative) disables the
   * safety net entirely: voting then waits forever for everyone, or an
   * admin's manual force-finalize, like it always used to.
   */
  mvpVote: number;
}

/**
 * CHEF_SECOND_DEBATE (the Chef's optional bonus-turn round) deliberately
 * reuses `TimerConfig.dayDiscussion` for both the Chef's initial "who gets
 * a bonus turn" choice window and each chosen player's actual bonus turn —
 * not a separate timer config, so there's one fewer number to tune and it
 * stays proportional to however long a normal turn already is.
 */

export const DEFAULT_TIMERS: TimerConfig = {
  chefDebate: 120,
  chefVote: 45,
  day1Discussion: 300,
  dayDiscussion: 240,
  night: 90,
  // Per tied player (a defense speech isn't as long as a full debate turn),
  // now that TIE_DEFENSE has its own randomly-ordered speaker queue.
  tieDefense: 60,
  dayVote: 10, // per voter, not the whole phase — see the TimerConfig.dayVote comment
  chefCandidacy: 45,
  chefReveal: 5,
  morningReveal: 7,
  dayVoteResult: 6,
  chasseurShot: 30,
  chefSuccession: 30,
  mvpVote: 120,
};

/**
 * Cahier de charge #2, section 17.1: how a night's active roles get
 * prompted. "SIMULTANEOUS" (default) is the original, unchanged behavior —
 * every active night role is prompted at once, one flat `TimerConfig.night`
 * deadline for the whole night; nothing about this path changes.
 * "SEQUENTIAL" is a new, purely opt-in alternative: roles act one at a
 * time, in order, each with its own deadline — see
 * `packages/game-engine`'s `NightSequencer` for the engine side and
 * `apps/server/src/socket/timers.ts` for the per-step timer. Chosen by the
 * admin at game creation; existing games/configs default to
 * "SIMULTANEOUS" and are entirely unaffected.
 */
export type NightMode = "SIMULTANEOUS" | "SEQUENTIAL";

/** Fallback duration (seconds) for a SEQUENTIAL role with no explicit entry in `GameConfig.nightStepDurations`. */
export const DEFAULT_NIGHT_STEP_DURATION_SECONDS = 20;

/**
 * Suggested per-role SEQUENTIAL durations, loosely following the cahier de
 * charge's own examples. Purely a starting point for
 * `GameConfig.nightStepDurations` (the admin config screen pre-fills from
 * this, then can override per role) — NOT what decides step *order*, which
 * comes from `packages/game-engine`'s own `nightPriority` unless
 * `GameConfig.nightStepOrder` overrides it. Roles absent here fall back to
 * `DEFAULT_NIGHT_STEP_DURATION_SECONDS`.
 */
export const DEFAULT_NIGHT_STEP_DURATIONS: Partial<Record<RoleId, number>> = {
  MOWGLI: 15,
  SALVATEUR: 15,
  PRETRE: 20,
  ALIEN: 20,
  VOYANTE: 15,
  LOUP_GAROU: 30,
  LOUP_BLANC: 30,
  LOUP_VERT: 30,
  SORCIERE: 20,
  CORBEAU: 15,
};

export interface GameConfig {
  /** total number of players expected (informational; lobby can flex) */
  numPlayers: number;
  /** how many of each role to assign; remaining players become VILLAGEOIS */
  roleCounts: Partial<Record<RoleId, number>>;
  timers: TimerConfig;
  loupBlancRule: LoupBlancRule;
  /** once alive player count is <= this, the Chef's vote bonus is disabled */
  chefVoteBonusThreshold: number;
  /**
   * Max number of players the Chef may grant a bonus speaking turn during
   * CHEF_SECOND_DEBATE, right after the normal discussion order finishes.
   * He can always choose fewer (including zero). Tune this up for bigger
   * tables, down for smaller ones. See engine/SecondDebate.ts.
   */
  secondDebateSlots: number;
  /** progression between phases: admin clicks "next" vs automatic on timer expiry */
  autoProgress: boolean;
  /**
   * Global on/off switch for ambient sound cues (night howl, morning
   * rooster, death bell, victory fanfare), applied to every player at
   * once. Unlike the rest of GameConfig this can be toggled anytime, not
   * just from the LOBBY — see GameEngine.setSoundEffectsEnabled().
   */
  soundEffectsEnabled: boolean;
  /** display name for the game / preset name */
  name: string;
  /** See NightMode's doc comment. Default "SIMULTANEOUS" (today's behavior, unchanged). */
  nightMode: NightMode;
  /**
   * SEQUENTIAL-only. `null` (default) means "use packages/game-engine's own
   * nightPriority order" — the same, already dependency-safe order
   * SIMULTANEOUS mode's resolution already runs in (e.g. Salvateur before
   * the wolves, wolves before the Sorcière). Only set this to override
   * that default; "restore default order" in the admin UI just sets it
   * back to null rather than recomputing anything.
   */
  nightStepOrder: RoleId[] | null;
  /** SEQUENTIAL-only. Per-role duration overrides (seconds); a role missing here falls back to DEFAULT_NIGHT_STEP_DURATIONS then DEFAULT_NIGHT_STEP_DURATION_SECONDS. */
  nightStepDurations: Partial<Record<RoleId, number>>;
  /**
   * SEQUENTIAL-only. Roles the admin has explicitly opted out of getting a
   * dedicated turn this game — for that role, SEQUENTIAL mode behaves as
   * if nobody at the table held it: no prompt, no step, ever, all game.
   * Empty by default (nothing disabled).
   */
  nightStepDisabled: RoleId[];
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
  chefVoteBonusThreshold: 6,
  secondDebateSlots: 2,
  autoProgress: false,
  soundEffectsEnabled: true,
  name: "Partie sans nom",
  nightMode: "SIMULTANEOUS",
  nightStepOrder: null,
  nightStepDurations: {},
  nightStepDisabled: [],
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
  LOUP_VERT: {
    id: "LOUP_VERT",
    displayName: "Loup vert",
    team: "LOUPS",
    shortDescription:
      "Joue avec la meute. À partir de la nuit 2, devine chaque nuit le rôle d'un villageois : s'il a " +
      "raison, il lui vole son pouvoir pour cette nuit (le Chasseur, lui, reste volé pour toujours) et " +
      "la victime devient un simple villageois pour de bon.",
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
  BARBIE: {
    id: "BARBIE",
    displayName: "Barbie",
    team: "VILLAGE",
    shortDescription:
      "Une fois par partie, en pleine discussion du jour, désigne un joueur dont le rôle est révélé à " +
      "tous : un loup démasqué meurt et elle devient Chef du village ; toute autre personne emporte " +
      "Barbie avec elle dans la mort.",
    hasNightAction: false,
    hasDeathTrigger: false,
  },
  ALIEN: {
    id: "ALIEN",
    displayName: "Alien",
    team: "SOLO",
    shortDescription:
      "Solitaire, contre le village ET contre les loups. Chaque nuit (s'il le souhaite), devine le " +
      "rôle d'un joueur : juste, il meurt sur-le-champ ; faux, il perd une chance (2 contre le village, " +
      "1 seule contre les loups) — la dernière chance perdue le tue. Il peut aussi précipiter la nuit " +
      "en pleine discussion de jour, mais s'il le fait, deviner devient obligatoire cette nuit-là.",
    hasNightAction: true,
    hasDeathTrigger: false,
  },
  PRETRE: {
    id: "PRETRE",
    displayName: "Prêtre",
    team: "VILLAGE",
    shortDescription:
      "Une seule fois dans la partie, la nuit de son choix (dès la nuit 1), peut tirer sur un joueur " +
      "de son choix, y compris lui-même. Si c'est un loup, il meurt et le Prêtre continue de jouer. " +
      "Sinon, c'est le Prêtre — et lui seul — qui meurt ; la cible ne risque rien.",
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
  /**
   * The village's day elimination vote is an OPEN ballot (by design, unlike
   * night actions): voterId -> targetId, live, for every vote cast so far
   * in the current round. Only populated during the DAY_VOTE phase; empty
   * at every other time (including night votes and once a round resolves).
   * Every player can see who is voting for whom. Each player gets exactly
   * one locked vote per round — see VoteManager.castDayVote.
   */
  dayVotes: Record<string, string>;
  /**
   * Live, weighted vote count per target (targetId -> total weight), same
   * scope/lifetime as `dayVotes`. Reflects the Chef's double-vote bonus —
   * use this for the displayed number, not `dayVotes.length`, or the
   * Chef's vote will visually undercount.
   */
  dayVoteTally: Record<string, number>;
  /** Same open-ballot pattern as `dayVotes`, but for the Chef election vote — only populated during CHEF_VOTE. */
  chefVotes: Record<string, string>;
  /** Live vote count per candidate during CHEF_VOTE — unweighted (nobody is Chef yet at this point), unlike dayVoteTally. */
  chefVoteTally: Record<string, number>;
  /**
   * Today's full speaking order for DAY_1_DISCUSSION / DAY_DISCUSSION —
   * player ids, Chef first and last, everyone else once in between. Null
   * outside those two phases. Distinct from `currentSpeakerId` above,
   * which is specifically the Chef-election debate's speaker (a different
   * phase, a different queue).
   */
  dayDiscussionOrder: string[] | null;
  /** Whoever's turn it currently is within dayDiscussionOrder; null outside those two phases. */
  dayDiscussionCurrentSpeakerId: string | null;
  /**
   * TIE_DEFENSE's speaking order: the tied players (2 or 3 of them),
   * freshly shuffled every time a tie opens, each getting one defense turn.
   * Null outside TIE_DEFENSE. Distinct from `tiedPlayerIds` above, which is
   * just the unordered set — this is specifically the randomized turn order.
   */
  tieDefenseOrder: string[] | null;
  /** Whoever's turn it currently is within tieDefenseOrder; null outside TIE_DEFENSE. */
  tieDefenseCurrentSpeakerId: string | null;
  /**
   * DAY_VOTE's per-player voting turn order — every alive player once,
   * same relative order as that day's discussion, Chef always last
   * regardless of where they landed in the discussion order. Rebuilt fresh
   * every round (including round 2+ re-votes after a tie). Null outside
   * DAY_VOTE.
   */
  dayVoteOrder: string[] | null;
  /** Whoever's turn it currently is to vote within dayVoteOrder; null outside DAY_VOTE. */
  dayVoteCurrentVoterId: string | null;
  /**
   * CHEF_SECOND_DEBATE: true while the phase is active but the Chef hasn't
   * chosen who (if anyone) gets a bonus turn yet — the frontend uses this
   * to show the Chef's picker instead of a speaker view. False once he's
   * decided (even if he picked nobody) or outside this phase entirely.
   */
  secondDebateChoicePending: boolean;
  /** The bonus speakers the Chef picked, in the order they'll speak. Null outside CHEF_SECOND_DEBATE, or before the Chef has chosen. */
  secondDebateOrder: string[] | null;
  /** Whoever's bonus turn it currently is within secondDebateOrder; null outside that sub-state. */
  secondDebateCurrentSpeakerId: string | null;
  /** Mirrors GameConfig.secondDebateSlots — so the Chef's picker UI can enforce/display the max without needing the full admin config. */
  secondDebateSlots: number;
  /** Mirrors GameConfig.soundEffectsEnabled — the single source of truth every client checks before playing any cue. */
  soundEffectsEnabled: boolean;
}

export interface EndGameStats {
  winner: Team;
  roleReveal: { playerId: string; nickname: string; roleId: RoleId; isAlive: boolean }[];
  totalNights: number;
  totalDays: number;
  chefHistory: string[];
}

/**
 * Everything the accounts/stats/history layer (apps/server) needs to
 * persist one player's outcome for a finished game — deliberately flat and
 * role-agnostic (team comes from ROLE_METADATA, not a hardcoded switch) so
 * that layer never needs to know anything about individual roles. See
 * GameEngine.getFinalPlayerSummaries().
 */
export interface FinalPlayerSummary {
  playerId: string;
  nickname: string;
  roleId: RoleId;
  team: Team;
  isAlive: boolean;
  deathCause: string | null;
  /** "Nuit N" / "Jour N", or null if he survived to the end. */
  deathMoment: string | null;
}
