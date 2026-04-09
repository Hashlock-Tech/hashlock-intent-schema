import { describe, it, expect } from "vitest";
import { IntentParser, IntentParseError } from "../src/parser/IntentParser.js";

describe("IntentParser", () => {
  const parser = new IntentParser();

  it("parses Turkish natural language intent", async () => {
    const result = await parser.fromText(
      "0.1 ETH karşılığı en az 300 USDC al, " +
        "1 saat içinde, slippage max yarım puan"
    );

    expect(result.intent.give.asset).toBe("ETH");
    expect(result.intent.give.amount).toBe("100000000000000000"); // 0.1 ETH in wei
    expect(result.intent.receive.asset).toBe("ERC20");
    expect(result.intent.receive.minAmount).toBe("300000000"); // 300 USDC (6 decimals)
    expect(result.intent.conditions.maxSlippage).toBe(0.005);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("parses English natural language intent", async () => {
    const result = await parser.fromText(
      "swap 1 ETH for 3000 USDC within 2 hours"
    );

    expect(result.intent.give.asset).toBe("ETH");
    expect(result.intent.receive.asset).toBe("ERC20");
    expect(result.intent.receive.token).toBe(
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
    );
  });

  it("extracts deadline from Turkish text", async () => {
    const result = await parser.fromText("0.5 ETH ver 1500 USDT al 30 dakika");
    // 30 minutes = 1800 seconds from now
    const now = Math.floor(Date.now() / 1000);
    expect(result.intent.conditions.deadline).toBeGreaterThan(now + 1700);
    expect(result.intent.conditions.deadline).toBeLessThan(now + 1900);
  });

  it("detects conditional trigger", async () => {
    const result = await parser.fromText(
      "0.1 ETH karşılığı 300 USDC al, piyasa sakinleşince"
    );

    expect(result.intent.trigger).toBeDefined();
    expect(result.intent.trigger?.type).toBe("conditional");
  });

  it("throws on ambiguous input (single asset)", async () => {
    await expect(parser.fromText("buy some tokens")).rejects.toThrow(
      IntentParseError
    );
  });

  it("adds ambiguity warnings for missing deadline", async () => {
    const result = await parser.fromText("0.1 ETH ver 300 USDC al");
    expect(result.ambiguities.length).toBeGreaterThan(0);
    expect(result.ambiguities.some((a) => a.includes("deadline"))).toBe(true);
  });

  it("supports custom chain via defaults", async () => {
    const result = await parser.fromText("0.1 ETH karşılığı 300 USDC al 1 saat", {
      chainId: 42161,
    });

    expect(result.intent.give.chain).toBe(42161);
    expect(result.intent.receive.chain).toBe(42161);
  });

  it("handles USDT token", async () => {
    const result = await parser.fromText("1 ETH ver 3000 USDT al 1 hour");
    expect(result.intent.receive.token).toBe(
      "0xdAC17F958D2ee523a2206206994597C13D831ec7"
    );
  });

  it("handles DAI token", async () => {
    const result = await parser.fromText("0.5 ETH ver 1500 DAI al 2 hours");
    expect(result.intent.receive.token).toBe(
      "0x6B175474E89094C44Da98b954EedeAC495271d0F"
    );
    // DAI has 18 decimals
    expect(result.intent.receive.minAmount).toBe("1500000000000000000000");
  });
});
