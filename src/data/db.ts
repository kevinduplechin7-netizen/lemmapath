import Dexie, { type Table } from "dexie";
import { countTokens } from "./tokenize";

export type Dataset = {
  id: string;
  name: string;

  // BCP-47, like "el-GR"
  languageTag: string;

  rtlMode: "auto" | "rtl" | "ltr";
  tokenMode: "target" | "source" | "both";

  // Used for the progress bar across paths (kept simple for now).
  goalTokens: number;

  createdAt: number;

  theme: "paper" | "desk" | "dark";

  ttsRate: number;
  ttsPitch: number;
  preferredVoiceURI?: string;

  // Helps token counting for CJK scripts where words aren't space-delimited.
  cjkMode: boolean;
};

export type Deck = {
  id: string;
  datasetId: string;
  name: string;
  createdAt: number;
};

export type ImportBatchRow = {
  id: string;
  datasetId: string;
  deckId: string;
  filename: string;
  createdAt: number;
  mode: "append" | "replace";
  startOrder: number;
  endOrder: number;
  rowCount: number;
};

export type SentenceRow = {
  id: string;
  datasetId: string;
  deckId: string;

  // Stable sequence inside a dataset + deck.
  order: number;

  importId: string;

  sourceText: string;
  targetText: string;
  transliterationText?: string;
  glossText?: string;

  tokenCount: number;
};

export type ProgressRow = {
  // Legacy (dataset-wide) progress kept for backward compatibility.
  datasetId: string;
  lifetimeReps: number;
  lifetimeTokens: number;
  currentIndex: number;
  updatedAt: number;
};

export type PathProgressRow = {
  datasetId: string;
  deckId: string;

  mode: "linear" | "srs";

  // Linear mode: current order pointer.
  linearOrder: number;

  // SRS mode: next "new" order to introduce.
  srsNewOrder: number;

  lifetimeReps: number;
  lifetimeTokens: number;

  updatedAt: number;
};

export type SRSRow = {
  datasetId: string;
  deckId: string;
  sentenceId: string;

  dueAt: number;

  // SM-2-ish fields
  reps: number;
  lapses: number;
  intervalDays: number;
  ease: number;

  updatedAt: number;
};

// New: dataset-wide word tracking (approx "words read")
export type SeenWordRow = {
  datasetId: string;
  token: string;
  firstSeenAt: number;
};

export type DatasetStatsRow = {
  datasetId: string;
  uniqueWordsSeen: number;
  updatedAt: number;
};

export class SentencePathsDB extends Dexie {
  datasets!: Table<Dataset, string>;
  decks!: Table<Deck, string>;
  imports!: Table<ImportBatchRow, string>;

  sentences!: Table<SentenceRow, string>;

  // Legacy progress (dataset-wide). Kept to avoid breaking old backups.
  progress!: Table<ProgressRow, string>;

  // Per-path progress
  pathProgress!: Table<PathProgressRow, [string, string]>;

  // Per-path SRS state
  srs!: Table<SRSRow, [string, string, string]>;

  // New: word stats
  seenWords!: Table<SeenWordRow, [string, string]>;
  stats!: Table<DatasetStatsRow, string>;

