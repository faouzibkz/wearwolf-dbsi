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

## Deploying to AWS

Live at **https://loupgarou-dbsi.com**, running entirely on AWS, provisioned entirely through
Terraform. Nothing was clicked into existence by hand in the console — every resource below has a
corresponding `.tf` file, so the whole environment can be destroyed and recreated from scratch.

### Architecture

```
Internet
   │  HTTPS (443)
   ▼
Application Load Balancer  (public subnets, 2 AZs)
   │                                    │
   │ default: "/"                       │ path rule: "/socket.io/*"
   ▼                                    ▼
ECS Fargate: web (Next.js, :3000)   ECS Fargate: server (Socket.IO, :4000)
   (desired_count = 1)                 (desired_count = 1 — HARD requirement,
                                         see below)
                                         │
                                         ▼
                                    RDS Postgres  (private subnets, no internet route)
```

One domain, routed by **path** rather than by subdomain (`/socket.io/*` → the game server,
everything else → the web app) — this means the web app and the Socket.IO connection share one
origin, so `NEXT_PUBLIC_SERVER_URL` is simply the same domain, and only one ACM certificate is
needed instead of two.

The server's `desired_count` is pinned to `1` and must never be scaled beyond that: it keeps live
game state in memory (see "Why the engine is a separate package" above), so running more than one
copy would split games across instances unpredictably. The web app is stateless and could scale,
but there's no reason to at this project's scale (10-20 players).

ECS tasks run in **public** subnets with public IPs, not private subnets behind a NAT Gateway — a
deliberate cost tradeoff. A NAT Gateway costs roughly $32+/month just for existing; tasks are still
unreachable directly from the internet because their security group only accepts inbound traffic
from the ALB's security group, so public-subnet placement doesn't weaken this in practice, just
avoids paying for a NAT Gateway whose only job would otherwise be outbound access to ECR/Secrets
Manager/CloudWatch.

### Terraform layout

```
infra/
  bootstrap/   One-time stack: creates the S3 bucket + DynamoDB table that every other
               stack (below) uses as its remote state backend. Uses local state itself
               (chicken-and-egg — see the comment at the top of infra/bootstrap/main.tf).
               Run once, ever, per AWS account.
  aws/         The actual infrastructure, as one Terraform root module, split by concern:
                 backend.tf         — S3 remote state config
                 providers.tf       — AWS provider + default tags
                 variables.tf       — region, CIDR, domain name, GitHub repo, etc.
                 vpc.tf             — VPC, public+private subnets, IGW, route tables
                 security_groups.tf — bare security groups + explicit egress rules
                 rds.tf             — Postgres, in private subnets, publicly_accessible = false
                 secrets.tf         — random DB password + ADMIN_SECRET, stored in Secrets Manager
                 ecr.tf             — the 2 Docker image repositories
                 iam.tf             — ECS execution role (pull images, read secrets, write logs)
                 ecs.tf             — cluster, task definitions, services
                 alb.tf             — load balancer, target groups, HTTP->HTTPS redirect
                 acm.tf             — free TLS cert, DNS-validated
                 route53.tf         — hosted zone lookup + alias records
                 github_oidc.tf     — lets GitHub Actions authenticate without stored AWS keys
                 outputs.tf         — everything the CLI/scripts/CI need to read back out
```

### Secrets

Two values the server needs at runtime — the full Postgres connection string and `ADMIN_SECRET` —
are generated by Terraform itself (`random_password`), never typed by a human, and stored in AWS
Secrets Manager. The ECS task definition references them by ARN; AWS injects the real value
directly into the container's environment at startup. The value never appears in Terraform files,
the AWS console, or any log. To read a secret's actual value when you need it (e.g. to log into
`/admin`):

```bash
aws secretsmanager get-secret-value --secret-id loupgarou/admin-secret --query SecretString --output text --region eu-west-3
```

### Manual deploy commands (what the pipelines below automate)

```bash
# Build + push (build context is the repo root for both — see each Dockerfile's first comment)
aws ecr get-login-password --region eu-west-3 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.eu-west-3.amazonaws.com
docker build -f apps/web/Dockerfile -t <account-id>.dkr.ecr.eu-west-3.amazonaws.com/loupgarou-web:latest --build-arg NEXT_PUBLIC_SERVER_URL=https://loupgarou-dbsi.com .
docker build -f apps/server/Dockerfile -t <account-id>.dkr.ecr.eu-west-3.amazonaws.com/loupgarou-server:latest .
docker push <account-id>.dkr.ecr.eu-west-3.amazonaws.com/loupgarou-web:latest
docker push <account-id>.dkr.ecr.eu-west-3.amazonaws.com/loupgarou-server:latest

# Redeploy
aws ecs update-service --cluster loupgarou-cluster --service loupgarou-web --force-new-deployment --region eu-west-3
aws ecs update-service --cluster loupgarou-cluster --service loupgarou-server --force-new-deployment --region eu-west-3
```

### CI/CD pipeline (GitHub Actions)

`.github/workflows/app-deploy.yml` authenticates to AWS via **OpenID Connect**
(`infra/aws/github_oidc.tf`) — GitHub issues the workflow run a short-lived signed token, AWS trusts
it only for this specific repo, and the workflow exchanges it for temporary credentials. No AWS
access key is ever stored as a GitHub secret.

On every push to `master` (this repo's working branch) touching `apps/**` or `packages/**`, it builds both Docker images (tagged
with the commit SHA, not just `latest`, so there's always a specific version to roll back to),
pushes to ECR, registers a new ECS task definition revision pointing at that exact image, and
updates both services. Can also be triggered manually from the Actions tab.

One-time setup after cloning: add the role ARN Terraform outputs
(`github_actions_app_deploy_role_arn`) as a repository **variable** (not a secret — it isn't
sensitive) named `AWS_APP_DEPLOY_ROLE_ARN`, under Settings → Secrets and variables → Actions →
Variables.

There is deliberately no Terraform-driving pipeline yet (no automatic `plan`/`apply` on infra
changes) — infra changes are applied manually, the same way they've been applied throughout this
project. That's a reasonable next step if/when it's wanted (it would need a second, much
broader-permissioned CI role, since Terraform touches everything it manages).

### Bootstrapping a fresh clone / new AWS account

```bash
./scripts/deploy-aws.sh
```

Runs both Terraform stacks (pausing to show you each plan before applying), builds and pushes both
images, and deploys — the same sequence described above, scripted end to end. Before running it on
a **different** AWS account than the one this repo was originally deployed from, you must change two
hardcoded, globally-unique values first: the S3 bucket name in `infra/bootstrap/main.tf` (S3 names
are unique across all of AWS, not just your account) and the matching `bucket` in
`infra/aws/backend.tf`. Also update `domain_name` in `infra/aws/variables.tf` to a domain you
actually own.

### Cost

Running continuously, roughly **$55-65/month**: RDS `db.t4g.micro` (~$22 + ~$2 storage), 2 Fargate
tasks at 0.25 vCPU/0.5GB each (~$18 combined), the ALB (~$16-20), Secrets Manager (~$0.80), and
Route53's hosted zone ($0.50) — separate from the ~$12-15/year domain registration itself, paid once
a year. Scaling both ECS services to `desired_count 0` between sessions and back to `1` before
playing saves the Fargate portion; RDS and the ALB keep billing regardless unless torn down entirely.
