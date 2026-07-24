# Loup-Garou — Application compagnon

Application compagnon pour animer des parties de Loup-Garou (8 à 20 joueurs) sur téléphone/ordinateur.
Le Maître du Jeu garde le contrôle total de la partie ; l'application automatise les informations
cachées, les actions de rôle, les votes, les minuteurs et les communications privées des loups.

This README is intentionally written for a technical audience (you, running this locally and
eventually on AWS), so it's in English; the app's UI is in French by default.

## Status

This is a working **first milestone**: the full game loop (lobby → Chef election → day/night
cycles → all 9 roles → tie handling → victory → end-game reveal) runs end-to-end and is covered by
unit tests + a live Socket.IO smoke test. Deliberately **not yet built** (next milestones):

- Full animated day/night transitions, role encyclopedia screen
- Saved-preset UI wiring (the backend — `Preset` table, `admin:savePreset` / `admin:listPresets` —
  already exists; the admin screen just doesn't have the load/save buttons yet)
- Integration test suite beyond the manual smoke script (`apps/server/smoke.mjs` was used during
  development; a proper `vitest` integration suite using `socket.io-client` is the natural next step)

Voice for the wolves' private room is intentionally **out of scope** — you're using Discord for
that instead of WebRTC, so the room only carries text chat (`apps/server/src/socket/wolfRoom.ts`).

Sound effects (night howl, morning rooster, death bell, victory fanfare) **are** implemented —
synthesized client-side via the Web Audio API (`apps/web/src/lib/soundEffects.ts`), no audio files
to host. They're gated by a single global `soundEffectsEnabled` flag the admin controls from the
dashboard (togglable anytime, including mid-game, unlike the rest of `GameConfig` which locks after
the game starts) — one toggle mutes or unmutes every player at once.

Everything else in the spec — including per-role night logic, the Chef vote bonus/threshold, Chef
succession on death, the Corbeau vote bonus, Mowgli's hidden transformation, the Chasseur's
death-triggered shot, tie resolution (all 5 configurable rules), reconnection, and the admin
dashboard — is implemented.

## Architecture

```
apps/
  web/      Next.js 14 (App Router) — the browser client (players + admin), Tailwind, dark theme
  server/   Node + Socket.IO — the authoritative realtime gateway + Postgres persistence
packages/
  game-engine/  Pure TypeScript game logic. No sockets, no HTTP, no DB. Fully unit-testable.
  shared/       Types + Socket.IO event contracts shared by all three above.
```

### Why the engine is a separate package

`packages/game-engine` never imports Socket.IO, Express, Next.js or Prisma. It exposes one class,
`GameEngine`, with methods like `startGame()`, `submitNightAction()`, `tallyDayVoteAndProceed()`.
`apps/server` is a thin adapter: it calls these methods from socket handlers and broadcasts the
sanitized result. This split is what makes it possible to unit-test "does the Salvateur's
protection actually save the target" without spinning up a server, a browser, or a database — see
`packages/game-engine/src/__tests__/`.

### Roles as plug-in modules

Every role implements the `RoleModule` interface (`packages/game-engine/src/roles/Role.ts`):

```ts
interface RoleModule {
  id: RoleId;
  team: Team;
  nightPriority: number; // resolution order
  isActiveOnNight(ctx, nightNumber): boolean;
  buildNightPrompt?(ctx, player): NightActionRequest | null;
  applyNightAction?(ctx, actor, action): void;
  resolve?(ctx): void;
  onDeath?(ctx, player): void; // e.g. Chasseur
}
```

`NightResolver` and `GameEngine` never branch on `roleId` — they only ever call through this
interface, iterating roles in `nightPriority` order. **Adding a new role never requires touching
the core engine.**

#### Adding a new role

1. Add its id to `ROLE_IDS` in `packages/shared/src/types.ts` (and metadata to `ROLE_METADATA`).
2. Create `packages/game-engine/src/roles/yourRole.ts` implementing `RoleModule`.
3. Register it in `packages/game-engine/src/roles/registry.ts`.
4. (UI) Add a case to `NightPromptPanel.tsx` if the role's action needs bespoke UI beyond a simple
   "pick a target" list (most roles don't — `NightPromptPanel` already handles the generic case).

No changes to `GameEngine`, `NightResolver`, socket handlers, or the day/night state machine.

### Night resolution order

`Mowgli(5) → Salvateur(10) → Voyante(20) → Loup-garou(30) → Loup blanc(35) → Sorcière(40) → Corbeau(50)`

This matters: Salvateur must protect before the wolves' target is "final"; the Sorcière must know
the wolves' target before deciding to heal/poison; Mowgli's father pick (night 1 only) is purely
informational and doesn't interact with the attack resolution at all.

### Security model

The server is fully authoritative. Every "who can I target" list is computed server-side
(`buildNightPrompt`'s `eligibleTargetIds`) — the client never decides legality, it only renders
whatever the server sent. `GameStatePublic` (what's broadcast to `game:<code>`) has no `roleId`
field anywhere; roles only ever go out over `ROLE_ASSIGNED` to a player's own private room
(`player:<id>`) or in `ADMIN_STATE` to the admin's socket. This is asserted directly in
`packages/game-engine/src/__tests__/nightResolution.test.ts` and `roleAssignment.test.ts`
(`expect(json).not.toContain("LOUP_GAROU")`), not just assumed.

The wolves' private chat is similarly invisible-by-construction: `getWolfRoomMemberIds()` is
recomputed from live game state on every call (never cached), so when Mowgli's father dies and his
`roleId` flips to `LOUP_GAROU`, the very next membership check includes him automatically — no
separate "add Mowgli to the wolf room" code path exists to forget.

## Local development (no Docker)

Requirements: Node 20+, npm 10+, a local Postgres (or use `docker compose up postgres` for just the
DB).

```bash
npm install

cp apps/server/.env.example apps/server/.env      # edit DATABASE_URL / ADMIN_SECRET
cp apps/web/.env.local.example apps/web/.env.local

npm run prisma:generate --workspace=apps/server
npm run prisma:migrate --workspace=apps/server     # creates the initial migration + applies it

npm run dev:server   # http://localhost:4000
npm run dev:web      # http://localhost:3000
```

Then:

- Open `http://localhost:3000/admin`, enter your `ADMIN_SECRET`, leave the game code blank to
  create a new game. You'll land on the config screen with the game code + a QR code to join.
- Open `http://localhost:3000/join` on other devices (same Wi-Fi) and enter the code + a nickname.
- Configure roles/timers, click **Démarrer la partie**.

## Running with Docker Compose

```bash
cp .env.example .env   # edit ADMIN_SECRET at minimum
docker compose up --build
```

This starts Postgres, the server (`http://localhost:4000`), and the web app
(`http://localhost:3000`). The server container runs `prisma db push` on boot so no manual
migration step is needed for a first run (see the comment in `docker-compose.yml` about switching
to `prisma migrate deploy` once you have real migrations checked in).

> **Why `tsx` instead of a compiled `dist/`, even for the server container?** `packages/shared` and
> `packages/game-engine` are consumed both by the server (via Node/tsx) and by Next.js (via
> webpack, through `transpilePackages`) directly from TypeScript source — that's what lets you edit
> engine code and see it live in both without a build step. Compiling those packages to a
> `dist/` and pointing their `package.json#main` there is the natural next step if you want a
> classic `node dist/index.js` production server instead; it wasn't necessary to get a real,
> fully-working local deployment, so it was left for later.

## Testing

```bash
npm run test --workspace=packages/game-engine    # unit tests: roles, votes, ties, victory, Mowgli/Chasseur chains
npm run typecheck --workspace=apps/server
npm run typecheck --workspace=apps/web
```

## Configuration reference

Everything in `GameConfig` (`packages/shared/src/types.ts`) is admin-configurable from the lobby
screen before start: role counts, all five timers, Loup blanc's active-nights rule (every night /
every second night / specific nights), the day-vote tie resolution rule (repeat defense / no
elimination / Chef decides / Admin decides / random), the Chef's vote-bonus threshold, and
automatic vs. manual phase progression.

## Extension points beyond roles

- **Victory conditions**: `packages/game-engine/src/engine/VictoryConditions.ts` exports a
  `VICTORY_CONDITIONS` array of `(ctx) => Team | null` functions, checked in order. Add a function,
  push it onto the array — e.g. a solo Loup blanc win condition.
- **Tie resolution rules**: `TieResolutionRule` in `packages/shared/src/types.ts` +
  `resolveRepeatedTie` in `packages/game-engine/src/engine/VoteManager.ts`.
- **Loup blanc's active-night rule**: `isNightActive()` in `packages/game-engine/src/roles/loupBlanc.ts`.
- **i18n**: all user-facing strings currently live inline in `apps/web` components and in
  `ROLE_METADATA` (French). There's no i18n library wired up yet — that's the next step for
  "multilingual support" from the spec.

## Deploying to AWS (later)

Not done yet by design (you asked to get this running locally first). When you're ready: the server
is a stateless-ish Node/Socket.IO process (it keeps live games in memory, so you'd want sticky
sessions or a single instance + Postgres for durability — see `apps/server/src/db/persistence.ts`),
the web app is a standard Next.js app (Amplify/Vercel/ECS all work), and Postgres maps directly to
RDS. Sound, WebRTC/TURN, and a CDN for the web build are the pieces to add before that's a full
production deployment.
