import { AzureFunction, Context } from "@azure/functions";
import { readBlob, writeBlob } from "../../../shared/storage";
import { paginateByNonBlank } from "../../../shared/chunking";

const OUTPUT_CONTAINER = process.env["OUTPUT_CONTAINER"] || "work";

interface JsonlRow { t: string; pg?: number | null }

const activity: AzureFunction = async function (context: Context, input: any): Promise<any> {
  const { docId, jsonlPath, pageChars, mode } = input as { docId: string; jsonlPath: string; pageChars: number; mode?: "LOAD_ONLY"|"PAGINATE" };
  const jsonl = await readBlob(OUTPUT_CONTAINER, jsonlPath);
  const rows: JsonlRow[] = jsonl.split(/\n/).map(l => { try { return JSON.parse(l) as JsonlRow; } catch { return { t: "" }; } });
  const full = rows.map(r => r.t).join("\n");

  if (mode === "LOAD_ONLY") return full;

  // Try to read per-page confidence map (optional)
  let confMap: Record<string, number> = {};
  try {
    const confJson = await readBlob(OUTPUT_CONTAINER, `${docId}/extracted/confidence.json`);
    confMap = JSON.parse(confJson);
  } catch { confMap = {}; }

  // Build logical pages by non-blank chars and compute confidence per logical page
  const logicalPages: string[] = [];
  const logicalConfs: number[] = [];
  let buf: string[] = [];
  let cnt = 0;
  let diPagesInBuf = new Set<number>();

  const flush = () => {
    if (!buf.length) return;
    logicalPages.push(buf.join(""));
    const confs = Array.from(diPagesInBuf).map(p => confMap[String(p)] ?? 1.0);
    const m = confs.length ? (confs.reduce((a,b)=>a+b,0) / confs.length) : 1.0;
    logicalConfs.push(m);
    buf = [];
    cnt = 0;
    diPagesInBuf = new Set<number>();
  };

  for (const r of rows) {
    const ln = (r.t || "") + "\n";
    const incr = r.t.trim().length === 0 ? 0 : r.t.replace(/[ \t]/g, "").length;
    buf.push(ln);
    cnt += incr;
    if (r.pg != null) diPagesInBuf.add(r.pg);
    if (cnt >= pageChars) flush();
  }
  flush();

  for (let i = 0; i < logicalPages.length; i++) {
    await writeBlob(OUTPUT_CONTAINER, `${docId}/pages/page_${String(i+1).padStart(5, "0")}.txt`, logicalPages[i]);
  }
  return { pages: logicalPages, pageConfs: logicalConfs };
};
export default activity;
