import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase.js";

let cache = null; // the yeast list is reference data, so load it once per visit

/** Pick a yeast from the database (fills in expected attenuation), or enter a custom one. */
export default function YeastPicker({ value, onChange }) {
  // value: { yeast_id, yeast_name, yeast_atten_min, yeast_atten_max }
  const [yeasts, setYeasts] = useState(cache || []);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(!!value.yeast_name && !value.yeast_id);

  useEffect(() => {
    if (cache) return;
    supabase
      .from("yeasts")
      .select("id,name,producer,product_id,attenuation_min,attenuation_max,temp_min,temp_max")
      .order("producer")
      .order("name")
      .then(({ data }) => {
        cache = data || [];
        setYeasts(cache);
      });
  }, []);

  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return yeasts
      .filter((y) => {
        const hay = `${y.producer} ${y.name} ${y.product_id || ""}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 8);
  }, [query, yeasts]);

  const pick = (y) => {
    onChange({
      yeast_id: y.id,
      yeast_name: `${y.producer} ${y.name}${y.product_id && !y.name.includes(y.product_id) ? ` (${y.product_id})` : ""}`,
      yeast_atten_min: num(y.attenuation_min),
      yeast_atten_max: num(y.attenuation_max),
    });
    setQuery("");
    setOpen(false);
  };
  const clear = () => onChange({ yeast_id: null, yeast_name: null, yeast_atten_min: null, yeast_atten_max: null });

  const selected = yeasts.find((y) => y.id === value.yeast_id);

  if (custom) {
    return (
      <div className="yeast-picker">
        <label>
          Yeast (custom)
          <input
            value={value.yeast_name || ""}
            maxLength={80}
            placeholder="e.g. House strain, gen 3"
            onChange={(e) => onChange({ ...value, yeast_id: null, yeast_name: e.target.value || null })}
          />
        </label>
        <div className="step-row-fields">
          <label className="inline">
            Attenuation
            <input
              type="number"
              inputMode="decimal"
              placeholder="min"
              value={value.yeast_atten_min ?? ""}
              onChange={(e) => onChange({ ...value, yeast_atten_min: e.target.value === "" ? null : Number(e.target.value) })}
              aria-label="Minimum attenuation"
            />
            –
            <input
              type="number"
              inputMode="decimal"
              placeholder="max"
              value={value.yeast_atten_max ?? ""}
              onChange={(e) => onChange({ ...value, yeast_atten_max: e.target.value === "" ? null : Number(e.target.value) })}
              aria-label="Maximum attenuation"
            />
            %
          </label>
        </div>
        <button
          type="button"
          className="link"
          onClick={() => {
            setCustom(false);
            clear();
          }}
        >
          Search the yeast list instead
        </button>
      </div>
    );
  }

  return (
    <div className="yeast-picker">
      {value.yeast_name ? (
        <div className="yeast-chosen">
          <div>
            <strong>{value.yeast_name}</strong>
            <div className="muted small">
              {rangeText(value.yeast_atten_min, value.yeast_atten_max, "% attenuation")}
              {selected?.temp_min != null && ` · ${rangeText(selected.temp_min, selected.temp_max, " °C")}`}
            </div>
          </div>
          <button type="button" className="link" onClick={clear}>
            Change
          </button>
        </div>
      ) : (
        <label>
          Yeast
          <input
            value={query}
            placeholder="Search, e.g. US-05, Nottingham, WLP001"
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            autoComplete="off"
          />
        </label>
      )}
      {open && results.length > 0 && !value.yeast_name && (
        <ul className="yeast-results" role="listbox">
          {results.map((y) => (
            <li key={y.id}>
              <button type="button" onClick={() => pick(y)}>
                <span>
                  {y.producer} {y.name}
                  {y.product_id ? <span className="muted"> · {y.product_id}</span> : null}
                </span>
                <span className="muted small">{rangeText(num(y.attenuation_min), num(y.attenuation_max), "%")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && query.trim().length > 1 && results.length === 0 && yeasts.length > 0 && (
        <p className="muted small">No match in the yeast list.</p>
      )}
      {!value.yeast_name && (
        <button type="button" className="link" onClick={() => setCustom(true)}>
          Not listed? Enter a custom yeast
        </button>
      )}
    </div>
  );
}

const num = (v) => (v === null || v === undefined ? null : Number(v));

export function rangeText(min, max, unit) {
  if (min == null && max == null) return "range unknown";
  if (min == null || max == null || Number(min) === Number(max)) return `${fmtN(min ?? max)}${unit}`;
  return `${fmtN(min)}–${fmtN(max)}${unit}`;
}
const fmtN = (v) => String(+Number(v).toFixed(1));
