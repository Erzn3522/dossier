import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AiError } from "./errors";
import { extractJson, validateJson, type AIProvider } from "./provider";
import { AnthropicProvider } from "./providers/anthropic";
import { MockProvider } from "./providers/mock";
import { OllamaProvider } from "./providers/ollama";
import { OpenAICompatibleProvider } from "./providers/openai-compatible";
import { json, stubFetch, type FakeRequest } from "./test-http";

afterEach(() => vi.unstubAllGlobals());

const Posting = z.object({ company: z.string(), years: z.number() });
const ask = { system: "Extract.", messages: [{ role: "user" as const, content: "Ledgerly wants 5 years." }], schema: Posting };

describe("extractJson", () => {
  it("reads plain JSON", () => {
    expect(extractJson(' {"a": 1} ')).toEqual({ a: 1 });
  });

  it("reads a fenced block", () => {
    expect(extractJson('Here you go:\n```json\n{"a": 1}\n```\nAnything else?')).toEqual({ a: 1 });
  });

  it("finds the first object in surrounding text, braces in strings included", () => {
    expect(extractJson('Sure! {"a": "curly } brace", "b": [1, {"c": 2}]} Hope that helps.')).toEqual({
      a: "curly } brace",
      b: [1, { c: 2 }],
    });
  });

  it("throws when there's no JSON", () => {
    expect(() => extractJson("I can't help with that.")).toThrow(SyntaxError);
  });
});

describe("validateJson", () => {
  it("says what's wrong in words a model can fix", () => {
    const result = validateJson('{"company": "Ledgerly", "years": "five"}', Posting);
    expect(result).toMatchObject({ ok: false, problem: expect.stringContaining("years") });
  });
});

// The same checks for every provider: each answer below is what the model says.
type Harness = {
  name: string;
  make: () => AIProvider;
  respond: (content: string, cutOff?: boolean) => Response;
  conversation: (request: FakeRequest) => unknown[];
};

const harnesses: Harness[] = [
  {
    name: "Ollama",
    make: () => new OllamaProvider("http://ollama:11434", "qwen2.5:3b", 60_000),
    respond: (content, cutOff) => json({ model: "qwen2.5:3b", message: { role: "assistant", content }, done: true, done_reason: cutOff ? "length" : "stop" }),
    conversation: (request) => (request.body as { messages: unknown[] }).messages,
  },
  {
    name: "OpenAI-compatible",
    make: () => new OpenAICompatibleProvider("OPENAI", `https://llm-${Math.random()}.example/v1`, "sk", "gpt-x", 60_000),
    respond: (content, cutOff) =>
      json({ id: "c", object: "chat.completion", created: 0, model: "gpt-x", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: cutOff ? "length" : "stop" }] }),
    conversation: (request) => (request.body as { messages: unknown[] }).messages,
  },
  {
    name: "Anthropic",
    make: () => new AnthropicProvider("https://api.anthropic.com", "sk-ant", "claude-sonnet-5", 60_000),
    respond: (content, cutOff) =>
      json({ id: "m", type: "message", role: "assistant", model: "claude-sonnet-5", content: [{ type: "text", text: content }], stop_reason: cutOff ? "max_tokens" : "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }),
    conversation: (request) => (request.body as { messages: unknown[] }).messages,
  },
];

describe.each(harnesses)("$name: structured output", ({ make, respond, conversation }) => {
  const answers = (...contents: string[]) => {
    const queue = [...contents];
    return stubFetch(() => respond(queue.shift() ?? "{}"));
  };

  it("returns a valid answer as it is", async () => {
    const requests = answers('{"company": "Ledgerly", "years": 5}');
    expect(await make().complete(ask)).toEqual({ company: "Ledgerly", years: 5 });
    expect(requests).toHaveLength(1);
  });

  it("can leave format corrections to a task with its own bounded loop", async () => {
    const requests = answers("{}");
    await expect(make().complete({ ...ask, formatRetries: 0 })).rejects.toMatchObject({ kind: "invalid-output" });
    expect(requests).toHaveLength(1);
  });

  it("accepts JSON in a code fence without asking again", async () => {
    const requests = answers('```json\n{"company": "Ledgerly", "years": 5}\n```');
    expect(await make().complete(ask)).toEqual({ company: "Ledgerly", years: 5 });
    expect(requests).toHaveLength(1);
  });

  it("asks once more, with the validation error, when the answer doesn't fit", async () => {
    const requests = answers('{"company": "Ledgerly", "years": "five"}', '{"company": "Ledgerly", "years": 5}');
    expect(await make().complete(ask)).toEqual({ company: "Ledgerly", years: 5 });
    expect(requests).toHaveLength(2);
    const retry = conversation(requests[1]);
    expect(retry.at(-2)).toMatchObject({ role: "assistant", content: '{"company": "Ledgerly", "years": "five"}' });
    expect(retry.at(-1)).toMatchObject({ role: "user", content: expect.stringContaining("years") });
  });

  it("gives up after the second miss with an error that offers Retry", async () => {
    answers("Sorry, I can't.", '{"company": 42}');
    const error = await make().complete(ask).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(AiError);
    expect(error).toMatchObject({ kind: "invalid-output", retryable: true, message: "The model's answer didn't come back in the expected shape. Try again." });
  });

  it("stops at an answer cut off by the token limit, since asking again gets cut off too", async () => {
    const requests = stubFetch(() => respond('{"company": "Ledg', true));
    const error = await make().complete(ask).catch((reason: unknown) => reason);
    expect(error).toMatchObject({ kind: "cut-off", retryable: true, message: expect.stringMatching(/cut off/) });
    expect(requests).toHaveLength(1);
  });
});

describe("MockProvider: structured output", () => {
  it("retries like the others", async () => {
    let turn = 0;
    const provider = new MockProvider({ reply: () => (turn++ === 0 ? { company: "Ledgerly" } : { company: "Ledgerly", years: 5 }) });
    expect(await provider.complete(ask)).toEqual({ company: "Ledgerly", years: 5 });
    expect(provider.calls).toHaveLength(2);
  });
});

describe("OpenAI-compatible servers without JSON schemas", () => {
  it("fall back to JSON mode, then to instructions, with the schema in the prompt", async () => {
    const requests = stubFetch(({ body }) => {
      const format = (body as { response_format?: { type: string } }).response_format?.type;
      if (format === "json_schema") return json({ error: { message: "response_format.type 'json_schema' is not supported" } }, { status: 400 });
      if (format === "json_object") return json({ error: { message: "response_format is not supported by this model" } }, { status: 400 });
      return json({ id: "c", object: "chat.completion", created: 0, model: "old", choices: [{ index: 0, message: { role: "assistant", content: 'Here: {"company": "Ledgerly", "years": 5}' }, finish_reason: "stop" }] });
    });
    const provider = new OpenAICompatibleProvider("OPENAI", "https://old-server.example/v1", null, "old", 60_000);
    expect(await provider.complete(ask)).toEqual({ company: "Ledgerly", years: 5 });
    const last = requests.at(-1)!.body as { response_format?: unknown; messages: { role: string; content: string }[] };
    expect(last.response_format).toBeUndefined();
    expect(last.messages[0].content).toMatch(/Reply with only a JSON object[\s\S]*"required":\["company","years"\]/);
    // Remembered: the next call goes straight to instructions.
    const before = requests.length;
    await provider.complete(ask);
    expect(requests.length - before).toBe(1);
  });
});
