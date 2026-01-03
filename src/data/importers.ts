import Dexie from "dexie";
import { db, type Dataset, type SentenceRow, makeId, type ImportBatchRow } from "./db";
import { countTokens } from "./tokenize";

// XLSX is large. Load it only when the user imports an .xlsx file.
async function loadXLSX() {
  return await import("xlsx");
}

export type ImportMapping = {
  sourceKey: string;
  targetKey: string;
  translitKey?: string;
  glossKey?: string;
  tokenKey?: string;
  idKey?: string;
};

export type ImportMode = "append" | "replace";

function normKey(k: string) {
  return k.trim().toLowerCase();
}

function parseDelimited(text: string, delimiter: "," | "\t") {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [] as string[], rows: [] as Record<string, string>[] };

  // NOTE: This is a simple splitter (no CSV quoting). Prefer TSV for safety.
  const rawHeaders = lines[0].split(delimiter).map((h) => h.trim());
  const headers = rawHeaders.map(normKey);

  const rows = lines.slice(1).map((line) => {
    const cols = line.split(delimiter);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => (obj[h] = (cols[i] ?? "").trim()));
    return obj;
  });

  return { headers, rows };
}

function pickHeader(
  headers: string[],
  primaryKey: string,
  opts?: { equalsAny?: string[]; containsAny?: string[] }
): string | undefined {
  const hset = new Set(headers.map(normKey));
  const primary = normKey(primaryKey);

  if (hset.has(primary)) return primary;

  for (const a of opts?.equalsAny ?? []) {
    const aa = normKey(a);
    if (hset.has(aa)) return aa;
  }

  // contains heuristics (for e.g. "Target Language (Greek)")
  for (const h of headers) {
    const hh = normKey(h);
    const containsAny = opts?.containsAny ?? [];
    if (containsAny.length && containsAny.every((p) => hh.includes(normKey(p)))) return hh;
  }

  // softer contains: any of the tokens
  for (const h of headers) {
    const hh = normKey(h);
    const containsAny = opts?.containsAny ?? [];
    if (containsAny.length && containsAny.some((p) => hh.includes(normKey(p)))) return hh;
  }

  return undefined;
}

export function inferMappingFromHeaders(headers: string[], mapping: ImportMapping) {
  const h = headers.map(normKey);

  const sourceKey =
    pickHeader(h, mapping.sourceKey, {
      equalsAny: ["english", "en", "source", "source text", "source sentence", "prompt"],
      containsAny: ["english"]
    }) ?? normKey(mapping.sourceKey);

  const targetKey =
    pickHeader(h, mapping.targetKey, {
      equalsAny: ["target", "target text", "target sentence", "answer", "response"],
      containsAny: ["target"]
    }) ?? normKey(mapping.targetKey);

  const translitKey =
    mapping.translitKey
      ? pickHeader(h, mapping.translitKey, {
          equalsAny: ["transliteration", "translit", "romanization", "romaji", "pinyin"],
          containsAny: ["translit"]
        })
      : pickHeader(h, "transliteration", {
          equalsAny: ["transliteration", "translit", "romanization", "romaji", "pinyin"],
          containsAny: ["translit"]
        });

  const glossKey =
    mapping.glossKey
      ? pickHeader(h, mapping.glossKey, {
          equalsAny: ["gloss", "word-by-word gloss", "word by word gloss", "wbg"],
          containsAny: ["gloss", "word-by-word", "word by word"]
        })
      : pickHeader(h, "gloss", {
          equalsAny: ["gloss", "word-by-word gloss", "word by word gloss", "wbg"],
          containsAny: ["gloss", "word-by-word", "word by word"]
        });

  const tokenKey =
    mapping.tokenKey
      ? pickHeader(h, mapping.tokenKey, { equalsAny: ["tokencount", "token count"], containsAny: ["token"] })
      : pickHeader(h, "tokencount", { equalsAny: ["tokencount", "token count"], containsAny: ["token"] });

  const idKey =
    mapping.idKey ? pickHeader(h, mapping.idKey, { equalsAny: ["id", "uuid"], containsAny: ["id"] }) : pickHeader(h, "id", { equalsAny: ["id", "uuid"], containsAny: ["id"] });

  return { sourceKey, targetKey, translitKey, glossKey, tokenKey, idKey };
}

function getRowValue(r: Record<string, any>, key?: string) {
  if (!key) return "";
  const k = normKey(key);
  return String(r[k] ?? r[key] ?? "").trim();
}

