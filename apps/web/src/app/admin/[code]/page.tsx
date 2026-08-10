"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import {
  DEFAULT_NIGHT_STEP_DURATIONS,
  DEFAULT_NIGHT_STEP_DURATION_SECONDS,
  ROLE_IDS,
  ROLE_METADATA,
  SOCKET_EVENTS,
  type AdminStatePayload,
  type GameConfig,
  type LogEntry,
  type PlayerPrivateRole,
  type RoleId,
} from "@loupgarou/shared";
import { emitWithAck, getSocket } from "@/lib/socket";
import { startClockSync } from "@/lib/serverClock";
import { loadAdminSession } from "@/lib/session";
import { PlayerList } from "@/components/PlayerList";

export default function AdminDashboardPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const code = params.code.toUpperCase();

  const [admin, setAdmin] = useState<AdminStatePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joinUrl, setJoinUrl] = useState("");

  useEffect(() => {
    const session = loadAdminSession();
    if (!session || session.gameCode !== code) {
      router.replace("/admin");
      return;
    }
    setJoinUrl(`${window.location.origin}/join?code=${code}`);

    const socket = getSocket();
    startClockSync();
    async function authenticate() {
      try {
        await emitWithAck(SOCKET_EVENTS.ADMIN_AUTH, { hostToken: session!.hostToken, gameCode: code });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Authentification échouée.");
      }
    }
    authenticate();
    socket.on("connect", authenticate);
    socket.on(SOCKET_EVENTS.ADMIN_STATE, (payload: AdminStatePayload) => setAdmin(payload));

    return () => {
      socket.off("connect", authenticate);
      socket.off(SOCKET_EVENTS.ADMIN_STATE);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center text-center px-6">
        <div>
          <p className="text-blood-300 mb-4">{error}</p>
          <a className="btn-secondary" href="/admin">
            Retour
          </a>
        </div>
      </main>
    );
  }

  if (!admin) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-night-100/60 animate-pulse-slow">Chargement du tableau de bord…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-6 max-w-5xl mx-auto space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs text-night-600 uppercase tracking-wide">Maître du Jeu</p>
          <h1 className="font-display text-2xl text-gold-300">
            Partie {code} — {admin.state.phase}
          </h1>
        </div>
        <ControlBar admin={admin} />
      </header>

      {admin.state.phase === "LOBBY" ? (
        <LobbyConfig code={code} admin={admin} joinUrl={joinUrl} />
      ) : (
        <DashboardBody admin={admin} />
      )}
    </main>
  );
}

function ControlBar({ admin }: { admin: AdminStatePayload }) {
  const [busy, setBusy] = useState(false);
  async function act(event: string, payload: unknown = {}) {
    setBusy(true);
    try {
      await emitWithAck(event, payload);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setBusy(false);
    }
  }

  const soundButton = (
    <button
      key="sound"
      className="btn-secondary"
      disabled={busy}
      onClick={() => act(SOCKET_EVENTS.ADMIN_SET_SOUND_EFFECTS, { enabled: !admin.state.soundEffectsEnabled })}
    >
      {admin.state.soundEffectsEnabled ? "🔊 Sons activés" : "🔇 Sons coupés"}
    </button>
  );

  // Sound is togglable anytime, including from the lobby before the game
  // even starts — everything else here only makes sense once it has.
  if (admin.state.phase === "LOBBY") {
    return <div className="flex flex-wrap gap-2">{soundButton}</div>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button
        className="btn-secondary"
        disabled={busy}
        onClick={() => act(admin.state.paused ? SOCKET_EVENTS.ADMIN_RESUME : SOCKET_EVENTS.ADMIN_PAUSE)}
      >
        {admin.state.paused ? "▶ Reprendre" : "⏸ Pause"}
      </button>
      <button className="btn-secondary" disabled={busy} onClick={() => act(SOCKET_EVENTS.ADMIN_FORCE_NEXT_PHASE)}>
        ⏭ Phase suivante
      </button>
      <button className="btn-secondary" disabled={busy} onClick={() => act(SOCKET_EVENTS.ADMIN_UNDO_PHASE)}>
        ↩ Annuler
      </button>
      <button className="btn-secondary" disabled={busy} onClick={() => act(SOCKET_EVENTS.ADMIN_REVEAL_ROLES)}>
        👁 Révéler les rôles
      </button>
      {soundButton}
      <button
        className="btn-primary"
        disabled={busy}
        onClick={() => confirm("Terminer la partie ?") && act(SOCKET_EVENTS.ADMIN_END_GAME)}
      >
        ⏹ Terminer
      </button>
      {admin.state.phase === "ENDED" && (
        <button
          className="btn-secondary"
          disabled={busy}
          onClick={() =>
            confirm("Forcer le résultat du vote MVP maintenant, même si tout le monde n'a pas voté ?") &&
            act(SOCKET_EVENTS.ADMIN_FORCE_MVP_FINALIZE)
          }
        >
          🏅 Forcer le résultat MVP
        </button>
      )}
    </div>
  );
}

