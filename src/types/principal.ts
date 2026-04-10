import { z } from "zod";

// ── KYC Tier ────────────────────────────────────────────────

export const KycTier = z.enum([
  "NONE",
  "BASIC",
  "STANDARD",
  "ENHANCED",
  "INSTITUTIONAL",
]);

export type KycTier = z.infer<typeof KycTier>;

export const KYC_TIER_RANK: Record<KycTier, number> = {
  NONE: 0,
  BASIC: 1,
  STANDARD: 2,
  ENHANCED: 3,
  INSTITUTIONAL: 4,
};

export function meetsKycTier(actual: KycTier, required: KycTier): boolean {
  return KYC_TIER_RANK[actual] >= KYC_TIER_RANK[required];
}

// ── Principal Type ──────────────────────────────────────────

export const PrincipalType = z.enum(["HUMAN", "INSTITUTION", "AGENT"]);

export type PrincipalType = z.infer<typeof PrincipalType>;

// ── Principal Attestation ───────────────────────────────────
//
// Binds an intent to a KYC'd entity WITHOUT revealing the entity
// to counterparties. The gateway verifies the proof; counterparties
// see only blindId + tier.
//
// Backward compatibility: every intent MAY omit this field. Human
// OTC flows that authenticate at the session level (JWT) do not
// need it. It is additive — present only when the signer wants to
// prove KYC tier under a principal without leaking identity.

export const PrincipalAttestationSchema = z.object({
  principalId: z.string().min(1),
  principalType: PrincipalType,
  tier: KycTier,
  blindId: z.string().min(1).optional(),
  issuedAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
  proof: z.string().min(1),
});

export type PrincipalAttestation = z.infer<typeof PrincipalAttestationSchema>;

// ── Agent Instance Metadata ─────────────────────────────────

export const AgentInstanceSchema = z.object({
  instanceId: z.string().min(1),
  strategy: z.string().optional(),
  version: z.string().optional(),
  spawnedAt: z.number().int().positive().optional(),
});

export type AgentInstance = z.infer<typeof AgentInstanceSchema>;
