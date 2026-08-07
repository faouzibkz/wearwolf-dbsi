# ARCHITECTURE.md — Loup-Garou (DBSI) — Document de référence

> **But de ce document** : permettre à n'importe qui (humain ou session Claude sans historique) de comprendre en une lecture comment cette application fonctionne — logique de jeu, architecture technique, couche comptes/stats, déploiement — et de reprendre le travail immédiatement, sans avoir à relire tout le code d'abord.
>
> À lire avec **[FEATURES.md](./FEATURES.md)** (suivi fait/à faire du cahier de charge) et **[README.md](./README.md)** (guide pratique : lancer en local, déployer, dépanner).
>
> Dernière mise à jour : 7 août 2026.

---

## 1. Vue d'ensemble

Application compagnon pour animer des parties de Loup-Garou en physique : un admin/hôte crée une partie depuis un écran, les joueurs la rejoignent depuis leur téléphone, et le moteur de jeu gère automatiquement les phases (nuit, vote, révélations), les timers, et l'attribution des rôles. Au-dessus de cette logique de jeu (déjà complète avant la session en cours) s'ajoute désormais une couche **comptes utilisateurs / profils / historique / statistiques** (Phase 1 du cahier de charge — voir FEATURES.md).

Trois principes structurants, jamais transgressés :

1. **Le moteur de jeu est agnostique de tout ce qui l'entoure.** Aucune dépendance vers Express, Socket.IO, Prisma ou React. Il ne connaît que ses propres règles.
2. **Aucun rôle n'est codé en dur dans la logique centrale.** Chaque rôle est un module qui s'enregistre dans un registre ; ajouter un rôle ne touche jamais le moteur lui-même.
3. **La couche comptes/stats est découplée du moteur de jeu.** Elle vit entièrement côté serveur (`apps/server`), jamais dans `packages/game-engine`. Le moteur expose juste les données brutes nécessaires (`getFinalPlayerSummaries()`) ; c'est `apps/server` qui décide quoi en faire.

---

## 2. Structure du monorepo

```
apps/
  server/    Serveur temps réel (Express + Socket.IO) + API REST comptes/historique + Prisma
  web/       Application Next.js (App Router) — toutes les pages/écrans joueurs et admin
packages/
  game-engine/   Moteur de jeu pur, testé unitairement (aucune dépendance framework)
  shared/        Types TypeScript + constantes partagés entre les 3 autres workspaces
infra/
  aws/       Infrastructure Terraform (AWS ECS Fargate, RDS, ALB, Route53, IAM, Secrets Manager)
scripts/     Scripts de bootstrap (setup AWS depuis un compte neuf, etc.)
```

Workspaces npm (`package.json` racine) : `npm run build` construit dans l'ordre `shared → game-engine → server → web` (l'ordre est important, chacun dépend du précédent).

---

## 3. Le moteur de jeu (`packages/game-engine`)

### 3.1 Principe : machine à états + rôles en plug-in

`GameEngine.ts` est la classe centrale : elle possède l'état (`InternalState` — joueurs, phase, votes, timers logiques) et expose des méthodes d'action (`addPlayer`, `castDayVote`, `resolveNightActions`, etc.). Chaque partie tourne dans une instance séparée, **en mémoire**, tenue par `gameRegistry` côté serveur (voir §4.1).

Les **phases** (`packages/shared/src/types.ts`, `PHASES`) : `LOBBY → CHEF_CANDIDACY → CHEF_DEBATE → CHEF_VOTE → CHEF_REVEAL → DAY_1_DISCUSSION → NIGHT → MORNING → DAY_DISCUSSION → [CHEF_SECOND_DEBATE] → DAY_VOTE → DAY_VOTE_RESULT → [TIE_DEFENSE → TIE_REVOTE] → ... boucle NIGHT/DAY ... → ENDED`.

