import { z } from "zod";

// ── Asset specification for give side ────────────────────────

export const AssetType = z.enum(["ETH", "ERC20", "ERC721"]);

export const GiveSchema = z.object({
  asset: AssetType,
  token: z.string().optional(),
  amount: z.string().min(1),
  chain: z.number().int().positive(),
});

export type Give = z.infer<typeof GiveSchema>;

// ── Asset specification for receive side ─────────────────────

export const ReceiveSchema = z.object({
  asset: AssetType,
  token: z.string().optional(),
  minAmount: z.string().min(1),
  maxAmount: z.string().optional(),
  chain: z.number().int().positive(),
});

export type Receive = z.infer<typeof ReceiveSchema>;

// ── Supported chains ─────────────────────────────────────────

export const SUPPORTED_CHAINS: Record<number, string> = {
  1: "Ethereum Mainnet",
  10: "Optimism",
  56: "BNB Chain",
  137: "Polygon",
  324: "zkSync Era",
  8453: "Base",
  42161: "Arbitrum One",
  43114: "Avalanche",
  11155111: "Sepolia",
};

export function isSupportedChain(chainId: number): boolean {
  return chainId in SUPPORTED_CHAINS;
}
