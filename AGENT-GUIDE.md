# HashLock Agent Integration Guide

> How autonomous trading agents plug into HashLock alongside human traders — shared venue, separate identities, same settlement rails.

## Who this is for

- **Quant teams** deploying autonomous market-making, arbitrage, or execution agents
- **Family offices** running rebalancing / treasury / tax-harvesting bots
- **Proprietary trading firms** operating fleets of strategy agents under one legal entity
- **Solo builders** running a single principal with one or more specialized agents

If you trade manually via a UI, you do not need this guide — the human OTC, RFQ, and blind auction flows work as they always have, and you can ignore every mention of `attestation` below.

## Mental model

HashLock is a single venue with two user classes that share everything below the strategy layer:

```
┌──────────────────┐         ┌──────────────────┐
│  HUMAN TRADER    │         │  AUTONOMOUS      │
│                  │         │  AGENT           │
│  (desk + UI)     │         │  (loop + API)    │
└────────┬─────────┘         └────────┬─────────┘
         │                            │
         │  session JWT               │  per-intent attestation
         │                            │
         └────────────┬───────────────┘
                      │
             ┌────────▼────────┐
             │  HashLock Venue │
             │  OTC / RFQ /    │
             │  Blind auction  │
             │  HTLC settle    │
             └─────────────────┘
```

Both classes produce the same `HashLockIntent`. The only structural difference: agents carry an `attestation` proving they operate under a KYC'd principal. Humans authenticate at the session level and omit the attestation entirely.

## The principal-instance model

This is HashLock's core agent primitive. Understand it first, everything else follows.

**Principal** = the legal entity. A hedge fund, family office, LLC, GmbH, or an individual trader. Onboarded once via KYC at the HashLock gateway. Gets a tier: `BASIC`, `STANDARD`, `ENHANCED`, or `INSTITUTIONAL`.

**Instance** = an agent running under a principal. Each instance has its own rotating blind ID (e.g. `ag_5g7k92bq`). A single principal can run many instances in parallel, each with its own strategy, risk limits, and trading pairs.

**Attestation** = a short-lived, gateway-signed object binding an instance to its principal. Carries the principal's ID (hashed), the tier, the blind ID, issuance + expiration times, and an opaque proof. Attached to every intent the instance produces.

**Key rule**: counterparties and the market see the blind ID + tier. The gateway sees everything. The principal ID never leaves the gateway.

```
Acme Capital (INSTITUTIONAL tier, KYC once)
│
├── ag_5g7k92bq  — "mm-eth-usdc"     (market making)
├── ag_x8n4pqr2  — "arb-btc-usdt"    (arbitrage)
├── ag_m1v9s6kd  — "basis-sol-usdc"  (basis trading)
└── ag_t3h7lfz8  — "cross-liq"       (cross-chain liquidity)
```

Each instance trades under its own blind ID. From the counterparty's perspective, `ag_5g7k92bq` and `ag_x8n4pqr2` could be completely unrelated entities. From the gateway's perspective, both are Acme Capital, both count against Acme's aggregate risk limits, both appear in Acme's audit trail.

## Onboarding

### Step 1 — Principal KYC (one time, human-in-the-loop)

Your firm completes KYC with HashLock via the Cayman OTC platform onboarding flow. This happens once, uses the existing compliance stack (Sumsub / Jumio / Onfido / Veriff), and assigns your principal a tier.

You receive:
- `principalId` — opaque hash identifying your entity
- `tier` — compliance level granted (`STANDARD`, `ENHANCED`, or `INSTITUTIONAL`)
- An API key to the gateway's attestation issuer

### Step 2 — Spawn agent instances

For each agent you want to run, request an attestation from the gateway:

```
POST /agent/attestation
Authorization: Bearer <principal-api-key>
{
  "blindId": "ag_5g7k92bq",
  "validitySeconds": 3600
}
```

Response:

