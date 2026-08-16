import { describe, expect, it } from "vitest";
import { clearNotesForGame, getNote, saveNote } from "./notesRegistry.js";

describe("notesRegistry (Feature 7: personal, server-synced game notes)", () => {
  it("returns an empty string for a player with no note yet", () => {
    expect(getNote("FRESH1", "player-1")).toBe("");
  });

  it("saves and returns a player's note", () => {
    saveNote("CODE1", "player-1", "Le loup c'est peut-être Bob");
    expect(getNote("CODE1", "player-1")).toBe("Le loup c'est peut-être Bob");
  });

  it("overwrites on repeated saves — always the latest text, not appended", () => {
    saveNote("CODE2", "player-1", "premier jet");
    saveNote("CODE2", "player-1", "version finale");
    expect(getNote("CODE2", "player-1")).toBe("version finale");
  });

  it("keeps different players' notes in the same game fully separate", () => {
    saveNote("CODE3", "player-1", "note de Alice");
    saveNote("CODE3", "player-2", "note de Bob");
    expect(getNote("CODE3", "player-1")).toBe("note de Alice");
    expect(getNote("CODE3", "player-2")).toBe("note de Bob");
  });

  it("keeps the same player's notes separate across different games", () => {
    saveNote("CODE4", "player-1", "notes partie 1");
    saveNote("CODE5", "player-1", "notes partie 2");
    expect(getNote("CODE4", "player-1")).toBe("notes partie 1");
    expect(getNote("CODE5", "player-1")).toBe("notes partie 2");
  });

  it("is keyed case-insensitively by code", () => {
    saveNote("code6", "player-1", "peu importe la casse");
    expect(getNote("CODE6", "player-1")).toBe("peu importe la casse");
  });

  it("caps note length defensively instead of storing unbounded input", () => {
    const huge = "x".repeat(10_000);
    saveNote("CODE7", "player-1", huge);
    expect(getNote("CODE7", "player-1").length).toBe(5000);
  });

  it("treats a missing/empty save as clearing the note, not throwing", () => {
    saveNote("CODE8", "player-1", "quelque chose");
    saveNote("CODE8", "player-1", "");
    expect(getNote("CODE8", "player-1")).toBe("");
  });

  it("clearNotesForGame wipes every player's note for that game, leaving other games untouched", () => {
    saveNote("CODE9", "player-1", "a garder ailleurs");
    saveNote("CODE10", "player-1", "sera efface");
    saveNote("CODE10", "player-2", "sera efface aussi");

    clearNotesForGame("CODE10");

    expect(getNote("CODE10", "player-1")).toBe("");
    expect(getNote("CODE10", "player-2")).toBe("");
    expect(getNote("CODE9", "player-1")).toBe("a garder ailleurs");
  });
});