Chaque **rôle** (`packages/game-engine/src/roles/*.ts`) est un `RoleModule` : une nuit priority (ordre de résolution), un `shortDescription`, et sa propre logique d'action de nuit si applicable. Le seul fichier à modifier pour ajouter un rôle est `roles/registry.ts` (le registre) plus le nouveau module lui-même — jamais `GameEngine.ts`.

Rôles actuels (`ROLE_IDS`, `packages/shared/src/types.ts`) : `VILLAGEOIS, LOUP_GAROU, LOUP_BLANC, LOUP_VERT, SORCIERE, VOYANTE, SALVATEUR, CHASSEUR, CORBEAU, MOWGLI, BARBIE, ALIEN`. Chaque rôle a des métadonnées génériques dans `ROLE_METADATA` (équipe, description, a-t-il une action de nuit, a-t-il un déclencheur à la mort) — c'est cette table, jamais un `if (role === ...)`, qui pilote l'UI et (désormais) le calcul d'équipe pour les stats.

### 3.2 Modules clés

| Fichier | Rôle |
|---|---|
| `engine/GameEngine.ts` | Classe centrale, expose l'API publique (actions + getters d'état) |
| `engine/DeathQueue.ts` | File des morts en attente de résolution, assigne `deathCause` + `deathMoment` |
| `engine/NightResolver.ts` | Orchestre l'ordre de résolution des actions de nuit par priorité de rôle |
| `engine/DayVoteQueue.ts` | Vote du village **séquentiel** (un joueur à la fois, Chef toujours en dernier) |
| `engine/VoteManager.ts` | Comptage des votes (jour + élection du Chef), pondération du bonus Chef |
| `engine/ChefElection.ts` | Candidature → débat → vote → révélation du Chef |
| `engine/SecondDebate.ts` | Tour de parole bonus optionnel accordé par le Chef |
| `engine/TieDefense.ts` | Égalité de vote → défense orale → re-vote |
| `engine/VictoryConditions.ts` | Détecte la victoire Village/Loups (l'Alien, en solo, n'influence jamais qui gagne entre les deux) |
| `internalTypes.ts` | `InternalPlayer` etc. — état interne, jamais exposé tel quel au client |
| `index.ts` | Point d'entrée public du package |

### 3.3 Ce que le moteur expose pour les comptes/stats

`GameEngine.getFinalPlayerSummaries()` (ajouté pour la Phase 1) retourne, pour chaque joueur, un objet **plat et générique** :

```ts
{ playerId, nickname, roleId, team, isAlive, deathCause, deathMoment }
```

`team` vient de `ROLE_METADATA[roleId].team` — jamais d'un switch sur le rôle. `deathMoment` ("Nuit 3" / "Jour 2") est posé par `DeathQueue.processDeaths()` au moment de la mort. C'est la **seule** surface que le moteur expose à la couche comptes — tout le reste (à qui appartient ce `playerId`, comment le stocker) est géré ailleurs.

### 3.4 Tests

127 tests automatisés (`packages/game-engine/src/__tests__/*.test.ts`, 22 fichiers), `npm run test` (vérifié par exécution réelle — `vitest run` — pas par simple comptage). Couvrent : attribution des rôles, résolution de nuit par rôle, vote séquentiel, élection du Chef, égalités, victoire, et `finalPlayerSummaries.test.ts` pour la Phase 1.

---

## 4. Le serveur temps réel (`apps/server`)

### 4.1 `gameRegistry.ts` — état vivant, en mémoire

Une `Map<code, GameEngine>` tenue pendant toute la durée du process. Pas de mot de passe admin partagé : créer une partie donne un `hostToken` aléatoire au créateur, seul moyen de ré-administrer cette partie précise plus tard.

Depuis la Phase 1, `gameRegistry` tient aussi `userIdByPlayerId: Map<playerId, userId>` — le lien "quel compte se cache derrière ce joueur, dans cette partie". **Ce lien est en mémoire, jamais sur `InternalPlayer`** : c'est ce qui garde le moteur de jeu totalement ignorant de l'existence des comptes. Il est peuplé sur `PLAYER_JOIN`/`PLAYER_RECONNECT`, consommé une fois à `GAME_ENDED`, puis nettoyé (`clearPlayerUserIds`).

