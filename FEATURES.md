# FEATURES.md — Suivi du cahier de charge « Comptes / Profils / Stats / Rating / Progression »

> Ce document suit, section par section, le cahier de charge fourni le 6 août 2026. Il est mis à jour à chaque phase livrée — c'est la source de vérité sur ce qui est fait, en cours, ou pas commencé. Voir **[ARCHITECTURE.md](./ARCHITECTURE.md)** pour le détail technique de ce qui est listé ✅ ici.
>
> **Décision de scope** : le cahier de charge a été volontairement découpé en phases plutôt que livré en un bloc (accord explicite avec l'utilisateur). **Phases 1 et 2 (2a + 2b) sont terminées et déployées en production** (`https://loupgarou-dbsi.com`, vérifié en jeu réel le 8 août 2026). **Phase 3 (XP/niveau + MVP) est terminée, testée, et committée sur `master` — mais pas encore déployée** (voir "Ce qu'il reste à faire avant déploiement" ci-dessous).

Légende : ✅ Fait · 🚧 Partiel · ⬜ À faire

---

## ⚠️ Ce qu'il reste à faire avant déploiement (Phase 3)

Le code de la Phase 3 est sur `master`, testé (180 tests automatisés au total, tous passants), mais **rien n'a été déployé**. Même déroulé que pour la Phase 2 :

1. `git push origin master`.
2. Test local d'abord : `docker compose down && docker compose up --build`, jouer une partie jusqu'à la fin, voter MVP, vérifier `/profile` (niveau, XP, MVP). Ne pas sauter cette étape — c'est exactement ce genre de test qui a attrapé un vrai bug lors de la Phase 2b (le Dockerfile).
3. `.\deploy-manual.ps1`.
4. **Appliquer le nouveau schéma à la base de production** — trois nouveaux champs sur `User` (`totalXp`, `level`, `mvpCount`), deux nouveaux champs sur `PlayerRecord` (`xpEarned`, `isMvp`). Même commande ECS Exec que d'habitude, additive uniquement.
5. `terraform plan` dans `infra/aws` — aucun changement infra pour cette phase, devrait afficher "No changes." Ne pas `apply` sans relire si ce n'est pas le cas.
6. Vérifier en prod : jouer une partie, voter MVP, checker `/profile`.

## Résumé

| Phase | Contenu | Statut |
|---|---|---|
| **Phase 1** | Comptes, pseudos de partie, profil, stats minimum, historique des parties | ✅ **Fait — en production** |
| **Phase 2a** | Stats avancées : séries de victoires, nuits survécues en moyenne, répartition des causes de mort | ✅ **Fait — en production** |
| **Phase 2b** | Rating générique (Elo-inspiré) + coefficients de difficulté par rôle + Performance Score (v1) + ratings spécialisés | ✅ **Fait — en production** |
| **Phase 3** | XP/Niveaux + MVP (vote post-partie) | ✅ **Fait — testé, pas déployé** |
| **Phase 4** (proposée) | Badges | ⬜ À faire |
| **Phase 5** (proposée) | Classements | ⬜ À faire |
| **Phase 6** (proposée) | Saisons | ⬜ À faire |
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

## Recommandation pour la suite

Fait (Phases 1, 2a, 2b — en production ; Phase 3 — testée, pas encore déployée) :

1. ~~Compléter les statistiques restantes de la section 4~~ ✅
2. ~~Coefficients de difficulté par rôle (section 7)~~ ✅
3. ~~Performance Score par rôle (section 8)~~ 🚧 v1 générique seulement — voir la limite honnête documentée dans cette section
4. ~~Rating générique + calcul final (sections 6 et 9)~~ ✅
5. ~~Ratings spécialisés (section 10)~~ ✅
6. ~~XP + Niveau (section 11)~~ ✅
7. ~~MVP (section 12)~~ ✅

Reste à faire, par ordre de dépendance :

1. **Journal d'événements structuré côté moteur** — pas fait, et c'est ce qui bloque un vrai Performance Score par rôle (section 8) au-delà de la formule générique actuelle. Recommandé avant d'aller plus loin sur les scores de performance, mais pas bloquant pour Badges/Classements/Saisons ci-dessous.
2. **Badges** (section 13) — tout ce dont ça a besoin existe maintenant (rating, historique, XP, MVP) ; dépend juste de quels badges précis on veut définir en premier.
3. **Classements** (section 14) — toutes les données nécessaires existent déjà (rating, victoires, XP, MVP) ; c'est la première section où absolument rien ne bloque plus.
4. **Saisons** (section 15) — en dernier, dépend du rating (rien à réinitialiser sans lui).

À confirmer avec l'utilisateur avant de démarrer la prochaine phase : Badges ou Classements en premier, et si les choix v1 documentés ci-dessus (formule de rating, coefficients par défaut, Performance Score générique) doivent être ajustés avant d'aller plus loin.