  constructor() {
    // Use a new DB name for the rebrand so Sentence Paths starts clean.
    // This avoids inheriting partially-migrated LemmaPath data that can
    // lead to blank target text and silent TTS failures.
    super("sentencepaths_db");

    // v1 schema (legacy)
    this.version(1).stores({
      datasets: "id, name, languageTag, createdAt",
      sentences: "id, datasetId",
      progress: "datasetId"
    });

    // v2 schema (languages + paths + ordered imports + optional SRS)
    this.version(2)
      .stores({
        datasets: "id, name, languageTag, createdAt",

        decks: "id, datasetId, createdAt, [datasetId+createdAt]",
        imports: "id, datasetId, deckId, createdAt, [datasetId+deckId+createdAt]",

        // Keep primary key as id; add indexes used for fast path queries.
        sentences:
          "id, datasetId, deckId, order, importId, [datasetId+deckId], [datasetId+deckId+order], [datasetId+deckId+importId]",

        // Keep legacy store as-is
        progress: "datasetId",

        // New stores
        pathProgress: "&[datasetId+deckId], datasetId, deckId, updatedAt",
        srs: "&[datasetId+deckId+sentenceId], datasetId, deckId, dueAt, [datasetId+deckId+dueAt]"
      })
      .upgrade(async (tx) => {
        // Create a default deck ("Main") for each dataset and assign all existing
        // sentences into that deck with a sequential order.
        const datasets = await tx.table("datasets").toArray();

        for (const ds of datasets as any[]) {
          const deckId = `deck_${ds.id}`;

          const decksTable = tx.table("decks");
          const existingDeck = await decksTable.get(deckId).catch(() => undefined);

          if (!existingDeck) {
            await decksTable.add({
              id: deckId,
              datasetId: ds.id,
              name: "Main",
              createdAt: ds.createdAt ?? Date.now()
            });
          }

          const sentencesTable = tx.table("sentences");
          const legacySentences = (await sentencesTable.where("datasetId").equals(ds.id).toArray()) as any[];

          legacySentences.sort((a, b) => String(a.id).localeCompare(String(b.id)));

          for (let i = 0; i < legacySentences.length; i++) {
            legacySentences[i].deckId = deckId;
            legacySentences[i].order = i;
            legacySentences[i].importId = "legacy";
          }

          if (legacySentences.length) {
            await sentencesTable.bulkPut(legacySentences);
          }

          // Create per-path progress from legacy progress if it exists.
          const legacyProg = (await tx.table("progress").get(ds.id)) as any | undefined;

          const pathProgressTable = tx.table("pathProgress");
          const existingPP = await pathProgressTable.get([ds.id, deckId]).catch(() => undefined);

          if (!existingPP) {
            const linearOrder = legacyProg?.currentIndex ?? 0;
            await pathProgressTable.put({
              datasetId: ds.id,
              deckId,
              mode: "linear",
              linearOrder,
              srsNewOrder: linearOrder,
              lifetimeReps: legacyProg?.lifetimeReps ?? 0,
              lifetimeTokens: legacyProg?.lifetimeTokens ?? 0,
              updatedAt: Date.now()
            });
          }
        }
      });

    // v3: dataset-wide word tracking
    this.version(3)
      .stores({
        datasets: "id, name, languageTag, createdAt",

        decks: "id, datasetId, createdAt, [datasetId+createdAt]",
        imports: "id, datasetId, deckId, createdAt, [datasetId+deckId+createdAt]",

        sentences:
          "id, datasetId, deckId, order, importId, [datasetId+deckId], [datasetId+deckId+order], [datasetId+deckId+importId]",

        progress: "datasetId",

        pathProgress: "&[datasetId+deckId], datasetId, deckId, updatedAt",
        srs: "&[datasetId+deckId+sentenceId], datasetId, deckId, dueAt, [datasetId+deckId+dueAt]",

        seenWords: "&[datasetId+token], datasetId, firstSeenAt",
        stats: "datasetId, updatedAt"
      })
      .upgrade(async (tx) => {
        const datasets = (await tx.table("datasets").toArray()) as any[];
        const statsTable = tx.table("stats");

        for (const ds of datasets) {
          const existing = await statsTable.get(ds.id).catch(() => undefined);
          if (!existing) {
            await statsTable.put({ datasetId: ds.id, uniqueWordsSeen: 0, updatedAt: Date.now() });
          }
        }
      });

    // v4: repair legacy sentence fields + token counts, and normalize linear orders
    this.version(4)
      .stores({
        datasets: "id, name, languageTag, createdAt",

        decks: "id, datasetId, createdAt, [datasetId+createdAt]",
        imports: "id, datasetId, deckId, createdAt, [datasetId+deckId+createdAt]",

        sentences:
          "id, datasetId, deckId, order, importId, [datasetId+deckId], [datasetId+deckId+order], [datasetId+deckId+importId]",

        progress: "datasetId",

        pathProgress: "&[datasetId+deckId], datasetId, deckId, updatedAt",
        srs: "&[datasetId+deckId+sentenceId], datasetId, deckId, dueAt, [datasetId+deckId+dueAt]",

        seenWords: "&[datasetId+token], datasetId, firstSeenAt",
        stats: "datasetId, updatedAt"
      })
      .upgrade(async (tx) => {
        const datasets = (await tx.table("datasets").toArray()) as any[];
        const decks = (await tx.table("decks").toArray()) as any[];
        const statsTable = tx.table("stats");

        const cjkByDataset = new Map<string, boolean>();
        for (const ds of datasets) {
          cjkByDataset.set(ds.id, !!ds.cjkMode);
          const existing = await statsTable.get(ds.id).catch(() => undefined);
          if (!existing) {
            await statsTable.put({ datasetId: ds.id, uniqueWordsSeen: 0, updatedAt: Date.now() });
          }
        }

        // Repair sentence fields + tokenCount (covers older LemmaPath exports)
        const sentencesTable = tx.table("sentences");
        await sentencesTable.toCollection().modify((s: any) => {
          const cjk = cjkByDataset.get(s.datasetId) ?? false;

          const sourceCandidate =
            s.sourceText ??
            s.english ??
            s.source ??
            s.en ??
            s.front ??
            s.prompt ??
            "";
          const targetCandidate =
            s.targetText ??
            s.target ??
            s.answer ??
            s.back ??
            s.text ??
            s.sentence ??
            s.Target ??
            "";

          if ((!s.sourceText || !String(s.sourceText).trim()) && typeof sourceCandidate === "string" && sourceCandidate.trim()) {
            s.sourceText = sourceCandidate;
          }
          if ((!s.targetText || !String(s.targetText).trim()) && typeof targetCandidate === "string" && targetCandidate.trim()) {
            s.targetText = targetCandidate;
          }
          if (!s.transliterationText && typeof s.transliteration === "string") s.transliterationText = s.transliteration;
          if (!s.glossText && typeof s.gloss === "string") s.glossText = s.gloss;

          if (typeof s.order !== "number" || !Number.isFinite(s.order)) {
            s.order = 0;
          }

          const tt = String(s.targetText ?? "");
          if (typeof s.tokenCount !== "number" || !Number.isFinite(s.tokenCount) || s.tokenCount <= 0) {
            s.tokenCount = countTokens(tt, cjk);
          }
        });

        // Normalize order per deck (guarantees dense [zero..n-1] even if older imports had gaps)
        const lastOrderByKey = new Map<string, number>();
        for (const d of decks) {
          const rows = (await sentencesTable.where("[datasetId+deckId]").equals([d.datasetId, d.id]).toArray()) as any[];
          rows.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.id).localeCompare(String(b.id)));
          let changed = false;
          rows.forEach((r, idx) => {
            if (r.order !== idx) {
              r.order = idx;
              changed = true;
            }
          });
          if (changed && rows.length) {
            await sentencesTable.bulkPut(rows);
          }
          lastOrderByKey.set(`${d.datasetId}__${d.id}`, Math.max(0, rows.length - 1));
        }

        // Clamp linear pointers so the reader always lands on a real row.
        const ppTable = tx.table("pathProgress");
        const allPP = (await ppTable.toArray()) as any[];
        let ppChanged = false;
        for (const pp of allPP) {
          const key = `${pp.datasetId}__${pp.deckId}`;
          const last = lastOrderByKey.get(key);
          if (typeof last !== "number") continue;
          if (typeof pp.linearOrder === "number" && pp.linearOrder > last) {
            pp.linearOrder = last;
            ppChanged = true;
          }
          if (typeof pp.srsNewOrder === "number" && pp.srsNewOrder > last) {
            pp.srsNewOrder = last;
            ppChanged = true;
          }
        }
        if (ppChanged) {
          await ppTable.bulkPut(allPP);
        }
      });
  }
}

