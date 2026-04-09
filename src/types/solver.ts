import { z } from "zod";

// ── Solver access types ──────────────────────────────────────

export const SolverAccessType = z.enum(["open", "preferred", "exclusive"]);
export type SolverAccessType = z.infer<typeof SolverAccessType>;

// ── Solver strategy ──────────────────────────────────────────

export const SolverStrategy = z.enum(["best_price", "fastest", "lowest_fee"]);
export type SolverStrategy = z.infer<typeof SolverStrategy>;

// ── Solver directive ─────────────────────────────────────────

export const SolverDirectiveSchema = z
  .object({
    type: SolverAccessType,
    preferred: z.array(z.string()).optional(),
    maxFee: z.string().optional(),
    strategy: SolverStrategy,
  })
  .refine(
    (data) => {
      // If type is "preferred" or "exclusive", preferred list must exist
      if (data.type === "preferred" || data.type === "exclusive") {
        return data.preferred && data.preferred.length > 0;
      }
      return true;
    },
    {
      message:
        "preferred solver list required when type is 'preferred' or 'exclusive'",
    }
  );

export type SolverDirective = z.infer<typeof SolverDirectiveSchema>;
