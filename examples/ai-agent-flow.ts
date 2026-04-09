/**
 * AI Agent Flow — Full Lifecycle
 *
 * 1. Agent monitors market (Trigger Layer)
 * 2. Agent produces intent when condition met (Intent Layer)
 * 3. Intent committed on-chain
 * 4. Solver matches and executes via HashLock (Settlement Layer)
 */
import {
  IntentBuilder,
  IntentValidator,
  IntentCommitter,
  explainIntent,
} from "@hashlock/intent-schema";

// ── 1. Trigger Layer (simulated) ─────────────────────────────

async function simulateMarketMonitor() {
  // In reality: WebSocket feed, API polling, on-chain events
  const volatility = 0.07; // 7% — above our 5% threshold
  const ethPrice = 3200;
  const isOpportunity = volatility > 0.05;

  return { isOpportunity, volatility, ethPrice };
}

// ── 2. Intent Layer ──────────────────────────────────────────

async function createAgentIntent() {
  const market = await simulateMarketMonitor();

  if (!market.isOpportunity) {
    console.log("No opportunity detected. Standing by.");
    return null;
  }

  console.log(
    `Opportunity detected: volatility ${(market.volatility * 100).toFixed(1)}%`
  );

  // Agent creates intent based on market analysis
  const intent = new IntentBuilder()
    .give({
      asset: "ETH",
      amount: "500000000000000000", // 0.5 ETH
      chain: 1,
    })
    .receive({
      asset: "ERC20",
      token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      minAmount: String(Math.floor(market.ethPrice * 0.5 * 0.995 * 1e6)), // 0.5% below spot
      chain: 1,
    })
    .deadline(1800) // 30 minutes — tight window
    .maxSlippage(0.003) // 0.3% — agent is aggressive
    .solver("open")
    .strategy("best_price")
    .settlement("bilateral")
    .trigger({
      type: "conditional",
      description: `volatility spike ${(market.volatility * 100).toFixed(1)}% > 5% threshold`,
      agentId: "agent-alpha-001",
      confidence: 0.85,
    })
    .build();

  // Validate before committing
  const validator = new IntentValidator();
  const validation = validator.validate(intent);

  if (!validation.valid) {
    console.error("Intent validation failed:", validation.errors);
    return null;
  }

  if (validation.warnings.length > 0) {
    console.warn("Warnings:", validation.warnings);
  }

  return intent;
}

// ── 3. Commit & Send to Solver ───────────────────────────────

async function main() {
  const intent = await createAgentIntent();
  if (!intent) return;

  console.log("\n=== Intent Created ===");
  console.log(explainIntent(intent));

  // Commit off-chain (no provider = no on-chain tx)
  const committer = new IntentCommitter();
  const commitment = await committer.commit(intent, {
    hideAmounts: false, // solver needs to see amounts
    revealOnMatch: true,
  });

  console.log("\n=== Commitment ===");
  console.log("Hash:", commitment.hash);
  console.log("Proof for solver:", JSON.stringify(commitment.proof, null, 2));

  // In production: send commitment.proof to solver network
  // solver.submitIntent(commitment.proof)
}

main().catch(console.error);
