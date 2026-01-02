import { useEffect, useMemo, useRef, useState } from "react";
import {
  db,
  ensureDefaultLanguage,
  listLanguages,
  createLanguage,
  updateLanguage,
  deleteLanguage,
  renameLanguage,
  getSelectedLanguageId,
  setSelectedLanguageId,
  getLanguageProgressFromStorage,
  saveLanguageProgress,
  type Language,
  type LanguageProgressRow,
  type SentenceRow
} from "./data/db";
import { InstallCard } from "./components/InstallCard";
import { ImportPanel } from "./components/ImportPanel";
import { PracticeCard } from "./components/PracticeCard";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { LanguageManager } from "./components/LanguageManager";
import { exportAllToJSON, importAllFromJSON } from "./data/backup";
import { useTTS } from "./hooks/useTTS";

function autoRTL(text: string) {
  return /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/.test(text);
}

export default function App() {
  const { voices, unlocked, prime, speak, isIOS } = useTTS();

  const [language, setLanguage] = useState<Language | null>(null);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [progress, setProgress] = useState<LanguageProgressRow | null>(null);
  const [count, setCount] = useState(0);
  const [row, setRow] = useState<SentenceRow | null>(null);

  const [showSource, setShowSource] = useState(true);
  const [showTranslit, setShowTranslit] = useState(false);
  const [showGloss, setShowGloss] = useState(false);
  const [fontScale, setFontScale] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [spotlightTrigger, setSpotlightTrigger] = useState(0);

  const loadingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load languages list
  async function loadLanguages() {
    const langs = await listLanguages();
    setLanguages(langs);
    return langs;
  }

  // Initialize: load or create default language
  useEffect(() => {
    (async () => {
      await ensureDefaultLanguage();
      const langs = await loadLanguages();

      let selectedId = getSelectedLanguageId();
      if (selectedId) {
        const found = langs.find(l => l.id === selectedId);
        if (!found && langs.length > 0) {
          selectedId = langs[0].id;
          setSelectedLanguageId(selectedId);
        }
      } else if (langs.length > 0) {
        selectedId = langs[0].id;
        setSelectedLanguageId(selectedId);
      }

      if (selectedId) {
        const lang = langs.find(l => l.id === selectedId);
        if (lang) setLanguage(lang);
      }
    })();
  }, []);

  // Apply theme when language changes
  useEffect(() => {
    if (!language) return;
    document.documentElement.setAttribute("data-theme", language.theme);
  }, [language]);

  // Refresh sentence count and progress when language changes
  async function refresh() {
    if (!language) return;

    const c = await db.sentences.where("languageId").equals(language.id).count();
    setCount(c);

    const p = getLanguageProgressFromStorage(language.id);
    setProgress(p);

    if (c === 0) {
      setRow(null);
      return;
    }

    const idx = Math.min(Math.max(0, p.currentIndex), Math.max(0, c - 1));
    const r = await db.sentences.where("languageId").equals(language.id).offset(idx).first();
    setRow(r ?? null);
  }

  useEffect(() => {
    if (!language) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  const rtl = useMemo(() => {
    if (!row) return false;
    if (!language) return false;
    if (language.rtlMode === "rtl") return true;
    if (language.rtlMode === "ltr") return false;
    return autoRTL(row.targetText);
  }, [language, row]);

  // Auto-play TTS when sentence changes
  useEffect(() => {
    if (!language || !row) return;
    speak(row.targetText, {
      lang: language.languageTag,
      rate: language.ttsRate,
      pitch: language.ttsPitch,
      voiceURI: language.preferredVoiceURI
    });
  }, [language, row, speak]);

  // Navigate to next/prev sentence
  async function bump(delta: number, countRep: boolean) {
    if (!language || !progress) return;
    if (loadingRef.current) return;
    loadingRef.current = true;

    try {
      const nextIndexRaw = progress.currentIndex + delta;
      const nextIndex = Math.max(0, Math.min(nextIndexRaw, Math.max(0, count - 1)));

      const next = await db.sentences.where("languageId").equals(language.id).offset(nextIndex).first();
      if (!next) return;

      const newProg: LanguageProgressRow = {
        ...progress,
        currentIndex: nextIndex,
        updatedAt: Date.now(),
        lifetimeReps: countRep ? progress.lifetimeReps + 1 : progress.lifetimeReps,
        lifetimeTokens: countRep ? progress.lifetimeTokens + next.tokenCount : progress.lifetimeTokens
      };

      saveLanguageProgress(newProg);
      setProgress(newProg);
      setRow(next);

      // Trigger spotlight animation when moving forward
      if (countRep) {
        setSpotlightTrigger(prev => prev + 1);
      }
    } finally {
      loadingRef.current = false;
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || (e.target as any)?.isContentEditable) return;

      if (e.code === "Space") {
        e.preventDefault();
        if (e.shiftKey) bump(-1, false);
        else bump(1, true);
      }
      if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        if (language && row) {
          speak(row.targetText, {
            lang: language.languageTag,
            rate: language.ttsRate,
            pitch: language.ttsPitch,
            voiceURI: language.preferredVoiceURI
          });
        }
      }
      if (e.key.toLowerCase() === "g") setShowGloss((v) => !v);
      if (e.key.toLowerCase() === "t") setShowTranslit((v) => !v);
      if (e.key.toLowerCase() === "e") setShowSource((v) => !v);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [language, row, progress, count]);

  // Handle language switch
  async function switchLanguage(langId: string) {
    const lang = languages.find(l => l.id === langId);
    if (lang) {
      setLanguage(lang);
      setSelectedLanguageId(langId);
    }
  }

  // Handle adding a new language
  async function handleAddLanguage(name: string, tag: string) {
    const newLang = await createLanguage({
      name,
      languageTag: tag || "und",
      rtlMode: "auto",
      cjkMode: false,
      theme: "paper",
      goalTokens: 5000000
    });
    await loadLanguages();
    setLanguage(newLang);
    setSelectedLanguageId(newLang.id);
  }

  // Handle renaming a language
  async function handleRenameLanguage(id: string, newName: string) {
    await renameLanguage(id, newName);
    const langs = await loadLanguages();
    if (language?.id === id) {
      const updated = langs.find(l => l.id === id);
      if (updated) setLanguage(updated);
    }
  }

  // Handle deleting a language (with reassignment)
  async function handleDeleteLanguage(id: string, reassignToId: string) {
    // Move sentences to target language
    const sentences = await db.sentences.where("languageId").equals(id).toArray();
    for (const s of sentences) {
      await db.sentences.update(s.id, { languageId: reassignToId });
    }

    // Now delete the language (without sentences since we moved them)
    await db.languages.delete(id);

    const langs = await loadLanguages();

    // If we deleted the current language, switch to target
    if (language?.id === id) {
      const target = langs.find(l => l.id === reassignToId);
      if (target) {
        setLanguage(target);
        setSelectedLanguageId(target.id);
      } else if (langs.length > 0) {
        setLanguage(langs[0]);
        setSelectedLanguageId(langs[0].id);
      }
    }

    await refresh();
  }

  if (!language) return <div className="container">Loading…</div>;

  const pct = progress ? Math.min(1, progress.lifetimeTokens / language.goalTokens) : 0;
  const hasSentences = count > 0;

  return (
    <div className="container">
      {/* Header */}
      <div className="header">
        <div className="brand">
          <strong>LemmaPath</strong>
          <span className="brand-tagline">Quiet mass sentence exposure</span>
        </div>

        {/* Premium toolbar cluster */}
        <div className="toolbar-cluster">
          <select
            className="btn language-select"
            value={language.id}
            onChange={(e) => switchLanguage(e.target.value)}
            title="Select language"
          >
            {languages.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>

          <span className="toolbar-divider" />

          <button className="btn" onClick={() => setShowSettings((v) => !v)}>
            Settings
          </button>

          <span className="toolbar-divider" />

          <button className="btn btn-font" onClick={() => setFontScale((v) => Math.min(1.5, v + 0.05))} title="Increase font size">A+</button>
          <button className="btn btn-font" onClick={() => setFontScale((v) => Math.max(0.85, v - 0.05))} title="Decrease font size">A-</button>
        </div>
      </div>

      <InstallCard />

      {/* Stats strip + shortcuts */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
        <div className="stats-strip">
          <span className="stat-item">Reps <strong>{progress?.lifetimeReps ?? 0}</strong></span>
          <span className="stat-item">Tokens <strong>{progress?.lifetimeTokens ?? 0}</strong></span>
          <span className="stat-item">Sentences <strong>{count}</strong></span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Progress bar */}
          <div className="progressOuter" aria-label="Progress">
            <div className="progressInner" style={{ width: `${Math.round(pct * 100)}%` }} />
          </div>
          <span style={{ fontSize: 13, color: "var(--muted)", minWidth: 36 }}>{Math.round(pct * 100)}%</span>

          {/* Shortcuts button */}
          <div style={{ position: "relative" }}>
            <button
              className="shortcuts-btn"
              onClick={() => setShowShortcuts(v => !v)}
              title="Keyboard shortcuts"
            >
              ?
            </button>
            {showShortcuts && (
              <div
                className="panel"
                style={{
                  position: "absolute",
                  right: 0,
                  top: "calc(100% + 8px)",
                  padding: 14,
                  zIndex: 100,
                  minWidth: 200,
                  fontSize: 13
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 10 }}>Keyboard shortcuts</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div><span className="kbd">Space</span> next</div>
                  <div><span className="kbd">Shift+Space</span> prev</div>
                  <div><span className="kbd">R</span> replay</div>
                  <div><span className="kbd">E</span> toggle source</div>
                  <div><span className="kbd">T</span> toggle translit</div>
                  <div><span className="kbd">G</span> toggle gloss</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick shortcut hint (desktop only) */}
      <div className="keyboard-hints" style={{ marginTop: 8 }}>
        <span className="shortcuts-hint"><span className="kbd">Space</span> next</span>
      </div>

      {/* iOS audio unlock */}
      {isIOS && !unlocked && (
        <div className="panel" style={{ padding: 16, marginTop: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Enable audio</div>
          <div style={{ color: "var(--muted)", fontSize: 14, marginBottom: 12 }}>
            iOS requires a tap before speech can autoplay.
          </div>
          <button className="btn primary" onClick={prime}>Enable audio</button>
        </div>
      )}

      {/* Practice card */}
      <PracticeCard
        row={row}
        showSource={showSource}
        showTranslit={showTranslit}
        showGloss={showGloss}
        rtl={rtl}
        fontScale={fontScale}
        languageName={language.name}
        onCopyTarget={async () => {
          if (!row) return;
          await navigator.clipboard.writeText(row.targetText);
        }}
        onCopyBoth={async () => {
          if (!row) return;
          await navigator.clipboard.writeText(`${row.sourceText}\n${row.targetText}`);
        }}
        onToggleTranslit={() => setShowTranslit(v => !v)}
        onToggleGloss={() => setShowGloss(v => !v)}
        onImportClick={() => setShowImport(true)}
        spotlightTrigger={spotlightTrigger}
      />

      {/* Playback controls - disabled when no sentences */}
      <div className={`bottomBar${!hasSentences ? " disabled" : ""}`}>
        <button className="btn" onClick={() => bump(-1, false)} disabled={!hasSentences}>Prev</button>
        <button
          className="btn"
          disabled={!hasSentences}
          onClick={() => {
            if (!language || !row) return;
            speak(row.targetText, {
              lang: language.languageTag,
              rate: language.ttsRate,
              pitch: language.ttsPitch,
              voiceURI: language.preferredVoiceURI
            });
          }}
        >
          Replay
        </button>
        <button className="btn primary" onClick={() => bump(1, true)} disabled={!hasSentences}>Next</button>
      </div>

      {/* Import Section */}
      <div className="panel collapsible-section" style={{ marginTop: 16 }}>
        <button
          className="collapsible-header"
          onClick={() => setShowImport((v) => !v)}
        >
          <span style={{ fontWeight: 600 }}>Import Data</span>
          <span style={{ color: "var(--muted)" }}>{showImport ? "▼" : "▶"}</span>
        </button>
        {showImport && (
          <ImportPanel
            language={language}
            languages={languages}
            onImported={refresh}
            onLanguageChange={switchLanguage}
          />
        )}
      </div>

      {showSettings && (
        <>
          <SettingsDrawer
            language={language}
            voices={voices}
            onUpdate={async (patch) => {
              const next = { ...language, ...patch };
              await updateLanguage(language.id, patch);
              setLanguage(next);
            }}
          />

          <LanguageManager
            languages={languages}
            currentLanguageId={language.id}
            onAddLanguage={handleAddLanguage}
            onRenameLanguage={handleRenameLanguage}
            onDeleteLanguage={handleDeleteLanguage}
          />

          <div className="panel" style={{ padding: 16, marginTop: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 10 }}>Backup / Restore</div>
            <div className="row" style={{ flexWrap: "wrap" }}>
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
                }}
              >
                Export JSON backup
              </button>

              <label className="btn" style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                Import JSON restore
                <input
                  type="file"
                  accept="application/json"
                  style={{ display: "none" }}
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const txt = await f.text();
                    await importAllFromJSON(txt);
                    const langs = await loadLanguages();
                    const selectedId = getSelectedLanguageId();
                    const lang = langs.find(l => l.id === selectedId) || langs[0];
                    if (lang) {
                      setLanguage(lang);
                      setSelectedLanguageId(lang.id);
                    }
                    await refresh();
                    alert("Restore complete.");
                  }}
                />
              </label>
            </div>

            <div style={{ marginTop: 10, color: "var(--muted)", fontSize: 13 }}>
              Local-first: your data is stored on this device. Use backups to protect against browser storage clearing.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
