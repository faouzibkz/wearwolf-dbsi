import { randomBytes, randomUUID } from "node:crypto";

export function generatePlayerId(): string {
  return randomUUID();
}

export function generateReconnectToken(): string {
  return randomBytes(24).toString("hex");
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars

export function generateGameCode(length = 5): string {
  let code = "";
  const bytes = randomBytes(length);
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return code;
}
