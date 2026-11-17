import { useEffect, useState } from "react";
import { supabase } from "./supabase.js";
import { describeStep } from "./profile.js";
import { rangeText } from "./YeastPicker.jsx";

const when = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

const n = (v) => (v === null || v === undefined ? null : Number(v));
const f = (v, dp) => (v === null || v === undefined || Number.isNaN(Number(v)) ? "--" : Number(v).toFixed(dp));

function dur(mins) {
  if (mins == null) return "--";
  if (mins < 60) return `${Math.round(mins)} min`;
  const h = Math.floor(mins / 60);
  if (h < 48) return `${h} h ${Math.round(mins % 60)} min`;
  return `${(mins / 1440).toFixed(1)} days`;
}

/** Fermentation report for one batch: gravity results, yeast comparison and temperature control. */
export default function Report({ batch, refreshKey }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    supabase.rpc("batch_report", { p_batch_id: batch.id }).then(({ data, error }) => {
      if (!live) return;
      if (error) setError(error.message);
      else setReport(data);
    });
    return () => {
      live = false;
    };
  }, [batch.id, refreshKey]);

  if (error) return <section className="card"><p className="error small">{error}</p></section>;
  if (!report) return <section className="card"><p className="muted small">Loading report…</p></section>;

  const og = n(report.og);
  const fg = n(report.fg);
  const att = n(report.attenuation);
  const y = report.yeast;
  const yMin = n(y?.min);
  const yMax = n(y?.max);
  let verdict = null;
  if (att !== null && yMin !== null) {
    const hi = yMax ?? yMin;
    if (att < yMin - 2) verdict = { tone: "cold", text: `${(yMin - att).toFixed(0)} points under the yeast's range` };
    else if (att > hi + 2) verdict = { tone: "hot", text: `${(att - hi).toFixed(0)} points over the yeast's range` };
    else verdict = { tone: "ok", text: "within the yeast's range" };
  }

  const c = report.control;
  const pct = (m) => (c && c.mins_tracked ? Math.round((m / c.mins_tracked) * 100) : 0);
  const steps = report.steps || [];
  const profile = Array.isArray(batch.profile) ? batch.profile : [];

  return (
    <>
      <section className="card">
        <h2>
          Report{batch.ended_at ? "" : " so far"} · {date.format(new Date(report.started_at))}
          {report.ended_at ? ` – ${date.format(new Date(report.ended_at))}` : ""}
        </h2>
        <div className="report-grid">
          <Stat label="Duration" value={`${f(report.days, 1)} days`} />
          <Stat label="ABV" value={report.abv != null ? `${f(report.abv, 1)}%` : "--"} />
          <Stat label="OG" value={f(og, 3)} hint={report.og_source} />
          <Stat label="FG" value={f(fg, 3)} hint={report.fg_source} />
          <Stat
            label="Attenuation"
            value={att != null ? `${f(att, 0)}%` : "--"}
            hint={verdict?.text}
            tone={verdict && verdict.tone !== "ok" ? verdict.tone : ""}
          />
          <Stat label="Readings" value={report.readings} />
        </div>
        {y ? (
          <p className="small report-line">
            <strong>Yeast:</strong> {y.name} · expected {rangeText(yMin, yMax, "% attenuation")}
          </p>
        ) : (
          <p className="muted small report-line">No yeast recorded. Add one with Edit batch to compare attenuation.</p>
        )}
      </section>

      <section className="card">
        <h2>Temperature control</h2>
        {!c ? (
          <p className="muted small">
            This batch had no fermentation profile, so there was no target to compare against.
          </p>
        ) : (
          <>
            <div className="control-bar" role="img" aria-label={`On target ${pct(c.mins_on)}%, above ${pct(c.mins_above)}%, below ${pct(c.mins_below)}%`}>
              {c.mins_on > 0 && <span className="seg seg-on" style={{ flexGrow: c.mins_on }} />}
              {c.mins_above > 0 && <span className="seg seg-hot" style={{ flexGrow: c.mins_above }} />}
              {c.mins_below > 0 && <span className="seg seg-cold" style={{ flexGrow: c.mins_below }} />}
            </div>
            <ul className="control-legend small">
              <li>
                <span className="key key-on" /> On target (±{f(report.tolerance, 1)} °C) <strong>{pct(c.mins_on)}%</strong> · {dur(c.mins_on)}
              </li>
              <li>
                <span className="key key-hot" /> ▲ Above <strong>{pct(c.mins_above)}%</strong> · {dur(c.mins_above)}
                {c.max_above > 0 && <> · peak +{f(c.max_above, 1)} °C, {when.format(new Date(c.max_above_at))}</>}
              </li>
              <li>
                <span className="key key-cold" /> ▼ Below <strong>{pct(c.mins_below)}%</strong> · {dur(c.mins_below)}
                {c.max_below < 0 && <> · lowest {f(c.max_below, 1)} °C, {when.format(new Date(c.max_below_at))}</>}
              </li>
            </ul>

            {report.excursions?.length > 0 ? (
              <>
                <h3>Off-target spells (15 min or longer)</h3>
                <ul className="excursions small">
                  {report.excursions.map((e, i) => (
                    <li key={i} className={e.state === "above" ? "exc-hot" : "exc-cold"}>
                      <span>{e.state === "above" ? "▲" : "▼"} {e.state === "above" ? "+" : ""}{f(e.peak, 1)} °C peak</span>
                      <span>{dur(e.minutes)} from {when.format(new Date(e.started))}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="small">No off-target spells longer than 15 minutes. 👍</p>
            )}

            {steps.length > 0 && (
              <>
                <h3>By step</h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Step</th>
                        <th>Target</th>
                        <th>Avg</th>
                        <th>Range</th>
                        <th>Off</th>
                      </tr>
                    </thead>
                    <tbody>
                      {steps.map((s) => {
                        const p = profile[s.step_index];
                        const off = (s.mins_above || 0) + (s.mins_below || 0);
                        return (
                          <tr key={s.step_index}>
                            <td title={p ? describeStep(p, s.step_index === profile.length - 1) : ""}>
                              {s.step_index + 1}
                              {p?.label ? ` ${p.label}` : ""}
                            </td>
                            <td>{f(s.target, 1)}</td>
                            <td>{f(s.avg_temp, 1)}</td>
                            <td>
                              {f(s.min_temp, 1)}–{f(s.max_temp, 1)}
                            </td>
                            <td>{off ? dur(off) : "–"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
        <p className="muted small report-line">
          Beer (Pill) {f(report.temp?.beer_min, 1)}–{f(report.temp?.beer_max, 1)} °C, avg {f(report.temp?.beer_avg, 1)} · Probe{" "}
          {f(report.temp?.probe_min, 1)}–{f(report.temp?.probe_max, 1)} °C, avg {f(report.temp?.probe_avg, 1)}
        </p>
      </section>
    </>
  );
}

function Stat({ label, value, hint, tone }) {
  return (
    <div className={`rstat ${tone ? "tile-" + tone : ""}`}>
      <div className="tile-label">{label}</div>
      <div className="rstat-value">{value}</div>
      {hint && <div className="tile-hint">{hint}</div>}
    </div>
  );
}
