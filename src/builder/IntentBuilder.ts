import { randomUUID } from "node:crypto";
import { HashLockIntentSchema } from "../types/intent.js";
import type {
  HashLockIntent,
  Give,
  Receive,
  Trigger,
  PrincipalAttestation,
  AgentInstance,
} from "../types/index.js";
import type { KycTier } from "../types/principal.js";

// ── Builder input types (user-friendly, amounts as ETH not wei) ──

interface GiveInput {
  asset: "ETH" | "ERC20" | "ERC721";
  token?: string;
  amount: string; // human-readable or wei
  chain: number;
}

interface ReceiveInput {
  asset: "ETH" | "ERC20" | "ERC721";
  token?: string;
  minAmount: string;
  maxAmount?: string;
  chain: number;
}

// ── Fluent Intent Builder ────────────────────────────────────

export class IntentBuilder {
  private _give?: Give;
  private _receive?: Receive;
  private _chainId = 1;
  private _deadline?: number;
  private _maxSlippage?: number;
  private _partialFill?: boolean;
  private _counterparty?: string[];
  private _solverType: "open" | "preferred" | "exclusive" = "open";
  private _solverPreferred?: string[];
  private _solverMaxFee?: string;
  private _solverStrategy: "best_price" | "fastest" | "lowest_fee" =
    "best_price";
  private _settlementType: "bilateral" | "ring" | "batch" = "bilateral";
  private _ringParties?: string[];
  private _atomicity: "full" | "partial" = "full";
  private _trigger?: Trigger;
  private _minCounterpartyTier?: KycTier;
  private _attestation?: PrincipalAttestation;
  private _agentInstance?: AgentInstance;

  /** Set what you're giving */
  give(input: GiveInput): this {
    this._give = {
      asset: input.asset,
      token: input.token,
      amount: input.amount,
      chain: input.chain,
    };
    this._chainId = input.chain;
    return this;
  }

  /** Set what you want to receive */
  receive(input: ReceiveInput): this {
    this._receive = {
      asset: input.asset,
      token: input.token,
      minAmount: input.minAmount,
      maxAmount: input.maxAmount,
      chain: input.chain,
    };
    return this;
  }

  /** Set primary chain ID */
  chainId(id: number): this {
    this._chainId = id;
    return this;
  }

  /** Set deadline in seconds from now */
  deadline(secondsFromNow: number): this {
    this._deadline = Math.floor(Date.now() / 1000) + secondsFromNow;
    return this;
  }

  /** Set absolute deadline as unix timestamp */
  deadlineAt(timestamp: number): this {
    this._deadline = timestamp;
    return this;
  }

  /** Max slippage tolerance (0.005 = 0.5%) */
  maxSlippage(slippage: number): this {
    this._maxSlippage = slippage;
    return this;
  }

  /** Allow partial fills */
  partialFill(allow = true): this {
    this._partialFill = allow;
    return this;
  }

  /** Whitelist counterparties (institutional) */
  counterparty(addresses: string[]): this {
    this._counterparty = addresses;
    return this;
  }

  /** Set solver access type and optional preferred list */
  solver(
    type: "open" | "preferred" | "exclusive",
    preferred?: string[]
  ): this {
    this._solverType = type;
    this._solverPreferred = preferred;
    return this;
  }

  /** Max fee to pay solver */
  solverMaxFee(fee: string): this {
    this._solverMaxFee = fee;
    return this;
  }

  /** Solver execution strategy */
  strategy(s: "best_price" | "fastest" | "lowest_fee"): this {
    this._solverStrategy = s;
    return this;
  }

  /** Settlement type */
  settlement(
    type: "bilateral" | "ring" | "batch",
    ringParties?: string[]
  ): this {
    this._settlementType = type;
    this._ringParties = ringParties;
    return this;
  }

  /** Atomicity requirement */
  atomicity(a: "full" | "partial"): this {
    this._atomicity = a;
    return this;
  }

  /** Trigger metadata (off-chain) */
  trigger(t: Trigger): this {
    this._trigger = t;
    return this;
  }

  /** Minimum KYC tier the counterparty must attest to */
  minCounterpartyTier(tier: KycTier): this {
    this._minCounterpartyTier = tier;
    return this;
  }

  /** Principal attestation (agent or institutional flows) */
  attestation(a: PrincipalAttestation): this {
    this._attestation = a;
    return this;
  }

  /** Agent instance metadata (must be paired with attestation) */
  agentInstance(i: AgentInstance): this {
    this._agentInstance = i;
    return this;
  }

  /** Build and validate the intent */
  build(): HashLockIntent {
    if (!this._give) throw new Error("give() is required");
    if (!this._receive) throw new Error("receive() is required");
    if (!this._deadline) throw new Error("deadline() is required");

    const raw = {
      id: randomUUID(),
      version: "1.0" as const,
      createdAt: Math.floor(Date.now() / 1000),
      chainId: this._chainId,
      nonce: randomUUID().replace(/-/g, ""),

      give: this._give,
      receive: this._receive,

      conditions: {
        deadline: this._deadline,
        maxSlippage: this._maxSlippage,
        partialFill: this._partialFill,
        counterparty: this._counterparty,
        minCounterpartyTier: this._minCounterpartyTier,
      },

      solver: {
        type: this._solverType,
        preferred: this._solverPreferred,
        maxFee: this._solverMaxFee,
        strategy: this._solverStrategy,
      },

      settlement: {
        type: this._settlementType,
        ringParties: this._ringParties,
        atomicity: this._atomicity,
      },

      trigger: this._trigger,

      attestation: this._attestation,
      agentInstance: this._agentInstance,
    };

    // Validate through Zod — throws on invalid
    return HashLockIntentSchema.parse(raw);
  }
}