```json
{
  "principalId": "pr_acme_capital_001",
  "principalType": "INSTITUTION",
  "tier": "INSTITUTIONAL",
  "blindId": "ag_5g7k92bq",
  "issuedAt": 1712800000,
  "expiresAt": 1712803600,
  "proof": "0x..."
}
```

This is the object you will embed in every intent your agent produces.

### Step 3 — Build intents with `IntentBuilder`

```typescript
import { IntentBuilder } from '@hashlock-tech/intent-schema'

const intent = new IntentBuilder()
  .give({ asset: "ETH", amount: "5000000000000000000", chain: 1 })
  .receive({
    asset: "ERC20",
    token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    minAmount: "15000000000",
    chain: 1,
  })
  .deadline(600)
  .maxSlippage(0.005)
  .minCounterpartyTier("STANDARD")           // only KYC'd peers
  .attestation(attestationFromGateway)        // from Step 2
  .agentInstance({
    instanceId: "ag_5g7k92bq",
    strategy: "mm-eth-usdc",
    version: "1.0.0",
  })
  .solver("open")
  .strategy("best_price")
  .settlement("bilateral")
  .build()
```

### Step 4 — Validate before submit

```typescript
import { IntentValidator } from '@hashlock-tech/intent-schema'

const result = new IntentValidator().validate(intent)
if (!result.valid) {
  console.error("invalid intent:", result.errors)
  return
}
```

Agent-specific validation rules enforce:
- Attestation has not expired
- Attestation `issuedAt` is in the past
- `issuedAt < expiresAt`
- Agent instance has an attestation with `AGENT` or `INSTITUTION` principal type
- Signer tier is not below the tier it demands from the counterparty (no asymmetric filtering)

### Step 5 — Commit with selective disclosure

```typescript
import { IntentCommitter } from '@hashlock-tech/intent-schema'

const committer = new IntentCommitter()

// Full sealed bid for a blind auction
const commitment = await committer.commit(intent, {
  hideAmounts: true,
  hideCounterparty: true,
  hideIdentity: true,
  revealOnMatch: false,
})

// commitment.hash  → publish on-chain
// commitment.proof → send to HashLock matching engine
```

The solver proof will contain only the tier filter, cross-chain topology, and commitment hash. No amounts, no identity, no strategy hint. The gateway verifies the attestation out-of-band; the matching engine never sees `principalId` or `proof`.

## Privacy tiers

Pick the disclosure profile that matches your use case.

### Tier 0 — Open (for public RFQ response)

```typescript
await committer.commit(intent)
// all fields visible, attestation tier + blind ID visible
```

Use when participating in a public RFQ where you want counterparties to see your tier and blind ID for reputation purposes.

### Tier 1 — Counterparty blind (for ring settlement privacy)

```typescript
await committer.commit(intent, { hideCounterparty: true })
```

Ring parties stripped from proof. Use in multi-party ring settlements where you don't want other legs to see each other's addresses.

### Tier 2 — Amount blind (for large block trades)

```typescript
await committer.commit(intent, {
  hideAmounts: true,
  hideCounterparty: true,
})
```

Your size is hidden until match. Use for large block trades where the size itself is market-moving.

### Tier 3 — Full sealed bid (for blind auctions)

```typescript
await committer.commit(intent, {
  hideAmounts: true,
  hideCounterparty: true,
  hideIdentity: true,
  revealOnMatch: false,
})
```

Only tier and topology visible. Use for sealed-bid auctions where the auction engine matches on compliance alone, and winners reveal their full intents after the clearing phase.

## Coexistence with human flows

You do not need to do anything special to coexist with human traders on HashLock. Both user classes produce intents that go into the same pool. The matching engine sees:

- Human intents with no attestation (session-authenticated at the API layer)
- Agent intents with attestation (per-intent authenticated)

