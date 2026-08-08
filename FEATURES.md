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
| **Phase 5** (cahier de charge #2 — voir section 17) | Performance Score par rôle (v2, avec journal d'événements) | ⬜ À faire |
| **Phase 6** (cahier de charge #2 — voir section 17) | Badges + Achievements | ⬜ À faire |
| **Phase 7** (cahier de charge #2 — voir section 17) | Classements + comparaison de profils | ⬜ À faire |
| **Phase 8** (proposée, cahier de charge #1) | Saisons | ⬜ À faire |
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

## 8. Performance Score — 🚧 Partiel (v1 honnête, limité par l'absence de journal d'événements)

Implémenté comme un **registre par rôle** (`packages/rating/src/performance.ts`, `PERFORMANCE_SCORERS`), exactement le mécanisme d'extensibilité demandé ("permettre de créer un calcul personnalisé pour chaque rôle") — un test dédié démontre l'enregistrement d'une formule personnalisée pour un rôle donné, prenant le pas sur la formule générique.

**Limite honnête, à ne pas ignorer** : `packages/game-engine` ne conserve aujourd'hui aucun journal structuré des actions de chaque joueur (qui a inspecté qui, quelle potion a été utilisée et quand, etc.) — exactement le "prérequis manquant" déjà identifié avant cette phase. **Sans cette donnée, aucune formule vraiment spécifique par rôle (inspections utiles de la Voyante, potions de la Sorcière, discrétion du Loup) n'est calculable honnêtement.** Le registre `PERFORMANCE_SCORERS` est donc vide aujourd'hui — tous les rôles utilisent la même formule générique (`genericPerformanceScore`) : profondeur de survie + résultat de la partie, avec une pondération différente pour les rôles solo (l'Alien) puisqu'un rôle solo "perd" presque toujours au sens équipe, quelle que soit la qualité de son jeu. C'est un vrai score, dérivé de vraies données, mais ce n'est PAS ce que section 8 décrit en détail (inspections utiles, potion offensive utile, etc.) — ces formules-là attendent le journal d'événements.

**Prochaine étape recommandée avant d'aller plus loin sur cette section** : faire exposer par le moteur de jeu un journal structuré des actions par joueur (qui a été inspecté par la Voyante et quand, qui a reçu quelle potion, qui a voté pour qui à chaque tour...), puis remplir `PERFORMANCE_SCORERS` rôle par rôle. L'architecture (registre générique, fallback neutre) est déjà prête à recevoir ça sans rien changer ailleurs.

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
- **Pas de délai fixe** : le vote attend que tous les joueurs de la partie aient voté. Filet de sécurité ajouté (cohérent avec le reste de l'app, ex. `ADMIN_FORCE_NEXT_PHASE`) : un admin peut forcer le résultat à tout moment via `ADMIN_FORCE_MVP_FINALIZE`, pour le cas d'un joueur déconnecté qui ne revient jamais voter.
- **Égalité → tout le monde gagne** : `tallyMvpVotes()` (pur, testé) retourne tous les joueurs à égalité au nombre de votes maximum ; chacun reçoit +1 MVP et +15 XP.

Vote à bulletin secret : seule la progression (nombre de votes reçus, jamais pour qui) est diffusée avant la fin — `MVP_STATE`. Le résultat final (`MVP_RESULT`) diffuse les gagnants. `PlayerRecord.isMvp` + `User.mvpCount` mis à jour par `applyMvpBonus()` (`apps/server/src/progression/applyProgression.ts`), résolu via les lignes `PlayerRecord` déjà écrites par `finalizeGameHistory` plutôt que via la map en mémoire de `gameRegistry` (qui peut déjà avoir été nettoyée si le vote prend du temps). Affiché sur l'écran de fin de partie (bouton de vote, puis résultat avec médaille 🏅) et sur `/profile` (compteur de MVP).

---

## 13. Badges — ⬜ À faire

Rien n'existe. Exigence explicite : facile d'ajouter de nouveaux badges. Approche cohérente avec l'architecture générique déjà en place : une table `BadgeDefinition { id, condition/seuil }` + une table `UserBadge { userId, badgeId, unlockedAt }`, évaluée après chaque `finalizeGameHistory()` plutôt que des règles codées en dur par badge.

---

## 14. Classements — ⬜ À faire

Rien n'existe. Dépend du Rating (section 6) pour les classements par rating, et de XP/MVP pour les classements correspondants — seul le classement "par nombre de victoires" pourrait être construit dès aujourd'hui avec les données déjà en base.

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

> **Statut au 8 août 2026 (fin de session autonome) : 17.1, 17.2 et 17.3 livrés, testés, committés localement (voir « Notes d'implémentation » plus bas). 17.4 (Performance v2 / Badges / Classements) reste à faire.**

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

### 17.4 Performance Score v2, Badges, Classements (point 9-14) — indépendant de 17.1-17.3, peut être fait en parallèle ou avant

Voir sections 8, 13, 14 ci-dessus — rien de nouveau ici par rapport à ce qui était déjà planifié, ce document ne fait que le confirmer et le détailler (catégories de classement, format de la page achievements, badges secrets). Le seul vrai prérequis technique (journal d'événements structuré) reste à construire, indépendamment de la nuit séquentielle.

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

**Reste à faire pour clore le cahier de charge #2** : 17.4 (Performance Score v2 → Badges → Classements) — non commencé lors de cette session.

---

## Recommandation pour la suite

Fait et déployé (Phases 1, 2a, 2b, 3 — en production, cahier de charge #1) :

1. ~~Compléter les statistiques restantes de la section 4~~ ✅
2. ~~Coefficients de difficulté par rôle (section 7)~~ ✅
3. ~~Performance Score par rôle (section 8)~~ 🚧 v1 générique seulement — voir la limite honnête documentée dans cette section, et section 17 pour la v2
4. ~~Rating générique + calcul final (sections 6 et 9)~~ ✅
5. ~~Ratings spécialisés (section 10)~~ ✅
6. ~~XP + Niveau (section 11)~~ ✅
7. ~~MVP (section 12)~~ ✅

Reste à faire du cahier de charge #1, par ordre de dépendance :

1. **Saisons** (section 15) — seul point du cahier de charge #1 encore non planifié ; dépend du rating (rien à réinitialiser sans lui). En attente derrière le cahier de charge #2 (section 17), qui a été explicitement priorisé par l'utilisateur le 8 août 2026.

**Le reste (journal d'événements, Badges, Classements) a été repris et détaillé dans le cahier de charge #2 reçu le 8 août 2026 — voir section 17 ci-dessous, qui fait maintenant référence pour l'ordre de la suite.**
