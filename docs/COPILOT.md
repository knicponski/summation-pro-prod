# COPILOT.md — Summation Pro (Deposition Summaries)

**Purpose**  
This repository powers *Summation Pro*: an Azure Functions (TypeScript) pipeline that ingests deposition transcripts (PDF or text), OCRs when needed, chunks by non‑blank characters, summarizes hierarchically with Azure OpenAI, and emits deliverables tailored for litigation teams.

**What matters for Copilot**  
- The *entire* point of the system is to **summarize legal depositions** into role‑specific deliverables.
- We must support **Page–Line**, **Topical**, and **Comprehensive** styles, and meet the essential requirements of **Accuracy, Clarity, Conciseness, Relevance**.  (See `How to Summarize a Deposition Examp.txt`.)  
- We must produce five deliverables defined in `Overview Prompt 8-25-25.txt`: **Partner (≤1 pg outline)**, **Associate (≤3 pgs outline)**, **Paralegal (≤10 pgs with exhibits)**, **Client (≤1 pg prose)**, **Insurance Company (≤3 pgs prose w/ probability & expectations)**.
- Use `Cameron Depo.txt` + `Cameron Depo Sample Summary.txt` as the canonical example pair for style, coverage, and page‑line citations.

**Repo pillars** (expected structure)
- `functions/` — Blob trigger, Durable Orchestrator, Activities
- `shared/` — `docintel.ts` (Azure Document Intelligence), `openai.ts` (AOAI w/ retry+usage), `storage.ts`, `chunking.ts`
- `prompts/` — Deposition‑specific prompt templates (leaf/parent/system + rendering profiles)
- `docs/` — This file, code review checklist, acceptance tests

---

## High‑level flow (must remain true)

1. **Extract**
   - For PDFs (especially scanned), call Document Intelligence **prebuilt‑read** with `features=ocrHighResolution,languages`; persist:
     - `extracted/text.jsonl` (paragraphs), `extracted/confidence.json` (per‑page avg), and a best‑effort `derived/searchable.pdf`.
   - **Add:** also persist `extracted/lines.jsonl` with `{{pg, ln, t, conf}}` so we can do Page–Line citations.

2. **Paginate & Chunk**
   - Logical pages by non‑blank chars (`PAGE_CHARS`, default 1000). Keep `pageConfs` and bump overlap to 0.20 when avg < 0.85.
   - Select leaf window by total pages (`4/8/15/22/28`).

3. **Summarize (hierarchical)**
   - Level 0 (leaf) ➜ short, fact‑first bullets **with page–line cites when available**.
   - Upper levels ➜ deduplicate and carry forward cites.
   - Concurrency in **waves** (`WAVE_ACTIVITY`, `WAVE_PARENTS`), plus retry/backoff in `shared/openai.ts`.

4. **Render deliverables (new)**
   - From the top summary + retained cites, generate five deliverables: **Partner, Associate, Paralegal, Client, Insurance**.
   - File targets (all Markdown):  
     - `summaries/deliverables/partner.md` (≤1 page, outline)  
     - `summaries/deliverables/associate.md` (≤3 pages, outline + case fit)  
     - `summaries/deliverables/paralegal.md` (≤10 pages, include exhibits)  
     - `summaries/deliverables/client.md` (≤1 page, plain English)  
     - `summaries/deliverables/insurance.md` (≤3 pages, add probability & next steps)

5. **Metrics**
   - Keep per‑call `metrics/usage/*.json`, and write a consolidated `metrics/rollup.json` + `metrics/rollup.md`.

---

## Copilot tasks (create PRs in this order)

1. **Persist Page–Line**  
   - **Modify** `shared/docintel.ts` to also write `extracted/lines.jsonl` rows like:  
     `{{ "pg": 12, "ln": 7, "t": "text of line", "conf": 0.97 }}`  
   - **Add** `functions/activities/indexPageLinesActivity/` to build a fast lookup index for `{{charOffset|span}} -> {{pg, ln}}` per document.

2. **Prompts for depositions**  
   - Create `prompts/dep_system.md`, `prompts/leaf_prompt.md`, `prompts/parent_prompt.md`, `prompts/render_profiles.md`.  
   - Leaf bullets must attach page–line cites like `[p12:7–p13:2]` when indices exist.

3. **Render deliverables**  
   - Add `functions/activities/renderDeliverablesActivity/` that takes the top summary + optional indices and emits the five Markdown deliverables. See `prompts/render_profiles.md`.

4. **Wire Orchestrator**  
   - After `saveTopSummaryActivity`, call `renderDeliverablesActivity`. Keep the existing `rollupMetricsActivity` last.

5. **Acceptance tests**  
   - Under `docs/tests/`, add `cameron_depo.acceptance.md`. Run locally: upload `Cameron Depo.txt` (or its PDF) to `incoming/`. Confirm:  
     - All five deliverables exist, are within length limits, and contain cites.  
     - Content mirrors the style/coverage of `Cameron Depo Sample Summary.txt`.

---

## Review checklist (use in PR descriptions)

- **Correct inputs**: DI high‑res OCR enabled; `lines.jsonl` present and non‑empty for scanned PDFs.  
- **Chunking**: leaf sizes per total pages, adaptive overlap works when `pageConfs` < 0.85.  
- **Prompts**: leaf bullets show facts + parties/issues; includes `[p:line]` cites; upper levels dedupe and carry cites.  
- **Deliverables**: partner/associate/paralegal/client/insurance outputs respect length + focus and tone.  
- **Metrics**: usage JSONs + rollup emitted.  
- **Docs**: updated prompts + tests.

---

## Grounding files (keep in repo for Copilot context)

- `Overview Prompt 8-25-25.txt` — defines the **five deliverable levels** and their intents (Partner/Associate/Paralegal/Client/Insurance).  
- `How to Summarize a Deposition Examp.txt` — defines **Page–Line / Topical / Comprehensive** options and the **accuracy/clarity/conciseness/relevance** bar.  
- `Cameron Depo.txt` — sample deposition transcript (source).  
- `Cameron Depo Sample Summary.txt` — target style/leveling example (reference).

> Keep these files checked in (or as test fixtures). Copilot should read them to align tone, structure, and output limits.

---

## Configuration defaults

- `PAGE_CHARS=1000` (non‑blank), `LEAF_OVERLAP_RATIO=0.15` (bump to 0.20 on low OCR confidence)  
- `CHILD_CAP=28`, `WAVE_ACTIVITY=24`, `WAVE_PARENTS=18`  
- Retry/backoff: `OPENAI_MAX_RETRIES=6`, `OPENAI_BACKOFF_MS=500`  
- Optional: `OPENAI_COST_PER_1K_TOKENS=0.005` for rollup estimates

---

## FAQ

**Why Page–Line?** Attorneys need verifiable cites; a Page‑Line summary is a standard artifact.  
**Why five deliverables?** Role‑specific outputs speed matter‑level comprehension: partners skim, paralegals execute, clients & insurers get plain‑English guidance.
