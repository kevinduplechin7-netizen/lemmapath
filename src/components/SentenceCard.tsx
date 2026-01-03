import type { CSSProperties } from "react";
import type { SentenceRow } from "../data/db";

export function SentenceCard(props: {
  row: SentenceRow | null;
  showSource: boolean;
  showTranslit: boolean;
  showGloss: boolean;
  rtl: boolean;
  fontScale: number;
  languageName?: string;
}) {
  const { row } = props;
  const dir = props.rtl ? "rtl" : "ltr";

  if (!row) {
    return (
      <div className="panel" style={{ padding: 18, marginTop: 18 }}>
        <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>No sentences yet</div>
        <div style={{ color: "var(--muted)", lineHeight: 1.5 }}>
          Import a spreadsheet with at least two columns: <strong>English</strong> and <strong>Target</strong>.
          <br />
          (Optional: Transliteration, Gloss.)
        </div>
      </div>
    );
  }

  return (
    <div
      className="panel sentenceCard"
      style={{
        padding: 18,
        marginTop: 18,
        // Presentation-only CSS variables so mobile can boost readability without breaking the user's fontScale.
        // (Keeps all state and behavior identical.)
        "--sp-source": `${16 * props.fontScale}px`,
        "--sp-target": `${26 * props.fontScale}px`
      } as CSSProperties}
      dir={dir}
    >
      <div className="sentenceGrid">
        {props.showSource ? (
          <div className="sentenceCol">
            <div className="sentenceSource">
              {row.sourceText || "—"}
            </div>
          </div>
        ) : null}

        <div className="sentenceCol">
          <div className="sentenceTarget">
            {row.targetText || "—"}
          </div>

          {props.showTranslit ? (
            <div className="sentenceMeta">
              <div className="sentenceMetaText">{row.transliterationText || "—"}</div>
            </div>
          ) : null}

          {props.showGloss ? (
            <div className="sentenceMeta">
              <div className="sentenceMetaText" style={{ whiteSpace: "pre-wrap" }}>{row.glossText || "—"}</div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
