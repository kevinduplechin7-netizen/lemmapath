import { db, getAllLanguageProgress, setAllLanguageProgress, getSelectedLanguageId, setSelectedLanguageId, type LanguageProgressRow } from "./db";

// ─────────────────────────────────────────────────────────────────────────────
// BACKUP/RESTORE - Supports both v1 (datasets only) and v2 (languages + decks)
// ─────────────────────────────────────────────────────────────────────────────

export type BackupData = {
  version?: number; // 1 = legacy, 2 = language-first
  languages?: any[];
  decks?: any[];
  datasets: any[];
  sentences: any[];
  progress: any[];
  selectedLanguageId?: string;
  languageProgress?: Record<string, LanguageProgressRow>;
};

export async function exportAllToJSON(): Promise<string> {
  const languages = await db.languages.toArray();
  const decks = await db.decks.toArray();
  const datasets = await db.datasets.toArray();
  const sentences = await db.sentences.toArray();
  const progress = await db.progress.toArray();
  const selectedLanguageId = getSelectedLanguageId();
  const languageProgress = getAllLanguageProgress();

  const backup: BackupData = {
    version: 2,
    languages,
    decks,
    datasets,
    sentences,
    progress,
    selectedLanguageId: selectedLanguageId || undefined,
    languageProgress
  };

  return JSON.stringify(backup, null, 2);
}

export async function importAllFromJSON(jsonText: string) {
  const parsed: BackupData = JSON.parse(jsonText);

  // Detect version: v2 has languages array, v1 does not
  const isV2 = Array.isArray(parsed.languages);

  const datasets = parsed.datasets ?? [];
  const sentences = parsed.sentences ?? [];
  const progress = parsed.progress ?? [];
  const languages = parsed.languages ?? [];
  const decks = parsed.decks ?? [];

  await db.transaction("rw", [db.languages, db.decks, db.datasets, db.sentences, db.progress], async () => {
    // Clear all tables
    await db.languages.clear();
    await db.decks.clear();
    await db.datasets.clear();
    await db.sentences.clear();
    await db.progress.clear();

    if (isV2) {
      // v2 backup: restore all tables directly
      if (languages.length > 0) await db.languages.bulkAdd(languages);
      if (decks.length > 0) await db.decks.bulkAdd(decks);
      if (datasets.length > 0) await db.datasets.bulkAdd(datasets);
      if (sentences.length > 0) await db.sentences.bulkAdd(sentences);
      if (progress.length > 0) await db.progress.bulkAdd(progress);
    } else {
      // v1 backup: restore datasets, sentences, progress
      // Migration will happen on next DB open (Dexie version upgrade)
      if (datasets.length > 0) await db.datasets.bulkAdd(datasets);
      if (sentences.length > 0) await db.sentences.bulkAdd(sentences);
      if (progress.length > 0) await db.progress.bulkAdd(progress);

      // Note: The v1->v2 migration will run on page reload since
      // Dexie sees the schema version is outdated. However, we can
      // also do an immediate in-place migration for better UX:
      await migrateV1BackupToV2(datasets, sentences, progress);
    }
  });

  // Restore language progress from localStorage backup
  if (parsed.languageProgress) {
    setAllLanguageProgress(parsed.languageProgress);
  }

  // Restore selected language ID
  if (parsed.selectedLanguageId) {
    setSelectedLanguageId(parsed.selectedLanguageId);
  } else if (languages.length > 0) {
    // Default to first language if no selection saved
    setSelectedLanguageId(languages[0].id);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// INLINE MIGRATION for v1 backups restored into v2 schema
// ─────────────────────────────────────────────────────────────────────────────

async function migrateV1BackupToV2(
  datasets: any[],
  sentences: any[],
  progress: any[]
) {
  // Group datasets by languageTag to create Language records
  const languageMap = new Map<string, any>();
  const datasetToLanguage = new Map<string, string>();

  for (const ds of datasets) {
    const tag = ds.languageTag || "el-GR";
    if (!languageMap.has(tag)) {
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

  // Create default language if no datasets
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

  // Insert languages
  const languages = Array.from(languageMap.values());
  await db.languages.bulkAdd(languages);

  // Update sentences with languageId
  if (sentences.length > 0) {
    const defaultLangId = languages[0].id;
    for (const s of sentences) {
      const langId = datasetToLanguage.get(s.datasetId) || defaultLangId;
      await db.sentences.update(s.id, {
        languageId: langId,
        deckId: undefined
      });
    }
  }

  // Update progress with languageId
  if (progress.length > 0) {
    const defaultLangId = languages[0].id;
    for (const p of progress) {
      const langId = datasetToLanguage.get(p.datasetId) || defaultLangId;
      await db.progress.update(p.datasetId, {
        languageId: langId,
        deckId: undefined
      });
    }
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
  const langPart = tag.split("-")[0];
  const byLangCode: Record<string, string> = {
    el: "Greek", he: "Hebrew", ar: "Arabic", zh: "Chinese",
    ja: "Japanese", ko: "Korean", fr: "French", de: "German",
    es: "Spanish", it: "Italian", pt: "Portuguese", ru: "Russian",
    en: "English", nl: "Dutch", sv: "Swedish", pl: "Polish"
  };
  return byLangCode[langPart] || tag;
}
