"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ROLE_METADATA,
  SOCKET_EVENTS,
  type AfterlifeChatMessagePayload,
  type AfterlifeRoomStatePayload,
  type BarbieRevealResultPayload,
  type EndGameStats,
  type GameStatePublic,
  type LoupVertGuessPromptPayload,
  type MvpResultPayload,
  type MvpStatePayload,
  type NightPromptPayload,
  type NightStepStatePayload,
  type NotificationPayload,
  type PrivateRoleStatePayload,
  type ReplayStartedPayload,
  type RoleAssignedPayload,
  type RoleId,
  type WolfRoomStatePayload,
  type WolfChatMessagePayload,
} from "@loupgarou/shared";
import { emitWithAck, getSocket } from "@/lib/socket";
import { startClockSync } from "@/lib/serverClock";
import { loadAdminSession, loadPlayerSession, savePlayerSession, type PlayerSession } from "@/lib/session";
import {
  playChefFanfare,
  playDeathBell,
  playMorningRooster,
  playNightHowl,
  playVictoryFanfare,
  playYourTurnChime,
} from "@/lib/soundEffects";
import { RoleCard, ROLE_EMOJI } from "@/components/RoleCard";
import { PlayerList } from "@/components/PlayerList";
import { CountdownTimer } from "@/components/CountdownTimer";
import { NightPromptPanel } from "@/components/NightPromptPanel";
import { LoupVertGuessPanel } from "@/components/LoupVertGuessPanel";
import { BarbiePowerPanel } from "@/components/BarbiePowerPanel";
import { BarbieRevealOverlay } from "@/components/BarbieRevealOverlay";
import { LiveVoteList } from "@/components/LiveVoteList";
import { WolfChat } from "@/components/WolfChat";
import { AfterlifeChat } from "@/components/AfterlifeChat";
import { EndGamePanel } from "@/components/EndGamePanel";
import { NotesButton } from "@/components/NotesButton";

/**
 * Cahier de charge #2 §17.2 — Night presentation. Per-role "wake up" flavor
 * text for the SEQUENTIAL night step banner, replacing a generic
 * "{displayName} agit…" with the same kind of narration the cahier de
 * charge's own examples used ("🛡️ Le Salvateur se réveille"). Purely
 * cosmetic — every role's actual eligibility/prompt logic is untouched;
 * this is only ever read from the step banner in the "NIGHT" case below.
 * The wolf pack (LOUP_GAROU + LOUP_BLANC + LOUP_VERT) always shares one
 * merged step when more than one of them is in play (see NightSequencer.ts
 * server-side), hence the dedicated multi-role phrasing rather than a
 * per-role lookup for that case.
 */
const NIGHT_WAKE_TEXT: Partial<Record<RoleId, string>> = {
  MOWGLI: "🌿 Mowgli se réveille…",
  SALVATEUR: "🛡️ Le Salvateur se réveille…",
  ALIEN: "👽 L'Alien se réveille…",
  VOYANTE: "🔮 La Voyante se réveille…",
  LOUP_GAROU: "🐺 Les Loups-garous se réveillent…",
  LOUP_BLANC: "🐺 Le Loup blanc se réveille…",
  LOUP_VERT: "🐺 Le Loup vert se réveille…",
  SORCIERE: "🧙‍♀️ La Sorcière se réveille…",
  CORBEAU: "🐦‍⬛ Le Corbeau se réveille…",
  PRETRE: "✝️ Le Prêtre se réveille…",
};

const WOLF_TEAM_ROLE_IDS: RoleId[] = ["LOUP_GAROU", "LOUP_BLANC", "LOUP_VERT"];

function describeNightStep(roleIds: RoleId[]): string {
  if (roleIds.length > 1 && roleIds.every((id) => WOLF_TEAM_ROLE_IDS.includes(id))) {
    return "🐺 Les Loups se réveillent…";
  }
  if (roleIds.length === 1) {
    return NIGHT_WAKE_TEXT[roleIds[0]!] ?? `${ROLE_METADATA[roleIds[0]!].displayName} agit…`;
  }
  // Defensive fallback — not expected today (every current multi-role step
  // is the wolf pack, handled above), but never worth crashing the UI over
  // a future role sharing a step in some new way.
  return `${roleIds.map((id) => ROLE_METADATA[id].displayName).join(" & ")} agissent…`;
}

