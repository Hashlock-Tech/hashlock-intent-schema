/**
 * Agent principal flow — the killer feature.
 *
 * A single KYC'd institution ("Acme Capital") spawns multiple blind
 * agent instances, each with its own rotating pseudonym. The
 * principal is onboarded once. Counterparties see only the blind ID
 * and the attested tier. The market sees nothing.
 *
 * Run:
 *   npx tsx examples/agent-principal-flow.ts
 */

import {
  IntentBuilder,
  IntentValidator,
  IntentCommitter,
  explainIntent,
} from "../src/index.js";
import type { PrincipalAttestation } from "../src/index.js";

// ── Principal onboarding (happens once, off-stage) ──────────

const ACME_PRINCIPAL_ID = "pr_acme_capital_001";
const ACME_TIER = "INSTITUTIONAL" as const;

// Each agent gets a fresh attestation from the gateway. In
// production this is issued by an off-chain signer (HSM / KMS) and
// the `proof` field is the signature or ZK proof over (principalId,
// tier, blindId, issuedAt, expiresAt).
function issueAttestation(
  blindId: string
): PrincipalAttestation {
  const now = Math.floor(Date.now() / 1000);
  return {
    principalId: ACME_PRINCIPAL_ID,
    principalType: "INSTITUTION",
    tier: ACME_TIER,
    blindId,
    issuedAt: now,
    expiresAt: now + 3600,
    proof: `0x${"ab".repeat(32)}`, // gateway-signed, opaque to counterparty
  };
}

// ── Agent instances ─────────────────────────────────────────

const agents = [
  { blindId: "ag_5g7k92bq", strategy: "mm-eth-usdc", pairs: ["ETH/USDC"] },
  { blindId: "ag_x8n4pqr2", strategy: "arb-btc-usdt", pairs: ["BTC/USDT"] },
  { blindId: "ag_m1v9s6kd", strategy: "basis-sol-usdc", pairs: ["SOL/USDC"] },
];

// ── Each agent produces an intent ──────────────────────────

function buildAgentIntent(agent: (typeof agents)[number]) {
  return new IntentBuilder()
    .give({ asset: "ETH", amount: "5000000000000000000", chain: 1 }) // 5 ETH
    .receive({
      asset: "ERC20",
      token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      minAmount: "15000000000", // 15000 USDC
      chain: 1,
    })
    .deadline(600) // 10 min
    .maxSlippage(0.005) // 0.5%
    .minCounterpartyTier("STANDARD") // only KYC'd peers
    .attestation(issueAttestation(agent.blindId))
    .agentInstance({
      instanceId: agent.blindId,
      strategy: agent.strategy,
      version: "1.0.0",
    })
    .solver("open")
    .strategy("best_price")
    .settlement("bilateral")
    .build();
}

// ── Run ─────────────────────────────────────────────────────

async function main() {
  const validator = new IntentValidator();
  const committer = new IntentCommitter();

  for (const agent of agents) {
    console.log(`\n━━ Agent ${agent.blindId} (${agent.strategy}) ━━`);

    const intent = buildAgentIntent(agent);

    const result = validator.validate(intent);
    if (!result.valid) {
      console.error("validation failed:", result.errors);
      continue;
    }

    // Blind commit: amounts hidden, identity hidden. Only tier is
    // visible so the solver can match compliance-tier requirements.
    const commitment = await committer.commit(intent, {
      hideAmounts: true,
      hideCounterparty: true,
      hideIdentity: true,
      revealOnMatch: false,
    });

    console.log("intent.id            =", intent.id);
    console.log("attestation.tier     =", intent.attestation?.tier);
    console.log("attestation.principal=", intent.attestation?.principalId, "(hidden from counterparty)");
    console.log("attestation.blindId  =", intent.attestation?.blindId, "(stripped from sealed proof)");
    console.log("");
    console.log("solver-proof view (what the counterparty sees):");
    console.log("  commitmentHash     =", commitment.proof.commitmentHash);
    console.log("  attestationTier    =", commitment.proof.attestationTier);
    console.log("  attestationBlindId =", commitment.proof.attestationBlindId, "← null in sealed mode");
    console.log("  giveAmount         =", commitment.proof.giveAmount, "← null in sealed mode");
    console.log("  minCounterpartyTier=", commitment.proof.minCounterpartyTier);
    console.log("");
    console.log(explainIntent(intent));
  }

  console.log("\n━━ Summary ━━");
  console.log(`Principal: ${ACME_PRINCIPAL_ID} (tier: ${ACME_TIER}, KYC once)`);
  console.log(`Agents:    ${agents.length} blind instances`);
  console.log(`Exposure:  gateway sees principal; counterparty sees tier only`);
  console.log(`Market:    on-chain commitment hashes only, no amounts`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
