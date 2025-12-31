import { useState } from "react";
import type { Language } from "../data/db";

type Props = {
  languages: Language[];
  currentLanguageId: string;
  onAddLanguage: (name: string, tag: string) => void;
  onRenameLanguage: (id: string, newName: string) => void;
  onDeleteLanguage: (id: string, reassignToId: string) => void;
};

export function LanguageManager(props: Props) {
  const { languages, currentLanguageId, onAddLanguage, onRenameLanguage, onDeleteLanguage } = props;

  const [newName, setNewName] = useState("");
  const [newTag, setNewTag] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reassignToId, setReassignToId] = useState<string>("");

  const handleAdd = () => {
    if (!newName.trim()) return;
    onAddLanguage(newName.trim(), newTag.trim());
    setNewName("");
    setNewTag("");
  };

  const handleRename = (id: string) => {
    if (!editName.trim()) return;
    onRenameLanguage(id, editName.trim());
    setEditingId(null);
    setEditName("");
  };

  const handleDelete = (id: string) => {
    if (!reassignToId) return;
    onDeleteLanguage(id, reassignToId);
    setDeletingId(null);
    setReassignToId("");
  };

  const startEditing = (lang: Language) => {
    setEditingId(lang.id);
    setEditName(lang.name);
  };

  const startDeleting = (lang: Language) => {
    // Set default reassignment target to first language that isn't this one
    const other = languages.find(l => l.id !== lang.id);
    setDeletingId(lang.id);
    setReassignToId(other?.id || "");
  };

  const canDelete = languages.length > 1;

  return (
    <div className="panel" style={{ padding: 16, marginTop: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>Languages</div>

      {/* Language List */}
      <div style={{ marginBottom: 16 }}>
        {languages.map((lang) => (
          <div key={lang.id} className="language-item">
            {editingId === lang.id ? (
              <div className="row" style={{ flex: 1, gap: 8 }}>
                <input
                  type="text"
                  className="btn"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Language name"
                  style={{ flex: 1 }}
                  autoFocus
                />
                <button className="btn primary" onClick={() => handleRename(lang.id)}>Save</button>
                <button className="btn" onClick={() => setEditingId(null)}>Cancel</button>
              </div>
            ) : deletingId === lang.id ? (
              <div style={{ flex: 1 }}>
                <div style={{ color: "var(--muted)", fontSize: 14, marginBottom: 8 }}>
                  Move sentences to:
                </div>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <select
                    className="btn"
                    value={reassignToId}
                    onChange={(e) => setReassignToId(e.target.value)}
                    style={{ flex: 1, minWidth: 150 }}
                  >
                    {languages.filter(l => l.id !== lang.id).map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                  <button
                    className="btn"
                    style={{ color: "#c00" }}
                    onClick={() => handleDelete(lang.id)}
                  >
                    Delete
                  </button>
                  <button className="btn" onClick={() => setDeletingId(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ flex: 1 }}>
                  <span style={{ fontWeight: lang.id === currentLanguageId ? 700 : 400 }}>
                    {lang.name}
                  </span>
                  {lang.languageTag && lang.languageTag !== "und" && (
                    <span style={{ color: "var(--muted)", fontSize: 13, marginLeft: 8 }}>
                      ({lang.languageTag})
                    </span>
                  )}
                  {lang.id === currentLanguageId && (
                    <span className="pill" style={{ marginLeft: 8, padding: "4px 8px", fontSize: 11 }}>
                      current
                    </span>
                  )}
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn btn-small" onClick={() => startEditing(lang)}>
                    Rename
                  </button>
                  {canDelete && (
                    <button
                      className="btn btn-small"
                      onClick={() => startDeleting(lang)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Add New Language */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <div style={{ color: "var(--muted)", fontSize: 14, marginBottom: 8 }}>
          Add new language
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input
            type="text"
            className="btn"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name (e.g. Greek)"
            style={{ flex: 2, minWidth: 120 }}
          />
          <input
            type="text"
            className="btn"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            placeholder="Tag (e.g. el-GR)"
            style={{ flex: 1, minWidth: 80 }}
          />
          <button className="btn primary" onClick={handleAdd} disabled={!newName.trim()}>
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
