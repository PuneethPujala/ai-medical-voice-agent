/**
 * Groq Cloud OpenAI-Compatible LLM Client for MedVoice AI
 * 
 * Interacts with Groq Cloud's OpenAI-compatible API endpoint:
 * https://api.groq.com/openai/v1/chat/completions
 * 
 * Invariants:
 * 1. API key is read strictly server-side from process.env.GROQ_API_KEY (never NEXT_PUBLIC_*, never hardcoded).
 * 2. Primary production model defaults to openai/gpt-oss-120b (high instruction-following and clinical verbalization fidelity).
 * 3. Handles openai/gpt-oss-120b reasoning/scratchpads: extracts content while safely isolating reasoning tokens.
 * 4. Pluggable mock completer for deterministic offline regression testing.
 * 5. Resilient timeout with AbortController and strict error classification.
 */

export interface GroqChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GroqCompletionOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  timeoutMs?: number;
  reasoning_effort?: "none" | "low" | "medium" | "high";
}

export interface GroqCompletionResult {
  content: string;
  reasoning_content?: string;
  model: string;
  latencyMs: number;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class GroqClient {
  private mockCompleter: ((messages: GroqChatMessage[], options: GroqCompletionOptions) => Promise<GroqCompletionResult | null>) | null = null;

  public setMockCompleter(completer: ((messages: GroqChatMessage[], options: GroqCompletionOptions) => Promise<GroqCompletionResult | null>) | null): void {
    this.mockCompleter = completer;
  }

  public getApiKey(): string {
    return process.env.GROQ_API_KEY || "";
  }

  public getBaseUrl(): string {
    return (process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
  }

  public getDefaultModel(): string {
    return process.env.GROQ_MODEL || "qwen/qwen3.8-27b";
  }

  public isConfigured(): boolean {
    if (process.env.DISABLE_GROQ_LLM === "true" || process.env.GROQ_ENABLED === "false") {
      return false;
    }
    if (this.mockCompleter) return true;
    const key = this.getApiKey();
    return Boolean(key && key.trim().length > 0 && !key.includes("sample"));
  }

  public async createChatCompletion(
    messages: GroqChatMessage[],
    options: GroqCompletionOptions = {}
  ): Promise<GroqCompletionResult> {
    if (this.mockCompleter) {
      const mockResult = await this.mockCompleter(messages, options);
      if (mockResult) return mockResult;
    }

    if (!this.isConfigured()) {
      throw new Error("GROQ_API_KEY is not configured in environment variables.");
    }

    const apiKey = this.getApiKey();
    const baseUrl = this.getBaseUrl();
    const model = options.model || this.getDefaultModel();
    const temperature = options.temperature ?? 0.2; // Low temperature for clinical rigor
    const max_tokens = options.max_tokens ?? 512;
    const timeoutMs = options.timeoutMs ?? 25000;

    const endpoint = `${baseUrl}/chat/completions`;
    const t0 = Date.now();

    console.log(
      `[Groq Cloud] Calling endpoint: ${endpoint} | Model: ${model} | Messages: ${messages.length} | MaxTokens: ${max_tokens}`
    );

    const maxRetries = 3;
    let attempt = 0;

    while (attempt <= maxRetries) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const bodyPayload: Record<string, any> = {
            model,
            messages,
            temperature,
            max_tokens,
            stream: false,
          };
          if (options.reasoning_effort && options.reasoning_effort !== "none") {
            bodyPayload.reasoning_effort = options.reasoning_effort;
          } else if (model.startsWith("openai/")) {
            bodyPayload.reasoning_effort = "low";
          }

          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(bodyPayload),
            signal: controller.signal,
          });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          let errorCategory = "API_ERROR";
          let userFacingReason = `HTTP ${response.status} (${response.statusText})`;

          if (response.status === 429) {
            errorCategory = "RATE_LIMIT_EXCEEDED";
            userFacingReason = "Groq Cloud rate limit exceeded. Backing off.";
            const isDailyLimit = /tokens per day|TPD/i.test(errorText);
            const waitMatch = errorText.match(/try again in ([0-9.]+)s/i);
            const waitSec = waitMatch && waitMatch[1] ? parseFloat(waitMatch[1]) : 3.5;

            // Only retry short-term bursts (RPM/TPM). For daily quotas (TPD) or waits > 20s, fail immediately.
            if (!isDailyLimit && waitSec <= 20 && attempt < maxRetries) {
              attempt++;
              const retryAfterHeader = response.headers.get("retry-after");
              const backoffMs = retryAfterHeader
                ? Math.min(parseInt(retryAfterHeader, 10) * 1000, 25000)
                : Math.max(Math.ceil(waitSec) * 1000 + 800, attempt * 2500);
              console.warn(`[Groq Cloud 429 Rate Limit] Retrying in ${Math.round(backoffMs)}ms (attempt ${attempt}/${maxRetries})...`);
              await new Promise(r => setTimeout(r, backoffMs));
              continue;
            }
          } else if (response.status === 401) {
            errorCategory = "AUTHENTICATION_ERROR";
            userFacingReason = "Invalid or expired Groq API key. Please verify process.env.GROQ_API_KEY.";
          } else if (response.status === 402) {
            errorCategory = "QUOTA_EXHAUSTED";
            userFacingReason = "Groq Cloud credits or rate limit budget exhausted.";
          } else if (response.status >= 500) {
            errorCategory = "SERVER_ERROR";
            userFacingReason = `Groq Cloud upstream service error (${response.status}).`;
          }

          console.error(`[Groq Cloud ${errorCategory}] Status ${response.status}: ${userFacingReason}`);
          console.error(`[Groq Cloud RESPONSE BODY]:`, errorText.slice(0, 300));

          const err = new Error(`Groq Cloud [${errorCategory}]: ${userFacingReason}`);
          (err as any).status = response.status;
          (err as any).category = errorCategory;
          throw err;
        }

