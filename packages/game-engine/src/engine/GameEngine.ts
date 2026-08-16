import type {
  EndGameStats,
  FinalPlayerSummary,
  GameConfig,
  GameStatePublic,
  LogEntry,
  Phase,
  PlayerPrivateRole,
  PlayerPublic,
  PrivateRoleStatePayload,
  RoleId,
  Team,
} from "@loupgarou/shared";
import { CHEF_TITLE, DEFAULT_GAME_CONFIG, ROLE_IDS, ROLE_METADATA } from "@loupgarou/shared";
import type { EngineContext, GameInternalState, InternalPlayer, NightScratch } from "../internalTypes";
import type { GameEvent } from "../events";
import { generateGameCode, generatePlayerId, generateReconnectToken } from "../util/ids";
import { shuffle } from "../util/shuffle";
import { ROLE_REGISTRY } from "../roles/registry";
import * as ChefElection from "./ChefElection";
import * as DayDiscussion from "./DayDiscussion";
import * as TieDefense from "./TieDefense";
import * as DayVoteQueue from "./DayVoteQueue";
import * as VoteManager from "./VoteManager";
import * as NightResolver from "./NightResolver";
import * as NightSequencer from "./NightSequencer";
import * as LoupVert from "./LoupVert";
import * as Barbie from "./Barbie";
import * as SecondDebate from "./SecondDebate";
import { processDeaths } from "./DeathQueue";
import { checkVictory, isAlienStalemate } from "./VictoryConditions";

export interface StartGameResult {
  playersAssigned: number;
}

/**
 * GameEngine is the single authoritative, framework-agnostic orchestrator.
 * It owns all game state and mutates it only through its own methods; the
 * Socket.IO layer (apps/server) is a thin adapter that calls these methods
 * and broadcasts the resulting sanitized state. Nothing in here knows about
 * sockets, HTTP, or persistence — that separation is what keeps the engine
 * unit-testable and the UI swappable.
 */
export class GameEngine {
  private state: GameInternalState;
  private snapshots: GameInternalState[] = [];
  private readonly maxSnapshots = 10;
  private readonly rng: () => number;

  private constructor(state: GameInternalState, rng: () => number = Math.random) {
    this.state = state;
    this.rng = rng;
  }

  static createGame(config: Partial<GameConfig> = {}, rng: () => number = Math.random): GameEngine {
    const fullConfig: GameConfig = { ...DEFAULT_GAME_CONFIG, ...config };
    const state: GameInternalState = {
      code: generateGameCode(),
      config: fullConfig,
      phase: "LOBBY",
      paused: false,
      pausedRemainingMs: null,
      players: new Map(),
      playerOrder: [],
      nightNumber: 0,
      dayNumber: 1,
      chef: { candidates: [], debateOrder: [], currentSpeakerIndex: 0, votes: new Map(), electedId: null },
      dayDiscussion: null,
      tieDefense: null,
      dayVoteQueue: null,
      secondDebateQueue: null,
      dayVote: { votes: new Map(), round: 1, tiedIds: [] },
      corbeauMarkedPlayerId: null,
      nightScratch: null,
      logs: [],
      phaseEndsAt: null,
      winner: null,
      lastMorningResult: null,
      mowgliTransformedAnnounced: false,
      pendingMowgliReveal: false,
      lastDeathPlayerIds: [],
      pendingChasseurShooterIds: [],
      pendingChefSuccessionDeadChefId: null,
      rolesRevealedToPlayers: false,
      gameEndedNotified: false,
      createdAt: Date.now(),
      eventLog: [],
    };
    return new GameEngine(state, rng);
  }

  // -------------------------------------------------------------------
  // Context bridge (implements EngineContext for the role/engine helpers)
  // -------------------------------------------------------------------

  private ctx(): EngineContext {
    const self = this;
    return {
      state: this.state,
      getPlayer(id: string) {
        const p = self.state.players.get(id);
        if (!p) throw new Error(`Joueur inconnu: ${id}`);
        return p;
      },
      getAlivePlayers() {
        return [...self.state.players.values()].filter((p) => p.isAlive);
      },
      getAliveByRole(roleId: RoleId) {
        return [...self.state.players.values()].filter((p) => p.isAlive && p.roleId === roleId);
      },
      log(message: string) {
        self.appendLog(message);
      },
      queueDeath(playerId: string, cause: string) {
        processDeaths(self.ctx(), [{ playerId, cause }]);
      },
      recordEvent(event: GameEvent) {
        self.state.eventLog.push(event);
      },
    };
  }

  private appendLog(message: string): void {
    const label =
      this.state.phase === "NIGHT" ? `Nuit ${this.state.nightNumber}` : `Jour ${this.state.dayNumber}`;
    const entry: LogEntry = {
      id: generatePlayerId(),
      timestamp: Date.now(),
      dayOrNight: label,
      message,
    };
    this.state.logs.push(entry);
  }

  private snapshot(): void {
    this.snapshots.push(structuredClone(this.state));
    if (this.snapshots.length > this.maxSnapshots) this.snapshots.shift();
  }

  undoPhase(): boolean {
    const previous = this.snapshots.pop();
    if (!previous) return false;
    this.state = previous;
    return true;
  }

  // -------------------------------------------------------------------
  // Lobby
  // -------------------------------------------------------------------

  addPlayer(nickname: string): InternalPlayer {
    if (this.state.phase !== "LOBBY") throw new Error("La partie a déjà commencé.");
    const trimmed = nickname.trim();
    if (!trimmed) throw new Error("Le pseudo ne peut pas être vide.");
    const taken = [...this.state.players.values()].some(
      (p) => p.nickname.toLowerCase() === trimmed.toLowerCase(),
    );
    if (taken) throw new Error("Ce pseudo est déjà pris.");

    const player: InternalPlayer = {
      id: generatePlayerId(),
      nickname: trimmed,
      roleId: "VILLAGEOIS",
      isAlive: true,
      isChef: false,
      isConnected: true,
      isSpectator: false,
      joinedAt: Date.now(),
      reconnectToken: generateReconnectToken(),
      deathCause: null,
      deathMoment: null,
      sorciereHealUsed: false,
      sorcierePoisonUsed: false,
      salvateurLastProtectedId: null,
      mowgliFatherId: null,
      mowgliTransformed: false,
      voyanteInspectionCounts: {},
      loupVertLastGuessNight: null,
      loupVertHasChasseurPower: false,
      loupVertStolenPowerRoleId: null,
      loupVertStolenPowerSourcePlayerId: null,
      loupVertStolenPowerGrantedNight: null,
      loupVertStolenPowerUsedTonight: false,
      barbiePowerUsed: false,
      alienVillageChancesLeft: 2,
      alienWolfChancesLeft: 1,
      alienLastGuessResult: null,
      pretreShotUsed: false,
    };
    this.state.players.set(player.id, player);
    this.state.playerOrder.push(player.id);
    this.appendLog(`${player.nickname} a rejoint le lobby.`);
    return player;
  }

  setConnected(playerId: string, connected: boolean): void {
    const player = this.state.players.get(playerId);
    if (!player) return;
    player.isConnected = connected;
  }

  updateConfig(partial: Partial<GameConfig>): void {
    if (this.state.phase !== "LOBBY") throw new Error("Impossible de modifier la config après le début.");
    this.state.config = { ...this.state.config, ...partial };
  }

  /**
   * Unlike updateConfig, this is deliberately NOT phase-gated: sound is a
   * cosmetic, whole-game/whole-players preference the admin should be able
   * to flip on or off at any point, including mid-game.
   */
  setSoundEffectsEnabled(enabled: boolean): void {
    this.state.config.soundEffectsEnabled = enabled;
    this.appendLog(`Effets sonores ${enabled ? "activés" : "désactivés"} par le Maître du Jeu.`);
  }

  // -------------------------------------------------------------------
  // Game start / role assignment
  // -------------------------------------------------------------------

