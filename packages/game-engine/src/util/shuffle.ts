/**
 * Fisher-Yates shuffle. Accepts an injectable RNG (defaults to Math.random)
 * purely so unit tests can pass a deterministic PRNG and assert on role
 * assignment behaviour without flakiness.
 */
export function shuffle<T>(items: T[], rng: () => number = Math.random): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j] as T, arr[i] as T];
  }
  return arr;
}
