/* Dependency-free scientific plots. All curves come from the numerical result. */

const COLORS = {
  background: "#ffffff", grid: "#dde2e6", text: "#333F48", muted: "#62656B",
  excitation: "#6C1D45", inhibition: "#A86F00", voltage: "#333F48",
  threshold: "#62656B", spike: "#6C1D45", cursor: "#A86F00",
};

const DEFINITIONS = [
  {
    id: "voltage", title: "Membrane potential", subtitle: "LIF samples · gaps at spikes; exact threshold-to-reset events",
    unit: "mV", height: 232,
    lines: [{ key: "voltage_mV", label: "LIF voltage", color: COLORS.voltage }],
  },
  {
    id: "concentration", title: "Transmitter at receptors", subtitle: "Local concentration · gaps at jumps; dots mark release samples",
    unit: "µM", height: 196,
    lines: [
      { key: "glutamate_uM", label: "Glutamate", color: COLORS.excitation },
      { key: "gaba_uM", label: "GABA", color: COLORS.inhibition },
    ],
  },
  {
    id: "occupancy", title: "Receptor activation", subtitle: "Two-state open-fraction approximation",
    unit: "% open", height: 196,
    lines: [
      { key: "ampa_occupancy", label: "AMPA", color: COLORS.excitation },
      { key: "gabaa_occupancy", label: "GABA-A", color: COLORS.inhibition },
    ],
  },
];

const CURRENT_DEFINITION = {
  id: "current", title: "Synaptic membrane drive",
  subtitle: "Positive depolarizes; negative hyperpolarizes. Gaps at voltage resets.",
  unit: "pA", height: 220,
  lines: [
    {key: "excitatory_current_pA", label: "AMPA drive", color: COLORS.excitation},
    {key: "inhibitory_current_pA", label: "GABA-A drive", color: COLORS.inhibition},
  ],
};

/** Derive signed membrane-drive samples if an older adapter omits them.
 * Never infer a path across a reset or alter the original result arrays.
 */
export function plotSeries(result, key) {
  if (Array.isArray(result.series[key])) return result.series[key];
  if (key !== "excitatory_current_pA" && key !== "inhibitory_current_pA") return [];
  const excitatory = key === "excitatory_current_pA";
  const conductance = result.series[excitatory ? "excitatory_nS" : "inhibitory_nS"];
  const reversal = result.parameters.membrane[excitatory ? "excitatory_reversal_mV" : "inhibitory_reversal_mV"];
  return conductance?.map((value, index) => value * (reversal - result.series.voltage_mV[index])) || [];
}

/** Mark incoming sampled segments that cross a discontinuity in (left, right].
 * The samples and event arrays remain unchanged; no trajectory is reconstructed.
 */
export function discontinuityMask(times, eventTimes = []) {
  const mask = Array(times.length).fill(false);
  if (times.length < 2 || eventTimes.length === 0) return mask;
  const events = [...eventTimes].sort((a, b) => a - b);
  let eventIndex = 0;
  while (eventIndex < events.length && events[eventIndex] <= times[0]) eventIndex++;
  for (let index = 1; index < times.length; index++) {
    while (eventIndex < events.length && events[eventIndex] <= times[index]) {
      if (events[eventIndex] > times[index - 1]) mask[index] = true;
      eventIndex++;
    }
  }
  return mask;
}

export function lineDiscontinuityMask(result, key) {
  let events = [];
  if (["voltage_mV", "excitatory_current_pA", "inhibitory_current_pA"].includes(key)) events = result.spike_times_ms || [];
  if (key === "glutamate_uM" || key === "gaba_uM") {
    const synapse = result.parameters[key === "glutamate_uM" ? "glutamate" : "gaba"];
    if (synapse.release_dose_uM_um > 0) events = synapse.release_times_ms;
  }
  return discontinuityMask(result.series.time_ms, events);
}

