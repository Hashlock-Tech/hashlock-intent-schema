# HashLock Intent Schema — Technical Specification

**Version**: 1.0
**Status**: Draft
**Date**: 2026-04-11

## 1. Overview

The HashLock Intent Schema defines the canonical object exchanged between producers (human traders, autonomous agents) and the HashLock matching/settlement stack.

Two user classes coexist on the same venue:

- **Humans** — traders on OTC desks, RFQ broadcast, and blind auctions. Authentication happens at the session level (JWT); no per-intent attestation is required. Existing human flows remain unchanged.
- **Agents** — autonomous instances operating under a KYC'd principal (institution, fund, or individual). Authentication happens per-intent via a principal attestation. Multiple agent instances can share one KYC'd principal but each carries a unique blind identity.

Both classes produce the same `HashLockIntent` object. The only structural difference is that agent intents carry optional `attestation` and `agentInstance` fields; human intents omit them.

## 2. Intent Structure

### 2.1 Meta Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID v4 | Yes | Unique intent identifier |
| `version` | `"1.0"` | Yes | Schema version |
| `createdAt` | uint64 | Yes | Unix timestamp (seconds) |
| `chainId` | uint64 | Yes | Primary chain for this intent |
| `nonce` | string | Yes | Replay protection (unique per intent) |

### 2.2 Give (Offer Side)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `asset` | `"ETH" \| "ERC20" \| "ERC721"` | Yes | Asset type |
| `token` | address | If ERC20/721 | Contract address |
| `amount` | string | Yes | Amount in smallest unit (wei) |
| `chain` | uint64 | Yes | Source chain ID |

### 2.3 Receive (Want Side)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `asset` | `"ETH" \| "ERC20" \| "ERC721"` | Yes | Asset type |
| `token` | address | If ERC20/721 | Contract address |
| `minAmount` | string | Yes | Minimum acceptable amount |
| `maxAmount` | string | No | Upper bound (for solver optimization) |
| `chain` | uint64 | Yes | Destination chain ID |

### 2.4 Conditions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `deadline` | uint64 | Yes | Expiry timestamp (unix seconds) |
| `maxSlippage` | float | No | Max slippage tolerance (0.005 = 0.5%) |
| `partialFill` | boolean | No | Accept partial fills (default: false) |
| `counterparty` | address[] | No | Whitelist of allowed counterparties |
| `minCounterpartyReputation` | uint | No | **Deprecated** — subjective reputation score (kept for backward compatibility) |
| `minCounterpartyTier` | KycTier | No | Minimum compliance tier the counterparty must attest to (NONE/BASIC/STANDARD/ENHANCED/INSTITUTIONAL) |

### 2.5 Solver Directives

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"open" \| "preferred" \| "exclusive"` | Yes | Solver access control |
| `preferred` | address[] | If preferred/exclusive | Allowed solver addresses |
| `maxFee` | string | No | Max fee payable to solver (wei) |
| `strategy` | `"best_price" \| "fastest" \| "lowest_fee"` | Yes | Execution priority |

**Invariant**: If `type` is `"preferred"` or `"exclusive"`, `preferred` must be non-empty.

### 2.6 Settlement

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"bilateral" \| "ring" \| "batch"` | Yes | Settlement mechanism |
| `ringParties` | address[] | If ring | Participants in ring (min 2) |
| `atomicity` | `"full" \| "partial"` | Yes | Atomicity guarantee |

### 2.7 Trigger (Optional)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"immediate" \| "conditional"` | Yes | Trigger type |
| `description` | string | No | Human-readable condition |
| `agentId` | string | No | Producing agent identifier |
| `confidence` | float [0,1] | No | Agent confidence score |

### 2.8 Signature (Optional)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `signer` | address | Yes | Signing address |
| `sig` | string | Yes | Signature bytes |
| `method` | `"eip712" \| "eip191"` | Yes | Signing method |

### 2.9 Principal Attestation (Optional)

