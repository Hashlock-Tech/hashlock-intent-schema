import { z } from "zod";
import { GiveSchema, ReceiveSchema } from "./conditions.js";
import { SolverDirectiveSchema } from "./solver.js";
import {
  PrincipalAttestationSchema,
  AgentInstanceSchema,
  KycTier,
} from "./principal.js";

// ── Asset Types ──────────────────────────────────────────────

export const AssetType = z.enum(["ETH", "ERC20", "ERC721"]);
export type AssetType = z.infer<typeof AssetType>;

// ── Settlement ───────────────────────────────────────────────

export const SettlementType = z.enum(["bilateral", "ring", "batch"]);
export const AtomicityType = z.enum(["full", "partial"]);

export const SettlementSchema = z.object({
  type: SettlementType,
  ringParties: z.array(z.string()).optional(),
  atomicity: AtomicityType,
});

export type Settlement = z.infer<typeof SettlementSchema>;

// ── Trigger ──────────────────────────────────────────────────

export const TriggerType = z.enum(["immediate", "conditional"]);

export const TriggerSchema = z.object({
  type: TriggerType,
  description: z.string().optional(),
  agentId: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export type Trigger = z.infer<typeof TriggerSchema>;

// ── Signature ────────────────────────────────────────────────

export const SignatureMethod = z.enum(["eip712", "eip191"]);

export const SignatureSchema = z.object({
  signer: z.string(),
  sig: z.string(),
  method: SignatureMethod,
});

export type Signature = z.infer<typeof SignatureSchema>;

// ── Conditions ───────────────────────────────────────────────

export const ConditionsSchema = z.object({
  deadline: z.number().int().positive(),
  maxSlippage: z.number().min(0).max(1).optional(),
  partialFill: z.boolean().optional(),
  counterparty: z.array(z.string()).optional(),
  // Deprecated: prefer minCounterpartyTier (objective KYC-based filter)
  minCounterpartyReputation: z.number().min(0).optional(),
  // Minimum KYC tier the counterparty must attest to. Filter for
  // institutional flows that require compliance-gated peers.
  minCounterpartyTier: KycTier.optional(),
});

export type Conditions = z.infer<typeof ConditionsSchema>;

// ── HashLockIntent ───────────────────────────────────────────

export const HashLockIntentSchema = z.object({
  // Meta
  id: z.string().uuid(),
  version: z.literal("1.0"),
  createdAt: z.number().int().positive(),
  chainId: z.number().int().positive(),
  nonce: z.string().min(1),

  // What I give
  give: GiveSchema,

  // What I want
  receive: ReceiveSchema,

  // Settlement conditions
  conditions: ConditionsSchema,

  // Solver directives
  solver: SolverDirectiveSchema,

  // Settlement type
  settlement: SettlementSchema,

  // Trigger info (off-chain reference)
  trigger: TriggerSchema.optional(),

  // Signature
  signature: SignatureSchema.optional(),

  // Principal attestation (optional, for agent/institution flows)
  // Humans using session-level JWT auth may omit this.
  attestation: PrincipalAttestationSchema.optional(),

  // Agent instance metadata (optional, for autonomous agents)
  // Must be accompanied by `attestation` when present.
  agentInstance: AgentInstanceSchema.optional(),
});

export type HashLockIntent = z.infer<typeof HashLockIntentSchema>;
