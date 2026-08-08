import type {
  EndGameStats,
  GameConfig,
  GameStatePublic,
  LogEntry,
  PlayerPrivateRole,
  RoleId,
} from "./types";

/** Payload for ROLE_ASSIGNED — sent once at game start and again on every reconnect. */
export interface RoleAssignedPayload {
  playerId: string;
  roleId: RoleId;
  /**
   * Fellow wolf-team players (LOUP_GAROU + LOUP_BLANC, alive at the time of
   * sending), so the pack knows each other from the very start instead of
   * only discovering it once the wolf room opens on night 1. Always an
   * empty array for non-wolf roles.
   */
  wolfTeammates: { id: string; nickname: string }[];
}

/**
 * Socket.IO event name constants. Using constants (instead of raw strings)
 * throughout server + client means a typo becomes a compile error instead
 * of a silent dropped event.
 */
export const SOCKET_EVENTS = {
  // --- connection / session ---
  ADMIN_AUTH: "admin:auth",
  PLAYER_JOIN: "player:join",
  PLAYER_RECONNECT: "player:reconnect",
  SESSION_RESTORED: "session:restored",
  ERROR: "error",

  // --- admin: game lifecycle ---
  ADMIN_CREATE_GAME: "admin:createGame",
  ADMIN_UPDATE_CONFIG: "admin:updateConfig",
  ADMIN_START_GAME: "admin:startGame",
  ADMIN_PAUSE: "admin:pause",
  ADMIN_RESUME: "admin:resume",
  ADMIN_FORCE_NEXT_PHASE: "admin:forceNextPhase",
  ADMIN_UNDO_PHASE: "admin:undoPhase",
  ADMIN_END_GAME: "admin:endGame",
  ADMIN_REVEAL_ROLES: "admin:revealRoles",
  ADMIN_FORCE_START_CHEF_ELECTION: "admin:forceStartChefElection",
  ADMIN_RESOLVE_TIE: "admin:resolveTie",
  ADMIN_SAVE_PRESET: "admin:savePreset",
  ADMIN_LIST_PRESETS: "admin:listPresets",
  ADMIN_SET_SOUND_EFFECTS: "admin:setSoundEffects", // togglable anytime, unlike the rest of GameConfig

  // --- admin: read models ---
  ADMIN_STATE: "admin:state", // full state incl. every role + logs
  ADMIN_LOG_APPENDED: "admin:logAppended",

  // --- lobby / general ---
  GAME_STATE: "game:state", // sanitized public state, broadcast to all
  ROLE_ASSIGNED: "role:assigned", // private, to one player only
  NOTIFICATION: "notification", // toast/banner shown to a client

  // --- chef election ---
  CHEF_VOLUNTEER: "chef:volunteer",
  CHEF_DEBATE_NEXT_SPEAKER: "chef:nextSpeaker",
  // Self-serve version of the above: the candidate currently speaking can
  // end their own turn early, same pattern as DAY_DISCUSSION_PASS_TURN.
  CHEF_DEBATE_PASS_TURN: "chef:passTurn",
  CHEF_VOTE_CAST: "chef:voteCast",
  CHEF_ELECTED: "chef:elected",

  // --- chef manual "skip to next phase" (self-serve equivalent of
  // ADMIN_FORCE_NEXT_PHASE, available only to whoever is currently the
  // elected Chef du village — transfers automatically on succession since
  // it's checked against the live chefId at click time, not cached) ---
  CHEF_FORCE_NEXT_PHASE: "chef:forceNextPhase",

  // --- chef succession (triggered when the elected Chef dies) ---
  CHEF_SUCCESSION_PROMPT: "chef:successionPrompt", // server -> the now-dead ex-Chef only
  CHEF_SUCCESSION_CHOOSE: "chef:successionChoose",

  // --- day discussion (DAY_1_DISCUSSION + DAY_DISCUSSION share this) ---
  // Self-serve: the current speaker can end their own turn early. An admin
  // can also call this to force-skip a stuck/disconnected speaker.
  DAY_DISCUSSION_PASS_TURN: "dayDiscussion:passTurn",

  // --- tie defense (TIE_DEFENSE) ---
  // Same self-serve pattern as DAY_DISCUSSION_PASS_TURN: the tied player
  // currently defending themselves can end their own turn early.
  TIE_DEFENSE_PASS_TURN: "tieDefense:passTurn",

  // --- day vote ---
  DAY_VOTE_CAST: "day:voteCast",
  DAY_VOTE_RESULT: "day:voteResult", // admin only, detailed

  // --- night actions (private, role-scoped) ---
  NIGHT_PROMPT: "night:prompt", // server -> player with a role action to take
  NIGHT_ACTION_SUBMIT: "night:actionSubmit",
  MORNING_ANNOUNCEMENT: "morning:announcement",
  // Cahier de charge #2 §17.1 — SEQUENTIAL night mode only (see GameConfig.
  // nightMode). Broadcast to the WHOLE game room, never anything private:
  // just "whose turn it is right now" so a player with nothing to do this
  // step can render "the village is sleeping" instead of a blank screen,
  // and so the client can show the night's progress. The player who
  // actually has to act still gets their own NIGHT_PROMPT as always — this
  // is a public companion to that, not a replacement.
  NIGHT_STEP_STATE: "night:stepState",

  // --- wolf private room ---
  WOLF_ROOM_STATE: "wolf:roomState",
  WOLF_CHAT_MESSAGE: "wolf:chatMessage",
  WOLF_CHAT_SEND: "wolf:chatSend",
  WOLF_KILL_VOTE: "wolf:killVote",

  // --- cahier de charge #2 §17.3 — Afterlife: a private chat for every
  // dead player (isSpectator, see GameEngine.getAfterlifeMemberIds),
  // exact same shape/pattern as the wolf room above but membership is
  // "currently dead" instead of "currently a wolf", and — unlike the wolf
  // room, which only matters during NIGHT — this is live for the REST of
  // the game once someone's dead, through every later phase, since a dead
  // player keeps spectating everything that happens afterwards. ---
  AFTERLIFE_ROOM_STATE: "afterlife:roomState",
  AFTERLIFE_CHAT_MESSAGE: "afterlife:chatMessage",
  AFTERLIFE_CHAT_SEND: "afterlife:chatSend",

  // --- sorciere ---
  SORCIERE_PROMPT: "sorciere:prompt",
  SORCIERE_ACTION: "sorciere:action",

  // --- chasseur ---
  CHASSEUR_PROMPT: "chasseur:prompt",
  CHASSEUR_SHOOT: "chasseur:shoot",

  // --- loup vert (plays with the pack via the normal NIGHT_PROMPT/
  // NIGHT_ACTION_SUBMIT channel like any other wolf; these are his TWO
  // extra, independent night actions on top of that: guessing a villager's
  // role, and — only once he's guessed correctly — using the power he
  // stole for that one night. Both need their own channel because a
  // player can only have one "pending" prompt at a time in the standard
  // NIGHT_PROMPT system, and the Loup Vert needs up to three simultaneous
  // things tonight: the pack's kill vote, his guess, and (maybe) a
  // borrowed power.) ---
  LOUP_VERT_GUESS_PROMPT: "loupVert:guessPrompt",
  LOUP_VERT_GUESS_SUBMIT: "loupVert:guessSubmit",
  LOUP_VERT_STOLEN_POWER_PROMPT: "loupVert:stolenPowerPrompt",
  LOUP_VERT_STOLEN_POWER_SUBMIT: "loupVert:stolenPowerSubmit",

  // --- barbie (one-shot day-discussion reveal) ---
  BARBIE_REVEAL_SUBMIT: "barbie:revealSubmit",
  // Broadcast to the whole room so every client can play the reveal
  // animation in sync, not just tell Barbie's own client what happened.
  BARBIE_REVEAL_RESULT: "barbie:revealResult",

  // --- chef's optional second-debate bonus round (CHEF_SECOND_DEBATE) ---
  CHEF_SECOND_DEBATE_CHOOSE: "chef:secondDebateChoose",
  // Self-serve pass-turn during a bonus speaker's own turn, same pattern as DAY_DISCUSSION_PASS_TURN.
  CHEF_SECOND_DEBATE_PASS_TURN: "chef:secondDebatePassTurn",

  // --- alien's day-time interrupt: force the day to end immediately and
  // jump straight to a normal night (any day, including day 1), skipping
  // whatever's left of discussion, the Chef's second debate, and that
  // day's vote. Deliberately unattributed to anyone watching — see
  // GameEngine.triggerAlienNightfall. ---
  ALIEN_FORCE_NIGHTFALL: "alien:forceNightfall",

  // --- clock sync: a lightweight, game-independent round trip the client
  // uses to measure how far its own clock is from the server's, so every
  // countdown (CountdownTimer) can be anchored to the SERVER's clock
  // instead of the browser's raw Date.now() — otherwise any client/server
  // clock drift (e.g. a laptop's Docker/WSL2 VM clock after waking from
  // sleep) makes a perfectly-on-schedule server look like its timers are
  // stuck at 0:00 for several seconds before actually acting. ---
  TIME_SYNC: "time:sync",

  // --- private, role-specific extras that aren't part of the public state
  // (Barbie's own "have I used my power yet", Alien's remaining guess
  // chances, Loup Vert's stolen-power status) — pushed to a player's own
  // room alongside every other state update, always safe since it never
  // reveals anything to anyone but the player it's about. ---
  PRIVATE_ROLE_STATE: "player:privateRoleState",

  // --- end game ---
  GAME_ENDED: "game:ended",

  // --- post-game MVP vote (cahier de charge section 12). Opens
  // automatically the moment GAME_ENDED fires (see socket/handlers.ts's
  // sync()); every player who was in the game gets exactly one vote for
  // someone ELSE (no self-votes). Deliberately a secret ballot — MVP_STATE
  // only ever reveals how many votes are in, never who voted for whom —
  // unlike the day village vote, which is intentionally open. ---
  MVP_VOTE_CAST: "mvp:voteCast",
  MVP_STATE: "mvp:state", // broadcast after every cast vote: progress only, never the choices themselves
  MVP_RESULT: "mvp:result", // broadcast once finalized (naturally, or via ADMIN_FORCE_MVP_FINALIZE)
  // Safety valve for a straggler who disconnected and never came back to
  // vote — same idea as ADMIN_FORCE_NEXT_PHASE, since this vote otherwise
  // has no fixed deadline.
  ADMIN_FORCE_MVP_FINALIZE: "admin:forceMvpFinalize",
} as const;

