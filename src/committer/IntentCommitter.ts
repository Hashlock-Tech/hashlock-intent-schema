import { createHash } from "node:crypto";
import type { HashLockIntent } from "../types/index.js";

// ── Commit Options ───────────────────────────────────────────

export interface CommitOptions {
  /** Hide amounts from public view (future: ZK proof) */
  hideAmounts?: boolean;
  /** Hide counterparty info (future: ZK proof) */
  hideCounterparty?: boolean;
  /** Reveal full intent when matched */
  revealOnMatch?: boolean;
}

// ── Commitment Result ────────────────────────────────────────

export interface Commitment {
  /** Keccak-like hash of the intent (sha256 for now) */
  hash: string;
  /** Partial proof for solver (non-hidden fields) */
  proof: SolverProof;
  /** Original intent (kept off-chain by creator) */
  intent: HashLockIntent;
  /** Timestamp of commitment */
  committedAt: number;
}

// ── Solver Proof ─────────────────────────────────────────────

export interface SolverProof {
  /** Intent ID */
  intentId: string;
  /** Commitment hash (matches on-chain) */
  commitmentHash: string;
  /** Give asset type (always visible — solver needs to know what to provide) */
  giveAsset: string;
  giveChain: number;
  /** Receive asset type */
  receiveAsset: string;
  receiveChain: number;
  /** Visible amount (null if hidden) */
  giveAmount: string | null;
  receiveMinAmount: string | null;
  /** Solver directives (always visible) */
  solver: HashLockIntent["solver"];
  /** Settlement type (always visible) */
  settlement: HashLockIntent["settlement"];
  /** Deadline (always visible) */
  deadline: number;
}

// ── Provider Interface ───────────────────────────────────────

export interface CommitProvider {
  /** Submit commitment hash on-chain */
  submitCommitment(hash: string, deadline: number): Promise<string>; // returns tx hash
}

// ── Intent Committer ─────────────────────────────────────────

export class IntentCommitter {
  constructor(private provider?: CommitProvider) {}

  /**
   * Create an off-chain commitment from an intent.
   * Optionally submit the hash on-chain via a provider.
   */
  async commit(
    intent: HashLockIntent,
    options: CommitOptions = {}
  ): Promise<Commitment> {
    const { hideAmounts = false, hideCounterparty = false } = options;

    // ── Hash the full intent ──
    const hash = this.hashIntent(intent);

    // ── Build solver proof (selective disclosure) ──
    const proof: SolverProof = {
      intentId: intent.id,
      commitmentHash: hash,
      giveAsset: intent.give.asset,
      giveChain: intent.give.chain,
      receiveAsset: intent.receive.asset,
      receiveChain: intent.receive.chain,
      giveAmount: hideAmounts ? null : intent.give.amount,
      receiveMinAmount: hideAmounts ? null : intent.receive.minAmount,
      solver: intent.solver,
      settlement: hideCounterparty
        ? { ...intent.settlement, ringParties: undefined }
        : intent.settlement,
      deadline: intent.conditions.deadline,
    };

    // ── Submit on-chain if provider exists ──
    if (this.provider) {
      await this.provider.submitCommitment(hash, intent.conditions.deadline);
    }

    return {
      hash,
      proof,
      intent,
      committedAt: Math.floor(Date.now() / 1000),
    };
  }

  /**
   * Verify that a commitment hash matches the intent.
   */
  verify(intent: HashLockIntent, commitmentHash: string): boolean {
    return this.hashIntent(intent) === commitmentHash;
  }

  /**
   * Hash an intent deterministically.
   * Uses SHA-256 of canonical JSON.
   * Future: replace with Poseidon hash for ZK-friendliness.
   */
  private hashIntent(intent: HashLockIntent): string {
    // Canonical: sort keys, exclude signature
    const { signature: _, ...withoutSig } = intent;
    const canonical = JSON.stringify(withoutSig, Object.keys(withoutSig).sort());
    return "0x" + createHash("sha256").update(canonical).digest("hex");
  }
}

// ── Explain ──────────────────────────────────────────────────

/**
 * Generate a human-readable explanation of an intent.
 */
export function explainIntent(intent: HashLockIntent): string {
  const lines: string[] = [];

  lines.push(`Intent ${intent.id}`);
  lines.push(`  Give: ${intent.give.amount} ${intent.give.asset} on chain ${intent.give.chain}`);
  lines.push(`  Receive: min ${intent.receive.minAmount} ${intent.receive.asset} on chain ${intent.receive.chain}`);
  lines.push(`  Deadline: ${new Date(intent.conditions.deadline * 1000).toISOString()}`);

  if (intent.conditions.maxSlippage !== undefined) {
    lines.push(`  Max Slippage: ${(intent.conditions.maxSlippage * 100).toFixed(2)}%`);
  }

  lines.push(`  Solver: ${intent.solver.type} (${intent.solver.strategy})`);
  lines.push(`  Settlement: ${intent.settlement.type} (${intent.settlement.atomicity})`);

  if (intent.trigger) {
    lines.push(`  Trigger: ${intent.trigger.type}${intent.trigger.description ? ` — ${intent.trigger.description}` : ""}`);
  }

  if (intent.conditions.partialFill) {
    lines.push("  Partial fill: allowed");
  }

  const isCrossChain = intent.give.chain !== intent.receive.chain;
  if (isCrossChain) {
    lines.push(`  Cross-chain: ${intent.give.chain} → ${intent.receive.chain}`);
  }

  return lines.join("\n");
}
