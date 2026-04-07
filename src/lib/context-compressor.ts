/**
 * Context Compressor — automatic conversation compression engine.
 *
 * When estimated context usage exceeds 80% of the window, compresses older
 * messages into a summary stored in the session. Subsequent fallback contexts
 * use "summary + recent messages" instead of raw full history.
 *
 * Uses the same lightweight LLM call pattern as memory-extractor.ts:
 * generateTextFromProvider + resolveProvider({ useCase: 'small' }).
 */

import { roughTokenEstimate } from './context-estimator';

// ── Types ────────────────────────────────────────────────────────────

export interface CompressionResult {
  summary: string;
  messagesCompressed: number;
  estimatedTokensSaved: number;
}

export interface CompressParams {
  sessionId: string;
  messages: Array<{ role: string; content: string }>;
  existingSummary?: string;
  providerId?: string;
  /** Session model to use as fallback if small/haiku is unavailable */
  sessionModel?: string;
}

// ── Circuit breaker ─────────────────────────────────────────────────

const compressionFailures = new Map<string, number>();
const MAX_CONSECUTIVE_FAILURES = 3;

export function shouldCompress(sessionId: string): boolean {
  return (compressionFailures.get(sessionId) || 0) < MAX_CONSECUTIVE_FAILURES;
}

function recordFailure(sessionId: string): void {
  compressionFailures.set(sessionId, (compressionFailures.get(sessionId) || 0) + 1);
}

function recordSuccess(sessionId: string): void {
  compressionFailures.delete(sessionId);
}

/** Reset circuit breaker for a session (e.g., on manual /compact). */
export function resetCompressionState(sessionId: string): void {
  compressionFailures.delete(sessionId);
}

// ── Compression threshold check ─────────────────────────────────────

const COMPRESSION_THRESHOLD = 0.8; // 80% of context window

/**
 * Check whether context should be compressed based on estimated usage.
 */
export function needsCompression(
  estimatedTokens: number,
  contextWindow: number,
  sessionId: string,
): boolean {
  if (contextWindow <= 0) return false;
  if (!shouldCompress(sessionId)) return false;
  return (estimatedTokens / contextWindow) >= COMPRESSION_THRESHOLD;
}

// ── Main compression function ───────────────────────────────────────

/**
 * Compress older conversation messages into a concise summary.
 *
 * Takes messages that would be truncated by the token budget and summarizes
 * them. If an existing summary exists, incorporates it as prior context.
 */
export async function compressConversation(params: CompressParams): Promise<CompressionResult> {
  const { sessionId, messages, existingSummary, providerId, sessionModel } = params;

  if (messages.length === 0) {
    return { summary: existingSummary || '', messagesCompressed: 0, estimatedTokensSaved: 0 };
  }

  try {
    const { generateTextViaSdk } = await import('./claude-client');
    const { resolveProvider } = await import('./provider-resolver');
    const { normalizeMessageContent } = await import('./message-normalizer');

    // Resolve model via provider-aware chain: roleModels.small → catalog upstreamModelId → fallback
    const resolved = resolveProvider({ useCase: 'small', providerId, sessionModel });
    const effectiveModel = resolved.upstreamModel || resolved.model || sessionModel || 'haiku';

    // Clean messages before summarizing: strip file metadata, extract tool summaries
    const formatted = messages.map(m => {
      const role = m.role === 'user' ? 'User' : 'Assistant';
      const cleaned = normalizeMessageContent(m.role, m.content);
      const content = cleaned.length > 800 ? cleaned.slice(0, 800) + '...' : cleaned;
      return `${role}: ${content}`;
    }).join('\n\n');

    const existingSummaryBlock = existingSummary
      ? `\n\nPrevious summary of even earlier conversation:\n${existingSummary}\n`
      : '';

    const system = `You are a conversation summarizer. Produce a concise summary that preserves:
- Key decisions and conclusions
- File paths, function names, and code references mentioned
- Open tasks or action items
- Important user preferences or constraints expressed
Do NOT include greetings, filler, or restate obvious context. Write in the same language as the conversation.`;

    const prompt = `Summarize the following conversation excerpt into a concise summary (max 500 words).${existingSummaryBlock}

Conversation to summarize:
${formatted}

Summary:`;

    // SDK subprocess for transport (compatible with third-party proxies),
    // but model selected via provider resolver (respects roleModels.small + upstreamModelId).
    const result = await generateTextViaSdk({
      providerId: providerId || undefined,
      model: effectiveModel,
      system,
      prompt,
    });

    if (!result || result.trim().length < 10) {
      console.warn('[context-compressor] Summary too short:', result?.trim().length, 'chars');
      throw new Error('Compression produced empty or too-short summary');
    }

    const summary = result.trim();
    const originalTokens = messages.reduce((sum, m) => sum + roughTokenEstimate(m.content), 0);
    const summaryTokens = roughTokenEstimate(summary);

    recordSuccess(sessionId);

    return {
      summary,
      messagesCompressed: messages.length,
      estimatedTokensSaved: Math.max(0, originalTokens - summaryTokens),
    };
  } catch (error) {
    recordFailure(sessionId);
    console.error('[context-compressor] Compression failed:', error);
    throw error;
  }
}
