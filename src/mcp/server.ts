#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { IntentBuilder } from "../builder/IntentBuilder.js";
import { IntentValidator } from "../validator/IntentValidator.js";
import { IntentParser } from "../parser/IntentParser.js";
import { IntentCommitter, explainIntent } from "../committer/IntentCommitter.js";
import type { HashLockIntent } from "../types/index.js";

// ── Server ───────────────────────────────────────────────────

const server = new McpServer({
  name: "hashlock-intent",
  version: "1.0.0",
});

// ── Tool: create_intent ──────────────────────────────────────

server.tool(
  "create_intent",
  "Create a HashLockIntent via the fluent builder. Returns the validated intent JSON.",
  {
    // Give side
    giveAsset: z.enum(["ETH", "ERC20", "ERC721"]).describe("Asset type to give"),
    giveToken: z.string().optional().describe("Token contract address (required for ERC20/ERC721)"),
    giveAmount: z.string().describe("Amount in smallest unit (wei for ETH)"),
    giveChain: z.number().int().positive().describe("Source chain ID"),
    // Receive side
    receiveAsset: z.enum(["ETH", "ERC20", "ERC721"]).describe("Asset type to receive"),
    receiveToken: z.string().optional().describe("Token contract address"),
    receiveMinAmount: z.string().describe("Minimum acceptable amount in smallest unit"),
    receiveMaxAmount: z.string().optional().describe("Maximum amount (optional upper bound)"),
    receiveChain: z.number().int().positive().describe("Destination chain ID"),
    // Conditions
    deadlineSeconds: z.number().int().positive().describe("Deadline in seconds from now"),
    maxSlippage: z.number().min(0).max(1).optional().describe("Max slippage (0.005 = 0.5%)"),
    partialFill: z.boolean().optional().describe("Allow partial fills"),
    // Solver
    solverType: z.enum(["open", "preferred", "exclusive"]).default("open").describe("Solver access type"),
    solverPreferred: z.array(z.string()).optional().describe("Preferred solver addresses"),
    solverStrategy: z.enum(["best_price", "fastest", "lowest_fee"]).default("best_price").describe("Execution strategy"),
    solverMaxFee: z.string().optional().describe("Max fee payable to solver"),
    // Settlement
    settlementType: z.enum(["bilateral", "ring", "batch"]).default("bilateral").describe("Settlement mechanism"),
    ringParties: z.array(z.string()).optional().describe("Ring settlement participant addresses"),
    atomicity: z.enum(["full", "partial"]).default("full").describe("Atomicity guarantee"),
    // Trigger
    triggerType: z.enum(["immediate", "conditional"]).optional().describe("Trigger type"),
    triggerDescription: z.string().optional().describe("Human-readable trigger condition"),
    triggerAgentId: z.string().optional().describe("Producing agent ID"),
    triggerConfidence: z.number().min(0).max(1).optional().describe("Agent confidence score"),
    // Counterparty compliance filter
    minCounterpartyTier: z
      .enum(["NONE", "BASIC", "STANDARD", "ENHANCED", "INSTITUTIONAL"])
      .optional()
      .describe("Minimum KYC tier the counterparty must attest to"),
    // Principal attestation (for agent/institution flows)
    attestationPrincipalId: z.string().optional().describe("Principal ID hash (attestation)"),
    attestationPrincipalType: z.enum(["HUMAN", "INSTITUTION", "AGENT"]).optional().describe("Principal type"),
    attestationTier: z
      .enum(["NONE", "BASIC", "STANDARD", "ENHANCED", "INSTITUTIONAL"])
      .optional()
      .describe("Signer's attested KYC tier"),
    attestationBlindId: z.string().optional().describe("Rotating pseudonym the counterparty sees"),
    attestationIssuedAt: z.number().int().positive().optional().describe("Attestation issuedAt (unix seconds)"),
    attestationExpiresAt: z.number().int().positive().optional().describe("Attestation expiry (unix seconds)"),
    attestationProof: z.string().optional().describe("Opaque attestation proof (signature/ZK) verified by gateway"),
    // Agent instance metadata
    agentInstanceId: z.string().optional().describe("Agent instance ID (must pair with attestation)"),
    agentInstanceStrategy: z.string().optional().describe("Strategy label (e.g. 'mm-eth-usdc')"),
    agentInstanceVersion: z.string().optional().describe("Agent software version"),
  },
  async (params) => {
    try {
      const builder = new IntentBuilder()
        .give({
          asset: params.giveAsset,
          token: params.giveToken,
          amount: params.giveAmount,
          chain: params.giveChain,
        })
        .receive({
          asset: params.receiveAsset,
          token: params.receiveToken,
          minAmount: params.receiveMinAmount,
          maxAmount: params.receiveMaxAmount,
          chain: params.receiveChain,
        })
        .deadline(params.deadlineSeconds)
        .solver(params.solverType, params.solverPreferred)
        .strategy(params.solverStrategy)
        .settlement(params.settlementType, params.ringParties)
        .atomicity(params.atomicity);

      if (params.maxSlippage !== undefined) builder.maxSlippage(params.maxSlippage);
      if (params.partialFill !== undefined) builder.partialFill(params.partialFill);
      if (params.solverMaxFee) builder.solverMaxFee(params.solverMaxFee);

      if (params.triggerType) {
        builder.trigger({
          type: params.triggerType,
          description: params.triggerDescription,
          agentId: params.triggerAgentId,
          confidence: params.triggerConfidence,
        });
      }

      if (params.minCounterpartyTier) {
        builder.minCounterpartyTier(params.minCounterpartyTier);
      }

      if (
        params.attestationPrincipalId &&
        params.attestationPrincipalType &&
        params.attestationTier &&
        params.attestationIssuedAt &&
        params.attestationExpiresAt &&
        params.attestationProof
      ) {
        builder.attestation({
          principalId: params.attestationPrincipalId,
          principalType: params.attestationPrincipalType,
          tier: params.attestationTier,
          blindId: params.attestationBlindId,
          issuedAt: params.attestationIssuedAt,
          expiresAt: params.attestationExpiresAt,
          proof: params.attestationProof,
        });
      }

      if (params.agentInstanceId) {
        builder.agentInstance({
          instanceId: params.agentInstanceId,
          strategy: params.agentInstanceStrategy,
          version: params.agentInstanceVersion,
        });
      }

      const intent = builder.build();

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(intent, null, 2),
          },
        ],
      };
    } catch (e) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ── Tool: validate_intent ────────────────────────────────────