export default function PlayPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const code = params.code.toUpperCase();

  const [session, setSession] = useState<PlayerSession | null>(null);
  const [state, setState] = useState<GameStatePublic | null>(null);
  const [role, setRole] = useState<RoleId | null>(null);
  const [wolfTeammates, setWolfTeammates] = useState<{ id: string; nickname: string }[]>([]);
  const [prompt, setPrompt] = useState<NightPromptPayload | null>(null);
  // Cahier de charge #2 §17.1 — SEQUENTIAL night mode only. Null in
  // SIMULTANEOUS mode: the server never emits NIGHT_STEP_STATE there (see
  // GameEngine.isSequentialNightMode()), so this stays exactly what it was
  // before this feature existed for every game that hasn't opted in.
  const [nightStepState, setNightStepState] = useState<NightStepStatePayload | null>(null);
  const [loupVertGuessPrompt, setLoupVertGuessPrompt] = useState<LoupVertGuessPromptPayload | null>(null);
  const [loupVertStolenPrompt, setLoupVertStolenPrompt] = useState<NightPromptPayload | null>(null);
  const [privateRoleState, setPrivateRoleState] = useState<PrivateRoleStatePayload>({});
  const [barbieReveal, setBarbieReveal] = useState<BarbieRevealResultPayload | null>(null);
  const [chasseurTargets, setChasseurTargets] = useState<string[] | null>(null);
  const [chefSuccessionTargets, setChefSuccessionTargets] = useState<string[] | null>(null);
  const [wolfRoom, setWolfRoom] = useState<WolfRoomStatePayload | null>(null);
  const [wolfMessages, setWolfMessages] = useState<WolfChatMessagePayload[]>([]);
  // Cahier de charge #2 §17.3 — null for every still-alive player (the
  // server never pushes AFTERLIFE_ROOM_STATE to them, see
  // GameEngine.getAfterlifeMemberIds), and unlike wolfRoom this persists
  // across every phase once populated, not just NIGHT.
  const [afterlifeRoom, setAfterlifeRoom] = useState<AfterlifeRoomStatePayload | null>(null);
  const [afterlifeMessages, setAfterlifeMessages] = useState<AfterlifeChatMessagePayload[]>([]);
  const [notifications, setNotifications] = useState<NotificationPayload[]>([]);
  const [endStats, setEndStats] = useState<unknown>(null);
  const [mvpState, setMvpState] = useState<MvpStatePayload | null>(null);
  const [mvpResult, setMvpResult] = useState<MvpResultPayload | null>(null);
  // Set once, client-side only (localStorage isn't available during SSR —
  // same reason `session` itself is only ever populated inside the effect
  // below, not at render time). Non-null exactly when this same browser is
  // ALSO running the admin dashboard for this game — i.e. the host is
  // playing from this very tab, which is what EndGamePanel's replay
  // buttons are gated on (see the "instant replay" feature: only the
  // original host can relaunch, and this is how a player tab proves it).
  const [hostToken, setHostToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRoleDetail, setShowRoleDetail] = useState(false);
  const [confirmingChefSkip, setConfirmingChefSkip] = useState(false);
  const announcedDeathsRef = useRef<string>("");
  const soundEnabledRef = useRef<boolean>(true);
  const prevPhaseRef = useRef<GameStatePublic["phase"] | null>(null);
  const prevRoleRef = useRef<RoleId | null>(null);
  const prevDayVoteVoterRef = useRef<string | null>(null);

  useEffect(() => {
    const stored = loadPlayerSession(code);
    if (!stored) {
      router.replace(`/join?code=${code}`);
      return;
    }
    setSession(stored);

    const adminSession = loadAdminSession();
    if (adminSession && adminSession.gameCode === code) {
      setHostToken(adminSession.hostToken);
    }

    const socket = getSocket();
    startClockSync();

    async function reconnect() {
      try {
        await emitWithAck(SOCKET_EVENTS.PLAYER_RECONNECT, {
          gameCode: code,
          playerId: stored!.playerId,
          reconnectToken: stored!.reconnectToken,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Reconnexion impossible.");
      }
    }
    reconnect();
    socket.on("connect", reconnect);

    socket.on(SOCKET_EVENTS.GAME_STATE, (s: GameStatePublic) => {
      setState(s);
      if (s.phase !== "NIGHT") {
        setPrompt(null);
        setLoupVertGuessPrompt(null);
        setLoupVertStolenPrompt(null);
        setNightStepState(null);
      }
      soundEnabledRef.current = s.soundEffectsEnabled;

      if (s.phase !== prevPhaseRef.current) {
        if (s.phase === "NIGHT") playNightHowl(soundEnabledRef.current);
        else if (s.phase === "MORNING") playMorningRooster(soundEnabledRef.current);
        else if (s.phase === "CHEF_REVEAL") playChefFanfare(soundEnabledRef.current);
        prevPhaseRef.current = s.phase;
      }

      const signature = s.lastDeaths.map((d) => d.playerId).sort().join(",");
      if (signature && signature !== announcedDeathsRef.current) {
        announcedDeathsRef.current = signature;
        playDeathBell(soundEnabledRef.current);
        const deathNotifications: NotificationPayload[] = s.lastDeaths.map((d) => ({
          type: "INFO",
          message: `☠️ ${d.nickname} est mort(e) — il/elle était ${ROLE_METADATA[d.roleId].displayName}.`,
        }));
        setNotifications((prev) => [...prev.slice(-4), ...deathNotifications]);
      } else if (!signature) {
        announcedDeathsRef.current = "";
      }

      // Day vote is a strict one-voter-at-a-time turn queue (DayVoteQueue.ts)
      // with a real per-voter timeout that silently skips anyone who
      // doesn't act in time — a player not looking at their screen the
      // instant their turn starts could previously miss it with zero
      // warning ("sometimes can't vote" feedback). Fire an audible +
      // in-app cue exactly once, the instant the turn actually becomes
      // theirs (not on every GAME_STATE re-broadcast while it's still
      // their turn).
      if (
        s.phase === "DAY_VOTE" &&
        s.dayVoteCurrentVoterId &&
        s.dayVoteCurrentVoterId === stored!.playerId &&
        s.dayVoteCurrentVoterId !== prevDayVoteVoterRef.current
      ) {
        playYourTurnChime(soundEnabledRef.current);
        setNotifications((prev) => [
          ...prev.slice(-4),
          { type: "INFO", message: "🗳️ C'est votre tour de voter !" },
        ]);
      }
      prevDayVoteVoterRef.current = s.dayVoteCurrentVoterId ?? null;
    });
    socket.on(SOCKET_EVENTS.ROLE_ASSIGNED, (payload: RoleAssignedPayload) => {
      // A role change mid-game (currently only: Loup Vert stealing this
      // player's power on night 2+, which instantly demotes them to
      // VILLAGEOIS) means any night prompt already on screen was built for
      // a power this player no longer has — drop it immediately instead of
      // leaving a stale "heal/poison/inspect" UI up that would just error
      // out if they tried to use it.
      if (prevRoleRef.current !== null && prevRoleRef.current !== payload.roleId) {
        setPrompt(null);
      }
      prevRoleRef.current = payload.roleId;
      setRole(payload.roleId);
      setWolfTeammates(payload.wolfTeammates ?? []);
    });
    socket.on(SOCKET_EVENTS.NIGHT_PROMPT, (payload: NightPromptPayload) => setPrompt(payload));
    socket.on(SOCKET_EVENTS.NIGHT_STEP_STATE, (payload: NightStepStatePayload) => setNightStepState(payload));
    socket.on(SOCKET_EVENTS.LOUP_VERT_GUESS_PROMPT, (payload: LoupVertGuessPromptPayload) =>
      setLoupVertGuessPrompt(payload),
    );
    socket.on(SOCKET_EVENTS.LOUP_VERT_STOLEN_POWER_PROMPT, (payload: NightPromptPayload) =>
      setLoupVertStolenPrompt(payload),
    );
    socket.on(SOCKET_EVENTS.PRIVATE_ROLE_STATE, (payload: PrivateRoleStatePayload) =>
      setPrivateRoleState(payload),
    );
    socket.on(SOCKET_EVENTS.BARBIE_REVEAL_RESULT, (payload: BarbieRevealResultPayload) =>
      setBarbieReveal(payload),
    );
    socket.on(SOCKET_EVENTS.CHASSEUR_PROMPT, (payload: { eligibleTargetIds: string[] }) =>
      setChasseurTargets(payload.eligibleTargetIds),
    );
    socket.on(SOCKET_EVENTS.CHEF_SUCCESSION_PROMPT, (payload: { eligibleSuccessorIds: string[] }) =>
      setChefSuccessionTargets(payload.eligibleSuccessorIds),
    );
    socket.on(SOCKET_EVENTS.WOLF_ROOM_STATE, (payload: WolfRoomStatePayload) => setWolfRoom(payload));
    socket.on(SOCKET_EVENTS.WOLF_CHAT_MESSAGE, (payload: WolfChatMessagePayload) =>
      setWolfMessages((prev) => [...prev, payload]),
    );
    socket.on(SOCKET_EVENTS.AFTERLIFE_ROOM_STATE, (payload: AfterlifeRoomStatePayload) =>
      setAfterlifeRoom(payload),
    );
    socket.on(SOCKET_EVENTS.AFTERLIFE_CHAT_MESSAGE, (payload: AfterlifeChatMessagePayload) =>
      setAfterlifeMessages((prev) => [...prev, payload]),
    );
    socket.on(SOCKET_EVENTS.NOTIFICATION, (payload: NotificationPayload) =>
      setNotifications((prev) => [...prev.slice(-4), payload]),
    );
    // Server-side idle/abandoned sweep (see socket/idleCleanup.ts) just
    // purged this game entirely — nothing left to reconnect to. Reuses the
    // same full-screen `error` state as a failed reconnect, since the
    // outcome for this tab is identical either way: show why, offer a way
    // back to /join.
    socket.on(SOCKET_EVENTS.GAME_CLOSED, (payload: { message: string }) => {
      setError(payload.message);
    });
    socket.on(SOCKET_EVENTS.GAME_ENDED, (payload: { stats: EndGameStats }) => {
      setEndStats(payload.stats);
      // Fresh game, fresh MVP vote - clear any leftover state from a
      // previous game this same tab might have shown (shouldn't normally
      // happen, but costs nothing to guard against).
      setMvpState(null);
      setMvpResult(null);
      playVictoryFanfare(soundEnabledRef.current, payload.stats.winner);
    });
    socket.on(SOCKET_EVENTS.MVP_STATE, (payload: MvpStatePayload) => setMvpState(payload));
    socket.on(SOCKET_EVENTS.MVP_RESULT, (payload: MvpResultPayload) => setMvpResult(payload));
    // Instant replay (see EndGamePanel): every OTHER carried-over player
    // gets pushed their new identity here — the host who actually clicked
    // replay gets theirs directly from the REPLAY_REQUEST ack instead, see
    // EndGamePanel's own handler, so this only ever fires for passengers.
    socket.on(SOCKET_EVENTS.REPLAY_STARTED, (payload: ReplayStartedPayload) => {
      savePlayerSession({
        gameCode: payload.gameCode,
        playerId: payload.playerId,
        reconnectToken: payload.reconnectToken,
        nickname: stored!.nickname,
      });
      router.replace(`/play/${payload.gameCode}`);
    });

    return () => {
      socket.off("connect", reconnect);
      socket.off(SOCKET_EVENTS.GAME_STATE);
      socket.off(SOCKET_EVENTS.ROLE_ASSIGNED);
      socket.off(SOCKET_EVENTS.NIGHT_PROMPT);
      socket.off(SOCKET_EVENTS.NIGHT_STEP_STATE);
      socket.off(SOCKET_EVENTS.LOUP_VERT_GUESS_PROMPT);
      socket.off(SOCKET_EVENTS.LOUP_VERT_STOLEN_POWER_PROMPT);
      socket.off(SOCKET_EVENTS.PRIVATE_ROLE_STATE);
      socket.off(SOCKET_EVENTS.BARBIE_REVEAL_RESULT);
      socket.off(SOCKET_EVENTS.CHASSEUR_PROMPT);
      socket.off(SOCKET_EVENTS.CHEF_SUCCESSION_PROMPT);
      socket.off(SOCKET_EVENTS.WOLF_ROOM_STATE);
      socket.off(SOCKET_EVENTS.WOLF_CHAT_MESSAGE);
      socket.off(SOCKET_EVENTS.AFTERLIFE_ROOM_STATE);
      socket.off(SOCKET_EVENTS.AFTERLIFE_CHAT_MESSAGE);
      socket.off(SOCKET_EVENTS.NOTIFICATION);
      socket.off(SOCKET_EVENTS.GAME_CLOSED);
      socket.off(SOCKET_EVENTS.GAME_ENDED);
      socket.off(SOCKET_EVENTS.MVP_STATE);
      socket.off(SOCKET_EVENTS.MVP_RESULT);
      socket.off(SOCKET_EVENTS.REPLAY_STARTED);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // Don't let an armed-but-unconfirmed "skip phase" button linger once the
  // phase actually changes underneath it (timer fired, someone else acted).
  useEffect(() => {
    setConfirmingChefSkip(false);
  }, [state?.phase]);

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center text-center px-6">
        <div>
          <p className="text-blood-300 mb-4">{error}</p>
          <a className="btn-secondary" href="/join">
            Retour
          </a>
        </div>
      </main>
    );
  }

  if (!session || !state) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-night-100/60 animate-pulse-slow">Connexion à la partie…</p>
      </main>
    );
  }

  const me = state.players.find((p) => p.id === session.playerId);

  return (
    <main className="min-h-screen px-4 py-6 max-w-3xl mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs text-night-600 uppercase tracking-wide">Partie {state.code}</p>
          <h1 className="font-display text-xl text-gold-300 flex items-center gap-2 flex-wrap">
            {me?.isChef && "👑 "}
            {session.nickname}
            {!me?.isAlive && " (spectateur)"}
            {/* Persistent role badge: always visible from the moment the role
                is assigned, regardless of phase, so anyone who was AFK when
                the game started (or reconnects mid-game) can still check
                their own role at any time instead of relying on catching a
                one-time reveal moment. */}
            {role && (
              <button
                type="button"
                onClick={() => setShowRoleDetail((v) => !v)}
                className="flex items-center gap-1 rounded-full border border-gold-400/40 bg-night-800/80 px-2 py-0.5 text-xs font-normal text-gold-300 hover:border-gold-400/70"
                title="Voir mon rôle"
              >
                <span>{ROLE_EMOJI[role]}</span>
                <span>{ROLE_METADATA[role].displayName}</span>
              </button>
            )}
          </h1>
        </div>
        <CountdownTimer endsAt={state.phaseEndsAt} />
      </header>

      {role && showRoleDetail && (
        <div onClick={() => setShowRoleDetail(false)} className="cursor-pointer">
          <RoleCard roleId={role} compact teammates={wolfTeammates} />
        </div>
      )}

      {/* Chef's own manual "skip to next phase" — a self-serve equivalent of
          the admin's skip button, scoped live to whoever currently holds
          state.chefId (so it correctly transfers on succession and
          disappears the instant the Chef dies). Excluded from LOBBY/ENDED
          (nothing to skip). */}
      {me?.isAlive &&
        state.chefId === me.id &&
        state.phase !== "LOBBY" &&
        state.phase !== "ENDED" && (
          <div className="flex justify-center items-center gap-2">
            {!confirmingChefSkip ? (
              <button
                type="button"
                onClick={() => setConfirmingChefSkip(true)}
                className="btn-secondary text-xs px-3 py-1.5"
              >
                👑 Passer à la phase suivante
              </button>
            ) : (
              <>
                <span className="text-xs text-night-100/70">
                  Faire avancer la partie pour tout le monde ?
                </span>
                <button
                  type="button"
                  className="btn-primary text-xs px-3 py-1.5"
                  onClick={async () => {
                    setConfirmingChefSkip(false);
                    const { emitWithAck } = await import("@/lib/socket");
                    try {
                      await emitWithAck(SOCKET_EVENTS.CHEF_FORCE_NEXT_PHASE, {});
                    } catch (err) {
                      setNotifications((prev) => [
                        ...prev.slice(-4),
                        {
                          type: "INFO",
                          message: err instanceof Error ? err.message : "Action impossible pour le moment.",
                        },
                      ]);
                    }
                  }}
                >
                  Confirmer
                </button>
                <button
                  type="button"
                  className="btn-secondary text-xs px-3 py-1.5"
                  onClick={() => setConfirmingChefSkip(false)}
                >
                  Annuler
                </button>
              </>
            )}
          </div>
        )}

      {notifications.length > 0 && (
        <div className="space-y-1">
          {notifications.map((n, i) => (
            <div key={i} className="text-xs text-center text-gold-300/80 animate-fade-in">
              {n.message}
            </div>
          ))}
        </div>
      )}

      {barbieReveal && <BarbieRevealOverlay result={barbieReveal} onDone={() => setBarbieReveal(null)} />}

      {/* Cahier de charge #2 §17.3 — persistent across every phase (unlike
          the wolf room, which only ever appears inside the NIGHT case
          below): once dead, a player keeps this chat available for the
          rest of the game, on top of whatever phase-specific view they're
          also seeing (read-only from here on — the "(spectateur)" label
          next to their name above already reflects this). Withheld while a
          death-triggered action is still pending (Chasseur's revenge shot,
          Chef succession) — Afterlife's allPlayers payload includes every
          real roleId, so a Chasseur must finish choosing his target BEFORE
          seeing that, not while/before he decides. */}
      {!me?.isAlive && afterlifeRoom && !chasseurTargets && !chefSuccessionTargets && (
        <AfterlifeChat room={afterlifeRoom} messages={afterlifeMessages} />
      )}

      {/* Feature 7 — private, server-synced notes, available to every
          player through every phase of the whole game. Hidden once the
          game's ended: the server purges notes right at GAME_ENDED, so
          there's nothing left to jot down or read at that point. */}
      {!endStats && <NotesButton />}

      {endStats ? (
        <EndGamePanel
          stats={endStats}
          myPlayerId={session.playerId}
          mvpState={mvpState}
          mvpResult={mvpResult}
          gameCode={code}
          hostToken={hostToken}
        />
      ) : (
        <PhaseView
          key={state.phase}
          state={state}
          me={me ?? null}
          role={role}
          wolfTeammates={wolfTeammates}
          prompt={prompt}
          nightStepState={nightStepState}
          loupVertGuessPrompt={loupVertGuessPrompt}
          loupVertStolenPrompt={loupVertStolenPrompt}
          privateRoleState={privateRoleState}
          chasseurTargets={chasseurTargets}
          chefSuccessionTargets={chefSuccessionTargets}
          wolfRoom={wolfRoom}
          wolfMessages={wolfMessages}
          onClearPrompt={() => setPrompt(null)}
          onClearLoupVertGuess={() => setLoupVertGuessPrompt(null)}
          onClearLoupVertStolen={() => setLoupVertStolenPrompt(null)}
          onClearChasseur={() => setChasseurTargets(null)}
          onClearChefSuccession={() => setChefSuccessionTargets(null)}
        />
      )}
    </main>
  );
}

