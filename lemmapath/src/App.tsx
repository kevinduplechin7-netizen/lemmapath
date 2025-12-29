import { useEffect, useMemo, useRef, useState } from "react";
import { db, ensureDefaultDataset, type Dataset, type ProgressRow, type SentenceRow } from "./data/db";
import { InstallCard } from "./components/InstallCard";
import { ImportPanel } from "./components/ImportPanel";
import { PracticeCard } from "./components/PracticeCard";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { exportAllToJSON, importAllFromJSON } from "./data/backup";
import { useTTS } from "./hooks/useTTS";

function autoRTL(text: string) {
  return /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/.test(text);
}

export default function App() {
  const { voices, unlocked, prime, speak, isIOS } = useTTS();

  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [progress, setProgress] = useState<ProgressRow | null>(null);
  const [count, setCount] = useState(0);
  const [row, setRow] = useState<SentenceRow | null>(null);

  const [showSource, setShowSource] = useState(true);
  const [showTranslit, setShowTranslit] = useState(false);
  const [showGloss, setShowGloss] = useState(false);
  const [fontScale, setFontScale] = useState(1);
  const [showSettings, setShowSettings] = useState(false);

  const loadingRef = useRef(false);

  useEffect(() => {
    (async () => {
      const ds = await ensureDefaultDataset();
      setDataset(ds);
    })();
  }, []);

  useEffect(() => {
    if (!dataset) return;
    document.documentElement.setAttribute("data-theme", dataset.theme);
  }, [dataset]);

  async function refresh() {
    if (!dataset) return;
    const c = await db.sentences.where("datasetId").equals(dataset.id).count();
    setCount(c);

    const p = await db.progress.get(dataset.id);
    setProgress(p ?? null);

    if (!p || c === 0) {
      setRow(null);
      return;
    }

    const idx = Math.min(Math.max(0, p.currentIndex), Math.max(0, c - 1));
    const r = await db.sentences.where("datasetId").equals(dataset.id).offset(idx).first();
    setRow(r ?? null);
  }

  useEffect(() => {
    if (!dataset) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset]);

  const rtl = useMemo(() => {
    if (!row) return false;
    if (!dataset) return false;
    if (dataset.rtlMode === "rtl") return true;
    if (dataset.rtlMode === "ltr") return false;
    return autoRTL(row.targetText);
  }, [dataset, row]);

  useEffect(() => {
    if (!dataset || !row) return;
    speak(row.targetText, {
      lang: dataset.languageTag,
      rate: dataset.ttsRate,
      pitch: dataset.ttsPitch,
      voiceURI: dataset.preferredVoiceURI
    });
  }, [dataset, row, speak]);

  async function bump(delta: number, countRep: boolean) {
    if (!dataset || !progress) return;
    if (loadingRef.current) return;
    loadingRef.current = true;

    try {
      const nextIndexRaw = progress.currentIndex + delta;
      const nextIndex = Math.max(0, Math.min(nextIndexRaw, Math.max(0, count - 1)));

      const next = await db.sentences.where("datasetId").equals(dataset.id).offset(nextIndex).first();
      if (!next) return;

      const newProg: ProgressRow = {
        ...progress,
        currentIndex: nextIndex,
        updatedAt: Date.now(),
        lifetimeReps: countRep ? progress.lifetimeReps + 1 : progress.lifetimeReps,
        lifetimeTokens: countRep ? progress.lifetimeTokens + next.tokenCount : progress.lifetimeTokens
      };

      await db.progress.put(newProg);
      setProgress(newProg);
      setRow(next);
    } finally {
      loadingRef.current = false;
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || (e.target as any)?.isContentEditable) return;

      if (e.code === "Space") {
        e.preventDefault();
        if (e.shiftKey) bump(-1, false);
        else bump(1, true);
      }
      if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        if (dataset && row) {
          speak(row.targetText, {
            lang: dataset.languageTag,
            rate: dataset.ttsRate,
            pitch: dataset.ttsPitch,
            voiceURI: dataset.preferredVoiceURI
          });
        }
      }
      if (e.key.toLowerCase() === "g") setShowGloss((v) => !v);
      if (e.key.toLowerCase() === "t") setShowTranslit((v) => !v);
      if (e.key.toLowerCase() === "e") setShowSource((v) => !v);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dataset, row, progress, count]);

  if (!dataset) return <div className="container">Loading…</div>;

  const pct = progress ? Math.min(1, progress.lifetimeTokens / dataset.goalTokens) : 0;

  return (
    <div className="container">
      <div className="header">
        <div className="brand">
          <strong>LemmaPath</strong>
          <span>Quiet utility sentence repetition • local-first</span>
        </div>

        <div className="row">
          <button className="btn" onClick={() => setShowSettings((v) => !v)}>
            Settings
          </button>
          <button className="btn" onClick={() => setFontScale((v) => Math.min(1.5, v + 0.05))}>A+</button>
          <button className="btn" onClick={() => setFontScale((v) => Math.max(0.85, v - 0.05))}>A-</button>
        </div>
      </div>

      <InstallCard />

      <div className="panel" style={{ padding: 16, marginTop: 12 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="row">
            <span className="pill">Reps: <strong>{progress?.lifetimeReps ?? 0}</strong></span>
            <span className="pill">Tokens: <strong>{progress?.lifetimeTokens ?? 0}</strong></span>
            <span className="pill">Sentences: <strong>{count}</strong></span>
          </div>

          <div className="row">
            <div className="progressOuter" aria-label="Progress">
              <div className="progressInner" style={{ width: `${Math.round(pct * 100)}%` }} />
            </div>
            <span className="pill">{Math.round(pct * 100)}%</span>
          </div>
        </div>

        <div style={{ marginTop: 10, color: "var(--muted)", fontSize: 13 }}>
          Keyboard: <span className="kbd">Space</span> next • <span className="kbd">Shift</span>+<span className="kbd">Space</span> prev • <span className="kbd">R</span> replay • <span className="kbd">E</span> source • <span className="kbd">T</span> translit • <span className="kbd">G</span> gloss
        </div>
      </div>

      {isIOS && !unlocked && (
        <div className="panel" style={{ padding: 16, marginTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Enable audio</div>
          <div style={{ color: "var(--muted)", fontSize: 14, marginBottom: 12 }}>
            iOS requires a tap before speech can autoplay. Tap once to unlock text-to-speech.
          </div>
          <button className="btn primary" onClick={prime}>Enable audio</button>
        </div>
      )}

      <PracticeCard
        row={row}
        showSource={showSource}
        showTranslit={showTranslit}
        showGloss={showGloss}
        rtl={rtl}
        fontScale={fontScale}
        onCopyTarget={async () => {
          if (!row) return;
          await navigator.clipboard.writeText(row.targetText);
        }}
        onCopyBoth={async () => {
          if (!row) return;
          await navigator.clipboard.writeText(`${row.sourceText}\n${row.targetText}`);
        }}
      />

      <div className="bottomBar">
        <button className="btn" onClick={() => bump(-1, false)}>Prev</button>
        <button
          className="btn"
          onClick={() => {
            if (!dataset || !row) return;
            speak(row.targetText, {
              lang: dataset.languageTag,
              rate: dataset.ttsRate,
              pitch: dataset.ttsPitch,
              voiceURI: dataset.preferredVoiceURI
            });
          }}
        >
          Replay
        </button>
        <button className="btn primary" onClick={() => bump(1, true)}>Next</button>
      </div>

      <ImportPanel dataset={dataset} onImported={refresh} />

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
            <div className="row">
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
                    const ds = await ensureDefaultDataset();
                    setDataset(ds);
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
