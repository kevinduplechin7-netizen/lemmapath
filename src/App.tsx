import { useEffect, useMemo, useRef, useState } from "react";
import {
  db,
  createDataset,
  createDeck,
  ensureDefaultDataset,
  ensureDefaultDeck,
  ensureDatasetStats,
  ensurePathProgress,
  recordTokensSeen,
  type Dataset,
  type Deck,
  type ImportBatchRow,
  type PathProgressRow,
  type SentenceRow,
  type SRSRow
} from "./data/db";
import { countTokens, tokenizeText } from "./data/tokenize";
import { ImportPanel } from "./components/ImportPanel";
import { LanguageManager } from "./components/LanguageManager";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { InstallCard } from "./components/InstallCard";
import { SentenceCard } from "./components/SentenceCard";
import { Modal } from "./components/Modal";
import { useTTS } from "./hooks/useTTS";
import { INTERLINEAR_STUDIO_URL } from "./config";

// PWA update control (lets us show a "Refresh" button when a new version is available).
import { registerSW } from "virtual:pwa-register";

import { clearPathData, deleteImportBatch } from "./data/importers";

type Mode = "linear" | "srs";

type View = "home" | "practice" | "library";

type Toast = { msg: string; ts: number } | null;

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function isRTLText(text: string): boolean {
  // Rough heuristic.
  return /[\u0590-\u05FF\u0600-\u06FF]/.test(text);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function scoreSRS(ease: number, rating: "again" | "hard" | "good" | "easy") {
  // A light, Anki-inspired scheduler: we keep ease and interval days.
  if (rating === "again") return { ease: clamp(ease - 0.2, 1.3, 2.8), mult: 0.0, minDays: 0 };
  if (rating === "hard") return { ease: clamp(ease - 0.05, 1.3, 2.8), mult: 1.0, minDays: 1 };
  if (rating === "good") return { ease: clamp(ease + 0.0, 1.3, 2.8), mult: 1.8, minDays: 1 };
  return { ease: clamp(ease + 0.1, 1.3, 2.8), mult: 2.2, minDays: 1 };
}

function scheduleSRS(state: { reps: number; intervalDays: number; ease: number }, rating: "again" | "hard" | "good" | "easy") {
  const scored = scoreSRS(state.ease, rating);
  const reps = rating === "again" ? 0 : state.reps + 1;

  let nextInterval = 0;
  if (rating === "again") nextInterval = 0;
  else if (state.reps === 0) nextInterval = Math.max(1, scored.minDays);
  else if (state.reps === 1) nextInterval = Math.max(3, scored.minDays);
  else nextInterval = Math.max(Math.round(state.intervalDays * scored.ease * scored.mult), scored.minDays);

  return {
    reps,
    intervalDays: nextInterval,
    ease: scored.ease
  };
}

function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
}

function makeTemplateTSV() {
  return [
    ["English", "Target", "Transliteration", "Gloss"].join("\t"),
    ["My parents don't know where I am.", "…", "…", "my parents / do not / know / where / I am"].join("\t")
  ].join("\n");
}

