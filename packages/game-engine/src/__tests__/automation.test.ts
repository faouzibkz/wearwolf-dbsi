import { describe, expect, it } from "vitest";
import { GameEngine } from "../engine/GameEngine";
import { castDayVotesInOrder, seededRng } from "./helpers";

/**
 * Covers the "fully automatic game" work: CHEF_CANDIDACY auto-pick,
 * CHEF_REVEAL / DAY_VOTE_RESULT announcement phases, the pending-blocker
 * (Chasseur shot / Chef succession) auto-resolve safety net, the TIE_REVOTE
 * safety net, and the night-prompt "only re-prompt players who haven't
 * acted yet" fix.
 */

describe("CHEF_CANDIDACY auto-progress", () => {
  it("auto-elects a random alive player when nobody volunteers by the deadline", () => {
    const names = ["A", "B", "C", "D", "E"];
    const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1 } }, seededRng(2));
    const ids: Record<string, string> = {};
    for (const n of names) ids[n] = engine.addPlayer(n).id;
    engine.startGame();

    expect(engine.getPublicState().candidates).toEqual([]);
    const result = engine.progressChefCandidacy();

    expect(result.autoElected).toBe(true);
    expect(engine.getPhase()).toBe("CHEF_REVEAL");
    const chefId = engine.getPublicState().chefId;
    expect(chefId).not.toBeNull();
    expect(names.map((n) => ids[n])).toContain(chefId);
    expect(engine.getPublicState().players.find((p) => p.id === chefId)!.isChef).toBe(true);
    // Exactly one Chef, nobody else marked.
    expect(engine.getPublicState().players.filter((p) => p.isChef)).toHaveLength(1);
  });

  it("behaves like a normal debate start (autoElected: false) when at least one player volunteered", () => {
    const names = ["A", "B", "C", "D"];
    const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1 } }, seededRng(2));
    const ids: Record<string, string> = {};
    for (const n of names) ids[n] = engine.addPlayer(n).id;
    engine.startGame();
    engine.volunteerForChef(ids.A!);

    const result = engine.progressChefCandidacy();
    expect(result.autoElected).toBe(false);
    expect(engine.getPhase()).toBe("CHEF_DEBATE");
  });

  it("the admin's manual 'skip' no longer throws with zero candidates (progressChefCandidacy replaces forceStartChefDebate for this case)", () => {
    const names = ["A", "B", "C", "D"];
    const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1 } }, seededRng(2));
    for (const n of names) engine.addPlayer(n);
    engine.startGame();

    expect(() => engine.forceStartChefDebate()).toThrow(); // still throws directly, as documented
    expect(() => engine.progressChefCandidacy()).not.toThrow(); // but the auto-progress-safe wrapper doesn't
  });
});

describe("CHEF_REVEAL announcement phase", () => {
  it("sits between CHEF_VOTE and DAY_1_DISCUSSION and must be explicitly advanced", () => {
    const names = ["A", "B", "C", "D"];
    const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1 } }, seededRng(2));
    const ids: Record<string, string> = {};
    for (const n of names) ids[n] = engine.addPlayer(n).id;
    engine.startGame();
    engine.volunteerForChef(ids.A!);
    engine.forceStartChefDebate();
    engine.advanceChefSpeaker();
    for (const n of ["B", "C", "D"]) engine.castChefVote(ids[n]!, ids.A!);

    const electedId = engine.tallyChefVoteAndProceed();
    expect(electedId).toBe(ids.A);
    expect(engine.getPhase()).toBe("CHEF_REVEAL");
    // Day discussion hasn't started yet — no speaking order built.
    expect(engine.getPublicState().dayDiscussionOrder).toBeNull();
    expect(() => engine.endDay1Discussion()).toThrow();

    engine.proceedFromChefRevealToDiscussion();
    expect(engine.getPhase()).toBe("DAY_1_DISCUSSION");
    expect(engine.getPublicState().dayDiscussionOrder).not.toBeNull();
  });

  it("proceedFromChefRevealToDiscussion throws outside CHEF_REVEAL", () => {
    const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1 } }, seededRng(2));
    expect(() => engine.proceedFromChefRevealToDiscussion()).toThrow();
  });
});