export type SocketEventName = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

export interface AdminAuthPayload {
  /**
   * Omit gameCode to create a brand new game — no token needed, anyone can
   * do this. To resume as host of an EXISTING game (e.g. after a page
   * refresh), both gameCode and the hostToken issued when that game was
   * created are required — this is what actually protects a running
   * game's admin view, since there's no shared password anymore.
   */
  gameCode?: string;
  hostToken?: string;
}

export interface AdminAuthResult {
  code: string;
  /** Save this — it's the only way to resume as this game's host later. */
  hostToken: string;
}

export interface PlayerJoinPayload {
  gameCode: string;
  nickname: string;
}

export interface PlayerReconnectPayload {
  gameCode: string;
  playerId: string;
  reconnectToken: string;
}

export interface AdminCreateGamePayload {
  config: GameConfig;
}

export interface AdminUpdateConfigPayload {
  config: Partial<GameConfig>;
}

export interface AdminSetSoundEffectsPayload {
  enabled: boolean;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

export interface NotificationPayload {
  type:
    | "DAY_STARTED"
    | "NIGHT_STARTED"
    | "YOUR_TURN"
    | "VOTE_STARTED"
    | "VOTE_ENDED"
    | "YOU_DIED"
    | "MOWGLI_TRANSFORMED"
    | "GAME_OVER"
    | "INFO";
  message: string;
}

export interface ChefVolunteerPayload {
  playerId: string;
}

export interface ChefVoteCastPayload {
  voterId: string;
  candidateId: string;
}

export interface ChefSuccessionPromptPayload {
  /** ids of currently alive players the dead ex-Chef may pick as successor */
  eligibleSuccessorIds: string[];
}

export interface ChefSuccessionChoosePayload {
  successorId: string;
}

export interface DayVoteCastPayload {
  voterId: string;
  targetId: string;
}

export interface NightActionSubmitPayload {
  playerId: string;
  roleId: RoleId;
  actionType: string;
  targetId?: string;
  /** Only used by the Alien's "ALIEN_GUESS" action — which role he's claiming targetId holds. */
  guessedRoleId?: RoleId;
}

export interface NightPromptPayload {
  roleId: RoleId;
  actionType: string;
  /** ids of players this action may legally target */
  eligibleTargetIds: string[];
  /** e.g. sorciere sees who was attacked; the Alien's ALIEN_GUESS prompt carries guessableRoleIds + remaining chances here */
  context?: Record<string, unknown>;
  deadlineAt: number;
}

/** SEQUENTIAL night mode only — see SOCKET_EVENTS.NIGHT_STEP_STATE's doc comment. Entirely public, no secret info. */
export interface NightStepStatePayload {
  /**
   * Null once every step this night is done and the night is about to
   * resolve (no more turns left, resolution/MORNING is imminent). More
   * than one role id when several roles share a single collective step —
   * e.g. LOUP_GAROU + LOUP_BLANC + LOUP_VERT all feed the same pack vote,
   * see NightSequencer.ts's doc comment — so the client can render all of
   * them (e.g. "Les Loups agissent...") rather than assume exactly one.
   */
  currentStepRoleIds: RoleId[] | null;
  /** 1-based position of the current step within this night's step order, for a "3 / 6" style progress display. 0 if currentStepRoleIds is null. */
  stepIndex: number;
  totalSteps: number;
  /** Same convention as NightPromptPayload.deadlineAt — epoch ms. Null once currentStepRoleIds is null. */
  stepDeadlineAt: number | null;
}

export interface LoupVertGuessPromptPayload {
  eligibleTargetIds: string[];
  /** Village-team role ids he may claim a target holds. */
  guessableRoleIds: RoleId[];
  deadlineAt: number;
}

export interface LoupVertGuessSubmitPayload {
  playerId: string;
  targetId: string;
  guessedRoleId: RoleId;
}

/**
 * The stolen-power prompt/submit reuse NightPromptPayload's exact shape —
 * once the Loup Vert has correctly guessed an active-power role, the
 * server hands him the SAME kind of prompt the real role-holder would have
 * gotten (SORCIERE_ACT, PROTECT, INSPECT, or MARK), so the client's
 * existing NightPromptPanel renders it with no new UI code.
 */
export interface LoupVertStolenPowerSubmitPayload {
  playerId: string;
  actionType: string;
  targetId?: string;
}

export interface BarbieRevealSubmitPayload {
  playerId: string;
  targetId: string;
}

export interface BarbieRevealResultPayload {
  barbieId: string;
  barbieNickname: string;
  targetId: string;
  targetNickname: string;
  targetRoleId: RoleId;
  outcome: "WOLF_DIED_BARBIE_CHEF" | "BOTH_DIED";
  /** Set only for the WOLF_DIED_BARBIE_CHEF outcome. */
  newChefId: string | null;
}

export interface ChefSecondDebateChoosePayload {
  /** 0..GameConfig.secondDebateSlots alive player ids, in the order they'll speak. */
  playerIds: string[];
}

/**
 * Role-specific private extras, sent only to the player they're about —
 * never broadcast. Fields are present only for the role they apply to.
 */
export interface PrivateRoleStatePayload {
  /** BARBIE only. */
  barbiePowerAvailable?: boolean;
  /** ALIEN only. */
  alienChances?: { village: number; wolf: number };
  /** ALIEN only: can he force nightfall right now (alive + currently in a day discussion)? */
  alienCanForceNightfall?: boolean;
  /** LOUP_VERT only: does he currently hold the permanent Chasseur trigger? */
  loupVertHasChasseurPower?: boolean;
  /** LOUP_VERT only: which role's power (if any) he's holding for tonight only. */
  loupVertStolenPowerRoleId?: RoleId | null;
}

export interface WolfChatSendPayload {
  playerId: string;
  message: string;
}

export interface WolfChatMessagePayload {
  playerId: string;
  nickname: string;
  message: string;
  timestamp: number;
}

export interface WolfRoomStatePayload {
  members: { id: string; nickname: string }[];
  alivePlayers: { id: string; nickname: string }[];
  currentVotes: Record<string, string>; // wolfId -> targetId (visible to wolves)
}

/** Cahier de charge #2 §17.3 — same shape/reasoning as WolfChatSendPayload/WolfChatMessagePayload, membership is "dead" instead of "wolf". */
export interface AfterlifeChatSendPayload {
  playerId: string;
  message: string;
}

export interface AfterlifeChatMessagePayload {
  playerId: string;
  nickname: string;
  message: string;
  timestamp: number;
}

export interface AfterlifeRoomStatePayload {
  /** Every dead player (see GameEngine.getAfterlifeMemberIds) — everyone in this list is a member of the chat, unlike WolfRoomStatePayload.alivePlayers which is only "for context". */
  members: { id: string; nickname: string }[];
}

export interface SorciereActionPayload {
  playerId: string;
  action: "HEAL" | "POISON" | "SKIP";
  targetId?: string; // required for POISON, implicit attacked player for HEAL
}

export interface ChasseurShootPayload {
  playerId: string;
  targetId: string;
}

export interface MorningAnnouncementPayload {
  result: "DEATH" | "NO_DEATH";
  mowgliTransformed: boolean;
}

export interface AdminResolveTiePayload {
  /** used when tieResolutionRule is ADMIN_DECIDES */
  targetId: string | null;
}

export interface AdminStatePayload {
  state: GameStatePublic;
  roles: PlayerPrivateRole[];
  logs: LogEntry[];
}

export interface GameEndedPayload {
  stats: EndGameStats;
}

/** Ack response for TIME_SYNC — see the SOCKET_EVENTS.TIME_SYNC comment. */
export interface TimeSyncResultPayload {
  serverNow: number;
}

/** voterId is implicit (the caller's own socket.data.playerId), same convention as DayVoteCastPayload etc. */
export interface MvpVoteCastPayload {
  votedForId: string;
}

/**
 * Broadcast after every vote is cast, and once at MVP voting's own start.
 * Deliberately reveals only progress, never any individual's choice — see
 * the MVP_STATE comment in SOCKET_EVENTS.
 */
export interface MvpStatePayload {
  votesCast: number;
  totalEligible: number;
  /** Which players have voted so far (not who they voted for) — lets the UI show "waiting on: ..." */
  votedPlayerIds: string[];
  finalized: boolean;
}

export interface MvpResultPayload {
  /** More than one entry means a tie — see FEATURES.md section 12 for the "everyone tied wins" rule. Empty if nobody voted before this finalized. */
  winners: { playerId: string; nickname: string }[];
}