function PhaseView({
  state,
  me,
  role,
  wolfTeammates,
  prompt,
  nightStepState,
  loupVertGuessPrompt,
  loupVertStolenPrompt,
  privateRoleState,
  chasseurTargets,
  chefSuccessionTargets,
  wolfRoom,
  wolfMessages,
  onClearPrompt,
  onClearLoupVertGuess,
  onClearLoupVertStolen,
  onClearChasseur,
  onClearChefSuccession,
}: {
  state: GameStatePublic;
  me: GameStatePublic["players"][number] | null;
  role: RoleId | null;
  wolfTeammates: { id: string; nickname: string }[];
  prompt: NightPromptPayload | null;
  nightStepState: NightStepStatePayload | null;
  loupVertGuessPrompt: LoupVertGuessPromptPayload | null;
  loupVertStolenPrompt: NightPromptPayload | null;
  privateRoleState: PrivateRoleStatePayload;
  chasseurTargets: string[] | null;
  chefSuccessionTargets: string[] | null;
  wolfRoom: WolfRoomStatePayload | null;
  wolfMessages: WolfChatMessagePayload[];
  onClearPrompt: () => void;
  onClearLoupVertGuess: () => void;
  onClearLoupVertStolen: () => void;
  onClearChasseur: () => void;
  onClearChefSuccession: () => void;
}) {
  // Reset whenever the phase changes (the parent remounts this component
  // with a `key={state.phase}`, but keeping this here too is cheap and
  // makes the intent obvious).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmingAlienNightfall, setConfirmingAlienNightfall] = useState(false);
  const [dayVoteError, setDayVoteError] = useState<string | null>(null);

  if (chasseurTargets) {
    return (
      <section className="card">
        <h2 className="font-display text-lg text-blood-300 mb-3">🏹 Vous êtes mort(e) — Chasseur</h2>
        <p className="text-sm text-night-100/80 mb-3">Choisissez un joueur à emporter avec vous.</p>
        <PlayerList
          players={state.players.filter((p) => chasseurTargets.includes(p.id))}
          selectable
          selectedId={selectedId}
          onSelect={async (targetId) => {
            setSelectedId(targetId);
            const { emitWithAck } = await import("@/lib/socket");
            await emitWithAck(SOCKET_EVENTS.CHASSEUR_SHOOT, { targetId });
            onClearChasseur();
          }}
        />
      </section>
    );
  }

  if (chefSuccessionTargets) {
    return (
      <section className="card">
        <h2 className="font-display text-lg text-gold-300 mb-3">👑 Vous étiez Chef du village</h2>
        <p className="text-sm text-night-100/80 mb-3">
          Avant de vous éteindre, désignez votre successeur à la tête du village.
        </p>
        <PlayerList
          players={state.players.filter((p) => chefSuccessionTargets.includes(p.id))}
          selectable
          selectedId={selectedId}
          onSelect={async (successorId) => {
            setSelectedId(successorId);
            const { emitWithAck } = await import("@/lib/socket");
            await emitWithAck(SOCKET_EVENTS.CHEF_SUCCESSION_CHOOSE, { successorId });
            onClearChefSuccession();
          }}
        />
      </section>
    );
  }

  switch (state.phase) {
    case "LOBBY":
      return (
        <section className="card text-center space-y-3">
          <p className="font-display text-lg">En attente du Maître du Jeu…</p>
          <p className="text-sm text-night-100/60">{state.players.length} joueur(s) dans le lobby</p>
          <PlayerList players={state.players} />
        </section>
      );

    case "CHEF_CANDIDACY":
      return (
        <section className="card space-y-3">
          <h2 className="font-display text-lg text-gold-300">Élection du Chef du village</h2>
          {role && <RoleCard roleId={role} compact teammates={wolfTeammates} />}
          <p className="text-sm text-night-100/70">
            {state.candidates.length}/3 candidats. {me?.isAlive ? "" : "Vous êtes éliminé(e)."}
          </p>
          {me?.isAlive && !state.candidates.includes(me.id) && state.candidates.length < 3 && (
            <button
              className="btn-primary w-full"
              onClick={async () => {
                const { emitWithAck } = await import("@/lib/socket");
                await emitWithAck(SOCKET_EVENTS.CHEF_VOLUNTEER, { playerId: me.id });
              }}
            >
              Se présenter comme Chef du village
            </button>
          )}
          <PlayerList players={state.players} highlightId={null} />
        </section>
      );

    case "CHEF_DEBATE": {
      const speaker = state.players.find((p) => p.id === state.currentSpeakerId);
      const isMyTurn = Boolean(me?.isAlive) && me?.id === state.currentSpeakerId;
      return (
        <section className="card space-y-3">
          <h2 className="font-display text-lg text-gold-300">Débat des candidats</h2>
          <p className="text-sm text-night-100/80">
            C&apos;est au tour de <strong className="text-gold-300">{speaker?.nickname ?? "…"}</strong> de
            s&apos;exprimer.
          </p>
          {isMyTurn && (
            <button
              className="btn-primary w-full"
              onClick={async () => {
                const { emitWithAck } = await import("@/lib/socket");
                await emitWithAck(SOCKET_EVENTS.CHEF_DEBATE_PASS_TURN, {});
              }}
            >
              Passer la parole
            </button>
          )}
          <ul className="space-y-1">
            {state.candidates.map((id) => {
              const c = state.players.find((p) => p.id === id);
              return (
                <li
                  key={id}
                  className={`px-3 py-2 rounded-lg border ${
                    id === state.currentSpeakerId
                      ? "border-gold-400 bg-gold-400/10 text-gold-300"
                      : "border-night-700 text-night-100/70"
                  }`}
                >
                  {c?.nickname}
                </li>
              );
            })}
          </ul>
        </section>
      );
    }

    case "CHEF_VOTE": {
      const iAmCandidate = me ? state.candidates.includes(me.id) : false;
      const candidatesList = state.players.filter((p) => state.candidates.includes(p.id));
      return (
        <section className="card space-y-3">
          <h2 className="font-display text-lg text-gold-300">Vote — Chef du village</h2>
          <p className="text-xs text-night-100/60 text-center">
            {iAmCandidate
              ? "Les candidats ne votent pas — voici le décompte en direct."
              : "Vote à main levée — touchez un candidat, puis touchez à nouveau pour confirmer."}
          </p>
          <LiveVoteList
            candidates={candidatesList}
            allPlayers={state.players}
            dayVotes={state.chefVotes}
            dayVoteTally={state.chefVoteTally}
            myId={me?.id ?? null}
            interactive={Boolean(me?.isAlive) && !iAmCandidate}
            onSelect={async (candidateId) => {
              const { emitWithAck } = await import("@/lib/socket");
              await emitWithAck(SOCKET_EVENTS.CHEF_VOTE_CAST, { candidateId });
            }}
          />
        </section>
      );
    }

    case "CHEF_REVEAL": {
      const chef = state.players.find((p) => p.isChef);
      return (
        <section className="card text-center py-10 animate-fade-in space-y-4">
          <p className="text-4xl">👑</p>
          <p className="font-display text-xl text-gold-300">
            {chef ? <>{chef.nickname} est élu(e) Chef du village !</> : "Un Chef du village a été désigné."}
          </p>
        </section>
      );
    }

    case "DAY_1_DISCUSSION":
    case "DAY_DISCUSSION": {
      const order = state.dayDiscussionOrder ?? [];
      const currentId = state.dayDiscussionCurrentSpeakerId;
      const currentIndex = currentId ? order.indexOf(currentId) : -1;
      const speaker = state.players.find((p) => p.id === currentId);
      const isMyTurn = Boolean(me?.isAlive) && me?.id === currentId;

      const canUseBarbie =
        role === "BARBIE" && Boolean(me?.isAlive) && Boolean(privateRoleState.barbiePowerAvailable);

      // The Alien alone sees this — his ability to cut discussion short and
      // force night to fall is completely invisible to everyone else at the
      // table, both before and after he uses it (see GameEngine.
      // triggerAlienNightfall's doc comment).
      const canForceNightfall = role === "ALIEN" && Boolean(privateRoleState.alienCanForceNightfall);

      return (
        <section className="space-y-4">
          {canUseBarbie && me && (
            <BarbiePowerPanel
              players={state.players}
              myId={me.id}
              onUse={async (targetId) => {
                const { emitWithAck } = await import("@/lib/socket");
                await emitWithAck(SOCKET_EVENTS.BARBIE_REVEAL_SUBMIT, { targetId });
              }}
            />
          )}
          {canForceNightfall && (
            <div className="card text-center space-y-2 border-2 border-purple-500/40">
              {!confirmingAlienNightfall ? (
                <button
                  type="button"
                  className="btn-secondary text-sm w-full"
                  onClick={() => setConfirmingAlienNightfall(true)}
                >
                  👽 Faire tomber la nuit
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-night-100/70">
                    Interrompre le débat et faire tomber la nuit maintenant, en secret ?
                  </p>
                  <div className="flex justify-center gap-2">
                    <button
                      type="button"
                      className="btn-primary text-xs px-3 py-1.5"
                      onClick={async () => {
                        setConfirmingAlienNightfall(false);
                        const { emitWithAck } = await import("@/lib/socket");
                        await emitWithAck(SOCKET_EVENTS.ALIEN_FORCE_NIGHTFALL, {});
                      }}
                    >
                      Confirmer
                    </button>
                    <button
                      type="button"
                      className="btn-secondary text-xs px-3 py-1.5"
                      onClick={() => setConfirmingAlienNightfall(false)}
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="card text-center space-y-4">
          <h2 className="font-display text-lg text-gold-300">☀️ Discussion</h2>

          {speaker && (
            <div className="py-4 animate-fade-in" key={`${speaker.id}-${currentIndex}`}>
              <p className="text-xs text-night-100/60 uppercase tracking-wide mb-1">A la parole</p>
              <p className="font-display text-2xl text-gold-300">
                {speaker.isChef && "👑 "}
                {speaker.nickname}
              </p>
            </div>
          )}

          {isMyTurn && (
            <button
              className="btn-primary w-full"
              onClick={async () => {
                const { emitWithAck } = await import("@/lib/socket");
                await emitWithAck(SOCKET_EVENTS.DAY_DISCUSSION_PASS_TURN, {});
              }}
            >
              Passer la parole
            </button>
          )}

          <p className="text-xs text-night-100/50">
            {isMyTurn
              ? "C'est votre tour — parlez, puis passez la parole quand vous avez terminé."
              : "Débattez à voix haute pendant le tour de chacun."}
          </p>

          <ul className="space-y-1 text-left">
            {order.map((id, i) => {
              const p = state.players.find((pl) => pl.id === id);
              if (!p) return null;
              const status = i < currentIndex ? "done" : i === currentIndex ? "current" : "upcoming";
              return (
                <li
                  key={`${id}-${i}`}
                  className={`px-3 py-2 rounded-lg border flex items-center justify-between text-sm ${
                    status === "current"
                      ? "border-gold-400 bg-gold-400/10 text-gold-300"
                      : status === "done"
                        ? "border-night-800 text-night-100/30 line-through"
                        : "border-night-700 text-night-100/70"
                  }`}
                >
                  <span>
                    {p.isChef && "👑 "}
                    {p.nickname}
                  </span>
                  {status === "current" && <span className="text-xs">●</span>}
                </li>
              );
            })}
          </ul>
          </div>
        </section>
      );
    }

    case "NIGHT":
      return (
        <section className="space-y-4">
          <section className="card text-center space-y-2">
            <h2 className="font-display text-lg text-gold-300">🌙 Nuit {state.nightNumber}</h2>
            {/* Cahier de charge #2 §17.1 — SEQUENTIAL night mode only:
                nightStepState is null all game for a game that never
                opted in (see GameEngine.isSequentialNightMode()), so the
                original "Le village dort…" behavior is completely
                unchanged for every SIMULTANEOUS game. */}
            {nightStepState?.currentStepRoleIds ? (
              // key={stepIndex} re-triggers animate-fade-in on every step
              // change, not just once — the "🌙 La nuit tombe..." /
              // "🛡️ Le Salvateur se réveille" mise en scène from cahier de
              // charge #2 §17.2. Purely presentation: no server request is
              // made here, this just reacts to the NIGHT_STEP_STATE this
              // component already listens for.
              <div key={nightStepState.stepIndex} className="space-y-2 animate-fade-in">
                {nightStepState.stepIndex === 1 && (
                  <p className="text-sm text-night-100/50 italic">🌙 La nuit tombe sur le village…</p>
                )}
                <p className="text-xs text-night-600 uppercase tracking-wide">
                  Étape {nightStepState.stepIndex} / {nightStepState.totalSteps}
                </p>
                <p className="text-sm text-night-100/70">
                  {prompt ? "C'est votre tour…" : describeNightStep(nightStepState.currentStepRoleIds)}
                </p>
                <div className="flex justify-center">
                  <CountdownTimer endsAt={nightStepState.stepDeadlineAt} />
                </div>
              </div>
            ) : (
              !prompt && <p className="text-sm text-night-100/60 mt-2">Le village dort…</p>
            )}
          </section>
          {prompt && (
            <section className="card">
              <NightPromptPanel
                prompt={prompt}
                players={state.players}
                wolfRoom={wolfRoom}
                onPreview={(targetId) => {
                  // Fire-and-forget, real-time, every selection change —
                  // not worth an ack round trip or an error toast if one
                  // ever drops (see WolfTargetPreviewPayload's doc
                  // comment: purely a UI courtesy, never game logic).
                  void import("@/lib/socket").then(({ emitWithAck }) =>
                    emitWithAck(SOCKET_EVENTS.WOLF_TARGET_PREVIEW, { targetId }).catch(() => {}),
                  );
                }}
                onSubmit={async (actionType, targetId, guessedRoleId) => {
                  const { emitWithAck } = await import("@/lib/socket");
                  await emitWithAck(SOCKET_EVENTS.NIGHT_ACTION_SUBMIT, { actionType, targetId, guessedRoleId });
                  onClearPrompt();
                }}
              />
            </section>
          )}
          {/* Loup Vert's two extra, independent night actions — separate
              side-channel prompts, both possibly showing alongside his
              normal pack KILL_VOTE prompt above. Nobody but him ever sees
              these components. */}
          {loupVertGuessPrompt && (
            <LoupVertGuessPanel
              prompt={loupVertGuessPrompt}
              players={state.players}
              onSubmit={async (targetId, guessedRoleId) => {
                const { emitWithAck } = await import("@/lib/socket");
                await emitWithAck(SOCKET_EVENTS.LOUP_VERT_GUESS_SUBMIT, { targetId, guessedRoleId });
                onClearLoupVertGuess();
              }}
            />
          )}
          {loupVertStolenPrompt && (
            <section className="card border-2 border-blood-500/40">
              <h3 className="font-display text-blood-300 mb-2">🐺 Pouvoir emprunté</h3>
              <NightPromptPanel
                prompt={loupVertStolenPrompt}
                players={state.players}
                onSubmit={async (actionType, targetId) => {
                  const { emitWithAck } = await import("@/lib/socket");
                  await emitWithAck(SOCKET_EVENTS.LOUP_VERT_STOLEN_POWER_SUBMIT, { actionType, targetId });
                  onClearLoupVertStolen();
                }}
              />
            </section>
          )}
          {wolfRoom && <WolfChat room={wolfRoom} messages={wolfMessages} />}
        </section>
      );

    case "MORNING":
      return (
        <section className="card text-center py-10 animate-fade-in space-y-4">
          <p className="text-4xl">{state.lastMorningAnnouncement === "DEATH" ? "🔔" : "🐓"}</p>
          <p className="font-display text-xl text-gold-300">
            {state.lastMorningAnnouncement === "DEATH"
              ? "Quelqu'un est mort cette nuit."
              : "Personne n'est mort cette nuit."}
          </p>
          {state.lastDeaths.length > 0 && (
            <ul className="space-y-2">
              {state.lastDeaths.map((d) => (
                <li key={d.playerId} className="text-sm text-night-100/90">
                  <strong className="text-blood-300">{d.nickname}</strong> était{" "}
                  <span className="text-gold-300">{ROLE_METADATA[d.roleId].displayName}</span>.
                </li>
              ))}
            </ul>
          )}
        </section>
      );

    case "DAY_VOTE_RESULT":
      return (
        <section className="card text-center py-10 animate-fade-in space-y-4">
          <p className="text-4xl">{state.lastDeaths.length > 0 ? "⚰️" : "🕊️"}</p>
          <p className="font-display text-xl text-gold-300">
            {state.lastDeaths.length > 0
              ? "Le village a tranché."
              : "Personne n'a été banni(e) du village."}
          </p>
          {state.lastDeaths.length > 0 && (
            <ul className="space-y-2">
              {state.lastDeaths.map((d) => (
                <li key={d.playerId} className="text-sm text-night-100/90">
                  <strong className="text-blood-300">{d.nickname}</strong> était{" "}
                  <span className="text-gold-300">{ROLE_METADATA[d.roleId].displayName}</span>.
                </li>
              ))}
            </ul>
          )}
        </section>
      );

    case "TIE_DEFENSE": {
      const order = state.tieDefenseOrder ?? [];
      const currentId = state.tieDefenseCurrentSpeakerId;
      const currentIndex = currentId ? order.indexOf(currentId) : -1;
      const speaker = state.players.find((p) => p.id === currentId);
      const isMyTurn = Boolean(me?.isAlive) && me?.id === currentId;

      return (
        <section className="card text-center space-y-4">
          <h2 className="font-display text-lg text-blood-300">⚖️ Égalité ! Les accusés se défendent</h2>

          {speaker && (
            <div className="py-4 animate-fade-in" key={`${speaker.id}-${currentIndex}`}>
              <p className="text-xs text-night-100/60 uppercase tracking-wide mb-1">Se défend</p>
              <p className="font-display text-2xl text-gold-300">
                {speaker.isChef && "👑 "}
                {speaker.nickname}
              </p>
            </div>
          )}

          {isMyTurn && (
            <button
              className="btn-primary w-full"
              onClick={async () => {
                const { emitWithAck } = await import("@/lib/socket");
                await emitWithAck(SOCKET_EVENTS.TIE_DEFENSE_PASS_TURN, {});
              }}
            >
              Passer la parole
            </button>
          )}

          <p className="text-xs text-night-100/50">
            {isMyTurn
              ? "C'est votre tour — défendez-vous, puis passez la parole quand vous avez terminé."
              : "Chaque joueur à égalité se défend à tour de rôle avant le second vote."}
          </p>

          <ul className="space-y-1 text-left">
            {order.map((id, i) => {
              const p = state.players.find((pl) => pl.id === id);
              if (!p) return null;
              const status = i < currentIndex ? "done" : i === currentIndex ? "current" : "upcoming";
              return (
                <li
                  key={`${id}-${i}`}
                  className={`px-3 py-2 rounded-lg border flex items-center justify-between text-sm ${
                    status === "current"
                      ? "border-gold-400 bg-gold-400/10 text-gold-300"
                      : status === "done"
                        ? "border-night-800 text-night-100/30 line-through"
                        : "border-night-700 text-night-100/70"
                  }`}
                >
                  <span>
                    {p.isChef && "👑 "}
                    {p.nickname}
                  </span>
                  {status === "current" && <span className="text-xs">●</span>}
                </li>
              );
            })}
          </ul>
        </section>
      );
    }

    case "CHEF_SECOND_DEBATE": {
      const isChef = Boolean(me?.isAlive) && me?.id === state.chefId;

      if (state.secondDebateChoicePending) {
        if (isChef) {
          return <ChefSecondDebateChooser state={state} me={me!} />;
        }
        return (
          <section className="card text-center py-8 space-y-2 animate-fade-in">
            <p className="text-4xl">👑</p>
            <p className="font-display text-lg text-gold-300">
              Le Chef du village réfléchit à un second débat…
            </p>
            <p className="text-xs text-night-100/50">
              Il/elle peut accorder un temps de parole supplémentaire à quelques joueurs avant le vote.
            </p>
          </section>
        );
      }

      const order = state.secondDebateOrder ?? [];
      const currentId = state.secondDebateCurrentSpeakerId;
      const currentIndex = currentId ? order.indexOf(currentId) : -1;
      const speaker = state.players.find((p) => p.id === currentId);
      const isMyTurn = Boolean(me?.isAlive) && me?.id === currentId;

      if (order.length === 0) {
        return (
          <section className="card text-center py-8 animate-fade-in">
            <p className="text-sm text-night-100/60">Aucun second débat accordé — direction le vote…</p>
          </section>
        );
      }

      return (
        <section className="card text-center space-y-4">
          <h2 className="font-display text-lg text-gold-300">🎙️ Second débat</h2>
          {speaker && (
            <div className="py-4 animate-fade-in" key={`${speaker.id}-${currentIndex}`}>
              <p className="text-xs text-night-100/60 uppercase tracking-wide mb-1">
                Temps de parole supplémentaire accordé par le Chef à
              </p>
              <p className="font-display text-2xl text-gold-300">{speaker.nickname}</p>
            </div>
          )}
          {isMyTurn && (
            <button
              className="btn-primary w-full"
              onClick={async () => {
                const { emitWithAck } = await import("@/lib/socket");
                await emitWithAck(SOCKET_EVENTS.CHEF_SECOND_DEBATE_PASS_TURN, {});
              }}
            >
              Passer la parole
            </button>
          )}
          <ul className="space-y-1 text-left">
            {order.map((id, i) => {
              const p = state.players.find((pl) => pl.id === id);
              if (!p) return null;
              const status = i < currentIndex ? "done" : i === currentIndex ? "current" : "upcoming";
              return (
                <li
                  key={`${id}-${i}`}
                  className={`px-3 py-2 rounded-lg border flex items-center justify-between text-sm ${
                    status === "current"
                      ? "border-gold-400 bg-gold-400/10 text-gold-300"
                      : status === "done"
                        ? "border-night-800 text-night-100/30 line-through"
                        : "border-night-700 text-night-100/70"
                  }`}
                >
                  <span>{p.nickname}</span>
                  {status === "current" && <span className="text-xs">●</span>}
                </li>
              );
            })}
          </ul>
        </section>
      );
    }

    case "DAY_VOTE": {
      const votable =
        state.tiedPlayerIds.length > 0
          ? state.players.filter((p) => state.tiedPlayerIds.includes(p.id))
          : state.players;
      const order = state.dayVoteOrder ?? [];
      const currentId = state.dayVoteCurrentVoterId;
      const currentIndex = currentId ? order.indexOf(currentId) : -1;
      const currentVoter = state.players.find((p) => p.id === currentId);
      const isMyTurn = Boolean(me?.isAlive) && me?.id === currentId;

      return (
        <section
          className={`card space-y-3 ${isMyTurn ? "ring-2 ring-gold-400 animate-pulse-slow" : ""}`}
        >
          <h2 className="font-display text-lg text-gold-300">🗳️ Vote du village</h2>

          {currentVoter && (
            <div className="text-center py-2 animate-fade-in" key={`${currentVoter.id}-${currentIndex}`}>
              <p className="text-xs text-night-100/60 uppercase tracking-wide mb-1">C&apos;est au tour de</p>
              <p className="font-display text-xl text-gold-300">
                {currentVoter.isChef && "👑 "}
                {currentVoter.nickname}
              </p>
            </div>
          )}

          <p className="text-xs text-night-100/60 text-center">
            {isMyTurn
              ? "C'est votre tour — touchez un joueur, puis touchez à nouveau pour confirmer votre vote."
              : "Vote à main levée, un joueur à la fois. Tout le monde voit qui vote pour qui, en direct."}
          </p>
          {!me?.isAlive && <p className="text-xs text-night-100/60 text-center">Vous êtes spectateur(trice).</p>}

          {dayVoteError && <p className="text-xs text-blood-400 text-center">{dayVoteError}</p>}

          <LiveVoteList
            candidates={votable}
            allPlayers={state.players}
            dayVotes={state.dayVotes}
            dayVoteTally={state.dayVoteTally}
            myId={me?.id ?? null}
            interactive={isMyTurn}
            onSelect={async (targetId) => {
              setDayVoteError(null);
              try {
                const { emitWithAck } = await import("@/lib/socket");
                await emitWithAck(SOCKET_EVENTS.DAY_VOTE_CAST, { targetId });
              } catch (err) {
                // Previously silent: a rejected/dropped vote (stale turn
                // state, a network blip) left the player thinking they'd
                // voted with no feedback at all — the reported "sometimes
                // can't vote" behavior. Now it's visible and retryable.
                setDayVoteError(err instanceof Error ? err.message : "Échec de l'envoi du vote. Réessayez.");
              }
            }}
          />

          {order.length > 0 && (
            <ul className="space-y-1 text-left">
              {order.map((id, i) => {
                const p = state.players.find((pl) => pl.id === id);
                if (!p) return null;
                const status = i < currentIndex ? "done" : i === currentIndex ? "current" : "upcoming";
                return (
                  <li
                    key={`${id}-${i}`}
                    className={`px-3 py-2 rounded-lg border flex items-center justify-between text-sm ${
                      status === "current"
                        ? "border-gold-400 bg-gold-400/10 text-gold-300"
                        : status === "done"
                          ? "border-night-800 text-night-100/30 line-through"
                          : "border-night-700 text-night-100/70"
                    }`}
                  >
                    <span>
                      {p.isChef && "👑 "}
                      {p.nickname}
                    </span>
                    {status === "current" && <span className="text-xs">●</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      );
    }

    case "ENDED":
      return (
        <section className="card text-center">
          <p className="font-display text-xl text-gold-300">Partie terminée</p>
        </section>
      );

    default:
      return null;
  }
}

/**
 * The Chef's picker for CHEF_SECOND_DEBATE: choose up to `secondDebateSlots`
 * players (or nobody) to receive one bonus speaking turn before the vote
 * opens. Multi-select, capped client-side to match the server's own limit
 * (see GameEngine.chooseSecondDebateSpeakers).
 */
function ChefSecondDebateChooser({
  state,
  me,
}: {
  state: GameStatePublic;
  me: GameStatePublic["players"][number];
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const eligible = state.players.filter((p) => p.isAlive && p.id !== me.id);
  const max = state.secondDebateSlots;

  function toggle(id: string) {
    setPicked((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= max) return prev;
      return [...prev, id];
    });
  }

  async function submit(playerIds: string[]) {
    setBusy(true);
    try {
      const { emitWithAck } = await import("@/lib/socket");
      await emitWithAck(SOCKET_EVENTS.CHEF_SECOND_DEBATE_CHOOSE, { playerIds });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-3">
      <h2 className="font-display text-lg text-gold-300">👑 Second débat (facultatif)</h2>
      <p className="text-sm text-night-100/70">
        Vous pouvez accorder un temps de parole supplémentaire à{" "}
        <strong className="text-gold-300">
          {max} joueur{max > 1 ? "s" : ""}
        </strong>{" "}
        au maximum avant le vote — ou à personne.
      </p>
      <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {eligible.map((p) => {
          const isPicked = picked.includes(p.id);
          const disabled = !isPicked && picked.length >= max;
          return (
            <li
              key={p.id}
              onClick={() => !disabled && toggle(p.id)}
              className={[
                "rounded-lg border px-3 py-2 text-sm transition",
                isPicked
                  ? "border-blood-400 bg-blood-500/20 cursor-pointer"
                  : disabled
                    ? "border-night-800 bg-night-900/40 opacity-40"
                    : "border-night-600 bg-night-800/70 cursor-pointer hover:border-gold-400/60",
              ].join(" ")}
            >
              {p.isChef && "👑 "}
              {p.nickname}
            </li>
          );
        })}
      </ul>
      {picked.length > 0 && (
        <p className="text-xs text-night-100/60">
          Sélectionné(s) :{" "}
          {picked
            .map((id) => state.players.find((p) => p.id === id)?.nickname ?? "?")
            .join(", ")}{" "}
          ({picked.length}/{max})
        </p>
      )}
      <div className="flex gap-2">
        <button className="btn-primary flex-1" disabled={busy} onClick={() => submit(picked)}>
          Confirmer{picked.length > 0 ? ` (${picked.length})` : ""}
        </button>
        <button className="btn-secondary" disabled={busy} onClick={() => submit([])}>
          Personne
        </button>
      </div>
    </section>
  );
}
