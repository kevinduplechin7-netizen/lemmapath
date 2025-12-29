import * as XLSX from "xlsx";
import { db, type Dataset, type SentenceRow } from "./db";
import { countTokens } from "./tokenize";

export type ImportMapping = {
  sourceKey: string;
  targetKey: string;
  translitKey?: string;
  glossKey?: string;
  tokenKey?: string;
  idKey?: string;
};

function parseDelimited(text: string, delimiter: "," | "\t") {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const headers = lines[0].split(delimiter).map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cols = line.split(delimiter);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => (obj[h] = (cols[i] ?? "").trim()));
    return obj;
  });
  return { headers, rows };
}

function stableRowId(datasetId: string, source: string, target: string, idx: number) {
  const base = `${datasetId}::${idx}::${source}::${target}`;
  let hash = 0;
  for (let i = 0; i < base.length; i++) hash = (hash * 31 + base.charCodeAt(i)) >>> 0;
  return `s_${hash.toString(16)}`;
}

export async function importCSVorTSV(opts: {
  dataset: Dataset;
  text: string;
  delimiter: "," | "\t";
  mapping: ImportMapping;
  hasHeader: boolean;
  onProgress?: (p: number) => void;
}) {
  const { dataset, text, delimiter, mapping, onProgress } = opts;
  const { rows } = parseDelimited(text, delimiter);

  const get = (r: Record<string, string>, key?: string) => (key ? (r[key] ?? "") : "");

  const batchSize = 1500;
  const toInsert: SentenceRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const sourceText = get(r, mapping.sourceKey);
    const targetText = get(r, mapping.targetKey);
    if (!sourceText && !targetText) continue;

    const tokenRaw = get(r, mapping.tokenKey);
    const tokenCount = tokenRaw ? Math.max(0, Number(tokenRaw) || 0) : countTokens(targetText, dataset.cjkMode);

    const idCandidate = get(r, mapping.idKey);
    const id = idCandidate ? idCandidate : stableRowId(dataset.id, sourceText, targetText, i);

    toInsert.push({
      id,
      datasetId: dataset.id,
      sourceText,
      targetText,
      transliterationText: get(r, mapping.translitKey) || undefined,
      glossText: get(r, mapping.glossKey) || undefined,
      tokenCount
    });

    if (toInsert.length >= batchSize) {
      await db.sentences.bulkPut(toInsert);
      toInsert.length = 0;
      onProgress?.(i / rows.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  if (toInsert.length) await db.sentences.bulkPut(toInsert);
  onProgress?.(1);
  return { imported: rows.length };
}

export async function importXLSX(opts: {
  dataset: Dataset;
  arrayBuffer: ArrayBuffer;
  sheetName: string;
  mapping: ImportMapping;
  onProgress?: (p: number) => void;
}) {
  const { dataset, arrayBuffer, sheetName, mapping, onProgress } = opts;
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error("Sheet not found.");

  const json: Record<string, any>[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
  const batchSize = 1500;
  const toInsert: SentenceRow[] = [];

  const get = (r: Record<string, any>, key?: string) => (key ? String(r[key] ?? "").trim() : "");

  for (let i = 0; i < json.length; i++) {
    const r = json[i];
    const sourceText = get(r, mapping.sourceKey);
    const targetText = get(r, mapping.targetKey);
    if (!sourceText && !targetText) continue;

    const tokenRaw = get(r, mapping.tokenKey);
    const tokenCount = tokenRaw ? Math.max(0, Number(tokenRaw) || 0) : countTokens(targetText, dataset.cjkMode);

    const idCandidate = get(r, mapping.idKey);
    const id = idCandidate ? idCandidate : stableRowId(dataset.id, sourceText, targetText, i);

    toInsert.push({
      id,
      datasetId: dataset.id,
      sourceText,
      targetText,
      transliterationText: get(r, mapping.translitKey) || undefined,
      glossText: get(r, mapping.glossKey) || undefined,
      tokenCount
    });

    if (toInsert.length >= batchSize) {
      await db.sentences.bulkPut(toInsert);
      toInsert.length = 0;
      onProgress?.(i / json.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  if (toInsert.length) await db.sentences.bulkPut(toInsert);
  onProgress?.(1);
  return { sheets: wb.SheetNames, imported: json.length };
}

export function listSheetNames(arrayBuffer: ArrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  return wb.SheetNames;
}
