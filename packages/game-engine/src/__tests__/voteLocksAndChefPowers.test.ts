import { describe, expect, it } from "vitest";
import { GameEngine } from "../engine/GameEngine";
import { castDayVotesInOrder, seededRng } from "./helpers";

function bootToDayVote(names: string[], seed: number) {
  const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1 } }, seededRng(seed));
  const ids: Record<string, string> = {};
  for (const n of names) ids[n] = engine.addPlayer(n).id;
  engine.startGame();
  engine.volunteerForChef(ids[names[0]!]!);
  engine.forceStartChefDebate();
  engine.advanceChefSpeaker();
  for (const n of names.slice(1)) engine.castChefVote(ids[n]!, ids[names[0]!]!);
  engine.tallyChefVoteAndProceed();
  engine.proceedFromChefRevealToDiscussion();
  engine.endDay1Discussion();
  engine.resolveNightAndProceed();
  engine.proceedFromMorningToDay();
  engine.endDayDiscussion();
  return { engine, ids };
}

describe("day vote: one locked vote per player per round", () => {
  it("rejects a second vote attempt from the same player in the same round (their turn is already spent)", () => {
    const names = ["A", "B", "C", "D", "E"];
    const { engine, ids } = bootToDayVote(names, 5);

    const voter = engine.getCurrentDayVoterId()!;
    engine.castDayVote(voter, ids.C!);
    // Their turn has passed — voting again this round is rejected (whether
    // by the "not your turn" guard or the "already voted" guard is an
    // implementation detail; both enforce the same one-vote-per-round rule).
    expect(() => engine.castDayVote(voter, ids.D!)).toThrow();
    expect(engine.getPublicState().dayVotes[voter]).toBe(ids.C);
  });

  it("still allows a fresh single vote once a new round opens after a tie", () => {
    const names = ["A", "B", "C", "D"];
    const { engine, ids } = bootToDayVote(names, 9);

    // A: C, B: D, C: C, D: D -> 2-2 tie -> TIE_DEFENSE.
    const outcome = castDayVotesInOrder(engine, {
      [ids.A!]: ids.C!,
      [ids.B!]: ids.D!,
      [ids.C!]: ids.C!,
      [ids.D!]: ids.D!,
    });
    expect(outcome?.tie).toBe(true);
    engine.endTieDefense(); // -> DAY_VOTE round 2

    const voter = engine.getCurrentDayVoterId()!;
    engine.castDayVote(voter, ids.C!); // fresh vote, round 2 — must succeed
    expect(() => engine.castDayVote(voter, ids.D!)).toThrow();
  });
});

describe("chef vote: one locked vote per player, live tally exposed", () => {
  it("rejects a second vote from the same player", () => {
    const names = ["A", "B", "C", "D", "E"];
    const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1 } }, seededRng(3));
    const ids: Record<string, string> = {};
    for (const n of names) ids[n] = engine.addPlayer(n).id;
    engine.startGame();
    engine.volunteerForChef(ids.A!);
    engine.volunteerForChef(ids.B!);
    engine.forceStartChefDebate();
    engine.advanceChefSpeaker();
    engine.advanceChefSpeaker();

    engine.castChefVote(ids.C!, ids.A!);
    expect(() => engine.castChefVote(ids.C!, ids.B!)).toThrow(/déjà voté/);
    expect(engine.getPublicState().chefVotes[ids.C!]).toBe(ids.A);
    expect(engine.getPublicState().chefVoteTally).toEqual({ [ids.A!]: 1 });
  });

  it("exposes chefVotes/chefVoteTally only during CHEF_VOTE", () => {
    const names = ["A", "B", "C", "D"];
    const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1 } }, seededRng(3));
    const ids: Record<string, string> = {};
    for (const n of names) ids[n] = engine.addPlayer(n).id;
    engine.startGame();
    expect(engine.getPublicState().chefVotes).toEqual({});
    expect(engine.getPublicState().chefVoteTally).toEqual({});

    engine.volunteerForChef(ids.A!);
    engine.forceStartChefDebate();
    engine.advanceChefSpeaker();
    engine.castChefVote(ids.B!, ids.A!);
    expect(engine.getPublicState().chefVotes).toEqual({ [ids.B!]: ids.A! });

    engine.castChefVote(ids.C!, ids.A!);
    engine.tallyChefVoteAndProceed();
    // Ballot is CHEF_VOTE-scoped only, same as dayVotes is DAY_VOTE-scoped.
    expect(engine.getPublicState().chefVotes).toEqual({});
  });
});

