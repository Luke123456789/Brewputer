import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// Colours validated against the sepia surface (#EAE0CB) for lightness, chroma,
// colour-blind separation and contrast. Text never uses series colours.
export const COLORS = {
  gravity: "#111111",
  beer: "#A4521B",
  probe: "#1A6E9A",
  target: "#111111", // dashed, so it's told apart by line style as well as colour
  grid: "#CDBFA3",
  axis: "#60584C",
};

const tickFmtShort = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const tickFmtLong = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const tipFmt = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function timeTicker(data) {
  if (data.length < 2) return (t) => tickFmtShort.format(t);
  const span = data[data.length - 1].t - data[0].t;
  return span > 36 * 3600 * 1000 ? (t) => tickFmtLong.format(t) : (t) => tickFmtShort.format(t);
}

function Empty() {
  return <div className="chart-empty muted small">No readings yet for this batch.</div>;
}

function TipBox({ active, payload, label, rows }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="tip">
      <div className="tip-time">{tipFmt.format(label)}</div>
      {rows.map((r) =>
        p[r.key] === null || p[r.key] === undefined ? null : (
          <div className="tip-row" key={r.key}>
            {r.color && <span className="tip-swatch" style={{ background: r.color }} />}
            <span>{r.name}</span>
            <strong>{r.format(p[r.key])}</strong>
          </div>
        )
      )}
    </div>
  );
}

const axisProps = {
  stroke: COLORS.axis,
  tick: { fill: COLORS.axis, fontSize: 12 },
  tickLine: false,
  axisLine: { stroke: COLORS.grid },
};

const cursor = { stroke: COLORS.axis, strokeWidth: 1, strokeDasharray: "3 3" };