/** Recorded postrelease samples only: never interpolate an event concentration. */
export function concentrationReleaseSamples(result, key) {
  if (key !== "glutamate_uM" && key !== "gaba_uM") return [];
  const synapse = result.parameters[key === "glutamate_uM" ? "glutamate" : "gaba"];
  if (!(synapse.release_dose_uM_um > 0)) return [];
  const times = result.series.time_ms;
  const values = result.series[key];
  const samples = [];
  for (const event of synapse.release_times_ms) {
    let left = 0, right = times.length;
    while (left < right) {
      const middle = (left + right) >>> 1;
      if (times[middle] < event) left = middle + 1;
      else right = middle;
    }
    // The engine's timeline includes exact release times. If a different caller
    // omits one, do not substitute a nearby value or invent a release sample.
    if (left < times.length && times[left] === event) {
      samples.push({time_ms: event, concentration_uM: values[left]});
    }
  }
  return samples;
}

/** Exact LIF event endpoints, separate from the sampled voltage polyline. */
export function exactResetSegments(result) {
  const membrane = result.parameters.membrane;
  return (result.spike_times_ms || []).map(time => ({
    time_ms: time, threshold_mV: membrane.threshold_mV, reset_mV: membrane.reset_mV,
  }));
}

function nearestIndex(values, value) {
  let lo = 0;
  let hi = values.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && value - values[lo - 1] < values[lo] - value) return lo - 1;
  return lo;
}

function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const base = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / base;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * base;
}

function ticks(low, high, target = 4) {
  const step = niceStep((high - low) / target);
  const output = [];
  for (let value = Math.ceil((low - step * 1e-8) / step) * step;
       value <= high + step * 1e-8; value += step) {
    output.push(Math.abs(value) < step * 1e-8 ? 0 : value);
  }
  return output;
}

