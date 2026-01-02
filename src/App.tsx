import { useEffect, useMemo, useRef, useState } from "react";
import {
  db,
  createDataset,
  createDeck,
  ensureDefaultDataset,
  ensureDefaultDeck,
  ensurePathProgress,
  getSentenceByOrder,
  getSentenceCount,
  type Dataset,
  type Deck,
  type PathProgressRow,
  type SentenceRow,
  type SRSRow
} from "./data/db";
import { InstallCard } from "./components/InstallCard";
import { ImportPanel } from "./components/ImportPanel";
import { PracticeCard } from "./components/PracticeCard";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { exportAllToJSON, importAllFromJSON } from "./data/backup";
import { useTTS } from "./hooks/useTTS";

function autoRTL(text: string) {
  return /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/.test(text);
}

const DAY_MS = 24 * 60 * 60 * 1000;

type ActiveCard =
  | { kind: "none"; row: null; srs: null }
  | { kind: "linear"; row: SentenceRow; srs: null }
  | { kind: "srs"; row: SentenceRow; srs: SRSRow | null; isNew: boolean };

export default function App() {
  const { voices, speak, prime, unlocked, isIOS } = useTTS();

  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [dataset, setDataset] = useState<Dataset | null>(null);

  const [decks, setDecks] = useState<Deck[]>([]);
  const [deck, setDeck] = useState<Deck | null>(null);

  const [pathProg, setPathProg] = useState<PathProgressRow | null>(null);

  const [count, setCount] = useState(0);
  const [dueCount, setDueCount] = useState(0);

  const [card, setCard] = useState<ActiveCard>({ kind: "none", row: null, srs: null });

  const [showSource, setShowSource] = useState(true);
  const [showTranslit, setShowTranslit] = useState(false);
  const [showGloss, setShowGloss] = useState(false);
  const [fontScale, setFontScale] = useState(1);
  const [showSettings, setShowSettings] = useState(false);

  const loadingRef = useRef(false);
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const importSectionRef = useRef<HTMLDivElement>(null);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 1800);
  };

  const [showOnboarding, setShowOnboarding] = useState(() => localStorage.getItem("lemmapath_hide_onboarding") !== "1");

  const openImportPicker = () => {
    // Keep the user oriented, then open the OS file picker.
    importSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    // Delay one frame so scroll starts (still counts as user gesture in practice).
    requestAnimationFrame(() => importFileInputRef.current?.click());
  };

  const rtl = useMemo(() => {
    if (!dataset || !card.row) return false;
    if (dataset.rtlMode === "rtl") return true;
    if (dataset.rtlMode === "ltr") return false;
    return autoRTL(card.row.targetText);
  }, [dataset, card.row]);

  async function loadLibrary(preferDatasetId?: string, preferDeckId?: string) {
    const ds = await ensureDefaultDataset();

    const allDatasets = await db.datasets.orderBy("createdAt").toArray();
    setDatasets(allDatasets);

    const storedDsId = preferDatasetId ?? localStorage.getItem("lemmapath_datasetId") ?? ds.id;
    const activeDs = allDatasets.find((d) => d.id === storedDsId) ?? ds;

    localStorage.setItem("lemmapath_datasetId", activeDs.id);
    setDataset(activeDs);

    document.documentElement.setAttribute("data-theme", activeDs.theme);

    const ensuredDefaultDeck = await ensureDefaultDeck(activeDs.id);
    const allDecks = await db.decks.where("datasetId").equals(activeDs.id).sortBy("createdAt");
    setDecks(allDecks);

    const storedDeckId = preferDeckId ?? localStorage.getItem("lemmapath_deckId") ?? ensuredDefaultDeck.id;
    const activeDeck = allDecks.find((d) => d.id === storedDeckId) ?? ensuredDefaultDeck;

    localStorage.setItem("lemmapath_deckId", activeDeck.id);
    setDeck(activeDeck);

    await refresh(activeDs, activeDeck);
  }

  async function getNextSrsCard(activeDs: Dataset, activeDeck: Deck, pp: PathProgressRow): Promise<ActiveCard> {
    const now = Date.now();

    const due = await db.srs
      .where("[datasetId+deckId+dueAt]")
      .between([activeDs.id, activeDeck.id, -Infinity], [activeDs.id, activeDeck.id, now])
      .first();

    const dueC = await db.srs
      .where("[datasetId+deckId+dueAt]")
      .between([activeDs.id, activeDeck.id, -Infinity], [activeDs.id, activeDeck.id, now])
      .count();

    setDueCount(dueC);

    if (due) {
      const s = await db.sentences.get(due.sentenceId);
      if (s) return { kind: "srs", row: s, srs: due, isNew: false };
    }

    // No due cards — introduce the next new sentence in order.
    // If we somehow land on a sentence that already has SRS state, skip forward.
    let probe = pp.srsNewOrder;
    for (let tries = 0; tries < 50; tries++) {
      const s = await getSentenceByOrder(activeDs.id, activeDeck.id, probe);
      if (!s) return { kind: "none", row: null, srs: null };

      const existing = await db.srs.get([activeDs.id, activeDeck.id, s.id]);
      if (!existing) {
        setDueCount(0);
        return { kind: "srs", row: s, srs: null, isNew: true };
      }
      probe++;
    }

    return { kind: "none", row: null, srs: null };
  }

  async function refresh(activeDs?: Dataset, activeDeck?: Deck) {
    const ds = activeDs ?? dataset;
    const dk = activeDeck ?? deck;
    if (!ds || !dk) return;

    const c = await getSentenceCount(ds.id, dk.id);
    setCount(c);

    const pp = await ensurePathProgress(ds.id, dk.id);
    setPathProg(pp);

    if (c === 0) {
      setDueCount(0);
      setCard({ kind: "none", row: null, srs: null });
      return;
    }

    if (pp.mode === "linear") {
      const maxOrder = Math.max(0, c - 1);
      const nextOrder = Math.min(Math.max(0, pp.linearOrder), maxOrder);

      if (nextOrder !== pp.linearOrder) {
        const patched = { ...pp, linearOrder: nextOrder, updatedAt: Date.now() };
        await db.pathProgress.put(patched);
        setPathProg(patched);
      }

      const r = await getSentenceByOrder(ds.id, dk.id, nextOrder);
      if (!r) {
        setCard({ kind: "none", row: null, srs: null });
        return;
      }

      setDueCount(0);
      setCard({ kind: "linear", row: r, srs: null });
      return;
    }

    // SRS mode
    setCard(await getNextSrsCard(ds, dk, pp));
  }

  useEffect(() => {
    loadLibrary().catch((err) => console.error(err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!dataset) return;
    document.documentElement.setAttribute("data-theme", dataset.theme);
  }, [dataset]);



  async function bumpLinear(delta: number, countRep: boolean) {
    if (!dataset || !deck || !pathProg) return;
    if (pathProg.mode !== "linear") return;
    if (loadingRef.current) return;
    loadingRef.current = true;

    try {
      const c = await getSentenceCount(dataset.id, deck.id);
      const maxOrder = Math.max(0, c - 1);
      const nextOrder = Math.min(Math.max(0, pathProg.linearOrder + delta), maxOrder);

      const next = await getSentenceByOrder(dataset.id, deck.id, nextOrder);
      if (!next) return;

      const newProg: PathProgressRow = {
        ...pathProg,
        linearOrder: nextOrder,
        updatedAt: Date.now(),
        lifetimeReps: countRep ? pathProg.lifetimeReps + 1 : pathProg.lifetimeReps,
        lifetimeTokens: countRep ? pathProg.lifetimeTokens + next.tokenCount : pathProg.lifetimeTokens
      };

      await db.pathProgress.put(newProg);
      setPathProg(newProg);
      setCard({ kind: "linear", row: next, srs: null });
    } finally {
      loadingRef.current = false;
    }
  }

  function computeSrsUpdate(prev: SRSRow, grade: "again" | "good" | "easy") {
    const now = Date.now();
    let ease = prev.ease;
    let reps = prev.reps;
    let lapses = prev.lapses;
    let intervalDays = prev.intervalDays;
    let dueAt = prev.dueAt;

    if (grade === "again") {
      lapses += 1;
      reps = 0;
      intervalDays = 0;
      ease = Math.max(1.3, ease - 0.2);
      dueAt = now + 10 * 60 * 1000;
    } else if (grade === "good") {
      reps += 1;
      if (reps === 1) intervalDays = 1;
      else if (reps === 2) intervalDays = 6;
      else intervalDays = Math.max(1, Math.round(intervalDays * ease));
      dueAt = now + intervalDays * DAY_MS;
    } else {
      // easy
      reps += 1;
      ease = Math.min(3.0, ease + 0.15);
      if (reps === 1) intervalDays = 4;
      else if (reps === 2) intervalDays = 10;
      else intervalDays = Math.max(1, Math.round(intervalDays * ease * 1.3));
      dueAt = now + intervalDays * DAY_MS;
    }

    return { ease, reps, lapses, intervalDays, dueAt, updatedAt: now };
  }

  async function rateSRS(grade: "again" | "good" | "easy") {
    if (!dataset || !deck || !pathProg) return;
    if (pathProg.mode !== "srs") return;
    if (card.kind !== "srs" || !card.row) return;
    if (loadingRef.current) return;
    loadingRef.current = true;

    try {
      const key: [string, string, string] = [dataset.id, deck.id, card.row.id];

      const base: SRSRow =
        card.srs ??
        ({
          datasetId: dataset.id,
          deckId: deck.id,
          sentenceId: card.row.id,
          dueAt: Date.now(),
          reps: 0,
          lapses: 0,
          intervalDays: 0,
          ease: 2.5,
          updatedAt: Date.now()
        } as SRSRow);

      const patch = computeSrsUpdate(base, grade);
      const nextSrs: SRSRow = { ...base, ...patch };

      await db.srs.put(nextSrs);

      const isFirstTime = card.srs === null;
      const newProg: PathProgressRow = {
        ...pathProg,
        srsNewOrder: isFirstTime ? pathProg.srsNewOrder + 1 : pathProg.srsNewOrder,
        lifetimeReps: pathProg.lifetimeReps + 1,
        lifetimeTokens: pathProg.lifetimeTokens + (card.row.tokenCount || 0),
        updatedAt: Date.now()
      };

      await db.pathProgress.put(newProg);
      setPathProg(newProg);

      await refresh(dataset, deck);
    } finally {
      loadingRef.current = false;
    }
  }

  async function toggleMode(nextMode: "linear" | "srs") {
    if (!dataset || !deck || !pathProg) return;
    const patched: PathProgressRow = { ...pathProg, mode: nextMode, updatedAt: Date.now() };
    await db.pathProgress.put(patched);
    setPathProg(patched);
    await refresh(dataset, deck);
  }

  const playAudio = () => {
    if (!dataset || !card.row) return;
    try {
      if (!("speechSynthesis" in window)) {
        showToast("Audio is not supported in this browser.");
        return;
      }

      // Mobile browsers generally require a user gesture. We keep audio manual (no autoplay).
      if (isIOS && !unlocked) {
        prime();
        // give iOS a beat to unlock
        window.setTimeout(() => {
          speak(card.row!.targetText, {
            lang: dataset.languageTag,
            rate: dataset.ttsRate,
            pitch: dataset.ttsPitch,
            voiceURI: dataset.preferredVoiceURI
          });
        }, 40);
      } else {
        speak(card.row.targetText, {
          lang: dataset.languageTag,
          rate: dataset.ttsRate,
          pitch: dataset.ttsPitch,
          voiceURI: dataset.preferredVoiceURI
        });
      }
    } catch {
      showToast("Audio couldn’t play. Try again.");
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || (e.target as any)?.isContentEditable) return;

      if (e.code === "Space") {
        e.preventDefault();

        if (pathProg?.mode === "srs") {
          if (e.shiftKey) rateSRS("again");
          else rateSRS("good");
          return;
        }

        if (e.shiftKey) bumpLinear(-1, false);
        else bumpLinear(1, true);
      }

      if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        playAudio();
      }

      if (e.key.toLowerCase() === "g") setShowGloss((v) => !v);
      if (e.key.toLowerCase() === "t") setShowTranslit((v) => !v);
      if (e.key.toLowerCase() === "e") setShowSource((v) => !v);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset, deck, card.row, pathProg]);

  if (!dataset || !deck) return <div className="container">Loading…</div>;

  const pct = pathProg ? Math.min(1, pathProg.lifetimeTokens / dataset.goalTokens) : 0;

  const lastBackupAt = Number(localStorage.getItem("lemmapath_last_backup_at") || "0");
  const needsBackup = !lastBackupAt || Date.now() - lastBackupAt > 7 * DAY_MS;

  return (
    <div className="container">
      <div className="header">
        <div className="brand">
          <strong>LemmaPath</strong>
          <span>Sentence practice • local-first • multi-language • multi-path</span>
        </div>

        <div className="row">
          <button className="btn" onClick={() => setShowSettings((v) => !v)}>
            Settings
          </button>
          <button className="btn" onClick={() => setFontScale((v) => Math.min(1.5, v + 0.05))}>
            A+
          </button>
          <button className="btn" onClick={() => setFontScale((v) => Math.max(0.85, v - 0.05))}>
            A-
          </button>
        </div>
      </div>

      {needsBackup && (
        <div className="panel" style={{ padding: 14, marginTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Weekly backup reminder</div>
          <div style={{ color: "var(--muted)", fontSize: 14 }}>
            LemmaPath is local-first. Back up your library at least once per week (Settings → Backup).
          </div>
        </div>
      )}

      <InstallCard />

      <div className="panel" style={{ padding: 16, marginTop: 12 }}>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <span className="pill">Language</span>
          <select
            className="btn"
            value={dataset.id}
            onChange={async (e) => {
              const nextId = e.target.value;
              await loadLibrary(nextId, undefined);
            }}
            style={{ minWidth: 240 }}
          >
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>

          <button
            className="btn"
            onClick={async () => {
              const name = prompt("Language name (example: French)")?.trim();
              if (!name) return;
              const tag = prompt("Language tag for TTS (example: fr-FR)")?.trim() || "fr-FR";
              const ds = await createDataset({ name, languageTag: tag });
              await loadLibrary(ds.id, undefined);
            }}
          >
            New language
          </button>

          <span className="pill">Path</span>
          <select
            className="btn"
            value={deck.id}
            onChange={async (e) => {
              const nextId = e.target.value;
              localStorage.setItem("lemmapath_deckId", nextId);
              const nextDeck = decks.find((d) => d.id === nextId) ?? null;
              if (!nextDeck) return;
              setDeck(nextDeck);
              await refresh(dataset, nextDeck);
            }}
            style={{ minWidth: 240 }}
          >
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>

          <button
            className="btn"
            onClick={async () => {
              const name = prompt("Path name (example: Travel B1)")?.trim();
              if (!name) return;
              const dk = await createDeck(dataset.id, name);
              await ensurePathProgress(dataset.id, dk.id);
              await loadLibrary(dataset.id, dk.id);
            }}
          >
            New path
          </button>
        </div>

        <div className="row" style={{ justifyContent: "space-between", marginTop: 12 }}>
          <div className="row">
            <span className="pill">
              Mode:{" "}
              <strong style={{ textTransform: "uppercase" }}>{pathProg?.mode === "srs" ? "SRS" : "Linear"}</strong>
            </span>
            <span className="pill">
              Reps: <strong>{pathProg?.lifetimeReps ?? 0}</strong>
            </span>
            <span className="pill">
              Tokens: <strong>{pathProg?.lifetimeTokens ?? 0}</strong>
            </span>
            <span className="pill">
              Sentences: <strong>{count}</strong>
            </span>
            {pathProg?.mode === "srs" && (
              <span className="pill">
                Due: <strong>{dueCount}</strong>
              </span>
            )}
          </div>

          <div className="row">
            <div className="progressOuter" aria-label="Progress">
              <div className="progressInner" style={{ width: `${Math.round(pct * 100)}%` }} />
            </div>
            <span className="pill">{Math.round(pct * 100)}%</span>
          </div>
        </div>

        <div className="row" style={{ marginTop: 12, gap: 10, flexWrap: "wrap" }}>
          <span className="pill">Study mode</span>
          <select
            className="btn"
            value={pathProg?.mode ?? "linear"}
            onChange={async (e) => toggleMode(e.target.value as any)}
          >
            <option value="linear">Go straight through (Linear)</option>
            <option value="srs">Spaced repetition (Anki-style)</option>
          </select>

          <span className="pill">Show</span>
          <button className="btn" onClick={() => setShowSource((v) => !v)}>
            English {showSource ? "✓" : "—"}
          </button>
          <button className="btn" onClick={() => setShowTranslit((v) => !v)}>
            Transliteration {showTranslit ? "✓" : "—"}
          </button>
          <button className="btn" onClick={() => setShowGloss((v) => !v)}>
            Gloss {showGloss ? "✓" : "—"}
          </button>
        </div>
      </div>

      {showOnboarding && (
        <div className="panel" style={{ padding: 16, marginTop: 12 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Quick start</div>
              <div style={{ color: "var(--muted)", fontSize: 13 }}>Two steps, then you’re in flow.</div>
            </div>
            <button
              className="btn"
              onClick={() => {
                localStorage.setItem("lemmapath_hide_onboarding", "1");
                setShowOnboarding(false);
              }}
            >
              Hide forever
            </button>
          </div>

          <ol style={{ margin: "10px 0 0 18px", color: "var(--muted)", lineHeight: 1.65 }}>
            <li>
              <strong>Import</strong> a spreadsheet (CSV / TSV / XLSX). Use the big “Choose file” button.
            </li>
            <li>
              <strong>Practice</strong>: use <span className="kbd">Linear</span> to go straight through, or{" "}
              <span className="kbd">Spaced</span> for an Anki‑style review loop.
            </li>
          </ol>
        </div>
      )}

      <PracticeCard
        row={card.row}
        showSource={showSource}
        showTranslit={showTranslit}
        showGloss={showGloss}
        rtl={rtl}
        fontScale={fontScale}
        languageName={dataset.name}
        onImportClick={openImportPicker}
        onToggleTranslit={() => setShowTranslit((v) => !v)}
        onToggleGloss={() => setShowGloss((v) => !v)}
        spotlightTrigger={card.row?.order ?? 0}
        onCopyTarget={async () => {
          if (!card.row) return;
          try {
            await navigator.clipboard.writeText(card.row.targetText);
            showToast("Copied target.");
          } catch {
            showToast("Copy failed.");
          }
        }}
        onCopySource={async () => {
          if (!card.row) return;
          try {
            await navigator.clipboard.writeText(card.row.sourceText);
            showToast("Copied source.");
          } catch {
            showToast("Copy failed.");
          }
        }}
        onCopyBoth={async () => {
          if (!card.row) return;
          try {
            await navigator.clipboard.writeText(`${card.row.sourceText}\n${card.row.targetText}`);
            showToast("Copied both.");
          } catch {
            showToast("Copy failed.");
          }
        }}
      />

      <div className="actionBar">
        {pathProg?.mode === "linear" ? (
          <>
            <button className="btn" onClick={() => bumpLinear(-1, false)} disabled={!card.row}>
              Prev
            </button>
            <button className="btn" onClick={playAudio} disabled={!card.row}>
              {isIOS && !unlocked ? "Unlock audio" : "Play"}
            </button>
            <button className="btn primary" onClick={() => bumpLinear(1, true)} disabled={!card.row}>
              Next
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={() => rateSRS("again")} disabled={!card.row}>
              Again
            </button>
            <button className="btn" onClick={playAudio} disabled={!card.row}>
              {isIOS && !unlocked ? "Unlock audio" : "Play"}
            </button>
            <button className="btn primary" onClick={() => rateSRS("good")} disabled={!card.row}>
              Good
            </button>
            <button className="btn" onClick={() => rateSRS("easy")} disabled={!card.row}>
              Easy
            </button>
          </>
        )}
      </div>

      <div ref={importSectionRef}>
      <ImportPanel
        dataset={dataset}
        deck={deck}
        decks={decks}
        fileInputRef={importFileInputRef}
        onToast={showToast}
        onSelectDeck={async (deckId) => {
          localStorage.setItem("lemmapath_deckId", deckId);
          const nextDeck = decks.find((d) => d.id === deckId) ?? null;
          if (!nextDeck) return;
          setDeck(nextDeck);
          await refresh(dataset, nextDeck);
        }}
        onCreateDeck={async () => {
          const name = prompt("Path name (example: News articles B1)")?.trim();
          if (!name) return;
          const dk = await createDeck(dataset.id, name);
          await ensurePathProgress(dataset.id, dk.id);
          await loadLibrary(dataset.id, dk.id);
        }}
        onImported={async () => {
          await refresh(dataset, deck);
        }}
      />
      </div>

      {showSettings && (
        <>
          <SettingsDrawer
            dataset={dataset}
            voices={voices}
            onUpdate={async (patch) => {
              const next = { ...dataset, ...patch };
              await db.datasets.put(next);
              setDataset(next);
            }}
          />

          <div className="panel" style={{ padding: 16, marginTop: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Backup / Restore</div>
            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
              <button
                className="btn"
                onClick={async () => {
                  const json = await exportAllToJSON();
                  const blob = new Blob([json], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "lemmapath-backup.json";
                  a.click();
                  URL.revokeObjectURL(url);

                  localStorage.setItem("lemmapath_last_backup_at", String(Date.now()));
                  showToast("Backup downloaded.");
                }}
              >
                Download backup (JSON)
              </button>

              <label className="btn" style={{ cursor: "pointer" }}>
                Restore from backup
                <input
                  type="file"
                  accept="application/json"
                  style={{ display: "none" }}
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                      const text = await f.text();
                      await importAllFromJSON(text);
                      localStorage.setItem("lemmapath_last_backup_at", String(Date.now()));
                      await loadLibrary();
                      showToast("Restore complete.");
                    } catch (err: any) {
                      showToast(err?.message ?? "Restore failed.");
                    }
                  }}
                />
              </label>
            </div>

            <div style={{ marginTop: 10, color: "var(--muted)", fontSize: 13 }}>
              Tip: if your library is huge, backups can be large. That’s normal — it’s your local database.
            </div>
          </div>
        </>
      )}

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}
