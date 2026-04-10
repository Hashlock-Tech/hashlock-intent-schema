# @hashlock-tech/intent-schema

> **HashLock is a compliant dark pool. Humans and autonomous agents trade on the same venue, under separate identities. Your firm is KYC'd once; every agent instance stays blind.**

HashLock is an institutional OTC venue with atomic HTLC settlement across EVM, Bitcoin, and Sui. Human desks negotiate via OTC, RFQ, and blind auction today. Autonomous trading agents are being layered on the same infrastructure — not replacing human traders, but joining them on shared rails.

This package defines the intent primitive shared between both user classes: the structured, versioned, cryptographically-committable object that every trade is derived from, whether produced by a human click or an agent loop.

## What's different about HashLock

| | Binance | Uniswap | CoW Protocol | Sigma X (TradFi) | **HashLock** |
|---|---|---|---|---|---|
| Compliant (KYC at gate) | ✅ | ❌ | ❌ | ✅ | **✅** |
| Counterparty blind | ❌ | ❌ | ⚠️ partial | ✅ | **✅** |
| Atomic settlement | ⚠️ custodial | ✅ | ✅ | ⚠️ broker | **✅ HTLC** |
| Cross-chain native | ❌ | ❌ | ❌ | ❌ | **✅** |
| Agent-native API | ⚠️ REST | ⚠️ RPC | ⚠️ | ❌ human | **✅ MCP + SDK** |
| Humans **and** agents on same venue | ❌ | ❌ | ❌ | ❌ | **✅** |

The intersection of all six rows is the moat. No other venue covers it.

## The killer feature: one KYC, N blind instances

Traditional dark pools require per-account onboarding. Crypto DEXes require no KYC at all. Both are wrong for autonomous agents.

HashLock lets a single KYC'd principal (hedge fund, family office, market maker, prop shop, or individual trader) spawn many blind agent instances under it:

```
Acme Capital (KYC'd once, tier: INSTITUTIONAL)
├── ag_5g7k92bq  — ETH/USDC market maker
├── ag_x8n4pqr2  — BTC/USDT arbitrage bot
├── ag_m1v9s6kd  — SOL/USDC basis trader
├── ag_t3h7lfz8  — cross-chain liquidity router
└── ag_wnk22aaa  — tail hedge bot
```

- **Counterparties see** only the rotating `blindId` and the attested `tier` — never the principal, never the strategy, never the aggregate position.
- **The HashLock gateway sees** everything, verifies the attestation proof, enforces principal-level risk limits, and writes a full regulatory audit trail.
- **The on-chain state sees** only commitment hashes. Amounts, participants, and strategies never hit the mempool.
- **Human traders see** their OTC desk workflow unchanged. They share the same order book, same settlement rails, same compliance gate.

Your fund is KYC'd once, your trades are blind forever.

## Quick start — human OTC flow (unchanged)

```typescript
import { IntentBuilder, IntentValidator, explainIntent } from '@hashlock-tech/intent-schema'

// Trader creates an intent: swap 0.1 ETH for at least 300 USDC
const intent = new IntentBuilder()
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
  .build()

const result = new IntentValidator().validate(intent)
// { valid: true, errors: [], warnings: [] }
```

No attestation field. The trader authenticates at session level (JWT). Human workflows stay exactly as they are.

## Quick start — agent flow with principal attestation

```typescript
import { IntentBuilder, IntentCommitter } from '@hashlock-tech/intent-schema'

// Gateway-issued attestation: Acme Capital spawning a blind agent
const attestation = {
  principalId: "pr_acme_capital_001",
  principalType: "INSTITUTION" as const,
  tier: "INSTITUTIONAL" as const,
  blindId: "ag_5g7k92bq",                 // rotating pseudonym
  issuedAt: Math.floor(Date.now() / 1000),
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
  proof: "0x...",                          // opaque, gateway-verified
}

const intent = new IntentBuilder()
  .give({ asset: "ETH", amount: "5000000000000000000", chain: 1 })
  .receive({
    asset: "ERC20",
    token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    minAmount: "15000000000",
    chain: 1,
  })
  .deadline(600)
  .minCounterpartyTier("STANDARD")         // only KYC'd peers
  .attestation(attestation)
  .agentInstance({ instanceId: "ag_5g7k92bq", strategy: "mm-eth-usdc" })
  .solver("open")
  .settlement("bilateral")
  .build()

// Sealed-bid commit: amounts + counterparty + identity all hidden
const committer = new IntentCommitter()
const commitment = await committer.commit(intent, {
  hideAmounts: true,
  hideCounterparty: true,
  hideIdentity: true,        // strips blindId from the solver proof
  revealOnMatch: false,      // sealed until match phase ends
})

// commitment.hash        → goes on-chain (opaque to market)
// commitment.proof       → goes to the solver / auction engine
//                          Contains only: tier + cross-chain filters
//                          Never contains: principalId, amounts, or identity
```

See [`examples/agent-principal-flow.ts`](./examples/agent-principal-flow.ts) for the full multi-instance walkthrough.

## Natural language (Turkish + English)

Agents and humans can both express intent in natural language:

