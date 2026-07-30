import type { GameEngine } from "@loupgarou/game-engine";

/**
 * Admin "skip the timer, move on" button. Maps the current phase to the
 * engine method that resolves it and advances. Central switch so the UI
 * only ever needs one button/event regardless of phase.
 */
export function forceNextPhase(engine: GameEngine): void {
  switch (engine.getPhase()) {
    case "LOBBY":
      throw new Error("Utilisez 'Démarrer la partie' depuis le lobby.");
    case "CHEF_CANDIDACY":
      // progressChefCandidacy() also covers the "nobody volunteered" case
      // (auto-elects a random Chef instead of throwing), so the admin's
      // manual skip button works even with zero candidates.
      engine.progressChefCandidacy();
      return;
    case "CHEF_DEBATE": {
      let done = false;
      while (!done) {
        done = engine.advanceChefSpeaker().done;
      }
      return;
    }
    case "CHEF_VOTE":
      engine.tallyChefVoteAndProceed();
      return;
    case "CHEF_REVEAL":
      engine.proceedFromChefRevealToDiscussion();
      return;
    case "DAY_1_DISCUSSION":
      engine.endDay1Discussion();
      return;
    case "NIGHT":
      engine.resolveNightAndProceed();
      return;
    case "MORNING":
      engine.proceedFromMorningToDay();
      return;
    case "DAY_DISCUSSION":
      engine.endDayDiscussion();
      return;
    case "DAY_VOTE":
      engine.tallyDayVoteAndProceed();
      return;
    case "DAY_VOTE_RESULT":
      engine.proceedFromDayVoteResultToNight();
      return;
    case "TIE_DEFENSE": {
      let done = false;
      while (!done) {
        done = engine.advanceTieDefenseSpeaker().done;
      }
      return;
    }
    case "TIE_REVOTE":
      throw new Error("Une égalité doit être résolue manuellement (Chef ou Admin).");
    case "ENDED":
      throw new Error("La partie est terminée.");
    default:
      throw new Error("Phase inconnue.");
  }
}