### 4.2 `socket/handlers.ts` — la boucle d'événements

Chaque action mutante (vote, action de nuit, etc.) passe par `sync(io, engine)` en fin de handler : elle rediffuse l'état public à tous, réarme les timers de phase, et — point important — appelle **une seule fois, de façon centralisée**, `finalizeGameHistory()` quand la partie se termine (peu importe la cause : vote, timer auto, ou admin qui force la phase suivante). C'est ce point d'entrée unique qui garantit qu'aucune partie terminée n'échappe à l'écriture d'historique.

`PLAYER_JOIN` exige désormais un cookie de session valide (lu depuis `socket.handshake.headers.cookie` — le cookie voyage automatiquement avec la connexion Socket.IO grâce à `withCredentials: true` côté client et `cors({ credentials: true })` côté serveur). Sans session : rejet explicite, pas de "joueur fantôme" non rattaché à un compte. `PLAYER_RECONNECT` réaffirme ce lien de façon best-effort (ne bloque jamais une reconnexion si le cookie a expiré).

### 4.3 Persistance (`db/persistence.ts`, `db/prisma.ts`, Prisma/Postgres)

Trois responsabilités, toutes **best-effort** (une panne DB ne doit jamais planter ou geler une partie en cours) :

- `persistGame()` — snapshot de l'état complet de chaque partie active (`Game.stateJson`), pour survivre à un redémarrage serveur.
- `finalizeGameHistory()` — à `GAME_ENDED`, upsert **idempotent** (via la contrainte `@@unique([gameId, enginePlayerId])`) d'une ligne `PlayerRecord` par joueur : rôle, équipe, résultat (`WON`/`LOST`/`DRAW`, calculé depuis `team` vs `Game.winner`), cause et moment de mort, et **le compte lié si connu**.
- `getUserAggregateStats()` / `getUserGameHistory()` — lecture, calculée à la volée (pas de cache) depuis les lignes `PlayerRecord` d'un compte. Le regroupement par rôle est **entièrement générique** : un nouveau `roleId` qui apparaît dans les données s'affiche automatiquement, aucune modification de code requise.

### 4.4 Comptes (`auth/`, `http/authRoutes.ts`, `http/accountRoutes.ts`)

- `auth/passwords.ts` — hachage bcrypt.
- `auth/jwt.ts` — signe/vérifie un JWT contenant `{ userId, username }`.
- `auth/cookies.ts` — pose/lit/efface le cookie de session (`httpOnly`), et **une seule fonction** (`readSessionFromCookieHeader`) est utilisée à la fois par les routes Express (via `req.headers.cookie`) et par le handshake Socket.IO — un seul endroit qui sait décoder le cookie.
- `POST /api/auth/signup` — username (3-20 car., unique) + mot de passe (8+ car.) + email optionnel. `displayName` = `username` par défaut.
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
- `GET /api/profile/me` — identité + stats agrégées (section 3+4 du cahier de charge, en un seul appel).
- `GET /api/history/me?limit=&offset=` — historique paginé (section 5).

### 4.5 Schéma Prisma (`prisma/schema.prisma`)

```
User            — compte permanent (identité réelle). username unique, email unique optionnel, passwordHash, displayName.
Game            — une partie (code, phase, config, snapshot d'état, gagnant).
PlayerRecord     — une ligne = un joueur dans une partie donnée : nickname (pseudo temporaire, JAMAIS utilisé pour les stats),
                   roleId, team, result, deathCause, deathMoment, userId (nullable, SetNull si le compte est supprimé).
                   @@unique([gameId, enginePlayerId]) → upsert idempotent.
GameLogEntry    — journal texte d'une partie (debug/admin).
Preset          — configurations de partie sauvegardées par l'admin.
```

