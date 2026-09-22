import { describe, expect, it } from "vitest";
import { RISK_THRESHOLDS, riskLevel, riskNote, riskTone } from "./risk";

describe("riskLevel", () => {
  it("bands on the thresholds (lower bound inclusive for the next band)", () => {
    expect(riskLevel(0)).toBe("low");
    expect(riskLevel(RISK_THRESHOLDS.green - 0.001)).toBe("low");
    expect(riskLevel(RISK_THRESHOLDS.green)).toBe("medium");
    expect(riskLevel(RISK_THRESHOLDS.amber - 0.001)).toBe("medium");
    expect(riskLevel(RISK_THRESHOLDS.amber)).toBe("high");
    expect(riskLevel(1)).toBe("high");
  });
});

describe("riskTone", () => {
  it("maps level (from probability) to tone, and labels by predicted days late", () => {
    expect(riskTone({ delayProbability: 0.2, predictedDelayDays: 2 })).toEqual({ tone: "ok", label: "2d late" });
    expect(riskTone({ delayProbability: 0.5, predictedDelayDays: 5 })).toEqual({ tone: "warn", label: "5d late" });
    expect(riskTone({ delayProbability: 0.834, predictedDelayDays: 9 })).toEqual({ tone: "bad", label: "9d late" });
    expect(riskTone({ delayProbability: 0.2, predictedDelayDays: 0 })).toEqual({ tone: "ok", label: "on time" });
  });
});

describe("riskNote", () => {
  it("pluralises days, leads with days, and picks the driver phrase by band", () => {
    expect(riskNote({ delayProbability: 0.2, predictedDelayDays: 1 })).toContain("about 1 day past due");
    const high = riskNote({ delayProbability: 0.8, predictedDelayDays: 4 }, "Acme");
    expect(high).toContain("about 4 days past due");
    expect(high).toContain("80% chance");
    expect(high).toContain("Acme's");
  });
});
