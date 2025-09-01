import { AzureFunction, Context } from "@azure/functions";
import { writeBlob } from "../../../shared/storage";

const OUTPUT_CONTAINER = process.env["OUTPUT_CONTAINER"] || "work";

const activity: AzureFunction = async function (context: Context, input: any): Promise<string[]> {
  const { pages, leafSize, overlap, pageConfs } = input as { pages: string[]; leafSize: number; overlap: number; pageConfs?: number[] };
  const chunks: string[] = [];
  const k = leafSize;
  const baseOverlap = Math.max(0.05, Math.min(overlap, 0.5));

  let i = 0; let idx = 0;
  while (i < pages.length) {
    const segment = pages.slice(i, i + k);
    if (!segment.length) break;

    // bump overlap to 0.20 if avg confidence < 0.85
    let localOverlap = baseOverlap;
    if (pageConfs && pageConfs.length) {
      const segConfs = pageConfs.slice(i, i + k);
      const mean = segConfs.length ? segConfs.reduce((a,b)=>a+b,0) / segConfs.length : 1.0;
      if (mean < 0.85) localOverlap = Math.max(localOverlap, 0.20);
    }

    chunks.push(segment.join(""));
    const oPages = Math.max(1, Math.round(k * localOverlap));
    i += (k - oPages);
    idx++;
  }

  const docId = context.bindingData.instanceId || "doc"; // fallback
  for (let j = 0; j < chunks.length; j++) {
    await writeBlob(OUTPUT_CONTAINER, `${docId}/chunks/leaf/chunk_${String(j+1).padStart(4, "0")}.txt`, chunks[j]);
  }
  return chunks;
};
export default activity;
