"use client";

import { useEffect, useRef, useState } from "react";
import { SOCKET_EVENTS, type NotesStatePayload } from "@loupgarou/shared";
import { emitWithAck } from "@/lib/socket";

type SaveStatus = "idle" | "saving" | "saved";

const AUTOSAVE_DELAY_MS = 800;

/**
 * Feature 7 — a private, server-synced scratchpad every player gets for
 * jotting notes during discussions. Deliberately server-synced rather than
 * plain localStorage: if this player's tab drops mid-game and they
 * reconnect from a different device or a fresh browser, their notes are
 * still there (see notes/notesRegistry.ts on the server) — exactly the
 * "what if someone disconnects" case that ruled out a purely client-side
 * store. Notes persist through the whole game and every round; the server
 * purges them the moment GAME_ENDED fires, never before.
 *
 * A small floating button that expands into a panel and shrinks back down
 * on a second click — never a full-screen modal, so it never blocks the
 * game state behind it.
 */
export function NotesButton() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestText = useRef("");

  // Fetched once, lazily, the first time the panel is actually opened —
  // no point round-tripping to the server for notes nobody's looked at
  // yet this session.
  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    emitWithAck<NotesStatePayload>(SOCKET_EVENTS.NOTES_GET, {})
      .then((data) => {
        if (cancelled) return;
        setText(data.text);
        latestText.current = data.text;
        setLoaded(true);
      })
      .catch(() => {
        // Best-effort — worst case the player starts from a blank note
        // instead of their saved one; never worth blocking the panel.
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, loaded]);

  function scheduleSave(nextText: string) {
    latestText.current = nextText;
    setStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await emitWithAck(SOCKET_EVENTS.NOTES_SAVE, { text: latestText.current });
        setStatus("saved");
      } catch {
        setStatus("idle");
      }
    }, AUTOSAVE_DELAY_MS);
  }

  // Flush any pending debounced save immediately (component unmount, or
  // the panel closing) so a quick "type a line then collapse" never loses
  // the last few keystrokes to the debounce window.
  function flushSave() {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    void emitWithAck(SOCKET_EVENTS.NOTES_SAVE, { text: latestText.current }).catch(() => {});
  }

  useEffect(() => {
    return () => {
      if (saveTimer.current) flushSave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
      <div
        className={`origin-bottom-right transition-all duration-300 ease-out ${
          open ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-90 translate-y-2 pointer-events-none"
        }`}
      >
        <div className="card w-72 sm:w-80 space-y-2 shadow-2xl border-gold-500/30">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-gold-300 text-sm">📝 Mes notes</h3>
            <span className="text-[10px] text-night-100/40 h-3">
              {status === "saving" && "Enregistrement…"}
              {status === "saved" && "Enregistré ✓"}
            </span>
          </div>
          <textarea
            className="input min-h-[9rem] resize-y text-sm leading-relaxed"
            placeholder="Vos observations, soupçons, déductions…"
            value={text}
            disabled={!loaded}
            onChange={(e) => {
              setText(e.target.value);
              scheduleSave(e.target.value);
            }}
          />
          <p className="text-[10px] text-night-100/40">
            Privé — visible seulement par vous. Conservé pendant toute la partie, effacé à la fin.
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => {
          setOpen((o) => {
            if (o) flushSave(); // closing — flush whatever's pending right now
            return !o;
          });
        }}
        aria-label={open ? "Fermer mes notes" : "Ouvrir mes notes"}
        className="btn-primary rounded-full w-12 h-12 flex items-center justify-center text-xl shadow-lg transition-transform duration-300 hover:scale-105 active:scale-95"
      >
        {open ? "✕" : "📝"}
      </button>
    </div>
  );
}
