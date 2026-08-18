# Loup-Garou (DBSI) — Recap complet de l'application

Ce document résume comment l'application fonctionne aujourd'hui : l'architecture technique, toutes les règles du jeu, et toutes les améliorations ajoutées récemment. Objectif : vous donner une vue d'ensemble claire pour identifier ce qui mérite d'être amélioré ensuite.

> **Note du 18 août 2026** : ce document est un instantané figé au 6 août (voir la date en bas) — beaucoup a été ajouté depuis (comptes/historique, XP/niveaux/MVP, badges, classements, Afterlife, rôle Prêtre, mode nuit séquentielle, proxy réseau, logs d'actions, retry automatique...) et n'a pas été réintégré ligne par ligne ici pour éviter de dupliquer un contenu qui vivrait ensuite en double. **`FEATURES.md` et `ARCHITECTURE.md`, à la racine du repo, sont les documents tenus à jour en continu** et reflètent l'état réel du code à chaque changement — c'est là qu'il faut regarder pour la liste complète et à jour. La section 8 ci-dessous résume seulement les deux ajouts de la session du 18 août.

---

## 1. Architecture technique

- **Frontend** : React / Next.js (`apps/web`) — écrans lobby, admin, et jeu (`play/[code]`).
- **Serveur temps réel** : Node.js + Socket.IO (`apps/server`) — moteur de jeu, timers, diffusion de l'état à tous les joueurs.
- **Moteur de jeu** : package isolé et testé (`packages/game-engine`) — toute la logique de règles (rôles, phases, votes) est indépendante du serveur/frontend, avec 89 tests automatisés.
- **Base de données** : Prisma / PostgreSQL.
- **Déploiement** : AWS ECS Fargate (conteneurs Docker), infrastructure gérée par Terraform (`infra/`), portable — n'importe qui peut cloner le repo et déployer sur son propre compte AWS sans jamais pointer vers votre infra.
- **Scripts pratiques** :
  - `deploy-manual.ps1` — build + push + déploiement rapide sans passer par GitHub Actions.
  - `stop.ps1` / `start.ps1` — mettre en pause / relancer les instances Fargate entre deux sessions de jeu (économie de coûts).
  - `scripts/deploy-aws.sh` — provisionne toute l'infra AWS depuis zéro sur un compte neuf.

---

## 2. Les rôles disponibles

| Rôle | Camp | Description |
|---|---|---|
| Villageois | Village | Aucun pouvoir, seulement la parole et le vote. |
| Loup-garou | Loups | Se réveille chaque nuit avec les autres loups pour désigner une victime. |
| Loup blanc | Loups | Loup solitaire, joue avec le reste de la meute la nuit (pas de pouvoir spécial de dévoration séparé actuellement). |
| Sorcière | Village | Une potion de soin + une potion de poison, chacune utilisable une seule fois. |
| Voyante | Village | Découvre chaque nuit en secret le camp d'un joueur. |
| Salvateur | Village | Protège un joueur chaque nuit (jamais le même deux nuits de suite). |
| Chasseur | Village | S'il meurt, il abat immédiatement un autre joueur de son choix. |
| Corbeau | Village | Désigne chaque nuit un joueur qui recevra +2 votes le lendemain. |
| Mowgli | Village | Choisit un « père » la première nuit ; si celui-ci meurt, Mowgli devient loup-garou. |

---

## 3. Déroulement d'une partie

1. **Lobby** : les joueurs rejoignent avec un code, l'admin configure les rôles/timers puis lance la partie.
2. **Élection du Chef du village** : candidature (max 3), débat à tour de rôle, vote, annonce (CHEF_REVEAL).
3. **Discussion du jour** (jour 1 puis chaque jour suivant) : chaque joueur parle à tour de rôle.
4. **Nuit** : chaque rôle à pouvoir agit (loups, voyante, sorcière, salvateur, corbeau, mowgli).
5. **Matin** : annonce de qui est mort (ou personne).
6. **Vote du village** : élimination d'un joueur — **désormais séquentiel, un joueur à la fois** (voir section 5).
7. **Égalité** → défense des joueurs à égalité, puis un second vote ; règle configurable si l'égalité persiste (défense répétée, pas d'élimination, tirage au sort, décision du Chef/Admin).
8. **Victoire** : Village (tous les loups éliminés) ou Loups (parité ou majorité atteinte).

---

## 4. Fonctionnalités ajoutées lors des sessions précédentes

- **Timer fiable** : le décompte ne "saute" plus (30, 29, 28... puis retour à 40) — le serveur ancre désormais chaque timer sur une vraie deadline au lieu de la recalculer à chaque action.
- **Vote à liste stable et verrouillé** : pendant les votes (Chef et village), la liste des joueurs ne bouge plus en fonction des votes en direct ; chaque joueur ne peut voter qu'une seule fois par tour (double-tap pour confirmer, anti rage-click).
- **"Passer la parole" pendant le débat des candidats au poste de Chef** : chaque candidat peut céder son tour manuellement.
- **Rôle toujours visible** : un joueur peut revoir son rôle à tout moment (utile si absent au moment de la révélation initiale).
- **Bouton du Chef pour avancer la partie** : le Chef du village peut forcer le passage à la phase suivante (nuit, vote, etc.) sans attendre l'admin ; en cas de décès du Chef, un successeur hérite du bouton.
- **Bonus de vote du Chef configurable** : le vote du Chef compte double, mais seulement au 1er tour d'un vote (pas pendant une égalité/re-vote), et seulement si le nombre de joueurs vivants dépasse un seuil réglable dans l'admin (`chefVoteBonusThreshold`, par défaut 6).
- **Timers configurables par phase** dans l'interface admin (débat, discussion, nuit, vote, défense en cas d'égalité...).
- **Infra portable** : n'importe qui peut cloner le repo et déployer sur son propre AWS sans jamais toucher à votre bucket S3, votre domaine ou votre compte.

