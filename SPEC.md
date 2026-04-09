# HashLock Intent Schema — Technical Specification

**Version**: 1.0
**Status**: Draft
**Date**: 2026-04-10

## 1. Overview

The HashLock Intent Schema defines a standard format for expressing trading preferences as **conditional preference functions** rather than static orders. Intents are produced by AI agents, consumed by solvers, and settled atomically via HashLock HTLC contracts.

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
| `minCounterpartyReputation` | uint | No | Future: reputation score threshold |

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

Current: SHA-256 of canonical JSON (sorted keys, signature excluded).

```
hash = "0x" + SHA256(JSON.stringify(intentWithoutSig, sortedKeys))
```

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

## 7. Security Considerations

- **Replay protection**: Each intent has a unique `nonce`. Solvers must check nonce uniqueness.
- **Deadline enforcement**: Intents with expired deadlines must be rejected.
- **Signature verification**: If `signature` is present, it must be valid for the signer address.
- **Amount validation**: All amounts must be positive and non-zero.
- **Commitment privacy**: On-chain commitment reveals only the hash; solver proof selectively discloses fields based on `CommitOptions`.
