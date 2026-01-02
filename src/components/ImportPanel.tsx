import { useEffect, useMemo, useRef, useState } from "react";
import type { Dataset, Deck } from "../data/db";
import type { ImportMapping, ImportMode } from "../data/importers";

function extOf(name: string) {
  const parts = name.toLowerCase().split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

type PromptCols = "two" | "threeTranslit" | "threeGloss" | "four";

function colsLabel(c: PromptCols) {
  if (c === "two") return "Two columns";
  if (c === "threeTranslit") return "Three columns (with transliteration)";
  if (c === "threeGloss") return "Three columns (with gloss)";
  return "Four columns";
}

function headersFor(c: PromptCols) {
  if (c === "two") return ["English", "Target"];
  if (c === "threeTranslit") return ["English", "Target", "Transliteration"];
  if (c === "threeGloss") return ["English", "Target", "Gloss"];
  return ["English", "Target", "Transliteration", "Gloss"];
}

function aiPrompt(c: PromptCols) {
  const headers = headersFor(c).join(" | ");
  return `You are preparing a spreadsheet for Sentence Paths.

Return ONLY a table (TSV preferred) with headers:
${headers}

Rules:
- One sentence per row.
- Keep rows in the order you want to practice (easy → hard).
- You MAY name the Target column like: "Target Language (Greek)" — Sentence Paths auto-detects common variants.
- Gloss should be word-by-word (token-level), not a paragraph.
- No extra commentary before or after the table.`;
}

function templateText(c: PromptCols, delimiter: "\t" | ",") {
  const h = headersFor(c);
  const join = (xs: string[]) => xs.join(delimiter);
  // Keep it tiny (header + one example row) so it never overwhelms.
  const example = c === "two"
    ? ["My parents don't know where I am.", "…"]
    : c === "threeTranslit"
      ? ["My parents don't know where I am.", "…", "…"]
      : c === "threeGloss"
        ? ["My parents don't know where I am.", "…", "my parents / do not / know / where / I am"]
        : ["My parents don't know where I am.", "…", "…", "my parents / do not / know / where / I am"];
  return join(h) + "\n" + join(example);
}

type Props = {
  dataset: Dataset;
  deck: Deck;
  decks: Deck[];
  onSelectDeck: (deckId: string) => void;
  onCreateDeck: () => void;
  onImported: () => void | Promise<void>;
  forceShowTips?: boolean;
  showPickers?: boolean;
  fileInputRef?: React.RefObject<HTMLInputElement>;
  onToast?: (msg: string) => void;
};

function usePersistedBool(key: string, defaultValue: boolean) {
  const [v, setV] = useState<boolean>(() => {
    const raw = localStorage.getItem(key);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return defaultValue;
  });

  useEffect(() => {
    localStorage.setItem(key, v ? "1" : "0");
  }, [key, v]);

  return [v, setV] as const;
}

export function ImportPanel(props: Props) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const [mode, setMode] = useState<ImportMode>("append");

  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [sheet, setSheet] = useState<string>("");

  const [showTips, setShowTips] = usePersistedBool("sentencepaths_show_import_tips", false);
  const [promptCols, setPromptCols] = useState<PromptCols>("two");
  const [format, setFormat] = useState<"tsv" | "csv">("tsv");

  const toast = (msg: string) => (props.onToast ? props.onToast(msg) : alert(msg));

  useEffect(() => {
    if (props.forceShowTips) setShowTips(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.forceShowTips]);

  const localFileRef = useRef<HTMLInputElement>(null);
  const fileRef = props.fileInputRef ?? localFileRef;

  // Canonical names — importer will auto-detect common variants.
  const mapping: ImportMapping = useMemo(
    () => ({
      sourceKey: "english",
      targetKey: "target",
      translitKey: "transliteration",
      glossKey: "gloss",
      tokenKey: "tokencount",
      idKey: "id"
    }),
    []
  );

  async function handleFile(file: File) {
    setBusy(true);
    setProgress(0);
    setSheetNames([]);
    setSheet("");

    try {
      const ext = extOf(file.name);

      if (ext === "csv" || ext === "tsv") {
        const text = await file.text();
        const { importCSVorTSV } = await import("../data/importers");
        await importCSVorTSV({
          dataset: props.dataset,
          deckId: props.deck.id,
          filename: file.name,
          text,
          delimiter: ext === "tsv" ? "\t" : ",",
          mapping,
          mode,
          onProgress: (p) => setProgress(p)
        });

        await props.onImported();
        return;
      }

      if (ext === "xlsx") {
        const ab = await file.arrayBuffer();
        const { listSheetNames, importXLSX } = await import("../data/importers");
        const names = await listSheetNames(ab);
        setSheetNames(names);
        const first = names[0] ?? "";
        setSheet(first);

        // If there is only one sheet, import immediately.
        if (names.length === 1 && first) {
          await importXLSX({
            dataset: props.dataset,
            deckId: props.deck.id,
            filename: file.name,
            arrayBuffer: ab,
            sheetName: first,
            mapping,
            mode,
            onProgress: (p) => setProgress(p)
          });
          await props.onImported();
          return;
        }

        // Otherwise, keep the buffer in memory by re-reading when user clicks import.
        (fileRef.current as any)._sentencepaths_last_xlsx = { name: file.name, ab };
        return;
      }

      toast("Unsupported file type. Please import .xlsx, .csv, or .tsv.");
    } catch (e: any) {
      toast(e?.message || String(e));
    } finally {
      setBusy(false);
      setProgress(0);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function importSelectedSheet() {
    try {
      const store = (fileRef.current as any)?._sentencepaths_last_xlsx as { name: string; ab: ArrayBuffer } | undefined;
      if (!store) {
        toast("Please choose an .xlsx file first.");
        return;
      }
      if (!sheet) {
        toast("Please choose a sheet.");
        return;
      }

      setBusy(true);
      setProgress(0);

      const { importXLSX } = await import("../data/importers");
      await importXLSX({
        dataset: props.dataset,
        deckId: props.deck.id,
        filename: store.name,
        arrayBuffer: store.ab,
        sheetName: sheet,
        mapping,
        mode,
        onProgress: (p) => setProgress(p)
      });

      await props.onImported();
      setSheetNames([]);
      setSheet("");
      (fileRef.current as any)._sentencepaths_last_xlsx = undefined;
    } catch (e: any) {
      toast(e?.message || String(e));
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }

  return (
    <div className="panel" style={{ padding: 16, marginTop: 12 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16 }}>Import</div>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>xlsx / csv / tsv • auto-detects columns</div>
        </div>

        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button
            className={"btn " + (mode === "append" ? "primary" : "")}
            onClick={() => setMode("append")}
            disabled={busy}
            title="Append rows to the end of this path"
          >
            Append
          </button>
          <button
            className={"btn " + (mode === "replace" ? "primary" : "")}
            onClick={() => setMode("replace")}
            disabled={busy}
            title="Replace this path entirely"
          >
            Replace
          </button>
        </div>
      </div>

      {props.showPickers !== false && (
        <div className="row" style={{ gap: 10, flexWrap: "wrap", marginTop: 12 }}>
          <span className="pill">Language</span>
          <span className="pill strong">{props.dataset.name}</span>

          <span className="pill">Path</span>
          <select
            className="btn"
            value={props.deck.id}
            onChange={(e) => props.onSelectDeck(e.target.value)}
            style={{ minWidth: 240 }}
            disabled={busy}
          >
            {props.decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>

          <button className="btn" onClick={props.onCreateDeck} disabled={busy} title="Create a new path inside this language">
            New path
          </button>
        </div>
      )}

      {showTips && (
        <div className="panel" style={{ padding: 12, marginTop: 12, background: "rgba(255,255,255,0.45)" }}>
          <div className="row" style={{ justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <div style={{ fontWeight: 700 }}>Templates & AI</div>
            <button className="btn" onClick={() => setShowTips(false)} title="Hide this section">
              Hide
            </button>
          </div>

          <div style={{ color: "var(--muted)", fontSize: 14, marginTop: 8, lineHeight: 1.55 }}>
            Pick your column layout, then either download a tiny template or copy an AI prompt.
            <br />
            Minimum: <strong>English</strong> + <strong>Target</strong>. Optional: <strong>Transliteration</strong> and <strong>Gloss</strong> (word-by-word).
          </div>

          <div className="row" style={{ gap: 10, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
            <span className="pill">Columns</span>
            <select
              className="btn"
              value={promptCols}
              onChange={(e) => setPromptCols(e.target.value as PromptCols)}
              disabled={busy}
              style={{ minWidth: 260 }}
              title="Choose the columns you plan to import"
            >
              <option value="two">{colsLabel("two")}</option>
              <option value="threeTranslit">{colsLabel("threeTranslit")}</option>
              <option value="threeGloss">{colsLabel("threeGloss")}</option>
              <option value="four">{colsLabel("four")}</option>
            </select>
          </div>

          <div className="row" style={{ gap: 10, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
            <span className="pill">Format</span>
            <select
              className="btn"
              value={format}
              onChange={(e) => setFormat(e.target.value as any)}
              disabled={busy}
              style={{ minWidth: 220 }}
              title="TSV is usually best for spreadsheets"
            >
              <option value="tsv">TSV (recommended)</option>
              <option value="csv">CSV</option>
            </select>

            <span className="pill" title="Keep rows in the order you want to practice (easy → hard).">Order preserved</span>
          </div>

          <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <button
              className="btn"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(aiPrompt(promptCols));
                  toast("AI prompt copied.");
                } catch {
                  toast("Copy failed.");
                }
              }}
              disabled={busy}
            >
              Copy AI prompt
            </button>

            <button
              className="btn"
              onClick={() => {
                const delimiter = format === "tsv" ? "\t" : ",";
                const text = templateText(promptCols, delimiter);
                const blob = new Blob([text], { type: "text/plain" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                const fname = `sentencepaths-template-${promptCols}.${format}`;
                a.href = url;
                a.download = fname;
                a.click();
                URL.revokeObjectURL(url);
                toast("Template downloaded.");
              }}
              disabled={busy}
            >
              Download template
            </button>
          </div>

          <div style={{ marginTop: 10, padding: 10, borderRadius: 12, border: "1px solid var(--border)", background: "rgba(255,255,255,0.42)" }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.3, color: "var(--muted)", textTransform: "uppercase" }}>
              Headers
            </div>
            <div style={{ marginTop: 6, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 13 }}>
              {headersFor(promptCols).join("  |  ")}
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.xlsx"
          disabled={busy}
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            void handleFile(f);
          }}
        />

        <button
          className="dropzone"
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          aria-label="Choose import file"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>Choose file</div>
            <div style={{ color: "var(--muted)", fontSize: 13 }}>CSV / TSV / XLSX</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span className="pill">{mode === "append" ? "Append" : "Replace"}</span>
            <span className="pill">Path order preserved</span>
          </div>
        </button>
      </div>

      {sheetNames.length > 0 && (
        <div className="panel" style={{ padding: 12, marginTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Choose a sheet</div>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <select className="btn" value={sheet} onChange={(e) => setSheet(e.target.value)} style={{ minWidth: 260 }}>
              {sheetNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>

            <button className="btn primary" onClick={importSelectedSheet} disabled={busy}>
              Import sheet
            </button>
          </div>
        </div>
      )}

      {busy && (
        <div style={{ marginTop: 12 }}>
          <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 6 }}>Importing… {Math.round(progress * 100)}%</div>
          <div className="progressOuter" style={{ width: "100%" }}>
            <div className="progressInner" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </div>
      )}

      {!showTips && (
        <div style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => setShowTips(true)}>
            Show templates & AI
          </button>
        </div>
      )}
    </div>
  );
}
