// shared/docintel.ts
import createClient from "@azure-rest/ai-document-intelligence";
import { AzureKeyCredential } from "@azure/core-auth";
import { readBlob, writeBlob, blob } from "./storage";

const endpoint = process.env["DOCINTEL_ENDPOINT"]!;
const key = process.env["DOCINTEL_KEY"]!;
const OUTPUT_CONTAINER = process.env["OUTPUT_CONTAINER"] || "work";

const di = createClient(endpoint, new AzureKeyCredential(key));

export async function extractToJsonlAndPdf(docId: string, inputContainer: string, inputPath: string): Promise<{ jsonlPath: string; searchablePdf?: string; confidencePath: string }>{
  // Download source (for large files you may want to stream/SAS instead)
  const source = await readBlob(inputContainer, inputPath);

  // Kick off Read with High-Res OCR + Languages and request searchable PDF output (if available)
  const kickoff = await di
    .path("/documentModels/{modelId}:analyze", "prebuilt-read")
    .post({
      queryParameters: { features: "ocrHighResolution,languages", output: "pdf" },
      contentType: "application/octet-stream",
      body: Buffer.from(source, "utf-8")
    });
  if (kickoff.status !== 202) throw new Error("Doc Intelligence analyze kickoff failed");
  const opLocation = kickoff.headers["operation-location"] as string;

  // Poll until succeeded
  let result: any;
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const op = await di.pathUnchecked(opLocation).get();
    if (op.body?.status === "succeeded") { result = op.body; break; }
    if (op.body?.status === "failed") throw new Error("Doc Intelligence analysis failed");
  }
  if (!result) throw new Error("Doc Intelligence analysis timed out");

  // Build JSONL of paragraphs (include page # if available)
  const lines: string[] = [];
  const paragraphs = result.analyzeResult?.paragraphs ?? [];
  for (const p of paragraphs) {
    const text = (p.content || "").replace(/\r/g, "").trim();
    if (text) {
      const pg = p.boundingRegions?.[0]?.pageNumber ?? null;
      lines.push(JSON.stringify({ t: text, pg }));
    }
  }
  const jsonlPath = `${docId}/extracted/text.jsonl`;
  await writeBlob(OUTPUT_CONTAINER, jsonlPath, lines.join("\n"));

  // Compute per-page OCR confidence (avg of word confidences)
  const pages = result.analyzeResult?.pages ?? [];
  const confByPage: Record<number, number> = {};
  for (const page of pages) {
    const pn = (page.pageNumber ?? 0) as number;
    const words = (page.words ?? []) as Array<{ confidence?: number }>;
    let s = 0, n = 0;
    for (const w of words) { if (typeof (w as any).confidence === "number") { s += (w as any).confidence; n++; } }
    confByPage[pn] = n ? s / n : 1.0;
  }
  const confidencePath = `${docId}/extracted/confidence.json`;
  await writeBlob(OUTPUT_CONTAINER, confidencePath, JSON.stringify(confByPage));

  // Save searchable PDF if available (best-effort; may not be supported in all regions/versions)
  try {
    const pdfResp = await di.pathUnchecked(`${opLocation}/pdf`).get();
    // @ts-ignore bodyAsBytes is available on REST client responses
    const bytes = (pdfResp as any).bodyAsBytes as Uint8Array | undefined;
    if (bytes && bytes.length) {
      await blob.getContainerClient(OUTPUT_CONTAINER)
        .getBlockBlobClient(`${docId}/derived/searchable.pdf`)
        .upload(bytes, bytes.length);
    }
  } catch {
    // optional feature; ignore failures
  }

  return { jsonlPath, searchablePdf: `${docId}/derived/searchable.pdf`, confidencePath };
}
