/**
 * Pure MVP vote tallying (cahier de charge section 12). Takes the raw
 * ballots (voterId -> votedForId) and returns every player tied for the
 * most votes — the product decision (confirmed explicitly, not assumed) is
 * that a tie means everyone tied wins the MVP that game, rather than
 * picking one at random or awarding nobody.
 */
export function tallyMvpVotes(votes: Record<string, string>): string[] {
  const counts = new Map<string, number>();
  for (const votedForId of Object.values(votes)) {
    counts.set(votedForId, (counts.get(votedForId) ?? 0) + 1);
  }
  if (counts.size === 0) return [];
  const max = Math.max(...counts.values());
  return [...counts.entries()].filter(([, count]) => count === max).map(([playerId]) => playerId);
}
