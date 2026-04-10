// ── Types ────────────────────────────────────────────────────
export type {
  HashLockIntent,
  Settlement,
  Trigger,
  Signature,
  Conditions,
  Give,
  Receive,
  SolverDirective,
  PrincipalAttestation,
  AgentInstance,
} from "./types/index.js";

export {
  HashLockIntentSchema,
  SettlementSchema,
  TriggerSchema,
  SignatureSchema,
  ConditionsSchema,
  GiveSchema,
  ReceiveSchema,
  SolverDirectiveSchema,
  PrincipalAttestationSchema,
  AgentInstanceSchema,
  AssetType,
  SettlementType,
  AtomicityType,
  TriggerType,
  SignatureMethod,
  SolverAccessType,
  SolverStrategy,
  KycTier,
  KYC_TIER_RANK,
  meetsKycTier,
  PrincipalType,
  SUPPORTED_CHAINS,
  isSupportedChain,
} from "./types/index.js";

// ── Builder ──────────────────────────────────────────────────
export { IntentBuilder } from "./builder/IntentBuilder.js";

// ── Parser ───────────────────────────────────────────────────
export { IntentParser, IntentParseError } from "./parser/IntentParser.js";
export type { ParseResult } from "./parser/IntentParser.js";

// ── Validator ────────────────────────────────────────────────
export { IntentValidator } from "./validator/IntentValidator.js";
export type { ValidationResult } from "./validator/IntentValidator.js";

// ── Committer ────────────────────────────────────────────────
export {
  IntentCommitter,
  explainIntent,
} from "./committer/IntentCommitter.js";
export type {
  CommitOptions,
  Commitment,
  SolverProof,
  CommitProvider,
} from "./committer/IntentCommitter.js";