describe("Chef debate: self-serve pass-la-parole", () => {
  it("getCurrentChefDebateSpeakerId tracks the live speaker and advances", () => {
    const names = ["A", "B", "C", "D"];
    const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1 } }, seededRng(3));
    const ids: Record<string, string> = {};
    for (const n of names) ids[n] = engine.addPlayer(n).id;
    engine.startGame();
    engine.volunteerForChef(ids.A!);
    engine.volunteerForChef(ids.B!);
    engine.forceStartChefDebate();

    expect(engine.getCurrentChefDebateSpeakerId()).toBe(ids.A);
    engine.advanceChefSpeaker();
    expect(engine.getCurrentChefDebateSpeakerId()).toBe(ids.B);
    engine.advanceChefSpeaker();
    expect(engine.getCurrentChefDebateSpeakerId()).toBeNull(); // done -> CHEF_VOTE
    expect(engine.getPhase()).toBe("CHEF_VOTE");
  });
});

describe("Chef vote bonus is round-1 only", () => {
  it("suppresses the Chef's double-vote bonus during a tie-break re-vote, even with 7+ alive", () => {
    const names = ["Chef", "B", "C", "D", "E", "F", "G"];
    const engine = GameEngine.createGame(
      { roleCounts: { LOUP_GAROU: 1 }, chefVoteBonusThreshold: 6 },
      seededRng(3),
    );
    const ids: Record<string, string> = {};
    for (const n of names) ids[n] = engine.addPlayer(n).id;
    engine.startGame();
    engine.volunteerForChef(ids.Chef!);
    engine.forceStartChefDebate();
    engine.advanceChefSpeaker();
    for (const n of names.slice(1)) engine.castChefVote(ids[n]!, ids.Chef!);
    engine.tallyChefVoteAndProceed();
    engine.proceedFromChefRevealToDiscussion();
    engine.endDay1Discussion();
    engine.resolveNightAndProceed(); // nobody targeted -> all 7 still alive
    engine.proceedFromMorningToDay();
    engine.endDayDiscussion();

    // Round 1: bonus is active (7 alive > threshold 6). B and E vote D
    // (weight 2); the Chef votes alone for C, which only reaches weight 2
    // too because the bonus is active -> tie.
    const round1 = castDayVotesInOrder(engine, {
      [ids.B!]: ids.D!,
      [ids.E!]: ids.D!,
      [ids.Chef!]: ids.C!,
    });
    expect(round1?.tie).toBe(true);
    expect(round1?.tiedIds.slice().sort()).toEqual([ids.C, ids.D].sort());
    engine.endTieDefense(); // -> DAY_VOTE round 2

    // Round 2: same shape (B + F vote D for weight 2, Chef votes C alone)
    // but the bonus must NOT apply this time — so C only reaches weight 1
    // and D wins outright instead of tying again.
    const round2 = castDayVotesInOrder(engine, {
      [ids.B!]: ids.D!,
      [ids.F!]: ids.D!,
      [ids.Chef!]: ids.C!,
    });
    expect(round2?.tie).toBe(false);
    expect(round2?.eliminatedId).toBe(ids.D);
  });
});

describe("day vote round tracking", () => {
  it("getDayVoteRound() reflects round 1 -> round 2 after a tie", () => {
    const names = ["A", "B", "C", "D"];
    const { engine, ids } = bootToDayVote(names, 9);
    expect(engine.getDayVoteRound()).toBe(1);

    const outcome = castDayVotesInOrder(engine, {
      [ids.A!]: ids.C!,
      [ids.B!]: ids.D!,
      [ids.C!]: ids.C!,
      [ids.D!]: ids.D!,
    });
    expect(outcome?.tie).toBe(true);
    expect(engine.getDayVoteRound()).toBe(2);
  });
});

describe("pause/resume preserve remaining time", () => {
  it("resume() restores exactly the remaining time captured at pause(), not a fresh full duration", () => {
    const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1 } }, seededRng(1));
    engine.setPhaseTimer(30); // pretend a 30s deadline was just set
    const originalDeadline = engine.getPhaseEndsAt()!;

    // Simulate 10 seconds passing before the admin pauses.
    const realNow = Date.now;
    Date.now = () => realNow() + 10_000;
    try {
      engine.pause();
      expect(engine.getPhaseEndsAt()).toBe(originalDeadline); // untouched while paused

      // Simulate the game sitting paused for a while — should NOT count
      // against the remaining time.
      Date.now = () => realNow() + 10_000 + 60_000;
      engine.resume();
      const newDeadline = engine.getPhaseEndsAt()!;
      const remaining = newDeadline - Date.now();
      // ~20s should remain (30s - 10s elapsed before pause), not ~-40s
      // (which is what "restart the absolute deadline" would have left
      // pause+60s-later at) and not a fresh 30s either.
      expect(remaining).toBeGreaterThan(19_000);
      expect(remaining).toBeLessThanOrEqual(20_000);
    } finally {
      Date.now = realNow;
    }
  });
});
