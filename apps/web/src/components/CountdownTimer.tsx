"use client";

import { useEffect, useState } from "react";

export function CountdownTimer({ endsAt }: { endsAt: number | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!endsAt) return;
    const interval = setInterval(() => setNow(Date.now()), 250);
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