export const db = new SentencePathsDB();

export function makeId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export async function createDataset(opts?: Partial<Pick<Dataset, "name" | "languageTag">>): Promise<Dataset> {
  const ds: Dataset = {
    id: makeId("ds"),
    name: opts?.name?.trim() || "New language",
    languageTag: opts?.languageTag?.trim() || "el-GR",
    rtlMode: "auto",
    tokenMode: "target",
    goalTokens: 5000000,
    createdAt: Date.now(),
    theme: "paper",
    ttsRate: 1,
    ttsPitch: 1,
    cjkMode: false
  };

  await db.datasets.add(ds);

  // Legacy progress record for backward compatibility
  await db.progress.put({
    datasetId: ds.id,
    lifetimeReps: 0,
    lifetimeTokens: 0,
    currentIndex: 0,
    updatedAt: Date.now()
  });

  // Create default deck + per-path progress
  const deck = await createDeck(ds.id, "Main");
  await ensurePathProgress(ds.id, deck.id);

  // Seed stats
  await ensureDatasetStats(ds.id);

  return ds;
}

export async function createDeck(datasetId: string, name: string): Promise<Deck> {
  const deck: Deck = {
    id: makeId("deck"),
    datasetId,
    name: name.trim() || "Main",
    createdAt: Date.now()
  };
  await db.decks.add(deck);
  return deck;
}

