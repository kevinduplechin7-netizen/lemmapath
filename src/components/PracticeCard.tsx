import { useMemo, useRef, useEffect, useState } from "react";
import type { SentenceRow } from "../data/db";

export function PracticeCard(props: {
  row: SentenceRow | null;
  showSource: boolean;
  showTranslit: boolean;
  showGloss: boolean;
  rtl: boolean;
  fontScale: number;
  languageName?: string;
  onCopyTarget: () => void;
  onCopySource?: () => void;
  onCopyBoth: () => void;
  onToggleTranslit?: () => void;
  onToggleGloss?: () => void;
  onImportClick?: () => void;
  spotlightTrigger?: number;
}) {
  const { row, languageName } = props;
  const dir = useMemo(() => (props.rtl ? "rtl" : "ltr"), [props.rtl]);
  const [spotlight, setSpotlight] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (moreRef.current && moreRef.current.contains(t)) return;
      setMoreOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
    };
  }, [moreOpen]);

  // Spotlight animation on sentence change
  useEffect(() => {
    if (props.spotlightTrigger === undefined) return;
    setSpotlight(true);
    const t = setTimeout(() => setSpotlight(false), 420);
    return () => clearTimeout(t);
  }, [props.spotlightTrigger]);

  if (!row) {
    return (
      <div className="panel empty-state">
        <svg className="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h7l5 5v11a2 2 0 01-2 2z" />
        </svg>

        <h2 style={{ margin: 0 }}>Import to begin</h2>
        <p style={{ margin: "6px 0 0 0", color: "var(--muted)" }}>
          Required: English, Target. Optional: Transliteration, Gloss (word-by-word).
        </p>

        <button className="dropzone" type="button" onClick={props.onImportClick} disabled={!props.onImportClick}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>Choose file</div>
            <div style={{ color: "var(--muted)", fontSize: 13 }}>CSV, TSV, or XLSX</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span className="pill">Fast import</span>
            <span className="pill">Keeps row order</span>
          </div>
        </button>
      </div>
    );
  }

  const targetTextStyle: React.CSSProperties = {
    fontSize: `${24 * props.fontScale}px`,
    lineHeight: 1.5,
    margin: 0,
    color: "var(--ink)",
    fontWeight: 750
  };

  const sourceTextStyle: React.CSSProperties = {
    fontSize: `${16 * props.fontScale}px`,
    lineHeight: 1.45,
    margin: 0,
    color: "var(--muted)"
  };

  const hasTranslit = !!row.transliterationText;
  const hasGloss = !!row.glossText;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
      {props.showSource && (
        <div className="source-card">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span className="badge badge-muted">Source</span>
            {languageName ? <span style={{ color: "var(--muted)", fontSize: 13 }}>{languageName}</span> : null}
          </div>
          <p style={sourceTextStyle}>{row.sourceText}</p>
        </div>
      )}

      <div className={`target-hero${spotlight ? " spotlight" : ""}`} dir={dir}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <span className="badge">Target</span>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {props.onToggleTranslit && (
              <button className="chip" disabled={!hasTranslit} onClick={props.onToggleTranslit}>
                Transliteration
              </button>
            )}
            {props.onToggleGloss && (
              <button className="chip" disabled={!hasGloss} onClick={props.onToggleGloss}>
                Gloss
              </button>
            )}

            <button className="btn btn-small primary" onClick={props.onCopyTarget}>
              Copy
            </button>

            <div ref={moreRef} style={{ position: "relative" }}>
              <button className="btn btn-small" onClick={() => setMoreOpen((v) => !v)} aria-label="More actions">
                ⋯
              </button>
              {moreOpen && (
                <div
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "calc(100% + 8px)",
                    minWidth: 180,
                    border: "1px solid var(--border)",
                    borderRadius: 14,
                    background: "rgba(255,255,255,0.92)",
                    boxShadow: "var(--shadow)",
                    padding: 8,
                    zIndex: 50
                  }}
                >
                  {props.onCopySource && (
                    <button className="btn" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => { setMoreOpen(false); props.onCopySource?.(); }}>
                      Copy source
                    </button>
                  )}
                  <button className="btn" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => { setMoreOpen(false); props.onCopyBoth(); }}>
                    Copy both
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <p style={{ ...targetTextStyle, marginTop: 10 }}>{row.targetText || <span style={{ color: "var(--muted)" }}>—</span>}</p>

        {props.showTranslit && (
          <div className="subcard">
            <div className="subhead">Transliteration</div>
            <div style={{ color: "var(--ink)" }}>{row.transliterationText || "—"}</div>
          </div>
        )}

        {props.showGloss && (
          <div className="subcard">
            <div className="subhead">Gloss</div>
            <div style={{ color: "var(--ink)", whiteSpace: "pre-wrap" }}>{row.glossText || "—"}</div>
          </div>
        )}

        {/* action buttons are in the fixed bottom action bar */}
      </div>
    </div>
  );
}