        const data = await response.json();
      const choice = data.choices?.[0];
      const message = choice?.message;

      // Extract content and optional reasoning (from openai/gpt-oss-120b or gpt-oss-20b)
      let content = message?.content || "";
      const reasoning_content = message?.reasoning || message?.reasoning_content || "";

      // Clean any <think> tags if present
      if (content.includes("<think>")) {
        content = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      }

      // CRITICAL SAFETY INVARIANT: Never treat internal reasoning scratchpads as patient-facing dialogue!
      if (/^(?:We need to|Let's think|The user asks|Answer:|So answer:|Count:)/i.test(content) ||
          content.includes("Let's count:") ||
          content.includes("Ensure 15-25 words") ||
          content.includes("Count words:")) {
        const quoteMatches = Array.from(content.matchAll(/"([^"\n]{15,300})"/g));
        if (quoteMatches.length > 0) {
          const spokenCandidates = quoteMatches
            .map((m: any) => (m[1] ? String(m[1]).trim() : ""))
            .filter((c: string) => c && !c.startsWith("Wait,") && !c.includes("rule") && !c.includes("count") && !c.includes("Total "));
          if (spokenCandidates.length > 0) {
            content = spokenCandidates[spokenCandidates.length - 1];
          }
        }
      }

      // Strip residual counting tokens if any
      content = content.replace(/([a-zA-Z]+)\(\d+\)/g, "$1").replace(/([a-zA-Z]+)\d+/g, "$1").trim();

      const latencyMs = Date.now() - t0;

      console.log(
        `[Groq Cloud SUCCESS] Model: ${model} | Latency: ${latencyMs}ms | Tokens: prompt=${data.usage?.prompt_tokens || 0}, completion=${data.usage?.completion_tokens || 0}`
      );

      return {
        content: content.trim(),
        reasoning_content,
        model,
        latencyMs,
        usage: data.usage,
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - t0;
      if (err.name === "AbortError") {
        console.error(`[Groq Cloud TIMEOUT] Request timed out after ${timeoutMs}ms`);
        throw new Error(`Groq Cloud request timed out after ${timeoutMs}ms`);
      }
      console.error(`[Groq Cloud FAILED] Latency: ${latencyMs}ms | Error:`, err.message);
      throw err;
    }
    }
    throw new Error("Groq Cloud request failed after retries.");
  }
}

export const groqClient = new GroqClient();
