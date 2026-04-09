/**
 * Ring Settlement Example
 *
 * Three parties form a ring:
 *   Alice: ETH → USDC
 *   Bob: USDC → WBTC
 *   Carol: WBTC → ETH
 *
 * Each party creates an intent specifying the ring.
 * Solver coordinates atomic execution via HashLock.
 */
import { IntentBuilder, IntentValidator } from "@hashlock/intent-schema";

// Alice gives ETH, wants USDC
const aliceIntent = new IntentBuilder()
  .give({ asset: "ETH", amount: "1000000000000000000", chain: 1 })
  .receive({
    asset: "ERC20",
    token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    minAmount: "3000000000", // 3000 USDC
    chain: 1,
  })
  .deadline(7200) // 2 hours
  .solver("preferred", ["0xTrustedSolver"])
  .settlement("ring", ["0xAlice", "0xBob", "0xCarol"])
  .atomicity("full") // all or nothing
  .build();

// Bob gives USDC, wants WBTC
const bobIntent = new IntentBuilder()
  .give({
    asset: "ERC20",
    token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    amount: "3000000000",
    chain: 1,
  })
  .receive({
    asset: "ERC20",
    token: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", // WBTC
    minAmount: "5000000", // 0.05 WBTC (8 decimals)
    chain: 1,
  })
  .deadline(7200)
  .solver("preferred", ["0xTrustedSolver"])
  .settlement("ring", ["0xAlice", "0xBob", "0xCarol"])
  .atomicity("full")
  .build();

// Carol gives WBTC, wants ETH
const carolIntent = new IntentBuilder()
  .give({
    asset: "ERC20",
    token: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    amount: "5000000",
    chain: 1,
  })
  .receive({
    asset: "ETH",
    minAmount: "900000000000000000", // 0.9 ETH
    chain: 1,
  })
  .deadline(7200)
  .solver("preferred", ["0xTrustedSolver"])
  .settlement("ring", ["0xAlice", "0xBob", "0xCarol"])
  .atomicity("full")
  .build();

// Validate all
const validator = new IntentValidator();
const results = [aliceIntent, bobIntent, carolIntent].map((i) =>
  validator.validate(i)
);

console.log("All valid:", results.every((r) => r.valid));
results.forEach((r, i) => {
  if (!r.valid) console.log(`Intent ${i} errors:`, r.errors);
});