  startGame(): StartGameResult {
    if (this.state.phase !== "LOBBY") throw new Error("La partie a déjà commencé.");
    const playerIds = [...this.state.playerOrder];
    if (playerIds.length < 4) throw new Error("Il faut au moins 4 joueurs pour commencer.");

    const pool: RoleId[] = [];
    for (const [roleId, count] of Object.entries(this.state.config.roleCounts) as [RoleId, number][]) {
      for (let i = 0; i < (count ?? 0); i++) pool.push(roleId);
    }
    if (pool.length > playerIds.length) {
      throw new Error("Il y a plus de rôles configurés que de joueurs.");
    }
    while (pool.length < playerIds.length) pool.push("VILLAGEOIS");

    const shuffledRoles = shuffle(pool, this.rng);
    const shuffledPlayerIds = shuffle(playerIds, this.rng);
    shuffledPlayerIds.forEach((playerId, index) => {
      const player = this.state.players.get(playerId)!;
      player.roleId = shuffledRoles[index]!;
    });

    this.appendLog("Les rôles ont été distribués.");
    this.snapshot();
    this.state.phase = "CHEF_CANDIDACY";
    return { playersAssigned: shuffledPlayerIds.length };
  }

  /** Only ever called server-side for a specific socket — never broadcast. */
  getPlayerRole(playerId: string): RoleId {
    return this.ctx().getPlayer(playerId).roleId;
  }

  // -------------------------------------------------------------------
  // Chef du village election
  // -------------------------------------------------------------------

  volunteerForChef(playerId: string): void {
    if (this.state.phase !== "CHEF_CANDIDACY") throw new Error("Ce n'est pas le moment de se présenter.");
    ChefElection.volunteerForChef(this.ctx(), playerId);
  }

  forceStartChefDebate(): void {
    if (this.state.phase !== "CHEF_CANDIDACY") throw new Error("Ce n'est pas le moment.");
    if (this.state.chef.candidates.length === 0) {
      throw new Error("Aucun candidat ne s'est présenté.");
    }
    this.snapshot();
    ChefElection.startDebate(this.ctx());
    this.state.phase = "CHEF_DEBATE";
  }

  /**
   * Auto-progress-friendly version of "move on from candidacy": if at
   * least one player volunteered, behaves exactly like forceStartChefDebate.
   * If nobody volunteered by the deadline, a fully-automatic game can't
   * just throw and stall forever — instead it picks a random alive player,
   * elects them uncontested, and goes straight to the reveal. Used both by
   * the CHEF_CANDIDACY auto-progress timer and by the admin's manual
   * "phase suivante" button (which used to throw "Aucun candidat ne s'est
   * présenté" in this exact situation).
   */
  progressChefCandidacy(): { autoElected: boolean } {
    if (this.state.phase !== "CHEF_CANDIDACY") throw new Error("Ce n'est pas le moment.");
    if (this.state.chef.candidates.length > 0) {
      this.forceStartChefDebate();
      return { autoElected: false };
    }
    this.snapshot();
    const alive = this.ctx().getAlivePlayers();
    const chosen = shuffle(alive, this.rng)[0]!;
    this.state.chef.candidates = [chosen.id];
    this.state.chef.electedId = chosen.id;
    chosen.isChef = true;
    this.appendLog(
      `Personne ne s'est présenté(e) — ${chosen.nickname} est désigné(e) Chef du village au hasard.`,
    );
    this.state.phase = "CHEF_REVEAL";
    return { autoElected: true };
  }

  getCurrentChefDebateSpeakerId(): string | null {
    return this.state.chef.debateOrder[this.state.chef.currentSpeakerIndex] ?? null;
  }

  advanceChefSpeaker(): { done: boolean } {
    if (this.state.phase !== "CHEF_DEBATE") throw new Error("Ce n'est pas le moment.");
    const result = ChefElection.advanceSpeaker(this.ctx());
    if (result.done) {
      this.snapshot();
      this.state.phase = "CHEF_VOTE";
    }
    return result;
  }

  castChefVote(voterId: string, candidateId: string): void {
    if (this.state.phase !== "CHEF_VOTE") throw new Error("Ce n'est pas le moment de voter.");
    ChefElection.castChefVote(this.ctx(), voterId, candidateId);
  }

  /** True once every eligible voter has cast a chef-vote ballot — see ChefElection.isChefVoteComplete. */
  isChefVoteComplete(): boolean {
    return this.state.phase === "CHEF_VOTE" && ChefElection.isChefVoteComplete(this.ctx());
  }

  tallyChefVoteAndProceed(): string {
    if (this.state.phase !== "CHEF_VOTE") throw new Error("Ce n'est pas le moment.");
    this.snapshot();
    const electedId = ChefElection.tallyChefVote(this.ctx(), this.rng);
    this.state.phase = "CHEF_REVEAL";
    return electedId;
  }

  /** Leaves the "X est élu(e) Chef" announcement pause and starts Day 1 discussion. */
  proceedFromChefRevealToDiscussion(): void {
    if (this.state.phase !== "CHEF_REVEAL") throw new Error("Ce n'est pas le moment.");
    this.snapshot();
    this.state.phase = "DAY_1_DISCUSSION";
    DayDiscussion.startDayDiscussion(this.ctx(), this.rng);
  }

  // -------------------------------------------------------------------
  // Day 1 discussion -> Night
  // -------------------------------------------------------------------

  /** Manual "skip the rest of the discussion" — bypasses however far the speaking order has gotten. */
  endDay1Discussion(): void {
    if (this.state.phase !== "DAY_1_DISCUSSION") throw new Error("Ce n'est pas le moment.");
    this.startNight();
  }

  getCurrentDaySpeakerId(): string | null {
    return DayDiscussion.currentDaySpeakerId(this.ctx());
  }

  /**
   * Advances to the next speaker in today's discussion (DAY_1_DISCUSSION
   * or DAY_DISCUSSION). Called both by the per-speaker auto-progress timer
   * and by "passe la parole". When the Chef's closing turn just ended,
   * this automatically moves on to the next phase — same pattern as
   * advanceChefSpeaker() auto-moving CHEF_DEBATE -> CHEF_VOTE.
   */
  advanceDaySpeaker(): { done: boolean } {
    if (this.state.phase !== "DAY_1_DISCUSSION" && this.state.phase !== "DAY_DISCUSSION") {
      throw new Error("Ce n'est pas le moment.");
    }
    const result = DayDiscussion.advanceDaySpeaker(this.ctx());
    if (result.done) {
      this.snapshot();
      if (this.state.phase === "DAY_1_DISCUSSION") {
        this.startNight();
      } else {
        this.startChefSecondDebate();
      }
    }
    return result;
  }

  /**
   * CHEF_SECOND_DEBATE is entered once the normal Day Discussion speaking
   * order (including the Chef's closing word) has fully run out — never
   * for DAY_1_DISCUSSION, which has no day vote (and so no second debate)
   * at all; see advanceDaySpeaker() above. `secondDebateQueue` starts null
   * to represent "the Chef hasn't chosen yet" (see isSecondDebateChoicePending()).
   */
  private startChefSecondDebate(): void {
    this.state.phase = "CHEF_SECOND_DEBATE";
    this.state.secondDebateQueue = null;
  }

  // -------------------------------------------------------------------
  // Barbie: one-shot mid-day-discussion reveal
  // -------------------------------------------------------------------

  canBarbieUsePower(barbieId: string): boolean {
    if (this.state.phase !== "DAY_1_DISCUSSION" && this.state.phase !== "DAY_DISCUSSION") return false;
    return Barbie.canUsePower(this.ctx(), barbieId);
  }

  getBarbieEligibleTargets(barbieId: string): string[] {
    if (!this.canBarbieUsePower(barbieId)) return [];
    return Barbie.getEligibleTargets(this.ctx(), barbieId);
  }

  useBarbiePower(barbieId: string, targetId: string): Barbie.BarbieRevealOutcome {
    if (this.state.phase !== "DAY_1_DISCUSSION" && this.state.phase !== "DAY_DISCUSSION") {
      throw new Error("Ce n'est pas le moment.");
    }
    this.snapshot();
    const outcome = Barbie.usePower(this.ctx(), barbieId, targetId);
    // Handles the victory check, any pending blockers (e.g. the revealed
    // wolf also held the Chasseur's revenge shot), and — once clear — either
    // resuming discussion with whoever's now next, or moving on if nobody's
    // left to speak. See tryResumeAfterBlockers() for the delayed-blocker case.
    this.finishDiscussionEventAndMaybeProceed();
    return outcome;
  }