export async function clearPathData(datasetId: string, deckId: string) {
  await db.sentences.where("[datasetId+deckId]").equals([datasetId, deckId]).delete();

  await db.srs
    .where("[datasetId+deckId+dueAt]")
    .between([datasetId, deckId, 0], [datasetId, deckId, Number.MAX_SAFE_INTEGER])
    .delete();

  await db.imports.where("[datasetId+deckId+createdAt]").between([datasetId, deckId, 0], [datasetId, deckId, Number.MAX_SAFE_INTEGER]).delete();

  const pp = await db.pathProgress.get([datasetId, deckId]).catch(() => undefined);
  if (pp) {
    await db.pathProgress.put({
      ...pp,
      linearOrder: 0,
      srsNewOrder: 0,
      updatedAt: Date.now()
    });
  }
}

async function normalizeOrdersAndClampProgress(datasetId: string, deckId: string) {
  const rows = await db.sentences.where("[datasetId+deckId]").equals([datasetId, deckId]).toArray();
  rows.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.id).localeCompare(String(b.id)));
  let changed = false;
  rows.forEach((r, idx) => {
    if (r.order !== idx) {
      (r as any).order = idx;
      changed = true;
    }
  });
  if (changed && rows.length) {
    await db.sentences.bulkPut(rows);
  }

  const last = Math.max(0, rows.length - 1);
  const pp = await db.pathProgress.get([datasetId, deckId]).catch(() => undefined);
  if (pp) {
    const clamped = {
      ...pp,
      linearOrder: rows.length ? Math.min(pp.linearOrder ?? 0, last) : 0,
      srsNewOrder: rows.length ? Math.min(pp.srsNewOrder ?? 0, last) : 0,
      updatedAt: Date.now()
    };
    await db.pathProgress.put(clamped);
  }
}

export async function deleteImportBatch(opts: { datasetId: string; deckId: string; importId: string }) {
  const { datasetId, deckId, importId } = opts;

  return await db.transaction("rw", db.sentences, db.imports, db.srs, db.pathProgress, async () => {
    const rows = await db.sentences
      .where("[datasetId+deckId+importId]")
      .equals([datasetId, deckId, importId])
      .toArray();

    const ids = rows.map((r) => r.id);
    if (ids.length) {
      await db.sentences.bulkDelete(ids);
      const keys = ids.map((id) => [datasetId, deckId, id] as any);
      await db.srs.bulkDelete(keys);
    }

    await db.imports.delete(importId);
    await normalizeOrdersAndClampProgress(datasetId, deckId);
    return { deleted: ids.length };
  });
}

async function getNextOrderBase(datasetId: string, deckId: string) {
  const last = await db.sentences
    .where("[datasetId+deckId+order]")
    .between([datasetId, deckId, 0], [datasetId, deckId, Number.MAX_SAFE_INTEGER])
    .last();

  return last ? (last.order ?? 0) + 1 : 0;
}

export async function importCSVorTSV(opts: {
  dataset: Dataset;
  deckId: string;
  filename: string;
  text: string;
  delimiter: "," | "\t";
  mapping: ImportMapping;
  mode: ImportMode;
  onProgress?: (p: number) => void;
}) {
  const { dataset, deckId, filename, text, delimiter, mapping, mode, onProgress } = opts;

  const parsed = parseDelimited(text, delimiter);
  const headers = parsed.headers;
  const resolved = inferMappingFromHeaders(headers, mapping);

  // Require at least Source + Target to exist, otherwise show a helpful error.
  const haveSource = headers.includes(normKey(resolved.sourceKey));
  const haveTarget = headers.includes(normKey(resolved.targetKey));
  if (!haveSource || !haveTarget) {
    throw new Error(
      `Missing required columns. Found headers: ${headers.join(", ")}.\n\nExpected at least English + Target (or a header containing "target", like "Target Language (Greek)").`
    );
  }

  const rows = parsed.rows;

  const batchSize = 1500;

  return await db.transaction("rw", db.sentences, db.imports, db.srs, db.pathProgress, async () => {
    if (mode === "replace") {
      await clearPathData(dataset.id, deckId);
    }

    const baseOrder = mode === "replace" ? 0 : await getNextOrderBase(dataset.id, deckId);

    const importId = makeId("imp");
    const createdAt = Date.now();

    const toInsert: SentenceRow[] = [];
    let inserted = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];

      const sourceText = getRowValue(r, resolved.sourceKey);
      const targetText = getRowValue(r, resolved.targetKey);

      if (!sourceText && !targetText) continue;

      const tokenRaw = getRowValue(r, resolved.tokenKey);
      const tokenCount = tokenRaw ? Math.max(0, Number(tokenRaw) || 0) : countTokens(targetText, dataset.cjkMode);

      const idCandidate = getRowValue(r, resolved.idKey);
      const id = idCandidate ? idCandidate : makeId("s");

      toInsert.push({
        id,
        datasetId: dataset.id,
        deckId,
        order: baseOrder + inserted,
        importId,
        sourceText,
        targetText,
        transliterationText: getRowValue(r, resolved.translitKey) || undefined,
        glossText: getRowValue(r, resolved.glossKey) || undefined,
        tokenCount
      });

      inserted++;

      if (toInsert.length >= batchSize) {
        await db.sentences.bulkPut(toInsert);
        toInsert.length = 0;
        onProgress?.(i / rows.length);
        // IMPORTANT: Avoid awaiting "foreign" promises inside a Dexie transaction.
        // Dexie.waitFor keeps the transaction alive while we yield to the UI.
        await Dexie.waitFor(new Promise<void>((r) => setTimeout(r, 0)));
      }
    }

    if (toInsert.length) await db.sentences.bulkPut(toInsert);

    const batch: ImportBatchRow = {
      id: importId,
      datasetId: dataset.id,
      deckId,
      filename,
      createdAt,
      mode,
      startOrder: baseOrder,
      endOrder: Math.max(baseOrder - 1, baseOrder + inserted - 1),
      rowCount: inserted
    };
    await db.imports.add(batch);

    onProgress?.(1);
    return { imported: inserted, headers, resolved };
  });
}