```typescript
import { IntentParser } from '@hashlock-tech/intent-schema'

const parser = new IntentParser()
const result = await parser.fromText(
  "0.1 ETH karşılığı en az 300 USDC al, 1 saat içinde, slippage max yarım puan"
)

console.log(result.intent)       // HashLockIntent
console.log(result.confidence)   // 0.85
console.log(result.ambiguities)  // []
```

## Selective disclosure — the dark pool primitive

Every commitment supports four independent privacy switches:

| Option | Effect | Solver sees |
|---|---|---|
| `hideAmounts: true` | Give + receive amounts null in proof | Asset types + chains |
| `hideCounterparty: true` | Ring parties list stripped | Settlement type only |
| `hideIdentity: true` | Blind ID stripped from proof | Only attested tier |
| `revealOnMatch: false` | Full sealed bid; no reveal until clear | Only what above flags allow |

Set all four for a full sealed-bid auction. The solver matches on tier and cross-chain topology alone; amounts, identities, and strategies never leave the committer until the clearing phase.

## MCP server (Claude Desktop / Claude Code)

5 tools for intent authoring:

| Tool | Description |
|---|---|
| `create_intent` | Fluent-builder wrapper; accepts principal/attestation/tier params |
| `validate_intent` | Schema + business rules + attestation rules |
| `parse_natural_language` | Turkish/English → HashLockIntent |
| `commit_intent` | Selective disclosure commit; supports `hideIdentity` + full sealed bid |
| `explain_intent` | Human-readable summary |

Setup in Claude Desktop / Claude Code:

```jsonc
{
  "mcpServers": {
    "hashlock-intent": {
      "command": "npx",
      "args": ["-y", "@hashlock-tech/intent-schema"]
    }
  }
}
```

## Architecture (humans + agents on one venue)

```
┌──────────────────────────────────────────────────────────────┐
│  STRATEGY LAYER (human OR agent)                             │
│  Human trader desk • AI agent loop • RFQ responder •         │
│  Blind auction bidder • Market-making algo                   │
│  ▼ produces an intent                                        │
├──────────────────────────────────────────────────────────────┤
│  INTENT LAYER (this package)                                 │
│  Structured preferences • Optional principal attestation •   │
│  Zod-validated • Canonical-hashed • Selective disclosure     │
│  ▼ goes to matcher / solver                                  │
├──────────────────────────────────────────────────────────────┤
│  MATCH LAYER (HashLock platform)                             │
│  Compliance gate (KYC tier) • OTC / RFQ / Blind auction •    │
│  Ring settlement coordinator • Cross-chain routing           │
│  ▼ produces matched intents                                  │
├──────────────────────────────────────────────────────────────┤
│  SETTLEMENT LAYER (HTLC on EVM / BTC / Sui)                  │
│  Atomic hash-time-locked contracts • Cross-chain preimage    │
│  coordination • Auto-refund on timeout                       │
└──────────────────────────────────────────────────────────────┘
```

Both user classes (humans and agents) enter at the Strategy Layer and use the same intent, match, and settlement layers below. The only difference is whether they carry a principal attestation object in their intents — humans authenticate at the session level, agents authenticate per-intent.

## Validation rules (business-level)

| Rule | Type | Applies to |
|---|---|---|
| Schema structure (Zod) | Error | All |
| Deadline not expired | Error | All |
| Amount > 0 | Error | All |
| No self-swap | Error | All |
| Ring has 2+ parties | Error | Ring settlement |
| maxAmount >= minAmount | Error | All |
| Attestation not expired | Error | Agents / institutions |
| Attestation issuedAt < expiresAt | Error | Agents / institutions |
| agentInstance requires attestation | Error | Agents |
| agentInstance requires AGENT/INSTITUTION tier | Error | Agents |
| Signer tier >= minCounterpartyTier | Error | Asymmetric filter |
| Tight deadline (< 60s) | Warning | All |
| Cross-chain | Warning | All |
| High slippage (> 10%) | Warning | All |
| Missing ERC20 token address | Warning | ERC20/ERC721 |
| Attestation expires in < 5 min | Warning | Agents / institutions |

## Settlement types

| Type | Description | Human use | Agent use |
|---|---|---|---|
| `bilateral` | Direct 1:1 atomic HTLC swap | OTC desk deal | MM quote fill |
| `ring` | N-party circular settlement | Multi-counterparty OTC | Cross-chain liquidity routing |
| `batch` | Walrasian batch clearing | Blind auction | Sealed-bid matching |

## Why not just an order book

An order book is a static snapshot: "I want X at price Y." It cannot express:

- **Conditional preferences** — "if volatility > 5%, then buy"
- **Cross-chain atomicity** — "ETH on mainnet for USDC on Arbitrum, in one transaction"
- **Compliance-gated matching** — "only counterparties with STANDARD tier or higher"
- **Privacy guarantees** — "commit without revealing amounts until matched"
- **Agent principal semantics** — "multiple instances, one KYC'd entity"

The HashLockIntent is a dynamic preference function. It says: here is what I want, here are my constraints, here is who I am at the compliance level — find the best atomic satisfaction.

## Development

```bash
git clone https://github.com/Hashlock-Tech/hashlock-intent-schema
cd hashlock-intent-schema
npm install
npm run build
npm test
```

## License

MIT
