/**
 * Natural Language Intent Parsing
 *
 * AI agents can express trading intent in natural language.
 * The parser extracts structured data from text.
 *
 * Supports both Turkish and English.
 */
import {
  IntentParser,
  IntentValidator,
  explainIntent,
} from "@hashlock/intent-schema";

const parser = new IntentParser();
const validator = new IntentValidator();

async function parseAndShow(text: string) {
  console.log(`\nInput: "${text}"`);
  console.log("─".repeat(60));

  try {
    const result = await parser.fromText(text);

    console.log(`Confidence: ${(result.confidence * 100).toFixed(0)}%`);
    if (result.ambiguities.length > 0) {
      console.log("Ambiguities:", result.ambiguities);
    }

    const validation = validator.validate(result.intent);
    console.log("Valid:", validation.valid);

    console.log("\n" + explainIntent(result.intent));
  } catch (e) {
    console.error("Parse error:", (e as Error).message);
  }
}

async function main() {
  // Turkish examples
  await parseAndShow(
    "0.1 ETH karşılığı en az 300 USDC al, 1 saat içinde, slippage max yarım puan"
  );

  await parseAndShow(
    "0.5 ETH ver 1500 USDT al 30 dakika, piyasa sakinleşince execute et"
  );

  // English examples
  await parseAndShow("swap 1 ETH for 3000 USDC within 2 hours");

  await parseAndShow("sell 0.05 WBTC for 1500 DAI in 1 day");

  // Ambiguous — should fail
  await parseAndShow("buy some tokens");
}

main().catch(console.error);
