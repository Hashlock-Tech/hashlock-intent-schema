import { IntentBuilder } from "../builder/IntentBuilder.js";
import type { HashLockIntent } from "../types/index.js";

// ── Parse Result ─────────────────────────────────────────────

export interface ParseResult {
  intent: HashLockIntent;
  confidence: number;
  ambiguities: string[];
}

// ── Token Registry ───────────────────────────────────────────

const KNOWN_TOKENS: Record<string, { address: string; decimals: number }> = {
  USDC: {
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    decimals: 6,
  },
  USDT: {
    address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    decimals: 6,
  },
  DAI: {
    address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    decimals: 18,
  },
  WETH: {
    address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    decimals: 18,
  },
  WBTC: {
    address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    decimals: 8,
  },
};

// ── Patterns ─────────────────────────────────────────────────

const AMOUNT_PATTERN =
  /(\d+(?:\.\d+)?)\s*(ETH|USDC|USDT|DAI|WETH|WBTC|BTC)/gi;
const DEADLINE_PATTERN =
  /(\d+)\s*(saat|hour|hours|dakika|minute|minutes|min|gün|day|days)/gi;
const SLIPPAGE_PATTERN =
  /slippage\s*(?:max|maksimum)?\s*(?:yarım puan|%?\s*(\d+(?:\.\d+)?)\s*%?|(\d+(?:\.\d+)?)\s*(?:puan|bps|basis))/gi;

// ── Intent Parser ────────────────────────────────────────────

/**
 * Parses natural language text into a HashLockIntent.
 *
 * This is a rule-based parser for deterministic, auditable parsing.
 * For LLM-powered parsing, use fromLLM() with your own provider.
 *
 * Supports:
 *   - "0.1 ETH karşılığı en az 300 USDC al"
 *   - "swap 0.1 ETH for 300 USDC"
 *   - "1 saat içinde" / "within 1 hour"
 *   - "slippage max yarım puan" / "max slippage 0.5%"
 */
export class IntentParser {
  /**
   * Parse natural language text into a HashLockIntent.
   * Throws if the text is too ambiguous to produce a valid intent.
   */
  async fromText(
    text: string,
    defaults: { chainId?: number } = {}
  ): Promise<ParseResult> {
    const ambiguities: string[] = [];
    const chainId = defaults.chainId ?? 1;

    // ── Extract amounts ──
    const amounts = this.extractAmounts(text);
    if (amounts.length < 2) {
      throw new IntentParseError(
        "Could not identify both give and receive amounts. " +
          'Expected format: "X TOKEN for Y TOKEN"',
        text
      );
    }

    const [giveAmt, receiveAmt] = amounts;

    // ── Extract deadline ──
    const deadlineSeconds = this.extractDeadline(text);
    if (deadlineSeconds === null) {
      ambiguities.push("no deadline specified — defaulting to 1 hour");
    }

    // ── Extract slippage ──
    const slippage = this.extractSlippage(text);
    if (slippage === null) {
      ambiguities.push("no slippage specified — defaulting to 0.5%");
    }

    // ── Detect trigger ──
    const triggerDesc = this.extractTrigger(text);

    // ── Build intent ──
    const builder = new IntentBuilder()
      .give({
        asset: giveAmt.isNative ? "ETH" : "ERC20",
        token: giveAmt.isNative ? undefined : giveAmt.tokenAddress,
        amount: giveAmt.weiAmount,
        chain: chainId,
      })
      .receive({
        asset: receiveAmt.isNative ? "ETH" : "ERC20",
        token: receiveAmt.isNative ? undefined : receiveAmt.tokenAddress,
        minAmount: receiveAmt.weiAmount,
        chain: chainId,
      })
      .deadline(deadlineSeconds ?? 3600)
      .maxSlippage(slippage ?? 0.005)
      .solver("open")
      .settlement("bilateral");

    if (triggerDesc) {
      builder.trigger({
        type: "conditional",
        description: triggerDesc,
      });
    }

    const intent = builder.build();

    // ── Confidence score ──
    const confidence = Math.max(0, 1 - ambiguities.length * 0.15);

    return { intent, confidence, ambiguities };
  }

