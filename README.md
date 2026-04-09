# @hashlock/intent-schema

> The death of the order book. The birth of intent-based Walrasian clearing.

This schema is designed for a world where static limit orders are replaced by **dynamic preference functions** — intents produced by AI agents, consumed by solvers, and executed atomically by HashLock.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  TRIGGER LAYER (off-chain)                              │
│  AI agents monitor markets, detect opportunities,       │
│  produce intents when conditions are met                │
│  "Volatility spike > 5%, buy now"                       │
└──────────────────────┬──────────────────────────────────┘
                       │ intent
┌──────────────────────▼──────────────────────────────────┐
│  INTENT LAYER (this package)                            │
│  Defines settlement conditions as a preference function │
│  Off-chain creation, optional on-chain commitment       │
│  Solver reads and matches intents                       │
└──────────────────────┬──────────────────────────────────┘
                       │ matched intent
┌──────────────────────▼──────────────────────────────────┐
│  SETTLEMENT LAYER (HashLock)                            │
│  Executes intent via HTLC                               │
│  Atomic guarantee: all-or-nothing                       │
│  Bilateral, ring, or batch settlement                   │
└─────────────────────────────────────────────────────────┘
```

## Install

```bash
npm install @hashlock/intent-schema
```

## Quick Start

```typescript
import { IntentBuilder, IntentValidator, explainIntent } from '@hashlock/intent-schema'

// Create an intent: swap 0.1 ETH for at least 300 USDC
const intent = new IntentBuilder()
  .give({ asset: "ETH", amount: "100000000000000000", chain: 1 })
  .receive({
    asset: "ERC20",
    token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    minAmount: "300000000",
    chain: 1,
  })
  .deadline(3600)         // 1 hour
  .maxSlippage(0.005)     // 0.5%
  .solver("open")         // any solver
  .settlement("bilateral")
  .build()

// Validate
const validator = new IntentValidator()
const result = validator.validate(intent)
// { valid: true, errors: [], warnings: [] }

// Explain
console.log(explainIntent(intent))
```

## Natural Language

AI agents can express intent in natural language:

```typescript
import { IntentParser } from '@hashlock/intent-schema'

const parser = new IntentParser()

const result = await parser.fromText(
  "0.1 ETH karşılığı en az 300 USDC al, " +
  "1 saat içinde, slippage max yarım puan, " +
  "piyasa sakinleşince execute et"
)

console.log(result.intent)       // HashLockIntent
console.log(result.confidence)   // 0.85
console.log(result.ambiguities)  // ["no deadline specified..."]
```

## On-Chain Commitment

```typescript
import { IntentCommitter } from '@hashlock/intent-schema'

const committer = new IntentCommitter()

const commitment = await committer.commit(intent, {
  hideAmounts: true,       // privacy: hide amounts
  hideCounterparty: true,  // privacy: hide parties
  revealOnMatch: true,     // reveal when matched
})

// commitment.hash  → on-chain (sha256, future: Poseidon)
// commitment.proof → solver (selective disclosure)
```

## Validation Rules

The `IntentValidator` checks:

| Rule | Type |
|------|------|
| Schema structure (Zod) | Error |
| Deadline not expired | Error |
| Amount > 0 | Error |
| No self-swap | Error |
| Ring has 2+ parties | Error |
| maxAmount >= minAmount | Error |
| Tight deadline (< 60s) | Warning |
| Cross-chain | Warning |
| High slippage (> 10%) | Warning |
| Missing token address | Warning |
| Unknown chain | Warning |

## Settlement Types

| Type | Description |
|------|-------------|
| `bilateral` | Direct 1:1 swap via HTLC |
| `ring` | Multi-party circular settlement |
| `batch` | Batch clearing (Walrasian) |

## Why Not an Order Book?

An order book is a static snapshot: "I want to buy X at price Y." It doesn't capture:

- **Conditional preferences**: "Buy only if volatility > 5%"
- **Cross-chain atomicity**: "ETH on mainnet for USDC on Arbitrum"
- **Solver competition**: "Find me the best execution, not just the best price"
- **Privacy**: "Commit to trade without revealing amounts"
- **AI-native flow**: "Agent detects opportunity → intent → solver → settlement"

A **HashLockIntent** is a dynamic preference function. It says: "Here's what I want, here are my constraints, find the best way to satisfy them atomically."

This is the Walrasian vision: every participant declares their preference function, and the market clears simultaneously.

## License

MIT
