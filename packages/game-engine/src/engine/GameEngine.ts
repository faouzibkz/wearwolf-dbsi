import type {
  EndGameStats,
  GameConfig,
  GameStatePublic,
  LogEntry,
  Phase,
  PlayerPrivateRole,
  PlayerPublic,
  RoleId,
  Team,
} from "@loupgarou/shared";
import { CHEF_TITLE, DEFAULT_GAME_CONFIG } from "@loupgarou/shared";
import type { EngineContext, GameInternalState, InternalPlayer, NightScratch } from "../internalTypes";
import { generateGameCode, generatePlayerId, generateReconnectToken } from "../util/ids";
import { shuffle } from "../util/shuffle";
import { ROLE_REGISTRY } from "../roles/registry";
import * as ChefElection from "./ChefElection";
import * as DayDiscussion from "./DayDiscussion";
import * as TieDefense from "./TieDefense";
import * as VoteManager from "./VoteManager";
import * as NightResolver from "./NightResolver";
import { processDeaths } from "./DeathQueue";
import { checkVictory } from "./VictoryConditions";

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
      players: new Map(),
      playerOrder: [],
      nightNumber: 0,
      dayNumber: 1,
      chef: { candidates: [], debateOrder: [], currentSpeakerIndex: 0, votes: new Map(), electedId: null },
      dayDiscussion: null,
      tieDefense: null,
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
      pendingTieResolutionRule: null,
      rolesRevealedToPlayers: false,
      createdAt: Date.now(),
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
      sorciereHealUsed: false,
      sorcierePoisonUsed: false,
      salvateurLastProtectedId: null,
      mowgliFatherId: null,
      mowgliTransformed: false,
      voyanteInspectionCounts: {},
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
        this.state.phase = "DAY_VOTE";
      }
    }
    return result;
  }

  private startNight(): void {
    this.snapshot();
    this.state.nightNumber += 1;
    this.state.nightScratch = NightResolver.createNightScratch(this.state.nightNumber);
    this.state.phase = "NIGHT";
    this.appendLog("La nuit tombe sur le village.");
  }

  /** `onlyPending` (default true): exclude players who already submitted an action tonight. See NightResolver.collectNightPrompts. */
  getNightPrompts(onlyPending = true) {
    if (this.state.phase !== "NIGHT") return [];
    return NightResolver.collectNightPrompts(this.ctx(), this.state.nightNumber, onlyPending);
  }

  submitNightAction(playerId: string, actionType: string, targetId?: string): void {
    if (this.state.phase !== "NIGHT") throw new Error("Ce n'est pas la nuit.");
    NightResolver.submitNightAction(this.ctx(), playerId, actionType, targetId);
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

  /** Wolves (and a transformed Mowgli) share a private room, computed fresh each call. */
  getWolfRoomMemberIds(): string[] {
    return [...this.state.players.values()]
      .filter((p) => p.isAlive && (p.roleId === "LOUP_GAROU" || p.roleId === "LOUP_BLANC"))
      .map((p) => p.id);
  }

  resolveNightAndProceed(): { anyoneDied: boolean; blocked: boolean; mowgliTransformed: boolean } {
    if (this.state.phase !== "NIGHT") throw new Error("Ce n'est pas la nuit.");
    this.snapshot();
    this.state.lastDeathPlayerIds = [];
    const { anyoneDied } = NightResolver.resolveNight(this.ctx(), this.state.nightNumber);

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
    processDeaths(this.ctx(), [{ playerId: targetId, cause: "CHASSEUR_SHOT" }]);

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
    } else {
      this.finishEliminationAndProceed();
    }
  }

  private finishMorning(anyoneDied: boolean): void {
    this.state.lastMorningResult = anyoneDied ? "DEATH" : "NO_DEATH";
    this.state.phase = "MORNING";
    this.appendLog(anyoneDied ? "Quelqu'un est mort cette nuit." : "Personne n'est mort cette nuit.");
    const winner = checkVictory(this.ctx());
    if (winner) this.endGame(winner);
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

  /** Manual "skip the rest of the discussion" — bypasses however far the speaking order has gotten. */
  endDayDiscussion(): void {
    if (this.state.phase !== "DAY_DISCUSSION") throw new Error("Ce n'est pas le moment.");
    this.snapshot();
    this.state.phase = "DAY_VOTE";
  }

  castDayVote(voterId: string, targetId: string): void {
    if (this.state.phase !== "DAY_VOTE") throw new Error("Ce n'est pas le moment de voter.");
    VoteManager.castDayVote(this.ctx(), voterId, targetId);
  }

  tallyDayVoteAndProceed(): VoteManager.DayVoteOutcome {
    if (this.state.phase !== "DAY_VOTE") throw new Error("Ce n'est pas le moment.");
    this.snapshot();
    this.state.lastDeathPlayerIds = [];
    const outcome = VoteManager.tallyDayVote(this.ctx(), this.rng);

    if (outcome.awaitingAnotherRound) {
      this.state.phase = "TIE_DEFENSE";
      // Randomly order the tied players' defense turns — same per-speaker
      // queue mechanic as the Chef debate and day discussion, so the
      // timer/UI machinery just works instead of showing a flat, contentless
      // phase with no real countdown to attach to.
      TieDefense.startTieDefense(this.ctx(), this.rng);
      return outcome;
    }
    if (outcome.needsManualResolution) {
      this.state.phase = "TIE_REVOTE"; // parked here awaiting admin/chef resolution
      return outcome;
    }

    // Fully resolved this call: either someone was eliminated, or a tie was
    // settled by NO_ELIMINATION / RANDOM. Either way, move on.
    this.finishEliminationAndProceed();
    return outcome;
  }

  /** Manual "skip the rest of the defense" — bypasses however far the speaking order has gotten. */
  endTieDefense(): void {
    if (this.state.phase !== "TIE_DEFENSE") throw new Error("Ce n'est pas le moment.");
    this.snapshot();
    this.state.phase = "DAY_VOTE"; // reuses the round-2+ voting logic in VoteManager
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
    }
    return result;
  }

  resolveTieManually(targetId: string | null): VoteManager.DayVoteOutcome {
    if (this.state.phase !== "TIE_REVOTE") throw new Error("Aucune égalité à résoudre.");
    this.snapshot();
    this.state.lastDeathPlayerIds = [];
    const outcome = VoteManager.resolveTieManually(this.ctx(), targetId);
    this.finishEliminationAndProceed();
    return outcome;
  }

  /**
   * Auto-progress safety net for TIE_REVOTE — the one deliberately-manual
   * checkpoint (a tie under CHEF_DECIDES/ADMIN_DECIDES waits for a human
   * pick via resolveTieManually). Even a deliberate manual step shouldn't
   * be able to freeze a fully-automatic game forever, so once its own
   * timers.tieRevote deadline passes, break the tie at random exactly like
   * the TieResolutionRule "RANDOM" option would.
   */
  autoResolveTieRevoteIfPending(): void {
    if (this.state.phase !== "TIE_REVOTE") return;
    const tiedIds = this.state.dayVote.tiedIds;
    const choice = tiedIds.length > 0 ? shuffle(tiedIds, this.rng)[0]! : null;
    this.appendLog("Égalité non résolue à temps — décision prise au hasard.");
    this.resolveTieManually(choice);
  }

  private finishEliminationAndProceed(): void {
    if (this.hasPendingBlockers()) return; // blocked, wait for shot(s) and/or Chef succession
    const winner = checkVictory(this.ctx());
    if (winner) {
      this.endGame(winner);
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

  pause(): void {
    this.state.paused = true;
  }

  resume(): void {
    this.state.paused = false;
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

  getPendingChasseurShooterIds(): string[] {
    return this.state.pendingChasseurShooterIds;
  }

  getPendingTieResolutionRule() {
    return this.state.pendingTieResolutionRule;
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
    };
    return new GameEngine(state, rng);
  }
}

export type { NightScratch };
export const KNOWN_ROLE_IDS = Object.keys(ROLE_REGISTRY) as RoleId[];
export { CHEF_TITLE };
