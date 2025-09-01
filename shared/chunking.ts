// shared/chunking.ts
export function nonBlankCount(s: string): number {
  return s.split(/\r?\n/).reduce((acc, ln) => {
    if (ln.trim().length === 0) return acc;
    const noSpaces = ln.replace(/[ \t]/g, "");
    return acc + noSpaces.length;
  }, 0);
}

export function paginateByNonBlank(text: string, PAGE_CHARS = 1200): string[] {
  const pages: string[] = [];
  let buf: string[] = [];
  let cnt = 0;
  for (const ln of text.split(/\r?\n/)) {
    const incr = ln.trim().length === 0 ? 0 : ln.replace(/[ \t]/g, "").length;
    buf.push(ln + "\n");
    cnt += incr;
    if (cnt >= PAGE_CHARS) {
      pages.push(buf.join(""));
      buf = [];
      cnt = 0;
    }
  }
  if (buf.length) pages.push(buf.join(""));
  return pages;
}

export function chooseLeafSize(nPages: number): number {
  if (nPages <= 100) return 4;
  if (nPages <= 500) return 8;
  if (nPages <= 2000) return 15;
  if (nPages <= 10000) return 22;
  return 28;
}

export function makeLeafChunks(pages: string[], leafPages: number, overlapRatio = 0.12): string[] {
  const k = leafPages;
  const o = Math.max(1, Math.round(k * overlapRatio));
  const chunks: string[] = [];
  for (let i = 0; i < pages.length; i += (k - o)) {
    const piece = pages.slice(i, i + k);
    if (piece.length === 0) break;
    chunks.push(piece.join(""));
  }
  return chunks;
}

export function groupBatches<T>(arr: T[], B: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += B) out.push(arr.slice(i, i + B));
  return out;
}
