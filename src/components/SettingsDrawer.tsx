import type { Dataset } from "../data/db";

export function SettingsDrawer(props: {
  dataset: Dataset;
  onUpdate: (patch: Partial<Dataset>) => void;
  voices: SpeechSynthesisVoice[];
  onTestVoice?: () => void;
}) {
  const lang = props.dataset;

  const tag = (lang.languageTag || "und").toLowerCase();
  const tagPrefix = tag === "und" ? "" : tag.split("-")[0];
  const matching = tagPrefix ? props.voices.filter((v) => (v.lang || "").toLowerCase().startsWith(tagPrefix)) : props.voices;
  const voiceList = matching.length ? matching : props.voices;

  return (
    <div className="panel" style={{ padding: 16, marginTop: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>Settings</div>

      <div className="row">
        <span className="pill">Theme</span>
        <select className="btn" value={lang.theme === "dark" ? "dark" : "paper"} onChange={(e) => props.onUpdate({ theme: e.target.value as any })}>
          <option value="paper">Light (glossy)</option>
          <option value="dark">Dark</option>
        </select>

        <span className="pill">Direction</span>
        <select className="btn" value={lang.rtlMode} onChange={(e) => props.onUpdate({ rtlMode: e.target.value as any })}>
          <option value="auto">Auto</option>
          <option value="ltr">LTR</option>
          <option value="rtl">RTL</option>
        </select>
      </div>

      <div style={{ marginTop: 8, color: "var(--muted)", fontSize: 13, lineHeight: 1.45 }}>
        TTS uses your browser&rsquo;s built-in voices. Voices for <strong>{lang.languageTag || "und"}</strong>: {matching.length}. If you see zero, install a system voice for that language or try another browser/device.
      </div>

      <div className="row" style={{ marginTop: 10, alignItems: "center" }}>
        <span className="pill">Rate</span>
        <input
          type="range"
          min="0.6"
          max="1.4"
          step="0.05"
          value={lang.ttsRate}
          onChange={(e) => props.onUpdate({ ttsRate: Number(e.target.value) })}
          style={{ flex: 1, minWidth: 160 }}
        />
        <span className="pill">Pitch</span>
        <input
          type="range"
          min="0.6"
          max="1.4"
          step="0.05"
          value={lang.ttsPitch}
          onChange={(e) => props.onUpdate({ ttsPitch: Number(e.target.value) })}
          style={{ flex: 1, minWidth: 160 }}
        />
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <span className="pill">Voice</span>
        <select
          className="btn"
          value={lang.preferredVoiceURI ?? ""}
          onChange={(e) => props.onUpdate({ preferredVoiceURI: e.target.value || undefined })}
          style={{ minWidth: 0, flex: 1 }}
        >
          <option value="">Auto</option>
          {voiceList.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name} — {v.lang}
            </option>
          ))}
        </select>

        <button className="btn" type="button" onClick={props.onTestVoice} disabled={!props.onTestVoice} title="Play a short test">Test</button>

        <label className="row" style={{ gap: 8 }}>
          <input
            type="checkbox"
            checked={lang.cjkMode}
            onChange={(e) => props.onUpdate({ cjkMode: e.target.checked })}
          />
          <span style={{ color: "var(--muted)", fontSize: 14 }}>CJK token approximation</span>
        </label>
      </div>
    </div>
  );
}
