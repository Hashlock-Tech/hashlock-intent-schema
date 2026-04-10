import { describe, it, expect } from "vitest";
import { IntentBuilder } from "../src/builder/IntentBuilder.js";
import { IntentValidator } from "../src/validator/IntentValidator.js";
import { IntentCommitter } from "../src/committer/IntentCommitter.js";
import { meetsKycTier, KYC_TIER_RANK } from "../src/types/principal.js";
import type { PrincipalAttestation } from "../src/types/index.js";

// ── Helpers ──────────────────────────────────────────────────

function futureAttestation(
  overrides: Partial<PrincipalAttestation> = {}
): PrincipalAttestation {
  const now = Math.floor(Date.now() / 1000);
  return {
    principalId: "pr_acme001",
    principalType: "INSTITUTION",
    tier: "ENHANCED",
    blindId: "ag_5g7k92bq",
    issuedAt: now - 10,
    expiresAt: now + 3600,
    proof: "0xdeadbeef",
    ...overrides,
  };
}

function baseBuilder() {
  return new IntentBuilder()
    .give({ asset: "ETH", amount: "1000000000000000000", chain: 1 })
    .receive({
      asset: "ERC20",
      token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      minAmount: "3000000000",
      chain: 1,
    })
    .deadline(3600)
    .solver("open")
    .settlement("bilateral");
}

// ── KYC Tier helpers ─────────────────────────────────────────

describe("KYC Tier helpers", () => {
  it("ranks tiers from NONE to INSTITUTIONAL", () => {
    expect(KYC_TIER_RANK.NONE).toBe(0);
    expect(KYC_TIER_RANK.BASIC).toBe(1);
    expect(KYC_TIER_RANK.STANDARD).toBe(2);
    expect(KYC_TIER_RANK.ENHANCED).toBe(3);
    expect(KYC_TIER_RANK.INSTITUTIONAL).toBe(4);
  });

  it("meetsKycTier returns true when actual >= required", () => {
    expect(meetsKycTier("ENHANCED", "STANDARD")).toBe(true);
    expect(meetsKycTier("STANDARD", "STANDARD")).toBe(true);
    expect(meetsKycTier("INSTITUTIONAL", "ENHANCED")).toBe(true);
  });

  it("meetsKycTier returns false when actual < required", () => {
    expect(meetsKycTier("BASIC", "ENHANCED")).toBe(false);
    expect(meetsKycTier("NONE", "BASIC")).toBe(false);
  });
});

// ── Backward compatibility ───────────────────────────────────

describe("Backward compatibility — intents without attestation", () => {
  const validator = new IntentValidator();

  it("human intent without attestation still validates", () => {
    const intent = baseBuilder().build();
    const result = validator.validate(intent);
    expect(result.valid).toBe(true);
  });

  it("intent without principal fields does not break committer", async () => {
    const intent = baseBuilder().build();
    const committer = new IntentCommitter();
    const commitment = await committer.commit(intent);
    expect(commitment.proof.attestationTier).toBeNull();
    expect(commitment.proof.attestationBlindId).toBeNull();
    expect(commitment.proof.minCounterpartyTier).toBeNull();
  });
});

// ── Builder with attestation ─────────────────────────────────

describe("IntentBuilder — attestation + agent instance", () => {
  it("accepts attestation", () => {
    const att = futureAttestation();
    const intent = baseBuilder().attestation(att).build();

    expect(intent.attestation).toBeDefined();
    expect(intent.attestation?.principalId).toBe("pr_acme001");
    expect(intent.attestation?.tier).toBe("ENHANCED");
    expect(intent.attestation?.blindId).toBe("ag_5g7k92bq");
  });

  it("accepts agent instance paired with attestation", () => {
    const att = futureAttestation({ principalType: "AGENT" });
    const intent = baseBuilder()
      .attestation(att)
      .agentInstance({
        instanceId: "ag_5g7k92bq",
        strategy: "mm-eth-usdc",
        version: "1.2.3",
      })
      .build();

    expect(intent.agentInstance).toBeDefined();
    expect(intent.agentInstance?.strategy).toBe("mm-eth-usdc");
  });

  it("accepts minCounterpartyTier", () => {
    const intent = baseBuilder()
      .minCounterpartyTier("INSTITUTIONAL")
      .build();
    expect(intent.conditions.minCounterpartyTier).toBe("INSTITUTIONAL");
  });
});

// ── Validator — attestation rules ────────────────────────────

