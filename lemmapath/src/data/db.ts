import Dexie, { type Table } from "dexie";

export type Dataset = {
  id: string;
  name: string;
  languageTag: string; // BCP-47, like "el-GR"
  rtlMode: "auto" | "rtl" | "ltr";
  tokenMode: "target" | "source" | "both";
  goalTokens: number;
  createdAt: number;
  theme: "paper" | "desk" | "dark";
  ttsRate: number;
  ttsPitch: number;
  preferredVoiceURI?: string;
  cjkMode: boolean;
};

export type SentenceRow = {
  id: string;
  datasetId: string;
  sourceText: string;
  targetText: string;
  transliterationText?: string;
  glossText?: string;
  tokenCount: number;
};

export type ProgressRow = {
  datasetId: string;
  lifetimeReps: number;
  lifetimeTokens: number;
  currentIndex: number;
  updatedAt: number;
};

export class LemmaDB extends Dexie {
  datasets!: Table<Dataset, string>;
  sentences!: Table<SentenceRow, string>;
  progress!: Table<ProgressRow, string>;

  constructor() {
    super("lemmapath_db");
    this.version(1).stores({
      datasets: "id, name, languageTag, createdAt",
      sentences: "id, datasetId",
      progress: "datasetId"
    });
  }
}

export const db = new LemmaDB();

export function makeId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export async function ensureDefaultDataset(): Promise<Dataset> {
  const first = await db.datasets.toCollection().first();
  if (first) return first;

  const ds: Dataset = {
    id: makeId("ds"),
    name: "Default",
    languageTag: "el-GR",
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
  await db.progress.put({
    datasetId: ds.id,
    lifetimeReps: 0,
    lifetimeTokens: 0,
    currentIndex: 0,
    updatedAt: Date.now()
  });

  return ds;
}
