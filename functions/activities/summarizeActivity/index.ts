import { AzureFunction, Context } from "@azure/functions";
import { summarizeLeaf, summarizeFromSummaries } from "../../../shared/openai";
import { writeBlob } from "../../../shared/storage";

const OUTPUT_CONTAINER = process.env["OUTPUT_CONTAINER"] || "work";

const activity: AzureFunction = async function (context: Context, input: any): Promise<string> {
  const { level, idx, payload, budgetTokens, docId } = input as { level: number; idx?: number; payload: string; budgetTokens: number; docId: string };

  const { content, usage } = level === 0
    ? await summarizeLeaf(payload, budgetTokens)
    : await summarizeFromSummaries(payload, budgetTokens);

  const idPart = typeof idx === "number" ? `part_${String(idx).padStart(4, "0")}` : `group_${Date.now()}`;

  // Save summary
  const sumPath = `${docId}/summaries/level_${level}/${idPart}.md`;
  await writeBlob(OUTPUT_CONTAINER, sumPath, content);

  // Save usage metrics per call (JSON)
  const metric = {
    ts: new Date().toISOString(),
    level,
    idx: typeof idx === "number" ? idx : null,
    budgetTokens,
    tokens: usage || {},
    payloadChars: payload.length
  };
  const metricPath = `${docId}/metrics/usage/${level}_${idPart}.json`;
  await writeBlob(OUTPUT_CONTAINER, metricPath, JSON.stringify(metric));

  return content;
};
export default activity;