Attestation binds an intent to a KYC'd entity without leaking the entity to the counterparty. Omitted entirely for session-authenticated human flows.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `principalId` | string | Yes | Opaque identifier (stable hash) of the KYC'd entity |
| `principalType` | `"HUMAN" \| "INSTITUTION" \| "AGENT"` | Yes | Kind of principal backing the intent |
| `tier` | KycTier | Yes | Attested compliance tier of the principal |
| `blindId` | string | No | Rotating pseudonym visible to counterparty (omit for post-match attribution only) |
| `issuedAt` | uint64 | Yes | Attestation issuance time (unix seconds) |
| `expiresAt` | uint64 | Yes | Attestation expiration (unix seconds) |
| `proof` | string | Yes | Opaque proof (signature or ZK proof) verified by the HashLock gateway, NOT by the counterparty |

**Tier ordering** (ascending): `NONE < BASIC < STANDARD < ENHANCED < INSTITUTIONAL`.

**Invariants**:
- `issuedAt < expiresAt`
- Validation rejects attestations where `expiresAt <= now` or `issuedAt > now + 60s`
- If `attestation.tier < conditions.minCounterpartyTier`, the intent is rejected as asymmetric

### 2.10 Agent Instance (Optional)

Informational metadata about the specific agent instance producing the intent. Never required; when present, it must be paired with an `attestation` whose `principalType` is `AGENT` or `INSTITUTION`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `instanceId` | string | Yes | Stable identifier for the agent instance |
| `strategy` | string | No | Human-readable strategy label (e.g. `"mm-eth-usdc"`) |
| `version` | string | No | Agent software version |
| `spawnedAt` | uint64 | No | Instance spawn time (unix seconds) |

## 3. Lifecycle

```
Agent ──[create]──> Intent ──[validate]──> Valid Intent
                                               │
                                     ┌─────────┴─────────┐
                                     │                     │
                               [commit]              [send to solver]
                                     │                     │
                              On-chain hash          Solver proof
                                     │                     │
                                     └─────────┬───────────┘
                                               │
                                         [match + settle]
                                               │
                                          HashLock HTLC
```

### 3.1 Creation

Intents are created via `IntentBuilder` or `IntentParser`. Each intent receives a unique `id` (UUID v4) and `nonce`.

### 3.2 Validation

`IntentValidator` performs two-phase validation:
1. **Schema validation**: Zod schema check (structural correctness)
2. **Business rules**: Semantic checks (deadline, amounts, self-swap, etc.)

### 3.3 Commitment

Optional on-chain commitment via `IntentCommitter`:
- Hash of the full intent is submitted on-chain
- Selective disclosure proof is sent to solvers
- Future: ZK proofs (Poseidon hash) for privacy

### 3.4 Settlement

Solver matches intents and executes via HashLock:
- **Bilateral**: Direct HTLC between two parties
- **Ring**: Multi-hop HTLC chain (A→B→C→A)
- **Batch**: Walrasian batch clearing

## 4. Hashing

Canonical hash: SHA-256 of deterministically serialized JSON. The canonicalizer recursively sorts object keys, drops `undefined` values, and uses standard JSON scalars.

```
hash = "0x" + SHA256(canonicalJson(intentWithoutAuthSecrets))
```

**Excluded from the canonical form** (authentication envelopes, not intent content):
- `signature` (the entire field)
- `attestation.proof` (replaced with empty string before hashing)

**Included in the canonical form** (content — substitution attacks must be detected):
- All give/receive/conditions/solver/settlement fields
- `attestation.principalId`, `attestation.principalType`, `attestation.tier`, `attestation.blindId`, `attestation.issuedAt`, `attestation.expiresAt`
- `agentInstance` fields
- `trigger` fields

This guarantees that an attacker cannot swap a STANDARD-tier attestation for an INSTITUTIONAL-tier one without invalidating the commitment hash.

Future: Poseidon hash for ZK-circuit compatibility.

## 5. Supported Chains

| Chain ID | Name |
|----------|------|
| 1 | Ethereum Mainnet |
| 10 | Optimism |
| 56 | BNB Chain |
| 137 | Polygon |
| 324 | zkSync Era |
| 8453 | Base |
| 42161 | Arbitrum One |
| 43114 | Avalanche |
| 11155111 | Sepolia (testnet) |

