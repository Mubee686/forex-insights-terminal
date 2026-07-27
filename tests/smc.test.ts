import { describe, expect, test } from "bun:test";
import type { Candle } from "../src/lib/forex";
import { detectVisibleIDM } from "../src/lib/smc";

function makeCandles(closes: number[], overrides: Record<number, Partial<Candle>> = {}): Candle[] {
  return closes.map((close, index) => ({
    time: index + 1,
    open: close,
    high: close + 0.4,
    low: close - 0.4,
    close,
    ...overrides[index],
  }));
}

function bullishSetup(overrides: Record<number, Partial<Candle>> = {}) {
  return makeCandles(
    [
      110, 108, 106, 104, 102, 100, 103, 106, 108, 109, 111, 108, 107, 109, 110, 112,
      114, 116, 120, 116, 113, 111, 110, 109, 108,
    ],
    {
      5: { high: 100.4, low: 99.6 },
      10: { high: 111.4, low: 110.6 },
      // The later candle at index 15 remains higher, so the sweep wick
      // cannot become a second confirmed minor swing.
      13: { high: 111.8, low: 107, close: 109 },
      18: { high: 120.4, low: 119.6 },
      ...overrides,
    },
  );
}

function bearishSetup(overrides: Record<number, Partial<Candle>> = {}) {
  return makeCandles(
    [
      90, 92, 94, 96, 98, 100, 97, 94, 92, 91, 89, 92, 93, 91, 90, 88, 86, 84, 80, 84, 87,
      89, 90, 91, 92,
    ],
    {
      5: { high: 100.4, low: 99.6 },
      10: { high: 89.4, low: 88.6 },
      // The later candle at index 15 remains lower, so the sweep wick
      // cannot become a second confirmed minor swing.
      13: { high: 93.3, low: 87.8, close: 91 },
      18: { high: 80.4, low: 79.6 },
      ...overrides,
    },
  );
}

describe("visible IDM detection", () => {
  test("marks a bullish internal high only after a wick sweep and reversal", () => {
    const zones = detectVisibleIDM(bullishSetup());
    expect(zones).toHaveLength(1);
    expect(zones[0]).toMatchObject({
      id: "idm-up-10",
      kind: "bullish",
      startIndex: 10,
      sweepIndex: 13,
      swept: true,
    });
  });

  test("marks a bearish internal low only after a wick sweep and reversal", () => {
    const zones = detectVisibleIDM(bearishSetup());
    expect(zones).toHaveLength(1);
    expect(zones[0]).toMatchObject({
      id: "idm-down-10",
      kind: "bearish",
      startIndex: 10,
      sweepIndex: 13,
      swept: true,
    });
  });

  test("does not mark an unswept level, a sustained break, or a range", () => {
    expect(
      detectVisibleIDM(
        bullishSetup({
          13: { high: 110.5, low: 106, close: 109 },
        }),
      ),
    ).toHaveLength(0);
    expect(
      detectVisibleIDM(
        bullishSetup({
          13: { high: 111.8, low: 107, close: 112 },
          14: { high: 113, low: 111, close: 113 },
        }),
      ),
    ).toHaveLength(0);
    expect(detectVisibleIDM(makeCandles(Array.from({ length: 25 }, () => 100)))).toHaveLength(0);
  });

  test("uses only the visible window and keeps a stable point identity", () => {
    const candles = bullishSetup();
    expect(detectVisibleIDM(candles, 6, 24)).toHaveLength(0);

    const first = detectVisibleIDM(candles)[0];
    const second = detectVisibleIDM(candles)[0];
    expect(first?.id).toBe(second?.id);
    expect(first?.startIndex).toBe(10);
  });

  test("removes the IDM after the real structural high is broken", () => {
    const zones = detectVisibleIDM(
      bullishSetup({
        20: { high: 122, low: 118, close: 121 },
      }),
    );
    expect(zones).toHaveLength(0);
  });
});