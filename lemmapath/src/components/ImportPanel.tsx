import { useMemo, useState } from "react";
import type { Language } from "../data/db";
import { importCSVorTSVToLanguage, importXLSXToLanguage, listSheetNames, type ImportMapping } from "../data/importers";

function extOf(name: string) {
  const parts = name.toLowerCase().split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

type Props = {
  language: Language;
  languages: Language[];
  onImported: () => void;
  onLanguageChange: (langId: string) => void;
};

export function ImportPanel(props: Props) {
  const { language, languages, onImported, onLanguageChange } = props;

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [sheet, setSheet] = useState<string>("");
  const [targetLanguageId, setTargetLanguageId] = useState(language.id);

  // Update target when current language changes
  useMemo(() => {
    setTargetLanguageId(language.id);
  }, [language.id]);

  // Get target language object
  const targetLanguage = languages.find(l => l.id === targetLanguageId) || language;

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

  const handleImport = async (file: File) => {
    setBusy(true);
    setProgress(0);

    try {
      const ext = extOf(file.name);
      if (ext === "csv" || ext === "tsv") {
        const text = await file.text();
        await importCSVorTSVToLanguage({
          languageId: targetLanguageId,
          language: targetLanguage,
          text,
          delimiter: ext === "tsv" ? "\t" : ",",
          mapping,
          hasHeader: true,
          onProgress: setProgress
        });
        // If imported to current language, refresh
        if (targetLanguageId === language.id) {
          onImported();
        } else {
          // Switch to the language we imported to
          onLanguageChange(targetLanguageId);
        }
      } else if (ext === "xlsx") {
        const buf = await file.arrayBuffer();
        const sheets = listSheetNames(buf);
        setSheetNames(sheets);
        const chosen = sheet || sheets[0];
        setSheet(chosen);

        await importXLSXToLanguage({
          languageId: targetLanguageId,
          language: targetLanguage,
          arrayBuffer: buf,
          sheetName: chosen,
          mapping,
          onProgress: setProgress
        });
        if (targetLanguageId === language.id) {
          onImported();
        } else {
          onLanguageChange(targetLanguageId);
        }
      } else {
        alert("Unsupported file type.");
      }
    } catch (err: any) {
      alert(err?.message ?? "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 16 }}>
      {/* Language destination selector */}
      <div className="row" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ color: "var(--muted)", fontSize: 14 }}>Import into:</span>
        <select
          className="btn"
          value={targetLanguageId}
          onChange={(e) => setTargetLanguageId(e.target.value)}
          style={{ minHeight: 44, minWidth: 150 }}
        >
          {languages.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      </div>

      <div style={{
        background: "rgba(0,0,0,0.03)",
        padding: "8px 12px",
        borderRadius: 8,
        marginBottom: 12,
        fontSize: 14
      }}>
        Rows will be added to <strong>{targetLanguage.name}</strong>.
      </div>

      <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 12 }}>
        <div style={{ marginBottom: 4 }}>
          <strong>Required:</strong> <span className="kbd">English</span> + <span className="kbd">Target</span>
        </div>
        <div>
          <strong>Optional:</strong> <span className="kbd">Transliteration</span> + <span className="kbd">Gloss</span> (word-by-word)
        </div>
        <div style={{ marginTop: 6, fontSize: 12 }}>
          Headers are detected case-insensitively.
        </div>
      </div>

      <input
        type="file"
        accept=".xlsx,.csv,.tsv,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleImport(f);
        }}
        style={{ width: "100%", maxWidth: "100%" }}
      />

      {sheetNames.length > 1 && (
        <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
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