export async function importXLSX(opts: {
  dataset: Dataset;
  deckId: string;
  filename: string;
  arrayBuffer: ArrayBuffer;
  sheetName: string;
  mapping: ImportMapping;
  mode: ImportMode;
  onProgress?: (p: number) => void;
}) {
  const { dataset, deckId, filename, arrayBuffer, sheetName, mapping, mode, onProgress } = opts;

  const XLSX = await loadXLSX();
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error("Sheet not found.");

  const jsonRaw: Record<string, any>[] = XLSX.utils.sheet_to_json(ws, { defval: "" });

  // Normalize keys to lower-case for case-insensitive mapping
  const json = jsonRaw.map((row) => {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(row)) out[normKey(k)] = v;
    return out;
  });

  const headers = Object.keys(json[0] ?? {}).map(normKey);
  const resolved = inferMappingFromHeaders(headers, mapping);

  const haveSource = headers.includes(normKey(resolved.sourceKey));
  const haveTarget = headers.includes(normKey(resolved.targetKey));
  if (!haveSource || !haveTarget) {
    throw new Error(
      `Missing required columns in sheet "${sheetName}". Found headers: ${headers.join(", ")}.\n\nExpected at least English + Target (or a header containing "target", like "Target Language (Greek)").`
    );
  }

  const batchSize = 1500;

  return await db.transaction("rw", db.sentences, db.imports, db.srs, db.pathProgress, async () => {
    if (mode === "replace") {
      await clearPathData(dataset.id, deckId);
    }

    const baseOrder = mode === "replace" ? 0 : await getNextOrderBase(dataset.id, deckId);

    const importId = makeId("imp");
    const createdAt = Date.now();

    const toInsert: SentenceRow[] = [];
    let inserted = 0;

    for (let i = 0; i < json.length; i++) {
      const r = json[i];

      const sourceText = getRowValue(r, resolved.sourceKey);
      const targetText = getRowValue(r, resolved.targetKey);

      if (!sourceText && !targetText) continue;

      const tokenRaw = getRowValue(r, resolved.tokenKey);
      const tokenCount = tokenRaw ? Math.max(0, Number(tokenRaw) || 0) : countTokens(targetText, dataset.cjkMode);

      const idCandidate = getRowValue(r, resolved.idKey);
      const id = idCandidate ? idCandidate : makeId("s");

      toInsert.push({
        id,
        datasetId: dataset.id,
        deckId,
        order: baseOrder + inserted,
        importId,
        sourceText,
        targetText,
        transliterationText: getRowValue(r, resolved.translitKey) || undefined,
        glossText: getRowValue(r, resolved.glossKey) || undefined,
        tokenCount
      });

      inserted++;

      if (toInsert.length >= batchSize) {
        await db.sentences.bulkPut(toInsert);
        toInsert.length = 0;
        onProgress?.(i / Math.max(1, json.length));
        // IMPORTANT: Avoid awaiting "foreign" promises inside a Dexie transaction.
        // Dexie.waitFor keeps the transaction alive while we yield to the UI.
        await Dexie.waitFor(new Promise<void>((r) => setTimeout(r, 0)));
      }
    }

    if (toInsert.length) await db.sentences.bulkPut(toInsert);

    const batch: ImportBatchRow = {
      id: importId,
      datasetId: dataset.id,
      deckId,
      filename,
      createdAt,
      mode,
      startOrder: baseOrder,
      endOrder: Math.max(baseOrder - 1, baseOrder + inserted - 1),
      rowCount: inserted
    };
    await db.imports.add(batch);

    onProgress?.(1);
    return { sheets: wb.SheetNames, imported: inserted, headers, resolved };
  });
}

export async function listSheetNames(arrayBuffer: ArrayBuffer) {
  const XLSX = await loadXLSX();
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  return wb.SheetNames;
}
