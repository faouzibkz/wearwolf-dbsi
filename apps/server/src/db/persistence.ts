import type { GameEngine } from "@loupgarou/game-engine";
import { prisma } from "./prisma.js";

/**
 * Best-effort snapshot persistence. Every mutating socket handler calls
 * `persistGame(engine)` after it changes state; failures are logged but
 * never thrown, so a database outage degrades to "no crash-resilience"
 * rather than "game stops working".
 */
export async function persistGame(engine: GameEngine): Promise<void> {
  try {
    const serialized = engine.serialize() as Record<string, unknown>;
    await prisma.game.upsert({
      where: { code: engine.getCode() },
      create: {
        code: engine.getCode(),
        name: engine.getConfig().name,
        phase: engine.getPhase(),
        configJson: engine.getConfig() as object,
        stateJson: serialized as object,
      },
      update: {
        phase: engine.getPhase(),
        configJson: engine.getConfig() as object,
        stateJson: serialized as object,
        endedAt: engine.getPhase() === "ENDED" ? new Date() : undefined,
        winner: engine.getPublicState().winner,
      },
    });
  } catch (err) {
    console.error("[persistence] failed to persist game", engine.getCode(), err);
  }
}

export async function listPresets() {
  return prisma.preset.findMany({ orderBy: { updatedAt: "desc" } });
}

export async function savePreset(name: string, configJson: object) {
  return prisma.preset.upsert({
    where: { name },
    create: { name, configJson },
    update: { configJson },
  });
}