  // -------------------------------------------------------------------
  // Alien: forcing an early nightfall from the middle of a day discussion
  // -------------------------------------------------------------------
  //
  // The Alien can, at will during ANY day discussion (day 1 included), cut
  // the debate short and force night to fall immediately so he can make
  // his guess right away instead of waiting for the day to run its normal
  // course. Per the confirmed design: everything else scheduled for that
  // day — the rest of discussion, the Chef's second-debate bonus round, and
  // that day's elimination vote — is simply skipped, not deferred; the
  // resulting night is a COMPLETELY NORMAL one (every other night-active
  // role still gets their usual turn, the Alien's guess is just one more
  // action within it); and this changes nothing about his existing guess
  // pools (1 chance vs. wolf-team roles, 2 chances vs. village-team roles)
  // or the fact that ALIEN itself is never a guessable target.
  //
  // Secrecy: nobody besides the Alien himself may ever learn this
  // happened. appendLog() only reaches the admin's private log view (see
  // broadcast.ts — ADMIN_STATE is admin-socket-only, never broadcast to
  // players), so recording it there is safe; there must be no
  // notifyGame/broadcast NOTIFICATION call anywhere in this path. To
  // everyone else at the table, the day just... ended a little early.
  canAlienForceNightfall(alienId: string): boolean {
    if (this.state.phase !== "DAY_1_DISCUSSION" && this.state.phase !== "DAY_DISCUSSION") return false;
    const player = this.state.players.get(alienId);
    return Boolean(player && player.isAlive && player.roleId === "ALIEN");
  }

  triggerAlienNightfall(alienId: string): void {
    if (this.state.phase !== "DAY_1_DISCUSSION" && this.state.phase !== "DAY_DISCUSSION") {
      throw new Error("Ce n'est pas le moment.");
    }
    const player = this.ctx().getPlayer(alienId);
    if (player.roleId !== "ALIEN") {
      throw new Error("Seul l'Alien peut faire tomber la nuit prématurément.");
    }
    if (!player.isAlive) {
      throw new Error("Un joueur mort ne peut pas agir.");
    }
    // Defensive: a Chasseur shot or Chef-succession pick already queued up
    // from something earlier in the discussion must resolve on its own
    // terms before the night can start — jumping straight to NIGHT out
    // from under it would strand that blocker forever (see
    // schedulePendingBlockerTimer's own doc comment for why blockers are
    // never allowed to be silently skipped over).
    if (this.hasPendingBlockers()) {
      throw new Error("Une action en attente doit être résolue avant que la nuit ne tombe.");
    }
    this.snapshot();
    this.appendLog("La nuit tombe soudainement, avant la fin des débats.");
    // forcedByAlien=true: this is the one night where his guess stops being
    // optional (see roles/alien.ts's applyNightAction) — cutting a debate
    // short only to then not use the night would be strictly better than
    // ever guessing during a normal night, which doesn't make sense.
    this.startNight(true);
  }

  private startNight(forcedByAlien = false): void {
    this.snapshot();
    this.state.nightNumber += 1;
    this.state.nightScratch = NightResolver.createNightScratch(this.state.nightNumber, forcedByAlien);
    // SEQUENTIAL mode only (GameConfig.nightMode) — computed fresh for
    // THIS night specifically (role presence/first-night-only status can
    // both change night to night), then never recomputed until the next
    // startNight() call. See NightSequencer.ts.
    if (this.state.config.nightMode === "SEQUENTIAL") {
      this.state.nightScratch.sequentialSteps = NightSequencer.computeNightSteps(
        this.ctx(),
        this.state.nightNumber,
      );
    }
    this.state.phase = "NIGHT";
    // Reset here — at the START of the night's resolution unit — rather
    // than inside resolveNightAndProceed() (the OLD reset point): the
    // Alien can now kill someone mid-night, independent of the night's own
    // batched resolution, and resolveNightAndProceed() resetting the list
    // right before computing ITS OWN deaths would have silently wiped that
    // earlier kill back out of the morning's public reveal.
    this.state.lastDeathPlayerIds = [];
    this.appendLog("La nuit tombe sur le village.");
  }

  /**
   * `onlyPending` (default true): exclude players who already submitted an
   * action tonight. See NightResolver.collectNightPrompts.
   *
   * SEQUENTIAL mode (GameConfig.nightMode): further filtered down to only
   * the role(s) whose turn it currently is — see NightSequencer.ts. Every
   * OTHER active-tonight role's prompt is withheld until its own step,
   * exactly the cahier de charge #2 §17.1 behavior ("one role at a time").
   * SIMULTANEOUS mode is completely unaffected — this filter is a no-op
   * there, same as it always was.
   */
  getNightPrompts(onlyPending = true) {
    if (this.state.phase !== "NIGHT") return [];
    const all = NightResolver.collectNightPrompts(this.ctx(), this.state.nightNumber, onlyPending);
    if (this.state.config.nightMode !== "SEQUENTIAL") return all;
    const currentStepRoleIds = this.getCurrentNightStepRoleIds();
    if (!currentStepRoleIds) return [];
    return all.filter((p) => currentStepRoleIds.includes(p.player.roleId));
  }

  submitNightAction(playerId: string, actionType: string, targetId?: string, guessedRoleId?: RoleId): void {
    if (this.state.phase !== "NIGHT") throw new Error("Ce n'est pas la nuit.");
    NightResolver.submitNightAction(this.ctx(), playerId, actionType, targetId, guessedRoleId);
  }

  // -------------------------------------------------------------------
  // SEQUENTIAL night mode (cahier de charge #2, §17.1) — see
  // NightSequencer.ts for the pure step-computation logic this wraps.
  // Every method below is a no-op / returns a "not applicable" value
  // outside NIGHT phase or outside SEQUENTIAL mode, by design: callers
  // (apps/server) don't need to branch on nightMode themselves before
  // calling these — they can always call them and just check the result.
  // -------------------------------------------------------------------

  isSequentialNightMode(): boolean {
    return this.state.phase === "NIGHT" && this.state.config.nightMode === "SEQUENTIAL";
  }

  /** null once every step is done (night is about to resolve) or outside a SEQUENTIAL night. */
  getCurrentNightStepRoleIds(): RoleId[] | null {
    if (!this.isSequentialNightMode()) return null;
    const scratch = this.state.nightScratch!;
    return scratch.sequentialSteps[scratch.sequentialStepIndex] ?? null;
  }

  /** 1-based `stepIndex` (0 if not in a SEQUENTIAL night) for a "3 / 6" style progress display. */
  getNightStepProgress(): { stepIndex: number; totalSteps: number } {
    if (!this.isSequentialNightMode()) return { stepIndex: 0, totalSteps: 0 };
    const scratch = this.state.nightScratch!;
    const total = scratch.sequentialSteps.length;
    const current = Math.min(scratch.sequentialStepIndex + 1, total);
    return { stepIndex: current, totalSteps: total };
  }

  getCurrentNightStepDurationSeconds(): number | null {
    const roleIds = this.getCurrentNightStepRoleIds();
    if (!roleIds) return null;
    return NightSequencer.stepDurationSeconds(this.ctx(), roleIds);
  }

  /**
   * Called by the server after every mutation during a SEQUENTIAL night
   * (same "call after every state change" pattern as sync()/pushAllPrompts
   * elsewhere — see apps/server/src/socket/sync.ts). Advances past every
   * step that's now fully submitted, in order, stopping at the first
   * incomplete one — a single call safely handles "several roles in a row
   * had nobody alive to act" without the caller needing a loop. Once every
   * step is behind us, resolves the night and transitions to MORNING,
   * exactly like a normal forceNextPhase(NIGHT) would.
   *
   * Returns true if anything changed (step advanced and/or the night
   * resolved) so the caller knows whether a fresh broadcast is warranted.
   */
  advanceNightStepIfComplete(): boolean {
    if (!this.isSequentialNightMode()) return false;
    let advanced = false;
    while (true) {
      const roleIds = this.getCurrentNightStepRoleIds();
      if (!roleIds) {
        this.resolveNightAndProceed();
        return true;
      }
      if (!NightSequencer.isStepComplete(this.ctx(), roleIds)) return advanced;
      this.state.nightScratch!.sequentialStepIndex += 1;
      advanced = true;
    }
  }

