import type { Language } from "../data/db";

export function SettingsDrawer(props: {
  language: Language;
  onUpdate: (patch: Partial<Language>) => void;
  voices: SpeechSynthesisVoice[];
}) {
  const lang = props.language;

  return (
    <div className="panel" style={{ padding: 16, marginTop: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>Settings</div>

      <div className="row">
        <span className="pill">Theme</span>
        <select className="btn" value={lang.theme} onChange={(e) => props.onUpdate({ theme: e.target.value as any })}>
          <option value="paper">Paper</option>
          <option value="desk">Desk</option>
          <option value="dark">Dark desk</option>
        </select>

        <span className="pill">Direction</span>
        <select className="btn" value={lang.rtlMode} onChange={(e) => props.onUpdate({ rtlMode: e.target.value as any })}>
          <option value="auto">Auto</option>
          <option value="ltr">LTR</option>
          <option value="rtl">RTL</option>
        </select>
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <span className="pill">Rate</span>
        <input
          type="range"
          min="0.6"
          max="1.4"
          step="0.05"
          value={lang.ttsRate}
          onChange={(e) => props.onUpdate({ ttsRate: Number(e.target.value) })}
          style={{ width: 220 }}
        />
        <span className="pill">Pitch</span>
        <input
          type="range"
          min="0.6"
          max="1.4"
          step="0.05"
          value={lang.ttsPitch}
          onChange={(e) => props.onUpdate({ ttsPitch: Number(e.target.value) })}
          style={{ width: 220 }}
        />
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <span className="pill">Voice</span>
        <select
          className="btn"
          value={lang.preferredVoiceURI ?? ""}
          onChange={(e) => props.onUpdate({ preferredVoiceURI: e.target.value || undefined })}
          style={{ minWidth: 320 }}
        >
          <option value="">Auto</option>
          {props.voices.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name} — {v.lang}
            </option>
          ))}
        </select>

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