describe("DAY_VOTE_RESULT announcement phase", () => {
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

  it("sits between a resolved day vote and NIGHT and must be explicitly advanced", () => {
    const names = ["A", "B", "C", "D", "E"];
    const { engine, ids } = bootToDayVote(names, 5);
    const votes: Record<string, string> = {};
    for (const n of names) if (n !== "C") votes[ids[n]!] = ids.C!;
    const outcome = castDayVotesInOrder(engine, votes);
    expect(outcome?.eliminatedId).toBe(ids.C);
    expect(engine.getPhase()).toBe("DAY_VOTE_RESULT");
    expect(engine.getPublicState().lastDeaths.map((d) => d.playerId)).toEqual([ids.C]);
    expect(() => engine.resolveNightAndProceed()).toThrow(); // not NIGHT yet

    engine.proceedFromDayVoteResultToNight();
    expect(engine.getPhase()).toBe("NIGHT");
  });

  it("proceedFromDayVoteResultToNight throws outside DAY_VOTE_RESULT", () => {
    const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1 } }, seededRng(2));
    expect(() => engine.proceedFromDayVoteResultToNight()).toThrow();
  });

  it("is skipped in favor of ENDED when the elimination wins the game outright", () => {
    const names = ["A", "B", "C", "D"];
    const { engine, ids } = bootToDayVote(names, 5);
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    const votes: Record<string, string> = {};
    for (const n of names) if (n !== wolf) votes[ids[n]!] = ids[wolf]!;
    castDayVotesInOrder(engine, votes);
    // No point announcing a day-vote result on top of the game-over screen.
    expect(engine.getPhase()).toBe("ENDED");
  });
});

describe("pending-blocker auto-resolve safety net (resolvePendingBlockersIfAny)", () => {
  it("auto-picks a random target for an unresolved Chasseur shot", () => {
    const names = ["A", "B", "C", "D", "E"];
    const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1, CHASSEUR: 1 } }, seededRng(11));
    const ids: Record<string, string> = {};
    for (const n of names) ids[n] = engine.addPlayer(n).id;
    engine.startGame();
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    const chasseur = names.find((n) => roles.get(ids[n]!) === "CHASSEUR")!;
    const chief = names.find((n) => n !== wolf && n !== chasseur)!;

    engine.volunteerForChef(ids[chief]!);
    engine.forceStartChefDebate();
    engine.advanceChefSpeaker();
    for (const n of names) if (n !== chief) engine.castChefVote(ids[n]!, ids[chief]!);
    engine.tallyChefVoteAndProceed();
    engine.proceedFromChefRevealToDiscussion();
    engine.endDay1Discussion();

    engine.submitNightAction(ids[wolf]!, "KILL_VOTE", ids[chasseur]!);
    const result = engine.resolveNightAndProceed();
    expect(result.blocked).toBe(true);
    expect(engine.hasPendingBlockers()).toBe(true);
    expect(engine.getPendingChasseurShooterIds()).toEqual([ids[chasseur]]);

    engine.resolvePendingBlockersIfAny();

    expect(engine.hasPendingBlockers()).toBe(false);
    expect(engine.getPendingChasseurShooterIds()).toEqual([]);
    expect(engine.getPhase()).toBe("MORNING");
    // Exactly one more player died beyond the Chasseur himself (the auto-picked target).
    const deadCount = engine.getPublicState().players.filter((p) => !p.isAlive).length;
    expect(deadCount).toBe(2); // Chasseur + auto-picked target
  });

  it("auto-picks a random successor for an unresolved Chef succession", () => {
    const names = ["Chef", "B", "C", "D", "E"];
    const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1 } }, seededRng(2));
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

    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    engine.submitNightAction(ids[wolf]!, "KILL_VOTE", ids.Chef!);
    const result = engine.resolveNightAndProceed();
    expect(result.blocked).toBe(true);
    expect(engine.getPendingChefSuccessionDeadChefId()).toBe(ids.Chef);

    engine.resolvePendingBlockersIfAny();

    expect(engine.getPendingChefSuccessionDeadChefId()).toBeNull();
    expect(engine.getPhase()).toBe("MORNING");
    const newChefId = engine.getPublicState().chefId;
    expect(newChefId).not.toBe(ids.Chef); // succession actually happened
    expect(names.slice(1).map((n) => ids[n])).toContain(newChefId);
  });

  it("does nothing (and stays cheap to call) when there is nothing pending", () => {
    const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1 } }, seededRng(2));
    expect(engine.hasPendingBlockers()).toBe(false);
    expect(() => engine.resolvePendingBlockersIfAny()).not.toThrow();
    expect(engine.hasPendingBlockers()).toBe(false);
  });
});

