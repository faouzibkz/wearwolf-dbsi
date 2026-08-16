import { describe, expect, it } from "vitest";
import { GameEngine } from "../engine/GameEngine";
import { castDayVotesInOrder, seededRng } from "./helpers";

function bootTo(
  names: string[],
  roleCounts: Record<string, number>,
  seed: number,
  extraConfig: Record<string, unknown> = {},
) {
  const engine = GameEngine.createGame(
    { roleCounts: roleCounts as any, ...extraConfig } as any,
    seededRng(seed),
  );
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
  return { engine, ids };
}

describe("victory conditions", () => {
  it("declares VILLAGE the winner once every wolf is dead", () => {
    const names = ["A", "B", "C", "D"];
    const { engine, ids } = bootTo(names, { LOUP_GAROU: 1 }, 5);
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;

    // Nobody submits a wolf kill vote so nobody dies night 1; go straight to
    // day and vote out the wolf.
    engine.resolveNightAndProceed();
    engine.proceedFromMorningToDay();
    engine.endDayDiscussion();
    const votes: Record<string, string> = {};
    for (const n of names) if (n !== wolf) votes[ids[n]!] = ids[wolf]!;
    castDayVotesInOrder(engine, votes);

    expect(engine.getPhase()).toBe("ENDED");
    expect(engine.getPublicState().winner).toBe("VILLAGE");
  });
});

describe("tie resolution", () => {
  it("opens a defense + revote when the day vote ties, restricted to tied players — and excludes them from voting", () => {
    const names = ["A", "B", "C", "D"];
    const { engine, ids } = bootTo(names, { LOUP_GAROU: 1 }, 9);
    engine.resolveNightAndProceed();
    engine.proceedFromMorningToDay();
    engine.endDayDiscussion();

    const outcome = castDayVotesInOrder(engine, { [ids.A!]: ids.C!, [ids.B!]: ids.D! });

    expect(outcome?.tie).toBe(true);
    expect(engine.getPhase()).toBe("TIE_DEFENSE");

    engine.endTieDefense();
    expect(engine.getPhase()).toBe("DAY_VOTE");
    // The tied candidates (C, D) don't get a turn at all in the re-vote —
    // only A and B (never tied) do.
    const order = engine.getPublicState().dayVoteOrder ?? [];
    expect(order.sort()).toEqual([ids.A, ids.B].sort());
    const currentVoter = engine.getCurrentDayVoterId()!;
    expect(() => engine.castDayVote(currentVoter, ids.B!)).toThrow(); // B not in tied set
    const finalOutcome = castDayVotesInOrder(engine, { [ids.A!]: ids.C!, [ids.B!]: ids.C! });
    expect(finalOutcome?.eliminatedId).toBe(ids.C);
  });

  it("a persistent (round 2) tie is hard-resolved as no elimination — no configurable rule, no manual step", () => {
    const names = ["A", "B", "C", "D"];
    const { engine, ids } = bootTo(names, { LOUP_GAROU: 1 }, 9);
    engine.resolveNightAndProceed();
    engine.proceedFromMorningToDay();
    engine.endDayDiscussion();

    castDayVotesInOrder(engine, { [ids.A!]: ids.C!, [ids.B!]: ids.D! }); // first tie -> TIE_DEFENSE
    engine.endTieDefense();
    const outcome = castDayVotesInOrder(engine, { [ids.A!]: ids.C!, [ids.B!]: ids.D! }); // tie again -> hard no-elimination

    expect(outcome?.eliminatedId).toBeNull();
    expect(outcome?.tie).toBe(true);
    expect(engine.getPhase()).not.toBe("DAY_VOTE"); // resolved immediately, not parked
    const publicPlayers = engine.getPublicState().players;
    expect(publicPlayers.every((p) => p.isAlive)).toBe(true);
  });
});
