import { db, type Deck, type PathProgressRow, type DatasetStatsRow, type SeenWordRow } from "./db";

export async function exportAllToJSON(): Promise<string> {
  const datasets = await db.datasets.toArray();
  const decks = await db.decks.toArray();
  const imports = await db.imports.toArray();
  const sentences = await db.sentences.toArray();
  const progress = await db.progress.toArray(); // legacy
  const pathProgress = await db.pathProgress.toArray();
  const srs = await db.srs.toArray();
  const stats = await db.stats.toArray();
  const seenWords = await db.seenWords.toArray();

  return JSON.stringify({ datasets, decks, imports, sentences, progress, pathProgress, srs, stats, seenWords }, null, 2);
}

function ensureDecksForImport(datasets: any[], decks: any[]): Deck[] {
  const out: Deck[] = [...(decks as any[])];

  const byDataset = new Map<string, Deck[]>();
  for (const d of out) {
    const arr = byDataset.get(d.datasetId) ?? [];
    arr.push(d);
    byDataset.set(d.datasetId, arr);
  }

  for (const ds of datasets) {
    if ((byDataset.get(ds.id) ?? []).length === 0) {
      out.push({
        id: `deck_${ds.id}`,
        datasetId: ds.id,
        name: "Main",
        createdAt: ds.createdAt ?? Date.now()
      });
    }
  }

  return out;
}

export async function importAllFromJSON(jsonText: string) {
  const parsed = JSON.parse(jsonText);

  const datasets = (parsed.datasets ?? []) as any[];
  const decksIn = (parsed.decks ?? []) as any[];
  const imports = (parsed.imports ?? []) as any[];

  const sentencesIn = (parsed.sentences ?? []) as any[];
  const progressLegacy = (parsed.progress ?? []) as any[];

  const pathProgressIn = (parsed.pathProgress ?? []) as any[];
  const srs = (parsed.srs ?? []) as any[];

  const statsIn = (parsed.stats ?? []) as DatasetStatsRow[];
  const seenWordsIn = (parsed.seenWords ?? []) as SeenWordRow[];

  const decks = ensureDecksForImport(datasets, decksIn);

  // If sentences are missing deckId/order (old backups), assign them to default deck and sort by id.
  const defaultDeckIdByDataset = new Map<string, string>();
  for (const ds of datasets) {
    const d = decks.find((x) => x.datasetId === ds.id) ?? null;
    if (d) defaultDeckIdByDataset.set(ds.id, d.id);
  }

  const sentences = [...sentencesIn];
  const needsUpgrade = sentences.some((s) => !("deckId" in s) || !("order" in s) || !("importId" in s));

  if (needsUpgrade) {
    const byDs = new Map<string, any[]>();
    for (const s of sentences) {
      const arr = byDs.get(s.datasetId) ?? [];
      arr.push(s);
      byDs.set(s.datasetId, arr);
    }

    for (const [dsId, arr] of byDs.entries()) {
      const deckId = defaultDeckIdByDataset.get(dsId) ?? `deck_${dsId}`;
      arr.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      for (let i = 0; i < arr.length; i++) {
        arr[i].deckId = deckId;
        arr[i].order = i;
        arr[i].importId = arr[i].importId ?? "legacy";
      }
    }
  }

  // If pathProgress missing, derive from legacy progress for each dataset's default deck.
  let pathProgress: PathProgressRow[] = [...(pathProgressIn as any[])];

  if (pathProgress.length === 0) {
    for (const ds of datasets) {
      const deckId = defaultDeckIdByDataset.get(ds.id) ?? `deck_${ds.id}`;
      const legacy = progressLegacy.find((p) => p.datasetId === ds.id);
      const linearOrder = legacy?.currentIndex ?? 0;

      pathProgress.push({
        datasetId: ds.id,
        deckId,
        mode: "linear",
        linearOrder,
        srsNewOrder: linearOrder,
        lifetimeReps: legacy?.lifetimeReps ?? 0,
        lifetimeTokens: legacy?.lifetimeTokens ?? 0,
        updatedAt: Date.now()
      });
    }
  }

  // If stats missing, seed empty rows.
  const stats: DatasetStatsRow[] = statsIn.length
    ? statsIn
    : datasets.map((ds) => ({ datasetId: ds.id, uniqueWordsSeen: 0, updatedAt: Date.now() }));

  await db.transaction(
    "rw",
    [db.datasets, db.decks, db.imports, db.sentences, db.progress, db.pathProgress, db.srs, db.stats, db.seenWords],
    async () => {
      await db.datasets.clear();
      await db.decks.clear();
      await db.imports.clear();
      await db.sentences.clear();
      await db.progress.clear();
      await db.pathProgress.clear();
      await db.srs.clear();
      await db.stats.clear();
      await db.seenWords.clear();

      await db.datasets.bulkPut(datasets);
      await db.decks.bulkPut(decks);
      await db.imports.bulkPut(imports);
      await db.sentences.bulkPut(sentences);

      // Keep legacy progress if present; otherwise create minimal.
      if (progressLegacy.length) await db.progress.bulkPut(progressLegacy);
      else {
        const legacySeed = datasets.map((ds) => ({
          datasetId: ds.id,
          lifetimeReps: 0,
          lifetimeTokens: 0,
          currentIndex: 0,
          updatedAt: Date.now()
        }));
        await db.progress.bulkPut(legacySeed as any);
      }

      await db.pathProgress.bulkPut(pathProgress as any);
      if (srs.length) await db.srs.bulkPut(srs);

      await db.stats.bulkPut(stats as any);
      if (seenWordsIn.length) await db.seenWords.bulkPut(seenWordsIn as any);
    }
  );
}
