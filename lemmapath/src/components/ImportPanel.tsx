import { useMemo, useState } from "react";
import type { Dataset } from "../data/db";
import { importCSVorTSV, importXLSX, listSheetNames, type ImportMapping } from "../data/importers";

function extOf(name: string) {
  const parts = name.toLowerCase().split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

export function ImportPanel(props: { dataset: Dataset; onImported: () => void }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [sheet, setSheet] = useState<string>("");

  // MVP default mapping: expects headers "English" and "Target"
  const mapping: ImportMapping = useMemo(
    () => ({
      sourceKey: "English",
      targetKey: "Target",
      translitKey: "Transliteration",
      glossKey: "Gloss",
      tokenKey: "TokenCount",
      idKey: "Id"
    }),
    []
  );

  return (
    <div className="panel" style={{ padding: 16, marginTop: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Import (xlsx, csv, tsv)</div>
      <div style={{ color: "var(--muted)", fontSize: 14, marginBottom: 12 }}>
        MVP expects headers like <span className="kbd">English</span> and <span className="kbd">Target</span>. We can add a full column-mapping UI next.
      </div>

      <input
        type="file"
        accept=".xlsx,.csv,.tsv,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;

          setBusy(true);
          setProgress(0);

          try {
            const ext = extOf(f.name);
            if (ext === "csv" || ext === "tsv") {
              const text = await f.text();
              await importCSVorTSV({
                dataset: props.dataset,
                text,
                delimiter: ext === "tsv" ? "\t" : ",",
                mapping,
                hasHeader: true,
                onProgress: setProgress
              });
              props.onImported();
            } else if (ext === "xlsx") {
              const buf = await f.arrayBuffer();
              const sheets = listSheetNames(buf);
              setSheetNames(sheets);
              const chosen = sheet || sheets[0];
              setSheet(chosen);

              await importXLSX({
                dataset: props.dataset,
                arrayBuffer: buf,
                sheetName: chosen,
                mapping,
                onProgress: setProgress
              });
              props.onImported();
            } else {
              alert("Unsupported file type.");
            }
          } catch (err: any) {
            alert(err?.message ?? "Import failed.");
          } finally {
            setBusy(false);
          }
        }}
      />

      {sheetNames.length > 1 && (
        <div className="row" style={{ marginTop: 10 }}>
          <span className="pill">Sheet</span>
          <select
            className="btn"
            value={sheet}
            onChange={(e) => setSheet(e.target.value)}
            style={{ minHeight: 44 }}
          >
            {sheetNames.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>
            If you change the sheet, re-import the file.
          </span>
        </div>
      )}

      {busy && (
        <div style={{ marginTop: 12 }}>
          <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 6 }}>
            Importing… {Math.round(progress * 100)}%
          </div>
          <div className="progressOuter" style={{ width: "100%" }}>
            <div className="progressInner" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}