  /**
   * Called by the server when a SEQUENTIAL step's own timer expires with
   * players still owed an action. For most roles this force-submits "SKIP"
   * on their behalf (harmless — every role module treats an unrecognized
   * actionType as a no-op, same as a human choosing not to act) and moves
   * on. One documented exception: the Alien on a night HE forced (see
   * roles/alien.ts) — his guess is mandatory there, so "SKIP" is REJECTED
   * (throws) rather than silently accepted, exactly like a real player
   * being told "no, you have to guess." A timed-out mandatory guess can't
   * just vanish either, so it falls back to the same "auto-pick at random"
   * safety net already used for an unresolved Chasseur shot / Chef
   * succession (see resolvePendingBlockersIfAny) rather than hanging the
   * whole night. After forcing the current step closed, this always
   * advances (delegates to advanceNightStepIfComplete()).
   */
  forceAdvanceNightStep(): boolean {
    if (!this.isSequentialNightMode()) return false;
    const roleIds = this.getCurrentNightStepRoleIds();
    if (!roleIds) return this.advanceNightStepIfComplete();

    const scratch = this.state.nightScratch!;
    for (const roleId of roleIds) {
      for (const holder of this.ctx().getAliveByRole(roleId)) {
        if (scratch.submittedActions[holder.id]) continue;
        try {
          NightResolver.submitNightAction(this.ctx(), holder.id, "SKIP");
        } catch (err) {
          if (roleId === "ALIEN") {
            const eligible = this.ctx().getAlivePlayers().filter((p) => p.id !== holder.id);
            const target = shuffle(eligible, this.rng)[0];
            const guessedRoleId = shuffle(
              ROLE_IDS.filter((id) => id !== "ALIEN"),
              this.rng,
            )[0]!;
            if (target) {
              this.appendLog(
                `${holder.nickname} (Alien) n'a pas deviné à temps — cible et rôle choisis au hasard.`,
              );
              NightResolver.submitNightAction(this.ctx(), holder.id, "ALIEN_GUESS", target.id, guessedRoleId);
            } else {
              // No eligible target at all (shouldn't happen — would mean
              // the Alien is the only living player) — defensively unstick
              // the step anyway rather than hang the night forever.
              scratch.submittedActions[holder.id] = { playerId: holder.id, actionType: "SKIP" };
            }
          } else {
            // Not expected from any current role (every applyNightAction
            // treats an unrecognized actionType as a no-op) — but never
            // let an unforeseen throw permanently strand a step. Logged so
            // it's visible, and defensively marked submitted so the night
            // can still conclude.
            console.error(`[night-sequencer] forced SKIP rejected for ${roleId}`, err);
            scratch.submittedActions[holder.id] = { playerId: holder.id, actionType: "SKIP" };
          }
        }
      }
    }
    return this.advanceNightStepIfComplete();
  }

  // -------------------------------------------------------------------
  // Loup Vert: role guess + stolen power (night-only, dedicated side
  // channel — see engine/LoupVert.ts for why this can't just reuse the
  // standard submitNightAction/getNightPrompts path).
  // -------------------------------------------------------------------

  getLoupVertGuessableRoleIds(): RoleId[] {
    return LoupVert.guessableRoleIds();
  }

  getLoupVertGuessEligibleTargets(loupVertId: string): string[] {
    if (this.state.phase !== "NIGHT") return [];
    return LoupVert.guessEligibleTargetIds(this.ctx(), loupVertId);
  }

  /** True once he's already used up tonight's one guess attempt (or it's night 1, when he has none). */
  hasLoupVertGuessedTonight(loupVertId: string): boolean {
    const player = this.state.players.get(loupVertId);
    if (!player) return true;
    if (this.state.nightNumber < 2) return true;
    return player.loupVertLastGuessNight === this.state.nightNumber;
  }

  submitLoupVertGuess(
    loupVertId: string,
    targetId: string,
    guessedRoleId: RoleId,
  ): LoupVert.LoupVertGuessOutcome {
    if (this.state.phase !== "NIGHT") throw new Error("Ce n'est pas la nuit.");
    return LoupVert.submitGuess(this.ctx(), loupVertId, targetId, guessedRoleId);
  }

  /** The stolen-power prompt, if he currently holds a one-night power he hasn't used yet tonight. */
  getLoupVertStolenPowerPrompt(loupVertId: string) {
    if (this.state.phase !== "NIGHT") return null;
    return LoupVert.getStolenPowerPrompt(this.ctx(), loupVertId);
  }

  submitLoupVertStolenPowerAction(loupVertId: string, actionType: string, targetId?: string): void {
    if (this.state.phase !== "NIGHT") throw new Error("Ce n'est pas la nuit.");
    LoupVert.submitStolenPowerAction(this.ctx(), loupVertId, actionType, targetId);
  }

  /**
   * Only ever called server-side for the acting Alien's own socket — never
   * broadcast. His own private feedback after his most-recent guess (if
   * any yet) — see InternalPlayer.alienLastGuessResult. This is the only
   * place the Alien's guess correctness is ever surfaced to ANYONE: not to
   * the village, not to his target (who just sees an ordinary death, or
   * nothing at all if the guess was wrong), only to himself.
   */
  getAlienLastGuessResult(alienId: string): "CORRECT" | "WRONG" | null {
    return this.state.players.get(alienId)?.alienLastGuessResult ?? null;
  }

  /**
   * Only ever called server-side for the acting Voyante's own socket —
   * never broadcast. Returns her most recent inspection this night, if any.
   */
  getLastVoyanteResult(
    voyanteId: string,
  ): { targetId: string; targetNickname: string; result: "LOUP" | "NON_LOUP" } | null {
    const inspections = this.state.nightScratch?.voyanteInspections ?? [];
    for (let i = inspections.length - 1; i >= 0; i -= 1) {
      const entry = inspections[i]!;
      if (entry.voyanteId === voyanteId) {
        const target = this.state.players.get(entry.targetId);
        return { targetId: entry.targetId, targetNickname: target?.nickname ?? "?", result: entry.result };
      }
    }
    return null;
  }

  /**
   * Only ever called server-side for a specific socket — never broadcast
   * (see PRIVATE_ROLE_STATE / PrivateRoleStatePayload). Only the fields
   * relevant to the player's own current role are populated; everyone else
   * gets an empty object. Deliberately says nothing about WHETHER a guess
   * was right or wrong, or who was targeted — that's exactly the kind of
   * leak the Loup Vert's and Alien's secrecy requirements forbid; this only
   * ever reports the player's OWN resource counters back to themselves.
   */
  getPrivateRoleExtras(playerId: string): PrivateRoleStatePayload {
    const player = this.state.players.get(playerId);
    if (!player) return {};
    const extras: PrivateRoleStatePayload = {};
    if (player.roleId === "BARBIE") {
      extras.barbiePowerAvailable = !player.barbiePowerUsed;
    }
    if (player.roleId === "ALIEN") {
      extras.alienChances = { village: player.alienVillageChancesLeft, wolf: player.alienWolfChancesLeft };
      extras.alienCanForceNightfall = this.canAlienForceNightfall(playerId);
    }
    if (player.roleId === "LOUP_VERT") {
      extras.loupVertHasChasseurPower = player.loupVertHasChasseurPower;
      extras.loupVertStolenPowerRoleId =
        player.loupVertStolenPowerGrantedNight === this.state.nightNumber
          ? player.loupVertStolenPowerRoleId
          : null;
    }
    return extras;
  }

  private static readonly WOLF_ROLE_IDS = new Set(["LOUP_GAROU", "LOUP_BLANC", "LOUP_VERT"]);

  /** Wolves (and a transformed Mowgli) share a private room, computed fresh each call. */
  getWolfRoomMemberIds(): string[] {
    return [...this.state.players.values()]
      .filter((p) => p.isAlive && GameEngine.WOLF_ROLE_IDS.has(p.roleId))
      .map((p) => p.id);
  }

