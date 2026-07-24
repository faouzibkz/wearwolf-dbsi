export interface SocketData {
  gameCode?: string;
  playerId?: string;
  isAdmin?: boolean;
}

export type Ack = (response: { ok: true; data?: unknown } | { ok: false; error: string }) => void;

export function safeAck(fn: () => unknown, ack?: Ack): void {
  try {
    const data = fn();
    ack?.({ ok: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ack?.({ ok: false, error: message });
  }
}
