"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ROLE_METADATA,
  SOCKET_EVENTS,
  type EndGameStats,
  type GameStatePublic,
  type NightPromptPayload,
  type NotificationPayload,
  type RoleId,
  type WolfRoomStatePayload,
  type WolfChatMessagePayload,
} from "@loupgarou/shared";
import { emitWithAck, getSocket } from "@/lib/socket";
import { loadPlayerSession, type PlayerSession } from "@/lib/session";
import {
  playChefFanfare,
  playDeathBell,
  playMorningRooster,
  playNightHowl,
  playVictoryFanfare,
} from "@/lib/soundEffects";
import { RoleCard } from "@/components/RoleCard";
import { PlayerList } from "@/components/PlayerList";
import { CountdownTimer } from "@/components/CountdownTimer";
import { NightPromptPanel } from "@/components/NightPromptPanel";
import { LiveVoteList } from "@/components/LiveVoteList";
import { WolfChat } from "@/components/WolfChat";
import { EndGamePanel } from "@/components/EndGamePanel";

export default function PlayPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const code = params.code.toUpperCase();

  const [session, setSession] = useState<PlayerSession | null>(null);
  const [state, setState] = useState<GameStatePublic | null>(null);
  const [role, setRole] = useState<RoleId | null>(null);
  const [prompt, setPrompt] = useState<NightPromptPayload | null>(null);
  const [chasseurTargets, setChasseurTargets] = useState<string[] | null>(null);
  const [chefSuccessionTargets, setChefSuccessionTargets] = useState<string[] | null>(null);
  const [wolfRoom, setWolfRoom] = useState<WolfRoomStatePayload | null>(null);
  const [wolfMessages, setWolfMessages] = useState<WolfChatMessagePayload[]>([]);
  const [notifications, setNotifications] = useState<NotificationPayload[]>([]);
  const [endStats, setEndStats] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const announcedDeathsRef = useRef<string>("");
  const soundEnabledRef = useRef<boolean>(true);
  const prevPhaseRef = useRef<GameStatePublic["phase"] | null>(null);

  useEffect(() => {
    const stored = loadPlayerSession(code);
    if (!stored) {
      router.replace(`/join?code=${code}`);
      return;
    }
    setSession(stored);

    const socket = getSocket();

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
      if (s.phase !== "NIGHT") setPrompt(null);
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
    });
    socket.on(SOCKET_EVENTS.ROLE_ASSIGNED, (payload: { roleId: RoleId }) => setRole(payload.roleId));
    socket.on(SOCKET_EVENTS.NIGHT_PROMPT, (payload: NightPromptPayload) => setPrompt(payload));
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
    socket.on(SOCKET_EVENTS.NOTIFICATION, (payload: NotificationPayload) =>
      setNotifications((prev) => [...prev.slice(-4), payload]),
    );
    socket.on(SOCKET_EVENTS.GAME_ENDED, (payload: { stats: EndGameStats }) => {
      setEndStats(payload.stats);
      playVictoryFanfare(soundEnabledRef.current, payload.stats.winner);
    });

    return () => {
      socket.off("connect", reconnect);
      socket.off(SOCKET_EVENTS.GAME_STATE);
      socket.off(SOCKET_EVENTS.ROLE_ASSIGNED);
      socket.off(SOCKET_EVENTS.NIGHT_PROMPT);
      socket.off(SOCKET_EVENTS.CHASSEUR_PROMPT);
      socket.off(SOCKET_EVENTS.CHEF_SUCCESSION_PROMPT);
      socket.off(SOCKET_EVENTS.WOLF_ROOM_STATE);
      socket.off(SOCKET_EVENTS.WOLF_CHAT_MESSAGE);
      socket.off(SOCKET_EVENTS.NOTIFICATION);
      socket.off(SOCKET_EVENTS.GAME_ENDED);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

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
          <h1 className="font-display text-xl text-gold-300">
            {me?.isChef && "👑 "}
            {session.nickname}
            {!me?.isAlive && " (spectateur)"}
          </h1>
        </div>
        <CountdownTimer endsAt={state.phaseEndsAt} />
      </header>

      {notifications.length > 0 && (
        <div className="space-y-1">
          {notifications.map((n, i) => (
            <div key={i} className="text-xs text-center text-gold-300/80 animate-fade-in">
              {n.message}
            </div>
          ))}
        </div>
      )}

      {endStats ? (
        <EndGamePanel stats={endStats} />
      ) : (
        <PhaseView
          key={state.phase}
          state={state}
          me={me ?? null}
          role={role}
          prompt={prompt}
          chasseurTargets={chasseurTargets}
          chefSuccessionTargets={chefSuccessionTargets}
          wolfRoom={wolfRoom}
          wolfMessages={wolfMessages}
          onClearPrompt={() => setPrompt(null)}
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
  prompt,
  chasseurTargets,
  chefSuccessionTargets,
  wolfRoom,
  wolfMessages,
  onClearPrompt,
  onClearChasseur,
  onClearChefSuccession,
}: {
  state: GameStatePublic;
  me: GameStatePublic["players"][number] | null;
  role: RoleId | null;
  prompt: NightPromptPayload | null;
  chasseurTargets: string[] | null;
  chefSuccessionTargets: string[] | null;
  wolfRoom: WolfRoomStatePayload | null;
  wolfMessages: WolfChatMessagePayload[];
  onClearPrompt: () => void;
  onClearChasseur: () => void;
  onClearChefSuccession: () => void;
}) {
  // Reset whenever the phase changes (the parent remounts this component
  // with a `key={state.phase}`, but keeping this here too is cheap and
  // makes the intent obvious).
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
          {role && <RoleCard roleId={role} compact />}
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
      return (
        <section className="card space-y-3">
          <h2 className="font-display text-lg text-gold-300">Débat des candidats</h2>
          <p className="text-sm text-night-100/80">
            C&apos;est au tour de <strong className="text-gold-300">{speaker?.nickname ?? "…"}</strong> de
            s&apos;exprimer.
          </p>
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
      return (
        <section className="card space-y-3">
          <h2 className="font-display text-lg text-gold-300">Vote — Chef du village</h2>
          {iAmCandidate ? (
            <p className="text-sm text-night-100/70">Les candidats ne votent pas.</p>
          ) : (
            <>
              <PlayerList
                players={state.players.filter((p) => state.candidates.includes(p.id))}
                selectable
                selectedId={selectedId}
                onSelect={async (candidateId) => {
                  setSelectedId(candidateId);
                  const { emitWithAck } = await import("@/lib/socket");
                  await emitWithAck(SOCKET_EVENTS.CHEF_VOTE_CAST, { candidateId });
                }}
              />
              {selectedId && (
                <p className="text-xs text-gold-300/80 text-center">
                  Vous votez pour{" "}
                  <strong>{state.players.find((p) => p.id === selectedId)?.nickname}</strong>. Cliquez sur
                  un autre joueur pour changer.
                </p>
              )}
            </>
          )}
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

      return (
        <section className="card text-center space-y-4">
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
        </section>
      );
    }

    case "NIGHT":
      return (
        <section className="space-y-4">
          <section className="card text-center">
            <h2 className="font-display text-lg text-gold-300">🌙 Nuit {state.nightNumber}</h2>
            {!prompt && <p className="text-sm text-night-100/60 mt-2">Le village dort…</p>}
          </section>
          {prompt && (
            <section className="card">
              <NightPromptPanel
                prompt={prompt}
                players={state.players}
                onSubmit={async (actionType, targetId) => {
                  const { emitWithAck } = await import("@/lib/socket");
                  await emitWithAck(SOCKET_EVENTS.NIGHT_ACTION_SUBMIT, { actionType, targetId });
                  onClearPrompt();
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

    case "TIE_REVOTE":
      return (
        <section className="card text-center space-y-3 py-6">
          <h2 className="font-display text-lg text-blood-300">⚖️ Égalité persistante</h2>
          <p className="text-sm text-night-100/70">
            En attente d&apos;une décision (Chef du village ou Maître du Jeu) pour départager :
          </p>
          <PlayerList players={state.players.filter((p) => state.tiedPlayerIds.includes(p.id))} />
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

    case "DAY_VOTE": {
      const votable =
        state.tiedPlayerIds.length > 0
          ? state.players.filter((p) => state.tiedPlayerIds.includes(p.id))
          : state.players;
      return (
        <section className="card space-y-3">
          <h2 className="font-display text-lg text-gold-300">🗳️ Vote du village</h2>
          <p className="text-xs text-night-100/60 text-center">
            Vote à main levée — tout le monde voit qui vote pour qui, en direct.
          </p>
          {!me?.isAlive && <p className="text-xs text-night-100/60 text-center">Vous êtes spectateur(trice).</p>}
          <LiveVoteList
            candidates={votable}
            allPlayers={state.players}
            dayVotes={state.dayVotes}
            dayVoteTally={state.dayVoteTally}
            myId={me?.id ?? null}
            interactive={Boolean(me?.isAlive)}
            onSelect={async (targetId) => {
              const { emitWithAck } = await import("@/lib/socket");
              await emitWithAck(SOCKET_EVENTS.DAY_VOTE_CAST, { targetId });
            }}
          />
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
