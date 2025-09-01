// shared/openai.ts
import { OpenAIClient, AzureKeyCredential } from "@azure/openai";

// --- Client setup
const endpoint = process.env["AZURE_OPENAI_ENDPOINT"]!;
const key = process.env["AZURE_OPENAI_KEY"]!;
const deployment = process.env["AZURE_OPENAI_DEPLOYMENT"]!; // e.g., gpt-4o-mini or gpt-4.1-mini
const client = new OpenAIClient(endpoint, new AzureKeyCredential(key));

// --- Retry/backoff knobs
const MAX_RETRIES = parseInt(process.env["OPENAI_MAX_RETRIES"] || "6", 10);
const BASE_BACKOFF_MS = parseInt(process.env["OPENAI_BACKOFF_MS"] || "500", 10);

export type Usage = { promptTokens?: number; completionTokens?: number; totalTokens?: number };

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function isRetryable(err: any): boolean {
  const status = err?.statusCode ?? err?.status ?? err?.response?.status;
  const code = err?.code;
  if (status === 429 || status === 408) return true;
  if (typeof status === "number" && status >= 500 && status < 600) return true;
  if (code === "ETIMEDOUT" || code === "ECONNRESET") return true;
  const msg = String(err?.message || "").toLowerCase();
  if (msg.includes("rate limit") || msg.includes("temporarily unavailable")) return true;
  return false;
}

async function callWithRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let delay = BASE_BACKOFF_MS;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (!isRetryable(err) || attempt === MAX_RETRIES - 1) throw err;
      const jitter = Math.floor(Math.random() * delay * 0.2);
      await sleep(delay + jitter);
      delay = Math.min(delay * 2, 8000);
    }
  }
  throw new Error(`Retries exhausted for ${label}`);
}

async function chat(messages: { role: "system"|"user"|"assistant"; content: string }[], maxTokens: number): Promise<{ content: string; usage?: Usage }>{
  const resp = await callWithRetry(() => client.getChatCompletions(deployment, messages, {
    temperature: 0.2,
    maxTokens
  }), "chat");
  // @ts-ignore usage may be present depending on SDK version
  const usage = (resp as any).usage;
  const content = resp.choices[0]?.message?.content ?? "";
  return { content, usage };
}

export async function summarizeLeaf(text: string, budgetTokens = 180): Promise<{ content: string; usage?: Usage }>{
  const sys = "You are a precise summarizer. Preserve named entities, numbers, and headings if present.";
  const user = `Summarize the following text in <= ${budgetTokens} tokens.\nInclude 3-6 bullets and one 1-sentence gist.\n\nTEXT:\n${text}`;
  return chat([
    { role: "system", content: sys },
    { role: "user", content: user }
  ], budgetTokens + 40);
}

export async function summarizeFromSummaries(childrenJoined: string, budgetTokens = 220): Promise<{ content: string; usage?: Usage }>{
  const sys = "You summarize summaries; deduplicate, cluster, surface through-lines. Be concise.";
  const user = `Combine these child summaries into one coherent summary (<= ${budgetTokens} tokens).\n- Keep key entities & figures.\n- Add a 'What matters' bullet list (3 bullets).\n\nCHILD SUMMARIES:\n${childrenJoined}`;
  return chat([
    { role: "system", content: sys },
    { role: "user", content: user }
  ], budgetTokens + 60);
}
