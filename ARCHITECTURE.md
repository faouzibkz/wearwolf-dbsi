# ARCHITECTURE.md — Loup-Garou (DBSI) — Document de référence

> **But de ce document** : permettre à n'importe qui (humain ou session Claude sans historique) de comprendre en une lecture comment cette application fonctionne — logique de jeu, architecture technique, couche comptes/stats, déploiement — et de reprendre le travail immédiatement, sans avoir à relire tout le code d'abord.
>
> À lire avec **[FEATURES.md](./FEATURES.md)** (suivi fait/à faire du cahier de charge) et **[README.md](./README.md)** (guide pratique : lancer en local, déployer, dépanner).
>
> Dernière mise à jour : 16 août 2026 (lot de 8 features additionnelles post-cahiers de charge — voir §11).
>
> **Note pour une session Claude sans historique reprenant ce dossier** : ce document + `FEATURES.md` sont tenus à jour après **chaque** feature livrée, pas seulement en fin de phase — c'est la source de vérité, pas le résumé d'une conversation passée. Avant de coder quoi que ce soit : lire ce document en entier (il est volontairement dense mais court), lire `FEATURES.md` pour savoir ce qui est fait/en cours/pas commencé, puis lancer la suite de tests (`npm run test` à la racine, ou `vitest run` dans `packages/game-engine`, `packages/rating`, `apps/server` individuellement) pour confirmer que l'état déclaré ici correspond bien au code réel avant d'ajouter quoi que ce soit dessus.

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
  rating/        Moteur de rating pur, testé unitairement (Phase 2b — aucune dépendance à Prisma ni au moteur de jeu)
  shared/        Types TypeScript + constantes partagés entre les 3 autres workspaces
infra/
  aws/       Infrastructure Terraform (AWS ECS Fargate, RDS, ALB, Route53, IAM, Secrets Manager)