  /**
   * A given player's fellow (still-alive) wolves, by id + nickname —
   * always empty for a non-wolf. Used to tell the pack who's on their team
   * right from role assignment, not just once the wolf room opens on
   * night 1 (see broadcast.ts's pushRoleAssignments).
   */
  getWolfTeammates(playerId: string): { id: string; nickname: string }[] {
    const player = this.state.players.get(playerId);
    if (!player || !GameEngine.WOLF_ROLE_IDS.has(player.roleId)) return [];
    return this.getWolfRoomMemberIds()
      .filter((id) => id !== playerId)
      .map((id) => {
        const p = this.state.players.get(id)!;
        return { id: p.id, nickname: p.nickname };
      });
  }

  /**
   * CONFIRMED wolf-pack kill votes cast so far this night (voterId ->
   * targetId) — the same shared `nightScratch.wolfVotes` scratch
   * wolfPack.ts's buildWolfKillPrompt already reads to build each wolf's
   * own NIGHT_PROMPT context. Exposed as its own method so the server's
   * wolf-room broadcast (socket/wolfRoom.ts's WolfRoomStatePayload) can
   * show every wolf ALL of their teammates' locked-in picks live, not just
   * their own. Empty outside NIGHT or before anyone's voted.
   */
  getWolfKillVotes(): Record<string, string> {
    return { ...(this.state.nightScratch?.wolfVotes ?? {}) };
  }

  /**
   * Cahier de charge #2 §17.3 — every dead player, all game (once dead,
   * always eligible — death is permanent, same contract as `isSpectator`
   * itself, see DeathQueue.processDeaths). Mirrors getWolfRoomMemberIds()'s
   * exact shape/pattern: the one authoritative place that decides
   * membership, so the server's Afterlife chat relay (see
   * apps/server/src/socket/afterlife.ts) never has to re-derive "is this
   * player dead" itself — same reasoning as the wolf room's own doc
   * comment about never hand-rolling membership checks outside the engine.
   */
  getAfterlifeMemberIds(): string[] {
    return [...this.state.players.values()].filter((p) => p.isSpectator).map((p) => p.id);
  }

  resolveNightAndProceed(): { anyoneDied: boolean; blocked: boolean; mowgliTransformed: boolean } {
    if (this.state.phase !== "NIGHT") throw new Error("Ce n'est pas la nuit.");
    this.snapshot();
    // lastDeathPlayerIds is reset in startNight(), NOT here — see the
    // comment there. Resetting it here would wipe out any Alien kill that
    // already happened earlier in the same night.
    NightResolver.resolveNight(this.ctx(), this.state.nightNumber);
    // Based on the FULL night's death list, not just this resolveNight()
    // call's own contribution — an Alien kill earlier the same night must
    // still count as "quelqu'un est mort cette nuit", even if nobody died
    // in the wolves'/Sorcière's own batch resolution.
    const anyoneDied = this.state.lastDeathPlayerIds.length > 0;

    if (this.hasPendingBlockers()) {
      return { anyoneDied, blocked: true, mowgliTransformed: this.state.pendingMowgliReveal };
    }

    this.finishMorning(anyoneDied);
    return { anyoneDied, blocked: false, mowgliTransformed: this.state.pendingMowgliReveal };
  }

  submitChasseurShot(shooterId: string, targetId: string): { anyoneDied: boolean } {
    const index = this.state.pendingChasseurShooterIds.indexOf(shooterId);
    if (index === -1) throw new Error("Ce joueur n'a pas de tir en attente.");
    this.state.pendingChasseurShooterIds.splice(index, 1);
    // roleId is captured before processDeaths purely out of habit — it
    // never changes on death (only isAlive does, see DeathQueue.ts), so
    // reading it after would work identically.
    const targetRoleId = this.ctx().getPlayer(targetId).roleId;
    processDeaths(this.ctx(), [{ playerId: targetId, cause: "CHASSEUR_SHOT" }]);
    this.ctx().recordEvent({ type: "CHASSEUR_SHOT", actorId: shooterId, targetId, targetRoleId });

    // Chasseur shots can happen after a night OR after a day-vote elimination.
    this.tryResumeAfterBlockers();
    return { anyoneDied: true };
  }

  // -------------------------------------------------------------------
  // Chef du village succession (triggered when the elected Chef dies)
  // -------------------------------------------------------------------

  getPendingChefSuccessionDeadChefId(): string | null {
    return this.state.pendingChefSuccessionDeadChefId;
  }

  chooseChefSuccessor(deadChefId: string, successorId: string): void {
    if (this.state.pendingChefSuccessionDeadChefId !== deadChefId) {
      throw new Error("Aucune succession de Chef en attente pour ce joueur.");
    }
    const successor = this.ctx().getPlayer(successorId);
    if (!successor.isAlive) throw new Error("Le successeur doit être un joueur vivant.");
    if (successorId === deadChefId) throw new Error("Le Chef doit désigner un autre joueur que lui-même.");

    const oldChef = this.ctx().getPlayer(deadChefId);
    oldChef.isChef = false;
    successor.isChef = true;
    this.state.chef.electedId = successorId;
    this.state.pendingChefSuccessionDeadChefId = null;
    this.appendLog(`${oldChef.nickname} désigne ${successor.nickname} comme nouveau Chef du village.`);

    this.tryResumeAfterBlockers();
  }

  /**
   * Admin-only escape hatch: forcibly kills a player outright — e.g.
   * someone disconnected who will never come back and is blocking the
   * game. Deliberately routes through the SAME death pipeline as every
   * other kill in the game (DeathQueue.processDeaths), not a special-cased
   * "silent" removal: Chasseur revenge, Chef succession, and the Mowgli
   * transform check all still trigger exactly as they would for a night
   * kill or a day-vote elimination.
   *
   * Victory is checked immediately afterward if nothing is left pending.
   * If something IS pending (a Chasseur shot, a Chef succession), this
   * deliberately does NOT try to force the surrounding phase forward — it
   * just waits, exactly like any other death does, until submitChasseurShot
   * /chooseChefSuccessor resolves it and calls tryResumeAfterBlockers()
   * itself.
   */
  adminKillPlayer(playerId: string): void {
    if (this.state.phase === "LOBBY" || this.state.phase === "ENDED") {
      throw new Error("Impossible de retirer un joueur maintenant.");
    }
    const player = this.ctx().getPlayer(playerId);
    if (!player.isAlive) throw new Error("Ce joueur est déjà mort.");

    this.snapshot();
    processDeaths(this.ctx(), [{ playerId, cause: "ADMIN_KILL" }]);

    if (!this.hasPendingBlockers()) {
      const winner = checkVictory(this.ctx());
      if (winner) {
        this.endGame(winner);
      } else if (isAlienStalemate(this.ctx())) {
        this.endGame(null);
      }
    }
  }

  /**
   * True while any death-triggered action (Chasseur shot, Chef succession)
   * still needs resolving. Public because the server's timer scheduler
   * (apps/server/src/socket/timers.ts) must check this BEFORE deciding
   * what to schedule: while blocked, the surrounding phase (NIGHT or
   * DAY_VOTE) doesn't actually move, and blindly rescheduling that phase's
   * own (much longer) timer would eventually re-fire and re-run night/vote
   * resolution a second time on top of an already-resolved state. See
   * resolvePendingBlockersIfAny() for the auto-progress safety net.
   */
  hasPendingBlockers(): boolean {
    return (
      this.state.pendingChasseurShooterIds.length > 0 || this.state.pendingChefSuccessionDeadChefId !== null
    );
  }

