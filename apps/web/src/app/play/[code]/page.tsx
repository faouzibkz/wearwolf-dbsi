"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  SOCKET_EVENTS,
  type GameStatePublic,
  type NightPromptPayload,
  type NotificationPayload,
  type RoleId,
  type WolfRoomStatePayload,
  type WolfChatMessagePayload,
} from "@loupgarou/shared";
import { emitWithAck, getSocket } from "@/lib/socket";
import { loadPlayerSession, type PlayerSession } from "@/lib/session";
import { RoleCard } from "@/components/RoleCard";
import { PlayerList } from "@/components/PlayerList";
import { CountdownTimer } from "@/components/CountdownTimer";
import { NightPromptPanel } from "@/components/NightPromptPanel";
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
  const [wolfRoom, setWolfRoom] = useState<WolfRoomStatePayload | null>(null);
  const [wolfMessages, setWolfMessages] = useState<WolfChatMessagePayload[]>([]);
  const [notifications, setNotifications] = useState<NotificationPayload[]>([]);
  const [endStats, setEndStats] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

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
    });
    socket.on(SOCKET_EVENTS.ROLE_ASSIGNED, (payload: { roleId: RoleId }) => setRole(payload.roleId));
    socket.on(SOCKET_EVENTS.NIGHT_PROMPT, (payload: NightPromptPayload) => setPrompt(payload));
    socket.on(SOCKET_EVENTS.CHASSEUR_PROMPT, (payload: { eligibleTargetIds: string[] }) =>
      setChasseurTargets(payload.eligibleTargetIds),
    );
    socket.on(SOCKET_EVENTS.WOLF_ROOM_STATE, (payload: WolfRoomStatePayload) => setWolfRoom(payload));
    socket.on(SOCKET_EVENTS.WOLF_CHAT_MESSAGE, (payload: WolfChatMessagePayload) =>
      setWolfMessages((prev) => [...prev, payload]),
    );
    socket.on(SOCKET_EVENTS.NOTIFICATION, (payload: NotificationPayload) =>
      setNotifications((prev) => [...prev.slice(-4), payload]),
    );
    socket.on(SOCKET_EVENTS.GAME_ENDED, (payload: { stats: unknown }) => setEndStats(payload.stats));

    return () => {
      socket.off("connect", reconnect);
      socket.off(SOCKET_EVENTS.GAME_STATE);
      socket.off(SOCKET_EVENTS.ROLE_ASSIGNED);
      socket.off(SOCKET_EVENTS.NIGHT_PROMPT);
      socket.off(SOCKET_EVENTS.CHASSEUR_PROMPT);
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
          state={state}
          me={me ?? null}
          role={role}
          prompt={prompt}
          chasseurTargets={chasseurTargets}
          wolfRoom={wolfRoom}
          wolfMessages={wolfMessages}
          onClearPrompt={() => setPrompt(null)}
          onClearChasseur={() => setChasseurTargets(null)}
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
  wolfRoom,
  wolfMessages,
  onClearPrompt,
  onClearChasseur,
}: {
  state: GameStatePublic;
  me: GameStatePublic["players"][number] | null;
  role: RoleId | null;
  prompt: NightPromptPayload | null;
  chasseurTargets: string[] | null;
  wolfRoom: WolfRoomStatePayload | null;
  wolfMessages: WolfChatMessagePayload[];
  onClearPrompt: () => void;
  onClearChasseur: () => void;
}) {
  if (chasseurTargets) {
    return (
      <section className="card">
        <h2 className="font-display text-lg text-blood-300 mb-3">🏹 Vous êtes mort(e) — Chasseur</h2>
        <p className="text-sm text-night-100/80 mb-3">Choisissez un joueur à emporter avec vous.</p>
        <PlayerList
          players={state.players.filter((p) => chasseurTargets.includes(p.id))}
          selectable
          onSelect={async (targetId) => {
            const { emitWithAck } = await import("@/lib/socket");
            await emitWithAck(SOCKET_EVENTS.CHASSEUR_SHOOT, { targetId });
            onClearChasseur();
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
            <PlayerList
              players={state.players.filter((p) => state.candidates.includes(p.id))}
              selectable
              onSelect={async (candidateId) => {
                const { emitWithAck } = await import("@/lib/socket");
                await emitWithAck(SOCKET_EVENTS.CHEF_VOTE_CAST, { candidateId });
              }}
            />
          )}
        </section>
      );
    }

    case "DAY_1_DISCUSSION":
    case "DAY_DISCUSSION":
      return (
        <section className="card text-center space-y-3">
          <h2 className="font-display text-lg text-gold-300">☀️ Discussion</h2>
          <p className="text-sm text-night-100/70">Débattez à voix haute — le vote ouvrira bientôt.</p>
          <PlayerList players={state.players} />
        </section>
      );

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
        <section className="card text-center py-10 animate-fade-in">
          <p className="text-4xl mb-3">{state.lastMorningAnnouncement === "DEATH" ? "🔔" : "🐓"}</p>
          <p className="font-display text-xl text-gold-300">
            {state.lastMorningAnnouncement === "DEATH"
              ? "Quelqu'un est mort cette nuit."
              : "Personne n'est mort cette nuit."}
          </p>
        </section>
      );

    case "DAY_VOTE":
    case "TIE_DEFENSE":
    case "TIE_REVOTE": {
      const votable =
        state.phase === "DAY_VOTE" && state.tiedPlayerIds.length > 0
          ? state.players.filter((p) => state.tiedPlayerIds.includes(p.id))
          : state.players;
      if (state.phase === "TIE_DEFENSE") {
        return (
          <section className="card text-center space-y-3">
            <h2 className="font-display text-lg text-blood-300">⚖️ Égalité !</h2>
            <p className="text-sm text-night-100/70">Les joueurs à égalité se défendent :</p>
            <PlayerList players={state.players.filter((p) => state.tiedPlayerIds.includes(p.id))} />
          </section>
        );
      }
      return (
        <section className="card space-y-3">
          <h2 className="font-display text-lg text-gold-300">🗳️ Vote du village</h2>
          {me?.isAlive ? (
            <PlayerList
              players={votable}
              selectable
              onSelect={async (targetId) => {
                const { emitWithAck } = await import("@/lib/socket");
                await emitWithAck(SOCKET_EVENTS.DAY_VOTE_CAST, { targetId });
              }}
            />
          ) : (
            <p className="text-sm text-night-100/60">Vous êtes spectateur(trice).</p>
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
