import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Same reasoning as badges/applyBadges.test.ts: no network access to fetch
 * Prisma's engine binaries in this sandbox, so `../db/prisma.js` is mocked
 * at the source with a tiny in-memory fake rather than a real database.
 */
const db = {
  users: [] as { id: string; displayName: string; ratingGlobal: number; ratingVillage: number; ratingWolf: number; ratingSolo: number; totalXp: number; mvpCount: number }[],
  playerRecords: [] as { userId: string | null; result: string | null }[],
};

function resetDb(): void {
  db.users = [];
  db.playerRecords = [];
}

vi.mock("./prisma.js", () => ({
  prisma: {
    user: {
      findMany: vi.fn(async ({ where, orderBy, take, select }: any) => {
        let rows = db.users as any[];
        if (where?.id?.in) rows = rows.filter((u) => where.id.in.includes(u.id));
        if (orderBy) {
          const [field, direction] = Object.entries(orderBy)[0] as [string, string];
          rows = [...rows].sort((a: any, b: any) => (direction === "desc" ? b[field] - a[field] : a[field] - b[field]));
        }
        if (take) rows = rows.slice(0, take);
        if (!select) return rows;
        return rows.map((u: any) => {
          const picked: Record<string, unknown> = {};
          for (const key of Object.keys(select)) picked[key] = u[key];
          return picked;
        });
      }),
    },
    playerRecord: {
      groupBy: vi.fn(async ({ where, orderBy, take }: any) => {
        const won = db.playerRecords.filter((r) => r.result === where.result && r.userId !== null);
        const counts = new Map<string, number>();
        for (const r of won) counts.set(r.userId!, (counts.get(r.userId!) ?? 0) + 1);
        let entries = [...counts.entries()].map(([userId, count]) => ({ userId, _count: { userId: count } }));
        const direction = orderBy?._count?.userId ?? "desc";
        entries.sort((a, b) => (direction === "desc" ? b._count.userId - a._count.userId : a._count.userId - b._count.userId));
        return entries.slice(0, take);
      }),
    },
  },
}));

import { getLeaderboard } from "./persistence.js";

describe("getLeaderboard", () => {
  beforeEach(() => {
    resetDb();
  });

  it("RATING_GLOBAL: sorts users by ratingGlobal descending and ranks them 1..N", async () => {
    db.users.push(
      { id: "u1", displayName: "Alice", ratingGlobal: 1200, ratingVillage: 1000, ratingWolf: 1000, ratingSolo: 1000, totalXp: 0, mvpCount: 0 },
      { id: "u2", displayName: "Bob", ratingGlobal: 1500, ratingVillage: 1000, ratingWolf: 1000, ratingSolo: 1000, totalXp: 0, mvpCount: 0 },
      { id: "u3", displayName: "Cy", ratingGlobal: 900, ratingVillage: 1000, ratingWolf: 1000, ratingSolo: 1000, totalXp: 0, mvpCount: 0 },
    );
    const entries = await getLeaderboard("RATING_GLOBAL", 20);
    expect(entries.map((e) => e.displayName)).toEqual(["Bob", "Alice", "Cy"]);
    expect(entries.map((e) => e.rank)).toEqual([1, 2, 3]);
    expect(entries[0]!.value).toBe(1500);
  });

  it("respects the limit", async () => {
    for (let i = 0; i < 5; i++) {
      db.users.push({ id: `u${i}`, displayName: `P${i}`, ratingGlobal: i, ratingVillage: 1000, ratingWolf: 1000, ratingSolo: 1000, totalXp: 0, mvpCount: 0 });
    }
    const entries = await getLeaderboard("RATING_GLOBAL", 2);
    expect(entries).toHaveLength(2);
  });

  it("WINS: aggregates PlayerRecord wins per user and resolves display names", async () => {
    db.users.push(
      { id: "u1", displayName: "Alice", ratingGlobal: 1000, ratingVillage: 1000, ratingWolf: 1000, ratingSolo: 1000, totalXp: 0, mvpCount: 0 },
      { id: "u2", displayName: "Bob", ratingGlobal: 1000, ratingVillage: 1000, ratingWolf: 1000, ratingSolo: 1000, totalXp: 0, mvpCount: 0 },
    );
    db.playerRecords.push(
      { userId: "u1", result: "WON" },
      { userId: "u1", result: "WON" },
      { userId: "u1", result: "LOST" },
      { userId: "u2", result: "WON" },
      { userId: null, result: "WON" }, // unlinked guest — must never show up
    );
    const entries = await getLeaderboard("WINS", 20);
    expect(entries).toEqual([
      { rank: 1, userId: "u1", displayName: "Alice", value: 2 },
      { rank: 2, userId: "u2", displayName: "Bob", value: 1 },
    ]);
  });

  it("WINS: returns an empty list when nobody has won a game yet", async () => {
    expect(await getLeaderboard("WINS", 20)).toEqual([]);
  });

  it("XP and MVP read the right User columns", async () => {
    db.users.push(
      { id: "u1", displayName: "Alice", ratingGlobal: 1000, ratingVillage: 1000, ratingWolf: 1000, ratingSolo: 1000, totalXp: 500, mvpCount: 3 },
      { id: "u2", displayName: "Bob", ratingGlobal: 1000, ratingVillage: 1000, ratingWolf: 1000, ratingSolo: 1000, totalXp: 200, mvpCount: 9 },
    );
    const byXp = await getLeaderboard("XP", 20);
    expect(byXp.map((e) => e.displayName)).toEqual(["Alice", "Bob"]);

    const byMvp = await getLeaderboard("MVP", 20);
    expect(byMvp.map((e) => e.displayName)).toEqual(["Bob", "Alice"]);
  });
});