  /**
   * Parse using an LLM provider.
   * Supply your own callLLM function.
   */
  async fromLLM(
    text: string,
    callLLM: (prompt: string) => Promise<string>
  ): Promise<ParseResult> {
    const prompt = buildLLMPrompt(text);
    const response = await callLLM(prompt);
    const parsed = JSON.parse(response) as Record<string, unknown>;

    // Build from LLM-structured output
    const builder = new IntentBuilder()
      .give({
        asset: (parsed.giveAsset as string) === "ETH" ? "ETH" : "ERC20",
        token: parsed.giveToken as string | undefined,
        amount: parsed.giveAmount as string,
        chain: (parsed.giveChain as number) ?? 1,
      })
      .receive({
        asset: (parsed.receiveAsset as string) === "ETH" ? "ETH" : "ERC20",
        token: parsed.receiveToken as string | undefined,
        minAmount: parsed.receiveMinAmount as string,
        chain: (parsed.receiveChain as number) ?? 1,
      })
      .deadline((parsed.deadlineSeconds as number) ?? 3600)
      .maxSlippage((parsed.maxSlippage as number) ?? 0.005)
      .solver("open")
      .settlement("bilateral");

    return {
      intent: builder.build(),
      confidence: (parsed.confidence as number) ?? 0.8,
      ambiguities: (parsed.ambiguities as string[]) ?? [],
    };
  }

  // ── Private Extractors ─────────────────────────────────────

  private extractAmounts(
    text: string
  ): Array<{
    symbol: string;
    humanAmount: string;
    weiAmount: string;
    isNative: boolean;
    tokenAddress?: string;
  }> {
    const results: Array<{
      symbol: string;
      humanAmount: string;
      weiAmount: string;
      isNative: boolean;
      tokenAddress?: string;
    }> = [];

    let match: RegExpExecArray | null;
    const pattern = new RegExp(AMOUNT_PATTERN.source, "gi");

    while ((match = pattern.exec(text)) !== null) {
      const amount = match[1];
      const symbol = match[2].toUpperCase();
      const isNative = symbol === "ETH";
      const token = KNOWN_TOKENS[symbol];

      results.push({
        symbol,
        humanAmount: amount,
        weiAmount: toSmallestUnit(amount, token?.decimals ?? 18),
        isNative,
        tokenAddress: token?.address,
      });
    }

    return results;
  }

  private extractDeadline(text: string): number | null {
    const pattern = new RegExp(DEADLINE_PATTERN.source, "gi");
    const match = pattern.exec(text);
    if (!match) return null;

    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    if (unit.startsWith("saat") || unit.startsWith("hour")) {
      return value * 3600;
    }
    if (
      unit.startsWith("dakika") ||
      unit.startsWith("minute") ||
      unit === "min"
    ) {
      return value * 60;
    }
    if (unit.startsWith("gün") || unit.startsWith("day")) {
      return value * 86400;
    }

    return null;
  }

  private extractSlippage(text: string): number | null {
    const lower = text.toLowerCase();

    // "yarım puan" = 0.5%
    if (lower.includes("yarım puan")) return 0.005;

    const pattern = new RegExp(SLIPPAGE_PATTERN.source, "gi");
    const match = pattern.exec(text);
    if (!match) return null;

    const value = parseFloat(match[1] || match[2]);
    // If value > 1, treat as basis points or percentage
    if (value > 1) return value / 100;
    return value;
  }

  private extractTrigger(text: string): string | null {
    const triggers = [
      /(?:piyasa|market)\s+(?:sakinleşince|stabilize|calms?)/i,
      /(?:volatil(?:ite|ity))\s*(?:>|spike|artınca|düşünce)/i,
      /(?:fiyat|price)\s*(?:>|<|düşünce|artınca)/i,
    ];

    for (const pattern of triggers) {
      const match = pattern.exec(text);
      if (match) return match[0];
    }

    return null;
  }
}

// ── Parse Error ──────────────────────────────────────────────

export class IntentParseError extends Error {
  constructor(
    message: string,
    public readonly input: string
  ) {
    super(message);
    this.name = "IntentParseError";
  }
}

// ── Helpers ──────────────────────────────────────────────────

function toSmallestUnit(amount: string, decimals: number): string {
  const parts = amount.split(".");
  const whole = parts[0];
  const fraction = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
  const raw = whole + fraction;
  // Remove leading zeros
  return raw.replace(/^0+/, "") || "0";
}

function buildLLMPrompt(text: string): string {
  return `Parse this trading intent into structured JSON.

Input: "${text}"

Return JSON with these fields:
- giveAsset: "ETH" | "ERC20"
- giveToken: contract address or null for ETH
- giveAmount: amount in wei (string)
- giveChain: chain ID (number)
- receiveAsset: "ETH" | "ERC20"
- receiveToken: contract address or null for ETH
- receiveMinAmount: minimum amount in smallest unit (string)
- receiveChain: chain ID (number)
- deadlineSeconds: seconds from now (number)
- maxSlippage: decimal (0.005 = 0.5%)
- confidence: 0-1 how confident you are
- ambiguities: string[] of unclear parts

Only return valid JSON, no explanation.`;
}
