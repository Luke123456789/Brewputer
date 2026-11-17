import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase.js";
import { AngleChart, GravityChart, TempChart } from "./Charts.jsx";
import ProfileEditor from "./ProfileEditor.jsx";
import Report from "./Report.jsx";
import Notes from "./Notes.jsx";
import YeastPicker, { rangeText } from "./YeastPicker.jsx";
import { describeStep, validateProfile } from "./profile.js";

const STALE_MINUTES = 20; // the CYD posts every 5 min, so three missed posts = stale

const num = (v) => (v === null || v === undefined ? null : Number(v));
const fmt = (v, dp) => (v === null || v === undefined || Number.isNaN(v) ? "--" : v.toFixed(dp));

function ago(date) {
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs} h ${mins % 60} min ago`;
  return `${Math.floor(hrs / 24)} days ago`;
}

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const whenFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });

function until(date) {
  const mins = Math.round((date.getTime() - Date.now()) / 60000);
  if (mins <= 0) return "due at the next reading";
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  return "in " + (d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`);
}

export default function Dashboard() {
  const [batches, setBatches] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [readings, setReadings] = useState([]);
  const [latest, setLatest] = useState(null);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState(false);
  const [ending, setEnding] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [browsing, setBrowsing] = useState(false); // viewing past batches while no brew is running

  const active = batches.find((b) => !b.ended_at) || null;
  const selected = batches.find((b) => b.id === selectedId) || active || batches[0] || null;

  const loadBatches = useCallback(async () => {
    const { data, error } = await supabase
      .from("batches")
      .select("*")
      .order("started_at", { ascending: false });
    if (error) return setError(error.message);
    setBatches(data);
  }, []);

  const loadReadings = useCallback(async (batchId) => {
    const [{ data: rows, error: e1 }, { data: last, error: e2 }] = await Promise.all([
      batchId
        ? supabase
            .from("readings")
            .select("*")
            .eq("batch_id", batchId)
            .order("recorded_at", { ascending: true })
            .limit(5000)
        : Promise.resolve({ data: [] }),
      supabase.from("readings").select("*").order("recorded_at", { ascending: false }).limit(1),
    ]);
    if (e1 || e2) return setError((e1 || e2).message);
    setReadings(rows || []);
    setLatest(last?.[0] || null);
  }, []);

  const refresh = useCallback(async () => {
    setError("");
    setRefreshKey((k) => k + 1);
    await loadBatches();
  }, [loadBatches]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    loadReadings(selected?.id);
  }, [selected?.id, loadReadings]);

  // Refresh when the app comes back to the foreground, and every 5 minutes while open
  useEffect(() => {
    const again = () => {
      if (document.visibilityState === "visible") {
        refresh();
        loadReadings(selected?.id);
      }
    };
    document.addEventListener("visibilitychange", again);
    const t = setInterval(again, 5 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", again);
      clearInterval(t);
    };
  }, [refresh, loadReadings, selected?.id]);

  const points = useMemo(
    () =>
      readings.map((r) => ({
        t: new Date(r.recorded_at).getTime(),
        gravity: num(r.gravity),
        beer: num(r.beer_temp),
        probe: num(r.probe_temp),
        target: num(r.target_temp),
        angle: num(r.pill_angle),
      })),
    [readings]
  );

  // Stats for the selected batch: latest reading in that batch
  const last = readings.length ? readings[readings.length - 1] : null;
  // Same rule as the database: set OG, else the highest Pill gravity in the first 12 hours
  const ogWindowEnd = selected ? new Date(selected.started_at).getTime() + 12 * 3600 * 1000 : 0;
  const earlyMax = readings.reduce((m, r) => {
    const g = num(r.gravity);
    return g !== null && new Date(r.recorded_at).getTime() <= ogWindowEnd ? Math.max(m ?? g, g) : m;
  }, null);
  const og = num(selected?.og) ?? earlyMax;
  const sg = num(last?.gravity);
  const abv = og && sg && og > sg ? (og - sg) * 131.25 : null;
  const atten = og && sg && og > 1 ? ((og - sg) / (og - 1)) * 100 : null;
  const day = selected
    ? Math.floor(
        ((selected.ended_at ? new Date(selected.ended_at) : new Date()) - new Date(selected.started_at)) /
          86400000
      ) + 1
    : null;

  // Expected FG from the yeast's attenuation range (midpoint)
  const yMin = num(selected?.yeast_atten_min);
  const yMax = num(selected?.yeast_atten_max) ?? yMin;
  const yMid = yMin !== null ? (yMin + yMax) / 2 : null;
  const expectedFg = og && yMid ? 1 + (og - 1) * (1 - yMid / 100) : null;
  const finished = !!selected?.ended_at;

  const lastSeen = latest ? new Date(latest.recorded_at) : null;
  const stale = lastSeen && (Date.now() - lastSeen.getTime()) / 60000 > STALE_MINUTES;

  // Fermentation profile: where the temperature should be right now
  const profile = Array.isArray(selected?.profile) && selected.profile.length ? selected.profile : null;
  const stepIdx = profile ? Math.min(selected.step_index || 0, profile.length - 1) : 0;
  const target = profile && !selected.ended_at ? Number(profile[stepIdx].temp) : null;
  const tol = num(selected?.temp_tolerance) ?? 1;
  const beerNow = num(last?.beer_temp);
  const probeNow = num(last?.probe_temp);
  const compareTemp = beerNow ?? probeNow;
  const compareName = beerNow !== null ? "Beer" : "Probe";
  const off = target !== null && compareTemp !== null && !stale ? compareTemp - target : null;
  const offTarget = off !== null && Math.abs(off) > tol;
  const tempHint = (v) => {
    if (target === null) return "";
    if (v === null) return `Target ${target.toFixed(1)} °C`;
    const d = v - target;
    if (Math.abs(d) <= tol) return `On target (${target.toFixed(1)} °C)`;
    return `${d > 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(1)} ${d > 0 ? "over" : "under"} ${target.toFixed(1)}`;
  };
  const tempTone = (v) => (target === null || v === null ? "" : Math.abs(v - target) <= tol ? "" : v > target ? "hot" : "cold");


  // ---- No brew running: just the live data, no graphs or history ----
  if (!active && !browsing) {
    return (
      <IdleView
        newForm={
          showNew && (
            <BatchForm
              initial={{ name: "", og: null, profile: null, temp_tolerance: 1 }}
              submitLabel="Start batch"
              onCancel={() => setShowNew(false)}
              onSubmit={async (fields) => {
                const { fg: _ignored, ...rest } = fields;
                const { data, error } = await supabase
                  .from("batches")
                  .insert({ ...rest, name: rest.name || "Untitled brew", started_at: new Date().toISOString() })
                  .select()
                  .single();
                if (error) return setError(error.message);
                setShowNew(false);
                setSelectedId(data.id);
                refresh();
              }}
            />
          )
        }
        latest={latest}
        stale={stale}
        lastSeen={lastSeen}
        error={error}
        hasHistory={batches.length > 0}
        onStart={() => setShowNew(true)}
        onBrowse={() => setBrowsing(true)}
      />
    );
  }


  return (
    <div className="app">
      <header className="top">
        <div className="top-row">
          <h1 className="brand">Brewputer</h1>
          <span className="top-links">
            {!active && (
              <button
                className="link"
                onClick={() => {
                  setBrowsing(false);
                  setShowNew(false);
                  setSelectedId(null);
                  window.scrollTo({ top: 0 });
                }}
              >
                Live view
              </button>
            )}
            <button className="link" onClick={() => supabase.auth.signOut()}>
              Sign out
            </button>
          </span>
        </div>
        <div className="beer">
          <span className="beer-name">{selected?.name || "No batch yet"}</span>
          {selected && (
            <span className="beer-meta">
              Day {day}
              {selected.ended_at ? " · finished" : ""}
            </span>
          )}
        </div>
      </header>

      {error && <p className="error banner">{error}</p>}

      {selected?.yeast_name && (
        <p className="yeast-line small">
          {selected.yeast_name}
          {yMin !== null && <span className="muted"> · {rangeText(yMin, yMax, "% attenuation")}</span>}
        </p>
      )}

      {!finished && (
        <>
          <p className={`status ${stale ? "status-warn" : ""}`} role="status">
            {lastSeen ? (
              <>
                {stale && <span aria-hidden="true">⚠ </span>}
                {stale ? "No data from the CYD for " : "Last reading "}
                {ago(lastSeen).replace(" ago", stale ? "" : " ago")}
              </>
            ) : (
              "No readings yet"
            )}
          </p>

          {offTarget && (
            <p className={`alert ${off > 0 ? "alert-hot" : "alert-cold"}`} role="alert">
              <span aria-hidden="true">⚠</span> {compareName} is {Math.abs(off).toFixed(1)} °C {off > 0 ? "above" : "below"} the{" "}
              {target.toFixed(1)} °C target
            </p>
          )}

          <section className="tiles" aria-label="Current readings">
            <Tile label="Gravity" value={fmt(sg, 3)} hint={expectedFg ? `Expected FG ~${expectedFg.toFixed(3)}` : ""} />
            <Tile label="ABV" value={fmt(abv, 1)} unit="%" />
            <Tile label="Beer" value={fmt(beerNow, 1)} unit="°C" hint={tempHint(beerNow)} tone={tempTone(beerNow)} />
            <Tile label="Probe" value={fmt(probeNow, 1)} unit="°C" hint={tempHint(probeNow)} tone={tempTone(probeNow)} />
            <Tile label="OG" value={fmt(og, 3)} hint={selected?.og ? "" : og ? "highest in first 12 h" : ""} />
            <Tile
              label="Attenuation"
              value={fmt(atten, 0)}
              unit="%"
              hint={yMin !== null ? `Yeast ${rangeText(yMin, yMax, "%")}` : ""}
            />
          </section>
        </>
      )}

      {finished && selected && <Report batch={selected} refreshKey={refreshKey} />}

      <section className="card">
        <h2>Gravity</h2>
        <GravityChart data={points} />
      </section>

      <section className="card">
        <h2>Temperature</h2>
        <TempChart data={points} />
      </section>

      {points.some((p) => p.angle !== null) && (
        <section className="card">
          <h2>Pill angle</h2>
          <AngleChart data={points} />
        </section>
      )}

      {profile && (
        <ProfileCard
          batch={selected}
          profile={profile}
          stepIdx={stepIdx}
          og={og}
          sg={sg}
          abv={abv}
          atten={atten}
          onSkip={async () => {
            const { error } = await supabase
              .from("batches")
              .update({ step_index: stepIdx + 1, step_started_at: new Date().toISOString() })
              .eq("id", selected.id);
            if (error) return setError(error.message);
            refresh();
          }}
        />
      )}

      {!finished && selected && <Report batch={selected} refreshKey={refreshKey} />}

      {selected && <Notes batch={selected} refreshKey={refreshKey} />}

      <section className="card">
        <h2>Batch</h2>
        {selected && !editing && !ending && (
          <div className="batch-actions">
            <button className="secondary" onClick={() => setEditing(true)}>
              Edit batch
            </button>
            {!selected.ended_at && (
              <button className="secondary" onClick={() => setEnding(true)}>
                End batch
              </button>
            )}
          </div>
        )}
        {ending && selected && (
          <EndBatchForm
            batch={selected}
            suggestedFg={sg}
            onCancel={() => setEnding(false)}
            onSubmit={async ({ fg, note }) => {
              const { error } = await supabase
                .from("batches")
                .update({ ended_at: new Date().toISOString(), ...(fg !== null ? { fg } : {}) })
                .eq("id", selected.id);
              if (error) return setError(error.message);
              if (note) {
                const { error: e2 } = await supabase
                  .from("batch_notes")
                  .insert({ batch_id: selected.id, kind: "end", body: note });
                if (e2) setError(e2.message);
              }
              setEnding(false);
              refresh();
            }}
          />
        )}
        {editing && selected && (
          <BatchForm
            initial={selected}
            submitLabel="Save"
            onCancel={() => setEditing(false)}
            onSubmit={async (fields) => {
              const { error } = await supabase.from("batches").update(fields).eq("id", selected.id);
              if (error) return setError(error.message);
              setEditing(false);
              refresh();
            }}
          />
        )}

        {!showNew ? (
          <button className="primary" onClick={() => setShowNew(true)}>
            Start new batch
          </button>
        ) : (
          <>
            {active && (
              <p className="muted small">Starting a new batch will finish “{active.name}”.</p>
            )}
            <BatchForm
              initial={{ name: "", og: null, profile: null, temp_tolerance: 1 }}
              submitLabel="Start batch"
              onCancel={() => setShowNew(false)}
              onSubmit={async (fields) => {
                const now = new Date().toISOString();
                if (active) {
                  const { error } = await supabase.from("batches").update({ ended_at: now }).eq("id", active.id);
                  if (error) return setError(error.message);
                }
                const { fg: _ignored, ...rest } = fields;
                const { data, error } = await supabase
                  .from("batches")
                  .insert({ ...rest, name: rest.name || "Untitled brew", started_at: now })
                  .select()
                  .single();
                if (error) return setError(error.message);
                setShowNew(false);
                setBrowsing(false);
                setSelectedId(data.id);
                refresh();
              }}
            />
          </>
        )}
      </section>

      {batches.length > 1 && (
        <section className="card">
          <h2>All batches</h2>
          <ul className="batch-list">
            {batches.map((b) => (
              <li key={b.id}>
                <button
                  className={`batch-item ${selected?.id === b.id ? "current" : ""}`}
                  onClick={() => {
                    setSelectedId(b.id);
                    setEditing(false);
                    setEnding(false);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  <span>
                    {b.name}
                    {b.summary?.abv != null && (
                      <span className="muted small batch-sub">
                        {Number(b.summary.abv).toFixed(1)}% · FG {Number(b.summary.fg).toFixed(3)}
                        {b.summary.attenuation != null && ` · ${Math.round(b.summary.attenuation)}% att.`}
                      </span>
                    )}
                  </span>
                  <span className="muted small">
                    {dateFmt.format(new Date(b.started_at))}
                    {b.ended_at ? "" : " · running"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="card">
        <summary>All readings ({readings.length})</summary>
        <ReadingsTable readings={readings} />
      </details>

      {latest && (
        <p className="footer muted small">
          Pill angle {fmt(num(latest.pill_angle), 1)}° · Pill battery {fmt(num(latest.pill_battery), 0)}% · Pill signal {fmt(num(latest.pill_rssi), 0)} dBm ·
          Wi-Fi {fmt(num(latest.wifi_rssi), 0)} dBm · Free memory{" "}
          {latest.free_heap ? Math.round(latest.free_heap / 1024) + "KB" : "--"}
        </p>
      )}
    </div>
  );
}

export function IdleView({ newForm, latest, stale, lastSeen, error, hasHistory, onStart, onBrowse }) {
  const r = latest || {};
  const sg = num(r.gravity);
  const angle = num(r.pill_angle);
  const pillAt = r.pill_data_at ? new Date(r.pill_data_at) : null;
  const pillAge = pillAt ? (Date.now() - pillAt.getTime()) / 60000 : null;
  // Only say "heard X ago" once it's older than a normal report gap
  const pillHint = pillAt && pillAge > 20 ? `Pill heard ${ago(pillAt)}` : "";
  const sgHint =
    sg === null && angle !== null ? (angle < 20 ? "Pill not floating?" : "Out of range") : pillHint;

  return (
    <div className="app">
      <header className="top">
        <div className="top-row">
          <h1 className="brand">Brewputer</h1>
          <button className="link" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
        <div className="beer">
          <span className="beer-name">No current brew</span>
        </div>
      </header>

      {error && <p className="error banner">{error}</p>}

      <p className={`status ${stale ? "status-warn" : ""}`} role="status">
        {lastSeen ? (
          <>
            {stale && <span aria-hidden="true">⚠ </span>}
            {stale ? "No data from the CYD for " : "Last reading "}
            {ago(lastSeen).replace(" ago", stale ? "" : " ago")}
          </>
        ) : (
          "No readings yet"
        )}
      </p>

      <section className="tiles" aria-label="Current readings">
        <Tile label="Probe" value={fmt(num(r.probe_temp), 1)} unit="°C" />
        <Tile label="Beer (Pill)" value={fmt(num(r.beer_temp), 1)} unit="°C" hint={pillHint} />
        <Tile label="Gravity" value={fmt(sg, 3)} hint={sgHint} />
        <Tile label="Pill angle" value={fmt(angle, 1)} unit="°" />
        <Tile label="Pill battery" value={fmt(num(r.pill_battery), 0)} unit="%" />
        <Tile label="Pill signal" value={fmt(num(r.pill_rssi), 0)} unit="dBm" />
      </section>

      <section className="card idle-actions">
        {newForm || (
          <button className="primary" onClick={onStart}>
            Start new batch
          </button>
        )}
        {!newForm && hasHistory && (
          <button className="link" onClick={onBrowse}>
            Past batches
          </button>
        )}
      </section>

      {latest && (
        <p className="footer muted small">
          Wi-Fi {fmt(num(r.wifi_rssi), 0)} dBm · Free memory{" "}
          {r.free_heap ? Math.round(r.free_heap / 1024) + "KB" : "--"}
        </p>
      )}
    </div>
  );
}

function Tile({ label, value, unit, hint, tone }) {
  return (
    <div className={`tile ${tone ? "tile-" + tone : ""}`}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">
        {value}
        {unit && value !== "--" && <span className="tile-unit">{unit}</span>}
      </div>
      {hint && <div className="tile-hint">{hint}</div>}
    </div>
  );
}

function ConfirmButton({ label, onConfirm }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return armed ? (
    <button className="danger" onClick={onConfirm}>
      Tap again to confirm
    </button>
  ) : (
    <button className="secondary" onClick={() => setArmed(true)}>
      {label}
    </button>
  );
}

function BatchForm({ initial, submitLabel, onSubmit, onCancel }) {
  const [name, setName] = useState(initial.name || "");
  const [og, setOg] = useState(initial.og ? Number(initial.og).toFixed(3) : "");
  const [steps, setSteps] = useState(Array.isArray(initial.profile) ? initial.profile : []);
  const [showProfile, setShowProfile] = useState(Array.isArray(initial.profile) && initial.profile.length > 0);
  const [tolerance, setTolerance] = useState(String(initial.temp_tolerance ?? 1));
  const [yeast, setYeast] = useState({
    yeast_id: initial.yeast_id ?? null,
    yeast_name: initial.yeast_name ?? null,
    yeast_atten_min: initial.yeast_atten_min != null ? Number(initial.yeast_atten_min) : null,
    yeast_atten_max: initial.yeast_atten_max != null ? Number(initial.yeast_atten_max) : null,
  });
  const [fg, setFg] = useState(initial.fg ? Number(initial.fg).toFixed(3) : "");
  const fgNum = fg.trim() === "" ? null : Number(fg);
  const fgValid = fgNum === null || (fgNum >= 0.98 && fgNum < 1.15);
  const [busy, setBusy] = useState(false);
  const ogNum = og.trim() === "" ? null : Number(og);
  const ogValid = ogNum === null || (ogNum >= 1 && ogNum < 1.2);
  const tolNum = Number(tolerance);
  const tolValid = Number.isFinite(tolNum) && tolNum >= 0.2 && tolNum <= 5;
  const profileErrors = showProfile && steps.length ? validateProfile(steps) : [];
  const valid = ogValid && fgValid && tolValid && profileErrors.length === 0;

  return (
    <form
      className="batch-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        setBusy(true);
        const profile = showProfile && steps.length
          ? steps.map(({ temp, until, value, label }) => ({
              temp,
              until,
              ...(until !== "hold" ? { value } : {}),
              ...(label ? { label } : {}),
            }))
          : null;
        await onSubmit({
          name: name.trim(),
          og: ogNum,
          profile,
          temp_tolerance: tolNum,
          ...yeast,
          ...(initial.ended_at ? { fg: fgNum } : {}),
        });
        setBusy(false);
      }}
    >
      <label>
        Beer name
        <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Untitled brew" />
      </label>
      <label>
        Original gravity
        <input
          value={og}
          inputMode="decimal"
          placeholder="e.g. 1.052 (blank = Pill's highest in first 12 h)"
          onChange={(e) => setOg(e.target.value)}
          aria-invalid={!ogValid}
        />
      </label>
      {!ogValid && <p className="error small">OG should be between 1.000 and 1.200</p>}
      {initial.ended_at && (
        <label>
          Final gravity
          <input
            value={fg}
            inputMode="decimal"
            placeholder="blank = lowest 2-hour average from the Pill"
            onChange={(e) => setFg(e.target.value)}
            aria-invalid={!fgValid}
          />
        </label>
      )}
      {!fgValid && <p className="error small">FG should be between 0.980 and 1.150</p>}
      <YeastPicker value={yeast} onChange={setYeast} />

      {!showProfile ? (
        <button type="button" className="secondary" onClick={() => setShowProfile(true)}>
          Add fermentation profile (optional)
        </button>
      ) : (
        <fieldset className="profile-fieldset">
          <legend>Fermentation profile</legend>
          <ProfileEditor steps={steps} onChange={setSteps} />
          <label>
            Warn when the beer is more than ± this many °C from target
            <input
              value={tolerance}
              inputMode="decimal"
              onChange={(e) => setTolerance(e.target.value)}
              aria-invalid={!tolValid}
            />
          </label>
          {!tolValid && <p className="error small">Use 0.2 to 5 °C</p>}
          {profileErrors.length > 0 && (
            <ul className="error small problems">
              {profileErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </fieldset>
      )}

      <div className="batch-actions">
        <button type="submit" className="primary" disabled={busy || !valid}>
          {busy ? "Saving…" : submitLabel}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const rowTime = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function ReadingsTable({ readings }) {
  if (!readings.length) return <p className="muted small">No readings for this batch yet.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>SG</th>
            <th>Beer °C</th>
            <th>Probe °C</th>
            <th>Angle</th>
          </tr>
        </thead>
        <tbody>
          {[...readings].reverse().map((r) => (
            <tr key={r.id}>
              <td>{rowTime.format(new Date(r.recorded_at))}</td>
              <td>{fmt(num(r.gravity), 3)}</td>
              <td>{fmt(num(r.beer_temp), 1)}</td>
              <td>{fmt(num(r.probe_temp), 1)}</td>
              <td>{fmt(num(r.pill_angle), 1)}°</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProfileCard({ batch, profile, stepIdx, og, sg, abv, atten, onSkip }) {
  const finished = !!batch.ended_at;
  const stepStart = new Date(batch.step_started_at || batch.started_at);
  const current = profile[stepIdx];
  const lastIdx = profile.length - 1;

  // Expected start of each upcoming step, while the chain from now is all day-based
  const eta = [];
  let t = stepStart.getTime();
  let known = true;
  for (let i = stepIdx; i < profile.length; i++) {
    eta[i] = known ? new Date(t) : null;
    if (profile[i].until === "days") t += profile[i].value * 86400000;
    else known = false;
  }

  let progress = "";
  if (!finished) {
    if (stepIdx === lastIdx) {
      if (current.until === "days") {
        const end = new Date(stepStart.getTime() + current.value * 86400000);
        progress =
          Date.now() >= end.getTime()
            ? "Profile complete, holding until you end the batch"
            : `Last step: finishes ${whenFmt.format(end)}, then holds`;
      } else {
        progress = "Last step: holds until you end the batch";
      }
    } else if (current.until === "days") {
      const end = new Date(stepStart.getTime() + current.value * 86400000);
      progress = `Next step ${whenFmt.format(end)} (${until(end)})`;
    } else if (current.until === "gravity") {
      progress = `SG ${sg !== null ? sg.toFixed(3) : "--"}, moving on at ${Number(current.value).toFixed(3)}`;
    } else if (current.until === "abv") {
      progress = `ABV ${abv !== null ? abv.toFixed(1) : "--"}%, moving on at ${current.value}%`;
    } else if (current.until === "attenuation") {
      progress = `Attenuation ${atten !== null ? atten.toFixed(0) : "--"}%, moving on at ${current.value}%`;
    }
  }

  return (
    <section className="card">
      <h2>
        Profile{!finished && ` · step ${stepIdx + 1} of ${profile.length}`}
      </h2>
      {!finished && <p className="progress">{progress}</p>}
      <ol className="steps">
        {profile.map((st, i) => {
          const state = finished || i < stepIdx ? "done" : i === stepIdx ? "now" : "next";
          return (
            <li key={i} className={`step step-${state}`}>
              <span className="step-mark" aria-hidden="true">
                {state === "done" ? "✓" : i + 1}
              </span>
              <span className="step-text">
                <strong>{describeStep(st, i === lastIdx)}</strong>
                {st.label && <span className="muted"> · {st.label}</span>}
                {state === "now" && <span className="sr-only"> (current step)</span>}
                {state === "next" && eta[i] && <span className="muted small step-eta">from {dayFmt.format(eta[i])}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      {!finished && stepIdx < lastIdx && (
        <div className="batch-actions">
          <ConfirmButton label="Skip to next step" onConfirm={onSkip} />
        </div>
      )}
      {og === null && profile.some((st) => st.until === "abv" || st.until === "attenuation") && (
        <p className="muted small">ABV and attenuation steps need an OG: set one, or it's taken from the Pill's highest reading in the first 12 hours.</p>
      )}
    </section>
  );
}

function EndBatchForm({ batch, suggestedFg, onSubmit, onCancel }) {
  const [fg, setFg] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const fgNum = fg.trim() === "" ? null : Number(fg);
  const fgValid = fgNum === null || (fgNum >= 0.98 && fgNum < 1.15);
  return (
    <form
      className="batch-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!fgValid) return;
        setBusy(true);
        await onSubmit({ fg: fgNum, note: note.trim() });
        setBusy(false);
      }}
    >
      <p className="small">
        End <strong>{batch.name}</strong>? Readings stop being added to it, and its report is saved.
      </p>
      <label>
        Final gravity (optional)
        <input
          value={fg}
          inputMode="decimal"
          placeholder={suggestedFg ? `Pill now ${suggestedFg.toFixed(3)}; blank = lowest 2-hour average` : "blank = lowest 2-hour average"}
          onChange={(e) => setFg(e.target.value)}
          aria-invalid={!fgValid}
        />
      </label>
      {!fgValid && <p className="error small">FG should be between 0.980 and 1.150</p>}
      <label>
        Closing notes (optional)
        <textarea
          rows={3}
          value={note}
          maxLength={5000}
          onChange={(e) => setNote(e.target.value)}
          placeholder="How did it go? Anything to change next time?"
        />
      </label>
      <div className="batch-actions">
        <button type="submit" className="danger" disabled={busy || !fgValid}>
          {busy ? "Ending…" : "End batch"}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
