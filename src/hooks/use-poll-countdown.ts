/**
 * usePollCountdown — ticks every second and reports seconds remaining until
 * the next scheduled price poll, purely for the "next update in Xs" UI.
 * Resyncs automatically whenever `lastUpdateAt` changes (a poll just landed).
 */
import { useEffect, useState } from "react";

export function usePollCountdown(lastUpdateAt: number | null, intervalMs: number): number {
  const [secondsLeft, setSecondsLeft] = useState(Math.round(intervalMs / 1000));

  useEffect(() => {
    const compute = () => {
      if (lastUpdateAt == null) return Math.round(intervalMs / 1000);
      const elapsed = Date.now() - lastUpdateAt;
      const remainingMs = Math.max(0, intervalMs - elapsed);
      return Math.ceil(remainingMs / 1000);
    };

    setSecondsLeft(compute());
    const id = setInterval(() => setSecondsLeft(compute()), 1000);
    return () => clearInterval(id);
  }, [lastUpdateAt, intervalMs]);

  return secondsLeft;
}
