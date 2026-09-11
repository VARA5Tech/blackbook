import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

/**
 * All AI access goes through OpenRouter.
 *
 * One key, any model. Changing which model the CRM uses is an environment
 * variable, not a code change and not a new credential, so trying a cheaper or
 * stronger model is a restart rather than a deployment.
 *
 * The AI SDK stays in place above this file: it is the vendor-neutral interface
 * the handover asks for, and OpenRouter is one provider plugged into it.
 */

/** Cheap, current, and long-context enough for a whole client record. */
const DEFAULT_MODEL = "qwen/qwen3.7-flash";

export function getModelId(): string {
  return process.env.AI_MODEL ?? DEFAULT_MODEL;
}

export function getModel(): LanguageModel {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new AiNotConfiguredError();

  const openrouter = createOpenRouter({
    apiKey,
    headers: {
      // OpenRouter attributes traffic with these; they are optional but make
      // the dashboard readable when several apps share one key.
      "HTTP-Referer": process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
      "X-Title": "Blackbook",
    },
  });

  return openrouter.chat(getModelId(), {
    /**
     * Reasoning off by default.
     *
     * A briefing restates facts already in the record in a readable order. It
     * is extraction, not deduction, and measured on this exact task the model
     * spent 960 of 1100 output tokens thinking before writing anything: nine
     * times the cost and three times the wait, for output no better than
     * without it. Worse for a button someone is watching, since reasoning
     * tokens do not stream, so the dialog sits blank throughout.
     *
     * Set AI_REASONING=true to turn it back on for a model or a task that
     * genuinely needs it.
     */
    extraBody: {
      reasoning: { enabled: process.env.AI_REASONING === "true" },
    },
  });
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super(
      "AI is not configured. Add OPENROUTER_API_KEY to the environment to enable it.",
    );
    this.name = "AiNotConfiguredError";
  }
}
