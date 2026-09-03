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
  evidenceEventIds?: string[];
}

export interface AiDiagnosticOutput {
  diagnosis: string;
  root_cause: string;
  risk: string;
  recommendation: string;
  confidence: number;
  evidence_event_ids: string[];
}

/**
 * Validates and bounds the LLM output into a typed, verified schema.
 */
export function validateAiDiagnosticOutput(raw: unknown, defaultFallback: LlmNarratorInput): AiDiagnosticOutput | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  if (typeof obj.diagnosis !== 'string' || obj.diagnosis.length < 5) return null;
  if (typeof obj.recommendation !== 'string') return null;

  const validCauses = [
    'CARD_EXPIRY_RISK',
    'AFA_PENDING',
    'REPEATED_SOFT_DECLINE',
    'MANDATE_INACTIVE',
    'HARD_DECLINE_PATTERN',
    'NONE',
    'UNKNOWN',
  ];

  const rootCause = typeof obj.root_cause === 'string' && validCauses.includes(obj.root_cause)
    ? obj.root_cause
    : defaultFallback.rootCause;

  const confidence = typeof obj.confidence === 'number' && obj.confidence >= 0 && obj.confidence <= 1
    ? Math.round(obj.confidence * 100) / 100
    : 0.85;

  const evidence = Array.isArray(obj.evidence_event_ids)
    ? (obj.evidence_event_ids.filter((id) => typeof id === 'string') as string[])
    : defaultFallback.evidenceEventIds || [];

  return {
    diagnosis: obj.diagnosis.slice(0, 300).trim(),
    root_cause: rootCause,
    risk: typeof obj.risk === 'string' ? obj.risk.slice(0, 100) : defaultFallback.trajectory,
    recommendation: obj.recommendation.slice(0, 150).trim(),
    confidence,
    evidence_event_ids: evidence,
  };
}

/**
 * External LLM Diagnostic Narrator.
 *
 * Dedicated AI narrative & structured diagnosis synthesis client (Gemini & OpenAI).
 * Strictly insulated from execution modules: Output is purely advisory data.
 */
export async function callLlmNarrator(input: LlmNarratorInput): Promise<AiDiagnosticOutput | null> {
  const isAiEnabled =
    process.env.AI_REASONING_ENABLED !== 'false' &&
    (!!process.env.GEMINI_API_KEY || !!process.env.OPENAI_API_KEY);

  if (!isAiEnabled) return null;

  const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const prompt = `You are an AI Revenue Recovery diagnostic assistant. Provide a concise, structured JSON diagnosis for a recurring payment failure.
Data:
- Rail: ${input.rail}
- Health Score: ${(input.healthScore * 100).toFixed(0)}/100 (${input.trajectory})
- Root Cause: ${input.rootCause}
- Consecutive Failures: ${input.featureVector.consecutive_failures}
- Days to Expiry: ${input.featureVector.days_to_expiry}
- Proposed Action: ${input.proposedAction}
- Monthly Revenue: ₹${input.monthlyAmountRupees}
- Expected Recovery Value: ₹${input.expectedRecoveryValueRupees}
- Evidence IDs: ${JSON.stringify(input.evidenceEventIds || [])}

You must return ONLY a valid JSON object matching this schema:
{
  "diagnosis": "concise 2-sentence clinical diagnosis grounded strictly in data",
  "root_cause": "${input.rootCause}",
  "risk": "${input.trajectory}",
  "recommendation": "${input.proposedAction}",
  "confidence": 0.90,
  "evidence_event_ids": []
}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000); // 2-second strict timeout

  try {
    // 1. Google Gemini Provider
    if (process.env.GEMINI_API_KEY) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json' },
          }),
          signal: controller.signal,
        },
      );
      clearTimeout(timeoutId);
      if (!res.ok) return null;
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!text) return null;
      const parsed = JSON.parse(text);
      return validateAiDiagnosticOutput(parsed, input);
    }

    // 2. OpenAI Provider
    if (process.env.OPENAI_API_KEY) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are an AI Payment Recovery Diagnostic Engine. Output JSON only.' },
            { role: 'user', content: prompt },
          ],
          response_format: { type: 'json_object' },
          max_tokens: 150,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) return null;
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data?.choices?.[0]?.message?.content?.trim();
      if (!content) return null;
      const parsed = JSON.parse(content);
      return validateAiDiagnosticOutput(parsed, input);
    }
  } catch {
    clearTimeout(timeoutId);
    return null;
  }

  clearTimeout(timeoutId);
  return null;
}
