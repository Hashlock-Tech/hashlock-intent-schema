/**
 * Simple ETH → USDC swap intent
 *
 * Most basic use case: swap 0.1 ETH for at least 300 USDC
 * on Ethereum mainnet within 1 hour.
 */
import {
  IntentBuilder,
  IntentValidator,
  explainIntent,
} from "@hashlock/intent-schema";

const intent = new IntentBuilder()
  .give({
    asset: "ETH",
    amount: "100000000000000000", // 0.1 ETH in wei
    chain: 1,
  })
  .receive({
    asset: "ERC20",
    token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
    minAmount: "300000000", // 300 USDC (6 decimals)
    chain: 1,
  })
  .deadline(3600) // 1 hour from now
  .maxSlippage(0.005) // 0.5%
  .solver("open") // any solver can fill
  .settlement("bilateral")
  .build();

// Validate
const validator = new IntentValidator();
const result = validator.validate(intent);

console.log("Valid:", result.valid);
console.log("Errors:", result.errors);
console.log("Warnings:", result.warnings);

// Human-readable
console.log("\n" + explainIntent(intent));
