import { describe, expect, it } from "vitest";
import { mvpVotingRegistry } from "./mvpVotingRegistry.js";

// Each test uses its own game code so state never bleeds between tests
// (the registry is a shared singleton, same as production usage).

describe("mvpVotingRegistry", () => {
  it("rejects a vote before voting has been opened", () => {
    expect(() => mvpVotingRegistry.castVote("GAME-NEVER-OPENED", "p1", "p2")).toThrow();
  });

  it("rejects a self-vote", () => {
    mvpVotingRegistry.open("GAME-SELF-VOTE", ["p1", "p2", "p3"]);
    expect(() => mvpVotingRegistry.castVote("GAME-SELF-VOTE", "p1", "p1")).toThrow();
  });

  it("rejects a vote for a player who wasn't in the game", () => {
    mvpVotingRegistry.open("GAME-BAD-TARGET", ["p1", "p2"]);
    expect(() => mvpVotingRegistry.castVote("GAME-BAD-TARGET", "p1", "someone-else")).toThrow();
  });

  it("rejects a vote from a player who wasn't in the game", () => {
    mvpVotingRegistry.open("GAME-BAD-VOTER", ["p1", "p2"]);
    expect(() => mvpVotingRegistry.castVote("GAME-BAD-VOTER", "outsider", "p1")).toThrow();
  });

  it("is not complete until every eligible player has voted", () => {
    mvpVotingRegistry.open("GAME-PROGRESS", ["p1", "p2", "p3"]);
    mvpVotingRegistry.castVote("GAME-PROGRESS", "p1", "p2");
    expect(mvpVotingRegistry.isComplete("GAME-PROGRESS")).toBe(false);
    mvpVotingRegistry.castVote("GAME-PROGRESS", "p2", "p3");
    expect(mvpVotingRegistry.isComplete("GAME-PROGRESS")).toBe(false);
    mvpVotingRegistry.castVote("GAME-PROGRESS", "p3", "p2");
    expect(mvpVotingRegistry.isComplete("GAME-PROGRESS")).toBe(true);
  });

  it("re-voting overwrites a player's previous choice instead of erroring", () => {
    mvpVotingRegistry.open("GAME-REVOTE", ["p1", "p2", "p3"]);
    mvpVotingRegistry.castVote("GAME-REVOTE", "p1", "p2");
    mvpVotingRegistry.castVote("GAME-REVOTE", "p1", "p3");
    const state = mvpVotingRegistry.getState("GAME-REVOTE");
    expect(state?.votes.get("p1")).toBe("p3");
    expect(state?.votes.size).toBe(1);
  });

  it("finalize tallies the winner(s) and is idempotent", () => {
    mvpVotingRegistry.open("GAME-FINALIZE", ["p1", "p2", "p3"]);
    mvpVotingRegistry.castVote("GAME-FINALIZE", "p1", "p2");
    mvpVotingRegistry.castVote("GAME-FINALIZE", "p3", "p2");
    const result = mvpVotingRegistry.finalize("GAME-FINALIZE");
    expect(result.winners).toEqual(["p2"]);
    expect(result.finalized).toBe(true);

    // Casting another vote after finalize must be rejected...
    expect(() => mvpVotingRegistry.castVote("GAME-FINALIZE", "p2", "p1")).toThrow();
    // ...and re-finalizing must not change the already-computed result.
    const again = mvpVotingRegistry.finalize("GAME-FINALIZE");
    expect(again.winners).toEqual(["p2"]);
  });

  it("finalize with zero votes cast yields no winners at all", () => {
    mvpVotingRegistry.open("GAME-NO-VOTES", ["p1", "p2"]);
    const result = mvpVotingRegistry.finalize("GAME-NO-VOTES");
    expect(result.winners).toEqual([]);
  });

  it("clear removes the game's state entirely", () => {
    mvpVotingRegistry.open("GAME-CLEAR", ["p1", "p2"]);
    mvpVotingRegistry.clear("GAME-CLEAR");
    expect(mvpVotingRegistry.getState("GAME-CLEAR")).toBeUndefined();
    expect(() => mvpVotingRegistry.castVote("GAME-CLEAR", "p1", "p2")).toThrow();
  });

  it("defaults to no deadline (durationSeconds omitted)", () => {
    mvpVotingRegistry.open("GAME-NO-DEADLINE", ["p1", "p2"]);
    expect(mvpVotingRegistry.getState("GAME-NO-DEADLINE")?.deadlineAt).toBeNull();
  });

  it("0 or negative durationSeconds also disables the deadline", () => {
    mvpVotingRegistry.open("GAME-ZERO-DEADLINE", ["p1", "p2"], 0);
    expect(mvpVotingRegistry.getState("GAME-ZERO-DEADLINE")?.deadlineAt).toBeNull();
    mvpVotingRegistry.open("GAME-NEG-DEADLINE", ["p1", "p2"], -5);
    expect(mvpVotingRegistry.getState("GAME-NEG-DEADLINE")?.deadlineAt).toBeNull();
  });

  it("a positive durationSeconds records an epoch-ms deadline that many seconds out", () => {
    const before = Date.now();
    mvpVotingRegistry.open("GAME-WITH-DEADLINE", ["p1", "p2"], 120);
    const after = Date.now();
    const deadlineAt = mvpVotingRegistry.getState("GAME-WITH-DEADLINE")?.deadlineAt;
    expect(deadlineAt).not.toBeNull();
    expect(deadlineAt!).toBeGreaterThanOrEqual(before + 120_000);
    expect(deadlineAt!).toBeLessThanOrEqual(after + 120_000);
  });
});
