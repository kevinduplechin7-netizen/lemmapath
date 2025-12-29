import { useMemo } from "react";
import type { SentenceRow } from "../data/db";

export function PracticeCard(props: {
  row: SentenceRow | null;
  showSource: boolean;
  showTranslit: boolean;
  showGloss: boolean;
  rtl: boolean;
  fontScale: number;
  onCopyTarget: () => void;
  onCopyBoth: () => void;
}) {
  const { row } = props;

  const dir = useMemo(() => (props.rtl ? "rtl" : "ltr"), [props.rtl]);

  if (!row) {
    return (
      <div className="panel" style={{ padding: 18, minHeight: 220 }}>
        <div style={{ color: "var(--muted)" }}>No sentences yet. Import a file to begin.</div>
      </div>
    );
  }

  const textStyle: React.CSSProperties = {
    fontSize: `${18 * props.fontScale}px`,
    lineHeight: 1.45,
    margin: 0
  };

  return (
    <div className="panel" style={{ padding: 18 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <div className="row">
          <button className="btn" onClick={props.onCopyTarget}>Copy target</button>
          <button className="btn" onClick={props.onCopyBoth}>Copy both</button>
        </div>
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        {props.showSource && (
          <div style={{ padding: 14, border: "1px solid var(--border)", borderRadius: 14 }}>
            <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 6 }}>Source</div>
            <p style={textStyle}>{row.sourceText}</p>
          </div>
        )}

        <div style={{ padding: 14, border: "1px solid var(--border)", borderRadius: 14 }} dir={dir}>
          <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 6 }}>Target</div>
          <p style={textStyle}>{row.targetText}</p>

          {props.showTranslit && row.transliterationText && (
            <div style={{ marginTop: 10, color: "var(--muted)", fontSize: 14 }}>
              {row.transliterationText}
            </div>
          )}
          {props.showGloss && row.glossText && (
            <div style={{ marginTop: 10, color: "var(--muted)", fontSize: 14 }}>
              {row.glossText}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
