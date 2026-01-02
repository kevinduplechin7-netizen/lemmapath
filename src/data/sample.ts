import { db, makeId, type Dataset, type Deck, type ImportBatchRow, type SentenceRow } from "./db";
import { countTokens } from "./tokenize";

// Small, friendly starter set so the app feels usable immediately.
// Users will import their own large libraries after they see the flow.
export const SAMPLE_GREEK: Array<{ en: string; el: string; translit?: string; gloss?: string }> = [
  {
    en: "Hello.",
    el: "Γεια σου.",
    translit: "Yia sou.",
    gloss: "hello"
  },
  {
    en: "How are you?",
    el: "Τι κάνεις;",
    translit: "Ti káneis?",
    gloss: "what do-you-do"
  },
  {
    en: "I'm fine, thank you.",
    el: "Είμαι καλά, ευχαριστώ.",
    translit: "Eímai kalá, efcharistó.",
    gloss: "I-am well, I-thank"
  },
  {
    en: "Where are you from?",
    el: "Από πού είσαι;",
    translit: "Apó poú eísai?",
    gloss: "from where are-you"
  },
  {
    en: "I'm from the United States.",
    el: "Είμαι από τις Ηνωμένες Πολιτείες.",
    translit: "Eímai apó tis Inoménes Politeíes.",
    gloss: "I-am from the United States"
  },
  {
    en: "I don't understand.",
    el: "Δεν καταλαβαίνω.",
    translit: "Den katalavaíno.",
    gloss: "not I-understand"
  },
  {
    en: "Could you say that again?",
    el: "Μπορείς να το πεις ξανά;",
    translit: "Boreís na to peis xaná?",
    gloss: "can-you it say again"
  },
  {
    en: "I would like a coffee, please.",
    el: "Θα ήθελα έναν καφέ, παρακαλώ.",
    translit: "Tha íthela énan kafé, parakaló.",
    gloss: "would I-like a coffee please"
  },
  {
    en: "How much is this?",
    el: "Πόσο κάνει αυτό;",
    translit: "Póso kánei aftó?",
    gloss: "how-much does this-cost"
  },
  {
    en: "Where is the bathroom?",
    el: "Πού είναι η τουαλέτα;",
    translit: "Poú eínai i toualéta?",
    gloss: "where is the bathroom"
  },
  {
    en: "I need help.",
    el: "Χρειάζομαι βοήθεια.",
    translit: "Chreiázomai voítheia.",
    gloss: "I-need help"
  },
  {
    en: "Let's practice one more time.",
    el: "Ας το εξασκήσουμε άλλη μία φορά.",
    translit: "As to exaskísoume álli mía forá.",
    gloss: "let's it practice one more time"
  },
  {
    en: "My parents don't know where I am.",
    el: "Οι γονείς μου δεν ξέρουν πού βρίσκομαι.",
    translit: "Oi gonís mou den xéroun poú vrískomai.",
    gloss: "the parents my not know where I-am"
  },
  {
    en: "Today I'm reading sentences like a book.",
    el: "Σήμερα διαβάζω προτάσεις σαν βιβλίο.",
    translit: "Símera diavázo protáseis san vivlío.",
    gloss: "today I-read sentences like book"
  },
  {
    en: "Tomorrow I'll review them with spaced repetition.",
    el: "Αύριο θα τις επαναλάβω με επανάληψη σε διαστήματα.",
    translit: "Ávrio tha tis epanalávo me epanálipsi se diastímata.",
    gloss: "tomorrow I-will review them with repetition in intervals"
  }
];

export async function seedSampleIfEmpty(dataset: Dataset, deck: Deck) {
  const existing = await db.sentences.where("[datasetId+deckId]").equals([dataset.id, deck.id]).count();
  if (existing > 0) return;

  const createdAt = Date.now();
  const importId = makeId("imp");

  const rows: SentenceRow[] = SAMPLE_GREEK.map((r, idx) => ({
    id: makeId("s"),
    datasetId: dataset.id,
    deckId: deck.id,
    order: idx,
    importId,
    sourceText: r.en,
    targetText: r.el,
    transliterationText: r.translit,
    glossText: r.gloss,
    tokenCount: countTokens(r.el, dataset.cjkMode)
  }));

  const batch: ImportBatchRow = {
    id: importId,
    datasetId: dataset.id,
    deckId: deck.id,
    filename: "Sample (built-in)",
    createdAt,
    mode: "append",
    startOrder: 0,
    endOrder: rows.length - 1,
    rowCount: rows.length
  };

  await db.transaction("rw", db.sentences, db.imports, async () => {
    await db.imports.add(batch);
    await db.sentences.bulkPut(rows);
  });
}
