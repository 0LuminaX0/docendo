import { z } from "zod";

// Minimal OpenRouter client. Phase 2 extends it (cost log, retries per role);
// the content pipeline only needs JSON-schema calls.

const URL = "https://openrouter.ai/api/v1/chat/completions";

export type Message = { role: "system" | "user" | "assistant"; content: string };

export type Usage = { promptTokens: number; completionTokens: number; costUsd?: number };

/** One model call, for the research log: who asked, which model, how long, how much. */
export type LlmCall = { role: string; model: string; ms: number; usage: Usage };
export type OnCall = (c: LlmCall) => void;

// One model per role, overridable from the environment. Pinned IDs, never "~latest".
export const MODELS = {
  draft: process.env.DOCENDO_MODEL_DRAFT ?? "google/gemini-2.5-flash",
  verify: process.env.DOCENDO_MODEL_VERIFY ?? "google/gemini-2.5-flash",
  judge: process.env.DOCENDO_MODEL_JUDGE ?? "google/gemini-2.5-flash",
  writer: process.env.DOCENDO_MODEL_WRITER ?? "google/gemini-2.5-flash",
} as const;

const TIMEOUT_MS = Number(process.env.DOCENDO_LLM_TIMEOUT_MS ?? 25_000);

function apiKey(): string {
  if (!process.env.OPENROUTER_API_KEY) {
    try {
      process.loadEnvFile?.(".env"); // CLI use; Next.js and Vercel set the environment themselves
    } catch {
      // no .env file; fall through to the environment
    }
  }
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set. Copy .env.example to .env and add a key.");
  return key;
}

export function hasApiKey(): boolean {
  try {
    apiKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Ask for JSON that matches `schema`. The schema is sent as a strict JSON
 * schema; providers that can't honour it are skipped (`require_parameters`),
 * and providers that store prompts are skipped (`data_collection: deny`).
 * Invalid replies are retried up to `retries` times.
 */
export async function chatJson<T extends z.ZodType>(opts: {
  model: string;
  messages: Message[];
  schema: T;
  name: string;
  temperature?: number;
  maxTokens?: number;
  retries?: number;
}): Promise<{ data: z.infer<T>; usage: Usage; ms: number }> {
  const { model, messages, schema, name, temperature = 0, maxTokens = 4000, retries = 2 } = opts;
  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    response_format: {
      type: "json_schema",
      json_schema: { name, strict: true, schema: z.toJSONSchema(schema, { target: "draft-7" }) },
    },
    provider: { require_parameters: true, data_collection: "deny" },
    usage: { include: true },
  };

  let lastError = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    const t0 = Date.now();
    const res = await fetch(URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
        "X-Title": "Docendo",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      lastError = `${res.status} ${await res.text()}`;
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      throw new Error(`OpenRouter ${lastError}`);
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens: number; completion_tokens: number; cost?: number };
    };
    const text = json.choices?.[0]?.message?.content ?? "";
    try {
      const parsed = schema.safeParse(JSON.parse(text));
      if (parsed.success) {
        return {
          data: parsed.data,
          ms: Date.now() - t0,
          usage: {
            promptTokens: json.usage?.prompt_tokens ?? 0,
            completionTokens: json.usage?.completion_tokens ?? 0,
            costUsd: json.usage?.cost,
          },
        };
      }
      lastError = z.prettifyError(parsed.error);
    } catch (e) {
      lastError = `reply was not JSON: ${String(e)}`;
    }
  }
  throw new Error(`${name}: no valid reply after ${retries + 1} attempts. Last error: ${lastError}`);
}

/** Plain-text completion (Kai's replies). Same provider rules as chatJson. */
export async function chatText(opts: {
  model: string;
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
}): Promise<{ text: string; usage: Usage; ms: number }> {
  const { model, messages, temperature = 0.6, maxTokens = 300 } = opts;
  const t0 = Date.now();
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json", "X-Title": "Docendo" },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        provider: { data_collection: "deny" },
        usage: { include: true },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`OpenRouter ${res.status} ${await res.text()}`);
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens: number; completion_tokens: number; cost?: number };
    };
    const text = json.choices?.[0]?.message?.content ?? "";
    if (text.trim())
      return {
        text,
        ms: Date.now() - t0,
        usage: { promptTokens: json.usage?.prompt_tokens ?? 0, completionTokens: json.usage?.completion_tokens ?? 0, costUsd: json.usage?.cost },
      };
  }
  throw new Error("OpenRouter: no reply after 2 attempts");
}