## 6. Versioning

Schema version is locked to `"1.0"` in this release. Breaking changes will increment the major version. Non-breaking additions (new optional fields) will increment the minor version.

## 7. Selective Disclosure

The `IntentCommitter` produces a `Commitment` with two parts:

- `hash` — the canonical SHA-256, safe to publish on-chain.
- `proof` — a `SolverProof` object for the matching engine, where each sensitive field can be independently hidden via `CommitOptions`.

### 7.1 CommitOptions

| Option | Default | Effect on solver proof |
|---|---|---|
| `hideAmounts` | `false` | `giveAmount` and `receiveMinAmount` set to `null` |
| `hideCounterparty` | `false` | `settlement.ringParties` set to `undefined` |
| `hideIdentity` | `false` | `attestationBlindId` set to `null`; `attestationTier` remains visible so the solver can still enforce tier filters |
| `revealOnMatch` | `true` | When `false`, the committer expects a reveal phase before settlement |

### 7.2 What the solver always sees

Regardless of flags, the solver proof contains:
- `intentId`, `commitmentHash`
- `giveAsset`, `giveChain`, `receiveAsset`, `receiveChain`
- `solver` directives
- `settlement.type` and `settlement.atomicity`
- `deadline`
- `minCounterpartyTier` (if set on the intent)
- `attestationTier` (if an attestation is present)

### 7.3 What the solver never sees

- `attestation.principalId`
- `attestation.proof`
- The full intent before the reveal phase (when `revealOnMatch: false`)

### 7.4 Sealed-bid blind auction configuration

For a full sealed bid:

```
hideAmounts: true
hideCounterparty: true
hideIdentity: true
revealOnMatch: false
```

In this mode the solver sees only tier filters and cross-chain topology. No amounts, no identities, no ring membership. Matching runs on tier and topology alone; once the auction clears, the winning bidders reveal their full intents for HTLC execution.

## 8. Security Considerations

- **Replay protection**: Each intent has a unique `nonce`. Solvers must check nonce uniqueness.
- **Deadline enforcement**: Intents with expired deadlines must be rejected.
- **Signature verification**: If `signature` is present, it must be valid for the signer address.
- **Amount validation**: All amounts must be positive and non-zero.
- **Commitment privacy**: On-chain commitment reveals only the canonical hash; the solver proof selectively discloses fields based on `CommitOptions`.
- **Attestation expiry**: Validators MUST reject expired attestations and MUST warn when expiration is less than 5 minutes away.
- **Principal leakage**: The `attestation.principalId` and `attestation.proof` fields MUST NEVER be included in the solver proof or in any channel visible to counterparties. Only the gateway verifying the attestation should see them.
- **Tier substitution attacks**: Because `attestation.tier` is included in the canonical hash, an attacker cannot upgrade or downgrade the declared tier without producing a different commitment hash.
- **Asymmetric filter enforcement**: The validator rejects intents whose signer tier is below the tier they demand from their counterparty — this prevents operator misconfiguration where a STANDARD-tier agent filters for ENHANCED counterparties.
- **Identity leakage in ring settlement**: Ring settlement contracts publish participant addresses on-chain. True blind ring settlement requires ZK-proofs over ring state (future work). For full privacy today, use bilateral settlement with `hideIdentity: true`.

## 9. Coexistence with Human Flows

Every field introduced to support agent/institution flows is **optional and additive**. Human OTC, RFQ, and blind auction workflows:

- MAY omit `attestation` entirely — session-level JWT authentication carries the identity.
- MAY use the original `conditions.counterparty` whitelist for manual compliance.
- MAY use the existing `hideAmounts` and `hideCounterparty` flags without setting `hideIdentity`.
- SHOULD treat `minCounterpartyTier` as opt-in when the trader wants compliance-gated matching.

The canonical hash function is deterministic for both user classes: intents without `attestation` produce the same hash they would have under the previous specification, modulo the canonicalization fix described in section 4.
