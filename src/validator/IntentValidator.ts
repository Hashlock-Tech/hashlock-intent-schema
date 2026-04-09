import { ZodError } from "zod";
import { HashLockIntentSchema } from "../types/intent.js";
import { isSupportedChain } from "../types/conditions.js";
import type { HashLockIntent } from "../types/index.js";

// ── Validation Result ────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ── Intent Validator ─────────────────────────────────────────

export class IntentValidator {
  /**
   * Validate a HashLockIntent against schema and business rules.
   *
   * Schema validation (Zod) catches structural issues.
   * Business rules catch semantic issues:
   *   - deadline not expired
   *   - amount > 0
   *   - chain supported
   *   - give !== receive (no self-swap)
   *   - ring settlement has parties
   */
  validate(intent: unknown): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // ── Schema validation ──
    const parsed = HashLockIntentSchema.safeParse(intent);
    if (!parsed.success) {
      return {
        valid: false,
        errors: flattenZodErrors(parsed.error),
        warnings: [],
      };
    }

    const i = parsed.data;

    // ── Business rules ──
    this.checkDeadline(i, errors, warnings);
    this.checkAmounts(i, errors);
    this.checkChains(i, errors, warnings);
    this.checkSelfSwap(i, errors);
    this.checkSettlement(i, errors);
    this.checkSlippage(i, warnings);
    this.checkTokenAddress(i, warnings);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  private checkDeadline(
    i: HashLockIntent,
    errors: string[],
    warnings: string[]
  ): void {
    const now = Math.floor(Date.now() / 1000);
    if (i.conditions.deadline <= now) {
      errors.push("deadline has already passed");
    } else if (i.conditions.deadline - now < 60) {
      warnings.push("deadline is less than 60 seconds away");
    }
  }

  private checkAmounts(i: HashLockIntent, errors: string[]): void {
    if (BigInt(i.give.amount) <= 0n) {
      errors.push("give.amount must be greater than 0");
    }
    if (BigInt(i.receive.minAmount) <= 0n) {
      errors.push("receive.minAmount must be greater than 0");
    }
    if (
      i.receive.maxAmount !== undefined &&
      BigInt(i.receive.maxAmount) < BigInt(i.receive.minAmount)
    ) {
      errors.push("receive.maxAmount must be >= receive.minAmount");
    }
  }

  private checkChains(
    i: HashLockIntent,
    errors: string[],
    warnings: string[]
  ): void {
    if (!isSupportedChain(i.give.chain)) {
      warnings.push(`give.chain ${i.give.chain} is not in the known chain list`);
    }
    if (!isSupportedChain(i.receive.chain)) {
      warnings.push(
        `receive.chain ${i.receive.chain} is not in the known chain list`
      );
    }
    if (i.give.chain !== i.receive.chain) {
      warnings.push("cross-chain intent — solver must support bridging");
    }
  }

  private checkSelfSwap(i: HashLockIntent, errors: string[]): void {
    const sameAsset = i.give.asset === i.receive.asset;
    const sameToken = i.give.token === i.receive.token;
    const sameChain = i.give.chain === i.receive.chain;

    if (sameAsset && sameToken && sameChain) {
      errors.push("give and receive are identical — self-swap not allowed");
    }
  }

  private checkSettlement(i: HashLockIntent, errors: string[]): void {
    if (i.settlement.type === "ring") {
      if (!i.settlement.ringParties || i.settlement.ringParties.length < 2) {
        errors.push(
          "ring settlement requires at least 2 parties in ringParties"
        );
      }
    }
  }

  private checkSlippage(i: HashLockIntent, warnings: string[]): void {
    if (
      i.conditions.maxSlippage !== undefined &&
      i.conditions.maxSlippage > 0.1
    ) {
      warnings.push("maxSlippage > 10% — unusually high");
    }
  }

  private checkTokenAddress(i: HashLockIntent, warnings: string[]): void {
    if (i.give.asset !== "ETH" && !i.give.token) {
      warnings.push("give.asset is ERC20/ERC721 but no token address provided");
    }
    if (i.receive.asset !== "ETH" && !i.receive.token) {
      warnings.push(
        "receive.asset is ERC20/ERC721 but no token address provided"
      );
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────

function flattenZodErrors(error: ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}