export function GravityChart({ data }) {
  const pts = data.filter((d) => d.gravity !== null);
  if (!pts.length) return <Empty />;
  const fmtTick = timeTicker(pts);
  const g = pts.map((d) => d.gravity);
  const lo = Math.min(...g), hi = Math.max(...g);
  const step = hi - lo > 0.03 ? 0.01 : hi - lo > 0.012 ? 0.005 : 0.002;
  const yMin = Math.floor((lo - step / 4) / step) * step;
  const yMax = Math.ceil((hi + step / 4) / step) * step;
  const ticks = [];
  for (let v = yMin; v <= yMax + 1e-9; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return (
    <div className="chart" role="img" aria-label="Gravity over time">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={pts} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={COLORS.grid} strokeDasharray="0" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={fmtTick}
            minTickGap={40}
            {...axisProps}
          />
          <YAxis
            domain={[ticks[0], ticks[ticks.length - 1]]}
            ticks={ticks}
            tickFormatter={(v) => v.toFixed(3)}
            width={52}
            {...axisProps}
          />
          <Tooltip
            cursor={cursor}
            content={<TipBox rows={[{ key: "gravity", name: "Gravity", format: (v) => v.toFixed(3) }]} />}
          />
          <Line
            type="monotone"
            dataKey="gravity"
            stroke={COLORS.gravity}
            strokeWidth={2}
            dot={pts.length < 3 ? { r: 4 } : false}
            activeDot={{ r: 5, stroke: "#EAE0CB", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// Direct label at the end of a line, so identity isn't carried by colour alone
const endLabel = (name, count, above) =>
  function EndLabel({ x, y, index }) {
    if (index !== count - 1) return null;
    return (
      <text x={x - 6} y={above ? y - 10 : y + 18} textAnchor="end" fill="#111111" fontSize={12} fontWeight={600}>
        {name}
      </text>
    );
  };

export function TempChart({ data }) {
  const pts = data.filter((d) => d.beer !== null || d.probe !== null || d.target !== null);
  const hasTarget = pts.some((d) => d.target !== null);
  if (!pts.length) return <Empty />;
  const fmtTick = timeTicker(pts);
  const lastP = pts[pts.length - 1];
  const beerAbove = (lastP.beer ?? -Infinity) >= (lastP.probe ?? -Infinity);
  return (
    <div className="chart" role="img" aria-label="Beer and probe temperature over time">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={pts} margin={{ top: 20, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={COLORS.grid} vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={fmtTick}
            minTickGap={40}
            {...axisProps}
          />
          <YAxis
            domain={[(min) => Math.floor(min - 1), (max) => Math.ceil(max + 1)]}
            tickFormatter={(v) => `${v}°`}
            width={40}
            {...axisProps}
          />
          <Tooltip
            cursor={cursor}
            content={
              <TipBox
                rows={[
                  { key: "beer", name: "Beer (Pill)", color: COLORS.beer, format: (v) => `${v.toFixed(1)} °C` },
                  { key: "probe", name: "Probe", color: COLORS.probe, format: (v) => `${v.toFixed(1)} °C` },
                  { key: "target", name: "Target", color: COLORS.target, format: (v) => `${v.toFixed(1)} °C` },
                ]}
              />
            }
          />
          <Legend
            verticalAlign="top"
            align="left"
            height={28}
            iconType="plainline"
            payload={[
              { value: "Beer (Pill)", type: "plainline", color: COLORS.beer, payload: { strokeDasharray: "0" } },
              { value: "Probe", type: "plainline", color: COLORS.probe, payload: { strokeDasharray: "0" } },
              ...(hasTarget
                ? [{ value: "Target", type: "plainline", color: COLORS.target, payload: { strokeDasharray: "6 4" } }]
                : []),
            ]}
            wrapperStyle={{ fontSize: 13, color: "#111111" }}
            formatter={(v) => <span style={{ color: "#111111" }}>{v}</span>}
          />
          <Line
            name="Beer (Pill)"
            type="monotone"
            dataKey="beer"
            stroke={COLORS.beer}
            strokeWidth={2}
            dot={pts.length < 3 ? { r: 4 } : false}
            activeDot={{ r: 5, stroke: "#EAE0CB", strokeWidth: 2 }}
            label={pts.length > 2 ? endLabel("Beer", pts.length, beerAbove) : false}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Line
            name="Probe"
            type="monotone"
            dataKey="probe"
            stroke={COLORS.probe}
            strokeWidth={2}
            dot={pts.length < 3 ? { r: 4 } : false}
            activeDot={{ r: 5, stroke: "#EAE0CB", strokeWidth: 2 }}
            label={pts.length > 2 ? endLabel("Probe", pts.length, !beerAbove) : false}
            connectNulls={false}
            isAnimationActive={false}
          />
          {hasTarget && (
            <Line
              name="Target"
              type="stepAfter"
              dataKey="target"
              stroke={COLORS.target}
              strokeWidth={1.5}
              strokeDasharray="6 4"
              dot={false}
              activeDot={false}
              connectNulls
              isAnimationActive={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AngleChart({ data }) {
  const pts = data.filter((d) => d.angle !== null);
  if (!pts.length) return <Empty />;
  const fmtTick = timeTicker(pts);
  return (
    <div className="chart" role="img" aria-label="Pill angle over time">
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={pts} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={COLORS.grid} vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={fmtTick}
            minTickGap={40}
            {...axisProps}
          />
          <YAxis
            domain={[(min) => Math.floor(min - 2), (max) => Math.ceil(max + 2)]}
            tickFormatter={(v) => `${v}°`}
            width={40}
            {...axisProps}
          />
          <Tooltip
            cursor={cursor}
            content={<TipBox rows={[{ key: "angle", name: "Angle", format: (v) => `${v.toFixed(1)}°` }]} />}
          />
          <Line
            type="monotone"
            dataKey="angle"
            stroke={COLORS.gravity}
            strokeWidth={2}
            dot={pts.length < 3 ? { r: 4 } : false}
            activeDot={{ r: 5, stroke: "#EAE0CB", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
