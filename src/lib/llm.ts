import { config } from "./config";

export type LlmRequest = {
  system: string;
  user: string;
  /** 0-based attempt number; lets the mock fail deterministically on the first try. */
  attempt: number;
};

/** Swap in a real provider (OpenAI, Anthropic, ...) by implementing this single method. */
export interface LlmProvider {
  readonly name: string;
  complete(req: LlmRequest): Promise<string>;
}

/**
 * Deterministic offline provider: no API keys, no network.
 * It treats note text purely as data. With `malformedOnFirstAttempt` it returns truncated JSON on
 * attempt 0 to exercise the validate-and-retry path.
 */
export class MockProvider implements LlmProvider {
  readonly name = "mock-v1";
  constructor(private opts: { malformedOnFirstAttempt?: boolean } = {}) {}

  async complete(req: LlmRequest): Promise<string> {
    if (this.opts.malformedOnFirstAttempt && req.attempt === 0) {
      return '{"summary": "Draft summary", "keyPoints": ["unfinished';
    }
    const input = JSON.parse(req.user) as { notes: { title: string; content: string }[] };
    const first = (t: string) => (t.split(/(?<=[.!?])\s/)[0] ?? "").slice(0, 280).trim();
    const summary = `This project has ${input.notes.length} note(s) covering: ${input.notes.map((n) => n.title).join("; ")}`;
    return JSON.stringify({
      summary: summary.slice(0, 1500),
      keyPoints: input.notes.slice(0, 10).map((n) => first(n.content) || n.title.slice(0, 280)),
    });
  }
}

export function getProvider(): LlmProvider {
  return new MockProvider({ malformedOnFirstAttempt: config.mockMalformedOnce });
}