---

## 5. Les 3 nouvelles fonctionnalités de cette session

### a) Les loups connaissent leurs coéquipiers dès l'attribution des rôles
Dès le début de partie, si 2 loups (ou plus, Loup blanc inclus) sont présents, chacun voit immédiatement le nom de son/ses coéquipier(s) sur sa carte de rôle — plus besoin d'attendre la première nuit pour se reconnaître.

### b) Les loups peuvent se cibler eux-mêmes ou entre eux la nuit
La liste de cibles du vote de la meute inclut désormais tous les joueurs vivants, y compris les loups eux-mêmes — permet un coup de bluff volontaire (« sacrifier » un des leurs pour brouiller les pistes du village).

### c) Vote du village séquentiel, joueur par joueur (le changement le plus important)
- Le vote n'est plus simultané : chaque joueur vote à son tour, dans l'ordre de la discussion du jour, **le Chef votant toujours en dernier**.
- Chaque joueur dispose de **10 secondes par défaut** (réglable dans l'admin) pour voter ; passé ce délai, son tour est sauté sans vote enregistré.
- Dès qu'un joueur vote, on passe immédiatement au suivant (pas besoin d'attendre le reste du délai).
- L'interface affiche désormais qui est en train de voter et la file d'attente des votants restants, en plus du décompte en direct.
- Correction associée : l'événement de fin de partie (`GAME_ENDED`) est maintenant émis de façon centralisée, quelle que soit la façon dont la partie se termine (vote, timer automatique, ou fin manuelle par l'admin) — avant, certains chemins ne déclenchaient pas correctement l'écran de fin.

---

## 6. Vérifications effectuées

- 89 tests automatisés sur le moteur de jeu, tous passants (dont de nouveaux tests dédiés aux 3 fonctionnalités ci-dessus).
- Compilation TypeScript propre sur les 4 workspaces (`shared`, `game-engine`, `server`, `web`).
- Build Next.js de production réussi.

---

## 7. Pistes à considérer pour la suite

Quelques idées à évaluer en re-jouant avec ces nouveautés, sans que ce soit des problèmes identifiés :

- **Tester en conditions réelles le vote séquentiel** : avec 8-10 joueurs, 10 secondes par joueur peut sembler court ou long selon le rythme du groupe — le seuil est réglable dans l'admin, à ajuster après un ou deux essais.
- **UX du "loup se cible lui-même"** : vérifier à l'usage que la confirmation à deux temps (tap pour armer, tap pour confirmer) est assez claire pour éviter un clic accidentel qui coûterait la vie d'un loup.
- **Notifications de fin de partie** : maintenant que `GAME_ENDED` est centralisé, ce serait le bon moment pour enrichir l'écran de fin (stats de partie, qui a voté pour qui sur toute la partie, etc.) si vous voulez aller plus loin.
- **Rôle du Loup blanc** : sa description mentionne un pouvoir de dévoration d'un loup-garou "selon la configuration" qui n'est pas implémenté actuellement (il joue comme un loup-garou classique) — à clarifier si vous voulez vraiment cette mécanique.
- **Equilibrage** : avec le bonus de vote du Chef + le vote séquentiel + le Corbeau, plusieurs mécaniques influencent maintenant le poids d'un vote — vaut le coup de rejouer une partie complète pour sentir si l'équilibre reste bon.

---

## 8. Ajouts de la session du 18 août 2026

Deux problèmes concrets remontés en jouant en vrai (voir `FEATURES.md` §22-§25 pour tous les détails techniques) :

- **"Parfois impossible de se connecter en wifi, ça marchait en 4G"** → toute l'appli (web + serveur de jeu) passe désormais par un seul port (via un petit proxy nginx) au lieu de deux — certains wifi (invités, hôtel, bureau) bloquent les ports non-standards, jamais la 4G. Corrigé.
- **"Je sélectionne une cible mais Confirmer ne répond pas pendant ~15 secondes"** → root cause : un téléphone qui change d'onglet coupe réellement la connexion (comportement du système, pas un bug de l'appli) ; l'ancienne interface montrait "envoyé" même quand ça avait échoué. Deux corrections : (1) un bandeau visible + boutons désactivés dès qu'une déconnexion est détectée, honnête plutôt que trompeur, et (2) depuis ce soir, un **retry automatique et invisible** : si la confirmation échoue à cause d'un accroc réseau, l'appli réessaie toute seule (jusqu'à 2 fois) sans que le joueur ait besoin de remarquer ou re-cliquer, avec une garantie que l'action ne s'applique jamais deux fois même si le premier essai avait en fait réussi.
- En bonus, chaque connexion/déconnexion et chaque action de jeu est maintenant enregistrée dans un fichier journal (`./logs/`) sur la machine qui héberge la partie, pour pouvoir déboguer un futur problème avec de vraies données plutôt qu'en devinant.

388 tests automatisés au total sur l'ensemble du monorepo (moteur de jeu + rating + serveur + web) après ces ajouts, tous passants.

---

*Document généré le 6 août 2026 — voir la note en tête de document pour la mise à jour du 18 août.*
