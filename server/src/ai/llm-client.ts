import type { RiskFeatureVector, InstrumentRail } from '@recovery/shared';

export interface LlmNarratorInput {
  instrumentId: string;
  rail: InstrumentRail;
  ltvTier: string;
  healthScore: number;
  trajectory: string;
  rootCause: string;
  proposedAction: string;
  expectedRecoveryValueRupees: number;
  monthlyAmountRupees: number;
  featureVector: RiskFeatureVector;
}

/**
 * External LLM Diagnostic Narrator.
 *
 * Dedicated AI narrative synthesis client (Gemini / OpenAI).
 * Strictly insulated from the core Planner calculation layer to preserve structural execution boundaries.
 */
export async function callLlmNarrator(input: LlmNarratorInput): Promise<string | null> {
  const isAiEnabled =
    process.env.AI_REASONING_ENABLED !== 'false' &&
    (!!process.env.GEMINI_API_KEY || !!process.env.OPENAI_API_KEY);

  if (!isAiEnabled) return null;

  const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const prompt = `You are an AI Revenue Recovery diagnostic assistant. Synthesize a concise, factual 2-sentence clinical diagnosis for a recurring payment failure.
Data:
- Rail: ${input.rail}
- Health Score: ${(input.healthScore * 100).toFixed(0)}/100 (${input.trajectory})
- Root Cause: ${input.rootCause}
- Consecutive Failures: ${input.featureVector.consecutive_failures}
- Days to Expiry: ${input.featureVector.days_to_expiry}
- Proposed Action: ${input.proposedAction}
- Monthly Revenue: ₹${input.monthlyAmountRupees}
- Expected Recovery Value: ₹${input.expectedRecoveryValueRupees}

Rules:
1. Strictly ground your claims in the provided data.
2. Do not hallucinate external bank names or unsourced facts.
3. Keep response under 40 words.`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s timeout

  try {
    if (process.env.GEMINI_API_KEY) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
          }),
          signal: controller.signal,
        },
      );
      clearTimeout(timeoutId);
      if (!res.ok) return null;
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
    }
  } catch {
    clearTimeout(timeoutId);
    return null;
  }

  clearTimeout(timeoutId);
  return null;
}
