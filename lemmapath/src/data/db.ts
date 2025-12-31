import Dexie, { type Table } from "dexie";

// ─────────────────────────────────────────────────────────────────────────────
// LANGUAGE — Primary entity representing a language being learned
// ─────────────────────────────────────────────────────────────────────────────
export type Language = {
  id: string;
  name: string; // e.g., "Greek", "Hebrew", "French"
  languageTag: string; // BCP-47, like "el-GR"
  rtlMode: "auto" | "rtl" | "ltr";
  cjkMode: boolean;
  theme: "paper" | "desk" | "dark";
  ttsRate: number;
  ttsPitch: number;
  preferredVoiceURI?: string;
  goalTokens: number;
  createdAt: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// DECK — Optional grouping of sentences within a language
// ─────────────────────────────────────────────────────────────────────────────
export type Deck = {
  id: string;
  languageId: string; // Required foreign key to Language
  name: string; // e.g., "Greek Travel B1", "Beginner Vocab"
  createdAt: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Dataset (legacy) — Kept for backward compatibility during migration
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// SentenceRow — Now with languageId (required) and deckId (optional)
// ─────────────────────────────────────────────────────────────────────────────
export type SentenceRow = {
  id: string;
  languageId: string; // Required - which language this sentence belongs to
  deckId?: string; // Optional - which deck within the language
  datasetId: string; // Kept for backward compatibility
  sourceText: string;
  targetText: string;
  transliterationText?: string;
  glossText?: string;
  tokenCount: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// ProgressRow — Per-deck progress (uses deckId OR languageId for undecked)
// ─────────────────────────────────────────────────────────────────────────────
export type ProgressRow = {
  datasetId: string; // Legacy key - kept for compatibility
  languageId?: string; // New: language this progress belongs to
  deckId?: string; // New: specific deck (null = language-level progress)
  lifetimeReps: number;
  lifetimeTokens: number;
  currentIndex: number;
  updatedAt: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// DATABASE CLASS
// ─────────────────────────────────────────────────────────────────────────────
export class LemmaDB extends Dexie {
  languages!: Table<Language, string>;
  decks!: Table<Deck, string>;
  datasets!: Table<Dataset, string>;
  sentences!: Table<SentenceRow, string>;
  progress!: Table<ProgressRow, string>;

  constructor() {
    super("lemmapath_db");

    // Version 1: Original schema
    this.version(1).stores({
      datasets: "id, name, languageTag, createdAt",
      sentences: "id, datasetId",
      progress: "datasetId"
    });

    // Version 2: Add languages and decks tables, extend sentences with languageId/deckId
    this.version(2).stores({
      languages: "id, name, languageTag, createdAt",
      decks: "id, languageId, name, createdAt",
      datasets: "id, name, languageTag, createdAt",
      sentences: "id, datasetId, languageId, deckId",
      progress: "datasetId, languageId, deckId"
    }).upgrade(async (tx) => {
      // Migration: create default Greek language from existing data
      await migrateToLanguageFirst(tx);
    });
  }
}

export const db = new LemmaDB();

export function makeId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MIGRATION: v1 -> v2 (Language-first data model)
// ─────────────────────────────────────────────────────────────────────────────
async function migrateToLanguageFirst(tx: any) {
  const datasets = await tx.table("datasets").toArray();
  const sentences = await tx.table("sentences").toArray();
  const progress = await tx.table("progress").toArray();

  // Group datasets by languageTag to consolidate into Languages
  const languageMap = new Map<string, Language>();
  const datasetToLanguage = new Map<string, string>(); // datasetId -> languageId

  for (const ds of datasets) {
    const tag = ds.languageTag || "el-GR";
    if (!languageMap.has(tag)) {
      // Derive a human-readable name from BCP-47 tag
      const langName = getLanguageNameFromTag(tag);
      const langId = `lang_${tag.replace(/[^a-zA-Z0-9]/g, "_")}`;
      languageMap.set(tag, {
        id: langId,
        name: langName,
        languageTag: tag,
        rtlMode: ds.rtlMode || "auto",
        cjkMode: ds.cjkMode || false,
        theme: ds.theme || "paper",
        ttsRate: ds.ttsRate || 1,
        ttsPitch: ds.ttsPitch || 1,
        preferredVoiceURI: ds.preferredVoiceURI,
        goalTokens: ds.goalTokens || 5000000,
        createdAt: ds.createdAt || Date.now()
      });
    }
    const lang = languageMap.get(tag)!;
    datasetToLanguage.set(ds.id, lang.id);
  }

  // If no datasets exist, create default Greek language
  if (languageMap.size === 0) {
    languageMap.set("el-GR", {
      id: "lang_el_GR",
      name: "Greek",
      languageTag: "el-GR",
      rtlMode: "auto",
      cjkMode: false,
      theme: "paper",
      ttsRate: 1,
      ttsPitch: 1,
      goalTokens: 5000000,
      createdAt: Date.now()
    });
  }

  // Insert all languages
  const languages = Array.from(languageMap.values());
  await tx.table("languages").bulkAdd(languages);

  // Update sentences with languageId
  if (sentences.length > 0) {
    const updatedSentences = sentences.map((s: any) => ({
      ...s,
      languageId: datasetToLanguage.get(s.datasetId) || languages[0].id,
      deckId: undefined // No deck assignment in v1 data
    }));
    await tx.table("sentences").bulkPut(updatedSentences);
  }

  // Update progress with languageId
  if (progress.length > 0) {
    const updatedProgress = progress.map((p: any) => ({
      ...p,
      languageId: datasetToLanguage.get(p.datasetId) || languages[0].id,
      deckId: undefined
    }));
    await tx.table("progress").bulkPut(updatedProgress);
  }
}

function getLanguageNameFromTag(tag: string): string {
  const names: Record<string, string> = {
    "el-GR": "Greek",
    "he-IL": "Hebrew",
    "ar-SA": "Arabic",
    "zh-CN": "Chinese (Simplified)",
    "zh-TW": "Chinese (Traditional)",
    "ja-JP": "Japanese",
    "ko-KR": "Korean",
    "fr-FR": "French",
    "de-DE": "German",
    "es-ES": "Spanish",
    "it-IT": "Italian",
    "pt-BR": "Portuguese",
    "ru-RU": "Russian"
  };
  if (names[tag]) return names[tag];
  // Try just the language part
  const langPart = tag.split("-")[0];
  const byLangCode: Record<string, string> = {
    el: "Greek", he: "Hebrew", ar: "Arabic", zh: "Chinese",
    ja: "Japanese", ko: "Korean", fr: "French", de: "German",
    es: "Spanish", it: "Italian", pt: "Portuguese", ru: "Russian",
    en: "English", nl: "Dutch", sv: "Swedish", pl: "Polish"
  };
  return byLangCode[langPart] || tag;
}

// ─────────────────────────────────────────────────────────────────────────────
// LANGUAGE CRUD HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export async function createLanguage(opts: {
  name: string;
  languageTag: string;
  rtlMode?: "auto" | "rtl" | "ltr";
  cjkMode?: boolean;
  theme?: "paper" | "desk" | "dark";
  goalTokens?: number;
}): Promise<Language> {
  const lang: Language = {
    id: makeId("lang"),
    name: opts.name,
    languageTag: opts.languageTag,
    rtlMode: opts.rtlMode || "auto",
    cjkMode: opts.cjkMode || false,
    theme: opts.theme || "paper",
    ttsRate: 1,
    ttsPitch: 1,
    goalTokens: opts.goalTokens || 5000000,
    createdAt: Date.now()
  };
  await db.languages.add(lang);
  return lang;
}

export async function listLanguages(): Promise<Language[]> {
  return db.languages.orderBy("createdAt").toArray();
}

export async function getLanguage(id: string): Promise<Language | undefined> {
  return db.languages.get(id);
}

export async function renameLanguage(id: string, newName: string): Promise<void> {
  await db.languages.update(id, { name: newName });
}

export async function updateLanguage(id: string, updates: Partial<Omit<Language, "id" | "createdAt">>): Promise<void> {
  await db.languages.update(id, updates);
}

export async function deleteLanguage(id: string): Promise<void> {
  await db.transaction("rw", db.languages, db.decks, db.sentences, db.progress, async () => {
    // Delete all decks belonging to this language
    const decks = await db.decks.where("languageId").equals(id).toArray();
    await db.decks.where("languageId").equals(id).delete();

    // Delete all sentences belonging to this language
    await db.sentences.where("languageId").equals(id).delete();

    // Delete progress records for this language
    // Note: progress may have deckId or languageId
    const progressToDelete = await db.progress.filter(
      (p) => p.languageId === id
    ).toArray();
    for (const p of progressToDelete) {
      await db.progress.delete(p.datasetId);
    }

    // Delete the language itself
    await db.languages.delete(id);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DECK CRUD HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export async function createDeck(languageId: string, name: string): Promise<Deck> {
  const deck: Deck = {
    id: makeId("deck"),
    languageId,
    name,
    createdAt: Date.now()
  };
  await db.decks.add(deck);
  return deck;
}

export async function listDecks(languageId?: string): Promise<Deck[]> {
  if (languageId) {
    return db.decks.where("languageId").equals(languageId).sortBy("createdAt");
  }
  return db.decks.orderBy("createdAt").toArray();
}

export async function getDeck(id: string): Promise<Deck | undefined> {
  return db.decks.get(id);
}

export async function renameDeck(id: string, newName: string): Promise<void> {
  await db.decks.update(id, { name: newName });
}

export async function deleteDeck(id: string): Promise<void> {
  await db.transaction("rw", db.decks, db.sentences, db.progress, async () => {
    // Remove deckId from sentences (keep them in the language, just unassigned)
    const sentences = await db.sentences.where("deckId").equals(id).toArray();
    for (const s of sentences) {
      await db.sentences.update(s.id, { deckId: undefined });
    }

    // Delete progress for this specific deck
    const progressToDelete = await db.progress.filter(
      (p) => p.deckId === id
    ).toArray();
    for (const p of progressToDelete) {
      await db.progress.delete(p.datasetId);
    }

    // Delete the deck itself
    await db.decks.delete(id);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// LANGUAGE PROGRESS HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export type LanguageProgressRow = {
  languageId: string;
  lifetimeReps: number;
  lifetimeTokens: number;
  currentIndex: number;
  updatedAt: number;
};

const LANGUAGE_PROGRESS_KEY = "lemmapath_language_progress";
const SELECTED_LANGUAGE_KEY = "lemmapath_selected_language";

// Get language-scoped progress from localStorage
export function getLanguageProgressFromStorage(languageId: string): LanguageProgressRow {
  try {
    const stored = localStorage.getItem(LANGUAGE_PROGRESS_KEY);
    if (stored) {
      const all = JSON.parse(stored) as Record<string, LanguageProgressRow>;
      if (all[languageId]) return all[languageId];
    }
  } catch { /* ignore */ }
  return {
    languageId,
    lifetimeReps: 0,
    lifetimeTokens: 0,
    currentIndex: 0,
    updatedAt: Date.now()
  };
}

// Save language-scoped progress to localStorage
export function saveLanguageProgress(progress: LanguageProgressRow): void {
  try {
    const stored = localStorage.getItem(LANGUAGE_PROGRESS_KEY);
    const all = stored ? JSON.parse(stored) : {};
    all[progress.languageId] = progress;
    localStorage.setItem(LANGUAGE_PROGRESS_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

// Get all language progress records (for backup)
export function getAllLanguageProgress(): Record<string, LanguageProgressRow> {
  try {
    const stored = localStorage.getItem(LANGUAGE_PROGRESS_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch { return {}; }
}

// Set all language progress records (for restore)
export function setAllLanguageProgress(data: Record<string, LanguageProgressRow>): void {
  try {
    localStorage.setItem(LANGUAGE_PROGRESS_KEY, JSON.stringify(data));
  } catch { /* ignore */ }
}

// Get/set selected language ID
export function getSelectedLanguageId(): string | null {
  return localStorage.getItem(SELECTED_LANGUAGE_KEY);
}

export function setSelectedLanguageId(id: string): void {
  localStorage.setItem(SELECTED_LANGUAGE_KEY, id);
}

export async function getLanguageProgress(languageId: string): Promise<{
  lifetimeReps: number;
  lifetimeTokens: number;
  sentenceCount: number;
}> {
  // Get progress from localStorage (language-scoped)
  const stored = getLanguageProgressFromStorage(languageId);
  const sentenceCount = await db.sentences.where("languageId").equals(languageId).count();

  return {
    lifetimeReps: stored.lifetimeReps,
    lifetimeTokens: stored.lifetimeTokens,
    sentenceCount
  };
}

export async function getSentencesForLanguage(languageId: string, deckId?: string): Promise<SentenceRow[]> {
  if (deckId) {
    return db.sentences.where({ languageId, deckId }).toArray();
  }
  return db.sentences.where("languageId").equals(languageId).toArray();
}

// ─────────────────────────────────────────────────────────────────────────────
// ENSURE DEFAULT LANGUAGE (replaces ensureDefaultDataset for new code)
// ─────────────────────────────────────────────────────────────────────────────

export async function ensureDefaultLanguage(): Promise<Language> {
  const first = await db.languages.toCollection().first();
  if (first) return first;

  return createLanguage({
    name: "Greek",
    languageTag: "el-GR",
    rtlMode: "auto",
    cjkMode: false,
    theme: "paper",
    goalTokens: 5000000
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY: ensureDefaultDataset (kept for backward compatibility)
// ─────────────────────────────────────────────────────────────────────────────

export async function ensureDefaultDataset(): Promise<Dataset> {
  const first = await db.datasets.toCollection().first();
  if (first) return first;

  // Also ensure we have a default language
  const lang = await ensureDefaultLanguage();

  const ds: Dataset = {
    id: makeId("ds"),
    name: "Default",
    languageTag: lang.languageTag,
    rtlMode: lang.rtlMode,
    tokenMode: "target",
    goalTokens: lang.goalTokens,
    createdAt: Date.now(),
    theme: lang.theme,
    ttsRate: lang.ttsRate,
    ttsPitch: lang.ttsPitch,
    cjkMode: lang.cjkMode
  };

  await db.datasets.add(ds);
  await db.progress.put({
    datasetId: ds.id,
    languageId: lang.id,
    lifetimeReps: 0,
    lifetimeTokens: 0,
    currentIndex: 0,
    updatedAt: Date.now()
  });

  return ds;
}
