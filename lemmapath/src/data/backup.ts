import { db } from "./db";

export async function exportAllToJSON(): Promise<string> {
  const datasets = await db.datasets.toArray();
  const sentences = await db.sentences.toArray();
  const progress = await db.progress.toArray();
  return JSON.stringify({ datasets, sentences, progress }, null, 2);
}

export async function importAllFromJSON(jsonText: string) {
  const parsed = JSON.parse(jsonText);
  const datasets = parsed.datasets ?? [];
  const sentences = parsed.sentences ?? [];
  const progress = parsed.progress ?? [];

  await db.transaction("rw", db.datasets, db.sentences, db.progress, async () => {
    await db.datasets.clear();
    await db.sentences.clear();
    await db.progress.clear();
    await db.datasets.bulkAdd(datasets);
    await db.sentences.bulkAdd(sentences);
    await db.progress.bulkAdd(progress);
  });
}
