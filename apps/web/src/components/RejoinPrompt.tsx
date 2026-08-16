"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAccount } from "@/lib/auth";
import { apiFetch } from "@/lib/api";

interface OpenGame {
  code: string;
  phase: string;
  playerId: string;
  nickname: string;
}

const DISMISSED_KEY = "loupgarou:rejoinDismissed";

function loadDismissed(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(DISMISSED_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveDismissed(codes: string[]): void {
  sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(codes));
}

function phaseLabel(phase: string): string {
  return phase === "LOBBY" ? "en attente dans le lobby" : "en cours";
}

/**
 * Feature 4 — site-wide "you have an open game, rejoin?" popup. Mounted
 * once in the root layout (inside <AccountProvider>) so it fires on
 * whatever page the person happens to land on right after logging in —
 * home page, /login redirect target, wherever — not just one specific
 * screen. Covers both a LOBBY nobody's started yet and a game already
 * in progress (broadened from the original "just lobbies" ask), which is
 * exactly what gameRegistry.findOpenGamesForUser / GET /account/open-games
 * report: this account has an existing seat somewhere, closed tab or not.
 *
 * Deliberately does NOT rely on this browser's own localStorage player
 * session (that's what /play/[code] already checks first) — the whole
 * point is to also cover a brand new device/browser where that's empty
 * but the account itself still has a live seat server-side.
 */
export function RejoinPrompt() {
  const { account } = useAccount();
  const router = useRouter();
  const pathname = usePathname();
  const [openGames, setOpenGames] = useState<OpenGame[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [visible, setVisible] = useState(false);

  // Never nag about the exact game already on screen — redundant if
  // you're literally looking at /play/<code> or /admin/<code> right now.
  const currentPageCode = /^\/(play|admin)\/([A-Za-z0-9]+)/.exec(pathname ?? "")?.[2]?.toUpperCase();

  useEffect(() => {
    if (!account) {
      setOpenGames([]);
      return;
    }
    setDismissed(loadDismissed());
    let cancelled = false;
    apiFetch<{ games: OpenGame[] }>("/api/account/open-games")
      .then((data) => {
        if (!cancelled) setOpenGames(data.games);
      })
      .catch(() => {
        // Best-effort — a failed check here should never block the rest of
        // the app from working normally.
      });
    return () => {
      cancelled = true;
    };
  }, [account]);

  const pending = openGames.filter((g) => !dismissed.includes(g.code) && g.code !== currentPageCode);

  useEffect(() => {
    // Small delay before showing so it doesn't flash-appear the instant
    // the page paints — same "let the page settle first" courtesy as a
    // typical cookie-consent banner.
    if (pending.length > 0) {
      const t = setTimeout(() => setVisible(true), 400);
      return () => clearTimeout(t);
    }
    setVisible(false);
  }, [pending.length]);

  if (pending.length === 0) return null;

  function dismiss(code?: string) {
    const next = code ? [...dismissed, code] : [...dismissed, ...pending.map((g) => g.code)];
    setDismissed(next);
    saveDismissed(next);
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-6 sm:pb-0 pointer-events-none transition-opacity duration-300 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div
        className={`pointer-events-auto card w-full max-w-sm space-y-3 shadow-2xl border-gold-500/30 transition-transform duration-300 ${
          visible ? "translate-y-0 scale-100" : "translate-y-4 scale-95"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-lg text-gold-300">
            🐺 Partie{pending.length > 1 ? "s" : ""} en cours
          </h2>
          <button
            type="button"
            onClick={() => dismiss()}
            className="text-night-100/40 hover:text-night-100/70 text-sm shrink-0"
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>
        <p className="text-sm text-night-100/70">
          {pending.length === 1
            ? "Vous avez une partie ouverte que vous pouvez rejoindre :"
            : "Vous avez des parties ouvertes que vous pouvez rejoindre :"}
        </p>
        <ul className="space-y-2">
          {pending.map((g) => (
            <li
              key={g.code}
              className="flex items-center justify-between gap-2 rounded-lg border border-night-700 px-3 py-2"
            >
              <div>
                <p className="font-display tracking-widest text-gold-300">{g.code}</p>
                <p className="text-xs text-night-100/50">{phaseLabel(g.phase)}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  className="btn-secondary text-xs px-3 py-1.5"
                  onClick={() => dismiss(g.code)}
                >
                  Plus tard
                </button>
                <button
                  type="button"
                  className="btn-primary text-xs px-3 py-1.5"
                  onClick={() => {
                    dismiss(g.code);
                    router.push(`/join?code=${g.code}`);
                  }}
                >
                  Rejoindre
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