describe("IntentValidator — attestation rules", () => {
  const validator = new IntentValidator();

  it("rejects expired attestation", () => {
    const now = Math.floor(Date.now() / 1000);
    const att = futureAttestation({
      issuedAt: now - 7200,
      expiresAt: now - 3600,
    });
    const intent = baseBuilder().attestation(att).build();

    const result = validator.validate(intent);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("attestation has expired");
  });

  it("warns when attestation expires soon", () => {
    const now = Math.floor(Date.now() / 1000);
    const att = futureAttestation({
      issuedAt: now - 10,
      expiresAt: now + 60,
    });
    const intent = baseBuilder().attestation(att).build();

    const result = validator.validate(intent);
    expect(result.warnings).toContain(
      "attestation expires in less than 5 minutes"
    );
  });

  it("rejects future-dated issuedAt", () => {
    const now = Math.floor(Date.now() / 1000);
    const att = futureAttestation({
      issuedAt: now + 300,
      expiresAt: now + 7200,
    });
    const intent = baseBuilder().attestation(att).build();

    const result = validator.validate(intent);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("attestation issuedAt is in the future");
  });

  it("rejects agent instance without attestation", () => {
    const intent = baseBuilder()
      .agentInstance({ instanceId: "ag_orphan" })
      .build();

    const result = validator.validate(intent);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.startsWith("agentInstance requires attestation")
      )
    ).toBe(true);
  });

  it("rejects agent instance with HUMAN principal", () => {
    const att = futureAttestation({ principalType: "HUMAN" });
    const intent = baseBuilder()
      .attestation(att)
      .agentInstance({ instanceId: "ag_bad" })
      .build();

    const result = validator.validate(intent);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.includes("principalType to be AGENT or INSTITUTION")
      )
    ).toBe(true);
  });

  it("rejects asymmetric tier — signer below required counterparty tier", () => {
    const att = futureAttestation({ tier: "STANDARD" });
    const intent = baseBuilder()
      .attestation(att)
      .minCounterpartyTier("ENHANCED")
      .build();

    const result = validator.validate(intent);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes("asymmetric tier"))
    ).toBe(true);
  });

  it("accepts matching tier — signer tier equals counterparty requirement", () => {
    const att = futureAttestation({ tier: "ENHANCED" });
    const intent = baseBuilder()
      .attestation(att)
      .minCounterpartyTier("ENHANCED")
      .build();

    const result = validator.validate(intent);
    expect(result.valid).toBe(true);
  });

  it("accepts signer tier above counterparty requirement", () => {
    const att = futureAttestation({ tier: "INSTITUTIONAL" });
    const intent = baseBuilder()
      .attestation(att)
      .minCounterpartyTier("ENHANCED")
      .build();

    const result = validator.validate(intent);
    expect(result.valid).toBe(true);
  });
});

// ── Committer — blind + hideIdentity ─────────────────────────

describe("IntentCommitter — selective disclosure with identity", () => {
  it("exposes tier and blindId by default when attestation present", async () => {
    const att = futureAttestation();
    const intent = baseBuilder().attestation(att).build();

    const committer = new IntentCommitter();
    const commitment = await committer.commit(intent);

    expect(commitment.proof.attestationTier).toBe("ENHANCED");
    expect(commitment.proof.attestationBlindId).toBe("ag_5g7k92bq");
  });

  it("hideIdentity strips blindId but keeps tier", async () => {
    const att = futureAttestation();
    const intent = baseBuilder().attestation(att).build();

    const committer = new IntentCommitter();
    const commitment = await committer.commit(intent, { hideIdentity: true });

    expect(commitment.proof.attestationTier).toBe("ENHANCED");
    expect(commitment.proof.attestationBlindId).toBeNull();
  });

  it("never leaks principalId into solver proof", async () => {
    const att = futureAttestation();
    const intent = baseBuilder().attestation(att).build();

    const committer = new IntentCommitter();
    const commitment = await committer.commit(intent);

    const proofJson = JSON.stringify(commitment.proof);
    expect(proofJson).not.toContain("pr_acme001");
    expect(proofJson).not.toContain("0xdeadbeef");
  });

  it("full sealed-bid mode hides amounts + counterparty + identity", async () => {
    const att = futureAttestation();
    const intent = baseBuilder()
      .attestation(att)
      .settlement("ring", ["0xa", "0xb", "0xc"])
      .build();

    const committer = new IntentCommitter();
    const commitment = await committer.commit(intent, {
      hideAmounts: true,
      hideCounterparty: true,
      hideIdentity: true,
      revealOnMatch: false,
    });

    expect(commitment.proof.giveAmount).toBeNull();
    expect(commitment.proof.receiveMinAmount).toBeNull();
    expect(commitment.proof.settlement.ringParties).toBeUndefined();
    expect(commitment.proof.attestationBlindId).toBeNull();
    // Tier remains visible — solver still filters on compliance
    expect(commitment.proof.attestationTier).toBe("ENHANCED");
  });

  it("hash excludes attestation.proof but includes attestation metadata", async () => {
    const att1 = futureAttestation({ proof: "0xaaaa" });
    const att2 = futureAttestation({ proof: "0xbbbb" });
    const intent1 = baseBuilder().attestation(att1).build();
    const intent2 = baseBuilder().attestation(att2).build();

    const committer = new IntentCommitter();
    // Match ids so only attestation differs
    intent2.id = intent1.id;
    intent2.nonce = intent1.nonce;
    intent2.createdAt = intent1.createdAt;

    const c1 = await committer.commit(intent1);
    const c2 = await committer.commit(intent2);

    // Different proofs, same hash (proof field is stripped before hashing)
    expect(c1.hash).toBe(c2.hash);
  });

  it("hash differs if attestation tier is substituted", async () => {
    const att1 = futureAttestation({ tier: "STANDARD" });
    const att2 = futureAttestation({ tier: "ENHANCED" });
    const intent1 = baseBuilder().attestation(att1).build();
    const intent2 = baseBuilder().attestation(att2).build();

    intent2.id = intent1.id;
    intent2.nonce = intent1.nonce;
    intent2.createdAt = intent1.createdAt;

    const committer = new IntentCommitter();
    const c1 = await committer.commit(intent1);
    const c2 = await committer.commit(intent2);

    // Tier is part of the hash — substitution attacks are detected
    expect(c1.hash).not.toBe(c2.hash);
  });
});
