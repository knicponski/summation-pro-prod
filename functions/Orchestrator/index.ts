import * as df from "durable-functions";

const orchestrator = df.orchestrator(function* (context) {
  const cfg = context.df.getInput() as { docId: string; inputPath: string; inputContainer: string };
  const { docId, inputPath, inputContainer } = cfg;

  const pageChars = parseInt(process.env["PAGE_CHARS"] || "1000", 10);
  const overlap = parseFloat(process.env["LEAF_OVERLAP_RATIO"] || "0.15");
  const childCap = parseInt(process.env["CHILD_CAP"] || "28", 10);
  const waveLeaves = parseInt(process.env["WAVE_ACTIVITY"] || "24", 10);
  const waveParents = parseInt(process.env["WAVE_PARENTS"] || "18", 10);

  // 1) Extract text → JSONL (+ PDF + page confidences)
  const extractRes: { jsonlPath: string; confidencePath: string; searchablePdf?: string } =
    yield context.df.callActivity("extractTextActivity", { docId, inputPath, inputContainer });

  // 2) Paginate into logical pages (returns pages + per-page confidence)
  const paged: { pages: string[]; pageConfs: number[] } =
    yield context.df.callActivity("paginateActivity", { docId, jsonlPath: extractRes.jsonlPath, pageChars, mode: "PAGINATE" });

  // 3) Build leaves (overlap bumped to 0.20 where confidence < 0.85)
  const leaves: string[] = yield context.df.callActivity("makeLeavesActivity", {
    pages: paged.pages,
    leafSize: (yield context.df.callActivity("chooseLeafSizeActivity", { nPages: paged.pages.length })),
    overlap,
    pageConfs: paged.pageConfs
  });

  // 4) Leaf summaries in waves
  let leafSummaries: string[] = [];
  for (let i = 0; i < leaves.length; i += waveLeaves) {
    const slice = leaves.slice(i, i + waveLeaves);
    const tasks = slice.map((payload, idx) =>
      context.df.callActivity("summarizeActivity", { level: 0, idx: i + idx, payload, budgetTokens: 180, docId })
    );
    const partial = yield context.df.Task.all(tasks);
    leafSummaries = leafSummaries.concat(partial);
  }

  // 5) Hierarchical reduce with parent waves
  let level = 1;
  let current = leafSummaries;
  while (current.length > 1) {
    const parents: string[][] = [];
    for (let i = 0; i < current.length; i += childCap) parents.push(current.slice(i, i + childCap));

    let next: string[] = [];
    for (let i = 0; i < parents.length; i += waveParents) {
      const slice = parents.slice(i, i + waveParents);
      const tasks = slice.map(children =>
        context.df.callActivity("summarizeActivity", { level, payload: children.join("\n\n---\n\n"), budgetTokens: 220, docId })
      );
      const partial = yield context.df.Task.all(tasks);
      next = next.concat(partial);
    }
    current = next;
    level++;
  }

  // 6) Save top summary
  yield context.df.callActivity("saveTopSummaryActivity", { docId, summary: current[0], levels: level });

  // 7) Roll up usage metrics (JSON + Markdown)
  yield context.df.callActivity("rollupMetricsActivity", { docId });

  return { docId, levels: level };
});

export default orchestrator;
