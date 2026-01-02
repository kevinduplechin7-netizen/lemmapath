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
  onCopyBoth: () => void;
  onToggleTranslit?: () => void;
  onToggleGloss?: () => void;
  onImportClick?: () => void;
  spotlightTrigger?: number;
}) {
  const { row, languageName } = props;
  const dir = useMemo(() => (props.rtl ? "rtl" : "ltr"), [props.rtl]);
  const targetRef = useRef<HTMLDivElement>(null);
  const [spotlight, setSpotlight] = useState(false);

  // Handle spotlight animation on sentence change
  useEffect(() => {
    if (props.spotlightTrigger && props.spotlightTrigger > 0 && row) {
      setSpotlight(true);
      const timer = setTimeout(() => setSpotlight(false), 400);
      return () => clearTimeout(timer);
    }
  }, [props.spotlightTrigger, row]);

  // Empty state
  if (!row) {
    return (
      <div className="panel empty-state">
        <svg className="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <h2>Import to begin</h2>
        <p>Required: English, Target. Optional: Transliteration, Gloss (word-by-word).</p>

        <label className="dropzone">
          <input
            type="file"
            accept=".xlsx,.csv,.tsv,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            style={{ display: "none" }}
            onChange={(e) => {
              if (props.onImportClick) {
                props.onImportClick();
              }
            }}
          />
          <button className="btn primary" type="button" onClick={props.onImportClick} style={{ pointerEvents: "auto" }}>
            Choose file
          </button>
          <div className="dropzone-text">CSV, TSV, or XLSX</div>
        </label>
      </div>
    );
  }

  const targetTextStyle: React.CSSProperties = {
    fontSize: `${22 * props.fontScale}px`,
    lineHeight: 1.5,
    margin: 0,
    fontWeight: 600
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
      {/* Source card (secondary) */}
      {props.showSource && (
        <div className="source-card">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span className="badge badge-muted">Source</span>
          </div>
          <p style={sourceTextStyle}>{row.sourceText}</p>
        </div>
      )}

      {/* Target hero card (primary) */}
      <div
        ref={targetRef}
        className={`target-hero${spotlight ? " spotlight" : ""}`}
        dir={dir}
      >
        {/* Header row with badges */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <span className="badge">Target</span>
          {languageName && <span className="badge badge-muted">{languageName}</span>}
        </div>

        {/* Target text */}
        <p style={targetTextStyle}>{row.targetText}</p>

        {/* Transliteration */}
        {props.showTranslit && row.transliterationText && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>Transliteration</div>
            <div style={{ fontSize: `${14 * props.fontScale}px`, color: "var(--muted)" }}>
              {row.transliterationText}
            </div>
          </div>
        )}

        {/* Gloss */}
        {props.showGloss && row.glossText && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>Gloss</div>
            <div style={{ fontSize: `${14 * props.fontScale}px`, color: "var(--muted)" }}>
              {row.glossText}
            </div>
          </div>
        )}

        {/* Bottom controls: copy buttons + toggle chips */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 10,
          marginTop: 16,
          paddingTop: 14,
          borderTop: "1px solid var(--border)"
        }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-small" onClick={props.onCopyTarget}>Copy target</button>
            <button className="btn btn-small" onClick={props.onCopyBoth}>Copy both</button>
          </div>

          {(hasTranslit || hasGloss) && (
            <div style={{ display: "flex", gap: 6 }}>
              {hasTranslit && (
                <button
                  className={`toggle-chip${props.showTranslit ? " active" : ""}`}
                  onClick={props.onToggleTranslit}
                >
                  Translit
                </button>
              )}
              {hasGloss && (
                <button
                  className={`toggle-chip${props.showGloss ? " active" : ""}`}
                  onClick={props.onToggleGloss}
                >
                  Gloss
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