server.tool(
  "validate_intent",
  "Validate a HashLockIntent against schema and business rules. Returns validation result with errors and warnings.",
  {
    intent: z.string().describe("Intent JSON string to validate"),
  },
  async (params) => {
    try {
      const parsed = JSON.parse(params.intent) as unknown;
      const validator = new IntentValidator();
      const result = validator.validate(parsed);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (e) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ── Tool: parse_natural_language ─────────────────────────────

server.tool(
  "parse_natural_language",
  "Parse natural language text into a HashLockIntent. Supports Turkish and English. " +
    'Example: "0.1 ETH karşılığı en az 300 USDC al, 1 saat içinde"',
  {
    text: z.string().describe("Natural language trading intent"),
    chainId: z.number().int().positive().optional().describe("Default chain ID (defaults to 1 = Ethereum)"),
  },
  async (params) => {
    try {
      const parser = new IntentParser();
      const result = await parser.fromText(params.text, {
        chainId: params.chainId,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                intent: result.intent,
                confidence: result.confidence,
                ambiguities: result.ambiguities,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (e) {
      return {
        content: [{ type: "text" as const, text: `Parse error: ${(e as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ── Tool: commit_intent ──────────────────────────────────────

server.tool(
  "commit_intent",
  "Create an off-chain commitment from an intent. Returns commitment hash and solver proof with selective disclosure. " +
    "Use hideAmounts + hideCounterparty + hideIdentity + revealOnMatch=false for a sealed-bid commit in a blind auction.",
  {
    intent: z.string().describe("Intent JSON string to commit"),
    hideAmounts: z.boolean().default(false).describe("Hide amounts from solver proof"),
    hideCounterparty: z.boolean().default(false).describe("Hide counterparty list from solver proof"),
    hideIdentity: z.boolean().default(false).describe("Strip principal blindId from solver proof (tier still visible)"),
    revealOnMatch: z.boolean().default(true).describe("Reveal full intent when matched (set false for full sealed bid)"),
  },
  async (params) => {
    try {
      const intent = JSON.parse(params.intent) as HashLockIntent;
      const committer = new IntentCommitter();
      const commitment = await committer.commit(intent, {
        hideAmounts: params.hideAmounts,
        hideCounterparty: params.hideCounterparty,
        hideIdentity: params.hideIdentity,
        revealOnMatch: params.revealOnMatch,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                hash: commitment.hash,
                proof: commitment.proof,
                committedAt: commitment.committedAt,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (e) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ── Tool: explain_intent ─────────────────────────────────────

server.tool(
  "explain_intent",
  "Generate a human-readable explanation of a HashLockIntent. Useful for reviewing or presenting intents.",
  {
    intent: z.string().describe("Intent JSON string to explain"),
  },
  async (params) => {
    try {
      const intent = JSON.parse(params.intent) as HashLockIntent;
      const explanation = explainIntent(intent);

      return {
        content: [{ type: "text" as const, text: explanation }],
      };
    } catch (e) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ── Start ────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