Note importante : **le schéma Prisma n'accepte que les commentaires `//`/`///`**, pas `/* */` — une vraie erreur de build a été introduite puis corrigée pendant cette session (voir §8, Pièges connus).

---

## 5. L'application web (`apps/web`, Next.js App Router)

| Page | Rôle |
|---|---|
| `app/page.tsx` | Accueil — navigation adaptée selon connexion (compte affiché ou lien login) |
| `app/login/page.tsx` | Formulaire signup/login (un seul écran, bascule entre les deux modes) |
| `app/join/page.tsx` | Rejoindre une partie par code — verrouillé derrière login, pré-remplit le pseudo de partie |
| `app/play/[code]/page.tsx` | L'écran de jeu lui-même (le plus gros écran — timers, votes, actions de rôle) |
| `app/admin/page.tsx`, `app/admin/[code]/page.tsx` | Créer/configurer une partie, tableau de bord admin en direct |
| `app/profile/page.tsx` | Profil : identité + stats minimum + répartition par rôle (générique, voir §4.3) |
| `app/history/page.tsx` | Historique paginé des parties jouées |

`lib/auth.tsx` — `AccountProvider` + `useAccount()` : contexte React unique pour l'état de connexion, consommé partout (nav, gates de page, `/join`). `lib/api.ts` — petit wrapper `fetch` (`apiFetch`/`ApiError`) qui centralise la gestion d'erreur JSON. `lib/socket.ts` — client Socket.IO, `withCredentials: true` pour que le cookie de session voyage avec la connexion temps réel.

Chaque page compte-liée (`/profile`, `/history`, gate de `/join`) suit le même schéma : `account === undefined` → chargement, `account === null` → redirection `/login?returnTo=...`, sinon → fetch des données.

---

## 6. Flux de bout en bout (signup → partie → historique)

1. **Signup/login** (`/login`) → `POST /api/auth/signup` ou `/login` → cookie de session posé (httpOnly, JWT).
2. **Rejoindre une partie** (`/join`) → doit être connecté → choix d'un **pseudo de partie** temporaire → `PLAYER_JOIN` (Socket.IO, cookie envoyé automatiquement) → serveur crée le joueur dans le moteur ET enregistre `userId ↔ playerId` dans `gameRegistry`.
3. **La partie se joue** entièrement dans `GameEngine` (en mémoire) ; `persistGame()` sauvegarde un snapshot après chaque action mutante.
4. **Fin de partie** (`GAME_ENDED`, déclenché une seule fois via `sync()`) → `finalizeGameHistory()` lit `engine.getFinalPlayerSummaries()`, résout `result` (WON/LOST/DRAW), et upsert une ligne `PlayerRecord` par joueur — liée au compte si `gameRegistry.getPlayerUserId(playerId)` est connu.
5. **Consultation** (`/profile`, `/history`) → lecture pure depuis Postgres, calculée à la volée, aucune dépendance au moteur de jeu (la partie peut même avoir été jouée avant un redémarrage serveur).

---

## 7. Modèle de sécurité

- Mots de passe : hachés (bcrypt), jamais stockés en clair, jamais renvoyés au client.
- Session : JWT signé, cookie `httpOnly` (inaccessible en JS côté client), `Secure` en production (`AUTH_COOKIE_SECURE=true`), `SameSite=Lax` (web + API partagent le même domaine via le routage ALB par chemin — voir §9).
- Pas d'OAuth pour l'instant (explicitement reporté à une version future par le cahier de charge lui-même).
- Un compte n'a aucun pouvoir d'administration de partie — administrer une partie précise nécessite le `hostToken` aléatoire donné à sa création, indépendant du système de comptes.
- `AUTH_JWT_SECRET` en production vient d'AWS Secrets Manager, jamais codé en dur (le fallback dev `"dev-only-insecure-secret-change-me"` ne doit **jamais** apparaître en prod).

---

## 8. Déploiement (résumé — détails complets dans README.md §"Deploying to AWS")