function tickLabel(value) {
  const absolute = Math.abs(value);
  if (absolute >= 10000) return `${(value / 1000).toFixed(0)}k`;
  if (Number.isInteger(value)) return String(value);
  if (absolute >= 1) return value.toFixed(1).replace(/\.0$/, "");
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function readable(value, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function legendItem(text, color, dashed = false) {
  const item = document.createElement("span");
  item.className = "plot-legend-item";
  item.style.cssText = "display:inline-flex;align-items:center;gap:6px;white-space:nowrap";
  const mark = document.createElement("i");
  mark.setAttribute("aria-hidden", "true");
  mark.style.cssText = `display:inline-block;width:15px;border-top:2px ${dashed ? "dashed" : "solid"} ${color}`;
  item.append(mark, document.createTextNode(text));
  return item;
}

export class ScientificPlots {
  constructor(container) {
    if (!(container instanceof HTMLElement)) throw new Error("A chart container is required.");
    this.container = container;
    this.result = null;
    this.cursor = null;
    this.hoverIndex = null;
    this.frame = null;
    this.destroyed = false;
    this.charts = [];
    this.showComparison = true;
    container.replaceChildren();
    const comparisonControl = document.createElement("label");
    comparisonControl.hidden = true;
    comparisonControl.className = "plot-comparison-control";
    comparisonControl.style.cssText = "margin:0 0 12px;font-size:12px;color:#333F48";
    const comparisonInput = document.createElement("input");
    comparisonInput.type = "checkbox";
    comparisonInput.id = "showDrugBaseline";
    comparisonInput.checked = true;
    comparisonInput.style.cssText = "accent-color:#6C1D45;margin-right:8px";
    comparisonInput.addEventListener("change", () => {
      this.showComparison = comparisonInput.checked;
      this.charts.forEach(chart => {chart.dirty = true;});
      this.scheduleDraw();
    });
    comparisonControl.append(comparisonInput, document.createTextNode("Show no-drug control (dashed) — same receptor model and inputs"));
    this.comparisonControl = comparisonControl;
    container.append(comparisonControl);
    const paired = document.createElement("div");
    paired.className = "plot-grid";
    paired.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:16px;margin-top:16px";
    for (const definition of DEFINITIONS) {
      const chart = this.createChart(definition);
      this.charts.push(chart);
      (definition.id === "voltage" ? container : paired).append(chart.card);
    }
    container.append(paired);
    const current = this.createChart(CURRENT_DEFINITION);
    current.card.hidden = true;
    current.card.style.marginTop = "16px";
    this.charts.push(current);
    container.append(current.card);
    this.resizeObserver = new ResizeObserver(() => {
      this.charts.forEach(chart => { chart.dirty = true; });
      this.scheduleDraw();
    });
    this.charts.forEach(chart => this.resizeObserver.observe(chart.wrap));
    this.scheduleDraw();
  }

  createChart(definition) {
    const card = document.createElement("section");
    card.className = "plot-card";
    card.dataset.plot = definition.id;
    const heading = document.createElement("div");
    heading.className = "plot-heading";
    const title = document.createElement("h3");
    title.textContent = definition.title;
    const subtitle = document.createElement("p");
    subtitle.className = "plot-subtitle";
    subtitle.textContent = definition.subtitle;
    heading.append(title, subtitle);
    const legend = document.createElement("div");
    legend.className = "plot-legend";
    legend.style.cssText = "display:flex;flex-wrap:wrap;gap:9px 16px;font-size:12px;color:#333F48;margin:0 0 8px";
    definition.lines.forEach(line => legend.append(legendItem(line.label, line.color)));
    if (definition.id === "voltage") {
      legend.append(legendItem("Threshold", COLORS.threshold, true));
      legend.append(legendItem("Spike / reset event", COLORS.spike));
    }
    const wrap = document.createElement("div");
    wrap.className = "plot-wrap";
    wrap.style.cssText = `position:relative;width:100%;height:${definition.height}px;min-width:0`;
    const canvas = document.createElement("canvas");
    canvas.id = `${definition.id}-plot`;
    canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:pan-y";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `${definition.title} versus time in milliseconds. ${definition.subtitle}.`);
    const tooltip = document.createElement("div");
    tooltip.className = "plot-tooltip";
    tooltip.hidden = true;
    tooltip.style.cssText = "position:absolute;z-index:4;pointer-events:none;background:#ffffff;border:1px solid #ccd2d6;border-radius:8px;padding:9px 11px;color:#333F48;font-size:12px;line-height:1.6;box-shadow:0 8px 24px #333F4826;white-space:pre;max-width:calc(100% - 12px)";
    wrap.append(canvas, tooltip);
    card.append(heading, legend, wrap);
    const chart = { ...definition, card, wrap, canvas, tooltip, legend, subtitleElement: subtitle,
      buffer: document.createElement("canvas"), dirty: true };
    chart.move = event => this.onPointerMove(chart, event);
    chart.leave = () => {
      this.hoverIndex = null;
      this.charts.forEach(item => { item.tooltip.hidden = true; });
      this.scheduleDraw();
    };
    canvas.addEventListener("pointermove", chart.move);
    canvas.addEventListener("pointerleave", chart.leave);
    return chart;
  }

  setResult(result) {
    const times = result?.series?.time_ms;
    if (!Array.isArray(times) || times.length < 2) throw new Error("The simulation has no chart timeline.");
    for (const definition of DEFINITIONS) {
      for (const line of definition.lines) {
        if (result.series[line.key]?.length !== times.length) throw new Error(`Misaligned chart series: ${line.key}`);
      }
    }
    this.result = result;
    this.comparisonControl.hidden = !result.comparison?.baseline;
    const kinetic = Boolean(result.pharmacology);
    this.charts.find(chart => chart.id === "current").card.hidden = !kinetic;
    const activation = this.charts.find(chart => chart.id === "occupancy");
    activation.subtitleElement.textContent = kinetic
      ? "Calculated channel-open fraction; distinct from ligand binding"
      : DEFINITIONS.find(definition => definition.id === "occupancy").subtitle;
    for (const chart of this.charts) {
      chart.canvas.setAttribute("aria-label", `${chart.title} versus time in milliseconds. ${chart.subtitleElement.textContent}. ${result.comparison?.baseline && chart.id !== "concentration" ? "Solid curves show this experiment; optional dashed curves show the matched no-drug control." : ""}`);
    }
    this.cursor = null;
    this.hoverIndex = null;
    this.charts.forEach(chart => { chart.dirty = true; chart.tooltip.hidden = true; });
    this.scheduleDraw();
  }

  setCursor(timeMs) {
    this.cursor = Number.isFinite(timeMs) ? timeMs : null;
    this.scheduleDraw();
  }

  scheduleDraw() {
    if (this.frame !== null || this.destroyed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.charts.forEach(chart => this.draw(chart));
    });
  }

  ranges(chart) {
    const times = this.result.series.time_ms;
    let low = chart.id === "voltage" ? this.result.parameters.membrane.threshold_mV : 0;
    let high = chart.id === "voltage" ? low : chart.id === "occupancy" ? 100 : 1;
    if (chart.id === "voltage" && this.result.spike_times_ms?.length) {
      low = Math.min(low, this.result.parameters.membrane.reset_mV);
    }
    if (chart.id !== "occupancy") {
      for (const result of this.resultsFor(chart)) {
        if (chart.id === "voltage" && result.spike_times_ms?.length) {
          low = Math.min(low, result.parameters.membrane.reset_mV);
          high = Math.max(high, result.parameters.membrane.threshold_mV);
        }
        for (const line of chart.lines) {
          for (const value of plotSeries(result, line.key)) {
            low = Math.min(low, value);
            high = Math.max(high, value);
          }
        }
      }
      if (chart.id === "voltage") {
        const step = niceStep(Math.max(high - low, 10) / 5);
        low = Math.floor((low - 1) / step) * step;
        high = Math.ceil((high + 1) / step) * step;
      } else if (chart.id === "current") {
        const step = niceStep(Math.max(high - low, 1) / 4);
        low = Math.floor((low - step * .1) / step) * step;
        high = Math.ceil((high + step * .1) / step) * step;
      } else {
        const step = niceStep(high / 4);
        high = Math.max(step, Math.ceil(high * 1.06 / step) * step);
      }
    }
    return { t0: times[0], t1: times[times.length - 1], low, high };
  }

  resultsFor(chart) {
    const baseline = this.result?.comparison?.baseline;
    // Transmitter transport is shared and unchanged by this receptor-only module.
    // Show a single concentration trace instead of indistinguishable duplicates.
    return baseline && this.showComparison !== false && chart.id !== "concentration"
      ? [baseline, this.result] : [this.result];
  }

  buildBase(chart) {
    const width = Math.max(220, chart.wrap.clientWidth);
    const height = chart.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    for (const canvas of [chart.canvas, chart.buffer]) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    chart.width = width;
    chart.dpr = dpr;
    const context = chart.buffer.getContext("2d");
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = COLORS.background;
    context.fillRect(0, 0, width, height);
    context.font = "12px Segoe UI, Arial, sans-serif";
    if (!this.result) {
      context.fillStyle = COLORS.muted;
      context.textAlign = "center";
      context.fillText("Run a simulation to view calculated results", width / 2, height / 2);
      chart.dirty = false;
      return;
    }
    const range = this.ranges(chart);
    const area = { left: 55, right: width - 16, top: 23, bottom: height - 36 };
    chart.range = range;
    chart.area = area;
    chart.x = time => area.left + (time - range.t0) / (range.t1 - range.t0) * (area.right - area.left);
    chart.y = value => area.bottom - (value - range.low) / (range.high - range.low) * (area.bottom - area.top);
    context.lineWidth = 1;
    context.strokeStyle = COLORS.grid;
    context.fillStyle = COLORS.muted;
    for (const value of ticks(range.low, range.high, 4)) {
      const y = chart.y(value);
      context.beginPath(); context.moveTo(area.left, y); context.lineTo(area.right, y); context.stroke();
      context.textAlign = "right";
      context.fillText(tickLabel(value), area.left - 10, y + 4);
    }
    const timeTicks = ticks(range.t0, range.t1, width < 500 ? 4 : 6);
    for (const time of timeTicks) {
      const x = chart.x(time);
      context.beginPath(); context.moveTo(x, area.top); context.lineTo(x, area.bottom); context.stroke();
      context.textAlign = "center";
      context.fillText(tickLabel(time), x, area.bottom + 18);
    }
    context.textAlign = "left";
    context.fillText(chart.unit, 6, 13);
    context.textAlign = "right";
    context.fillText("Time (ms)", area.right, height - 2);
    context.save();
    context.beginPath(); context.rect(area.left - 3, area.top - 4, area.right - area.left + 6, area.bottom - area.top + 8); context.clip();
    if (chart.id === "voltage") {
      const threshold = this.result.parameters.membrane.threshold_mV;
      context.strokeStyle = COLORS.threshold;
      context.setLineDash([5, 5]);
      context.beginPath(); context.moveTo(area.left, chart.y(threshold)); context.lineTo(area.right, chart.y(threshold)); context.stroke();
      context.setLineDash([]);
    }
    for (const result of this.resultsFor(chart)) {
      const baseline = result !== this.result;
      const times = result.series.time_ms;
      context.globalAlpha = baseline ? .65 : 1;
      context.setLineDash(baseline ? [5, 4] : []);
      for (const line of chart.lines) {
        const values = plotSeries(result, line.key);
        const breaks = lineDiscontinuityMask(result, line.key);
        context.strokeStyle = line.color;
        context.lineWidth = baseline ? 1.4 : 1.8;
        context.lineJoin = "round";
        context.beginPath();
        for (let index = 0; index < times.length; index++) {
          const x = chart.x(times[index]);
          const y = chart.y(values[index] * (chart.id === "occupancy" ? 100 : 1));
          if (index === 0 || breaks[index]) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
        if (chart.id === "concentration") {
          context.fillStyle = line.color;
          for (const sample of concentrationReleaseSamples(result, line.key)) {
            // A standalone dot keeps a final-time release visible after moveTo,
            // without adding an incoming segment or an inferred left limit.
            context.beginPath();
            context.arc(chart.x(sample.time_ms), chart.y(sample.concentration_uM), 2.4, 0, Math.PI * 2);
            context.fill();
          }
        }
      }
      if (chart.id === "voltage") {
        context.fillStyle = baseline ? COLORS.muted : COLORS.spike;
        context.strokeStyle = baseline ? COLORS.muted : COLORS.spike;
        context.lineWidth = baseline ? 1 : 1.2;
        for (const event of exactResetSegments(result)) {
          const x = chart.x(event.time_ms);
          const y = chart.y(event.threshold_mV);
          // Every overlay owns its exact event list; no cross-result interpolation.
          context.beginPath(); context.moveTo(x, y); context.lineTo(x, chart.y(event.reset_mV)); context.stroke();
          if (!baseline) {
            context.beginPath(); context.moveTo(x, y); context.lineTo(x - 4, y - 7); context.lineTo(x + 4, y - 7); context.closePath(); context.fill();
          }
        }
      }
    }
    context.setLineDash([]);
    context.globalAlpha = 1;
    context.restore();
    chart.dirty = false;
  }

  draw(chart) {
    if (chart.card?.hidden) return;
    // A chart can be hidden by its workspace tab while its own card stays
    // enabled. Preserve pending work until it has a real layout again; the
    // ResizeObserver or tab reveal will request the correctly sized frame.
    if (typeof chart.wrap?.getClientRects === "function" && chart.wrap.getClientRects().length === 0) return;
    if (chart.dirty || chart.width !== Math.max(220, chart.wrap.clientWidth)) this.buildBase(chart);
    const context = chart.canvas.getContext("2d");
    context.setTransform(chart.dpr, 0, 0, chart.dpr, 0, 0);
    context.clearRect(0, 0, chart.width, chart.height);
    context.drawImage(chart.buffer, 0, 0, chart.width, chart.height);
    if (!this.result) return;
    const { area, range } = chart;
    const drawLine = (time, color, dashed) => {
      if (time === null || time < range.t0 || time > range.t1) return;
      const x = chart.x(time);
      context.strokeStyle = color;
      context.lineWidth = 1;
      context.setLineDash(dashed ? [3, 3] : []);
      context.beginPath(); context.moveTo(x, area.top); context.lineTo(x, area.bottom); context.stroke();
      context.setLineDash([]);
    };
    drawLine(this.cursor, COLORS.cursor, false);
    if (this.hoverIndex !== null) {
      const time = this.result.series.time_ms[this.hoverIndex];
      drawLine(time, COLORS.muted, true);
      for (const line of chart.lines) {
        const value = plotSeries(this.result, line.key)[this.hoverIndex] * (chart.id === "occupancy" ? 100 : 1);
        context.fillStyle = line.color;
        context.beginPath(); context.arc(chart.x(time), chart.y(value), 3, 0, Math.PI * 2); context.fill();
      }
    }
  }

  onPointerMove(chart, event) {
    if (!this.result || !chart.area) return;
    const bounds = chart.canvas.getBoundingClientRect();
    const x = (event.clientX - bounds.left) * chart.width / bounds.width;
    const y = (event.clientY - bounds.top) * chart.height / bounds.height;
    if (x < chart.area.left || x > chart.area.right || y < chart.area.top || y > chart.area.bottom) {
      chart.leave();
      return;
    }
    const time = chart.range.t0 + (x - chart.area.left) / (chart.area.right - chart.area.left) * (chart.range.t1 - chart.range.t0);
    this.hoverIndex = nearestIndex(this.result.series.time_ms, time);
    const exactTime = this.result.series.time_ms[this.hoverIndex];
    const lines = [`Recorded sample at ${readable(exactTime)} ms`];
    for (const line of chart.lines) {
      const value = plotSeries(this.result, line.key)[this.hoverIndex] * (chart.id === "occupancy" ? 100 : 1);
      lines.push(`${line.label}  ${readable(value)} ${chart.id === "occupancy" ? "%" : chart.unit}`);
    }
    const baseline = this.result.comparison?.baseline;
    if (baseline && this.showComparison && chart.id !== "concentration") {
      const index = nearestIndex(baseline.series.time_ms, exactTime);
      lines.push(`No-drug control at ${readable(baseline.series.time_ms[index])} ms`);
      for (const line of chart.lines) {
        const value = plotSeries(baseline, line.key)[index] * (chart.id === "occupancy" ? 100 : 1);
        lines.push(`${line.label}  ${readable(value)} ${chart.id === "occupancy" ? "%" : chart.unit}`);
      }
    }
    if (chart.id === "voltage") lines.push(`Threshold  ${readable(this.result.parameters.membrane.threshold_mV)} mV`);
    this.charts.forEach(item => { item.tooltip.hidden = item !== chart; });
    chart.tooltip.textContent = lines.join("\n");
    chart.tooltip.hidden = false;
    const cssX = event.clientX - bounds.left;
    const cssY = event.clientY - bounds.top;
    chart.tooltip.style.left = `${Math.max(5, Math.min(cssX + 12, bounds.width - chart.tooltip.offsetWidth - 6))}px`;
    chart.tooltip.style.top = `${Math.max(4, Math.min(cssY + 12, bounds.height - chart.tooltip.offsetHeight - 4))}px`;
    this.scheduleDraw();
  }

  destroy() {
    this.destroyed = true;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.charts.forEach(chart => {
      chart.canvas.removeEventListener("pointermove", chart.move);
      chart.canvas.removeEventListener("pointerleave", chart.leave);
    });
    this.container.replaceChildren();
  }
}
