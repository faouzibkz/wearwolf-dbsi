export { GameEngine, KNOWN_ROLE_IDS } from "./engine/GameEngine";
export type { StartGameResult } from "./engine/GameEngine";
export type { DayVoteOutcome } from "./engine/VoteManager";
export type {
  EngineContext,
  GameInternalState,
  InternalPlayer,
  NightScratch,
  ChefElectionState,
  DayVoteState,
  NightActionSubmitted,
} from "./internalTypes";
export type { RoleModule, NightActionRequest } from "./roles/Role";
export { ROLE_REGISTRY, getRolesByNightPriority } from "./roles/registry";
// GameEvent/GameEventType live in @loupgarou/shared (see events.ts's doc
// comment) and are already re-exported by the line below.
export * from "@loupgarou/shared";
