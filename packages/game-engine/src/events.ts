/**
 * GameEvent now lives in packages/shared (see gameEvents.ts there for the
 * full type + doc comment on why): packages/rating needs to read this shape
 * too, and it already depends only on @loupgarou/shared, not on this
 * package — moving the type there avoids giving packages/rating a new
 * dependency on packages/game-engine just for one type. This file remains
 * as a thin re-export so nothing inside packages/game-engine that already
 * imports "../events" / "./events" needs to change.
 */
export type { GameEvent, GameEventType } from "@loupgarou/shared";
