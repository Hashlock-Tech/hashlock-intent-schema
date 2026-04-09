import { describe, it, expect } from "vitest";
import { IntentBuilder } from "../src/builder/IntentBuilder.js";

describe("IntentBuilder", () => {
  function baseBuilder() {
    return new IntentBuilder()
      .give({ asset: "ETH", amount: "100000000000000000", chain: 1 })
      .receive({
        asset: "ERC20",
        token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        minAmount: "300000000",
        chain: 1,
      })
      .deadline(3600)
      .solver("open")
      .settlement("bilateral");
  }

  it("builds a valid intent with required fields", () => {
    const intent = baseBuilder().build();

    expect(intent.version).toBe("1.0");
    expect(intent.give.asset).toBe("ETH");
    expect(intent.give.amount).toBe("100000000000000000");
    expect(intent.receive.asset).toBe("ERC20");
    expect(intent.receive.minAmount).toBe("300000000");
    expect(intent.settlement.type).toBe("bilateral");
    expect(intent.settlement.atomicity).toBe("full");
    expect(intent.solver.type).toBe("open");
    expect(intent.solver.strategy).toBe("best_price");
  });

  it("generates unique id and nonce", () => {
    const a = baseBuilder().build();
    const b = baseBuilder().build();

    expect(a.id).not.toBe(b.id);
    expect(a.nonce).not.toBe(b.nonce);
  });

  it("sets optional fields", () => {
    const intent = baseBuilder()
      .maxSlippage(0.005)
      .partialFill()
      .counterparty(["0xabc", "0xdef"])
      .strategy("fastest")
      .atomicity("partial")
      .trigger({
        type: "conditional",
        description: "volatility > 5%",
        confidence: 0.9,
      })
      .build();

    expect(intent.conditions.maxSlippage).toBe(0.005);
    expect(intent.conditions.partialFill).toBe(true);
    expect(intent.conditions.counterparty).toEqual(["0xabc", "0xdef"]);
    expect(intent.solver.strategy).toBe("fastest");
    expect(intent.settlement.atomicity).toBe("partial");
    expect(intent.trigger?.type).toBe("conditional");
    expect(intent.trigger?.confidence).toBe(0.9);
  });

  it("throws if give is missing", () => {
    expect(() =>
      new IntentBuilder()
        .receive({ asset: "ETH", minAmount: "1", chain: 1 })
        .deadline(3600)
        .solver("open")
        .settlement("bilateral")
        .build()
    ).toThrow("give() is required");
  });

  it("throws if receive is missing", () => {
    expect(() =>
      new IntentBuilder()
        .give({ asset: "ETH", amount: "1", chain: 1 })
        .deadline(3600)
        .solver("open")
        .settlement("bilateral")
        .build()
    ).toThrow("receive() is required");
  });

  it("throws if deadline is missing", () => {
    expect(() =>
      new IntentBuilder()
        .give({ asset: "ETH", amount: "1", chain: 1 })
        .receive({ asset: "ERC20", token: "0x1", minAmount: "1", chain: 1 })
        .solver("open")
        .settlement("bilateral")
        .build()
    ).toThrow("deadline() is required");
  });

  it("sets chainId from give.chain", () => {
    const intent = baseBuilder().build();
    expect(intent.chainId).toBe(1);
  });

  it("allows explicit chainId override", () => {
    const intent = baseBuilder().chainId(42161).build();
    expect(intent.chainId).toBe(42161);
  });

  it("supports preferred solver with addresses", () => {
    const intent = baseBuilder()
      .solver("preferred", ["0xsolver1", "0xsolver2"])
      .build();

    expect(intent.solver.type).toBe("preferred");
    expect(intent.solver.preferred).toEqual(["0xsolver1", "0xsolver2"]);
  });

  it("supports ring settlement with parties", () => {
    const intent = baseBuilder()
      .settlement("ring", ["0xa", "0xb", "0xc"])
      .build();

    expect(intent.settlement.type).toBe("ring");
    expect(intent.settlement.ringParties).toEqual(["0xa", "0xb", "0xc"]);
  });

  it("supports solver max fee", () => {
    const intent = baseBuilder().solverMaxFee("1000000").build();
    expect(intent.solver.maxFee).toBe("1000000");
  });

  it("supports absolute deadline", () => {
    const future = Math.floor(Date.now() / 1000) + 7200;
    const intent = baseBuilder().deadlineAt(future).build();
    expect(intent.conditions.deadline).toBe(future);
  });
});