scripts/     Scripts de bootstrap (setup AWS depuis un compte neuf, etc.)
```

Workspaces npm (`package.json` racine) : `npm run build` construit dans l'ordre `shared → game-engine → rating → server → web` (l'ordre est important, chacun dépend du précédent).

---

## 3. Le moteur de jeu (`packages/game-engine`)

### 3.1 Principe : machine à états + rôles en plug-in

`GameEngine.ts` est la classe centrale : elle possède l'état (`InternalState` — joueurs, phase, votes, timers logiques) et expose des méthodes d'action (`addPlayer`, `castDayVote`, `resolveNightActions`, etc.). Chaque partie tourne dans une instance séparée, **en mémoire**, tenue par `gameRegistry` côté serveur (voir §4.1).

Les **phases** (`packages/shared/src/types.ts`, `PHASES`) : `LOBBY → CHEF_CANDIDACY → CHEF_DEBATE → CHEF_VOTE → CHEF_REVEAL → DAY_1_DISCUSSION → NIGHT → MORNING → DAY_DISCUSSION → [CHEF_SECOND_DEBATE] → DAY_VOTE → DAY_VOTE_RESULT → [TIE_DEFENSE → DAY_VOTE (round 2)] → ... boucle NIGHT/DAY ... → ENDED`. L'égalité au vote est résolue de façon fixe, non configurable : une égalité au round 1 ouvre `TIE_DEFENSE` puis un unique second tour où les candidats à égalité ne votent plus eux-mêmes (seul le reste du village vote, uniquement pour ces candidats) ; si ce second tour est à nouveau une égalité, personne n'est éliminé et la partie continue. Aussi bien le vote du Chef (`CHEF_VOTE`) que le vote du jour (`DAY_VOTE`) se dépouillent **immédiatement dès que tout le monde a voté**, sans attendre l'expiration du minuteur — celui-ci reste un simple filet de sécurité pour les votants passifs/déconnectés (§11).

Chaque **rôle** (`packages/game-engine/src/roles/*.ts`) est un `RoleModule` : une nuit priority (ordre de résolution), un `shortDescription`, et sa propre logique d'action de nuit si applicable. Le seul fichier à modifier pour ajouter un rôle est `roles/registry.ts` (le registre) plus le nouveau module lui-même — jamais `GameEngine.ts`.

Rôles actuels (`ROLE_IDS`, `packages/shared/src/types.ts`) : `VILLAGEOIS, LOUP_GAROU, LOUP_BLANC, LOUP_VERT, SORCIERE, VOYANTE, SALVATEUR, CHASSEUR, CORBEAU, MOWGLI, BARBIE, ALIEN, PRETRE`. Chaque rôle a des métadonnées génériques dans `ROLE_METADATA` (équipe, description, a-t-il une action de nuit, a-t-il un déclencheur à la mort) — c'est cette table, jamais un `if (role === ...)`, qui pilote l'UI et (désormais) le calcul d'équipe pour les stats.

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

**186 tests** automatisés dans `packages/game-engine/src/__tests__/*.test.ts` (27 fichiers), `npm run test` (vérifié par exécution réelle — `vitest run` — pas par simple comptage). Couvrent : attribution des rôles, résolution de nuit par rôle, vote séquentiel, élection du Chef, égalités (round 2 = candidats exclus, égalité persistante = pas d'élimination, voir §11), victoire, `finalPlayerSummaries.test.ts`, la nuit séquentielle (§17.1, `sequentialNight.test.ts`), l'Afterlife (§17.3, `afterlife.test.ts`), le journal d'événements (§17.4a, `eventLog.test.ts`), et le rôle Prêtre (§11, `pretre.test.ts`).

**37 tests** dans `packages/rating` (rating, performance v2 — y compris `pretrePerformanceScore` —, coefficients — §3.5). **136 tests** dans `apps/server` (§17.1d `broadcast.test.ts`/§43 `timerOrdering.test.ts`, §17.3b `afterlife.test.ts`, §17.4c `badges/*.test.ts`, §17.4e `leaderboard.test.ts`, Phase 2a/3, plus §11 `idleCleanup.test.ts`/`wolfRoom.test.ts`/`notesRegistry.test.ts`).

**359 tests au total** (186 + 37 + 136), tous exécutés réellement (jamais un simple `grep "it("`), tous passants — vérifié en entier après chaque feature du lot du 16 août 2026 (§11), pas seulement à la fin.

**Comment lancer les tests dans cet environnement** : `node_modules/.bin/vitest` n'est parfois pas résolvable directement selon l'environnement d'exécution (symlink cassé observé dans le sandbox de développement autonome) — si `npx vitest run` échoue avec une erreur de résolution, chercher un `vitest` fonctionnel ailleurs dans l'arborescence `node_modules` (ex. via un cache `_npx`) plutôt que de conclure que les tests ne peuvent pas tourner. Sur une machine de développement normale (comme la vôtre, en PowerShell), `npm run test` depuis la racine ou `npx vitest run` depuis chaque package fonctionne directement, sans contournement.

---

## 3.5 Le moteur de rating (`packages/rating`) — Phase 2b

Package isolé, **sans dépendance à Prisma ni au moteur de jeu**, sur le même modèle que `packages/game-engine` : que des fonctions pures, entièrement testées (37 tests). C'est délibéré — c'est la seule façon de garder la logique de rating testable dans un environnement où le client Prisma généré n'est pas toujours disponible (voir §9).

- `roleDifficulty.ts` — coefficients par rôle (section 7), config seule, jamais lue par un `switch(roleId)`.
- `performance.ts` — `PERFORMANCE_SCORERS`, un registre par rôle **sur le même modèle que `ROLE_REGISTRY`** du moteur de jeu : une formule générique par défaut (`genericPerformanceScore`), remplaçable rôle par rôle sans toucher au reste. 10 rôles ont une vraie formule (Voyante, Salvateur, Sorcière, Alien, Loup Garou/Blanc/Vert, Chasseur, Barbie, Corbeau, et Prêtre depuis §11.8), chacune lisant `PerformanceContext.events`/`fullEventLog` — voir §3.7 pour le journal d'événements dont ça dépend. Villageois/Mowgli utilisent toujours la formule générique, à raison (aucune action à noter pour eux).
- `rating.ts` — `computeRatingDelta()`, la formule Elo-inspirée (section 9) ; `specializedScopeForTeam()` pour les ratings Village/Loups/Solo (section 10).

`apps/server/src/rating/applyRating.ts` est la seule couche qui touche Prisma : elle récupère les lignes nécessaires (utilisateurs liés, coefficients configurés), appelle les fonctions pures de `packages/rating`, et persiste le résultat. Appelée depuis `socket/handlers.ts`'s `sync()`, **après** `finalizeGameHistory()` (elle met à jour `PlayerRecord.ratingDelta` sur les lignes que `finalizeGameHistory` vient de créer — l'ordre compte).

---

## 3.6 XP, niveau et MVP (Phase 3)

Contrairement au rating, ceci n'a pas de package dédié — c'est assez petit pour vivre directement dans `apps/server`, toujours avec la même séparation "cœur pur testé / glue Prisma fine" :

- `progression/deriveProgression.ts` — pur : `computeBaseGameXp(won)` (participation + victoire), `computeMvpBonusXp()`, `computeLevel(totalXp)`. Testé (8 tests).
- `mvp/tallyMvpVotes.ts` — pur : dépouille les votes, retourne TOUS les joueurs à égalité au score maximum (règle produit confirmée explicitement). Testé (4 tests).
- `mvp/mvpVotingRegistry.ts` — état en mémoire du vote MVP, une entrée par partie (même schéma que `gameRegistry`), aucune dépendance à Prisma — testable et testé (9 tests) malgré la présence d'état mutable.
- `progression/applyProgression.ts` — la seule couche qui touche Prisma. `applyBaseProgression()` tourne à `GAME_ENDED`, comme `applyRatingUpdates`. `applyMvpBonus()` tourne séparément, une fois le vote MVP terminé — potentiellement bien après `GAME_ENDED`, donc il résout le compte de chaque gagnant via la ligne `PlayerRecord` déjà écrite par `finalizeGameHistory` plutôt que via `gameRegistry.userIdByPlayerId`, qui peut déjà avoir été vidé à ce moment-là.

Le vote MVP lui-même s'ouvre automatiquement dans `socket/handlers.ts`'s `sync()` dès que `GAME_ENDED` part, et se termine soit naturellement (tous les joueurs de la partie ont voté), soit via `ADMIN_FORCE_MVP_FINALIZE` (filet de sécurité pour un joueur déconnecté qui ne revient jamais voter — même logique que `ADMIN_FORCE_NEXT_PHASE` ailleurs dans l'app). Vote à bulletin secret : `MVP_STATE` ne diffuse jamais qui a voté pour qui, seulement la progression.

---

## 3.7 Journal d'événements, Badges, Classements (cahier de charge #2 §17.4)

**Le journal d'événements** (`GameEvent`, `packages/shared/src/gameEvents.ts`) est le prérequis technique de tout §17.4 : une union discriminée append-only (`GameInternalState.eventLog`, écrite via `EngineContext.recordEvent()` — même schéma que `ctx.log()`) qui capture chaque action à résultat connu (inspection de la Voyante, protection du Salvateur, potion de la Sorcière, tentative d'attaque des loups, tir du Chasseur, révélation de Barbie, devinette de l'Alien/du Loup Vert, chaque vote de jour et l'élimination qui en résulte, transformation de Mowgli).

**Pourquoi `GameEvent` vit dans `packages/shared` et pas `packages/game-engine`** : `packages/rating` doit pouvoir lire cette forme sans dépendre du moteur de jeu — exactement la même raison que `FinalPlayerSummary` vit déjà dans `shared` plutôt que dans `game-engine`. Un fichier `game-engine/src/events.ts` d'une seule ligne (`export type { GameEvent } from "@loupgarou/shared"`) reste en place pour que le code interne du moteur n'ait rien eu à changer.

**Où chaque événement est enregistré** — deux familles selon le moment où l'issue finale est connue :
- Dans `NightResolver.resolveNight()`, une fois par nuit, juste après `processDeaths` : tout ce qui dépend de la résolution complète (est-ce que la protection a sauvé la cible des loups ? est-ce que le poison a tué un loup ?) — impossible à savoir au moment de la soumission de l'action elle-même.
- Directement dans le module concerné (`roles/alien.ts`, `engine/LoupVert.ts`, `GameEngine.submitChasseurShot`, `engine/Barbie.ts`, `engine/VoteManager.ts`, `engine/DeathQueue.ts` pour Mowgli) quand le résultat est connu immédiatement.

**Badges** (`apps/server/src/badges/`) : `BADGE_REGISTRY` (`deriveBadges.ts`) est un registre en **code**, pas une table DB — même principe que `PERFORMANCE_SCORERS`/`ROLE_REGISTRY` : ajouter un badge est une entrée de tableau, jamais une migration. `deriveBadgeContribution.ts` (pur) traduit le journal d'un joueur pour UNE partie en compteurs persistés sur `PlayerRecord` (ex. `voyanteWolvesFound`) ; `applyBadges.ts` (glue Prisma) les SUM sur tout l'historique du compte et compare au registre — idempotent, ne fait jamais que des `INSERT`, jamais de suppression (un badge est permanent). Réévalué après chaque partie ET après la finalisation du vote MVP (`mvpCount` n'est mis à jour qu'à ce moment-là, bien après `GAME_ENDED`).

**Classements** (`getLeaderboard()`, `db/persistence.ts`) : confirment la prédiction de FEATURES.md section 14 — aucune donnée manquante. Rating/XP/MVP sont un simple tri sur une colonne `User` déjà tenue à jour ; seul "victoires" demande un vrai agrégat (`groupBy` sur `PlayerRecord`). `GET /api/leaderboard` et `GET /api/profile/:username` (comparaison de profils, §17.4f) sont volontairement **publics** (pas de `requireSession`) — contrairement à `/profile/me`/`/badges/me`/`/history/me` — parce qu'un classement ou un profil comparé n'est pas une donnée privée.

---

## 4. Le serveur temps réel (`apps/server`)

### 4.1 `gameRegistry.ts` — état vivant, en mémoire

Une `Map<code, GameEngine>` tenue pendant toute la durée du process. Pas de mot de passe admin partagé : créer une partie donne un `hostToken` aléatoire au créateur, seul moyen de ré-administrer cette partie précise plus tard.

Depuis la Phase 1, `gameRegistry` tient aussi `userIdByPlayerId: Map<playerId, userId>` — le lien "quel compte se cache derrière ce joueur, dans cette partie". **Ce lien est en mémoire, jamais sur `InternalPlayer`** : c'est ce qui garde le moteur de jeu totalement ignorant de l'existence des comptes. Il est peuplé sur `PLAYER_JOIN`/`PLAYER_RECONNECT`, consommé une fois à `GAME_ENDED`, puis nettoyé (`clearPlayerUserIds`).

### 4.2 `socket/handlers.ts` — la boucle d'événements

Chaque action mutante (vote, action de nuit, etc.) passe par `sync(io, engine)` en fin de handler : elle rediffuse l'état public à tous, réarme les timers de phase, et — point important — appelle **une seule fois, de façon centralisée**, `finalizeGameHistory()` quand la partie se termine (peu importe la cause : vote, timer auto, ou admin qui force la phase suivante). C'est ce point d'entrée unique qui garantit qu'aucune partie terminée n'échappe à l'écriture d'historique.

`PLAYER_JOIN` exige désormais un cookie de session valide (lu depuis `socket.handshake.headers.cookie` — le cookie voyage automatiquement avec la connexion Socket.IO grâce à `withCredentials: true` côté client et `cors({ credentials: true })` côté serveur). Sans session : rejet explicite, pas de "joueur fantôme" non rattaché à un compte. `PLAYER_RECONNECT` réaffirme ce lien de façon best-effort (ne bloque jamais une reconnexion si le cookie a expiré).

**18 août 2026 (§25) — retry-safety générique.** Chaque `socket.on(SOCKET_EVENTS...)` de ce fichier passe par un petit adaptateur local `on(...)` (juste après le middleware de logs, avant tout enregistrement de handler) qui enveloppe le handler avec `wrapForIdempotency()` (`socket/idempotency.ts`). Si le payload porte un `__rid` déjà vu pour ce joueur+événement (généré côté client par `emitWithAck`, réutilisé à chaque nouvelle tentative d'un même appel), la réponse mise en cache est rejouée et le handler réel — donc tout effet de bord qu'il contient — ne s'exécute jamais deux fois. Volontairement générique plutôt qu'audité événement par événement : voir le commentaire en tête de `idempotency.ts` pour le raisonnement complet.

### 4.3 Persistance (`db/persistence.ts`, `db/prisma.ts`, Prisma/Postgres)

Trois responsabilités, toutes **best-effort** (une panne DB ne doit jamais planter ou geler une partie en cours) :

- `persistGame()` — snapshot de l'état complet de chaque partie active (`Game.stateJson`), pour survivre à un redémarrage serveur.
- `finalizeGameHistory()` — à `GAME_ENDED`, upsert **idempotent** (via la contrainte `@@unique([gameId, enginePlayerId])`) d'une ligne `PlayerRecord` par joueur : rôle, équipe, résultat (`WON`/`LOST`/`DRAW`, calculé depuis `team` vs `Game.winner`), cause et moment de mort, et **le compte lié si connu**.
- `getUserAggregateStats()` / `getUserGameHistory()` — lecture, calculée à la volée (pas de cache) depuis les lignes `PlayerRecord` d'un compte. Le regroupement par rôle est **entièrement générique** : un nouveau `roleId` qui apparaît dans les données s'affiche automatiquement, aucune modification de code requise. Le calcul lui-même (séries de victoires, nuits survécues, répartition des causes de mort) vit dans `apps/server/src/stats/deriveStats.ts` — des fonctions pures, sans Prisma, testées indépendamment (13 tests) ; `getUserAggregateStats()` ne fait que récupérer les lignes et les leur transmettre.
- `applyRatingUpdates()` (`apps/server/src/rating/applyRating.ts`) — même schéma : récupère les lignes, appelle `packages/rating` (§3.5), persiste. Best-effort comme tout le reste.

### 4.4 Comptes (`auth/`, `http/authRoutes.ts`, `http/accountRoutes.ts`)

- `auth/passwords.ts` — hachage bcrypt.
- `auth/jwt.ts` — signe/vérifie un JWT contenant `{ userId, username }`.
- `auth/cookies.ts` — pose/lit/efface le cookie de session (`httpOnly`), et **une seule fonction** (`readSessionFromCookieHeader`) est utilisée à la fois par les routes Express (via `req.headers.cookie`) et par le handshake Socket.IO — un seul endroit qui sait décoder le cookie.
- `POST /api/auth/signup` — username (3-20 car., unique) + mot de passe (8+ car.) + email optionnel. `displayName` = `username` par défaut.
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
- `GET /api/profile/me` — identité + stats agrégées (section 3+4 du cahier de charge, en un seul appel).
- `GET /api/profile/:username` — même forme que `/profile/me`, mais **public** (comparaison de profils, §17.4f).
- `GET /api/history/me?limit=&offset=` — historique paginé (section 5).
- `GET /api/badges/me` — badges débloqués/à débloquer (§17.4c).
- `GET /api/leaderboard?category=&limit=` — **public** (§17.4e).

### 4.5 Schéma Prisma (`prisma/schema.prisma`)

```
User            — compte permanent (identité réelle). username unique, email unique optionnel, passwordHash, displayName,
                   ratingGlobal/ratingVillage/ratingWolf/ratingSolo (tous @default(1000), Phase 2b).
Game            — une partie (code, phase, config, snapshot d'état, gagnant, finalNightNumber/finalDayNumber — Phase 2a,
                   snapshot pris une seule fois à ENDED).
PlayerRecord     — une ligne = un joueur dans une partie donnée : nickname (pseudo temporaire, JAMAIS utilisé pour les stats),
                   roleId, team, result, deathCause, deathMoment, ratingDelta (Phase 2b, informationnel),
                   userId (nullable, SetNull si le compte est supprimé), + contribution de CETTE partie aux totaux de
                   carrière des badges (§17.4c — voyanteWolvesFound, salvateurSuccessfulProtects, ..., wasSoleSurvivor).
                   @@unique([gameId, enginePlayerId]) → upsert idempotent.
GameLogEntry    — journal texte d'une partie (debug/admin).
Preset          — configurations de partie sauvegardées par l'admin.
RoleDifficulty  — coefficients de difficulté par rôle (Phase 2b, section 7), réglables à l'exécution sans redéploiement ;
                   seedé au démarrage du serveur depuis packages/rating's DEFAULT_ROLE_DIFFICULTY.
UserBadge       — quels badges un compte a débloqués, et quand (§17.4c). La définition des badges (nom/description/
                   condition) vit en CODE (badges/deriveBadges.ts's BADGE_REGISTRY), jamais ici — badgeId est une
                   simple string, pas une clé étrangère vers une table de définitions qui n'existe pas.
```

**Migration locale : automatique, rien à faire.** `docker-compose.yml`'s service `server` lance `npx prisma db push --skip-generate --accept-data-loss && npx tsx src/index.ts` comme commande de démarrage — donc **chaque** `docker compose up` (donc chaque lancement de `start-app.ps1`) pousse déjà tout `schema.prisma` (y compris `UserBadge` et les colonnes `PlayerRecord` du §17.4c) vers la base Postgres locale avant même que le serveur ne démarre. Si le conteneur `server` a démarré sans erreur, le schéma local EST à jour — pas de commande manuelle à lancer en local.

**⚠️ Ce qui reste réellement en attente : la base AWS RDS de production**, complètement séparée de la base Postgres locale ci-dessus. `.deploy-marker` (racine du repo) pointe vers le dernier commit effectivement déployé sur AWS — si ce marqueur est antérieur à un commit qui touche `schema.prisma`, la RDS de prod n'a pas ce changement. Voir §8 (`deploy-manual.ps1` bloque automatiquement dans ce cas, et note sur l'usage réel d'AWS aujourd'hui — probablement plus la voie principale, à confirmer avec l'utilisateur).

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

> **⚠️ À confirmer avec l'utilisateur, pas une certitude technique** : l'usage réel aujourd'hui (16 août 2026) semble être `start-app.ps1`/`stop-app.ps1` — Docker Compose local + Tailscale Funnel pour exposer l'app à internet le temps d'une soirée de jeu — plutôt que le déploiement AWS ECS décrit ci-dessous. L'infra Terraform et `deploy-manual.ps1` restent dans le repo et *devraient* toujours fonctionner (rien ne les a supprimés), mais aucune session Claude n'a d'accès AWS pour vérifier si le service ECS tourne encore réellement ou a été arrêté/décommissionné. **Ne pas supposer qu'AWS est la cible de déploiement active sans le confirmer avec l'utilisateur d'abord.**

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
- **`npm install` échoue avec `ENOTEMPTY` directement sur ce même point de montage** (rename atomique non supporté par le montage réseau) — fonctionne normalement dans un dossier de travail local classique ; sans impact pour vous en PowerShell sur votre propre machine.
- **Le bac à sable où ce travail autonome a été fait n'a aucun identifiant git pour `git push`** — les commits/tags sont réels (écriture disque directe sur le dépôt), mais restent locaux jusqu'à ce qu'un `git push` soit lancé depuis une machine avec les bons identifiants. Toujours vérifier `git log`/`git status` après une session autonome pour voir ce qui attend d'être poussé.
- **Le client Prisma généré ne peut pas être régénéré dans ce même bac à sable** (CDN de binaires bloqué) — un `tsc --noEmit` "propre" sur `apps/server` dans cet environnement n'est PAS une preuve fiable de correction : le client généré présent y est soit absent, soit périmé (schéma d'avant les comptes), ce qui peut soit faire échouer la compilation à tort, soit — plus insidieux — la faire réussir à tort si des annotations de type explicites masquent l'incohérence. Tout code touchant Prisma doit être relu à la main contre `schema.prisma`, jamais considéré "vérifié" simplement parce que `tsc` n'a rien dit dans cet environnement précis.
- **Incident du 08/08/2026 : migration Phase 3 jamais appliquée en prod** — `schema.prisma` avait bien les colonnes `User.totalXp`/`level`/`mvpCount` (Phase 3), mais `npx prisma db push` n'avait jamais été lancé contre la RDS de prod avant le déploiement. Résultat : `GET /me` plantait tout le process Node au premier `/login` (Prisma `P2022`, colonne manquante), et ECS redémarrait en boucle sur le même mur — plus aucun joueur ne pouvait se connecter. Deux corrections apportées :
  1. **`asyncHandler.ts`** (`apps/server/src/http/`) + middleware d'erreur global dans `index.ts` + `process.on("unhandledRejection"/"uncaughtException")` — une erreur inattendue sur UNE requête ne doit plus jamais faire tomber TOUT le serveur (donc toutes les parties en cours) ; elle ne casse maintenant que cette requête (500 propre).
  2. **`deploy-manual.ps1`** détecte désormais si `apps/server/prisma/schema.prisma` a changé depuis le dernier déploiement réussi (marqueur local `.deploy-marker`, gitignored) et bloque avec les commandes exactes à lancer avant de continuer — pas d'automatisation complète possible : `aws ecs execute-command` est une session SSM interactive, pas de mode "une seule commande" scriptable proprement.
- **`emitWithAck` (`apps/web/src/lib/socket.ts`) doit TOUJOURS avoir un `.timeout()`.** Sans lui, un accusé de réception perdu (connexion qui se coupe/rétablit en plein milieu d'une requête — le cas courant sur téléphone) laisse la Promise ne jamais se résoudre ni rejeter — un blocage silencieux et permanent pour n'importe quel appelant qui l'attend. Découvert le 17 août 2026 quand le correctif "ne jamais confirmer avant l'ack" (piège suivant ci-dessous) a transformé ce trou préexistant en bug visible : Voyante qui ne révèle rien, votes qui traînent, loups qui n'arrivent pas à tuer, tous les trois remontés le même soir par une vraie partie à 10 joueurs. Le correctif (`.timeout(10_000)`) est dans `emitWithAck` lui-même, donc s'applique automatiquement à TOUT appel — inutile de dupliquer une logique de délai dans un composant individuel.
- **Tout nouveau composant qui soumet une action doit attendre `onSubmit`/`onSelect` lui-même OU laisser l'appelant l'attendre — jamais les DEUX.** Piège concret rencontré le 17 août 2026 : le vote du jour avait un `try/catch` au niveau de la page qui avalait l'erreur avant que `LiveVoteList` (qui a déjà son propre `try/catch` avec réinitialisation de `submitting`/`armedId` sur échec) ne la voie jamais — résultat, sur un vrai échec, `LiveVoteList` restait bloqué en `submitting: true` pour toujours, aucune réinitialisation possible sans recharger la page. Un composant qui gère déjà proprement ses propres erreurs (regarder s'il a son propre `submitting`/`error` state avant d'en ajouter un autre par-dessus) n'a besoin de RIEN de plus côté appelant — laisser le rejet remonter tel quel.
- **Piège UI découvert le 17 août 2026 : ne jamais afficher une confirmation avant d'avoir le vrai accusé de réception du serveur.** Plusieurs boutons d'action (`NightPromptPanel.tsx`, le vote du jour dans `play/[code]/page.tsx`) appelaient `onSubmit(...)` — une fonction async qui fait un aller-retour `emitWithAck` — sans l'attendre ni capter une éventuelle erreur, puis basculaient immédiatement sur l'écran "Action envoyée"/optimiste. Un échec silencieux (déconnexion, rejet serveur, connexion Tailscale instable) avait donc l'air strictement identique à une réussite, sans aucun moyen pour le joueur de s'en rendre compte ni de réessayer — c'est ce qui causait le bug remonté "le pouvoir du Prêtre ne marche pas" et une partie des "je n'ai pas pu voter" (voir `FEATURES.md` §19). Corrigé en centralisant chaque soumission derrière un `await` réel avant de confirmer, avec affichage d'erreur sinon (`submitAndConfirm` dans `NightPromptPanel.tsx` — gabarit à réutiliser). **Tout nouveau bouton d'action de jeu doit suivre ce patron** — jamais de confirmation optimiste avant l'ack.
- **Comment lancer la vraie suite `vitest` complète via Docker sur cette machine (17 août 2026)** : `node`/`npm` ne sont pas sur le PATH de cette machine Windows, donc `npm run test` échoue directement. Contournement qui marche : l'image `server` construite (`docker compose build server`) copie déjà tout le monorepo (`packages/*` + `apps/server`) et fait `npm install` — il ne lui manque que `tsconfig.base.json` à la racine (jamais copié par son `Dockerfile`, qui ne copie que des sous-dossiers précis). Monter le repo hôte en lecture seule et copier ce seul fichier avant de lancer les tests :
  ```powershell
  docker compose run --rm -v "${PWD}:/hostrepo:ro" server sh -c "cp /hostrepo/tsconfig.base.json /app/tsconfig.base.json && cd /app && npm run test"
  ```
  Lancer `npx vitest run <fichier>` depuis `/app/apps/server` ou `/app/packages/game-engine` à l'intérieur du même conteneur pour cibler un seul fichier. Ne PAS essayer de lancer les tests dans le conteneur `server` déjà démarré/en production (`docker exec claude_loupgarou-server-1 ...`) — celui-ci ne contient QUE son propre sous-arbre (voir son `Dockerfile`), pas le monorepo complet, et échoue pour une raison différente (`tsconfig.base.json` introuvable également, mais parce que les packages frères ne sont même pas copiés).
- **Test `apps/server/src/socket/idleCleanup.test.ts` → "any successful gameRegistry.requireGame() call resets the idle clock" — CORRIGÉ le 18 août 2026, cause racine identifiée.** Repéré comme "instable" le 17 août 2026 (voir historique ci-dessous) mais jamais creusé jusqu'au bout ce jour-là. En le reproduisant en isolation (`vitest run idleCleanup.test.ts -t "resets the idle clock"` avec des `console.log` temporaires), la vraie cause s'est révélée être un bug de mock, pas une histoire de latence I/O : le test appelait `vi.spyOn(Date, "now")` une PREMIÈRE fois pour mocker l'horloge, puis une SECONDE fois juste pour appeler `.mockRestore()` dessus — sauf que ce second appel crée un nouveau spy qui enveloppe le premier mock, et le "restaurer" ne fait que revenir à CE mock, jamais à la vraie horloge système. Résultat : `Date.now()` restait figé sur la valeur mockée pour le reste du test, ce qui faussait le calcul de `justPastOriginalDeadline` et faisait échouer l'assertion. Corrigé en gardant la référence du premier spy (`const dateSpy = vi.spyOn(...)`) et en restaurant CETTE instance précise (`dateSpy.mockRestore()`) — patron à toujours suivre pour mocker/restaurer `Date.now` (ou n'importe quel spy) dans ce repo : ne jamais ré-appeler `vi.spyOn` juste pour restaurer, toujours garder la référence retournée par le premier appel. *(Historique : `git diff` vide contre `85f3855` avait confirmé le 17/08 que le bug préexistait déjà à ce commit — cohérent avec le fait que c'est un bug de test présent depuis le commit d'origine `a7896e6`, pas une régression récente.)*
- **L'outil navigateur automatisé (Browser pane / Claude Browser) ne supporte pas — ou bloque — les connexions WebSocket vers `localhost:4000`** (découvert le 17 août 2026 en tentant un playtest live du roster de rôles). Confirmé : une requête HTTP simple vers `localhost:4000/` aboutit normalement (`Cannot GET /`, réponse Express réelle), mais la connexion Socket.IO échoue avec des `ERR_CONNECTION_CLOSED` répétés dans la console — et les logs du conteneur `server` ne montrent AUCUNE tentative de connexion entrante, donc le blocage a lieu avant même d'atteindre le serveur (pas un rejet CORS/app). **Toute partie réelle en jeu (qui dépend entièrement de Socket.IO) n'est donc pas testable de bout en bout via cet outil** — inutile de perdre du temps à essayer de contourner ça ; un vrai playtest nécessite un vrai navigateur (celui de l'utilisateur) ou l'outil Claude-in-Chrome.
- **Le funnel Tailscale sur deux ports séparés (3000 + 8443) cassait la connexion sur certains wifi — corrigé le 18 août 2026, voir §22 `FEATURES.md`.** Retours réels : des joueurs n'arrivaient parfois pas à se connecter en wifi mais réussissaient en passant sur les données mobiles. Cause : le serveur (Socket.IO + API) vivait sur son propre port Funnel (`:8443`, seul choix restant puisque Funnel n'autorise que 443/8443/10000 et que 443 était pris par l'app web) — beaucoup de wifi restrictifs (invités, hôtels, bureaux) bloquent les ports non standards comme 8443 en sortie tout en laissant passer le 443 ; les données mobiles ne bloquent quasiment jamais rien. Un nouveau service `proxy` (nginx, `proxy/nginx.conf`) fronte maintenant `web` et `server` sur un seul port (3000), routé par chemin (`/socket.io`, `/api` → serveur ; le reste → web) — un seul port à funneler désormais, voir `TAILSCALE_SETUP.md` mis à jour. **Non testé en conditions réelles** (l'environnement Claude n'a ni Docker ni les droits root pour installer nginx) — syntaxe de `nginx.conf` et structure de `docker-compose.yml` validées, comportement réel à confirmer à la prochaine soirée de jeu.
- **Bug du 8 août 2026 : le timer côté joueur affichait parfois "0:00" ou semblait désynchronisé** (rapporté après test Docker de la nuit séquentielle, mais en réalité présent depuis toujours sur TOUTES les phases — discussion du jour, vote du village, débat du Chef, etc.). Cause racine : `pushAllPrompts` (diffuse `GAME_STATE.phaseEndsAt`, et pendant la nuit `NIGHT_PROMPT`/`NIGHT_STEP_STATE.deadlineAt`) était appelé AVANT `schedulePhaseTimer` — le seul endroit qui calcule réellement un nouveau `phaseEndsAt` (via `GameEngine.setPhaseTimer`) — à 5 endroits (`handlers.ts`'s `sync()`, et 4 fois dans `timers.ts`). Résultat : chaque transition (nouveau tour de parole, nouvelle étape de nuit, etc.) diffusait d'abord l'ancienne échéance déjà expirée, et la vraie échéance n'atteignait les clients qu'à la prochaine action sans rapport qui déclenchait une nouvelle diffusion. Corrigé en inversant l'ordre des deux appels aux 5 endroits — toujours `schedulePhaseTimer` puis `pushAllPrompts`, jamais l'inverse. Tests de non-régression dans `apps/server/src/socket/timerOrdering.test.ts` (vérifiés en désactivant temporairement le correctif : les 3 tests échouent bien sans lui).

---

## 11. Lot de features additionnelles (16 août 2026)

Huit demandes ponctuelles de l'utilisateur, hors des deux cahiers de charge, livrées en une session autonome (voir `FEATURES.md` §18 pour le suivi produit — cette section couvre le **comment technique**). Un commit + un tag Git indépendant par feature, 359/359 tests passants après chacune. Trois d'entre elles introduisent un **nouveau pattern architectural** (§11.1) qui sera probablement réutilisé pour de futures features similaires — à lire en premier.

### 11.1 Nouveau pattern : registres serveur éphémères, hors du moteur de jeu

Trois features (auto-fermeture des parties inactives, aperçu en direct de la cible des loups, notes personnelles) ont chacune besoin d'un peu d'état **côté serveur, temporaire, jamais persisté** — mais aucune de ces informations n'appartient au moteur de jeu pur (`packages/game-engine`), qui doit rester sérialisable/snapshotable sans rien connaître d'administratif ou d'UI. Le principe appliqué systématiquement :

> Un `Map<code, ...>` (ou `Map<code, Map<playerId, ...>>`) module-level, défini dans `apps/server/src/<domaine>/`, **jamais** dans `internalTypes.ts`/`GameInternalState`. Vidé explicitement au bon moment (fin de partie, fermeture de partie), jamais laissé fuiter indéfiniment.

Trois instances concrètes de ce pattern, à utiliser comme gabarit pour la prochaine feature du même genre :

- **`apps/server/src/gameRegistry.ts`** (`lastActivityAt: Map<code, timestamp>`) + **`apps/server/src/socket/idleCleanup.ts`** — `touch(code)` réarme l'horloge à chaque `requireGame()` (donc à chaque action quelconque sur la partie). Un balayage périodique (`setInterval`, non-`ref`'d pour ne jamais empêcher le process de s'arrêter proprement) compare `Date.now()` aux seuils par phase : lobby vide 1h, partie terminée 30 min, partie en cours abandonnée 4h. Ferme via `GAME_CLOSED` (diffusé avant la coupure) puis `io.in(room).socketsLeave(room)` puis `gameRegistry.remove(code)` (qui purge aussi `adminSocketByCode`/`hostTokenByCode`/`userIdByPlayerId`).
- **`apps/server/src/socket/wolfTargetPreview.ts`** (`previewsByGame: Map<code, Map<voterId, targetId>>`) — écrit sur l'événement `WOLF_TARGET_PREVIEW` (émis à chaque changement de sélection, **avant** confirmation), lu par `pushWolfRoomState` pour diffuser à toute la meute. Vidé automatiquement dès que `nightNumber` change pour ce code (`lastNightNumberByGame`, comparé avec un garde `.has()` — **piège rencontré et corrigé** : `undefined !== nightNumber` est toujours vrai, donc sans le `.has()` la toute première prévisualisation de chaque partie s'effaçait elle-même instantanément).
- **`apps/server/src/notes/notesRegistry.ts`** (`notesByGame: Map<code, Map<playerId, text>>`) — `saveNote`/`getNote`, plafonné à 5000 caractères. Purgé **une seule fois, au seul endroit qui diffuse `GAME_ENDED`** (dans `sync()`, `socket/handlers.ts`) — jamais avant, jamais à la déconnexion d'un joueur (les notes doivent survivre à une reconnexion).

### 11.2 Vote du jour — égalité re-codée en dur (remplace `TIE_REVOTE`)

L'ancien filet de sécurité `TIE_REVOTE`/`ADMIN_RESOLVE_TIE`/`TieResolutionRule` (résolution manuelle par l'admin en cas de nouvelle égalité) a été **entièrement retiré** — plus simple, zéro ambiguïté, cohérent avec « aucune valeur codée en dur sauf la règle elle-même, assumée comme règle de la maison ». Voir §3.1 pour la règle en vigueur. Techniquement :

- `DayVoteQueue.buildVoteOrder(ctx)` exclut `ctx.state.dayVote.tiedIds` de l'ordre de vote quand `round >= 2`.
- `VoteManager.resolveRepeatedTie(ctx, topIds)` ne fait plus qu'une chose : ne déclarer aucune élimination. Plus de paramètre `rng`, plus de switch `REPEAT_DEFENSE/RANDOM/CHEF_DECIDES/ADMIN_DECIDES`.
- `GameEngine.startDayVoteQueueOrTally()` (nouveau) gère le cas limite où tous les joueurs vivants restants sont des candidats à égalité (queue de vote vide) en dépouillant immédiatement au lieu de rester bloqué en attente de votants qui n'existent plus.

### 11.3 Auto-fermeture des parties inactives

Voir §11.1 pour le mécanisme. Démarré une seule fois au boot serveur (`startIdleCleanupSweep(io)`, `apps/server/src/index.ts`, juste après `registerSocketHandlers(io)`).

### 11.4 Popup de reprise de partie à la connexion

`gameRegistry.findOpenGamesForUser(userId)` (exclut les parties `ENDED`) exposé via `GET /api/account/open-games` (protégé par session). Côté web, `components/RejoinPrompt.tsx` (monté une seule fois dans `app/layout.tsx`, à l'intérieur de `AccountProvider`) l'interroge à la connexion, filtre la partie de la page courante (regex sur `usePathname()`) et les parties déjà rejetées cette session (`sessionStorage`), puis propose « Rejoindre »/« Plus tard » par partie.

### 11.5 Bouton retour à l'accueil en fin de partie

Purement présentation : `components/EndGamePanel.tsx`'s nouveau `NewGamePanel` (joueur, appelle `clearPlayerSession()` puis redirige) et un bouton dans `ControlBar` de `app/admin/[code]/page.tsx`, gated sur `phase === "ENDED"`. Aucun changement serveur/moteur.

### 11.6 Aperçu en direct de la cible des loups

Voir §11.1 pour le registre. `GameEngine.getWolfKillVotes()` (nouveau getter, retourne une copie défensive de `nightScratch.wolfVotes`) expose les votes **déjà confirmés** ; `WolfRoomStatePayload.previewVotes` (nouveau champ) expose les votes **en cours de sélection, pas encore confirmés**. Le client (`NightPromptPanel.tsx`, branche `KILL_VOTE`) fusionne les deux — confirmé toujours prioritaire sur prévisualisé pour un même loup — et affiche les non-confirmés en pulsant avec un « … ». Émis à chaque changement de sélection locale (`onPreview`, avant le clic « Confirmer »), effacé sur confirmation réelle et sur démontage du composant (loup qui change d'écran en pleine réflexion).

### 11.7 Notes personnelles synchronisées

Voir §11.1 pour le registre serveur. Côté web, `components/NotesButton.tsx` : bouton flottant, chargement paresseux à la première ouverture (`NOTES_GET`), sauvegarde debouncée 800 ms (`NOTES_SAVE`) + flush immédiat à la fermeture/démontage pour ne jamais perdre les dernières frappes sous la fenêtre de debounce.

### 11.8 Nouveau rôle : Prêtre

Rôle Village, pouvoir à usage unique, activable la nuit de son choix **dès la nuit 1**, ciblant n'importe quel joueur vivant **y compris lui-même**. Implémenté en suivant exactement le patron déjà établi par `roles/alien.ts` — **le seul autre rôle du jeu dont `applyNightAction` appelle `processDeaths` directement**, plutôt que d'agréger dans `nightScratch` pour une résolution différée dans `NightResolver.resolveNight()` (le chemin suivi par la Sorcière/le Salvateur/les loups). Ce patron convient à toute issue **binaire, connue immédiatement à la soumission de l'action** (vie/mort, pas de dépendance à ce que d'autres rôles font la même nuit) :

```ts
applyNightAction(ctx, actor, action) {
  // ... valider l'action ...
  const hitWolf = ROLE_METADATA[target.roleId].team === "LOUPS";
  if (hitWolf) processDeaths(ctx, [{ playerId: target.id, cause: "..." }]);
  else processDeaths(ctx, [{ playerId: actor.id, cause: "..." }]); // inclut le cas où target === actor
}
```

Parce que la mort passe par `processDeaths` (le même chemin universel que toute autre mort — voir `DeathQueue.ts`), la révélation de mort standard s'applique automatiquement (rôle rendu public, cause toujours réservée à l'admin) et le vol par le Loup Vert fonctionne aussi automatiquement (`engine/LoupVert.ts`'s canal de vol générique rejoue `buildNightPrompt`/`applyNightAction` du rôle volé tel quel, contre l'objet joueur de la victime dépouillée) — **aucun cas particulier écrit nulle part pour ce rôle**, conformément au principe d'architecture générique (§16 de `FEATURES.md`). Le pouvoir à usage unique est gardé par un booléen simple sur `InternalPlayer` (`pretreShotUsed`), exactement le même patron que `sorciereHealUsed`/`sorcierePoisonUsed`/`barbiePowerUsed` — `buildNightPrompt` retourne `null` une fois utilisé, plutôt que de gater via `isActiveOnNight` (qui reste `true` toute la partie, pour rester éligible au vol du Loup Vert même après usage... **attention** : en pratique un Loup Vert ne peut voler un pouvoir déjà dépensé de façon utile, puisque `buildStolenPowerPrompt` rejoue `buildNightPrompt` contre le même `pretreShotUsed`).

---

## 12. Où trouver quoi (index rapide)

| Je cherche... | Fichier |
|---|---|
| Ajouter un nouveau rôle | `packages/game-engine/src/roles/*.ts` + `roles/registry.ts` + `ROLE_METADATA` dans `packages/shared/src/types.ts` |
| Changer une règle de résolution de nuit | `packages/game-engine/src/engine/NightResolver.ts` |
| Changer le vote du village | `packages/game-engine/src/engine/DayVoteQueue.ts`, `VoteManager.ts` |
| Ajouter un champ au profil/historique | `apps/server/prisma/schema.prisma` → `apps/server/src/db/persistence.ts` → `apps/server/src/http/accountRoutes.ts` → page Next.js correspondante |
| Ajouter/ajuster une statistique dérivée | `apps/server/src/stats/deriveStats.ts` (calculs purs, testés) → `apps/server/src/db/persistence.ts` (glue Prisma) → `apps/web/src/app/profile/page.tsx` |
| Ajuster la formule de rating / performance / coefficients de rôle | `packages/rating/src/*.ts` (tout est pur et testé ici) — jamais dans `apps/server/src/rating/applyRating.ts`, qui ne fait que la glue Prisma |
| Ajouter/ajuster une vraie formule de performance par rôle | `packages/rating/src/performance.ts`'s `PERFORMANCE_SCORERS` — lit `GameEvent[]` (§3.7), déjà rempli pour 10 rôles |
| Ajouter un nouveau type d'événement au journal | `packages/shared/src/gameEvents.ts`'s `GameEvent` union, puis `ctx.recordEvent(...)` au bon endroit côté moteur — voir §3.7 |
| Ajouter un nouveau badge | `apps/server/src/badges/deriveBadges.ts`'s `BADGE_REGISTRY` — une entrée, jamais de migration (§3.7) |
| Ajouter une catégorie de classement | `apps/server/src/db/persistence.ts`'s `getLeaderboard()`/`LEADERBOARD_CATEGORIES` (§3.7) |
| Ajouter un rôle avec un pouvoir de nuit binaire vie/mort (comme Prêtre/Alien) | `roles/alien.ts` ou `roles/pretre.ts` comme gabarit — `applyNightAction` appelle `processDeaths` directement, voir §11.8 |
| Ajouter une feature qui a besoin d'un petit état serveur temporaire (pas persisté, pas dans le moteur) | Gabarit : `apps/server/src/socket/wolfTargetPreview.ts` ou `apps/server/src/notes/notesRegistry.ts` — voir §11.1 |
| Changer les seuils de fermeture automatique des parties inactives | `apps/server/src/socket/idleCleanup.ts` (`IDLE_LOBBY_MS`/`IDLE_ENDED_MS`/`IDLE_ABANDONED_MS`) — voir §11.3 |
| Modifier l'infra AWS | `infra/aws/*.tf` — **toujours relire le plan avant d'approuver** |
| Comprendre le cahier de charge original et ce qu'il reste à faire | `FEATURES.md` |
| Annuler (rollback) un lot de travail déjà commité/tagué | §13 ci-dessous — tableau complet des tags avec date/commit/commande exacte |

---

## 13. Convention : commit + tag + doc à jour, à chaque lot de travail

Adoptée le 17 août 2026, à la demande explicite de l'utilisateur, pour tout travail à venir (feature ou correctif) : chaque lot se termine par —

1. **Un commit** (ou groupe de commits liés) avec un message qui explique le *pourquoi*, pas seulement le *quoi*.
2. **Un tag Git annoté dédié** (`git tag -a <nom> -m "..."`), posé sur le dernier commit du lot, jamais recyclé pour un lot différent.
3. **Une entrée dans `FEATURES.md`** (suivi produit) et, si le lot introduit un nouveau patron technique ou un piège appris à la dure, une entrée correspondante ici — toutes deux mentionnant explicitement la date, le(s) hash(es) de commit, le nom du tag, et la commande exacte de rollback.

**Pour annuler n'importe quel lot déjà tagué** : repérer le commit juste *avant* le premier commit du lot (colonne « Avant le lot » ci-dessous, ou `git log --oneline`), puis :

```bash
git checkout <hash-avant-le-lot>       # regarder l'état d'avant sans rien casser (detached HEAD)
# ou, pour vraiment faire reculer master :
git reset --hard <hash-avant-le-lot>   # ⚠️ destructif sur tout commit local non poussé ailleurs
```

Un tag pointe toujours sur le *dernier* commit du lot qu'il nomme — pour l'annuler, c'est donc le commit **parent** (une ligne plus haut dans `git log`) qu'il faut viser, pas le tag lui-même.

### Historique des tags (le plus récent en premier)

| Tag | Date | Commit | Avant le lot | Contenu |
|---|---|---|---|---|
| `bugfix-ack-timeout-powers-votes` | 2026-08-17 | `6590fd1` | `d2ef138` | `emitWithAck` sans délai d'expiration = boutons bloqués indéfiniment (Voyante, votes, loups) ; + 4 pouvoirs jamais protégés (Chasseur, succession Chef, Loup Vert, Barbie) ; + régression du vote du jour du §19 — `FEATURES.md` §21 |
| `feature-role-roster` | 2026-08-17 | `21f99fc` | `dca39c2` | Composition des rôles (pas l'identité) visible par tous, toute la partie, via bouton persistant — `FEATURES.md` §20 |
| `bugfix-chasseur-pretre-dayvote` | 2026-08-17 | `575298d` | `85f3855` | Fuite de rôles Chasseur→Afterlife, confirmations d'action silencieusement fausses (Prêtre etc.), tour de vote du jour manqué sans avertissement — `FEATURES.md` §19 |
| `feature-batch-8-complete` | 2026-08-16 | `7a41057` | `6559c64`* | Clôture doc du lot de 8 features ci-dessous (pas du code en soi) |
| `feature-pretre-role` | 2026-08-16 | `6559c64` | `efbdf19` | Nouveau rôle Prêtre — `FEATURES.md` §18.8, §11.8 |
| `feature-personal-notes` | 2026-08-16 | `efbdf19` | `5d4a53b` | Notes personnelles synchronisées — `FEATURES.md` §18.7, §11.7 |
| `feature-wolf-live-preview` | 2026-08-16 | `5d4a53b` | `f2e6f34` | Aperçu en direct de la cible des loups — `FEATURES.md` §18.6, §11.6 |
| `feature-return-home` | 2026-08-16 | `f2e6f34` | `16bf89b` | Bouton retour à l'accueil — `FEATURES.md` §18.5, §11.5 |
| `feature-rejoin-popup` | 2026-08-16 | `16bf89b` | `a7896e6` | Popup de reprise de partie — `FEATURES.md` §18.4, §11.4 |
| `feature-idle-cleanup` | 2026-08-16 | `a7896e6` | `1bb5db5` | Fermeture auto des parties inactives — `FEATURES.md` §18.3, §11.3 |
| `feature-tie-vote-hardcoded` | 2026-08-16 | `1bb5db5` | `a644800` | Égalité de vote re-codée en dur — `FEATURES.md` §18.2, §11.2 |
| `feature-mvp-vote-deadline` | 2026-08-13 | `f4551e5` | `63289c2` | Minuteur configurable d'auto-finalisation du vote MVP |
| `feature-admin-kill-and-reveal` | 2026-08-10 | `63289c2` | `18bf5b2` | §17.5d : élimination admin + reveal au clic |
| `feature-instant-replay` | 2026-08-10 | `18bf5b2` | `4d9c697` | §17.5c : rejeu instantané (même config / reconfigurer) |
| `feature-account-reconnect` | 2026-08-10 | `4d9c697` | `affbf2c` | §17.5b : reconnexion basée compte sur `PLAYER_JOIN` |
| `feature-afterlife-full-roles` | 2026-08-10 | `affbf2c` | `fb29279` | §17.5a : Afterlife — visibilité complète des rôles pour les morts |
| `phase-2b-rating-engine` | 2026-08-07 | `7627732` | `9c4e826` | Moteur de rating générique, coefficients de difficulté, performance v1 |
| `phase-2a-advanced-stats` | 2026-08-07 | `9c4e826` | `342d755` | Séries de victoires, nuits survécues moy., répartition causes de mort |
| `phase-1-accounts-live` | 2026-08-07 | `342d755` | `2ac31fe` | Comptes/profils/historique/stats — **déployé en prod le 07/08/2026** |

\* `feature-batch-8-complete` (`7a41057`) est un tag de clôture **documentaire** posé juste après `6559c64` (fin du code du lot de 8 features, qui va de `a644800` à `6559c64`) — annuler jusqu'à `6559c64` ne défait QUE les commits de doc qui ont suivi. Pour annuler le lot de 8 features en entier, code compris, viser plutôt le commit juste avant `a644800` (Feature 1), c'est-à-dire `f4551e5` (`feature-mvp-vote-deadline`).
