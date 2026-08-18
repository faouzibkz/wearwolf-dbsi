import { describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, RETRY_DELAYS_MS, TransportError, delayForRetry, generateRequestId } from "./retryPolicy";

describe("retryPolicy", () => {
  it("has exactly MAX_ATTEMPTS - 1 delays (one gap between each pair of attempts)", () => {
    expect(RETRY_DELAYS_MS).toHaveLength(MAX_ATTEMPTS - 1);
  });

  it("delayForRetry returns the configured delay for each in-range attempt index", () => {
    for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
      expect(delayForRetry(i)).toBe(RETRY_DELAYS_MS[i]);
    }
  });

  it("delayForRetry never throws for an out-of-range index, and returns 0", () => {
    expect(delayForRetry(999)).toBe(0);
    expect(delayForRetry(-1)).toBe(0);
  });

  it("TransportError is a distinct, recognizable Error subtype", () => {
    const err = new TransportError();
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(TransportError);
    expect(err.name).toBe("TransportError");
    expect(err.message.length).toBeGreaterThan(0);
  });

  it("generateRequestId returns a non-empty string, and a different one on every call", () => {
    const a = generateRequestId();
    const b = generateRequestId();
    expect(typeof a).toBe("string");
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });
});