function LobbyConfig({ code, admin, joinUrl }: { code: string; admin: AdminStatePayload; joinUrl: string }) {
  // Seeded from the engine's REAL current config (not DEFAULT_GAME_CONFIG)
  // — useState only ever reads this initializer on first mount, so this
  // reflects whatever was already saved (a previous ADMIN_UPDATE_CONFIG,
  // or a carried-over config from instant replay's "reconfigure" flow —
  // see AdminStatePayload.config's doc comment) without fighting the
  // player's own subsequent edits on every ADMIN_STATE tick.
  const [config, setConfig] = useState<GameConfig>(admin.config);
  const [busy, setBusy] = useState(false);

  function setRoleCount(roleId: RoleId, count: number) {
    setConfig((c) => ({ ...c, roleCounts: { ...c.roleCounts, [roleId]: Math.max(0, count) } }));
  }

  async function saveConfig() {
    setBusy(true);
    try {
      await emitWithAck(SOCKET_EVENTS.ADMIN_UPDATE_CONFIG, { config });
    } finally {
      setBusy(false);
    }
  }

  async function startGame() {
    setBusy(true);
    try {
      await saveConfig();
      await emitWithAck(SOCKET_EVENTS.ADMIN_START_GAME, {});
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur au démarrage.");
    } finally {
      setBusy(false);
    }
  }

  const assignable = ROLE_IDS.filter((r) => r !== "VILLAGEOIS");
  const totalAssigned = assignable.reduce((sum, r) => sum + (config.roleCounts[r] ?? 0), 0);

  return (
    <div className="grid md:grid-cols-3 gap-6">
      <section className="card md:col-span-2 space-y-4">
        <h2 className="font-display text-lg text-gold-300">Configuration des rôles</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {assignable.map((roleId) => (
            <label key={roleId} className="flex items-center justify-between gap-2 text-sm">
              <span>{ROLE_METADATA[roleId].displayName}</span>
              <input
                type="number"
                min={0}
                className="input w-20 text-center"
                value={config.roleCounts[roleId] ?? 0}
                onChange={(e) => setRoleCount(roleId, Number(e.target.value))}
              />
            </label>
          ))}
        </div>
        <p className="text-xs text-night-600">
          {totalAssigned} rôle(s) spéciaux configurés · {admin.state.players.length} joueur(s) connecté(s) — le
          reste devient Villageois.
        </p>

        <label className="flex items-center justify-between gap-2 text-sm pt-2 border-t border-night-700/60">
          <span>
            Vote du Chef compte double si plus de{" "}
            <span className="text-night-100/50">(nb. de joueurs vivants)</span> :
          </span>
          <input
            type="number"
            min={0}
            className="input w-20 text-center"
            value={config.chefVoteBonusThreshold}
            onChange={(e) =>
              setConfig((c) => ({ ...c, chefVoteBonusThreshold: Math.max(0, Number(e.target.value)) }))
            }
          />
        </label>
        <p className="text-xs text-night-600 -mt-2">
          Ex. avec 6 (par défaut) : le vote du Chef compte 2 tant qu&apos;il reste 7 joueurs vivants ou
          plus, puis repasse à 1 automatiquement. Ne s&apos;applique jamais lors d&apos;un second tour de
          vote après une égalité — ce tour-là compte toujours 1 voix par joueur.
        </p>

        <label className="flex items-center justify-between gap-2 text-sm">
          <span>Second débat du Chef — joueurs éligibles au maximum :</span>
          <input
            type="number"
            min={0}
            className="input w-20 text-center"
            value={config.secondDebateSlots}
            onChange={(e) =>
              setConfig((c) => ({ ...c, secondDebateSlots: Math.max(0, Number(e.target.value)) }))
            }
          />
        </label>
        <p className="text-xs text-night-600 -mt-2">
          Une fois la discussion du jour terminée (à partir du jour 2), le Chef peut accorder ce nombre de
          temps de parole supplémentaires avant le vote — ou n&apos;en accorder aucun.
        </p>

        <h3 className="font-display text-gold-300 pt-2">Minuteurs (secondes)</h3>
        <p className="text-xs text-night-600 -mt-1">
          Débat des candidats, discussion, vote du village et défense en cas d&apos;égalité : durée PAR
          joueur (chacun parle ou vote à tour de rôle), pas pour toute la phase. Le vote du Chef utilise
          une courte durée fixe, non configurable ici.
        </p>
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          {(
            [
              ["chefDebate", "Débat des candidats (par candidat)"],
              ["dayDiscussion", "Discussion du jour (par joueur)"],
              ["night", "Nuit"],
              ["dayVote", "Vote du village (par joueur)"],
              ["tieDefense", "Défense en cas d'égalité (par joueur à égalité)"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex flex-col gap-1">
              <span className="text-night-100/70">{label}</span>
              <input
                type="number"
                className="input"
                value={config.timers[key]}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, timers: { ...c.timers, [key]: Number(e.target.value) } }))
                }
              />
            </label>
          ))}
        </div>

        <NightModeConfig config={config} setConfig={setConfig} />

        <label className="flex items-center gap-2 text-sm pt-2">
          <input
            type="checkbox"
            checked={config.autoProgress}
            onChange={(e) => setConfig((c) => ({ ...c, autoProgress: e.target.checked }))}
          />
          Progression automatique (sinon, contrôle manuel des phases)
        </label>

        {config.autoProgress && (
          <div className="space-y-2 pt-2 border-t border-night-700/60">
            <h4 className="font-display text-sm text-gold-300/90">
              Pauses d&apos;annonce (secondes)
            </h4>
            <p className="text-xs text-night-600 -mt-1">
              Petites pauses pour laisser la table lire ce qui vient de se passer (Chef élu, qui est
              mort, qui a été banni) avant que le jeu n&apos;enchaîne tout seul.
            </p>
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              {(
                [
                  ["chefCandidacy", "Attente des candidats au poste de Chef"],
                  ["chefReveal", "Annonce du Chef élu"],
                  ["morningReveal", "Annonce du réveil (mort ou non)"],
                  ["dayVoteResult", "Annonce du résultat du vote"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex flex-col gap-1">
                  <span className="text-night-100/70">{label}</span>
                  <input
                    type="number"
                    className="input"
                    value={config.timers[key]}
                    onChange={(e) =>
                      setConfig((c) => ({ ...c, timers: { ...c.timers, [key]: Number(e.target.value) } }))
                    }
                  />
                </label>
              ))}
            </div>

            <h4 className="font-display text-sm text-gold-300/90 pt-1">
              Délais de secours (jamais bloqué)
            </h4>
            <p className="text-xs text-night-600 -mt-1">
              Si le joueur concerné ne réagit pas à temps, la partie choisit au hasard à sa place plutôt
              que de rester figée.
            </p>
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              {(
                [
                  ["chasseurShot", "Tir du Chasseur"],
                  ["chefSuccession", "Succession du Chef"],
                  ["tieRevote", "Égalité non résolue"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex flex-col gap-1">
                  <span className="text-night-100/70">{label}</span>
                  <input
                    type="number"
                    className="input"
                    value={config.timers[key]}
                    onChange={(e) =>
                      setConfig((c) => ({ ...c, timers: { ...c.timers, [key]: Number(e.target.value) } }))
                    }
                  />
                </label>
              ))}
            </div>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={config.soundEffectsEnabled}
            onChange={(e) => setConfig((c) => ({ ...c, soundEffectsEnabled: e.target.checked }))}
          />
          Effets sonores (loup-garou, coq, cloche…) — togglable aussi en cours de partie ci-dessus
        </label>

        <div className="flex gap-2 pt-2">
          <button className="btn-secondary" disabled={busy} onClick={saveConfig}>
            Enregistrer la configuration
          </button>
          <button className="btn-primary" disabled={busy} onClick={startGame}>
            Démarrer la partie
          </button>
        </div>
      </section>

      <section className="card space-y-4 text-center">
        <h2 className="font-display text-lg text-gold-300">Rejoindre</h2>
        <p className="text-3xl tracking-widest font-display text-gold-300">{code}</p>
        <div className="bg-white p-3 rounded-lg inline-block">
          <QRCodeSVG value={joinUrl} size={160} />
        </div>
        <p className="text-xs text-night-600 break-all">{joinUrl}</p>
        <h3 className="font-display text-night-100 pt-2">Joueurs</h3>
        <PlayerList players={admin.state.players} />
      </section>
    </div>
  );
}

// Canonical night-step order = packages/game-engine's own nightPriority
// order (Mowgli, Salvateur, Alien, Voyante, the wolf pack, Sorcière,
// Corbeau) — DEFAULT_NIGHT_STEP_DURATIONS' key insertion order already IS
// that order (see its own doc comment in packages/shared/src/types.ts), so
// reusing it here means this file never needs its own separate copy of
// nightPriority values just to render a sensible default list.
const NIGHT_STEP_ROLE_IDS = Object.keys(DEFAULT_NIGHT_STEP_DURATIONS) as RoleId[];

/**
 * Cahier de charge #2 §17.1 — admin-facing SEQUENTIAL night config. Every
 * field here (nightMode, nightStepOrder, nightStepDurations,
 * nightStepDisabled) is just plain GameConfig — no new socket events were
 * needed server-side, it all flows through the existing
 * ADMIN_UPDATE_CONFIG/ADMIN_CREATE_GAME paths (LOBBY-only, same as every
 * other config field on this page). See GameEngine.updateConfig.
 */
function NightModeConfig({
  config,
  setConfig,
}: {
  config: GameConfig;
  setConfig: (updater: (c: GameConfig) => GameConfig) => void;
}) {
  const sequential = config.nightMode === "SEQUENTIAL";
  // null nightStepOrder means "use the engine's own default order" — only
  // materialize an explicit array the first time the admin actually
  // reorders something (see moveStep below); until then, display the
  // canonical order without writing anything to config.
  const order = config.nightStepOrder && config.nightStepOrder.length > 0
    ? config.nightStepOrder
    : NIGHT_STEP_ROLE_IDS;

  function moveStep(roleId: RoleId, direction: -1 | 1) {
    setConfig((c) => {
      const current = c.nightStepOrder && c.nightStepOrder.length > 0 ? [...c.nightStepOrder] : [...NIGHT_STEP_ROLE_IDS];
      const i = current.indexOf(roleId);
      const j = i + direction;
      if (i === -1 || j < 0 || j >= current.length) return c;
      [current[i], current[j]] = [current[j]!, current[i]!];
      return { ...c, nightStepOrder: current };
    });
  }

  function toggleDisabled(roleId: RoleId) {
    setConfig((c) => {
      const disabled = new Set(c.nightStepDisabled);
      if (disabled.has(roleId)) disabled.delete(roleId);
      else disabled.add(roleId);
      return { ...c, nightStepDisabled: [...disabled] };
    });
  }

  function setDuration(roleId: RoleId, seconds: number) {
    setConfig((c) => ({
      ...c,
      nightStepDurations: { ...c.nightStepDurations, [roleId]: Math.max(5, seconds) },
    }));
  }

  return (
    <div className="space-y-3 pt-2 border-t border-night-700/60">
      <h3 className="font-display text-gold-300">Déroulement de la nuit</h3>
      <p className="text-xs text-night-600 -mt-1">
        Simultanée (par défaut) : tout le monde joue son rôle en même temps, comme aujourd&apos;hui.
        Séquentielle (nouveau) : les rôles agissent un par un, dans l&apos;ordre ci-dessous, chacun avec
        son propre temps limite.
      </p>
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="nightMode"
            checked={!sequential}
            onChange={() => setConfig((c) => ({ ...c, nightMode: "SIMULTANEOUS" }))}
          />
          Simultanée
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="nightMode"
            checked={sequential}
            onChange={() => setConfig((c) => ({ ...c, nightMode: "SEQUENTIAL" }))}
          />
          Séquentielle
        </label>
      </div>

      {sequential && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-night-600">
              Ordre des étapes, durée par rôle (secondes), et rôles à désactiver cette partie.
            </p>
            <button
              className="text-xs text-gold-300/80 hover:text-gold-300 underline"
              onClick={() => setConfig((c) => ({ ...c, nightStepOrder: null }))}
            >
              Ordre par défaut
            </button>
          </div>
          <ul className="space-y-1">
            {order.map((roleId, i) => {
              const disabled = config.nightStepDisabled.includes(roleId);
              const duration =
                config.nightStepDurations[roleId] ??
                DEFAULT_NIGHT_STEP_DURATIONS[roleId] ??
                DEFAULT_NIGHT_STEP_DURATION_SECONDS;
              return (
                <li
                  key={roleId}
                  className={`flex items-center gap-2 text-sm px-2 py-1.5 rounded-lg border ${
                    disabled ? "border-night-800 opacity-40" : "border-night-700"
                  }`}
                >
                  <div className="flex flex-col">
                    <button
                      type="button"
                      className="text-night-100/50 hover:text-gold-300 disabled:opacity-20 leading-none"
                      disabled={i === 0}
                      onClick={() => moveStep(roleId, -1)}
                      aria-label="Monter"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      className="text-night-100/50 hover:text-gold-300 disabled:opacity-20 leading-none"
                      disabled={i === order.length - 1}
                      onClick={() => moveStep(roleId, 1)}
                      aria-label="Descendre"
                    >
                      ▼
                    </button>
                  </div>
                  <span className="w-6 text-night-600 text-xs">{i + 1}.</span>
                  <span className="flex-1">{ROLE_METADATA[roleId].displayName}</span>
                  <input
                    type="number"
                    min={5}
                    className="input w-16 text-center"
                    value={duration}
                    disabled={disabled}
                    onChange={(e) => setDuration(roleId, Number(e.target.value))}
                  />
                  <span className="text-xs text-night-600">s</span>
                  <label className="flex items-center gap-1 text-xs text-night-100/70">
                    <input type="checkbox" checked={!disabled} onChange={() => toggleDisabled(roleId)} />
                    Activé
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function DashboardBody({ admin }: { admin: AdminStatePayload }) {
  const roleByPlayer = new Map(admin.roles.map((r: PlayerPrivateRole) => [r.playerId, r.roleId]));

  return (
    <div className="grid md:grid-cols-3 gap-6">
      <section className="card md:col-span-2 space-y-3">
        <h2 className="font-display text-lg text-gold-300">Joueurs & rôles</h2>
        <ul className="grid sm:grid-cols-2 gap-2 text-sm">
          {admin.state.players.map((p) => (
            <li
              key={p.id}
              className={`px-3 py-2 rounded-lg border flex justify-between ${
                p.isAlive ? "border-night-600" : "border-night-800 opacity-50 line-through"
              }`}
            >
              <span>
                {p.isChef && "👑 "}
                {p.nickname}
              </span>
              <span className="text-gold-300">{ROLE_METADATA[roleByPlayer.get(p.id)!]?.displayName}</span>
            </li>
          ))}
        </ul>

        {admin.state.tiedPlayerIds.length > 0 && admin.state.phase === "TIE_REVOTE" && (
          <TieResolver admin={admin} />
        )}
      </section>

      <section className="card space-y-2">
        <h2 className="font-display text-lg text-gold-300">Journal</h2>
        <div className="h-96 overflow-y-auto space-y-1 text-xs">
          {admin.logs
            .slice()
            .reverse()
            .map((log: LogEntry) => (
              <p key={log.id} className="text-night-100/70">
                <span className="text-night-600">[{log.dayOrNight}]</span> {log.message}
              </p>
            ))}
        </div>
      </section>
    </div>
  );
}

function TieResolver({ admin }: { admin: AdminStatePayload }) {
  return (
    <div className="border border-blood-500/40 rounded-lg p-3 space-y-2">
      <p className="text-sm text-blood-300">Égalité persistante — résolution manuelle requise.</p>
      <PlayerList
        players={admin.state.players.filter((p) => admin.state.tiedPlayerIds.includes(p.id))}
        selectable
        onSelect={(targetId) => emitWithAck(SOCKET_EVENTS.ADMIN_RESOLVE_TIE, { targetId })}
      />
      <button
        className="btn-secondary"
        onClick={() => emitWithAck(SOCKET_EVENTS.ADMIN_RESOLVE_TIE, { targetId: null })}
      >
        Personne n&apos;est éliminé
      </button>
    </div>
  );
}
