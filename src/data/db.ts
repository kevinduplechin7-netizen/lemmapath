import Dexie, { type Table } from "dexie";

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

export class LemmaDB extends Dexie {
  datasets!: Table<Dataset, string>;
  decks!: Table<Deck, string>;
  imports!: Table<ImportBatchRow, string>;

  sentences!: Table<SentenceRow, string>;

  // Legacy progress (dataset-wide). Kept to avoid breaking old backups.
  progress!: Table<ProgressRow, string>;

  // New: per-path progress
  pathProgress!: Table<PathProgressRow, [string, string]>;

  // New: per-path SRS state
  srs!: Table<SRSRow, [string, string, string]>;

  constructor() {
    super("lemmapath_db");

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
  }
}

export const db = new LemmaDB();

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

export async function ensureDefaultDataset(): Promise<Dataset> {
  const first = await db.datasets.toCollection().first();
  if (first) return first;
  return await createDataset({ name: "Default", languageTag: "el-GR" });
}

export async function ensureDefaultDeck(datasetId: string): Promise<Deck> {
  const existing = await db.decks.where("datasetId").equals(datasetId).sortBy("createdAt");
  if (existing.length) return existing[0];
  const deck = await createDeck(datasetId, "Main");
  await ensurePathProgress(datasetId, deck.id);
  return deck;
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
