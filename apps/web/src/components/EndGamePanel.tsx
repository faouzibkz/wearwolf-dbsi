"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EndGameStats, MvpResultPayload, MvpStatePayload, ReplayRequestResult } from "@loupgarou/shared";
import { SOCKET_EVENTS } from "@loupgarou/shared";
import { emitWithAck } from "@/lib/socket";
import { saveAdminSession, savePlayerSession } from "@/lib/session";
import { RoleCard } from "./RoleCard";

interface EndGamePanelProps {
  stats: unknown;
  myPlayerId: string;
  mvpState: MvpStatePayload | null;
  mvpResult: MvpResultPayload | null;
  gameCode: string;
  /** Non-null exactly when this browser is also the original host of this game — see play/[code]/page.tsx's doc comment. Gates the replay buttons: only the original host can relaunch. */
  hostToken: string | null;
}

export function EndGamePanel({ stats, myPlayerId, mvpState, mvpResult, gameCode, hostToken }: EndGamePanelProps) {
  const s = stats as EndGameStats;
  return (
    <section className="space-y-6 animate-fade-in">
      <div className="text-center">
        <p className="text-5xl mb-2">{s.winner === "VILLAGE" ? "🏆🧑‍🌾" : "🏆🐺"}</p>
        <h2 className="font-display text-2xl text-gold-300">
          {s.winner === "VILLAGE" ? "Le village l'emporte !" : "Les loups-garous l'emportent !"}
        </h2>
        <p className="text-sm text-night-100/60 mt-1">
          {s.totalNights} nuit(s) · {s.totalDays} jour(s)
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {s.roleReveal.map((r) => (
          <div key={r.playerId} className={r.isAlive ? "" : "opacity-60"}>
            <RoleCard roleId={r.roleId} compact />
            <p className="text-center text-sm mt-1 text-night-100/80">
              {r.nickname} {!r.isAlive && "†"}
              {mvpResult?.winners.some((w) => w.playerId === r.playerId) && " 🏅"}
            </p>
          </div>
        ))}
      </div>
      <MvpVotePanel roleReveal={s.roleReveal} myPlayerId={myPlayerId} mvpState={mvpState} mvpResult={mvpResult} />
      {hostToken && (
        <ReplayPanel
          gameCode={gameCode}
          hostToken={hostToken}
          myPlayerId={myPlayerId}
          myNickname={s.roleReveal.find((r) => r.playerId === myPlayerId)?.nickname ?? ""}
        />
      )}
    </section>
  );
}

/**
 * Instant replay — only ever rendered for the original host (see
 * EndGamePanel's hostToken prop). Two flavors, both carrying the whole
 * roster over under their same pseudo server-side (see
 * apps/server/src/socket/replay.ts):
 *
 *  - Same config: this tab follows straight into the new lobby as a
 *    player (matching "play with his pseudo"), and a SECOND tab opens for
 *    the new admin dashboard — so the host ends up with exactly the two
 *    tabs the feature asked for, without losing either role.
 *  - Reconfigure: this tab goes straight to the new admin config screen
 *    (pre-filled with the old settings, since the new game already
 *    starts from the old game's exact config) so the host can tweak
 *    before anyone starts.
 */
