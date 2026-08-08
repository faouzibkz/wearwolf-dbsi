import { describe, expect, it } from "vitest";
import { tallyMvpVotes } from "./tallyMvpVotes.js";

describe("tallyMvpVotes", () => {
  it("returns the single player with the most votes", () => {
    const winners = tallyMvpVotes({ p1: "p2", p3: "p2", p4: "p5" });
    expect(winners).toEqual(["p2"]);
  });

  it("returns every player tied for the most votes (confirmed product rule: all tied winners get it)", () => {
    const winners = tallyMvpVotes({ p1: "p2", p3: "p4", p5: "p2", p6: "p4" });
    expect(new Set(winners)).toEqual(new Set(["p2", "p4"]));
    expect(winners).toHaveLength(2);
  });

  it("returns an empty array when nobody voted", () => {
    expect(tallyMvpVotes({})).toEqual([]);
  });

  it("a single vote makes that player the sole winner", () => {
    expect(tallyMvpVotes({ p1: "p2" })).toEqual(["p2"]);
  });
});
