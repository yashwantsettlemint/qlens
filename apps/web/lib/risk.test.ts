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
  it("maps level to tone and a rounded percent label", () => {
    expect(riskTone(0.2)).toEqual({ tone: "ok", label: "20%" });
    expect(riskTone(0.5)).toEqual({ tone: "warn", label: "50%" });
    expect(riskTone(0.834)).toEqual({ tone: "bad", label: "83%" });
  });
});

describe("riskNote", () => {
  it("pluralises days and picks the driver phrase by band", () => {
    expect(riskNote({ delayProbability: 0.2, predictedDelayDays: 1 })).toContain("about 1 day past due");
    const high = riskNote({ delayProbability: 0.8, predictedDelayDays: 4 }, "Acme");
    expect(high).toContain("80% chance");
    expect(high).toContain("about 4 days past due");
    expect(high).toContain("Acme's");
  });
});
