import type {
  EndGameStats,
  GameConfig,
  GameStatePublic,
  LogEntry,
  PlayerPrivateRole,
  RoleId,
} from "./types";

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
  CHEF_VOTE_CAST: "chef:voteCast",
  CHEF_ELECTED: "chef:elected",

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

  // --- wolf private room ---
  WOLF_ROOM_STATE: "wolf:roomState",
  WOLF_CHAT_MESSAGE: "wolf:chatMessage",
  WOLF_CHAT_SEND: "wolf:chatSend",
  WOLF_KILL_VOTE: "wolf:killVote",

  // --- sorciere ---
  SORCIERE_PROMPT: "sorciere:prompt",
  SORCIERE_ACTION: "sorciere:action",

  // --- chasseur ---
  CHASSEUR_PROMPT: "chasseur:prompt",
  CHASSEUR_SHOOT: "chasseur:shoot",

  // --- end game ---
  GAME_ENDED: "game:ended",
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
}

export interface NightPromptPayload {
  roleId: RoleId;
  actionType: string;
  /** ids of players this action may legally target */
  eligibleTargetIds: string[];
  /** e.g. sorciere sees who was attacked */
  context?: Record<string, unknown>;
  deadlineAt: number;
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