  /**
   * Auto-progress safety net: if a pending Chasseur shot and/or Chef
   * succession is never resolved by the player in question (AFK,
   * disconnected, indecisive), a fully-automatic game must not freeze
   * forever waiting on them. Called by the server once the dedicated
   * pending-blocker deadline (timers.chasseurShot / timers.chefSuccession)
   * expires. Picks a random valid target/successor for each still-pending
   * blocker and resolves it exactly the way a manual submission would,
   * which naturally lets tryResumeAfterBlockers() continue the game once
   * every blocker has cleared.
   */
  resolvePendingBlockersIfAny(): void {
    for (const shooterId of [...this.state.pendingChasseurShooterIds]) {
      const eligible = this.ctx().getAlivePlayers().filter((p) => p.id !== shooterId);
      if (eligible.length === 0) {
        const idx = this.state.pendingChasseurShooterIds.indexOf(shooterId);
        if (idx !== -1) this.state.pendingChasseurShooterIds.splice(idx, 1);
        continue;
      }
      const target = shuffle(eligible, this.rng)[0]!;
      this.appendLog(
        `${this.ctx().getPlayer(shooterId).nickname} n'a pas tiré à temps — cible choisie au hasard.`,
      );
      this.submitChasseurShot(shooterId, target.id);
    }

    const deadChefId = this.state.pendingChefSuccessionDeadChefId;
    if (deadChefId) {
      const eligible = this.ctx().getAlivePlayers();
      if (eligible.length === 0) {
        this.state.pendingChefSuccessionDeadChefId = null;
      } else {
        const successor = shuffle(eligible, this.rng)[0]!;
        this.appendLog(
          `Succession non désignée à temps — ${successor.nickname} devient Chef du village au hasard.`,
        );
        this.chooseChefSuccessor(deadChefId, successor.id);
      }
    }
  }

  /** Resume whatever transition was paused for a pending blocker, once all of them have cleared. */
  private tryResumeAfterBlockers(): void {
    if (this.hasPendingBlockers()) return;
    if (this.state.phase === "NIGHT") {
      this.finishMorning(this.state.lastDeathPlayerIds.length > 0);
    } else if (this.state.phase === "DAY_1_DISCUSSION" || this.state.phase === "DAY_DISCUSSION") {
      // A Barbie reveal mid-discussion can itself trigger a pending
      // Chasseur shot or Chef succession — resume discussion (or move on)
      // once that clears, instead of falling into the DAY_VOTE-oriented
      // branch below, which doesn't apply here.
      this.finishDiscussionEventAndMaybeProceed();
    } else {
      this.finishEliminationAndProceed();
    }
  }

  /**
   * Checks victory (including the Alien-only-stalemate safety net) and, if
   * the game isn't over, either lets discussion resume with whoever's next
   * or — if nobody's left to speak — moves on to the next phase. Used both
   * by useBarbiePower() directly and by tryResumeAfterBlockers() once a
   * blocker a reveal triggered (a Chasseur shot, a Chef succession) clears.
   */
  private finishDiscussionEventAndMaybeProceed(): void {
    if (this.hasPendingBlockers()) return;
    const winner = checkVictory(this.ctx());
    if (winner) {
      this.endGame(winner);
      return;
    }
    if (isAlienStalemate(this.ctx())) {
      this.endGame(null);
      return;
    }
    if (DayDiscussion.currentDaySpeakerId(this.ctx()) !== null) return; // speakers remain — resume normally

    if (this.state.phase === "DAY_1_DISCUSSION") {
      this.startNight();
    } else if (this.state.phase === "DAY_DISCUSSION") {
      this.startChefSecondDebate();
    }
  }

  private finishMorning(anyoneDied: boolean): void {
    this.state.lastMorningResult = anyoneDied ? "DEATH" : "NO_DEATH";
    this.state.phase = "MORNING";
    this.appendLog(anyoneDied ? "Quelqu'un est mort cette nuit." : "Personne n'est mort cette nuit.");
    const winner = checkVictory(this.ctx());
    if (winner) {
      this.endGame(winner);
    } else if (isAlienStalemate(this.ctx())) {
      this.endGame(null);
    }
  }

  proceedFromMorningToDay(): void {
    if (this.state.phase !== "MORNING") throw new Error("Ce n'est pas le moment.");
    this.snapshot();
    this.state.dayNumber += 1;
    this.state.phase = "DAY_DISCUSSION";
    DayDiscussion.startDayDiscussion(this.ctx(), this.rng);
  }

  // -------------------------------------------------------------------
  // Day discussion / vote / tie handling
  // -------------------------------------------------------------------

  /**
   * Manual "skip the rest of the discussion" — bypasses however far the
   * speaking order has gotten, going straight to the vote. Deliberately
   * also skips the optional Chef's second debate: this is the "we're done
   * talking, let's vote" shortcut (used by the admin's force-next-phase and
   * the Chef's own self-serve equivalent), so it makes sense for it to skip
   * every remaining optional discussion step, not just the mandatory one.
   * The natural, un-skipped completion path (advanceDaySpeaker() running
   * the queue all the way out) still goes through CHEF_SECOND_DEBATE.
   */
  endDayDiscussion(): void {
    if (this.state.phase !== "DAY_DISCUSSION") throw new Error("Ce n'est pas le moment.");
    this.snapshot();
    this.startDayVoteFromSecondDebate();
  }

  // -------------------------------------------------------------------
  // Chef's second debate (optional bonus turns, right before DAY_VOTE)
  // -------------------------------------------------------------------

  /** True once CHEF_SECOND_DEBATE has started but the Chef hasn't yet chosen who (if anyone) speaks again. */
  isSecondDebateChoicePending(): boolean {
    return this.state.phase === "CHEF_SECOND_DEBATE" && this.state.secondDebateQueue === null;
  }

  getSecondDebateEligibleTargets(): string[] {
    if (this.state.phase !== "CHEF_SECOND_DEBATE") return [];
    return SecondDebate.getEligibleTargets(this.ctx());
  }

  /** `playerIds` may be empty — the Chef is explicitly allowed to grant nobody a second turn. */
  chooseSecondDebateSpeakers(playerIds: string[]): void {
    if (this.state.phase !== "CHEF_SECOND_DEBATE") throw new Error("Ce n'est pas le moment.");
    if (this.state.secondDebateQueue !== null) {
      throw new Error("Le Chef a déjà fait son choix pour ce second débat.");
    }
    this.snapshot();
    SecondDebate.chooseSpeakers(this.ctx(), playerIds);
    if (SecondDebate.currentSpeakerId(this.ctx()) === null) this.startDayVoteFromSecondDebate();
  }

  getCurrentSecondDebateSpeakerId(): string | null {
    return SecondDebate.currentSpeakerId(this.ctx());
  }

  /**
   * Advances to the next bonus speaker. `done: true` means the last chosen
   * player's turn just ended (or none were chosen) — same auto-transition
   * pattern as advanceChefSpeaker()/advanceDaySpeaker(), moving straight on
   * to DAY_VOTE.
   */
  advanceSecondDebateSpeaker(): { done: boolean } {
    if (this.state.phase !== "CHEF_SECOND_DEBATE") throw new Error("Ce n'est pas le moment.");
    const result = SecondDebate.advanceSpeaker(this.ctx());
    if (result.done) {
      this.snapshot();
      this.startDayVoteFromSecondDebate();
    }
    return result;
  }

  /** Manual "skip the rest of the second debate" (also covers skipping it outright before any choice is made). */
  endChefSecondDebate(): void {
    if (this.state.phase !== "CHEF_SECOND_DEBATE") throw new Error("Ce n'est pas le moment.");
    this.snapshot();
    this.startDayVoteFromSecondDebate();
  }

  private startDayVoteFromSecondDebate(): void {
    this.state.phase = "DAY_VOTE";
    this.startDayVoteQueueOrTally();
  }

  /**
   * Builds the per-voter turn queue for the current DAY_VOTE round, then
   * immediately tallies instead if that queue comes back empty. That can
   * only happen in round 2 (the tied candidates are excluded from voting
   * in their own re-vote — see DayVoteQueue.buildVoteOrder): in a small
   * end-game every remaining alive player might be one of the tied
   * candidates, leaving literally nobody left to vote. Rather than hang
   * forever waiting for a turn that will never come, tally right away —
   * with zero votes cast it resolves as a fresh tie, which
   * resolveRepeatedTie already turns into "nobody dies, move on".
   */
  private startDayVoteQueueOrTally(): void {
    DayVoteQueue.startDayVoteQueue(this.ctx());
    const queue = this.state.dayVoteQueue;
    if (!queue || queue.order.length === 0) {
      this.tallyDayVoteAndProceed();
    }
  }

