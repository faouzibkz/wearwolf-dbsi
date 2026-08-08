/**
 * Cahier de charge #2 §17.4c ("Le système doit permettre d'ajouter
 * facilement de nouveaux badges" — see FEATURES.md section 13). Same
 * "registry, not DB rows" pattern already proven for
 * packages/rating/src/performance.ts's PERFORMANCE_SCORERS and
 * packages/game-engine's ROLE_REGISTRY: a badge's metadata (name,
 * description, secret flag) and its unlock condition live together, in
 * code, in BADGE_REGISTRY below — adding a brand new badge is exactly one
 * new entry in this array, no migration, no new table row to seed.
 * schema.prisma's UserBadge table only ever stores WHICH badge ids a user
 * has unlocked and when — never the badges' own definitions.
 *
 * Pure and Prisma-free (same split as ../stats/deriveStats.ts and
 * ./deriveBadgeContribution.ts): evaluateBadges() takes a plain
 * BadgeContext and returns plain badge ids, so it's unit-testable without
 * a database. badges/applyBadges.ts is the only caller — it assembles the
 * context from a user's aggregate PlayerRecord/User data and persists
 * whichever ids come back that aren't already unlocked.
 */
export interface BadgeContext {
  gamesPlayed: number;
  /** Best win streak ever reached (not the CURRENT streak) — once earned, a badge is never taken away, so a badge gated on a streak must check the account's best-ever run, not whatever it's at right now. */
  longestWinStreak: number;
  level: number;
  mvpCount: number;
  /** Games where this player was the sole surviving member of the winning team. */
  soleSurvivorCount: number;
  voyanteWolvesFound: number;
  salvateurSuccessfulProtects: number;
  sorciereWolvesKilledByPoison: number;
  chasseurWolvesKilledByShot: number;
  alienCorrectGuesses: number;
  loupVertSuccessfulSteals: number;
  corbeauSuccessfulMarks: number;
  barbieWolvesRevealed: number;
  barbieMisfireCount: number;
  mowgliTransformCount: number;
}

export interface BadgeDefinition {
  id: string;
  name: string;
  description: string;
  /** Secret badges are omitted from the "locked" list shown to a player who hasn't earned them yet — see http/badgeRoutes.ts — but appear normally, with full name/description, once unlocked. */
  secret: boolean;
  condition: (ctx: BadgeContext) => boolean;
}

export const BADGE_REGISTRY: BadgeDefinition[] = [
  // --- Participation ---
  {
    id: "FIRST_GAME",
    name: "Première Partie",
    description: "Jouer votre première partie.",
    secret: false,
    condition: (ctx) => ctx.gamesPlayed >= 1,
  },
  {
    id: "VETERAN",
    name: "Vétéran",
    description: "Jouer 50 parties.",
    secret: false,
    condition: (ctx) => ctx.gamesPlayed >= 50,
  },
  {
    id: "CENTURION",
    name: "Centurion",
    description: "Jouer 100 parties.",
    secret: false,
    condition: (ctx) => ctx.gamesPlayed >= 100,
  },

  // --- Résultats ---
  {
    id: "HOT_STREAK",
    name: "Série Chaude",
    description: "Gagner 3 parties d'affilée.",
    secret: false,
    condition: (ctx) => ctx.longestWinStreak >= 3,
  },
  {
    id: "UNSTOPPABLE",
    name: "Increvable",
    description: "Gagner 5 parties d'affilée.",
    secret: false,
    condition: (ctx) => ctx.longestWinStreak >= 5,
  },
  {
    id: "LAST_STANDING",
    name: "Dernier Debout",
    description: "Être le dernier survivant de son camp lors d'une victoire.",
    secret: false,
    condition: (ctx) => ctx.soleSurvivorCount >= 1,
  },

  // --- Maîtrise par rôle (journal d'événements, §17.4a) ---
  {
    id: "EAGLE_EYE",
    name: "Œil de Lynx",
    description: "En tant que Voyante, démasquer 10 loups en inspection (cumulé).",
    secret: false,
    condition: (ctx) => ctx.voyanteWolvesFound >= 10,
  },
  {
    id: "GUARDIAN_ANGEL",
    name: "Ange Gardien",
    description: "En tant que Salvateur, sauver 10 joueurs d'une attaque de loups (cumulé).",
    secret: false,
    condition: (ctx) => ctx.salvateurSuccessfulProtects >= 10,
  },
  {
    id: "CHEMIST",
    name: "Chimiste",
    description: "En tant que Sorcière, empoisonner un loup avec succès 5 fois (cumulé).",
    secret: false,
    condition: (ctx) => ctx.sorciereWolvesKilledByPoison >= 5,
  },
  {
    id: "SHARPSHOOTER",
    name: "Tireur d'Élite",
    description: "En tant que Chasseur, abattre un loup avec son tir de vengeance 5 fois (cumulé).",
    secret: false,
    condition: (ctx) => ctx.chasseurWolvesKilledByShot >= 5,
  },
  {
    id: "TELEPATH",
    name: "Télépathe",
    description: "En tant qu'Alien, deviner juste 10 fois (cumulé).",
    secret: false,
    condition: (ctx) => ctx.alienCorrectGuesses >= 10,
  },
  {
    id: "INFILTRATOR",
    name: "Infiltré",
    description: "En tant que Loup Vert, voler un pouvoir avec succès 5 fois (cumulé).",
    secret: false,
    condition: (ctx) => ctx.loupVertSuccessfulSteals >= 5,
  },
  {
    id: "CUNNING_CROW",
    name: "Corbeau Malin",
    description: "En tant que Corbeau, faire éliminer sa cible marquée 5 fois (cumulé).",
    secret: false,
    condition: (ctx) => ctx.corbeauSuccessfulMarks >= 5,
  },
  {
    id: "ACTRESS",
    name: "Actrice",
    description: "En tant que Barbie, démasquer un vrai loup avec son pouvoir 3 fois (cumulé).",
    secret: false,
    condition: (ctx) => ctx.barbieWolvesRevealed >= 3,
  },

  // --- Progression / Social ---
  {
    id: "POPULAR",
    name: "Populaire",
    description: "Recevoir le vote MVP 5 fois.",
    secret: false,
    condition: (ctx) => ctx.mvpCount >= 5,
  },
  {
    id: "LEVELING_UP",
    name: "Montée en Puissance",
    description: "Atteindre le niveau 10.",
    secret: false,
    condition: (ctx) => ctx.level >= 10,
  },

  // --- Secrets (cachés jusqu'au déblocage) ---
  {
    id: "MISFIRE",
    name: "Coup Fourré",
    description: "Le pouvoir de Barbie a démasqué un innocent — vous mourez tous les deux.",
    secret: true,
    condition: (ctx) => ctx.barbieMisfireCount >= 1,
  },
  {
    id: "IMAGINARY_FRIEND",
    name: "Ami Imaginaire",
    description: "En tant que Mowgli, vous vous transformez en Loup-garou à la mort de votre \"père\".",
    secret: true,
    condition: (ctx) => ctx.mowgliTransformCount >= 1,
  },
];

/** Every badge id currently satisfied by `ctx` — callers diff this against what's already unlocked. */
export function evaluateBadges(ctx: BadgeContext): string[] {
  return BADGE_REGISTRY.filter((b) => b.condition(ctx)).map((b) => b.id);
}
