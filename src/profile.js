// Fermentation profiles: an ordered list of steps.
//   { temp: 18, until: "days" | "gravity" | "abv" | "attenuation" | "hold", value: 5, label?: "Cold crash" }
// The database advances steps as readings arrive; the last step holds until the batch ends.

export const CONDITIONS = [
  { id: "days", label: "for (days)", unit: "days", step: "0.5", placeholder: "5" },
  { id: "gravity", label: "until SG at or below", unit: "", step: "0.001", placeholder: "1.012" },
  { id: "abv", label: "until ABV reaches", unit: "%", step: "0.1", placeholder: "4.5" },
  { id: "attenuation", label: "until attenuation reaches", unit: "%", step: "1", placeholder: "75" },
  { id: "hold", label: "and hold", unit: "", step: "", placeholder: "" },
];

const WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fourteen: 14, "a couple of": 2,
};
// A number followed by a unit: digits may touch the unit ("5d"), words need a space ("a week")
const NUM_UNIT = String.raw`(?:(\d+(?:\.\d+)?)\s*|\b(a couple of|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fourteen)\s+)`;
const toNum = (s) => (s in WORDS ? WORDS[s] : Number(s));

/** Parse "18c for 5 days then 20c for three days then cold crash at 2c for 5 days". */
export function parseProfile(text) {
  const steps = [];
  const problems = [];
  const parts = text
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .split(/\bthen\b|,|;|\n|\.(?!\d)/)
    .map((p) => p.trim())
    .filter(Boolean);

  for (const part of parts) {
    // "18c", "18 °C", "at 18", or a bare number at the start ("18 for a week")
    const tempMatch =
      part.match(/(-?\d+(?:\.\d+)?)\s*(?:°\s*)?c\b|\bat\s+(-?\d+(?:\.\d+)?)\b(?!\s*%)/) ||
      part.match(/^(?:[a-z ]*?\s)?(-?\d{1,2}(?:\.\d)?)\b(?!\s*(?:%|days?|d\b|hours?|h\b|weeks?))(?!\.\d)/);
    if (!tempMatch) {
      problems.push(`No temperature in “${part}”`);
      continue;
    }
    const temp = Number(tempMatch[1] ?? tempMatch[2]);
    let rest = part.replace(tempMatch[0], " ");
    let until = "hold";
    let value = null;
    let m;

    if ((m = rest.match(new RegExp(String.raw`${NUM_UNIT}(days?|d|hours?|hrs?|h|weeks?|wks?)\b`)))) {
      const n = m[1] !== undefined ? Number(m[1]) : toNum(m[2]);
      const u = m[3];
      value = u.startsWith("h") ? n / 24 : u.startsWith("w") ? n * 7 : n;
      until = "days";
    } else if ((m = rest.match(/(\d+(?:\.\d+)?)\s*%?\s*(?:attenuation|atten|att)\b|(?:attenuation|atten)\D{0,20}?(\d+(?:\.\d+)?)\s*%?/))) {
      value = Number(m[1] ?? m[2]);
      until = "attenuation";
    } else if ((m = rest.match(/(\d+(?:\.\d+)?)\s*%?\s*abv\b|\babv\D{0,20}?(\d+(?:\.\d+)?)/))) {
      value = Number(m[1] ?? m[2]);
      until = "abv";
    } else if ((m = rest.match(/\b(1\.\d{2,4})\b/))) {
      value = Number(m[1]);
      until = "gravity";
    }
    if (m) rest = rest.replace(m[0], " ");

    // Whatever words are left (e.g. "cold crash", "diacetyl rest") become the label
    const label = rest
      .replace(/\b(for|at|until|till|to|and|of|reaches|reach|hits|is|below|under|sg|gravity|fg|hold|then|ramp|up|go)\b/g, " ")
      .replace(/[^a-z ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    steps.push({ temp, until, value, ...(label.length > 2 ? { label: capitalise(label) } : {}) });
  }

  // Only the last step may be open-ended
  steps.forEach((s, i) => {
    if (s.until === "hold" && i < steps.length - 1) problems.push(`Step ${i + 1} needs a length or a target`);
  });
  return { steps, problems };
}

const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Server-side rules: every step but the last needs a condition. */
export function validateProfile(steps) {
  const errs = [];
  steps.forEach((s, i) => {
    const last = i === steps.length - 1;
    if (!Number.isFinite(s.temp) || s.temp < -5 || s.temp > 40) errs.push(`Step ${i + 1}: temperature should be -5 to 40 °C`);
    if (s.until === "hold" && !last) errs.push(`Step ${i + 1}: needs a length or a target`);
    if (s.until !== "hold") {
      if (!Number.isFinite(s.value)) errs.push(`Step ${i + 1}: missing a value`);
      else if (s.until === "days" && (s.value <= 0 || s.value > 60)) errs.push(`Step ${i + 1}: days should be 0–60`);
      else if (s.until === "gravity" && (s.value < 0.98 || s.value > 1.15)) errs.push(`Step ${i + 1}: SG should be 0.980–1.150`);
      else if (s.until === "abv" && (s.value <= 0 || s.value > 20)) errs.push(`Step ${i + 1}: ABV should be 0–20%`);
      else if (s.until === "attenuation" && (s.value <= 0 || s.value > 100)) errs.push(`Step ${i + 1}: attenuation should be 0–100%`);
    }
  });
  return errs;
}

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function describeCondition(step, isLast) {
  switch (step.until) {
    case "days": {
      const d = step.value;
      return d < 1 ? `for ${plural(Math.round(d * 24), "hour")}` : `for ${plural(+d.toFixed(1), "day")}`;
    }
    case "gravity":
      return `until SG ${Number(step.value).toFixed(3)}`;
    case "abv":
      return `until ${step.value}% ABV`;
    case "attenuation":
      return `until ${step.value}% attenuation`;
    default:
      return isLast ? "and hold" : "";
  }
}

export function describeStep(step, isLast) {
  return `${Number(step.temp).toFixed(1).replace(/\.0$/, "")} °C ${describeCondition(step, isLast)}`.trim();
}