  /**
   * Casts one player's vote, then immediately advances the queue to the
   * next voter (no waiting out that voter's own timer once they've acted —
   * see DayVoteQueue.ts). If that was the last turn (the Chef's, always
   * last), automatically tallies and proceeds, same auto-transition
   * pattern as advanceChefSpeaker()/advanceTieDefenseSpeaker().
   */
  /**
   * Returns the DayVoteOutcome the moment this vote happened to be the
   * queue's last turn (the Chef's, always last) and therefore triggered an
   * automatic tally — null otherwise (the queue just advanced to the next
   * voter, nothing resolved yet).
   */
  castDayVote(voterId: string, targetId: string): VoteManager.DayVoteOutcome | null {
    if (this.state.phase !== "DAY_VOTE") throw new Error("Ce n'est pas le moment de voter.");
    VoteManager.castDayVote(this.ctx(), voterId, targetId);
    return this.advanceDayVoteQueue().outcome;
  }

  getCurrentDayVoterId(): string | null {
    return DayVoteQueue.currentVoterId(this.ctx());
  }

  /** Timeout / manual-skip path: the current voter's turn ends WITHOUT a vote being recorded. */
  skipCurrentDayVoter(): { done: boolean; outcome: VoteManager.DayVoteOutcome | null } {
    if (this.state.phase !== "DAY_VOTE") throw new Error("Ce n'est pas le moment.");
    const currentId = DayVoteQueue.currentVoterId(this.ctx());
    if (currentId) this.appendLog(`${this.ctx().getPlayer(currentId).nickname} n'a pas voté à temps.`);
    return this.advanceDayVoteQueue();
  }

  private advanceDayVoteQueue(): { done: boolean; outcome: VoteManager.DayVoteOutcome | null } {
    if (!this.state.dayVoteQueue) return { done: true, outcome: null };
    const result = DayVoteQueue.advanceDayVoteQueue(this.ctx());
    if (result.done) {
      const outcome = this.tallyDayVoteAndProceed();
      return { done: true, outcome };
    }
    return { done: false, outcome: null };
  }

  tallyDayVoteAndProceed(): VoteManager.DayVoteOutcome {
    if (this.state.phase !== "DAY_VOTE") throw new Error("Ce n'est pas le moment.");
    this.snapshot();
    this.state.lastDeathPlayerIds = [];
    this.state.dayVoteQueue = null; // this round's queue has done its job either way
    const outcome = VoteManager.tallyDayVote(this.ctx());

    if (outcome.awaitingAnotherRound) {
      this.state.phase = "TIE_DEFENSE";
      // Randomly order the tied players' defense turns — same per-speaker
      // queue mechanic as the Chef debate and day discussion, so the
      // timer/UI machinery just works instead of showing a flat, contentless
      // phase with no real countdown to attach to.
      TieDefense.startTieDefense(this.ctx(), this.rng);
      return outcome;
    }

    // Fully resolved this call: either someone was eliminated, or a
    // persistent (round 2) tie was hard-resolved as "nobody dies". Either
    // way, move on.
    this.finishEliminationAndProceed();
    return outcome;
  }

  /** Manual "skip the rest of the defense" — bypasses however far the speaking order has gotten. */
  endTieDefense(): void {
    if (this.state.phase !== "TIE_DEFENSE") throw new Error("Ce n'est pas le moment.");
    this.snapshot();
    this.state.phase = "DAY_VOTE"; // reuses the round-2+ voting logic in VoteManager
    this.startDayVoteQueueOrTally(); // fresh per-player turn order for the re-vote
  }

  getCurrentTieDefenseSpeakerId(): string | null {
    return TieDefense.currentTieDefenseSpeakerId(this.ctx());
  }

  /**
   * Advances to the next tied player's defense turn. Called both by the
   * per-speaker auto-progress timer and by "passe la parole". When the
   * last tied player's turn just ended, this automatically moves on to
   * DAY_VOTE (round 2+) — same pattern as advanceChefSpeaker()/
   * advanceDaySpeaker() auto-moving to the next phase.
   */
  advanceTieDefenseSpeaker(): { done: boolean } {
    if (this.state.phase !== "TIE_DEFENSE") throw new Error("Ce n'est pas le moment.");
    const result = TieDefense.advanceTieDefenseSpeaker(this.ctx());
    if (result.done) {
      this.snapshot();
      this.state.phase = "DAY_VOTE";
      // BUG FIX: this natural (timer/passe-la-parole-driven) completion path
      // was setting the phase to DAY_VOTE without ever building the
      // per-voter turn queue — unlike its manual sibling endTieDefense(),
      // which does. With no queue, getCurrentDayVoterId() is permanently
      // null, so nobody's turn ever comes up: nobody can vote, the per-voter
      // timer's skipCurrentDayVoter() is a silent no-op every time it fires
      // (re-arming the same broken state forever), and even the Chef's
      // "next phase" button does nothing (its own skip-loop also no-ops
      // immediately). The whole game hangs in DAY_VOTE with no way out
      // short of an admin's manual "Annuler" (undo). Same root cause and
      // fix as the DAY_DISCUSSION -> DAY_VOTE gap fixed elsewhere this
      // session (see startChefSecondDebate()/advanceDaySpeaker()).
      this.startDayVoteQueueOrTally();
    }
    return result;
  }

  private finishEliminationAndProceed(): void {
    if (this.hasPendingBlockers()) return; // blocked, wait for shot(s) and/or Chef succession
    const winner = checkVictory(this.ctx());
    if (winner) {
      this.endGame(winner);
      return;
    }
    if (isAlienStalemate(this.ctx())) {
      this.endGame(null);
      return;
    }
    this.state.phase = "DAY_VOTE_RESULT";
  }

  /** Leaves the "X a été éliminé(e) / personne n'a été éliminé(e)" announcement pause and starts the next night. */
  proceedFromDayVoteResultToNight(): void {
    if (this.state.phase !== "DAY_VOTE_RESULT") throw new Error("Ce n'est pas le moment.");
    this.snapshot();
    this.startNight();
  }

  // -------------------------------------------------------------------
  // Pause / resume / end
  // -------------------------------------------------------------------

  /**
   * Freezes the countdown: stashes exactly how much time was left on the
   * current phase's clock so resume() can hand back that same remaining
   * time, instead of the pause silently counting down against the players
   * (if we left phaseEndsAt alone) or resume() granting a full fresh
   * duration (which is what happened before this existed, incidentally,
   * as a side effect of the timer-reset bug elsewhere).
   */
  pause(): void {
    this.state.paused = true;
    this.state.pausedRemainingMs =
      this.state.phaseEndsAt !== null ? Math.max(0, this.state.phaseEndsAt - Date.now()) : null;
  }

  resume(): void {
    this.state.paused = false;
    if (this.state.pausedRemainingMs !== null) {
      this.state.phaseEndsAt = Date.now() + this.state.pausedRemainingMs;
      this.state.pausedRemainingMs = null;
    }
  }

  endGame(winner: Team | null = null): void {
    this.snapshot();
    this.state.winner = winner ?? checkVictory(this.ctx());
    this.state.phase = "ENDED";
    this.appendLog(
      this.state.winner === "VILLAGE"
        ? "Le village remporte la partie !"
        : this.state.winner === "LOUPS"
          ? "Les loups-garous remportent la partie !"
          : "La partie est terminée.",
    );
  }

  revealRolesEarly(): void {
    this.state.rolesRevealedToPlayers = true;
  }

  areRolesRevealedToPlayers(): boolean {
    return this.state.rolesRevealedToPlayers || this.state.phase === "ENDED";
  }

  // -------------------------------------------------------------------
  // Read models
  // -------------------------------------------------------------------

