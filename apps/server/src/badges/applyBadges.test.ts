import { beforeEach, describe, expect, it, vi } from "vitest";
// vi.mock calls are hoisted above this import by vitest, so the mock below
// is already in place by the time applyBadges.ts's own `import { prisma }
// from "../db/prisma.js"` runs — same pattern as socket/timerOrdering.test.ts.
import { applyBadgesForMvpWinners, applyBadgesForUser } from "./applyBadges.js";

/**
 * A tiny in-memory fake standing in for Prisma — same reasoning as
 * socket/timerOrdering.test.ts / socket/afterlife.test.ts: this sandbox has
 * no network access to fetch Prisma's engine binaries, so every test that
 * touches `../db/prisma.js` mocks it at the source rather than trying to
 * run against a real database. Only the handful of calls applyBadges.ts
 * actually makes are implemented.
 */
const db = {
  users: new Map<string, { id: string; level: number; mvpCount: number }>(),
  games: new Map<string, { id: string; code: string }>(),
  playerRecords: [] as {
    gameId: string;
    enginePlayerId: string;
    userId: string | null;
    result: string | null;
    voyanteWolvesFound: number;
    salvateurSuccessfulProtects: number;
    sorciereWolvesKilledByPoison: number;
    chasseurWolvesKilledByShot: number;
    alienCorrectGuesses: number;
    loupVertSuccessfulSteals: number;
    corbeauSuccessfulMarks: number;
    barbieWolvesRevealed: number;
    barbieMisfires: number;
    mowgliTransformed: boolean;
    wasSoleSurvivor: boolean;
    game: { createdAt: Date; endedAt: Date | null };
  }[],
  userBadges: [] as { userId: string; badgeId: string; unlockedAt: Date }[],
};

function resetDb(): void {
  db.users.clear();
  db.games.clear();
  db.playerRecords = [];
  db.userBadges = [];
}

vi.mock("../db/prisma.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async ({ where: { id } }: any) => db.users.get(id) ?? null),
    },
    game: {
      findUnique: vi.fn(async ({ where: { code } }: any) => [...db.games.values()].find((g) => g.code === code) ?? null),
    },
    playerRecord: {
      findMany: vi.fn(async ({ where: { userId } }: any) => db.playerRecords.filter((r) => r.userId === userId)),
      findUnique: vi.fn(async ({ where: { gameId_enginePlayerId } }: any) => {
        const { gameId, enginePlayerId } = gameId_enginePlayerId;
        return db.playerRecords.find((r) => r.gameId === gameId && r.enginePlayerId === enginePlayerId) ?? null;
      }),
    },
    userBadge: {
      findMany: vi.fn(async ({ where: { userId } }: any) => db.userBadges.filter((b) => b.userId === userId)),
      createMany: vi.fn(async ({ data }: any) => {
        for (const row of data) db.userBadges.push({ ...row, unlockedAt: new Date() });
        return { count: data.length };
      }),
    },
  },
}));

function record(overrides: Partial<(typeof db.playerRecords)[number]> = {}): (typeof db.playerRecords)[number] {
  return {
    gameId: "g1",
    enginePlayerId: "e1",
    userId: "u1",
    result: "WON",
    voyanteWolvesFound: 0,
    salvateurSuccessfulProtects: 0,
    sorciereWolvesKilledByPoison: 0,
    chasseurWolvesKilledByShot: 0,
    alienCorrectGuesses: 0,
    loupVertSuccessfulSteals: 0,
    corbeauSuccessfulMarks: 0,
    barbieWolvesRevealed: 0,
    barbieMisfires: 0,
    mowgliTransformed: false,
    wasSoleSurvivor: false,
    game: { createdAt: new Date("2026-01-01"), endedAt: new Date("2026-01-01") },
    ...overrides,
  };
}

describe("applyBadgesForUser", () => {
  beforeEach(() => {
    resetDb();
  });

  it("unlocks FIRST_GAME after a single game and persists exactly one UserBadge row", async () => {
    db.users.set("u1", { id: "u1", level: 1, mvpCount: 0 });
    db.playerRecords.push(record());

    const newIds = await applyBadgesForUser("u1");
    expect(newIds).toContain("FIRST_GAME");
    expect(db.userBadges.filter((b) => b.userId === "u1" && b.badgeId === "FIRST_GAME")).toHaveLength(1);
  });

  it("is idempotent — calling it again with the same data unlocks nothing new", async () => {
    db.users.set("u1", { id: "u1", level: 1, mvpCount: 0 });
    db.playerRecords.push(record());

    await applyBadgesForUser("u1");
    const secondCall = await applyBadgesForUser("u1");
    expect(secondCall).toEqual([]);
    // Still exactly one FIRST_GAME row, not duplicated.
    expect(db.userBadges.filter((b) => b.badgeId === "FIRST_GAME")).toHaveLength(1);
  });

  it("sums role-mastery contributions across multiple games", async () => {
    db.users.set("u1", { id: "u1", level: 1, mvpCount: 0 });
    for (let i = 0; i < 5; i++) {
      db.playerRecords.push(record({ enginePlayerId: `e${i}`, sorciereWolvesKilledByPoison: 1 }));
    }
    const newIds = await applyBadgesForUser("u1");
    expect(newIds).toContain("CHEMIST");
  });

  it("computes the longest win streak from result history, oldest to newest", async () => {
    db.users.set("u1", { id: "u1", level: 1, mvpCount: 0 });
    const days = ["2026-01-01", "2026-01-02", "2026-01-03"];
    for (const [i, day] of days.entries()) {
      db.playerRecords.push(
        record({ enginePlayerId: `e${i}`, result: "WON", game: { createdAt: new Date(day), endedAt: new Date(day) } }),
      );
    }
    const newIds = await applyBadgesForUser("u1");
    expect(newIds).toContain("HOT_STREAK");
  });

  it("returns [] for an unknown user rather than throwing", async () => {
    expect(await applyBadgesForUser("ghost")).toEqual([]);
  });
});

describe("applyBadgesForMvpWinners", () => {
  beforeEach(() => {
    resetDb();
  });

  it("resolves each winner's account via their durable PlayerRecord row, not any in-memory map", async () => {
    db.games.set("g1", { id: "g1", code: "ABCD" });
    db.users.set("u1", { id: "u1", level: 1, mvpCount: 5 });
    db.playerRecords.push(record({ userId: "u1", enginePlayerId: "winnerPlayerId" }));

    await applyBadgesForMvpWinners("ABCD", ["winnerPlayerId"]);

    expect(db.userBadges.some((b) => b.userId === "u1" && b.badgeId === "POPULAR")).toBe(true);
  });

  it("does nothing for a winner with no linked account", async () => {
    db.games.set("g1", { id: "g1", code: "ABCD" });
    db.playerRecords.push(record({ userId: null, enginePlayerId: "guestPlayerId" }));

    await applyBadgesForMvpWinners("ABCD", ["guestPlayerId"]);
    expect(db.userBadges).toHaveLength(0);
  });
});