describe("TIE_REVOTE safety net (autoResolveTieRevoteIfPending)", () => {
  function bootToPersistentTie(names: string[], seed: number, rule: "CHEF_DECIDES" | "ADMIN_DECIDES") {
    const engine = GameEngine.createGame(
      { roleCounts: { LOUP_GAROU: 1 }, tieResolutionRule: rule } as any,
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
    engine.resolveNightAndProceed();
    engine.proceedFromMorningToDay();
    engine.endDayDiscussion();

    // Round 1 tie between C and D.
    castDayVotesInOrder(engine, { [ids.A!]: ids.C!, [ids.B!]: ids.D! }); // -> TIE_DEFENSE
    engine.endTieDefense(); // -> DAY_VOTE round 2

    // Round 2 ties again on the same pair -> rule kicks in -> TIE_REVOTE.
    castDayVotesInOrder(engine, { [ids.A!]: ids.C!, [ids.B!]: ids.D! });

    return { engine, ids };
  }

  it("breaks the tie at random once the deadline passes, instead of freezing the game", () => {
    const names = ["A", "B", "C", "D"];
    const { engine, ids } = bootToPersistentTie(names, 9, "CHEF_DECIDES");

    expect(engine.getPhase()).toBe("TIE_REVOTE");
    const tiedIds = engine.getPublicState().tiedPlayerIds;
    expect(tiedIds.sort()).toEqual([ids.C, ids.D].sort());

    engine.autoResolveTieRevoteIfPending();

    // Resolved: either eliminated someone from the tied pair, or the game
    // ended (small 4-player game, an elimination could tip victory) — either
    // way it's no longer stuck at TIE_REVOTE.
    expect(engine.getPhase()).not.toBe("TIE_REVOTE");
    expect(engine.getPublicState().tiedPlayerIds).toEqual([]);
  });

  it("is a no-op outside TIE_REVOTE", () => {
    const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1 } }, seededRng(2));
    expect(engine.getPhase()).toBe("LOBBY");
    expect(() => engine.autoResolveTieRevoteIfPending()).not.toThrow();
    expect(engine.getPhase()).toBe("LOBBY");
  });
});

describe("night prompts only re-prompt players who haven't acted yet (the wolf-popup fix)", () => {
  function bootToNight1(names: string[], roleCounts: Record<string, number>, seed: number) {
    const engine = GameEngine.createGame({ roleCounts: roleCounts as any }, seededRng(seed));
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

  it("drops the wolf from getNightPrompts() once they've submitted, even though the Sorcière still needs re-prompting", () => {
    const names = ["A", "B", "C", "D", "E"];
    const { engine, ids } = bootToNight1(names, { LOUP_GAROU: 1, SORCIERE: 1 }, 7);
    const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
    const wolf = names.find((n) => roles.get(ids[n]!) === "LOUP_GAROU")!;
    const sorciere = names.find((n) => roles.get(ids[n]!) === "SORCIERE")!;
    const villager = names.find((n) => n !== wolf && n !== sorciere)!;

    // Before anyone acts, both the wolf and the Sorcière have a prompt
    // pending (default onlyPending=true, but nobody's submitted yet).
    const before = engine.getNightPrompts();
    expect(before.some((p) => p.player.id === ids[wolf])).toBe(true);
    expect(before.some((p) => p.player.id === ids[sorciere])).toBe(true);
    // The Sorcière's context doesn't know the wolf's target yet.
    const sorcierePromptBefore = before.find((p) => p.player.id === ids[sorciere])!;
    expect(sorcierePromptBefore.request.context).toMatchObject({ attackedPlayerId: null });

    engine.submitNightAction(ids[wolf]!, "KILL_VOTE", ids[villager]!);

    // After the wolf acts: onlyPending (the default, and what the server's
    // pushNightPrompts actually uses) must NOT include the wolf anymore —
    // this is exactly what stops the wolf's target-selection screen from
    // popping back open when the Sorcière's context gets refreshed.
    const after = engine.getNightPrompts();
    expect(after.some((p) => p.player.id === ids[wolf])).toBe(false);
    // The Sorcière is still pending and now sees the real target.
    const sorciereAfter = after.find((p) => p.player.id === ids[sorciere]);
    expect(sorciereAfter).toBeDefined();
    expect(sorciereAfter!.request.context).toMatchObject({ attackedPlayerId: ids[villager] });

    // The full (unfiltered) roster still shows the wolf did act, for
    // admin/debug purposes — onlyPending: false bypasses the filter.
    const full = engine.getNightPrompts(false);
    expect(full.some((p) => p.player.id === ids[wolf])).toBe(true);
  });
});