The matching logic is identical for both. If a human sets `minCounterpartyTier: "STANDARD"`, they can match against any counterparty (human or agent) whose attestation or session auth proves STANDARD or higher. If an agent sets `minCounterpartyTier: "INSTITUTIONAL"`, only institutional-tier counterparties are considered.

Humans never need to construct `PrincipalAttestation` objects. Agent code never needs to know whether a counterparty is a human or another agent — the tier filter is the only dimension that matters.

## Common patterns

### Multi-instance fan-out

```typescript
const instances = ["ag_5g7k92bq", "ag_x8n4pqr2", "ag_m1v9s6kd"]

for (const blindId of instances) {
  const attestation = await gateway.issueAttestation(blindId, 3600)
  const intent = new IntentBuilder()
    .give(/* ... */)
    .receive(/* ... */)
    .deadline(600)
    .attestation(attestation)
    .agentInstance({ instanceId: blindId })
    .solver("open")
    .settlement("bilateral")
    .build()

  await submitToMatchingEngine(intent)
}
```

### Attestation rotation

Attestations should be short-lived (suggest ≤1 hour) and rotated on each key refresh. The gateway can issue fresh attestations on demand; your agent should cache the current attestation in memory and refresh before `expiresAt`.

### Tier filtering for institutional-only flow

```typescript
.minCounterpartyTier("INSTITUTIONAL")
.attestation(instAttestation)  // must also be INSTITUTIONAL
```

The validator will reject the intent at build time if your attestation tier is below the tier you demand — HashLock will not let you filter for counterparties that outrank you.

### Cross-chain atomic with tier filter

```typescript
new IntentBuilder()
  .give({ asset: "ETH", amount: "10000000000000000000", chain: 1 })
  .receive({
    asset: "ERC20",
    token: "0xUSDC_on_Arbitrum",
    minAmount: "30000000000",
    chain: 42161,
  })
  .deadline(300)
  .minCounterpartyTier("ENHANCED")
  .attestation(instAttestation)
  .settlement("bilateral")
  .build()
```

Settles atomically across Ethereum and Arbitrum via HTLC. No bridge, no custody, no identity leak.

## Frequently asked questions

**Q: Does the counterparty ever see my principal ID?**
No. The `principalId` and the attestation `proof` are verified only by the HashLock gateway. The solver proof and everything downstream sees only the blind ID and the attested tier.

**Q: Can I run an agent without any KYC?**
No. The minimum principal tier is `BASIC`. The `NONE` tier exists only for sandbox and test environments. Autonomous agents that want to access real markets must operate under a KYC'd principal.

**Q: What happens if my attestation expires mid-trade?**
The intent would have been accepted when valid. Settlement happens via HTLC — once locked, HTLC atomicity carries the trade to completion independent of attestation state. Expired attestations only affect new intent submission.

**Q: Can my human traders see my agent trades?**
Only aggregate, at the principal level, through your own dashboard. Other principals cannot link your agent trades back to your firm.

**Q: What if two of my agents end up matched against each other?**
The matching engine treats them as independent blind IDs. Atomic self-settlement via HTLC works fine (you're paying two sides of the same HTLC). The `checkSelfSwap` rule catches identical give/receive within a single intent but not across two instances — instance-level self-matching is allowed and sometimes useful for inventory rebalancing between strategies.

**Q: Can I revoke an attestation?**
Not at the schema level. The gateway can stop issuing new attestations for a compromised blind ID, and the short validity window limits exposure. For immediate kill, use the kill switch in the HashLock agent runtime.

## See also

- [`README.md`](./README.md) — Package overview and human OTC quick start
- [`SPEC.md`](./SPEC.md) — Full technical specification of the intent schema
- [`examples/agent-principal-flow.ts`](./examples/agent-principal-flow.ts) — Multi-instance walkthrough with runnable code
- [`examples/ai-agent-flow.ts`](./examples/ai-agent-flow.ts) — Original AI agent flow example
