import { useState } from "react";
import { CONDITIONS, describeStep, parseProfile } from "./profile.js";

/** Optional fermentation profile: type it in plain English, or build it step by step. */
export default function ProfileEditor({ steps, onChange }) {
  const [text, setText] = useState("");
  const [problems, setProblems] = useState([]);

  function fromText() {
    const { steps: parsed, problems } = parseProfile(text);
    setProblems(problems);
    if (parsed.length) onChange(parsed);
  }

  const update = (i, patch) => onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const remove = (i) => onChange(steps.filter((_, j) => j !== i));
  const add = () => {
    const prev = steps[steps.length - 1];
    // The previous last step can no longer just "hold"
    const fixed = prev && prev.until === "hold" ? steps.map((s, j) => (j === steps.length - 1 ? { ...s, until: "days", value: null } : s)) : steps;
    onChange([...fixed, { temp: prev ? prev.temp : 18, until: "hold", value: null }]);
  };

  return (
    <div className="profile-editor">
      <label>
        Describe it
        <textarea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="18c for 5 days then 20c until 75% attenuation then cold crash at 2c for 5 days"
        />
      </label>
      <button type="button" className="secondary" onClick={fromText} disabled={!text.trim()}>
        Turn into steps
      </button>
      {problems.length > 0 && (
        <ul className="error small problems">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      {steps.length > 0 && (
        <ol className="steps-edit">
          {steps.map((s, i) => {
            const last = i === steps.length - 1;
            const cond = CONDITIONS.find((c) => c.id === s.until) || CONDITIONS[0];
            return (
              <li key={i} className="step-row">
                <div className="step-row-top">
                  <span className="step-num">{i + 1}</span>
                  <input
                    className="step-label"
                    value={s.label || ""}
                    placeholder="Label (optional)"
                    maxLength={30}
                    onChange={(e) => update(i, { label: e.target.value || undefined })}
                    aria-label={`Step ${i + 1} label`}
                  />
                  <button type="button" className="link remove" onClick={() => remove(i)} aria-label={`Remove step ${i + 1}`}>
                    Remove
                  </button>
                </div>
                <div className="step-row-fields">
                  <label className="inline">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.5"
                      value={Number.isFinite(s.temp) ? s.temp : ""}
                      onChange={(e) => update(i, { temp: e.target.value === "" ? NaN : Number(e.target.value) })}
                      aria-label={`Step ${i + 1} temperature`}
                    />
                    <span>°C</span>
                  </label>
                  <select
                    value={s.until}
                    onChange={(e) => update(i, { until: e.target.value, value: e.target.value === "hold" ? null : s.value })}
                    aria-label={`Step ${i + 1} ends`}
                  >
                    {CONDITIONS.filter((c) => c.id !== "hold" || last).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  {s.until !== "hold" && (
                    <label className="inline">
                      <input
                        type="number"
                        inputMode="decimal"
                        step={cond.step}
                        placeholder={cond.placeholder}
                        value={Number.isFinite(s.value) ? s.value : ""}
                        onChange={(e) => update(i, { value: e.target.value === "" ? null : Number(e.target.value) })}
                        aria-label={`Step ${i + 1} ${cond.label}`}
                      />
                      {cond.unit && <span>{cond.unit}</span>}
                    </label>
                  )}
                </div>
                <div className="muted small">{describeStep(s, last)}</div>
              </li>
            );
          })}
        </ol>
      )}
      <div className="batch-actions">
        <button type="button" className="secondary" onClick={add}>
          Add step
        </button>
        {steps.length > 0 && (
          <button type="button" className="link" onClick={() => onChange([])}>
            Clear profile
          </button>
        )}
      </div>
      <p className="muted small">
        Gravity, ABV and attenuation steps move on once the target has held for 30 minutes. The last step
        holds until you end the batch.
      </p>
    </div>
  );
}
