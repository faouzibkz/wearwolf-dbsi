"use client";

import { useEffect, useState } from "react";
import { getServerNow } from "@/lib/serverClock";

/**
 * Anchored to getServerNow() (Date.now() corrected for measured
 * client/server clock drift), not raw Date.now() — endsAt is a deadline
 * the SERVER computed against its own clock, so comparing it against a
 * possibly-skewed browser clock is what made this countdown look "stuck at
 * 0:00" for several seconds on some machines even though the server itself
 * was firing exactly on schedule. See lib/serverClock.ts.
 */
export function CountdownTimer({ endsAt }: { endsAt: number | null }) {
  const [now, setNow] = useState(() => getServerNow());

  useEffect(() => {
    if (!endsAt) return;
    const interval = setInterval(() => setNow(getServerNow()), 250);
    return () => clearInterval(interval);
  }, [endsAt]);

  if (!endsAt) return null;
  const remainingMs = Math.max(0, endsAt - now);
  const seconds = Math.ceil(remainingMs / 1000);
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  const urgent = seconds <= 10;

  return (
    <div
      className={`font-display text-2xl tabular-nums px-4 py-1 rounded-full border ${
        urgent
          ? "border-blood-400 text-blood-300 animate-pulse-slow"
          : "border-gold-400/50 text-gold-300"
      }`}
    >
      {mm}:{ss.toString().padStart(2, "0")}
    </div>
  );
}