  getPublicState(): GameStatePublic {
    const players: PlayerPublic[] = this.state.playerOrder
      .map((id) => this.state.players.get(id)!)
      .map((p) => ({
        id: p.id,
        nickname: p.nickname,
        isAlive: p.isAlive,
        isChef: p.isChef,
        isConnected: p.isConnected,
        isSpectator: p.isSpectator,
        // A dead player's role is public knowledge; a living one's never is.
        revealedRoleId: p.isAlive ? undefined : p.roleId,
      }));

    const lastDeaths: GameStatePublic["lastDeaths"] = this.state.lastDeathPlayerIds
      .map((id) => this.state.players.get(id))
      .filter((p): p is InternalPlayer => Boolean(p))
      .map((p) => ({ playerId: p.id, nickname: p.nickname, roleId: p.roleId }));

    return {
      code: this.state.code,
      phase: this.state.phase,
      paused: this.state.paused,
      nightNumber: this.state.nightNumber,
      dayNumber: this.state.dayNumber,
      players,
      chefId: this.state.chef.electedId,
      candidates: this.state.chef.candidates,
      currentSpeakerId: this.state.chef.debateOrder[this.state.chef.currentSpeakerIndex] ?? null,
      phaseEndsAt: this.state.phaseEndsAt,
      tiedPlayerIds: this.state.dayVote.tiedIds,
      lastMorningAnnouncement: this.state.lastMorningResult,
      lastDeaths,
      mowgliTransformedAnnounced: this.state.mowgliTransformedAnnounced,
      winner: this.state.winner,
      // Open ballot by design: only live during the actual voting phase, so
      // it can't leak a round-1 vote into TIE_DEFENSE or a stale round into
      // the next elimination.
      dayVotes: this.state.phase === "DAY_VOTE" ? Object.fromEntries(this.state.dayVote.votes) : {},
      dayVoteTally: this.state.phase === "DAY_VOTE" ? VoteManager.computeLiveVoteTally(this.ctx()) : {},
      dayVoteOrder: this.state.dayVoteQueue?.order ?? null,
      dayVoteCurrentVoterId: DayVoteQueue.currentVoterId(this.ctx()),
      secondDebateChoicePending: this.isSecondDebateChoicePending(),
      secondDebateOrder: this.state.secondDebateQueue?.order ?? null,
      secondDebateCurrentSpeakerId: SecondDebate.currentSpeakerId(this.ctx()),
      secondDebateSlots: this.state.config.secondDebateSlots,
      chefVotes: this.state.phase === "CHEF_VOTE" ? Object.fromEntries(this.state.chef.votes) : {},
      chefVoteTally: this.state.phase === "CHEF_VOTE" ? ChefElection.computeLiveChefVoteTally(this.ctx()) : {},
      dayDiscussionOrder: this.state.dayDiscussion?.order ?? null,
      dayDiscussionCurrentSpeakerId: DayDiscussion.currentDaySpeakerId(this.ctx()),
      tieDefenseOrder: this.state.tieDefense?.order ?? null,
      tieDefenseCurrentSpeakerId: TieDefense.currentTieDefenseSpeakerId(this.ctx()),
      soundEffectsEnabled: this.state.config.soundEffectsEnabled,
    };
  }

  consumePendingMowgliReveal(): boolean {
    if (!this.state.pendingMowgliReveal) return false;
    this.state.pendingMowgliReveal = false;
    this.state.mowgliTransformedAnnounced = true;
    return true;
  }

  /**
   * True exactly once, the first time this is called after the game
   * reaches ENDED — lets the server emit GAME_ENDED (with stats) from a
   * single, always-run place (handlers.ts's sync()) no matter WHAT action
   * caused the game to end (a manual admin/Chef skip, a timer auto-advance,
   * or now, a player's own vote completing the day-vote queue). Before
   * this existed, only the admin/Chef "force next phase" handlers checked
   * for this explicitly, so a game that ended via a timer expiring (or,
   * with the new sequential day vote, via a normal vote) never fired
   * GAME_ENDED at all — players saw the bare "Partie terminée" phase text
   * instead of the actual victory screen with stats.
   */
  consumeGameEndedNotification(): boolean {
    if (this.state.phase !== "ENDED" || this.state.gameEndedNotified) return false;
    this.state.gameEndedNotified = true;
    return true;
  }

  getAdminRoles(): PlayerPrivateRole[] {
    return this.state.playerOrder.map((id) => {
      const p = this.state.players.get(id)!;
      return { playerId: p.id, roleId: p.roleId };
    });
  }

  getLogs(): LogEntry[] {
    return this.state.logs;
  }

  getPhaseEndsAt(): number | null {
    return this.state.phaseEndsAt;
  }

  setPhaseTimer(durationSeconds: number | null): void {
    this.state.phaseEndsAt = durationSeconds === null ? null : Date.now() + durationSeconds * 1000;
  }

  getDayVoteRound(): number {
    return this.state.dayVote.round;
  }

  getPendingChasseurShooterIds(): string[] {
    return this.state.pendingChasseurShooterIds;
  }

  getChefId(): string | null {
    return this.state.chef.electedId;
  }

  getEndGameStats(): EndGameStats {
    return {
      winner: this.state.winner ?? "VILLAGE",
      roleReveal: this.state.playerOrder.map((id) => {
        const p = this.state.players.get(id)!;
        return { playerId: p.id, nickname: p.nickname, roleId: p.roleId, isAlive: p.isAlive };
      }),
      totalNights: this.state.nightNumber,
      totalDays: this.state.dayNumber,
      chefHistory: this.state.chef.electedId ? [this.state.chef.electedId] : [],
    };
  }

  /**
   * Flat, role-agnostic per-player outcome snapshot for the accounts/stats/
   * history layer (apps/server) to persist once a game ends — see
   * FinalPlayerSummary's doc comment. Deliberately readable at ANY phase
   * (not just ENDED): nothing stops a caller from asking mid-game, it just
   * reflects "right now" rather than a final outcome in that case.
   */
  getFinalPlayerSummaries(): FinalPlayerSummary[] {
    return this.state.playerOrder.map((id) => {
      const p = this.state.players.get(id)!;
      return {
        playerId: p.id,
        nickname: p.nickname,
        roleId: p.roleId,
        team: ROLE_METADATA[p.roleId].team,
        isAlive: p.isAlive,
        deathCause: p.deathCause,
        deathMoment: p.deathMoment,
      };
    });
  }

  /**
   * The full structured history for the game so far (or the whole game,
   * once ended) — see events.ts's GameEvent for the union and
   * FEATURES.md §17.4a for why this exists (Performance Score v2, Badges,
   * Leaderboards all read this generically instead of re-deriving
   * "who did what" from scratch).
   */
  getEventLog(): GameEvent[] {
    return this.state.eventLog;
  }

  /** Every event this specific player caused (see GameEvent's `actorId` doc comment). */
  getPlayerEvents(playerId: string): GameEvent[] {
    return this.state.eventLog.filter((e) => "actorId" in e && e.actorId === playerId);
  }

  getPhase(): Phase {
    return this.state.phase;
  }

  getCode(): string {
    return this.state.code;
  }

  getConfig(): GameConfig {
    return this.state.config;
  }

  getPlayers(): InternalPlayer[] {
    return this.state.playerOrder.map((id) => this.state.players.get(id)!);
  }

  findPlayerByNickname(nickname: string): InternalPlayer | undefined {
    return [...this.state.players.values()].find(
      (p) => p.nickname.toLowerCase() === nickname.toLowerCase(),
    );
  }

  /** For persistence: serialize the full internal state (Maps -> plain objects). */
  serialize(): unknown {
    return {
      ...this.state,
      players: [...this.state.players.entries()],
      chef: { ...this.state.chef, votes: [...this.state.chef.votes.entries()] },
      dayVote: { ...this.state.dayVote, votes: [...this.state.dayVote.votes.entries()] },
    };
  }

  static deserialize(data: any, rng: () => number = Math.random): GameEngine {
    const state: GameInternalState = {
      ...data,
      players: new Map(data.players),
      chef: { ...data.chef, votes: new Map(data.chef.votes) },
      dayVote: { ...data.dayVote, votes: new Map(data.dayVote.votes) },
      // Backward-compatible with games persisted before this field existed
      // (see FEATURES.md §17.4a) — an old save simply has no history yet.
      eventLog: data.eventLog ?? [],
    };
    return new GameEngine(state, rng);
  }
}

export type { NightScratch };
export const KNOWN_ROLE_IDS = Object.keys(ROLE_REGISTRY) as RoleId[];
export { CHEF_TITLE };
