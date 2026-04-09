import { describe, it, expect } from "vitest";
import { IntentBuilder } from "../src/builder/IntentBuilder.js";
import { IntentValidator } from "../src/validator/IntentValidator.js";

describe("IntentValidator", () => {
  const validator = new IntentValidator();

  function validIntent() {
    return new IntentBuilder()
      .give({ asset: "ETH", amount: "100000000000000000", chain: 1 })
      .receive({
        asset: "ERC20",
        token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        minAmount: "300000000",
        chain: 1,
      })
      .deadline(3600)
      .maxSlippage(0.005)
      .solver("open")
      .settlement("bilateral")
      .build();
  }

  it("validates a correct intent", () => {
    const result = validator.validate(validIntent());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects invalid schema", () => {
    const result = validator.validate({ garbage: true });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects expired deadline", () => {
    const intent = validIntent();
    intent.conditions.deadline = Math.floor(Date.now() / 1000) - 100;

    const result = validator.validate(intent);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("deadline has already passed");
  });

  it("warns on tight deadline", () => {
    const intent = validIntent();
    intent.conditions.deadline = Math.floor(Date.now() / 1000) + 30;

    const result = validator.validate(intent);
    expect(result.warnings).toContain(
      "deadline is less than 60 seconds away"
    );
  });

  it("rejects zero give amount", () => {
    const intent = validIntent();
    intent.give.amount = "0";

    const result = validator.validate(intent);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("give.amount must be greater than 0");
  });

  it("rejects self-swap (same asset, token, chain)", () => {
    const intent = new IntentBuilder()
      .give({ asset: "ETH", amount: "1000000000000000000", chain: 1 })
      .receive({ asset: "ETH", minAmount: "1000000000000000000", chain: 1 })
      .deadline(3600)
      .solver("open")
      .settlement("bilateral")
      .build();

    const result = validator.validate(intent);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "give and receive are identical — self-swap not allowed"
    );
  });

  it("warns on cross-chain intent", () => {
    const intent = new IntentBuilder()
      .give({ asset: "ETH", amount: "1000000000000000000", chain: 1 })
      .receive({
        asset: "ERC20",
        token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        minAmount: "300000000",
        chain: 42161,
      })
      .deadline(3600)
      .solver("open")
      .settlement("bilateral")
      .build();

    const result = validator.validate(intent);
    expect(result.warnings).toContain(
      "cross-chain intent — solver must support bridging"
    );
  });

  it("warns on high slippage", () => {
    const intent = validIntent();
    intent.conditions.maxSlippage = 0.15;

    const result = validator.validate(intent);
    expect(result.warnings).toContain("maxSlippage > 10% — unusually high");
  });

  it("warns on missing token address for ERC20", () => {
    const intent = new IntentBuilder()
      .give({ asset: "ERC20", amount: "1000000", chain: 1 })
      .receive({ asset: "ETH", minAmount: "1000000000000000000", chain: 1 })
      .deadline(3600)
      .solver("open")
      .settlement("bilateral")
      .build();

    const result = validator.validate(intent);
    expect(result.warnings).toContain(
      "give.asset is ERC20/ERC721 but no token address provided"
    );
  });

  it("rejects ring settlement without parties", () => {
    const intent = new IntentBuilder()
      .give({ asset: "ETH", amount: "1000000000000000000", chain: 1 })
      .receive({
        asset: "ERC20",
        token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        minAmount: "300000000",
        chain: 1,
      })
      .deadline(3600)
      .solver("open")
      .settlement("ring")
      .build();

    const result = validator.validate(intent);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "ring settlement requires at least 2 parties in ringParties"
    );
  });

  it("rejects maxAmount < minAmount", () => {
    const intent = validIntent();
    intent.receive.maxAmount = "100"; // less than minAmount of 300000000

    const result = validator.validate(intent);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "receive.maxAmount must be >= receive.minAmount"
    );
  });
});
