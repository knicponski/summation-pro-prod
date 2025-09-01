# Azure Functions Hierarchical Summarizer (TypeScript)

Event-driven, Azure-native pipeline:
- Blob trigger (upload into `incoming/`)
- Document Intelligence (OCR) extraction
- Pagination by **non-blank characters**
- Leaf chunking with **adaptive overlap** (based on OCR confidence)
- Hierarchical summarization with **Azure OpenAI**
- Token usage **metrics + rollup**

## Quick start

1) Install prerequisites:
   - Node 18+, Azure Functions Core Tools v4, Azurite or an Azure Storage account

2) Install deps & build:
```
npm install
npm run build
```

3) Start local functions:
```
func start
```

4) Create containers and upload a file:
   - Create `incoming` and `work` containers (Azulite/Storage Explorer).
   - Upload a PDF or text blob to `incoming/yourdoc.pdf`.

5) Watch pipeline outputs under `work/{docId}/...`:
   - `extracted/text.jsonl`, `extracted/confidence.json` (+ optional `derived/searchable.pdf`)
   - `pages/page_00001.txt`, ...
   - `chunks/leaf/chunk_0001.txt`, ...
   - `summaries/level_*/*.md`, `summaries/top.md`
   - `metrics/usage/*.json`, `metrics/rollup.json`, `metrics/rollup.md`

## Configuration

See `local.settings.json` (sample). Set your Azure keys/endpoints.
- `PAGE_CHARS=1000`
- `LEAF_OVERLAP_RATIO=0.15` (auto-bump to 0.20 when avg OCR confidence < 0.85)
- `CHILD_CAP=28`, `WAVE_ACTIVITY=24`, `WAVE_PARENTS=18`
- `OPENAI_COST_PER_1K_TOKENS` for estimated cost in rollups

> Searchable PDF save is best-effort and may not be supported in all regions/versions. Failures are ignored.

## Notes
- Durable Functions orchestrates **fan-out/fan-in** with waves to avoid rate limits.
- Summaries are small (≤ ~220 tokens per node) to keep prompts lightweight.
- Leaf overlap only at leaf level; upper levels summarize structured bullet summaries.
