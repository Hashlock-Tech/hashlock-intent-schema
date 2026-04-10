import { createHash } from "node:crypto";
import type { HashLockIntent } from "../types/index.js";
import type { KycTier } from "../types/principal.js";

// ── Commit Options ───────────────────────────────────────────

export interface CommitOptions {
  /** Hide amounts from public view (future: ZK proof) */
  hideAmounts?: boolean;
  /** Hide counterparty info (future: ZK proof) */
  hideCounterparty?: boolean;
  /** Hide principal identity — strips principalId/proof from
   *  the SolverProof, leaving only tier + blindId for matching. */
  hideIdentity?: boolean;
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
  /** Counterparty tier requirement (for solver-side matching) */
  minCounterpartyTier: KycTier | null;
  /** Attested KYC tier of the signer (visible so solver can match
   *  on tier filters). Never reveals the underlying principal. */
  attestationTier: KycTier | null;
  /** Blind pseudonym of the signer (rotating per-instance).
   *  Counterparty sees this, never the principalId. */
  attestationBlindId: string | null;
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
    const {
      hideAmounts = false,
      hideCounterparty = false,
      hideIdentity = false,
    } = options;

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
      minCounterpartyTier: intent.conditions.minCounterpartyTier ?? null,
      // Tier + blindId are always emitted so solvers can match
      // across tier filters. principalId + proof are NEVER emitted.
      attestationTier: intent.attestation?.tier ?? null,
      attestationBlindId: hideIdentity
        ? null
        : intent.attestation?.blindId ?? null,
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
   * Uses SHA-256 of canonical JSON with recursively sorted keys.
   * Future: replace with Poseidon hash for ZK-friendliness.
   *
   * Signature and attestation.proof are excluded from the canonical
   * form because they are authentication envelopes, not intent
   * content. The attestation metadata (tier, principalId, blindId)
   * IS included in the hash so attestation substitution attacks are
   * prevented.
   */
  private hashIntent(intent: HashLockIntent): string {
    const {
      signature: _sig,
      attestation,
      ...rest
    } = intent;
    const withoutAuth = {
      ...rest,
      attestation: attestation
        ? { ...attestation, proof: "" }
        : undefined,
    };
    const canonical = canonicalJson(withoutAuth);
    return "0x" + createHash("sha256").update(canonical).digest("hex");
  }
}

// ── Canonical JSON ───────────────────────────────────────────
//
// Deterministic JSON: objects have keys sorted recursively, arrays
// keep their order, undefined/function values are omitted. Used to
// make hashes independent of key insertion order.

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalJson(v)).join(",") + "]";
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return (
      "{" +
      entries
        .map(([k, v]) => JSON.stringify(k) + ":" + canonicalJson(v))
        .join(",") +
      "}"
    );
  }
  return "null";
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