export default function App() {
  const tts = useTTS();

  const [toast, setToast] = useState<Toast>(null);
  const showToast = (msg: string) => {
    setToast({ msg, ts: Date.now() });
    setTimeout(() => setToast((t) => (t && Date.now() - t.ts > 1800 ? null : t)), 2000);
  };

  const [view, setView] = useState<View>("home");
  const lastNonLibraryViewRef = useRef<View>("home");

  const goToLibrary = () => {
    if (view !== "library") lastNonLibraryViewRef.current = view;
    setView("library");
  };
  const backFromLibrary = () => {
    setView(lastNonLibraryViewRef.current || "home");
  };

  // PWA updates
  const [pwaNeedRefresh, setPwaNeedRefresh] = useState(false);
  const updateSWRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    // registerSW is safe in browser-only Vite apps.
    try {
      const updateSW = registerSW({
        immediate: true,
        onNeedRefresh() {
          setPwaNeedRefresh(true);
        },
        onOfflineReady() {
          // Keep it subtle (no toast spam)
        }
      });
      updateSWRef.current = updateSW as any;
    } catch {
      // ignore
    }
  }, []);

  async function refreshAppFilesKeepData() {
    // This clears SW + Cache Storage only. It does NOT touch IndexedDB/local data.
    try {
      if (updateSWRef.current) {
        // If a new SW is waiting, this will activate it and reload.
        await updateSWRef.current(true);
        return;
      }
    } catch {
      // fall through
    }

    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) await r.unregister();
      }
    } catch {
      // ignore
    }
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {
      // ignore
    }
    location.reload();
  }

  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);

  const [datasetId, setDatasetId] = useState<string>("");
  const [deckId, setDeckId] = useState<string>("");

  const dataset = useMemo(() => datasets.find((d) => d.id === datasetId) ?? null, [datasets, datasetId]);
  const deck = useMemo(() => decks.find((d) => d.id === deckId) ?? null, [decks, deckId]);

  const [pathProg, setPathProg] = useState<PathProgressRow | null>(null);
  const [uniqueWords, setUniqueWords] = useState<number>(0);
  const [sentenceCount, setSentenceCount] = useState<number>(0);
  const [dueCount, setDueCount] = useState<number>(0);

  const [row, setRow] = useState<SentenceRow | null>(null);
  const [srsRow, setSrsRow] = useState<SRSRow | null>(null);

  const [showSource, setShowSource] = useState<boolean>(() => localStorage.getItem("sentencepaths_showSource") !== "0");
  const [showTranslit, setShowTranslit] = useState<boolean>(() => localStorage.getItem("sentencepaths_showTranslit") === "1");
  const [showGloss, setShowGloss] = useState<boolean>(() => localStorage.getItem("sentencepaths_showGloss") === "1");
  const [fontScale, setFontScale] = useState<number>(() => {
    const raw = localStorage.getItem("sentencepaths_fontScale");
    return raw ? clamp(parseFloat(raw), 0.8, 1.4) : 1;
  });

  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Library: manage import batches (delete / undo)
  const [showImportManager, setShowImportManager] = useState(false);
  const [importBatches, setImportBatches] = useState<ImportBatchRow[]>([]);

  const [forceImportTips, setForceImportTips] = useState(false);
  const [showNewLanguage, setShowNewLanguage] = useState(false);
  const [newLanguageName, setNewLanguageName] = useState("");
  const [newLanguageTag, setNewLanguageTag] = useState("");
  const [showAdvancedLanguages, setShowAdvancedLanguages] = useState(false);

  const [autoRun, setAutoRun] = useState<boolean>(() => localStorage.getItem("sentencepaths_autoRun") === "1");
  // Auto mode can be temporarily paused without disabling it.
  const [autoPaused, setAutoPaused] = useState<boolean>(false);
  const [autoAfter, setAutoAfter] = useState<"audio" | "delay">(
    (localStorage.getItem("sentencepaths_autoAfter") as any) === "delay" ? "delay" : "audio"
  );
  const [autoDelaySec, setAutoDelaySec] = useState<number>(() => {
    const raw = localStorage.getItem("sentencepaths_autoDelaySec");
    return raw ? clamp(parseFloat(raw), 0.0, 10) : 0.5;
  });

  const [ttsEnglish, setTTSEnglish] = useState<boolean>(() => localStorage.getItem("sentencepaths_ttsEnglish") === "1");

  // Persist preferences
  useEffect(() => {
    localStorage.setItem("sentencepaths_showSource", showSource ? "1" : "0");
  }, [showSource]);
  useEffect(() => {
    localStorage.setItem("sentencepaths_showTranslit", showTranslit ? "1" : "0");
  }, [showTranslit]);
  useEffect(() => {
    localStorage.setItem("sentencepaths_showGloss", showGloss ? "1" : "0");
  }, [showGloss]);
  useEffect(() => {
    localStorage.setItem("sentencepaths_fontScale", String(fontScale));
  }, [fontScale]);
  useEffect(() => {
    localStorage.setItem("sentencepaths_autoRun", autoRun ? "1" : "0");
  }, [autoRun]);

  useEffect(() => {
    if (!autoRun) setAutoPaused(false);
  }, [autoRun]);
  useEffect(() => {
    if (view !== "practice") setAutoPaused(false);
  }, [view]);
  useEffect(() => {
    localStorage.setItem("sentencepaths_autoAfter", autoAfter);
  }, [autoAfter]);
  useEffect(() => {
    localStorage.setItem("sentencepaths_autoDelaySec", String(autoDelaySec));
  }, [autoDelaySec]);
  useEffect(() => {
    localStorage.setItem("sentencepaths_ttsEnglish", ttsEnglish ? "1" : "0");
  }, [ttsEnglish]);

  const rtl = useMemo(() => {
    if (!dataset) return false;
    if (dataset.rtlMode === "rtl") return true;
    if (dataset.rtlMode === "ltr") return false;
    return row?.targetText ? isRTLText(row.targetText) : false;
  }, [dataset, row]);

  // ---- Load + seed ----
  async function loadAll() {
    const ds = await ensureDefaultDataset();
    const dk = await ensureDefaultDeck(ds.id);

    // Lazy-load starter sample so it does not bloat the initial bundle.
    const { seedSampleIfEmpty } = await import("./data/sample");
    await seedSampleIfEmpty(ds, dk);
    await ensureDatasetStats(ds.id);

    const allDatasets = await db.datasets.orderBy("createdAt").toArray();
    const currentDatasetId = localStorage.getItem("sentencepaths_currentDataset") ?? ds.id;
    const safeDatasetId = allDatasets.find((d) => d.id === currentDatasetId)?.id ?? ds.id;

    const allDecks = await db.decks.where("datasetId").equals(safeDatasetId).sortBy("createdAt");
    const desiredDeckId = localStorage.getItem("sentencepaths_currentDeck") ?? (allDecks[0]?.id ?? dk.id);
    const safeDeckId = allDecks.find((d) => d.id === desiredDeckId)?.id ?? (allDecks[0]?.id ?? dk.id);

    setDatasets(allDatasets);
    setDecks(allDecks);
    setDatasetId(safeDatasetId);
    setDeckId(safeDeckId);
  }

  async function createLanguage(name: string, tag: string) {
    const nd = await createDataset({ name, languageTag: tag || "und" });
    const dk = await ensureDefaultDeck(nd.id);
    await ensureDatasetStats(nd.id);

    const all = await db.datasets.orderBy("createdAt").toArray();
    setDatasets(all);
    setDatasetId(nd.id);
    setDeckId(dk.id);

    // Make the next step obvious.
    lastNonLibraryViewRef.current = "home";
    goToLibrary();
    setForceImportTips(true);
    showToast("Language added");
  }

  useEffect(() => {
    loadAll().catch((e) => console.error(e));
  }, []);

  // Apply theme at the document level so the background matches too.
  useEffect(() => {
    const t = dataset?.theme === "dark" ? "dark" : "paper";
    document.documentElement.setAttribute("data-theme", t);
  }, [dataset?.theme]);

  // When dataset changes, refresh deck list.
  useEffect(() => {
    if (!datasetId) return;
    (async () => {
      const allDecks = await db.decks.where("datasetId").equals(datasetId).sortBy("createdAt");
      setDecks(allDecks);
      const first = allDecks[0]?.id ?? "";
      if (!deckId || !allDecks.some((d) => d.id === deckId)) {
        setDeckId(first);
      }
      localStorage.setItem("sentencepaths_currentDataset", datasetId);
    })().catch((e) => console.error(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId]);

  useEffect(() => {
    if (deckId) localStorage.setItem("sentencepaths_currentDeck", deckId);
  }, [deckId]);

  // ---- Queries ----
  async function refreshCounts() {
    if (!datasetId || !deckId) return;

    const pp = await db.pathProgress.get([datasetId, deckId]);
    if (pp) setPathProg(pp);

    const stats = await ensureDatasetStats(datasetId);
    setUniqueWords(stats.uniqueWordsSeen ?? 0);

    const count = await db.sentences.where("[datasetId+deckId]").equals([datasetId, deckId]).count();
    setSentenceCount(count);

    const now = Date.now();
    const due = await db.srs.where("[datasetId+deckId+dueAt]").between([datasetId, deckId, 0], [datasetId, deckId, now], true, true).count();
    setDueCount(due);

    // Import batches (used for "Delete import" in the Library)
    const imps = await db.imports
      .where("[datasetId+deckId+createdAt]")
      .between([datasetId, deckId, 0], [datasetId, deckId, Number.MAX_SAFE_INTEGER])
      .toArray();
    imps.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    setImportBatches(imps);
  }

  async function pickCurrent() {
    if (!datasetId || !deckId) return;
    const pp = (await db.pathProgress.get([datasetId, deckId])) ?? null;
    if (!pp) {
      setRow(null);
      setSrsRow(null);
      return;
    }

    if (pp.mode === "linear") {
      const current =
        (await db.sentences
          .where("[datasetId+deckId+order]")
          .equals([datasetId, deckId, pp.linearOrder])
          .first()) ?? null;
      if (current) {
        setRow(current);
        setSrsRow(null);
        return;
      }

      // Fallback: if the pointer is out of bounds or orders are sparse, clamp to the nearest existing row.
      const ordered = db.sentences
        .where("[datasetId+deckId+order]")
        .between([datasetId, deckId, 0], [datasetId, deckId, Number.MAX_SAFE_INTEGER], true, true);
      const first = (await ordered.first()) ?? null;
      const last = (await ordered.last()) ?? null;
      const chosen = last && pp.linearOrder > (last.order ?? 0) ? last : first;
      if (chosen) {
        const fixed: PathProgressRow = { ...pp, linearOrder: chosen.order ?? 0, updatedAt: Date.now() };
        await db.pathProgress.put(fixed);
        setPathProg(fixed);
        setRow(chosen);
      } else {
        setRow(null);
      }
      setSrsRow(null);
      return;
    }

    // SRS: due first, else new.
    const now = Date.now();
    const due =
      (await db.srs
        .where("[datasetId+deckId+dueAt]")
        .between([datasetId, deckId, 0], [datasetId, deckId, now], true, true)
        .sortBy("dueAt")) ?? [];

    if (due.length) {
      const s = due[0] as SRSRow;
      const sentence = (await db.sentences.get(s.sentenceId)) ?? null;
      setRow(sentence);
      setSrsRow(s);
      return;
    }

    const fresh =
      (await db.sentences
        .where("[datasetId+deckId+order]")
        .equals([datasetId, deckId, pp.srsNewOrder])
        .first()) ?? null;

    if (!fresh) {
      setRow(null);
      setSrsRow(null);
      return;
    }

    // Ensure SRS row exists for this sentence.
    const key: [string, string, string] = [datasetId, deckId, fresh.id];
    const existing = (await db.srs.get(key)) ?? null;
    const seeded: SRSRow =
      existing ??
      ({
        datasetId,
        deckId,
        sentenceId: fresh.id,
        dueAt: now,
        reps: 0,
        ease: 2.2,
        intervalDays: 0,
        lastReviewedAt: 0,
        createdAt: now
      } as any);

    if (!existing) await db.srs.put(seeded as any);
    setRow(fresh);
    setSrsRow(seeded);
  }

  // Refresh whenever selection or mode changes.
  useEffect(() => {
    if (!datasetId || !deckId) return;
    refreshCounts().catch(() => null);
    pickCurrent().catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, deckId]);

  useEffect(() => {
    if (!pathProg) return;
    pickCurrent().catch(() => null);
    refreshCounts().catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathProg?.mode, pathProg?.linearOrder, pathProg?.srsNewOrder]);

  // ---- Actions ----
  async function ensureTokenCountForRow(r: SentenceRow): Promise<number> {
    if (!dataset) return r.tokenCount ?? 0;

    // Small safety net for legacy rows that may still have old field names.
    const any = r as any;
    const legacyTarget = (any.target ?? any.Target ?? any.answer ?? any.response) as string | undefined;
    const legacySource = (any.english ?? any.English ?? any.source ?? any.prompt) as string | undefined;

    const targetText = (r.targetText || legacyTarget || "").trim();
    const sourceText = (r.sourceText || legacySource || "").trim();

    const computed = countTokens(targetText, dataset.cjkMode);
    const needsPatch =
      (targetText && r.targetText !== targetText) ||
      (sourceText && r.sourceText !== sourceText) ||
      (typeof r.tokenCount !== "number" || r.tokenCount !== computed);

    if (!needsPatch) return r.tokenCount ?? computed;

    const patched: SentenceRow = {
      ...(r as any),
      targetText,
      sourceText,
      tokenCount: computed
    };

    await db.sentences.put(patched);
    if (row?.id === patched.id) setRow(patched);
    return patched.tokenCount ?? computed;
  }

  async function trackWordsFromRow(r: SentenceRow) {
    if (!dataset) return;
    const any = r as any;
    const text = (r.targetText || any.target || any.Target || "").toString();
    const tokens = tokenizeText(text, dataset.cjkMode);
    if (!tokens.length) return;

    const added = await recordTokensSeen(dataset.id, tokens);
    if (added > 0) {
      const stats = await ensureDatasetStats(dataset.id);
      setUniqueWords(stats.uniqueWordsSeen ?? 0);
    }
  }

  async function bumpLinear(delta: number, countRep: boolean) {
    if (!datasetId || !deckId || !pathProg) return;

    const leaving = row;
    const leavingTokens = countRep && leaving ? await ensureTokenCountForRow(leaving) : 0;

    const currentOrder = pathProg.linearOrder;
    const nextOrder = Math.max(0, currentOrder + delta);

    const next =
      (await db.sentences
        .where("[datasetId+deckId+order]")
        .equals([datasetId, deckId, nextOrder])
        .first()) ?? null;

    if (!next) {
      showToast("End of path");
      return;
    }

    const nextProg: PathProgressRow = {
      ...pathProg,
      linearOrder: nextOrder,
      srsNewOrder: Math.max(pathProg.srsNewOrder, nextOrder),
      lifetimeReps: pathProg.lifetimeReps + (countRep ? 1 : 0),
      lifetimeTokens: pathProg.lifetimeTokens + (countRep ? leavingTokens : 0),
      updatedAt: Date.now()
    };

    await db.pathProgress.put(nextProg);
    setPathProg(nextProg);
    setRow(next);
    setSrsRow(null);

    if (countRep && leaving) {
      await trackWordsFromRow(leaving);
      await refreshCounts();
    }
  }

  async function rateSRS(rating: "again" | "hard" | "good" | "easy") {
    if (!datasetId || !deckId || !pathProg || !row) return;

    const rowTokens = await ensureTokenCountForRow(row);

    const now = Date.now();
    const currentSRS = srsRow;

    // Ensure we have a row in the SRS table.
    const key: [string, string, string] = [datasetId, deckId, row.id];
    const base: SRSRow =
      currentSRS ??
      ({
        datasetId,
        deckId,
        sentenceId: row.id,
        dueAt: now,
        reps: 0,
        ease: 2.2,
        intervalDays: 0,
        lastReviewedAt: 0,
        createdAt: now
      } as any);

    const nextState = scheduleSRS({ reps: base.reps, intervalDays: base.intervalDays, ease: base.ease }, rating);
    const dueAt = now + nextState.intervalDays * 24 * 60 * 60 * 1000;

    const nextSRS: SRSRow = {
      ...base,
      reps: nextState.reps,
      intervalDays: nextState.intervalDays,
      ease: nextState.ease,
      dueAt,
      lastReviewedAt: now
    } as any;

    await db.srs.put(nextSRS as any);

    const countRep = true;
    const nextProg: PathProgressRow = {
      ...pathProg,
      lifetimeReps: pathProg.lifetimeReps + (countRep ? 1 : 0),
      lifetimeTokens: pathProg.lifetimeTokens + (countRep ? rowTokens : 0),
      // If this was a "new" card (not due), move the new pointer forward.
      srsNewOrder: currentSRS ? pathProg.srsNewOrder : pathProg.srsNewOrder + 1,
      updatedAt: now
    };

    await db.pathProgress.put(nextProg);
    setPathProg(nextProg);

    await trackWordsFromRow(row);
    await refreshCounts();
    await pickCurrent();
  }

  async function toggleMode(mode: Mode) {
    if (!datasetId || !deckId || !pathProg) return;
    const next: PathProgressRow = { ...pathProg, mode, updatedAt: Date.now() };
    await db.pathProgress.put(next);
    setPathProg(next);
    if (mode === "srs") setAutoRun(false); // keep review human-paced
  }

  async function playCurrent() {
    if (!dataset || !row) return;
    if (!tts.supported) {
      showToast("Text-to-speech isn't available in this browser");
      return;
    }
    if (tts.isIOS && !tts.unlocked) {
      tts.prime();
      showToast("Tap again to play audio");
      return;
    }

    const target = row.targetText || "";
    const source = row.sourceText || "";

    // English first (optional), then target.
    if (ttsEnglish && source.trim()) {
      await tts.speakAsync(source, { lang: "en-US", rate: 1, pitch: 1 });
    }

    await tts.speakAsync(target, {
      lang: dataset.languageTag || "und",
      rate: dataset.ttsRate ?? 1,
      pitch: dataset.ttsPitch ?? 1,
      voiceURI: dataset.preferredVoiceURI
    });
  }

  // ---- Keyboard shortcuts (Practice) ----
  useEffect(() => {
    if (view !== "practice") return;

    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = (el.tagName || "").toLowerCase();
      return tag === "input" || tag === "textarea" || tag === "select" || (el as any).isContentEditable;
    };

    const closeAnyModal = () => {
      setShowShortcuts(false);
      setShowHelp(false);
      setShowSettings(false);
      setShowNewLanguage(false);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (isTyping(e.target)) return;

      const key = e.key;
      const k = key.toLowerCase();

      const modalOpen = showShortcuts || showHelp || showSettings || showNewLanguage;
      if (modalOpen) {
        if (key === "Escape") {
          e.preventDefault();
          closeAnyModal();
        }
        return;
      }

      // Global-ish (within practice)
      if (key === "?") {
        e.preventDefault();
        setShowShortcuts((v) => !v);
        return;
      }
      if (k === "h") {
        e.preventDefault();
        setShowHelp(true);
        return;
      }
      if (k === "s") {
        e.preventDefault();
        setShowSettings(true);
        return;
      }
      if (k === "l") {
        e.preventDefault();
        goToLibrary();
        return;
      }
      if (key === "Escape") {
        e.preventDefault();
        setView("home");
        return;
      }

      if (!pathProg) return;

      // Mode toggle
      if (k === "m") {
        e.preventDefault();
        void toggleMode(pathProg.mode === "srs" ? "linear" : "srs");
        return;
      }

      // Always-available play key
      if (k === "p") {
        e.preventDefault();
        void playCurrent();
        return;
      }

      // Linear mode shortcuts
      if (pathProg.mode === "linear") {
        // Space: play (manual) OR pause/resume (auto)
        if (e.code === "Space" || key === " ") {
          e.preventDefault();
          if (autoRun) {
            setAutoPaused((v) => !v);
          } else {
            void playCurrent();
          }
          return;
        }

        if (k === "a") {
          e.preventDefault();
          setAutoRun((v) => {
            const nv = !v;
            if (nv) setAutoPaused(false);
            return nv;
          });
          return;
        }

        if (k === "e") {
          e.preventDefault();
          setShowSource((v) => !v);
          return;
        }
        if (k === "t") {
          e.preventDefault();
          setShowTranslit((v) => !v);
          return;
        }
        if (k === "g") {
          e.preventDefault();
          setShowGloss((v) => !v);
          return;
        }

        if (k === "c") {
          e.preventDefault();
          if (row?.targetText) navigator.clipboard.writeText(row.targetText).then(() => showToast("Copied"));
          return;
        }

        // Arrow keys => navigate (count reps in both directions)
        if (key === "ArrowRight") {
          e.preventDefault();
          if (autoRun) setAutoPaused(true);
          void bumpLinear(1, true);
          return;
        }
        if (key === "ArrowLeft") {
          e.preventDefault();
          if (autoRun) setAutoPaused(true);
          void bumpLinear(-1, true);
          return;
        }

        return;
      }

      // SRS shortcuts
      if (pathProg.mode === "srs") {
        if (key === "1") {
          e.preventDefault();
          void rateSRS("again");
          return;
        }
        if (key === "2") {
          e.preventDefault();
          void rateSRS("hard");
          return;
        }
        if (key === "3") {
          e.preventDefault();
          void rateSRS("good");
          return;
        }
        if (key === "4") {
          e.preventDefault();
          void rateSRS("easy");
          return;
        }
      }
    };

    window.addEventListener("keydown", onKeyDown, { passive: false });
    return () => window.removeEventListener("keydown", onKeyDown as any);
  }, [
    view,
    showShortcuts,
    showHelp,
    showSettings,
    showNewLanguage,
    pathProg,
    autoRun,
    row?.targetText,
    playCurrent,
    bumpLinear,
    toggleMode,
    rateSRS
  ]);

  // ---- Auto-run (linear only) ----
  const autoRunToken = useRef(0);
  useEffect(() => {
    if (!autoRun) return;
    if (autoPaused) return;
    if (view !== "practice") return;
    if (!pathProg || pathProg.mode !== "linear") return;
    if (!row) return;

    const token = ++autoRunToken.current;

    (async () => {
      // Small delay to avoid fighting state updates.
      await sleep(120);
      if (autoRunToken.current !== token) return;

      await playCurrent();
      if (autoRunToken.current !== token) return;

      if (autoAfter === "delay") {
        await sleep(autoDelaySec * 1000);
      }

      if (autoRunToken.current !== token) return;
      await bumpLinear(1, true);
    })();

    return () => {
      // stop loop
      autoRunToken.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, autoPaused, view, pathProg?.mode, row?.id, autoAfter, autoDelaySec]);

  const reps = pathProg?.lifetimeReps ?? 0;
  const wordsRead = pathProg?.lifetimeTokens ?? 0;

  const languageName = dataset?.name ?? "";

  const rowHasTranslit = !!row?.transliterationText?.trim();
  const rowHasGloss = !!row?.glossText?.trim();

  const headerModeLabel = pathProg?.mode === "srs" ? "Review" : "Read";

  return (
    <div className="container">
      <header className="topbar">
        <div className="brandRow">
          <div className="logoDot" aria-hidden="true" />
          <div>
            <div className="brandTitle">Sentence Paths</div>
            <div className="brandSub">Bilingual sentences • local-first • TTS</div>
          </div>
        </div>

        <div className="topbarCenter">
          <button className="pill strong" onClick={goToLibrary} title="Library & import">
            {languageName ? `${languageName} · Library` : "Library & Import"}
          </button>
          <span className="pill">{headerModeLabel}</span>
        </div>

        <div className="topbarRight">
          <span className="statChip" title="Total repetitions">Reps&nbsp;<strong>{reps}</strong></span>
          <span className="statChip" title="Total target tokens read">Words&nbsp;read&nbsp;<strong>{wordsRead}</strong></span>
          <button className="iconBtn" onClick={() => setShowHelp(true)} title="Help / setup">
            ?
          </button>
          <button className="iconBtn" onClick={() => setShowSettings(true)} title="Settings">
            ⚙
          </button>
        </div>
      </header>

      {pwaNeedRefresh ? (
        <div className="updateBanner" role="status">
          <div style={{ flex: 1 }}>
            <strong>Update available.</strong> Refresh to load the latest version (your local data stays intact).
          </div>
          <button className="btn btn-small" onClick={() => void refreshAppFilesKeepData()}>
            Refresh
          </button>
          <button className="btn btn-small" onClick={() => setPwaNeedRefresh(false)} aria-label="Dismiss">
            Later
          </button>
        </div>
      ) : null}

      {view === "home" ? (
        <div style={{ marginTop: 20 }}>
          <div className="panel" style={{ padding: 20 }}>
            <div style={{ fontWeight: 900, fontSize: 22, letterSpacing: 0.2 }}>Start a session</div>
            <div style={{ color: "var(--muted)", marginTop: 6, lineHeight: 1.5 }}>
              Read sentences like a book, or review them with spaced repetition.
            </div>

            <div className="segmented" style={{ marginTop: 16 }}>
              <button
                className={"segBtn " + (pathProg?.mode !== "srs" ? "active" : "")}
                onClick={() => toggleMode("linear")}
              >
                Read
              </button>
              <button
                className={"segBtn " + (pathProg?.mode === "srs" ? "active" : "")}
                onClick={() => toggleMode("srs")}
              >
                Review
              </button>
            </div>

            <div className="row" style={{ marginTop: 18, gap: 12, flexWrap: "wrap" }}>
              {sentenceCount === 0 ? (
                <button
                  className="btn primary heroBtn"
                  onClick={() => {
                    setForceImportTips(true);
                    goToLibrary();
                  }}
                >
                  Add sentences
                </button>
              ) : (
                <button className="btn primary heroBtn" onClick={() => setView("practice")}>
                  Start practice
                </button>
              )}

              <button className="btn" onClick={() => setShowNewLanguage(true)}>
                Add language
              </button>

              <button
                className="btn"
                onClick={() => {
                  setForceImportTips(false);
                  goToLibrary();
                }}
              >
                Library & Import
              </button>
            </div>

            <div style={{ marginTop: 14, color: "var(--muted)", fontSize: 13 }}>
              Current library: <strong>{sentenceCount}</strong> sentences • Due: <strong>{dueCount}</strong>
            </div>
          </div>

          <div className="panel" style={{ padding: 16, marginTop: 12 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ minWidth: 240 }}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>Interlinear Studio</div>
                <div style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.5, marginTop: 6 }}>
                  Generate or clean an import sheet (XLSX / CSV / TSV) in the exact format Sentence Paths expects.
                </div>
              </div>

              <a
                className="btn primary"
                href={INTERLINEAR_STUDIO_URL}
                target="_blank"
                rel="noreferrer"
                style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
              >
                Open Interlinear Studio
              </a>
            </div>
          </div>
        </div>
      ) : null}

      {view === "practice" ? (
        <div style={{ marginTop: 6 }}>
          <SentenceCard
            row={row}
            showSource={showSource}
            showTranslit={showTranslit}
            showGloss={showGloss}
            rtl={rtl}
            fontScale={fontScale}
            languageName={dataset?.name}
          />

          <div className="actionBar" style={{ marginTop: 14 }}>
            {pathProg?.mode === "srs" ? (
              <>
                <button className="btn" onClick={() => setView("home")}>Home</button>
                <button className="btn" onClick={playCurrent}>Play</button>
                <button className="btn" onClick={() => rateSRS("again")}>Again</button>
                <button className="btn" onClick={() => rateSRS("hard")}>Hard</button>
                <button className="btn primary" onClick={() => rateSRS("good")}>Good</button>
                <button className="btn" onClick={() => rateSRS("easy")}>Easy</button>
              </>
            ) : (
              <>
                <button className="btn" onClick={() => setView("home")}>Home</button>
                <button className="btn" onClick={() => bumpLinear(-1, true)}>
                  Prev
                </button>
                <button className="btn primary" onClick={playCurrent}>
                  Play
                </button>
                <button className="btn" onClick={() => bumpLinear(1, true)}>
                  Next
                </button>
                <button
                  className={"btn " + (autoRun ? "primary" : "")}
                  title={autoRun ? (autoPaused ? "Auto mode is paused. Press Space to resume." : "Auto mode is on. Press Space to pause.") : "Turn on auto mode"}
                  onClick={() => {
                    setAutoRun((v) => {
                      const nv = !v;
                      if (nv) setAutoPaused(false);
                      return nv;
                    });
                  }}
                >
                  {autoRun ? (autoPaused ? "Auto (paused)" : "Auto") : "Auto"}
                </button>
              </>
            )}
          </div>

          <div className="miniRow" style={{ marginTop: 12 }}>
            <button className="chip" onClick={() => setShowSource((v) => !v)}>
              {showSource ? "Hide English" : "Show English"}
            </button>
            {(showTranslit || rowHasTranslit) ? (
              <button className="chip" onClick={() => setShowTranslit((v) => !v)}>
                {showTranslit ? "Hide translit" : "Show translit"}
              </button>
            ) : null}
            {(showGloss || rowHasGloss) ? (
              <button className="chip" onClick={() => setShowGloss((v) => !v)}>
                {showGloss ? "Hide gloss" : "Show gloss"}
              </button>
            ) : null}
            <button
              className="chip"
              onClick={() => {
                if (!row?.targetText) return;
                navigator.clipboard.writeText(row.targetText).then(() => showToast("Copied"));
              }}
            >
              Copy target
            </button>

            <button className="chip" onClick={() => setShowShortcuts(true)} title="Keyboard shortcuts ( ? )">
              Shortcuts
            </button>
          </div>
        </div>
      ) : null}

      {view === "library" ? (
        <div style={{ marginTop: 18 }}>
          <div className="panel" style={{ padding: 18 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 18 }}>Library & Import</div>
                <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
                  Import sentences, add languages, and manage backups.
                </div>
              </div>
              <div className="row" style={{ gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button className="btn" onClick={() => setShowNewLanguage(true)}>
                  New language
                </button>
                <button className="btn" onClick={() => { setForceImportTips(false); backFromLibrary(); }}>
                  Back
                </button>
              </div>
            </div>

            <div className="row" style={{ marginTop: 12, gap: 10, flexWrap: "wrap" }}>
              <div style={{ width: "100%" }}>
                <div className="sectionLabel">Step one — Choose language and path</div>
                <div className="sectionHint">Imports go into the selected path.</div>
              </div>

              <select className="btn" value={datasetId} onChange={(e) => setDatasetId(e.target.value)} style={{ minWidth: 220 }}>
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>

              <select
                className="btn"
                value={deckId}
                onChange={(e) => setDeckId(e.target.value)}
                style={{ minWidth: 220 }}
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
                  if (!dataset) return;
                  const name = prompt("New path name (for this language):", "Main");
                  if (!name) return;
                  const nd = await createDeck(dataset.id, name);
                  await ensurePathProgress(dataset.id, nd.id);
                  const nextDecks = await db.decks.where("datasetId").equals(dataset.id).sortBy("createdAt");
                  setDecks(nextDecks);
                  setDeckId(nd.id);
                }}
              >
                New path
              </button>
            </div>

            {dataset && deck ? (
              <div style={{ marginTop: 14 }}>
                <div className="sectionLabel">Step two — Import sentences</div>
                <div className="sectionHint">Upload a CSV / TSV / XLSX with at least English and Target.</div>

              <ImportPanel
                dataset={dataset}
                deck={deck}
                decks={decks}
                onSelectDeck={setDeckId}
                onCreateDeck={() => {}}
                showPickers={false}
                forceShowTips={forceImportTips}
                onImported={async () => {
                  await refreshCounts();
                  await pickCurrent();
                  setForceImportTips(false);
                  showToast("Imported");
                }}
                onToast={showToast}
              />
              </div>
            ) : null}

            {datasetId && deckId ? (
              <div className="panel" style={{ padding: 14, marginTop: 12 }}>
                <div className="sectionLabel">Step three — Manage imports (optional)</div>
                <div className="sectionHint">
                  Delete a past import from this path, or undo the most recent one. (Your data is local-first.)
                </div>

                <div className="row" style={{ marginTop: 10, gap: 10, flexWrap: "wrap" }}>
                  <button
                    className="btn"
                    disabled={importBatches.length === 0}
                    onClick={async () => {
                      const latest = importBatches[0];
                      if (!latest) return;
                      const ok = confirm(`Undo last import: ${latest.fileName || "Import"}?`);
                      if (!ok) return;
                      await deleteImportBatch(datasetId, deckId, latest.id);
                      await refreshCounts();
                      await pickCurrent();
                      showToast("Last import removed");
                    }}
                  >
                    Undo last import
                  </button>

                  <button className="btn" onClick={() => setShowImportManager((v) => !v)}>
                    {showImportManager ? "Hide import list" : "Show import list"}
                  </button>

                  <button
                    className="btn"
                    onClick={async () => {
                      const ok = confirm("Clear this entire path? (Keeps other paths and languages.)");
                      if (!ok) return;
                      await clearPathData(datasetId, deckId);
                      await refreshCounts();
                      await pickCurrent();
                      showToast("Path cleared");
                    }}
                  >
                    Clear this path
                  </button>
                </div>

                {showImportManager ? (
                  <div style={{ marginTop: 10 }}>
                    {importBatches.length === 0 ? (
                      <div style={{ color: "var(--muted)", fontSize: 13 }}>No imports yet for this path.</div>
                    ) : (
                      <div className="list">
                        {importBatches.slice(0, 20).map((imp) => (
                          <div key={imp.id} className="listRow" style={{ alignItems: "center" }}>
                            <div style={{ flex: 1, minWidth: 220 }}>
                              <div style={{ fontWeight: 800 }}>{imp.fileName || "Import"}</div>
                              <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>
                                {imp.rowCount} rows • {new Date(imp.createdAt).toLocaleString()}
                              </div>
                            </div>
                            <button
                              className="btn btn-small"
                              onClick={async () => {
                                const ok = confirm(`Delete this import: ${imp.fileName || "Import"}?`);
                                if (!ok) return;
                                await deleteImportBatch(datasetId, deckId, imp.id);
                                await refreshCounts();
                                await pickCurrent();
                                showToast("Import deleted");
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="panel" style={{ padding: 14, marginTop: 12 }}>
              <div className="sectionLabel">Step four — Backup (recommended)</div>
              <div className="sectionHint">Sentence Paths is local-first. Back up your library before switching devices or clearing browser data.</div>

              <div className="row" style={{ marginTop: 10, gap: 10, flexWrap: "wrap" }}>
                <button
                  className="btn"
                  onClick={async () => {
                    const { exportAllToJSON } = await import("./data/backup");
                    const json = await exportAllToJSON();
                    downloadText("sentencepaths_backup.json", json, "application/json");
                    showToast("Backup downloaded");
                  }}
                >
                  Download backup
                </button>
                <button
                  className="btn"
                  onClick={async () => {
                    const inp = document.createElement("input");
                    inp.type = "file";
                    inp.accept = ".json,application/json";
                    inp.onchange = async () => {
                      const f = inp.files?.[0];
                      if (!f) return;
                      const txt = await f.text();
                      const { importAllFromJSON } = await import("./data/backup");
                      await importAllFromJSON(txt);
                      await loadAll();
                      await refreshCounts();
                      await pickCurrent();
                      showToast("Restored");
                    };
                    inp.click();
                  }}
                >
                  Restore backup
                </button>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <button className="btn btn-small" onClick={() => setShowAdvancedLanguages((v) => !v)}>
              {showAdvancedLanguages ? "Hide advanced tools" : "Advanced tools"}
            </button>
          </div>

          {showAdvancedLanguages ? (
            <LanguageManager
              languages={datasets}
              currentLanguageId={datasetId}
              onAddLanguage={async (name, tag) => {
                await createLanguage(name, tag);
              }}
              onRenameLanguage={async (id, newName) => {
                const d = await db.datasets.get(id);
                if (!d) return;
                await db.datasets.put({ ...d, name: newName });
                const all = await db.datasets.orderBy("createdAt").toArray();
                setDatasets(all);
                showToast("Renamed");
              }}
              onDeleteLanguage={async (id, reassignToId) => {
                if (id === reassignToId) return;
                const sents = await db.sentences.where("datasetId").equals(id).toArray();
                const reassigned = sents.map((s) => ({ ...s, datasetId: reassignToId }));
                await db.transaction("rw", [db.sentences, db.datasets], async () => {
                  if (reassigned.length) await db.sentences.bulkPut(reassigned);
                  await db.datasets.delete(id);
                });
                const all = await db.datasets.orderBy("createdAt").toArray();
                setDatasets(all);
                if (datasetId === id) setDatasetId(reassignToId);
                showToast("Deleted");
              }}
            />
          ) : null}
        </div>
      ) : null}

      <Modal open={showNewLanguage} title="New language" onClose={() => setShowNewLanguage(false)}>
        <div className="helpStack">
          <div style={{ color: "var(--muted)", lineHeight: 1.5 }}>
            Add a language, then import a sheet of sentences. Minimum columns: <strong>English</strong> and <strong>Target</strong>.
          </div>

          <div className="panel" style={{ padding: 14 }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Language name</div>
            <input
              className="btn"
              value={newLanguageName}
              onChange={(e) => setNewLanguageName(e.target.value)}
              placeholder="e.g., French"
              style={{ width: "100%" }}
            />

            <div style={{ fontWeight: 800, marginTop: 12, marginBottom: 8 }}>Language tag (optional)</div>
            <input
              className="btn"
              value={newLanguageTag}
              onChange={(e) => setNewLanguageTag(e.target.value)}
              placeholder="e.g., fr-FR"
              style={{ width: "100%" }}
            />

            <div className="row" style={{ justifyContent: "flex-end", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
              <button className="btn" onClick={() => setShowNewLanguage(false)}>
                Cancel
              </button>
              <button
                className="btn primary"
                onClick={async () => {
                  const nm = newLanguageName.trim();
                  if (!nm) {
                    showToast("Please enter a language name");
                    return;
                  }
                  await createLanguage(nm, newLanguageTag.trim());
                  setNewLanguageName("");
                  setNewLanguageTag("");
                  setShowNewLanguage(false);
                }}
              >
                Create
              </button>
            </div>
          </div>


        <div className="panel" style={{ padding: 14, marginTop: 12 }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Troubleshooting</div>
          <div style={{ color: "var(--muted)", lineHeight: 1.5 }}>
            If you see database errors (IndexedDB), resetting local data usually fixes it. Export a backup first if you need it.
          </div>
          <div style={{ marginTop: 10 }}>
            <button
              className="btn"
              onClick={async () => {
                if (!confirm("Reset local data on this device? This deletes all languages and progress stored in the browser.")) return;
                try {
                  await db.delete();
                  // Clear a few UI prefs so first-run feels clean.
                  localStorage.removeItem("sentencepaths_currentDataset");
                  localStorage.removeItem("sentencepaths_currentDeck");
                  location.reload();
                } catch (e: any) {
                  showToast(e?.message || "Reset failed.");
                }
              }}
            >
              Reset local data
            </button>
          </div>
        </div>
        </div>
      </Modal>

      <Modal open={showHelp} title="Help & setup" onClose={() => setShowHelp(false)}>
        <div className="helpStack">
          <div>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>The flow</div>
            <ol style={{ margin: 0, paddingLeft: 18, color: "var(--muted)" }}>
              <li>If a language is empty, press <strong>Add sentences</strong>.</li>
              <li>Press <strong>Start practice</strong>.</li>
              <li>Choose <strong>Read</strong> for "book mode" or <strong>Review</strong> for spaced repetition.</li>
              <li>Use <strong>Library</strong> to add languages, import, and back up.</li>
            </ol>
          </div>

          <div className="panel" style={{ padding: 14 }}>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Generate your import sheet</div>
            <div style={{ color: "var(--muted)", lineHeight: 1.5 }}>
              Use <strong>Interlinear Studio</strong> to generate or clean a sheet in the exact two / three / four-column format Sentence Paths imports.
            </div>
            <div style={{ marginTop: 10 }}>
              <a
                className="btn primary"
                href={INTERLINEAR_STUDIO_URL}
                target="_blank"
                rel="noreferrer"
                style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
              >
                Open Interlinear Studio
              </a>
            </div>
          </div>

          <div className="panel" style={{ padding: 14 }}>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Backup reminder</div>
            <div style={{ color: "var(--muted)", lineHeight: 1.5 }}>
              Sentence Paths is local-first. Back up your library regularly: <strong>Library → Backup</strong>.
            </div>
          </div>

          <div>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Install as an app</div>
            <InstallCard />
          </div>
        </div>
      </Modal>

      <Modal open={showShortcuts} title="Keyboard shortcuts" onClose={() => setShowShortcuts(false)}>
        <div className="helpStack">
          <div style={{ color: "var(--muted)", lineHeight: 1.5 }}>
            Tips: shortcuts work when you are not typing in a field. Press <strong>Esc</strong> to return Home, or close this window.
          </div>

          <div className="panel" style={{ padding: 14 }}>
            <div style={{ fontWeight: 900, marginBottom: 8 }}>Global</div>
            <div className="shortcutGrid">
              <div className="k">?</div><div>Toggle shortcuts</div>
              <div className="k">H</div><div>Open help</div>
              <div className="k">S</div><div>Open settings</div>
              <div className="k">L</div><div>Open library & import</div>
              <div className="k">Esc</div><div>Home</div>
            </div>
          </div>

          <div className="panel" style={{ padding: 14 }}>
            <div style={{ fontWeight: 900, marginBottom: 8 }}>Practice (Read mode)</div>
            <div className="shortcutGrid">
              <div className="k">Space</div><div>{"Play audio (or pause/resume auto)"}</div>
              <div className="k">P</div><div>Play audio</div>
              <div className="k">←</div><div>Previous sentence</div>
              <div className="k">→</div><div>Next sentence</div>
              <div className="k">A</div><div>Toggle auto mode</div>
              <div className="k">E</div><div>Show/hide English</div>
              <div className="k">T</div><div>Show/hide transliteration</div>
              <div className="k">G</div><div>Show/hide gloss</div>
              <div className="k">C</div><div>Copy target text</div>
              <div className="k">M</div><div>Toggle Read / Review</div>
            </div>
          </div>

          <div className="panel" style={{ padding: 14 }}>
            <div style={{ fontWeight: 900, marginBottom: 8 }}>Practice (Review mode)</div>
            <div className="shortcutGrid">
              <div className="k">P</div><div>Play audio</div>
              <div className="k">1</div><div>Again</div>
              <div className="k">2</div><div>Hard</div>
              <div className="k">3</div><div>Good</div>
              <div className="k">4</div><div>Easy</div>
              <div className="k">M</div><div>Toggle Read / Review</div>
            </div>
          </div>
        </div>
      </Modal>

      <Modal open={showSettings} title="Settings" onClose={() => setShowSettings(false)}>
        {dataset ? (
          <SettingsDrawer
            dataset={dataset}
            onUpdate={async (patch) => {
              const next = { ...dataset, ...patch };
              await db.datasets.put(next);
              const all = await db.datasets.orderBy("createdAt").toArray();
              setDatasets(all);
              showToast("Saved");
            }}
            voices={tts.voices}
            onTestVoice={() => {
              if (!dataset) return;
              tts.prime();
              tts.speak("Voice test.", {
                lang: dataset.languageTag || "und",
                rate: dataset.ttsRate ?? 1,
                pitch: dataset.ttsPitch ?? 1,
                voiceURI: dataset.preferredVoiceURI
              });
            }}
          />
        ) : null}

        {tts.isIOS && !tts.unlocked ? (
          <div className="panel" style={{ padding: 14, marginTop: 12 }}>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Unlock TTS on iOS</div>
            <div style={{ color: "var(--muted)", lineHeight: 1.5 }}>
              iOS requires a user tap before speech can play. Tap the button once, then use <strong>Play</strong>.
            </div>
            <div style={{ marginTop: 10 }}>
              <button
                className="btn primary"
                onClick={() => {
                  tts.prime();
                  showToast("TTS unlocked");
                }}
              >
                Unlock
              </button>
            </div>
          </div>
        ) : null}

        <div className="panel" style={{ padding: 14, marginTop: 12 }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Auto settings</div>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <button className={"btn " + (ttsEnglish ? "primary" : "")} onClick={() => setTTSEnglish((v) => !v)}>
              {ttsEnglish ? "English TTS: on" : "English TTS: off"}
            </button>
            <button className={"btn " + (autoAfter === "audio" ? "primary" : "")} onClick={() => setAutoAfter("audio")}>
              Auto after audio
            </button>
            <button className={"btn " + (autoAfter === "delay" ? "primary" : "")} onClick={() => setAutoAfter("delay")}>
              Auto after delay
            </button>
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <span style={{ color: "var(--muted)", fontSize: 13 }}>Delay</span>
              <input
                className="btn"
                type="number"
                step={0.5}
                min={0}
                max={10}
                value={autoDelaySec}
                onChange={(e) => setAutoDelaySec(clamp(parseFloat(e.target.value || "0"), 0, 10))}
                style={{ width: 92 }}
              />
              <span style={{ color: "var(--muted)", fontSize: 13 }}>sec</span>
            </div>
          </div>
        </div>
      

        <div className="panel" style={{ padding: 14, marginTop: 12 }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Troubleshooting</div>
          <div style={{ color: "var(--muted)", lineHeight: 1.5 }}>
            If the app looks stuck on an older version, use <strong>Refresh app files</strong> (keeps your local library).
            If you ever see a browser IndexedDB error (for example, <strong>"transaction has finished"</strong>), a <strong>Reset</strong> usually fixes it.
          </div>
          <div className="row" style={{ marginTop: 10, gap: 10, flexWrap: "wrap" }}>
            <button
              className="btn"
              onClick={() => void refreshAppFilesKeepData()}
              title="Clears PWA caches and reloads (keeps your language data)"
            >
              Refresh app files (keep data)
            </button>

            <button
              className="btn"
              onClick={async () => {
                const ok = confirm(`Reset local Sentence Paths data on this device?

This will delete your local library (languages, paths, progress).
Back up first if you need it.`);
                if (!ok) return;
                try {
                  await db.delete();
                } catch {
                  // ignore
                }
                location.reload();
              }}
              title="Deletes local IndexedDB data and reloads"
            >
              Reset local data
            </button>
          </div>
        </div>
      </Modal>

      {toast ? <div className="toast">{toast.msg}</div> : null}

      <footer style={{ marginTop: 30, color: "var(--muted)", fontSize: 12, textAlign: "center" }}>
        {uniqueWords ? <span>Unique target words seen: {uniqueWords}</span> : null}
      </footer>
    </div>
  );
}
