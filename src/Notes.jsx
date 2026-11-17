import { useEffect, useState } from "react";
import { supabase } from "./supabase.js";

const when = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const KINDS = { general: "Note", tasting: "Tasting", end: "Closing note" };

/** Notes on a batch: add any time (tasting notes weeks later included). */
export default function Notes({ batch, refreshKey }) {
  const [notes, setNotes] = useState([]);
  const [kind, setKind] = useState(batch.ended_at ? "tasting" : "general");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = () =>
    supabase
      .from("batch_notes")
      .select("*")
      .eq("batch_id", batch.id)
      .order("created_at", { ascending: true })
      .then(({ data, error }) => (error ? setError(error.message) : setNotes(data || [])));

  useEffect(() => {
    load();
    setKind(batch.ended_at ? "tasting" : "general");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch.id, batch.ended_at, refreshKey]);

  async function add(e) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    const { error } = await supabase.from("batch_notes").insert({ batch_id: batch.id, kind, body: body.trim() });
    setBusy(false);
    if (error) return setError(error.message);
    setBody("");
    load();
  }

  async function remove(id) {
    const { error } = await supabase.from("batch_notes").delete().eq("id", id);
    if (error) return setError(error.message);
    load();
  }

  return (
    <section className="card">
      <h2>Notes</h2>
      {error && <p className="error small">{error}</p>}
      {notes.length === 0 && <p className="muted small">No notes yet.</p>}
      <ul className="notes">
        {notes.map((nt) => (
          <li key={nt.id} className={`note note-${nt.kind}`}>
            <div className="note-head small">
              <span className="note-kind">{KINDS[nt.kind] || "Note"}</span>
              <span className="muted">{when.format(new Date(nt.created_at))}</span>
              <DeleteLink onConfirm={() => remove(nt.id)} />
            </div>
            <p className="note-body">{nt.body}</p>
          </li>
        ))}
      </ul>
      <form className="note-form" onSubmit={add}>
        <div className="note-kinds" role="radiogroup" aria-label="Note type">
          {["general", "tasting"].map((k) => (
            <button
              type="button"
              key={k}
              role="radio"
              aria-checked={kind === k}
              className={kind === k ? "chip chip-on" : "chip"}
              onClick={() => setKind(k)}
            >
              {KINDS[k]}
            </button>
          ))}
        </div>
        <textarea
          rows={3}
          value={body}
          maxLength={5000}
          onChange={(e) => setBody(e.target.value)}
          placeholder={kind === "tasting" ? "Appearance, aroma, flavour, mouthfeel…" : "Dry hopped, gravity sample, anything worth remembering…"}
          aria-label="Note"
        />
        <button type="submit" className="primary" disabled={busy || !body.trim()}>
          {busy ? "Saving…" : "Add note"}
        </button>
      </form>
    </section>
  );
}

function DeleteLink({ onConfirm }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button type="button" className="link note-del" onClick={() => (armed ? onConfirm() : setArmed(true))}>
      {armed ? "Tap to delete" : "Delete"}
    </button>
  );
}