function ReplayPanel({
  gameCode,
  hostToken,
  myNickname,
}: {
  gameCode: string;
  hostToken: string;
  myPlayerId: string;
  myNickname: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<"same" | "reconfigure" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function replay(reconfigure: boolean) {
    setError(null);
    setLoading(reconfigure ? "reconfigure" : "same");
    try {
      const result = await emitWithAck<ReplayRequestResult>(SOCKET_EVENTS.REPLAY_REQUEST, {
        gameCode,
        hostToken,
        reconfigure,
      });
      saveAdminSession({ hostToken: result.hostToken, gameCode: result.code });
      if (result.playerId && result.reconnectToken) {
        savePlayerSession({
          gameCode: result.code,
          playerId: result.playerId,
          reconnectToken: result.reconnectToken,
          nickname: myNickname,
        });
      }
      if (reconfigure) {
        router.push(`/admin/${result.code}`);
      } else {
        window.open(`/admin/${result.code}`, "_blank");
        router.push(`/play/${result.code}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue.");
      setLoading(null);
    }
  }

  return (
    <div className="card space-y-3 animate-fade-in border-gold-400/20">
      <h3 className="font-display text-gold-300 text-center">🔁 Rejouer</h3>
      {error && <p className="text-blood-300 text-sm text-center">{error}</p>}
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          className="btn-primary text-sm px-4 py-2 disabled:opacity-40"
          disabled={loading !== null}
          onClick={() => replay(false)}
        >
          {loading === "same" ? "Lancement…" : "Rejouer (mêmes paramètres)"}
        </button>
        <button
          type="button"
          className="btn-secondary text-sm px-4 py-2 disabled:opacity-40"
          disabled={loading !== null}
          onClick={() => replay(true)}
        >
          {loading === "reconfigure" ? "Ouverture…" : "Rejouer (modifier les paramètres)"}
        </button>
      </div>
      <p className="text-xs text-night-100/40 text-center">
        Tous les joueurs de cette partie seront automatiquement replacés dans la nouvelle, avec le même pseudo.
      </p>
    </div>
  );
}

/**
 * Post-game MVP vote (cahier de charge section 12). Deliberately a single,
 * one-time choice from this client's point of view once it succeeds — the
 * server (mvp/mvpVotingRegistry.ts) technically allows re-voting, but
 * exposing a "change my vote" UI wasn't part of what was asked for, so
 * this keeps it simple: cast once, then just watch the tally progress.
 */
function MvpVotePanel({
  roleReveal,
  myPlayerId,
  mvpState,
  mvpResult,
}: {
  roleReveal: EndGameStats["roleReveal"];
  myPlayerId: string;
  mvpState: MvpStatePayload | null;
  mvpResult: MvpResultPayload | null;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [myChoice, setMyChoice] = useState<string | null>(null);

  if (mvpResult) {
    const names = mvpResult.winners.map((w) => w.nickname);
    return (
      <div className="card text-center py-4 animate-fade-in">
        <p className="font-display text-lg text-gold-300">
          🏅 {names.length === 0 ? "Personne n'a voté — pas de MVP cette partie." : names.length === 1 ? `MVP de la partie : ${names[0]}` : `MVP de la partie (ex æquo) : ${names.join(", ")}`}
        </p>
      </div>
    );
  }

  // Server is the source of truth for "have I voted" (mvpState.votedPlayerIds),
  // but that arrives one round-trip after our own click — myChoice covers
  // that brief gap so the button disables immediately, not just eventually.
  const hasVoted = myChoice !== null || (mvpState?.votedPlayerIds.includes(myPlayerId) ?? false);
  const votable = roleReveal.filter((r) => r.playerId !== myPlayerId);

  async function vote(votedForId: string) {
    setSubmitting(true);
    setError(null);
    try {
      await emitWithAck(SOCKET_EVENTS.MVP_VOTE_CAST, { votedForId });
      setMyChoice(votedForId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card space-y-3 animate-fade-in">
      <h3 className="font-display text-gold-300 text-center">🏅 Votez pour le MVP de la partie</h3>
      {error && <p className="text-blood-300 text-sm text-center">{error}</p>}
      {hasVoted ? (
        <p className="text-sm text-night-100/60 text-center">
          Vote enregistré — en attente des autres joueurs
          {mvpState ? ` (${mvpState.votesCast}/${mvpState.totalEligible})` : ""}…
        </p>
      ) : (
        <div className="flex flex-wrap justify-center gap-2">
          {votable.map((r) => (
            <button
              key={r.playerId}
              className="btn-secondary text-sm px-3 py-1.5 disabled:opacity-40"
              disabled={submitting}
              onClick={() => vote(r.playerId)}
            >
              {r.nickname}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
