# FEATURES.md — Suivi du cahier de charge « Comptes / Profils / Stats / Rating / Progression »

> Ce document suit, section par section, le cahier de charge fourni le 6 août 2026. Il est mis à jour à chaque phase livrée — c'est la source de vérité sur ce qui est fait, en cours, ou pas commencé. Voir **[ARCHITECTURE.md](./ARCHITECTURE.md)** pour le détail technique de ce qui est listé ✅ ici.
>
> **Décision de scope** : le cahier de charge a été volontairement découpé en phases plutôt que livré en un bloc (accord explicite avec l'utilisateur). **Phase 1 est terminée et déployée en production** (`https://loupgarou-dbsi.com`). **Phase 2 (2a + 2b) est terminée, testée, et committée sur `master` — mais PAS ENCORE déployée en production** (voir "Ce qu'il reste à faire avant déploiement" ci-dessous). Phases 2a/2b ont été construites de façon autonome (session du 7 août 2026, sans supervision utilisateur en direct) — chaque décision de conception ambiguë est documentée explicitement ci-dessous et dans le code, pour relecture.

Légende : ✅ Fait · 🚧 Partiel · ⬜ À faire

---

## ⚠️ Ce qu'il reste à faire avant déploiement (Phase 2)

Le code de la Phase 2 est sur `master` (commits taggés `phase-2a-advanced-stats` et `phase-2b-rating-engine`), testé (159 tests automatisés, tous passants), mais **rien n'a été déployé** — c'est resté volontairement hors du périmètre autonome de cette session (voir plus bas, "Limites respectées pendant le travail autonome"). Avant que ça tourne en prod :

1. `git push origin master --follow-tags` — les commits/tags sont locaux uniquement, jamais poussés sur GitHub (pas d'identifiants git dans le bac à sable où ce travail a été fait).
2. Reconstruire et redéployer normalement (`deploy-manual.ps1` ou le pipeline CI).
3. **Appliquer le nouveau schéma à la base de production** — deux nouveaux champs sur `Game`, un nouveau modèle `RoleDifficulty`, quatre nouveaux champs sur `User`, un nouveau champ sur `PlayerRecord`. Même procédure que pour la Phase 1 : `aws ecs execute-command ... "npx prisma db push --accept-data-loss"` (voir README.md). Additif uniquement — aucune perte de données réelle attendue, mais à vérifier comme d'habitude avant de valider.
4. Relire `infra/aws/*.tf` : **aucun changement infra n'a été fait pour la Phase 2**, donc un `terraform apply` ne devrait rien montrer de nouveau — mais à confirmer par vous-même avant de taper `yes`, comme toujours.

## Résumé

| Phase | Contenu | Statut |
|---|---|---|
| **Phase 1** | Comptes, pseudos de partie, profil, stats minimum, historique des parties | ✅ **Fait — en production** |
| **Phase 2a** | Stats avancées : séries de victoires, nuits survécues en moyenne, répartition des causes de mort | ✅ **Fait — testé, pas déployé** |
| **Phase 2b** | Rating générique (Elo-inspiré) + coefficients de difficulté par rôle + Performance Score (v1) + ratings spécialisés | ✅ **Fait — testé, pas déployé** |
| **Phase 3** (proposée) | XP/Niveaux, MVP | ⬜ À faire |
| **Phase 4** (proposée) | Badges | ⬜ À faire |
| **Phase 5** (proposée) | Classements | ⬜ À faire |
| **Phase 6** (proposée) | Saisons | ⬜ À faire |
| Transversal | Architecture générique (section 16) | ✅ Respectée à chaque étape livrée |

Le découpage en Phase 3-6 est une proposition de séquencement (chaque phase dépend techniquement de la précédente — les classements ont besoin du rating/XP/MVP, etc.) — pas une contrainte du cahier de charge lui-même, qui ne les ordonne pas explicitement.

## Limites respectées pendant le travail autonome (Phase 2, 7 août 2026)

Cette phase a été construite sans supervision utilisateur en direct, avec des limites explicitement posées avant de commencer :

- **Aucun changement infra/AWS, aucun `terraform apply`, aucune modification de la base de production** — uniquement du code, committé et taggé localement sur `master`.
- **Les commits/tags sont réels et locaux** (le bac à sable où ce travail a eu lieu a un accès disque réel au dépôt) **mais jamais poussés sur GitHub** — aucun identifiant git n'était disponible pour `git push`. Une seule commande à lancer au retour : `git push origin master --follow-tags`.
- **Le client Prisma ne peut pas être régénéré dans ce bac à sable** (son CDN de binaires est bloqué — même limitation que la Phase 1). Tout code touchant directement Prisma (`persistence.ts`, `applyRating.ts`) a été relu à la main, champ par champ, contre `schema.prisma` — pas de preuve par compilation/exécution réelle sur ces fichiers précis. Le reste (packages/rating, apps/server/src/stats/deriveStats.ts, la page profil) est entièrement vérifié par tests automatisés réels + compilation réelle (159 tests, 3 packages compilés, `tsc --noEmit` propre sur le web).
- **Chaque choix de conception ambigu est documenté explicitement** ci-dessous (formule de rating, score de performance v1, coefficients de rôle par défaut) — à relire et ajuster librement.

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

## 11. XP — ⬜ À faire

Rien n'existe. Indépendant du rating (le cahier de charge le précise) — peut être livré avant ou après la Phase 2 Rating sans dépendance technique forte. Nécessite : un champ `User.xp`/`User.level`, une règle de calcul de niveau (100 XP/niveau), et des points d'octroi (participation, victoire, MVP — ce dernier dépend de la section 12).

---

## 12. MVP — ⬜ À faire

Rien n'existe. Nécessite un mécanisme de vote en fin de partie (nouvel écran/étape après `ENDED`), stocké quelque part (nouveau champ sur `PlayerRecord`, ou table dédiée `MvpVote`), et un compteur agrégé affiché sur le profil.

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

## Recommandation pour la suite

Fait (Phase 2a + 2b, 7 août 2026, testé et committé, pas encore déployé — voir l'avertissement en haut du document) :

1. ~~Compléter les statistiques restantes de la section 4~~ ✅
2. ~~Coefficients de difficulté par rôle (section 7)~~ ✅
3. ~~Performance Score par rôle (section 8)~~ 🚧 v1 générique seulement — voir la limite honnête documentée dans cette section
4. ~~Rating générique + calcul final (sections 6 et 9)~~ ✅
5. ~~Ratings spécialisés (section 10)~~ ✅

Reste à faire, par ordre de dépendance :

1. **Journal d'événements structuré côté moteur** — pas fait, et c'est ce qui bloque un vrai Performance Score par rôle (section 8) au-delà de la formule générique actuelle. Recommandé avant d'aller plus loin sur les scores de performance, mais pas bloquant pour XP/MVP/Badges/Classements/Saisons ci-dessous.
2. **XP + MVP** (sections 11-12) — aucune dépendance forte sur le reste, peuvent démarrer n'importe quand.
3. **Badges** (section 13) — dépend de presque tout ce qui précède selon les badges choisis (certains badges ne dépendent que du rating/historique déjà en place, d'autres attendront MVP/XP).
4. **Classements** (section 14) — le classement "par victoires" est faisable dès aujourd'hui avec les données déjà en base ; les autres classements attendent XP/MVP.
5. **Saisons** (section 15) — en dernier, dépend du rating (rien à réinitialiser sans lui).

À confirmer avec l'utilisateur avant de démarrer une nouvelle phase autonome : quelle brique de cette liste devient la prochaine "Phase 3" à scope précisément, et si les choix v1 documentés ci-dessus (formule de rating, coefficients par défaut, Performance Score générique) doivent être ajustés avant d'aller plus loin.
