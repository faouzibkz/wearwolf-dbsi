# FEATURES.md — Suivi du cahier de charge « Comptes / Profils / Stats / Rating / Progression »

> Ce document suit, section par section, le cahier de charge fourni le 6 août 2026. Il est mis à jour à chaque phase livrée — c'est la source de vérité sur ce qui est fait, en cours, ou pas commencé. Voir **[ARCHITECTURE.md](./ARCHITECTURE.md)** pour le détail technique de ce qui est listé ✅ ici.
>
> **Décision de scope** : le cahier de charge a été volontairement découpé en phases plutôt que livré en un bloc (accord explicite avec l'utilisateur). **Phase 1 est terminée et déployée en production** (`https://loupgarou-dbsi.com`). Rien au-delà n'est commencé.

Légende : ✅ Fait · 🚧 Partiel · ⬜ À faire

---

## Résumé

| Phase | Contenu | Statut |
|---|---|---|
| **Phase 1** | Comptes, pseudos de partie, profil, stats minimum, historique des parties | ✅ **Fait — en production** |
| **Phase 2** (proposée) | Rating (Elo générique) + coefficients de difficulté par rôle + Performance Score | ⬜ À faire |
| **Phase 3** (proposée) | Ratings spécialisés (Village/Loups/Solo), XP/Niveaux, MVP | ⬜ À faire |
| **Phase 4** (proposée) | Badges | ⬜ À faire |
| **Phase 5** (proposée) | Classements | ⬜ À faire |
| **Phase 6** (proposée) | Saisons | ⬜ À faire |
| Transversal | Architecture générique (section 16) | ✅ Respectée à chaque étape livrée |

Le découpage en Phase 2-6 est une proposition de séquencement (chaque phase dépend techniquement de la précédente — le rating a besoin du Performance Score, les classements ont besoin du rating, etc.) — pas une contrainte du cahier de charge lui-même, qui ne les ordonne pas explicitement.

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

## 4. Statistiques — 🚧 Partiel (le minimum est fait, le reste ne l'est pas)

### Minimum (explicitement demandé en premier) — ✅ Fait
- Games Played, Games Won, Games Lost, Win Rate → `getUserAggregateStats()`, affiché sur `/profile`.

### Deuxième palier — ⬜ À faire
- Average Survival, Current Win Streak, Longest Win Streak — aucune de ces trois n'est calculée aujourd'hui. `deathMoment`/`isAlive` sont déjà stockés par partie (le nécessaire brut existe), il manque le calcul agrégé.

### Troisième palier — ⬜ À faire
- First Night Death, Killed by Wolves, Executed by Village, Survived Until End — `deathCause`/`deathMoment` sont déjà stockés (`PlayerRecord`), mais aucun agrégat de ce type n'est exposé par l'API aujourd'hui. C'est presque uniquement une nouvelle requête/vue sur des données déjà présentes.

### Nombre de parties par rôle — ✅ Fait
- `getUserAggregateStats().perRole` : Games/Wins/Losses/Win Rate par `roleId`, **entièrement générique** (group-by sur les `roleId` réellement présents en base — un nouveau rôle apparaît sans changement de code, conformément à la section 16). Manque uniquement "Average Survival" par rôle (même remarque que ci-dessus).

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

## 6. Rating — ⬜ À faire

Rien n'existe encore : ni valeur initiale (1000), ni formule d'évolution, ni prise en compte de la performance/difficulté. C'est la pièce centrale de la Phase 2.

Pré-requis déjà en place pour la construire proprement : `team` et `result` par joueur/partie sont déjà stockés (`PlayerRecord`), et `getFinalPlayerSummaries()` donne déjà, à la fin de chaque partie, tout ce qu'il faut savoir sur chaque joueur — il ne manque que la formule elle-même et une colonne `User.rating` (ou une table séparée si on veut garder l'historique de rating dans le temps, utile pour la section 15 "Saisons").

---

## 7. Difficulté des rôles — ⬜ À faire

Aucun coefficient n'existe. Exigence explicite du cahier de charge : **configurable, jamais codé en dur**. Approche cohérente avec l'architecture déjà en place : une table (ou un champ JSON) `RoleDifficulty { roleId, coefficient }`, lue dynamiquement — jamais un `switch(roleId)` dans le code de calcul du rating, exactement comme `ROLE_METADATA` fonctionne déjà pour l'équipe/description d'un rôle.

---

## 8. Performance Score — ⬜ À faire

Rien n'existe. C'est la pièce la plus délicate du cahier de charge : chaque rôle doit pouvoir définir **sa propre formule** (inspections utiles pour la Voyante, discrétion pour le Loup, etc.), sans jamais introduire de branchement par rôle dans le moteur de jeu. Nécessite très probablement une nouvelle interface côté `packages/game-engine` (quelque chose comme `RoleModule.computePerformanceScore(events): number`), pour que chaque module de rôle expose sa propre logique — dans le même esprit que `hasNightAction`/`hasDeathTrigger` sur `ROLE_METADATA` aujourd'hui, mais avec accès aux événements détaillés de la partie (qui n'existent pas encore sous forme structurée — voir "Prérequis manquant" ci-dessous).

**Prérequis manquant** : le moteur ne conserve pas aujourd'hui un journal structuré des actions de chaque joueur (qui a inspecté qui, qui a voté quoi et quand, etc.) au-delà de ce qui est nécessaire au déroulement de la partie elle-même. Construire des Performance Scores fiables demandera probablement d'introduire ce journal d'événements en premier.

---

## 9. Calcul du rating (résultat + performance + coefficient + rating moyen) — ⬜ À faire

Dépend entièrement des sections 6, 7 et 8. Rien à faire ici avant elles.

---

## 10. Ratings spécialisés (Global/Village/Loups/Solo) — ⬜ À faire

Dépend de la section 6. Une fois le rating générique en place, le décliner par équipe est une extension directe (filtrer les mêmes calculs par `team` au lieu d'agréger toutes les parties).

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

Proposition d'ordre pour la Phase 2, dans l'ordre où chaque brique dépend techniquement de la précédente :

1. Compléter les statistiques restantes de la section 4 (Average Survival, streaks, First Night Death, etc.) — rapide, aucune nouvelle donnée à collecter, juste de nouveaux agrégats sur ce qui existe déjà.
2. Journal d'événements structuré côté moteur (prérequis du Performance Score).
3. Coefficients de difficulté par rôle (section 7) — configuration simple, indépendante du reste.
4. Performance Score par rôle (section 8) — la pièce la plus lourde.
5. Rating générique + calcul final (sections 6 et 9).
6. Ratings spécialisés (section 10).
7. XP + MVP (sections 11-12, peuvent être menées en parallèle de 5-6, aucune dépendance forte).
8. Badges (section 13) — dépend de presque tout ce qui précède selon les badges choisis.
9. Classements (section 14) — dépend du rating/XP/MVP.
10. Saisons (section 15) — en dernier, dépend du rating.

À confirmer avec l'utilisateur avant de démarrer : quelle brique de cette liste devient la prochaine "Phase 2" à scope précisément (comme cela a été fait pour la Phase 1).