// ---- Defaults (guarded to avoid duplicate creation in React Strict Mode) ----
let ensureDefaultDatasetPromise: Promise<Dataset> | null = null;
let ensureDefaultDeckPromiseByDs = new Map<string, Promise<Deck>>();

export async function ensureDefaultDataset(): Promise<Dataset> {
  if (ensureDefaultDatasetPromise) return ensureDefaultDatasetPromise;

  ensureDefaultDatasetPromise = (async () => {
    const first = await db.datasets.toCollection().first();
    if (first) return first;

    // First run: create a friendly sample language so the app is usable immediately.
    return await createDataset({ name: "Sample (Greek)", languageTag: "el-GR" });
  })();

  return ensureDefaultDatasetPromise;
}

export async function ensureDefaultDeck(datasetId: string): Promise<Deck> {
  const existing = ensureDefaultDeckPromiseByDs.get(datasetId);
  if (existing) return existing;

  const p = (async () => {
    const decks = await db.decks.where("datasetId").equals(datasetId).sortBy("createdAt");
    if (decks.length) return decks[0];

    const deck = await createDeck(datasetId, "Main");
    await ensurePathProgress(datasetId, deck.id);
    return deck;
  })();

  ensureDefaultDeckPromiseByDs.set(datasetId, p);
  return p;
}

export async function ensurePathProgress(datasetId: string, deckId: string): Promise<PathProgressRow> {
  const key: [string, string] = [datasetId, deckId];
  const existing = await db.pathProgress.get(key);
  if (existing) return existing;

  const pp: PathProgressRow = {
    datasetId,
    deckId,
    mode: "linear",
    linearOrder: 0,
    srsNewOrder: 0,
    lifetimeReps: 0,
    lifetimeTokens: 0,
    updatedAt: Date.now()
  };
  await db.pathProgress.put(pp);
  return pp;
}

export async function ensureDatasetStats(datasetId: string): Promise<DatasetStatsRow> {
  const existing = await db.stats.get(datasetId).catch(() => undefined);
  if (existing) return existing;
  const row: DatasetStatsRow = { datasetId, uniqueWordsSeen: 0, updatedAt: Date.now() };
  await db.stats.put(row);
  return row;
}

export async function recordTokensSeen(datasetId: string, tokens: string[]): Promise<number> {
  const uniq = Array.from(new Set(tokens.map((t) => t.trim()).filter(Boolean)));
  if (uniq.length === 0) return 0;

  const keys = uniq.map((t) => [datasetId, t] as [string, string]);
  const existing = await db.seenWords.bulkGet(keys);

  const now = Date.now();
  const toAdd: SeenWordRow[] = [];

  for (let i = 0; i < uniq.length; i++) {
    if (!existing[i]) toAdd.push({ datasetId, token: uniq[i], firstSeenAt: now });
  }

  if (toAdd.length) {
    await db.seenWords.bulkPut(toAdd);

    const stats = await ensureDatasetStats(datasetId);
    await db.stats.put({
      ...stats,
      uniqueWordsSeen: stats.uniqueWordsSeen + toAdd.length,
      updatedAt: now
    });
  }

  return toAdd.length;
}

export async function getSentenceCount(datasetId: string, deckId: string): Promise<number> {
  return await db.sentences.where("[datasetId+deckId]").equals([datasetId, deckId]).count();
}

export async function getSentenceByOrder(datasetId: string, deckId: string, order: number): Promise<SentenceRow | null> {
  const r = await db.sentences
    .where("[datasetId+deckId+order]")
    .between([datasetId, deckId, order], [datasetId, deckId, order])
    .first();

  return r ?? null;
}
