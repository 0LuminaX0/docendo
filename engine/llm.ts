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
  // Chosen with `pnpm eval:judge` and `pnpm eval:chat` (2026-10-14): gemini-3.5-flash-lite found every labelled
  // fact with no false credit, caught every misconception and question to Kai, in about 1 s; gemini-2.5-flash was as
  // accurate but took 13 to 25 s per call that day; Claude Haiku 5.5 marked clear explanations as only partial.
  judge: process.env.DOCENDO_MODEL_JUDGE ?? "google/gemini-3.5-flash-lite",
  writer: process.env.DOCENDO_MODEL_WRITER ?? "google/gemini-3.5-flash-lite",
  // Kai solving practice problems (recursive feedback). Chosen with `pnpm eval:solver` (2026-10-14): Claude Haiku 5.5
  // followed the notebook and its guesses most reliably, never turned around, and was fastest (median 4.2 s).
  solver: process.env.DOCENDO_MODEL_SOLVER ?? "anthropic/claude-haiku-5.5",
  // voice input: speech to text. gemini-3.5-flash-lite takes audio at $0.30 per million tokens (32 a second), so a minute
  // of speech costs about $0.001
  transcribe: process.env.DOCENDO_MODEL_TRANSCRIBE ?? "google/gemini-3.5-flash-lite",
} as const;

const TIMEOUT_MS = Number(process.env.DOCENDO_LLM_TIMEOUT_MS ?? 25_000);
// Which provider OpenRouter picks first. Its default balances on price, and measured 2026-10-14 that routed
// gemini-2.5-flash to an endpoint taking about 13 s per judge call; "latency" took about 1 s.
const PROVIDER_SORT = process.env.DOCENDO_PROVIDER_SORT ?? "latency";

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
  timeoutMs?: number; // per attempt; a timeout uses up an attempt like an invalid reply
}): Promise<{ data: z.infer<T>; usage: Usage; ms: number }> {
  const { model, messages, schema, name, temperature = 0, maxTokens = 4000, retries = 2, timeoutMs = TIMEOUT_MS } = opts;
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    response_format: {
      type: "json_schema",
      json_schema: { name, strict: true, schema: z.toJSONSchema(schema, { target: "draft-7" }) },
    },
    provider: { require_parameters: true, data_collection: "deny", sort: PROVIDER_SORT },
    usage: { include: true },
  };

  let lastError = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    const t0 = Date.now();
    let res: Response;
    try {
      res = await fetch(URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey()}`,
          "Content-Type": "application/json",
          "X-Title": "Docendo",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      // a timeout gets one more go while attempts remain; anything else is final
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") && attempt < retries) {
        lastError = `timed out after ${timeoutMs} ms`;
        continue;
      }
      throw e;
    }
    if (!res.ok) {
      lastError = `${res.status} ${await res.text()}`;
      // reasoning models take no temperature, and with require_parameters no provider is left: ask again without it
      if (res.status === 404 && "temperature" in body && /requested parameters/i.test(lastError)) {
        delete body.temperature;
        attempt--;
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      throw new Error(`OpenRouter ${lastError}`);
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      usage?: { prompt_tokens: number; completion_tokens: number; cost?: number };
    };
    const text = json.choices?.[0]?.message?.content ?? "";
    // a reply cut off by the token limit is never used half-written: try again
    if (json.choices?.[0]?.finish_reason === "length") {
      lastError = `reply hit the ${maxTokens}-token limit`;
      continue;
    }
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
  let why = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json", "X-Title": "Docendo" },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        provider: { data_collection: "deny", sort: PROVIDER_SORT },
        usage: { include: true },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 429 || res.status >= 500) {
      why = `${res.status} ${(await res.text()).slice(0, 160)}`;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`OpenRouter ${res.status} ${await res.text()}`);
    const json = (await res.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      usage?: { prompt_tokens: number; completion_tokens: number; cost?: number };
    };
    const text = json.choices?.[0]?.message?.content ?? "";
    // never show Kai cut off mid-sentence: a reply that hit the token limit is asked for again
    if (json.choices?.[0]?.finish_reason === "length") {
      why = `reply hit the ${maxTokens}-token limit`;
      continue;
    }
    if (!text.trim()) why = `empty reply (finish: ${json.choices?.[0]?.finish_reason ?? "none"})`;
    if (text.trim())
      return {
        text,
        ms: Date.now() - t0,
        usage: { promptTokens: json.usage?.prompt_tokens ?? 0, completionTokens: json.usage?.completion_tokens ?? 0, costUsd: json.usage?.cost },
      };
  }
  throw new Error(`OpenRouter: no complete reply after 2 attempts (${why || "unknown"})`);
}

/** Speech to text: a 16 kHz mono WAV recording in, the words out. Same provider rules (no data collection). */
export async function transcribeAudio(opts: { model: string; wav: Buffer; instructions: string; timeoutMs?: number }): Promise<{ text: string; usage: Usage; ms: number }> {
  const t0 = Date.now();
  const res = await fetch(URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json", "X-Title": "Docendo" },
    body: JSON.stringify({
      model: opts.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: opts.instructions },
            { type: "input_audio", input_audio: { data: opts.wav.toString("base64"), format: "wav" } },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 1500,
      provider: { data_collection: "deny", sort: PROVIDER_SORT },
      usage: { include: true },
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 25_000),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status} ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens: number; completion_tokens: number; cost?: number };
  };
  return {
    text: json.choices?.[0]?.message?.content ?? "",
    ms: Date.now() - t0,
    usage: { promptTokens: json.usage?.prompt_tokens ?? 0, completionTokens: json.usage?.completion_tokens ?? 0, costUsd: json.usage?.cost },
  };
}
