import { describe, it, expect } from "vitest";
import { IntentBuilder } from "../src/builder/IntentBuilder.js";
import {
  IntentCommitter,
  explainIntent,
} from "../src/committer/IntentCommitter.js";

describe("IntentCommitter", () => {
  const committer = new IntentCommitter();

  function buildTestIntent() {
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

  it("creates a commitment with hash and proof", async () => {
    const intent = buildTestIntent();
    const commitment = await committer.commit(intent);

    expect(commitment.hash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(commitment.proof.intentId).toBe(intent.id);
    expect(commitment.proof.commitmentHash).toBe(commitment.hash);
    expect(commitment.intent).toBe(intent);
    expect(commitment.committedAt).toBeGreaterThan(0);
  });

  it("proof includes visible fields by default", async () => {
    const intent = buildTestIntent();
    const commitment = await committer.commit(intent);

    expect(commitment.proof.giveAmount).toBe(intent.give.amount);
    expect(commitment.proof.receiveMinAmount).toBe(intent.receive.minAmount);
    expect(commitment.proof.giveAsset).toBe("ETH");
    expect(commitment.proof.receiveAsset).toBe("ERC20");
  });

  it("hides amounts when requested", async () => {
    const intent = buildTestIntent();
    const commitment = await committer.commit(intent, {
      hideAmounts: true,
    });

    expect(commitment.proof.giveAmount).toBeNull();
    expect(commitment.proof.receiveMinAmount).toBeNull();
    // Asset types still visible
    expect(commitment.proof.giveAsset).toBe("ETH");
  });

  it("hides counterparty when requested", async () => {
    const intent = new IntentBuilder()
      .give({ asset: "ETH", amount: "1000000000000000000", chain: 1 })
      .receive({
        asset: "ERC20",
        token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        minAmount: "3000000000",
        chain: 1,
      })
      .deadline(3600)
      .solver("open")
      .settlement("ring", ["0xa", "0xb", "0xc"])
      .build();

    const commitment = await committer.commit(intent, {
      hideCounterparty: true,
    });

    expect(commitment.proof.settlement.ringParties).toBeUndefined();
  });

  it("same intent produces same hash", async () => {
    const intent = buildTestIntent();
    const c1 = await committer.commit(intent);
    const c2 = await committer.commit(intent);

    expect(c1.hash).toBe(c2.hash);
  });

  it("different intents produce different hashes", async () => {
    const i1 = buildTestIntent();
    const i2 = buildTestIntent(); // different id + nonce

    const c1 = await committer.commit(i1);
    const c2 = await committer.commit(i2);

    expect(c1.hash).not.toBe(c2.hash);
  });

  it("verify returns true for matching hash", async () => {
    const intent = buildTestIntent();
    const commitment = await committer.commit(intent);

    expect(committer.verify(intent, commitment.hash)).toBe(true);
  });

  it("verify returns false for wrong hash", () => {
    const intent = buildTestIntent();
    expect(committer.verify(intent, "0xwronghash")).toBe(false);
  });

  it("uses provider to submit on-chain", async () => {
    const txHash = "0xtx123";
    const mockProvider = {
      submitCommitment: async () => txHash,
    };
    const providerCommitter = new IntentCommitter(mockProvider);
    const intent = buildTestIntent();

    // Should not throw
    const commitment = await providerCommitter.commit(intent);
    expect(commitment.hash).toBeTruthy();
  });
});

describe("explainIntent", () => {
  it("generates human-readable explanation", () => {
    const intent = new IntentBuilder()
      .give({ asset: "ETH", amount: "100000000000000000", chain: 1 })
      .receive({
        asset: "ERC20",
        token: "0xUSDC",
        minAmount: "300000000",
        chain: 1,
      })
      .deadline(3600)
      .maxSlippage(0.005)
      .solver("open")
      .settlement("bilateral")
      .trigger({
        type: "conditional",
        description: "volatility spike > 5%",
      })
      .build();

    const text = explainIntent(intent);

    expect(text).toContain("100000000000000000 ETH");
    expect(text).toContain("300000000 ERC20");
    expect(text).toContain("0.50%");
    expect(text).toContain("open");
    expect(text).toContain("bilateral");
    expect(text).toContain("conditional");
    expect(text).toContain("volatility spike > 5%");
  });

  it("notes cross-chain intents", () => {
    const intent = new IntentBuilder()
      .give({ asset: "ETH", amount: "1000000000000000000", chain: 1 })
      .receive({
        asset: "ERC20",
        token: "0xUSDC",
        minAmount: "3000000000",
        chain: 42161,
      })
      .deadline(3600)
      .solver("open")
      .settlement("bilateral")
      .build();

    const text = explainIntent(intent);
    expect(text).toContain("Cross-chain: 1 → 42161");
  });
});