- **Infra** : AWS ECS Fargate (2 services : `web` et `server`, chacun `desired_count=1` — le serveur garde l'état de jeu en mémoire, pas de scaling horizontal possible), RDS Postgres privé (pas d'accès public), ALB unique avec routage **par chemin** (`/socket.io/*` et `/api/*` → serveur ; tout le reste → web Next.js), Route53 + ACM pour le domaine `loupgarou-dbsi.com`, Secrets Manager pour `DATABASE_URL`/`ADMIN_SECRET`/`AUTH_JWT_SECRET`.
- **Terraform** (`infra/aws/*.tf`) gère toute l'infra. **Piège connu et déjà rencontré deux fois** : `deploy-manual.ps1`/CI enregistrent de nouvelles révisions de task definition directement via l'AWS CLI, hors du state Terraform. Un `terraform apply` naïf peut donc faire régresser un service vers une ancienne révision. Solution appliquée : `lifecycle { ignore_changes = [task_definition] }` sur **les deux** `aws_ecs_service` (web et server). **Toujours relire un plan Terraform ligne par ligne avant de taper `yes`**, en particulier tout changement sur `task_definition`.
- **Accès base de données** : RDS n'a pas d'accès public ni de bastion — la seule voie d'entrée est `aws ecs execute-command` (ECS Exec), qui nécessite le plugin Session Manager de l'AWS CLI installé localement. Voir README pour la commande exacte (section "Applying a Prisma schema change to production").
- **CI/CD** : GitHub Actions via OIDC (pas de clé AWS stockée) — `infra/aws/github_oidc.tf`.

---

## 9. Pièges connus (pour ne pas les redécouvrir)

- **Commentaires Prisma** : `schema.prisma` n'accepte que `//`/`///`, jamais `/* */` — provoque des erreurs de validation silencieuses jusqu'au build Docker réel.
- **`prisma db push` vs `migrate`** : le projet utilise volontairement `db push` (MVP, pas encore de vraies migrations versionnées). `--accept-data-loss` est nécessaire quand le schéma change une contrainte sur des données existantes — sûr uniquement après avoir vérifié qu'aucune perte réelle n'est possible.
- **Terraform + déploiement manuel** : voir §8 — ne jamais approuver un `apply` qui modifierait `task_definition` sur un service en prod sans comprendre pourquoi.
- **GitHub OIDC "immutable subject claims"** (rollout du 15/07/2026) : la condition de confiance du rôle IAM utilise un wildcard (`StringLike`) sur l'ID numérique du repo pour rester compatible avec l'ancien et le nouveau format de `sub` claim.
- **`.git/index.lock` sur ce point de montage** : ne peut pas être supprimé (`rm` échoue avec "Operation not permitted") mais peut être déplacé (`mv`) — utile seulement si vous travaillez depuis le même environnement sandbox que Claude ; sans impact pour vous en PowerShell sur votre propre machine.

---

## 10. Où trouver quoi (index rapide)

| Je cherche... | Fichier |
|---|---|
| Ajouter un nouveau rôle | `packages/game-engine/src/roles/*.ts` + `roles/registry.ts` + `ROLE_METADATA` dans `packages/shared/src/types.ts` |
| Changer une règle de résolution de nuit | `packages/game-engine/src/engine/NightResolver.ts` |
| Changer le vote du village | `packages/game-engine/src/engine/DayVoteQueue.ts`, `VoteManager.ts` |
| Ajouter un champ au profil/historique | `apps/server/prisma/schema.prisma` → `apps/server/src/db/persistence.ts` → `apps/server/src/http/accountRoutes.ts` → page Next.js correspondante |
| Ajouter une statistique dérivée (rating, XP...) | Nouveau module dans `apps/server/src/db/` ou `apps/server/src/stats/` (à créer), branché sur `finalizeGameHistory()` — voir FEATURES.md Phase 2 |
| Modifier l'infra AWS | `infra/aws/*.tf` — **toujours relire le plan avant d'approuver** |
| Comprendre le cahier de charge original et ce qu'il reste à faire | `FEATURES.md` |
