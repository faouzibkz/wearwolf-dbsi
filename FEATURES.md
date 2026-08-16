# FEATURES.md — Suivi du cahier de charge « Comptes / Profils / Stats / Rating / Progression »

> Ce document suit, section par section, le cahier de charge fourni le 6 août 2026. Il est mis à jour à chaque phase livrée — c'est la source de vérité sur ce qui est fait, en cours, ou pas commencé. Voir **[ARCHITECTURE.md](./ARCHITECTURE.md)** pour le détail technique de ce qui est listé ✅ ici.
>
> **Décision de scope** : le cahier de charge a été volontairement découpé en phases plutôt que livré en un bloc (accord explicite avec l'utilisateur). **Phases 1, 2 (2a + 2b) et 3 sont terminées et déployées en production** (`https://loupgarou-dbsi.com`, vérifié en jeu réel le 8 août 2026). Un **deuxième cahier de charge**, purement additif (expérience de jeu + progression sociale, sans toucher aux règles des rôles), a été reçu le 8 août 2026 — voir **section 17** pour le détail et le plan.

Légende : ✅ Fait · 🚧 Partiel · ⬜ À faire

---

## ⚠️ Incident du 8 août 2026 (résolu) — migration Phase 3 jamais appliquée en prod

Le déploiement de la Phase 3 a d'abord échoué silencieusement : `schema.prisma` avait bien les nouvelles colonnes (`User.totalXp`/`level`/`mvpCount`), mais `npx prisma db push` n'avait jamais été lancé contre la base de production avant le déploiement — `GET /me` plantait alors **tout le process serveur** au premier `/login` (Prisma `P2022`, colonne manquante), pas juste cette requête, et ECS redémarrait en boucle sur le même mur. Diagnostiqué via les logs CloudWatch, corrigé en lançant la migration manquante via ECS Exec. Deux garde-fous ajoutés dans la foulée pour que ça ne se reproduise pas :

1. **Robustesse serveur** (`apps/server/src/http/asyncHandler.ts` + middleware d'erreur global + `process.on("unhandledRejection"/"uncaughtException")` dans `index.ts`) — une erreur inattendue sur une requête ne fait plus jamais tomber tout le process, juste cette requête (500 propre).
2. **`deploy-manual.ps1`** détecte maintenant un changement de `schema.prisma` depuis le dernier déploiement réussi et bloque avec les commandes exactes de migration avant de continuer.

Détail complet dans `ARCHITECTURE.md` §9 « Pièges connus ».

## Résumé

| Phase | Contenu | Statut |
|---|---|---|
| **Phase 1** | Comptes, pseudos de partie, profil, stats minimum, historique des parties | ✅ **Fait — en production** |
| **Phase 2a** | Stats avancées : séries de victoires, nuits survécues en moyenne, répartition des causes de mort | ✅ **Fait — en production** |
| **Phase 2b** | Rating générique (Elo-inspiré) + coefficients de difficulté par rôle + Performance Score (v1) + ratings spécialisés | ✅ **Fait — en production** |
| **Phase 3** | XP/Niveaux + MVP (vote post-partie) | ✅ **Fait — testé, déployé le 8 août 2026** |
| **Phase 4** (cahier de charge #2 — voir section 17) | Nuit séquentielle (§17.1) + présentation (§17.2) + spectateur/Afterlife (§17.3) | ✅ **Fait — testé localement (211 tests), non déployé en prod** |
| **Phase 5** (cahier de charge #2 — voir section 17) | Performance Score par rôle (v2, avec journal d'événements) | ✅ **Fait — testé localement, non déployé en prod** |
| **Phase 6** (cahier de charge #2 — voir section 17) | Badges + Achievements | ✅ **Fait — testé localement, non déployé en prod** |
| **Phase 7** (cahier de charge #2 — voir section 17) | Classements + comparaison de profils | ✅ **Fait — testé localement, non déployé en prod** |
| **Phase 8** (proposée, cahier de charge #1) | Saisons | ⬜ À faire |
| **Lot additionnel** (16 août 2026 — voir section 18) | Vote Chef anticipé, égalités re-codées en dur, fermeture auto des parties inactives, popup de reprise, retour accueil, aperçu loups en direct, notes personnelles, rôle Prêtre | ✅ **Fait — testé (359 tests), committé et taggé localement, non déployé en prod** |
| Transversal | Architecture générique (section 16) | ✅ Respectée à chaque étape livrée |

Le découpage en Phase 4-6 est une proposition de séquencement (chaque phase dépend techniquement de la précédente — les classements ont besoin du rating/XP/MVP, etc.) — pas une contrainte du cahier de charge lui-même, qui ne les ordonne pas explicitement.

## Notes sur la Phase 2 (livrée et déployée)

Phase 2a/2b ont d'abord été construites de façon autonome (session du 7 août 2026, sans supervision utilisateur en direct), avec des limites explicitement posées à l'époque : aucun changement infra/AWS, aucune modification directe de la base de production, tout committé/taggé localement (`phase-1-accounts-live`, `phase-2a-advanced-stats`, `phase-2b-rating-engine`) pour permettre un rollback propre. Un vrai bug a été trouvé et corrigé au premier test local (`docker compose up --build`) : les deux Dockerfiles ne copiaient pas le nouveau `packages/rating`, donc `npm install` tentait (et échouait) de le télécharger depuis le vrai registre npm — corrigé en ajoutant les lignes `COPY` manquantes. Tout le reste s'est déployé sans accroc et a été vérifié en jeu réel.

---

## 1. Comptes utilisateurs — ✅ Fait

| Exigence | Statut | Détail |
|---|---|---|
| Compte permanent, identité réelle | ✅ | `User` model, `apps/server/prisma/schema.prisma` |
| Username unique | ✅ | Contrainte `@unique`, validation 3-20 caractères |
| Email optionnel | ✅ | `email String? @unique` |
| Mot de passe | ✅ | Haché (bcrypt), jamais stocké/renvoyé en clair |
| UUID par compte | ✅ | `id String @id @default(uuid())` |
| OAuth Google/Discord | ⬜ | Explicitement reporté par le cahier de charge lui-même ("future version") |
| Nom permanent utilisé pour classement/stats/profil/badges/saisons | 🚧 | Vrai aujourd'hui pour profil et stats ; classement/badges/saisons n'existent pas encore (voir sections 13-15) |

**Endpoints** : `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.

---

## 2. Pseudo de partie — ✅ Fait

| Exigence | Statut | Détail |
|---|---|---|
| Pseudo temporaire choisi avant chaque partie | ✅ | Champ `nickname` sur `PLAYER_JOIN`, page `/join` |
| N'existe que pendant la partie | ✅ | Stocké uniquement sur `PlayerRecord.nickname`, jamais sur `User` |
| N'influence jamais les statistiques | ✅ | Toutes les requêtes de stats/historique filtrent par `userId`, jamais par `nickname` |

---

## 3. Profil — 🚧 Partiel

| Champ attendu | Statut | Détail |
|---|---|---|
| Photo | ⬜ | Pas prévu dans le schéma actuel (nécessite stockage d'images — hors scope Phase 1) |
| Nom | ✅ | `displayName` |
| Date de création | ✅ | `User.createdAt`, affiché sur `/profile` |
| Nombre de parties | ✅ | `stats.gamesPlayed` |
| Rating global | ⬜ | Dépend de la section 6 (Rating) — pas commencé |
| Niveau | ⬜ | Dépend de la section 11 (XP) — pas commencé |
| XP | ⬜ | Idem |
| Badges | ⬜ | Dépend de la section 13 — pas commencé |
| Historique | ✅ | Lien vers `/history` depuis le profil |

**Page** : `apps/web/src/app/profile/page.tsx`. Route : `GET /api/profile/me`.

---

## 4. Statistiques — ✅ Fait (Phase 2a a complété les paliers restants)

### Minimum (explicitement demandé en premier) — ✅ Fait
- Games Played, Games Won, Games Lost, Win Rate → `getUserAggregateStats()`, affiché sur `/profile`.

### Deuxième palier — ✅ Fait (Phase 2a)
- **Current/Longest Win Streak** : `computeWinStreaks()` (`apps/server/src/stats/deriveStats.ts`) — trie les parties chronologiquement (par `game.endedAt`) et compte les séries de victoires consécutives.
- **Average Survival** : interprété comme "nuits complètes survécues en moyenne" (`averageNightsSurvived()`) — interprétation explicite car le cahier de charge ne précise pas la formule exacte. Mourir "Nuit N" = N-1 nuits survécues ; "Jour N" = N nuits ; un survivant reçoit le nombre total de nuits de la partie (`Game.finalNightNumber`, nouveau champ additif). **À relire** si une autre définition (ex. pourcentage de la partie survécu, ou temps réel) était voulue.

### Troisième palier — ✅ Fait (Phase 2a)
- First Night Death, Killed by Wolves, Executed by Village, Survived Until End → `computeDeathBreakdown()`, tous calculés depuis `deathCause`/`deathMoment`/`isAlive` déjà stockés sur `PlayerRecord`. "Killed by Wolves" regroupe `LOUP_GAROU_ATTACK` + `LOUP_BLANC_ATTACK`.

### Nombre de parties par rôle — ✅ Fait
- `getUserAggregateStats().perRole` : Games/Wins/Losses/Win Rate par `roleId`, **entièrement générique** (group-by sur les `roleId` réellement présents en base — un nouveau rôle apparaît sans changement de code, conformément à la section 16), maintenant extrait dans `computePerRoleStats()` et testé unitairement. "Average Survival" par rôle spécifiquement (plutôt que par compte) n'est pas encore fait — facile à ajouter en réutilisant `averageNightsSurvived()` groupé par `roleId`.

**Fichiers** : `apps/server/src/stats/deriveStats.ts` (calculs purs, 13 tests unitaires) + `apps/server/src/db/persistence.ts` (récupération des lignes) + `apps/web/src/app/profile/page.tsx` (affichage).

---

## 5. Historique des parties — ✅ Fait

| Champ attendu | Statut |
|---|---|
| Date | ✅ (`playedAt`) |
| Lobby (code/nom de partie) | ✅ (`code`, `name`) |
| Nombre de joueurs | ✅ (`playerCount`) |
| Liste des joueurs | ⬜ — seule la ligne du joueur courant est retournée, pas la liste complète des autres joueurs de cette partie (facile à ajouter : `Game.players` existe déjà en base) |
| Rôles | ✅ |
| Camp | ✅ (`team`) |
| Pseudo utilisé | ✅ (`nickname`) |
| Résultat | ✅ (`WON`/`LOST`/`DRAW`) |
| Cause de mort | ✅ (`deathCause`) |
| Jour de mort | ✅ (`deathMoment`, ex. "Nuit 3") |

**Page** : `apps/web/src/app/history/page.tsx`, paginée (10/page). **Route** : `GET /api/history/me?limit=&offset=`.

---

## 6. Rating — ✅ Fait (Phase 2b) — v1, à valider par le jeu réel

Implémenté dans le nouveau package `packages/rating` (pur, sans base de données, 19 tests unitaires) + orchestration dans `apps/server/src/rating/applyRating.ts`. Valeur initiale **1000** (`User.ratingGlobal`, conforme à la section 6). Évolue après chaque partie via `computeRatingDelta()` — formule Elo-inspirée, pas un Elo manuel : voir section 9 ci-dessous pour le détail. Prend bien en compte victoire + difficulté du rôle + performance, comme demandé.

**⚠️ Point à valider** : la formule (K=32 par défaut, un joueur "moyen" au rating égal à la moyenne de la partie gagne/perd ~16 points) est un point de départ raisonnable, pas un résultat de playtesting. À ajuster une fois de vraies parties jouées avec.

---

## 7. Difficulté des rôles — ✅ Fait (Phase 2b)

Nouveau modèle `RoleDifficulty { roleId, coefficient }` en base — **configurable à l'exécution**, sans redéploiement (exactement l'exigence "aucune valeur codée en dur"). Seedé automatiquement au démarrage du serveur depuis `packages/rating`'s `DEFAULT_ROLE_DIFFICULTY` (une seule fois par rôle, jamais écrasé si déjà configuré manuellement) — un rôle sans coefficient configuré retombe sur 1.0 (neutre), donc un nouveau rôle "fonctionne" immédiatement sans configuration, conformément à la section 16.

**⚠️ Valeurs par défaut à valider** : `DEFAULT_ROLE_DIFFICULTY` (`packages/rating/src/roleDifficulty.ts`) mappe approximativement l'exemple du cahier de charge (Villageois/Loup 1.0, Sorcière 1.15, Voyante 1.20...) sur les rôles qui existent réellement dans ce jeu (le cahier de charge cite Renard/Pyromane, qui n'existent pas ici) — un point de départ, pas une vérité, à ajuster par la table `RoleDifficulty` sans redéploiement une fois qu'on a une meilleure idée de la difficulté relative réelle de chaque rôle.

---

## 8. Performance Score — ✅ Fait (v2, avec journal d'événements — voir §17.4a/b)

Le "prérequis manquant" identifié dans la v1 est maintenant construit : `packages/game-engine` tient un journal structuré (`GameEvent[]`, `packages/shared/src/gameEvents.ts`, exposé via `GameEngine.getEventLog()`/`getPlayerEvents()`) de chaque action à outcome connu — inspections de la Voyante (avec résultat), protections du Salvateur (a sauvé ou non), potions de la Sorcière (a sauvé / a tué un loup), tirs de vengeance du Chasseur, révélations de Barbie, devinettes de l'Alien et du Loup Vert, tentatives d'attaque des loups, chaque vote de jour individuellement, et les éliminations qui en résultent.

`PERFORMANCE_SCORERS` (`packages/rating/src/performance.ts`) n'est plus vide : Voyante, Salvateur, Sorcière, Alien, Loup Garou/Loup Blanc (collectif — le vote de meute n'a pas de dissidence individuelle trackée), Loup Vert, Chasseur, Barbie et Corbeau ont chacun une vraie formule, chacune blendant le score générique (survie + résultat) avec un ratio d'"utilité" spécifique au rôle (ex. Voyante : fraction d'inspections ayant trouvé un loup ; Sorcière : soin toujours utile + poison ayant tué un loup, sur le nombre de potions utilisées). Villageois/Mowgli n'ont pas d'action à noter et utilisent toujours la formule générique — c'est correct pour eux, pas une lacune.

25 tests dédiés (`performance.test.ts`), plus 16 tests côté moteur (`eventLog.test.ts`) qui vérifient l'enregistrement de chaque type d'événement.

---

## 9. Calcul du rating (résultat + performance + coefficient + rating moyen) — ✅ Fait (Phase 2b)

`computeRatingDelta()` (`packages/rating/src/rating.ts`) implémente littéralement les quatre termes de la section 9 :

- **Résultat** : `actualScore` (1 victoire / 0.5 nul / 0 défaite) comparé à un score attendu façon Elo.
- **Rating moyen de la partie** : moyenne du `ratingGlobal` de tous les comptes liés à cette partie — interprété littéralement comme "moyenne de la partie" (tout le monde), pas "moyenne de l'équipe adverse" (voir doc comment dans le code pour la justification de ce choix, qui simplifie aussi le cas du rôle Solo qui s'oppose aux deux autres équipes à la fois).
- **Performance** : le Performance Score (0-100, section 8), centré sur 50 = neutre.
- **Coefficient du rôle** : multiplie tout le delta (section 7).

Les deux exemples du cahier de charge sont vérifiés par des tests dédiés : une bonne performance peut faire gagner quelques points malgré une défaite, une mauvaise performance peut en coûter malgré une victoire.

---

## 10. Ratings spécialisés (Global/Village/Loups/Solo) — ✅ Fait (Phase 2b)

`User.ratingGlobal/ratingVillage/ratingWolf/ratingSolo`, tous initialisés à 1000. À chaque partie, `ratingGlobal` évolue toujours, plus **exactement un** des trois ratings spécialisés selon l'équipe du joueur cette partie-là (`specializedScopeForTeam()`, testé). Affiché sur `/profile`.

---

## 11. XP — ✅ Fait (Phase 3)

`User.totalXp`/`level`, calculés par `apps/server/src/progression/deriveProgression.ts` (pur, testé) : +20 XP de participation, +30 de victoire (le cahier de charge donne ces valeurs exactes), +15 de MVP (section 12). Niveau = 1 + XP total / 100, comme demandé ("tous les 100 XP, le joueur gagne un niveau"). Indépendant du rating, comme précisé par le cahier de charge — aucun couplage avec `packages/rating`. La XP de participation/victoire est créditée immédiatement à `GAME_ENDED` ; le bonus MVP est crédité séparément, une fois le vote (section 12) terminé. Affiché sur `/profile` (niveau + barre de progression + XP total).

---

## 12. MVP — ✅ Fait (Phase 3)

Vote post-partie implémenté entièrement côté `apps/server` (aucun changement au moteur de jeu — le vote MVP n'est pas une mécanique de jeu, section 16 respectée). Trois décisions produit confirmées explicitement avec l'utilisateur avant l'implémentation :

- **Pas d'auto-vote** : un joueur ne peut pas voter pour lui-même (rejeté côté serveur).
- **Égalité → tout le monde gagne** : `tallyMvpVotes()` (pur, testé) retourne tous les joueurs à égalité au nombre de votes maximum ; chacun reçoit +1 MVP et +15 XP.

**Mise à jour (13 août 2026) — délai de sécurité configurable.** Le vote attendait initialement indéfiniment que tout le monde vote, avec un forçage uniquement manuel (`ADMIN_FORCE_MVP_FINALIZE`). Ajout d'un filet de sécurité automatique : `TimerConfig.mvpVote` (secondes, défaut 120 = 2 min, configurable dans l'écran admin, 0 = désactivé/comportement d'origine). À l'ouverture du vote (`GAME_ENDED`), `mvpVotingRegistry.open()` calcule et mémorise un `deadlineAt` (epoch ms) ; `socket/mvpTimer.ts` (nouveau module, même discipline que `socket/timers.ts` : ancré sur ce deadline déjà établi, jamais recalculé) programme un `setTimeout` qui appelle `finalizeMvpVoting()` — exactement le même chemin que le forçage manuel ou la complétion naturelle. Trois issues, toutes couvertes par test :
  - tout le monde vote avant le délai → finalisation immédiate (comportement d'origine, inchangé), le timer est annulé et ne se déclenche jamais ;
  - le délai expire sans que tout le monde ait voté (y compris zéro vote) → finalisation forcée avec les bulletins déjà reçus, identique à un forçage admin ;
  - le délai expire alors que le vote est déjà finalisé (course rare) → no-op, `finalizeMvpVoting()` est idempotent et `mvpTimer.ts` vérifie `state.finalized` avant d'agir, donc jamais de double diffusion `MVP_RESULT` ni de double attribution XP/badge.

`MvpStatePayload.deadlineAt` diffuse ce délai aux clients ; `EndGamePanel.tsx` l'affiche via le composant `CountdownTimer` déjà utilisé pour tous les autres minuteurs (même correction anti-dérive d'horloge, `lib/serverClock.ts`). Tests : `mvp/mvpVotingRegistry.test.ts` (calcul du `deadlineAt`) + nouveau `socket/mvpTimer.test.ts` (5 tests, minuteurs simulés, exerce le vrai chemin `sync()` de bout en bout).

Vote à bulletin secret : seule la progression (nombre de votes reçus, jamais pour qui) est diffusée avant la fin — `MVP_STATE`. Le résultat final (`MVP_RESULT`) diffuse les gagnants. `PlayerRecord.isMvp` + `User.mvpCount` mis à jour par `applyMvpBonus()` (`apps/server/src/progression/applyProgression.ts`), résolu via les lignes `PlayerRecord` déjà écrites par `finalizeGameHistory` plutôt que via la map en mémoire de `gameRegistry` (qui peut déjà avoir été nettoyée si le vote prend du temps). Affiché sur l'écran de fin de partie (bouton de vote, puis résultat avec médaille 🏅) et sur `/profile` (compteur de MVP).

---

## 13. Badges — ✅ Fait (voir §17.4c)

Implémenté avec le registre en **code**, pas en table DB, contrairement à ce que cette section envisageait initialement : `BADGE_REGISTRY` (`apps/server/src/badges/deriveBadges.ts`) tient la métadonnée de chaque badge (nom, description, secret, condition) — exactement le même principe que `PERFORMANCE_SCORERS`/`ROLE_REGISTRY` (section 16) : ajouter un badge est une entrée de tableau + un redéploiement, jamais une migration. Seule la table `UserBadge { userId, badgeId, unlockedAt }` existe côté DB — elle ne stocke que QUELS badges sont débloqués, jamais leur définition.

18 badges livrés (liste proposée et approuvée explicitement par l'utilisateur avant implémentation) : 3 de participation, 3 de résultats, 8 de maîtrise par rôle (utilisant le journal d'événements §17.4a), 2 de progression/social, et 2 secrets (cachés jusqu'au déblocage). Réévalués après chaque partie terminée (`applyBadgesForUser`, appelé après `finalizeGameHistory`/`applyRatingUpdates`/`applyBaseProgression`) et à nouveau à la finalisation du vote MVP (`applyBadgesForMvpWinners`, car `mvpCount` n'est mis à jour qu'à ce moment-là). Exposés via `GET /api/badges/me`, affichés sur `/achievements`.

---

## 14. Classements — ✅ Fait (voir §17.4e)

7 catégories (`getLeaderboard()`, `apps/server/src/db/persistence.ts`) : rating global/Village/Loups/Solo, XP, MVP (tri direct sur une colonne `User` déjà maintenue), et victoires (le seul vrai agrégat — `groupBy` sur `PlayerRecord.result = "WON"` par compte, en excluant les invités non liés à un compte). Exposé publiquement via `GET /api/leaderboard?category=&limit=` (pas d'authentification requise — un classement est fait pour être vu par tous), affiché sur `/leaderboard`.

---

## 15. Saisons — ⬜ À faire

Rien n'existe. Dépend du Rating (rien à réinitialiser sans lui). Nécessite aussi une table d'historique de saisons (le cahier de charge exige que badges et statistiques survivent au reset, donc le reset ne doit toucher qu'un champ "rating courant", jamais les tables de stats/historique/badges elles-mêmes).

---

## 16. Architecture générique — ✅ Respectée

Contrainte transversale, vérifiée à chaque étape livrée jusqu'ici :

- Aucun `if (role == "Sorcière")` (ou équivalent) dans `packages/game-engine` ni dans la couche comptes/stats de `apps/server`.
- L'équipe d'un joueur pour les stats vient de `ROLE_METADATA[roleId].team`, jamais d'un switch.
- Le regroupement de stats par rôle (`getUserAggregateStats().perRole`) est un group-by générique sur les données réelles — un rôle inédit y apparaît automatiquement.
- Le lien compte ↔ joueur (`gameRegistry.userIdByPlayerId`) est tenu entièrement hors du moteur de jeu, qui reste totalement ignorant des comptes.

**Point d'attention pour la suite** : les sections 7 (coefficients) et 8 (Performance Score) sont les premières à réellement tester cette contrainte en profondeur — elles demandent chacune une vraie extensibilité par rôle (configuration + interface), pas seulement l'absence de branchement conditionnel. À concevoir avec soin dès le début de la Phase 2 plutôt que d'ajouter les coefficients/scores rôle par rôle a posteriori.

---

## 17. Cahier de charge #2 (reçu le 8 août 2026) — Expérience de jeu & progression sociale

> **Statut au 8 août 2026 (fin de session autonome) : 17.1, 17.2, 17.3 ET 17.4 livrés, testés, committés localement (voir « Notes d'implémentation » plus bas). Le cahier de charge #2 est entièrement complet — reste uniquement le `prisma db push` + test Docker local + déploiement, à faire par l'utilisateur.**

> Document séparé du cahier de charge #1 ci-dessus, volontairement scopé pour ne **rien changer aux règles/mécaniques des rôles existants** — uniquement l'orchestration de la nuit, la présentation, et une couche progression/social entièrement nouvelle. Six features, groupées en 4 phases ci-dessous par dépendance technique réelle (pas forcément l'ordre de la liste d'origine).

### Verdict global : aucune interférence avec l'existant

Aucun des 6 points ne touche `applyNightAction`/`resolve`/`isActiveOnNight` d'un rôle, ni ses règles. Le point 1 (nuit séquentielle) change **quand** un rôle a le droit d'agir, jamais **ce qu'il peut faire**. Les points 2-14 sont additifs (config, présentation, nouvelle couche stats/social) et ne redéfinissent rien.

**Bonne surprise en le relisant contre `FEATURES.md`** : une bonne partie de ce cahier de charge #2 était *déjà* le plan proposé pour la suite du cahier de charge #1, juste jamais formalisé avec autant de détail :
- **Performance Score par rôle** (point 9) = exactement le prérequis déjà documenté à la section 8 ci-dessus (« journal d'événements structuré côté moteur, puis remplir `PERFORMANCE_SCORERS` rôle par rôle ») — pas une nouvelle idée, juste la confirmation qu'il faut le faire.
- **Badges** (points 10-11) = déjà en table comme « Phase 4 proposée » avant même ce document.
- **Classements** (points 12-14) = déjà en table comme « Phase 5 proposée », avec la même conclusion (« aucune donnée manquante, tout existe déjà »).

Le vraiment nouveau, c'est : la nuit séquentielle (point 1, la plus grosse pièce), la présentation de nuit (points 2-6), et Spectateur + Afterlife (points 7-8).

### Décisions confirmées avec l'utilisateur le 8 août 2026 (avant un travail autonome sans supervision directe)

- **Nuit séquentielle = mode opt-in, pas un remplacement total** : nouveau champ `GameConfig.nightMode: "SIMULTANEOUS" | "SEQUENTIAL"`, défaut `"SIMULTANEOUS"` (comportement actuel, zéro régression possible — toutes les parties existantes et tous les tests actuels continuent de passer par le chemin `NightResolver` inchangé). Le mode séquentiel est un **second chemin additif**, choisi par l'admin à la création de la partie, jamais un remplacement du premier.
- **Priorité : profondeur plutôt que largeur.** Chaque feature ci-dessous doit être finie, testée et committée avant de passer à la suivante, dans l'ordre 17.1 → 17.2 → 17.3 → 17.4. Si le travail autonome s'arrête avant la fin de la liste, il doit s'arrêter sur un point propre (une feature entièrement finie), jamais au milieu d'une feature à moitié câblée.
- **Contraintes de l'environnement d'exécution autonome** : pas de Docker installé (impossible de lancer `docker compose up --build` soi-même — vérification via la suite de tests + `tsc` + `next build`, comme à chaque phase précédente ; l'utilisateur doit quand même faire un test Docker local avant de déployer). Pas d'identifiants `git push` (commits locaux uniquement, comme pour les Phases 2/3).

### 17.1 Nuit séquentielle (point 1-6 du document) — le plus gros morceau, et la fondation — ✅ Fait

**Comment ça s'articule avec l'existant** : `packages/game-engine` a déjà tout ce qu'il faut pour construire ça *par-dessus*, sans toucher aux rôles :
- `ROLE_REGISTRY` + `nightPriority` définissent déjà un ordre total entre rôles.
- `NightResolver.getActiveNightRoles(ctx, nightNumber)` filtre déjà les rôles « en jeu cette nuit précise » (présent dans la partie + `isActiveOnNight()` vrai) — exactement la logique demandée au point 3 (« étapes conditionnelles »), déjà là.
- `isActiveOnNight(ctx, nightNumber)` existe déjà par rôle (ex. Mowgli n'agit qu'à la nuit 1) — le point « première nuit vs nuit normale » du document est déjà résolu par rôle, juste jamais exposé comme timeline dans l'UI.

**Ce qui manque réellement** (nouveau, mais isolé de la logique des rôles) :
1. Un orchestrateur de nuit (nouveau, ex. `NightSequencer.ts`) qui, au lieu d'envoyer tous les prompts actifs d'un coup (comportement actuel), avance étape par étape dans `getActiveNightRoles()` — un rôle à la fois, avec un timer serveur (même famille que les timers déjà existants pour les débats/successions de Chef).
2. Extension de `GameConfig` : ordre des étapes + durée par étape, configurable à la création de partie (défaut = l'ordre `nightPriority` actuel, donc rien ne casse si l'admin ne touche à rien).
3. Nouveaux événements socket (`NIGHT_STEP_BEGIN`/`NIGHT_STEP_END` ou équivalent) + écran admin de configuration (point 4) + nouveau composant web de présentation séquentielle (point 5-6, remplace l'affichage actuel « tous les prompts actifs en même temps »).

**Points d'attention identifiés, à trancher pendant la conception (pas des bloqueurs, juste des décisions à ne pas oublier)** :
- **Loup Vert — tranché avec l'utilisateur le 8 août 2026 (Option A)** : le pouvoir volé (deviner/voler, `engine/LoupVert.ts`) s'utilise immédiatement à l'étape « Loups » de la séquence, pas à l'étape du rôle volé — pas d'attente jusqu'au tour normal de la Sorcière/du Salvateur, etc. Confirmé au passage (déjà vrai et testé dans le code actuel, aucun changement nécessaire) : la victime devient Villageois simple **instantanément cette même nuit** (ne peut plus soigner/protéger/tuer cette nuit-là), et le pouvoir volé du Chasseur reste **permanent** pour le reste de la partie (deviner un autre rôle ensuite fait perdre ce pouvoir permanent en échange du nouveau, à usage unique cette nuit-là).
- **Dépendances d'ordre déjà existantes à préserver** : la Sorcière a besoin de connaître la cible des loups avant d'agir — déjà garanti aujourd'hui par `nightPriority`, doit rester garanti à l'identique dans le système séquentiel (résoudre l'étape des loups avant d'ouvrir celle de la Sorcière, pas juste envoyer les prompts dans l'ordre sans attendre la résolution).
- **Salle des loups** (vote collectif, état `wolfRoom`) devient « l'étape Loups » avec son propre timer — compatible, juste un habillage différent d'un mécanisme qui existe déjà.

### 17.2 Présentation de nuit (point 5-6) — dépend directement de 17.1 — ✅ Fait

Couche purement présentation une fois 17.1 en place : transitions (« 🌙 La nuit tombe... », « 🛡️ Le Salvateur se réveille »), écran neutre (« Le village dort... ») pour les joueurs sans rien à faire cette étape-là. Déjà partiellement vrai aujourd'hui côté vie privée (un Villageois ne reçoit jamais le `NIGHT_PROMPT` d'un autre rôle) — ici on ajoute la mise en scène, pas la sécurité (déjà bonne).

### 17.3 Spectateur + Afterlife (point 7-8) — indépendant de 17.1/17.2, peut être fait en parallèle — ✅ Fait

**Déjà vérifié** : `PlayerPublic`/`InternalPlayer` ont un champ `isSpectator: boolean` (`packages/shared`, `packages/game-engine`) — mais il est mis à `false` à la création du joueur et **n'est jamais réécrit ailleurs dans tout `game-engine`**. Un champ prévu mais jamais branché à ce jour, donc aucun risque de conflit : le réutiliser pour « joueur mort » (plutôt que d'en créer un distinct) est sûr et n'affecte aucun comportement existant, puisque rien ne le lit ni ne le modifie actuellement.
Le blocage serveur des actions d'un mort existe déjà (`submitNightAction` rejette `!player.isAlive`) — ce qui manque, c'est la présentation (écran « Vous êtes mort → Mode spectateur ») et le chat privé lui-même. Le chat des morts (« Afterlife ») peut être construit exactement comme `WolfChat` existant (`relayWolfChatMessage`, salle dédiée, vérification côté serveur de l'éligibilité) — un pattern déjà en place et éprouvé, juste appliqué à « est mort » plutôt qu'« est loup ».

### 17.4 Performance Score v2, Badges, Classements (point 9-14) — indépendant de 17.1-17.3 — ✅ Fait

Voir sections 8, 13, 14 ci-dessus. Livré en 6 étapes indépendantes (17.4a → 17.4f), chacune committée séparément — voir « Notes d'implémentation » plus bas pour le détail. La liste des 18 badges (17.4c) a été proposée par Claude puis explicitement approuvée par l'utilisateur avant l'implémentation, comme convenu.

### Ordre recommandé

Le document propose : Nuit séquentielle → Présentation → Spectateur/Afterlife → Performance → Badges → Classements. **Globalement d'accord**, avec une nuance : 17.1-17.2 (nuit) et 17.3 (spectateur/Afterlife) et 17.4 (performance/badges/classements) touchent trois couches complètement indépendantes du code (moteur de nuit / présentation ↔ chat+mort ↔ stats/social) — rien n'empêche de paralléliser ou de réordonner selon ce qui compte le plus à voir tourner en premier. En particulier, **17.4 (Badges + Classements) pourrait sortir avant 17.1** si l'utilisateur préfère un gain visible rapide : toutes les données existent déjà, aucune dépendance sur le moteur de nuit.

1. **17.1 Nuit séquentielle** (fondation technique, le plus gros morceau — orchestrateur + config admin + timers serveur).
2. **17.2 Présentation de nuit** (dépend de 17.1).
3. **17.3 Spectateur + Afterlife** (indépendant, peut être fait avant/en parallèle de 17.1-17.2).
4. **17.4 Performance Score v2 → Badges → Classements** (indépendant, peut être fait avant/en parallèle — commencer par le journal d'événements).

**À confirmer avec l'utilisateur avant de commencer** : l'ordre ci-dessus convient-il, ou préfère-t-il un gain visible rapide (17.4) avant le plus gros chantier (17.1) ? (Question Loup Vert déjà tranchée — voir 17.1, Option A.)

### Notes d'implémentation — session autonome du 8 août 2026 (17.1 → 17.3 livrés)

Suite au feu vert de l'utilisateur (« admin toggle » pour le mode de nuit, « profondeur plutôt que largeur » comme priorité), 17.1, 17.2 et 17.3 ont été construits, testés et committés localement, un commit indépendant par étape (pour permettre un rollback ciblé) :

- **17.1a** — types partagés (`nightMode`, `nightStepOrder`, `nightStepDurations`, `nightStepDisabled`, événement `NIGHT_STEP_STATE`). Commit `7a0a9f7`.
- **17.1b/c** — `packages/game-engine/src/engine/NightSequencer.ts` (regroupe `getActiveNightRoles()` par `nightPriority` identique — c'est ce qui fusionne loups-garous/loup blanc/loup vert en une seule étape collective) + méthodes `GameEngine` (`isSequentialNightMode`, `getCurrentNightStepRoleIds`, `advanceNightStepIfComplete`, `forceAdvanceNightStep`) + 12 tests dédiés (`sequentialNight.test.ts`). Commit `6987f82`.
- **17.1d** — `apps/server` : `sync()` avance les étapes automatiquement après chaque action ; `timers.ts` rend le timer de nuit sensible à l'étape courante (durée + expiration par rôle au lieu d'un timer de nuit unique) ; nouvelle diffusion `NIGHT_STEP_STATE` (`broadcast.ts`). Aucune config admin nouvelle côté socket : tout passe déjà par `ADMIN_UPDATE_CONFIG`/`ADMIN_CREATE_GAME` existants. 5 tests (`broadcast.test.ts`). Commit `8521a3c`.
- **17.1e** — écran admin (`apps/web/src/app/admin/[code]/page.tsx`) : bascule simultanée/séquentielle, réordonnancement (▲▼), durée par rôle, activer/désactiver un rôle pour la partie. Bannière de progression côté joueur (`apps/web/src/app/play/[code]/page.tsx`) : « Étape N / total », compte à rebours par étape. Commit `917cb0f` (message corrigé en `e036e7c`).
- **17.2** — narration « réveil » par rôle (🛡️ Le Salvateur se réveille…, 🐺 Les Loups se réveillent…) + « 🌙 La nuit tombe... » sur la toute première étape de la nuit. Purement présentation, aucun changement moteur/serveur. Commit `de7dbf9`.
- **17.3a** — `isSpectator` (déjà présent dans `InternalPlayer`/`PlayerPublic` mais jamais branché — vérifié par grep avant modification) devient vrai à l'instant même où un joueur meurt (`DeathQueue.processDeaths`, le seul point de passage pour toute mort). Nouvelle méthode `GameEngine.getAfterlifeMemberIds()`. 5 tests (`afterlife.test.ts`). Commit `bb9fff4`.
- **17.3b** — chat privé « Afterlife » côté serveur (`apps/server/src/socket/afterlife.ts`), calqué ligne à ligne sur `wolfRoom.ts` — seule différence réelle : pas limité à la nuit, reste actif à toutes les phases une fois quelqu'un mort. 6 tests (`afterlife.test.ts`). Commit `cd2725c`.
- **17.3c** — composant web `AfterlifeChat` (calqué sur `WolfChat`), affiché en permanence (toutes phases) dès qu'un joueur est mort. Commit `ff4d8b7`.

**Vérifications effectuées à chaque étape** : `tsc --noEmit` (shared + game-engine + server + web), `next build` (web), suite de tests complète du monorepo (**211/211 tests verts** à la fin de 17.3 — 0 régression sur les 130 tests pré-existants). Pas de `docker compose up --build` réel (sandbox sans Docker ni accès réseau pour générer le client Prisma) — l'utilisateur doit encore faire ce test avant tout déploiement, comme prévu dès le départ. Aucun push git (pas d'identifiants dans ce sandbox) — tout est committé localement sur `master`, prêt à être poussé et/ou testé en Docker par l'utilisateur.

### Notes d'implémentation — session autonome du 8 août 2026 (17.4 livré, cahier de charge #2 clos)

Suite au feu vert explicite de l'utilisateur (« full send », avec un seul point d'arrêt convenu : approbation de la liste de badges avant le câblage de 17.4c), les six étapes ont été construites, testées et committées localement, un commit indépendant par étape :

- **17.4a** — Journal d'événements structuré : `GameEvent` (union discriminée, `packages/shared/src/gameEvents.ts` — déplacé depuis `packages/game-engine` en 17.4b pour que `packages/rating` puisse le lire sans dépendre du moteur, exactement comme `FinalPlayerSummary`) + `EngineContext.recordEvent()` + `GameInternalState.eventLog`. Enregistré au bon endroit selon quand l'issue finale est connue : dans `NightResolver.resolveNight()` pour tout ce qui dépend de la résolution complète de la nuit (Voyante, Salvateur, Sorcière, attaques de loups, Corbeau), directement dans les modules de rôle/`GameEngine`/`VoteManager` pour tout ce qui est connu immédiatement (Alien, Loup Vert, Chasseur, Barbie, votes de jour). 16 tests (`eventLog.test.ts`). Commit `87243e1`.
- **17.4b** — `PERFORMANCE_SCORERS` rempli rôle par rôle à partir du journal (voir section 8 ci-dessus). 25 tests (`performance.test.ts`, réécrit avec un constructeur de contexte partagé). Commit `186f701`.
- **17.4c** — Badges : `BADGE_REGISTRY` (18 badges, liste approuvée par l'utilisateur) + `UserBadge` (table DB) + nouvelles colonnes `PlayerRecord` (contribution par partie aux totaux de carrière) + `GET /api/badges/me`. Ajout au passage d'un événement `MOWGLI_TRANSFORM` (manquant en 17.4a, nécessaire pour le badge secret « Ami Imaginaire »). 32 tests. Commit `c687070`.
- **17.4d** — Page web `/achievements` (débloqués + à débloquer + compteur de secrets restants, jamais leur contenu). Commit `7624d3b`.
- **17.4e** — `getLeaderboard()` (7 catégories) + `GET /api/leaderboard` (public, sans authentification) + page `/leaderboard`. 5 tests. Commit `0b2b7f0`.
- **17.4f** — `GET /api/profile/:username` (public) + page `/compare` (comparaison côte à côte, valeur la plus haute mise en évidence). Commit `0af181e`.

**Vérifications effectuées à chaque étape** : `tsc -b` (shared + game-engine + rating + server + web), `next build` (web, liste bien chaque nouvelle route dans sa sortie), suite de tests complète du monorepo (**286/286 tests verts** à la fin de 17.4f — 0 régression sur les 211 tests pré-existants de fin 17.3). Pas de `docker compose up --build` réel ni de `prisma db push` (sandbox sans Docker ni accès réseau pour générer le client Prisma ou ses binaires — confirmé en tentant `prisma generate`, échec 403 sur `binaries.prisma.sh`) — **l'utilisateur doit lancer `npx prisma db push` avant tout redémarrage du serveur** (nouvelles colonnes `PlayerRecord` + nouvelle table `UserBadge`), puis tester en Docker local avant de déployer, comme prévu dès le départ. Aucun push git (pas d'identifiants dans ce sandbox) — tout est committé localement sur `master`.

**Le cahier de charge #2 est maintenant entièrement complet** (17.1 → 17.4, tous les points du document du 8 août 2026).

---

## 18. Lot de features additionnelles (16 août 2026) — ✅ Fait

Huit demandes ponctuelles de l'utilisateur, hors des deux cahiers de charge ci-dessus, traitées en une seule session autonome sans supervision (accord explicite de l'utilisateur : « build everything in one go, test everything, commit every step so we can rollback, do everything alone »). Chaque feature committée indépendamment sur `master`, avec un tag Git dédié pour permettre un rollback ciblé sur n'importe laquelle sans affecter les autres :

1. **Vote du Chef — finalisation anticipée** (`a644800`) : dès que tous les joueurs vivants ont voté, le dépouillement se déclenche immédiatement au lieu d'attendre l'expiration du minuteur.
2. **Vote du jour — égalité re-codée en dur** (`1bb5db5`, tag `feature-tie-vote-hardcoded`) : au tour 2 d'une égalité, les candidats déjà à égalité sont exclus de la nouvelle liste de vote (seuls les autres joueurs votent) ; une égalité qui persiste au tour 2 se résout **sans élimination**, sans aucune intervention manuelle (l'ancien système `TieResolutionRule`/`ADMIN_RESOLVE_TIE`/phase `TIE_REVOTE` a été entièrement retiré — plus simple, plus rapide, zéro ambiguïté).
3. **Fermeture automatique des parties inactives** (`a7896e6`, tag `feature-idle-cleanup`) : un lobby vide depuis 1h, une partie terminée depuis 30 min, ou une partie en cours abandonnée depuis 4h est fermée automatiquement (balayage serveur toutes les 5 min), avec un événement `GAME_CLOSED` diffusé avant la fermeture.
4. **Popup de reprise de partie à la connexion** (`16bf89b`, tag `feature-rejoin-popup`) : à la connexion, un joueur ayant une partie ouverte (lobby ou en cours) se voit proposer de la rejoindre directement, via un nouveau `GET /api/account/open-games`.
5. **Bouton retour à l'accueil en fin de partie** (`f2e6f34`, tag `feature-return-home`) : sur l'écran de fin de partie (joueur) et le tableau de bord admin, un bouton ramène directement à l'accueil.
6. **Aperçu en direct de la cible des loups** (`5d4a53b`, tag `feature-wolf-live-preview`) : chaque loup voit maintenant, en temps réel et avant confirmation, sur qui les autres loups sont en train d'hésiter (pas seulement les votes déjà confirmés) — nouvel événement `WOLF_TARGET_PREVIEW`, état éphémère côté serveur (jamais persisté, jamais dans le moteur de jeu).
7. **Notes personnelles synchronisées** (`efbdf19`, tag `feature-personal-notes`) : chaque joueur dispose d'un bloc-notes privé, synchronisé côté serveur (survit à une reconnexion), purgé uniquement à `GAME_ENDED` — jamais avant, jamais partagé avec les autres joueurs.
8. **Nouveau rôle : Prêtre** (`6559c64`, tag `feature-pretre-role`) : rôle Village à pouvoir unique, utilisable une seule fois dans la partie, la nuit de son choix à partir de la **nuit 1** (aucune période d'attente, contrairement au Loup Vert), ciblant n'importe quel joueur vivant **y compris lui-même**. S'il tire sur un loup : le loup meurt, le Prêtre survit et continue de jouer normalement. S'il tire sur un non-loup (y compris lui-même) : **seul le Prêtre meurt**, la cible ne subit rien — délibérément différent du mécanisme à double mort de Barbie. Implémenté en suivant exactement le patron déjà établi par `roles/alien.ts` (un rôle qui appelle `processDeaths` directement depuis `applyNightAction` pour une issue binaire vie/mort) : révélation de mort standard automatique (rôle rendu public, cause toujours réservée à l'admin) sans aucun cas particulier, et volable par le Loup Vert sans aucun cas particulier non plus (le canal de vol générique de `engine/LoupVert.ts` rejoue `buildNightPrompt`/`applyNightAction` du rôle volé tel quel). 9 tests dédiés (`pretre.test.ts`) + formule de Performance Score dédiée (`pretrePerformanceScore`, `packages/rating/src/performance.ts`).

**Vérifications effectuées avant chaque commit** : suite de tests complète du monorepo (`packages/game-engine` **186/186**, `apps/server` **136/136**, `packages/rating` **37/37** — **359/359 tests verts**, 0 régression sur l'ensemble des features précédentes), plus une vérification syntaxique (`ts.transpileModule`) de chaque fichier `.tsx` modifié côté `apps/web` (pas de `tsc`/`next build` complet disponible dans ce sandbox — contrainte déjà documentée en section 17). Chaque feature a son propre commit et son propre tag Git, permettant un rollback indépendant de n'importe laquelle sans toucher aux autres. Un vrai bug a été trouvé et corrigé avant commit sur la feature 6 (aperçu en direct) : la première prévisualisation d'une partie donnée effaçait immédiatement son propre résultat à cause d'une comparaison `undefined !== nightNumber` toujours vraie — corrigé et couvert par un test dédié dans `wolfRoom.test.ts`.

---

## 19. Correctifs de bugs signalés en jeu réel (17 août 2026) — ✅ Fait

Trois bugs remontés par des **retours de vrais joueurs** (jamais vus en test automatisé — les trois sont des problèmes d'UI/synchronisation client-serveur, pas de logique de moteur de jeu), corrigés en une session, un seul commit groupé (les trois touchent les mêmes fichiers côté `apps/web`, un rollback groupé a plus de sens qu'un rollback par bug ici) :

1. **Le Chasseur voyait les rôles de tout le monde dans l'Afterlife avant même de choisir sa cible de vengeance.** Le chat Afterlife (qui révèle le vrai rôle de chaque joueur, vivant ou mort — voir `FEATURES.md` §17.3) s'affichait dès l'instant de la mort, y compris pendant que le Chasseur doit encore choisir qui il emporte avec lui. Corrigé : le chat Afterlife reste masqué tant qu'une action de mort est en attente (tir du Chasseur ou succession du Chef).
2. **Le Prêtre — et en réalité tout rôle de nuit — pouvait sembler avoir agi alors que son action n'était jamais arrivée au serveur.** L'écran « Action envoyée » s'affichait dès le clic, sans attendre la confirmation réelle du serveur : une soumission rejetée ou perdue (coupure réseau, connexion Tailscale instable pendant une soirée de jeu) avait l'air strictement identique à une soumission réussie. Pour un pouvoir à usage unique comme celui du Prêtre, c'est silencieux et définitif — exactement le symptôme remonté (« il choisit une cible, tire, et son pouvoir ne marche pas »). Corrigé : la confirmation n'apparaît plus qu'après un vrai accusé de réception du serveur ; en cas d'échec, une erreur s'affiche et le joueur peut réessayer.
3. **« Je n'ai pas pu voter » (retours ponctuels, une minorité de joueurs).** Le vote du village se fait un joueur à la fois, dans l'ordre de la discussion (voir `DayVoteQueue.ts`), avec un minuteur individuel qui **saute silencieusement** le tour de qui ne réagit pas assez vite — rien ne signalait que c'était devenu le tour d'un joueur donné, facile à manquer autour d'une table qui discute. Ajouté : un son + une notification + un encadré visuel dès que c'est le tour d'un joueur, et affichage d'une erreur si un vote est rejeté/perdu (au lieu de rien du tout, comme le point 2).

**Commit** : `575298d` — **Tag de rollback** : `bugfix-chasseur-pretre-dayvote`.

**Pour annuler ce lot précis** (revenir à l'état exact d'avant, sans toucher à quoi que ce soit d'antérieur) :

```bash
git checkout 85f3855   # regarder l'état d'avant sans rien casser (detached HEAD)
# ou, pour vraiment faire reculer master :
git reset --hard 85f3855   # ⚠️ destructif sur les commits locaux non poussés ailleurs
```

**Vérifications effectuées** : `docker compose build web` (compilation TypeScript + vérification de types complète côté `apps/web`, propre, aucune erreur) et démarrage réel de la stack (`docker compose up -d`) avec vérification que les 3 conteneurs démarrent sains et que l'app se charge sans erreur console liée au changement. **Pas de playtest multi-joueurs réel des trois scénarios précis** (un Chasseur qui meurt vraiment, un Prêtre qui tire de nuit, un joueur qui atteint son tour de vote) — la suite de tests automatisée (`vitest`) n'a pas non plus été relancée cette session (`npm`/`node` absents du PATH de cette machine). À confirmer lors de la prochaine vraie soirée de jeu.

**Convention adoptée à partir de maintenant** (accord explicite de l'utilisateur, 17 août 2026) : chaque lot de travail — feature ou correctif — se termine par un commit, un tag Git dédié, et une entrée ici mentionnant la date, ce qui a changé, le hash de commit, le nom du tag, et la commande exacte de rollback. Voir `ARCHITECTURE.md` §13 pour le détail technique de cette convention et l'historique complet de tous les tags posés à ce jour.

---

## Recommandation pour la suite

Fait et déployé (Phases 1, 2a, 2b, 3 — en production, cahier de charge #1) :

1. ~~Compléter les statistiques restantes de la section 4~~ ✅
2. ~~Coefficients de difficulté par rôle (section 7)~~ ✅
3. ~~Performance Score par rôle (section 8)~~ ✅ v2 avec journal d'événements — voir section 17.4a/b
4. ~~Rating générique + calcul final (sections 6 et 9)~~ ✅
5. ~~Ratings spécialisés (section 10)~~ ✅
6. ~~XP + Niveau (section 11)~~ ✅
7. ~~MVP (section 12)~~ ✅

Reste à faire du cahier de charge #1, par ordre de dépendance :

1. **Saisons** (section 15) — seul point du cahier de charge #1 encore non planifié ; dépend du rating (rien à réinitialiser sans lui). En attente derrière le cahier de charge #2 (section 17), qui a été explicitement priorisé par l'utilisateur le 8 août 2026.

**Le reste (journal d'événements, Badges, Classements) a été repris et détaillé dans le cahier de charge #2 reçu le 8 août 2026 — voir section 17 ci-dessous, qui fait maintenant référence pour l'ordre de la suite.**
