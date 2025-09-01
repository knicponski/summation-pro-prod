import { AzureFunction, Context } from "@azure/functions";
import { writeBlob, blob } from "../../../shared/storage";

const OUTPUT_CONTAINER = process.env["OUTPUT_CONTAINER"] || "work";
const COST_PER_1K = parseFloat(process.env["OPENAI_COST_PER_1K_TOKENS"] || "0");

type Usage = { promptTokens?: number; completionTokens?: number; totalTokens?: number };
type Metric = {
  ts: string;
  level: number;
  idx: number | null;
  budgetTokens: number;
  tokens?: Usage;
  payloadChars: number;
};

const activity: AzureFunction = async function (context: Context, input: any): Promise<{ rollupPath: string; rollupMdPath: string }> {
  const { docId } = input as { docId: string };
  const container = blob.getContainerClient(OUTPUT_CONTAINER);
  const prefix = `${docId}/metrics/usage/`;

  const perLevel = new Map<number, { count: number; prompt: number; completion: number; total: number }>();
  const overall = { count: 0, prompt: 0, completion: 0, total: 0 };

  // List and aggregate usage JSONs
  for await (const item of container.listBlobsFlat({ prefix })) {
    try {
      const b = container.getBlobClient(item.name);
      const d = await b.download();
      const content = await streamToString(d.readableStreamBody!);
      const m: Metric = JSON.parse(content);
      const lev = typeof m.level === "number" ? m.level : 0;
      const cur = perLevel.get(lev) || { count: 0, prompt: 0, completion: 0, total: 0 };
      const pu = m.tokens?.promptTokens ?? 0;
      const cu = m.tokens?.completionTokens ?? 0;
      const tu = m.tokens?.totalTokens ?? (pu + cu);
      cur.count += 1; cur.prompt += pu; cur.completion += cu; cur.total += tu;
      perLevel.set(lev, cur);
      overall.count += 1; overall.prompt += pu; overall.completion += cu; overall.total += tu;
    } catch (e) {
      context.log.warn(`Skipping ${item.name}: ${e}`);
    }
  }

  const levels = Array.from(perLevel.keys()).sort((a, b) => a - b);
  const levelRows = levels.map(l => {
    const s = perLevel.get(l)!;
    const est = COST_PER_1K ? (s.total / 1000) * COST_PER_1K : undefined;
    return {
      level: l,
      summaries: s.count,
      promptTokens: s.prompt,
      completionTokens: s.completion,
      totalTokens: s.total,
      estimatedUSD: est
    };
  });

  const overallEst = COST_PER_1K ? (overall.total / 1000) * COST_PER_1K : undefined;
  const rollup = {
    docId,
    generated: new Date().toISOString(),
    costPer1kTokensUSD: COST_PER_1K || undefined,
    levels: levelRows,
    overall: {
      summaries: overall.count,
      promptTokens: overall.prompt,
      completionTokens: overall.completion,
      totalTokens: overall.total,
      estimatedUSD: overallEst
    }
  };

  const rollupPath = `${docId}/metrics/rollup.json`;
  await writeBlob(OUTPUT_CONTAINER, rollupPath, JSON.stringify(rollup, null, 2));

  const rollupMdPath = `${docId}/metrics/rollup.md`;
  await writeBlob(OUTPUT_CONTAINER, rollupMdPath, toMarkdown(rollup));

  return { rollupPath, rollupMdPath };
};

export default activity;

// --- helpers

async function streamToString(readable: NodeJS.ReadableStream): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    readable.on("data", (d) => chunks.push(Buffer.from(d)));
    readable.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    readable.on("error", reject);
  });
}

function toMarkdown(rollup: any): string {
  const lines: string[] = [];
  lines.push(`# Metrics Rollup`);
  lines.push(`- Document: \`${rollup.docId}\``);
  lines.push(`- Generated: ${rollup.generated}`);
  if (rollup.costPer1kTokensUSD) lines.push(`- Cost/1k tokens (USD): ${rollup.costPer1kTokensUSD}`);
  lines.push("");
  lines.push(`## Overall`);
  lines.push(`- Summaries: ${rollup.overall.summaries}`);
  lines.push(`- Prompt tokens: ${rollup.overall.promptTokens}`);
  lines.push(`- Completion tokens: ${rollup.overall.completionTokens}`);
  lines.push(`- Total tokens: ${rollup.overall.totalTokens}`);
  if (typeof rollup.overall.estimatedUSD === "number") lines.push(`- Estimated cost (USD): ${rollup.overall.estimatedUSD.toFixed(4)}`);
  lines.push("");
  lines.push(`## By Level`);
  lines.push(`| Level | Summaries | Prompt | Completion | Total | Est. USD |`);
  lines.push(`|------:|----------:|-------:|-----------:|------:|---------:|`);
  for (const row of rollup.levels) {
    const est = typeof row.estimatedUSD === "number" ? row.estimatedUSD.toFixed(4) : "";
    lines.push(`| ${row.level} | ${row.summaries} | ${row.promptTokens} | ${row.completionTokens} | ${row.totalTokens} | ${est} |`);
  }
  lines.push("");
  return lines.join("\n");
}
