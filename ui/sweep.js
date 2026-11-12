/* Deterministic parameter sweeps operate on a completed run, never on a draft. */

const METRICS = {
  spike_count: {label: 'Spike count', unit: 'spikes', decimals: 0},
  peak_membrane_mV: {label: 'Peak LIF voltage', unit: 'mV', decimals: 2},
  first_spike_latency_ms: {label: 'First-spike latency', unit: 'ms', decimals: 2},
};

const STYLE = `
.sweep-panel{margin-top:27px;border:1px solid #DDD5D5;border-radius:9px;background:#FFFFFF;overflow:hidden}.sweep-header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding:22px 23px 17px}.sweep-header h2{font-size:19px;font-weight:500;letter-spacing:-.3px;margin:4px 0 6px}.sweep-header p{font-size:11px;line-height:1.65;color:#62656B;margin:0;max-width:650px}.sweep-tag{font-size:8px;letter-spacing:1px;border:1px solid #D5C6CD;border-radius:4px;padding:5px 8px;color:#6C1D45;white-space:nowrap;margin-top:4px}.sweep-controls{display:grid;grid-template-columns:1fr 1fr .68fr;gap:20px;padding:17px 23px 20px;border-top:1px solid #E5E0DC;border-bottom:1px solid #E5E0DC;background:#FFFFFF}.sweep-fieldset{border:0;padding:0;margin:0;min-width:0}.sweep-fieldset legend,.sweep-grid-label{font-size:11px;font-weight:550;color:#333F48;margin-bottom:9px;display:block}.sweep-fieldset legend small{font-weight:400;color:#62656B;font-size:9px;margin-left:4px}.sweep-range-pair{display:grid;grid-template-columns:1fr 1fr;gap:10px}.sweep-range-pair label{display:block;font-size:9px;color:#62656B}.sweep-range-pair input,.sweep-grid-select,.sweep-metric-select{background:#FFFFFF;border:1px solid #CFC5C8;border-radius:5px;color:#333F48;font:inherit;font-size:11px;height:32px;padding:5px 8px;min-width:0;width:100%;margin-top:4px}.sweep-range-pair input{font-variant-numeric:tabular-nums}.sweep-grid-select{margin-top:0}.sweep-grid-cost{font-size:9px;color:#62656B;margin:7px 0 0}.sweep-actions{display:flex;align-items:center;gap:16px;padding:16px 23px}.sweep-actions .button{padding:0 18px;min-width:137px}.sweep-status{font-size:10px;color:#62656B;margin:0;line-height:1.6}.sweep-error{margin:0 23px 16px;padding:11px 13px;background:#FFFFFF;color:#6C1D45;border:1px solid #B77E98;border-radius:6px;font-size:11px;line-height:1.5}.sweep-error[hidden]{display:none}.sweep-output{padding:0 23px 21px}.sweep-output[hidden]{display:none}.sweep-output-header{display:flex;align-items:center;justify-content:space-between;gap:16px;border-top:1px solid #DDD5D5;padding-top:17px;margin-bottom:10px}.sweep-output-header h3{font-size:12px;font-weight:550;margin:0 0 4px}.sweep-source{font-size:9px;color:#62656B;margin:0}.sweep-metric-label{display:flex;align-items:center;gap:9px;font-size:9px;color:#62656B;white-space:nowrap}.sweep-metric-select{width:163px;margin:0;cursor:pointer}.sweep-canvas-wrap{position:relative;min-width:0}.sweep-canvas-wrap canvas{display:block;width:100%;height:340px;touch-action:pan-y}.sweep-tooltip{position:absolute;z-index:4;pointer-events:none;background:#FFFFFF;border:1px solid #CFC5C8;border-radius:5px;padding:9px 11px;font-size:11px;line-height:1.65;color:#333F48;white-space:pre;box-shadow:0 6px 22px #333F4822}.sweep-tooltip[hidden]{display:none}.sweep-foot{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-top:8px}.sweep-foot p{font-size:9px;color:#62656B;line-height:1.6;margin:0;max-width:500px}.sweep-downloads{display:flex;gap:8px;white-space:nowrap}.sweep-downloads .button{padding:0 12px;min-height:30px;font-size:10px}.sweep-empty{color:#62656B;font-size:11px;line-height:1.8;margin:0;padding:0 23px 20px}.sweep-empty[hidden]{display:none}
.sweep-resolution-warning{margin:12px 0 17px;padding:14px 16px;border:1px solid #EAAA00;border-left:3px solid #EAAA00;border-radius:6px;background:#FFFFFF;color:#333F48;font-size:11px;line-height:1.65}.sweep-resolution-warning[hidden]{display:none}.sweep-resolution-warning h4{margin:0 0 6px;color:#6C1D45;font-size:12px;font-weight:600}.sweep-resolution-warning p{margin:6px 0 0}.sweep-resolution-warning ul{margin:8px 0;padding-left:19px}.sweep-resolution-warning li+li{margin-top:4px}.sweep-resolution-warning .sweep-resolution-note{color:#62656B}
.sweep-drug-budget{margin:0;padding:12px 23px 0;font-size:10px;line-height:1.65;color:#62656B}
@media(max-width:1000px){.sweep-controls{grid-template-columns:1fr 1fr}.sweep-grid-control{grid-column:1/-1;display:flex;align-items:center;gap:12px}.sweep-grid-label{margin:0}.sweep-grid-select{width:115px}.sweep-grid-cost{margin:0}.sweep-output-header{align-items:flex-start}.sweep-metric-label{display:block}.sweep-metric-select{display:block;margin-top:4px}.sweep-foot{align-items:flex-start;flex-direction:column}.sweep-header{gap:12px}.sweep-tag{display:none}}
@media(max-width:650px){.sweep-header{padding:18px}.sweep-controls{padding:16px 18px;gap:17px}.sweep-actions{padding:15px 18px;align-items:flex-start;flex-direction:column;gap:9px}.sweep-output{padding:0 14px 18px}.sweep-header h2{font-size:18px}.sweep-fieldset legend{font-size:10px}.sweep-fieldset legend small{display:block;margin-left:0}.sweep-output-header{padding-top:15px;flex-direction:column;gap:10px}.sweep-metric-label{display:flex}.sweep-metric-select{margin:0}.sweep-grid-control{flex-wrap:wrap}.sweep-canvas-wrap canvas{height:320px}.sweep-error{margin-left:18px;margin-right:18px}}
`;

const clone = value => JSON.parse(JSON.stringify(value));
const finite = value => typeof value === 'number' && Number.isFinite(value);

export class SweepPanel {
  constructor(container, {getResult}) {
    if (!(container instanceof HTMLElement) || typeof getResult !== 'function') {
      throw new Error('A sweep container and completed-result accessor are required.');
    }
    this.container = container;
    this.getResult = getResult;
    this.data = null;
    this.sourceRunId = null;
    this.running = false;
    this.experimentBusy = false;
    this.metric = 'spike_count';
    this.hoverCell = null;
    this.area = null;
    this.drawFrame = null;
    this.render();
    this.bind();
    this.updateAvailability();
    window.neurochemSweepState = () => this.snapshot();
  }

  render() {
    if (!document.getElementById('neurochem-sweep-style')) {
      const style = document.createElement('style');
      style.id = 'neurochem-sweep-style';
      style.textContent = STYLE;
      document.head.append(style);
    }
    this.container.classList.add('sweep-panel');
    this.container.innerHTML = `
      <div class="sweep-header"><div><span class="eyebrow">SYSTEMATIC EXPERIMENTS</span><h2>Map the excitation–inhibition balance.</h2><p>Vary glutamate release and GABA-A receptor availability across a small grid. Every cell is a separate deterministic simulation using the remaining settings of your last completed run.</p></div><span class="sweep-tag">TWO-PARAMETER SWEEP</span></div>
      <div class="sweep-controls">
        <fieldset class="sweep-fieldset"><legend>Glutamate release dose <small>µM·µm</small></legend><div class="sweep-range-pair"><label for="sweepDoseMin">Minimum<input id="sweepDoseMin" type="number" min="0" max="100000" step="any" value="100"></label><label for="sweepDoseMax">Maximum<input id="sweepDoseMax" type="number" min="0" max="100000" step="any" value="1500"></label></div></fieldset>
        <fieldset class="sweep-fieldset"><legend>GABA-A availability <small>relative ×</small></legend><div class="sweep-range-pair"><label for="sweepGabaMin">Minimum<input id="sweepGabaMin" type="number" min="0" max="100" step="any" value="0"></label><label for="sweepGabaMax">Maximum<input id="sweepGabaMax" type="number" min="0" max="100" step="any" value="3"></label></div></fieldset>
        <div class="sweep-grid-control"><label class="sweep-grid-label" for="sweepGridSize">Grid size</label><select class="sweep-grid-select" id="sweepGridSize"><option value="3">3 × 3</option><option value="5" selected>5 × 5</option><option value="7">7 × 7</option></select><p class="sweep-grid-cost" id="sweepCost">25 simulations · smaller grids finish faster</p></div>
      </div>
      <p id="sweepDrugBudget" class="sweep-drug-budget" hidden>For drug-enabled grids, first run a shorter observation window and start with 3 × 3. Large grids may exceed the computation limit; the app keeps your chosen timestep.</p>
      <div class="sweep-actions"><button id="runSweep" type="button" class="button button-primary" disabled>Run parameter sweep</button><p id="sweepStatus" class="sweep-status" role="status" aria-live="polite">Complete an experiment first to choose the sweep's source settings.</p></div>
      <div id="sweepError" class="sweep-error" role="alert" hidden></div>
      <p class="sweep-empty" id="sweepEmpty">The heatmap will appear here. Sweeping does not change your current experiment or interrupt its playback.</p>
      <div id="sweepOutput" class="sweep-output" hidden>
        <div class="sweep-output-header"><div><h3 id="sweepResultTitle">Spike count across the grid</h3><p id="sweepSource" class="sweep-source"></p></div><label class="sweep-metric-label" for="sweepMetric">COLOR BY<select id="sweepMetric" class="sweep-metric-select"><option value="spike_count">Spike count</option><option value="peak_membrane_mV">Peak LIF voltage</option><option value="first_spike_latency_ms">First-spike latency</option></select></label></div>
        <aside id="sweepResolutionWarning" class="sweep-resolution-warning" role="status" aria-live="polite" aria-labelledby="sweepResolutionTitle" hidden><h4 id="sweepResolutionTitle">Numerical resolution needs review</h4><div id="sweepResolutionDetails"></div></aside>
        <div class="sweep-canvas-wrap"><canvas id="sweepCanvas" role="img" aria-label="Parameter sweep heatmap; hover a cell to inspect its exact inputs and result" tabindex="0"></canvas><div id="sweepTooltip" class="sweep-tooltip" hidden></div></div>
        <div class="sweep-foot"><p id="sweepInterpretation">Hover a cell for its exact settings and result. These are deterministic outcomes for illustrative model parameters.</p><div class="sweep-downloads"><button type="button" id="exportSweepCsv" class="button button-secondary" title="CSV begins with # metadata lines. In pandas, read with comment='#'.">Sweep CSV</button><button type="button" id="exportSweepPng" class="button button-secondary">Figure PNG</button></div></div>
      </div>`;
    this.elements = Object.fromEntries([
      'sweepDoseMin', 'sweepDoseMax', 'sweepGabaMin', 'sweepGabaMax', 'sweepGridSize',
      'runSweep', 'sweepMetric', 'sweepStatus', 'sweepError', 'sweepCanvas', 'sweepTooltip',
      'exportSweepCsv', 'exportSweepPng', 'sweepCost', 'sweepEmpty', 'sweepOutput',
      'sweepResultTitle', 'sweepSource', 'sweepInterpretation',
      'sweepResolutionWarning', 'sweepResolutionDetails', 'sweepDrugBudget',
    ].map(id => [id, this.container.querySelector(`#${id}`)]));
  }

  bind() {
    this.elements.runSweep.addEventListener('click', () => this.run());
    this.elements.sweepGridSize.addEventListener('change', () => this.updateCost());
    this.elements.sweepMetric.addEventListener('change', () => {
      this.metric = this.elements.sweepMetric.value;
      this.hoverCell = null;
      this.elements.sweepTooltip.hidden = true;
      this.updateOutputLabels();
      this.scheduleDraw();
    });
    this.elements.sweepCanvas.addEventListener('pointermove', event => this.showTooltip(event));
    this.elements.sweepCanvas.addEventListener('pointerleave', () => {
      this.hoverCell = null;
      this.elements.sweepTooltip.hidden = true;
      this.scheduleDraw();
    });
    this.elements.sweepCanvas.addEventListener('keydown', event => this.moveKeyboardCell(event));
    this.elements.exportSweepCsv.addEventListener('click', () => this.download('sweep.csv', 'SynaptiCob_sweep.csv'));
    this.elements.exportSweepPng.addEventListener('click', () => this.download('figure.png', 'SynaptiCob_sweep.png'));
    document.addEventListener('neurochemsim:result', () => this.updateAvailability());
    document.addEventListener('neurochemsim:busy', event => {
      this.experimentBusy = Boolean(event.detail);
      this.updateAvailability();
    });
    this.resizeObserver = new ResizeObserver(() => this.scheduleDraw());
    this.resizeObserver.observe(this.elements.sweepCanvas.parentElement);
  }

  updateCost() {
    const size = Number(this.elements.sweepGridSize.value);
    this.elements.sweepCost.textContent = `${size * size} simulations · smaller grids finish faster`;
  }

  updateAvailability() {
    const result = this.getResult();
    this.elements.sweepDrugBudget.hidden = !result?.parameters?.pharmacology;
    this.elements.runSweep.disabled = this.running || this.experimentBusy || !result;
    if (this.running) return;
    if (!result) {
      this.elements.sweepStatus.textContent = 'Complete an experiment first to choose the sweep’s source settings.';
    } else if (this.experimentBusy) {
      this.elements.sweepStatus.textContent = 'Wait for the experiment to complete before starting a new sweep.';
    } else {
      this.elements.sweepStatus.textContent = `A new sweep uses completed run ${shortId(result.run_id)}. Pending control edits are not included.`;
    }
    if (this.data) this.updateOutputLabels();
  }

  readAxes() {
    const read = (id, label, upper) => {
      const text = this.elements[id].value.trim();
      const value = Number(text);
      if (text === '' || !finite(value) || value < 0 || value > upper) {
        throw new Error(`${label} must be a finite number from 0 to ${upper}.`);
      }
      return value;
    };
    const doseMin = read('sweepDoseMin', 'Minimum glutamate dose', 100000);
    const doseMax = read('sweepDoseMax', 'Maximum glutamate dose', 100000);
    const gabaMin = read('sweepGabaMin', 'Minimum GABA-A availability', 100);
    const gabaMax = read('sweepGabaMax', 'Maximum GABA-A availability', 100);
    if (doseMax <= doseMin) throw new Error('Maximum glutamate dose must be greater than its minimum.');
    if (gabaMax <= gabaMin) throw new Error('Maximum GABA-A availability must be greater than its minimum.');
    const size = Number(this.elements.sweepGridSize.value);
    if (![3, 5, 7].includes(size)) throw new Error('Choose a 3 × 3, 5 × 5, or 7 × 7 grid.');
    const doses = linspace(doseMin, doseMax, size);
    const availabilities = linspace(gabaMin, gabaMax, size);
    if (new Set(doses).size !== size || new Set(availabilities).size !== size) {
      throw new Error('Widen the parameter range so every grid value is distinct.');
    }
    return {glutamate_doses_uM_um: doses, gaba_availabilities: availabilities};
  }

  setRunning(running) {
    this.running = running;
    this.elements.runSweep.textContent = running ? 'Calculating sweep…' : 'Run parameter sweep';
    for (const id of ['sweepDoseMin', 'sweepDoseMax', 'sweepGabaMin', 'sweepGabaMax', 'sweepGridSize']) {
      this.elements[id].disabled = running;
    }
    this.updateAvailability();
  }

  async run() {
    if (this.running || this.experimentBusy) return;
    this.clearError();
    const source = this.getResult();
    if (!source) { this.showError('Complete an experiment before running a parameter sweep.'); return; }
    let axes;
    try { axes = this.readAxes(); }
    catch (error) { this.showError(error.message); return; }
    const parameters = clone(source.parameters);
    const sourceRunId = source.run_id;
    const count = axes.glutamate_doses_uM_um.length * axes.gaba_availabilities.length;
    this.setRunning(true);
    this.elements.sweepStatus.textContent = `Running ${count} deterministic simulations from completed run ${shortId(sourceRunId)}. Your experiment and playback remain available.`;
    try {
      const response = await fetch('/api/sweep', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({parameters, ...axes}),
      });
      const payload = await readResponse(response);
      validateSweep(payload);
      this.data = payload;
      this.area = null;
      this.sourceRunId = sourceRunId;
      this.hoverCell = null;
      this.elements.sweepTooltip.hidden = true;
      this.elements.sweepOutput.hidden = false;
      this.elements.sweepEmpty.hidden = true;
      this.updateOutputLabels();
      this.scheduleDraw();
    } catch (error) {
      this.showError(`${error.message || 'The sweep could not finish.'}${this.data ? ' The previous heatmap is preserved.' : ''}`);
    } finally {
      this.setRunning(false);
    }
  }

  updateOutputLabels() {
    if (!this.data) return;
    this.elements.sweepResultTitle.textContent = `${METRICS[this.metric].label} across the grid`;
    this.elements.sweepSource.textContent = `Heatmap source: completed run ${shortId(this.sourceRunId)} · ${this.data.axes.glutamate_doses_uM_um.length} × ${this.data.axes.gaba_availabilities.length} simulations · sweep ${shortId(this.data.sweep_id)}`;
    const allUndefinedLatency = this.metric === 'first_spike_latency_ms' && this.data.first_spike_latency_ms.every(row => row.every(value => value === null));
    const latencyNote = `Latency is measured from ${sweepLatencyReference(this.data)}.`;
    this.elements.sweepInterpretation.textContent = allUndefinedLatency
      ? `${latencyNote} No grid cell generated a spike, so latency is undefined throughout. Hatched cells mean no spike; no numerical latency scale applies.`
      : this.metric === 'first_spike_latency_ms'
      ? `${latencyNote} Hatched cells had no spike. Hover or use arrow keys for exact cell values.`
      : 'Hover a cell, or focus the heatmap and use arrow keys, for exact settings and results. These are deterministic illustrative outcomes.';
    this.elements.sweepCanvas.setAttribute('aria-label', `${METRICS[this.metric].label} heatmap. ${this.metric === 'first_spike_latency_ms' ? latencyNote + ' ' : ''}Horizontal axis: glutamate release dose in micromolar micrometers. Vertical axis: relative GABA-A receptor availability. Use arrow keys to inspect cells.`);
    this.updateResolutionWarning();
  }

  updateResolutionWarning() {
    // Read only the last successfully completed sweep. Draft edits, pending
    // requests and failed requests must not clear its numerical qualification.
    const resolution = this.data?.numerical_resolution;
    const banner = this.elements.sweepResolutionWarning;
    const details = this.elements.sweepResolutionDetails;
    details.replaceChildren();
    banner.hidden = resolution?.status !== 'review_required';
    if (banner.hidden) return;

    const paragraph = (message, className = '') => {
      const element = document.createElement('p');
      element.textContent = message;
      if (className) element.className = className;
      details.append(element);
    };
    const cellCount = Array.isArray(resolution.flagged_cells) ? resolution.flagged_cells.length : null;
    paragraph(`${cellCount > 0 ? `${cellCount} grid ${cellCount === 1 ? 'cell is' : 'cells are'} flagged. ` : ''}Heatmap cells are computed outcomes with unverified numerical resolution.`);

    const messages = [...new Set((Array.isArray(resolution.warnings) ? resolution.warnings : [])
      .map(warning => typeof warning?.message === 'string' ? warning.message.trim() : '')
      .filter(Boolean))];
    if (messages.length) {
      const list = document.createElement('ul');
      for (const message of messages) {
        const item = document.createElement('li');
        item.textContent = message;
        list.append(item);
      }
      details.append(list);
    }

    const recommended = resolution.recommended_dt_ms;
    if (finite(recommended) && recommended > 0) {
      const shown = recommended < .001 ? recommended.toExponential(2) :
        recommended.toLocaleString('en-US', {maximumSignificantDigits: 4});
      paragraph(recommended < .001
        ? `Suggested refinement target: ${shown} ms. This is below the supported minimum of 0.001 ms and cannot be selected here. Consider less extreme settings and repeat refinement checks.`
        : `Suggested timestep for a refinement check: ${shown} ms. This is a starting point for comparison, not evidence that the results have converged.`);
    }
    paragraph('Compare outcomes after successive timestep refinements and, for spatial simulations, spatial-grid refinements before interpreting the heatmap. A suggested timestep is not a convergence guarantee.');
    const peakNote = typeof resolution.peak_note === 'string' ? resolution.peak_note.trim() : '';
    if (peakNote && !messages.includes(peakNote)) paragraph(peakNote, 'sweep-resolution-note');
  }

  clearError() { this.elements.sweepError.hidden = true; this.elements.sweepError.textContent = ''; }
  showError(message) { this.elements.sweepError.textContent = message; this.elements.sweepError.hidden = false; }

  async download(resource, filename) {
    if (!this.data) return;
    this.clearError();
    const button = resource === 'sweep.csv' ? this.elements.exportSweepCsv : this.elements.exportSweepPng;
    button.disabled = true;
    try {
      const query = resource === 'figure.png' ? `?metric=${encodeURIComponent(this.metric)}` : '';
      const response = await fetch(`/api/sweep-export/${encodeURIComponent(this.data.sweep_id)}/${resource}${query}`);
      if (!response.ok) await readResponse(response);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = filename;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (error) { this.showError(error.message || 'Could not export this sweep.'); }
    finally { button.disabled = false; }
  }

  scheduleDraw() {
    if (!this.data || this.drawFrame !== null) return;
    this.drawFrame = requestAnimationFrame(() => { this.drawFrame = null; this.draw(); });
  }

  draw() {
    if (!this.data || this.elements.sweepOutput.hidden) return;
    const canvas = this.elements.sweepCanvas;
    const width = Math.max(260, canvas.clientWidth);
    const height = width < 520 ? 320 : 340;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.style.height = `${height}px`;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, width, height);
    const xs = this.data.axes.glutamate_doses_uM_um;
    const ys = this.data.axes.gaba_availabilities;
    const values = this.data[this.metric];
    const metric = METRICS[this.metric];
    const valid = values.flat().filter(finite);
    let low = valid.length ? Math.min(...valid) : 0;
    let high = valid.length ? Math.max(...valid) : 1;
    const constant = low === high;
    if (constant) high = low + 1;
    const area = {left: width < 520 ? 55 : 69, right: width - 80, top: 18, bottom: height - 58};
    const cellWidth = (area.right - area.left) / xs.length;
    const cellHeight = (area.bottom - area.top) / ys.length;
    this.area = {...area, cellWidth, cellHeight, width, height, xs, ys};
    for (let row = 0; row < ys.length; row++) {
      for (let column = 0; column < xs.length; column++) {
        const value = values[row][column];
        const x = area.left + column * cellWidth;
        const y = area.bottom - (row + 1) * cellHeight;
        ctx.fillStyle = value === null ? '#F3F1EF' : cellColor(constant ? .5 : (value - low) / (high - low));
        ctx.fillRect(x + 1, y + 1, Math.max(0, cellWidth - 2), Math.max(0, cellHeight - 2));
        if (value === null) {
          ctx.save(); ctx.beginPath(); ctx.rect(x + 1, y + 1, cellWidth - 2, cellHeight - 2); ctx.clip();
          ctx.strokeStyle = '#B5AAA9'; ctx.lineWidth = 1;
          for (let offset = -cellHeight; offset < cellWidth; offset += 9) {
            ctx.beginPath(); ctx.moveTo(x + offset, y + cellHeight); ctx.lineTo(x + offset + cellHeight, y); ctx.stroke();
          }
          ctx.restore();
        }
        if (cellWidth > 48 && cellHeight > 25) {
          ctx.fillStyle = value === null ? '#333F48' : cellTextColor(constant ? .5 : (value - low) / (high - low));
          ctx.font = `${cellWidth > 75 ? 12 : 11}px Segoe UI, sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(value === null ? '—' : compact(value, metric.decimals), x + cellWidth / 2, y + cellHeight / 2);
        }
      }
    }
    ctx.font = '10px Segoe UI, sans-serif'; ctx.fillStyle = '#62656B'; ctx.textBaseline = 'alphabetic';
    const xLabels = sweepAxisLabels(xs, 2);
    const yLabels = sweepAxisLabels(ys, 3);
    ys.forEach((value, index) => {
      ctx.textAlign = 'right'; ctx.fillText(yLabels[index], area.left - 9, area.bottom - (index + .5) * cellHeight + 3, area.left - 24);
    });
    xs.forEach((value, index) => {
      ctx.textAlign = 'center'; ctx.fillText(xLabels[index], area.left + (index + .5) * cellWidth, area.bottom + 18, cellWidth - 5);
    });
    ctx.fillStyle = '#62656B'; ctx.textAlign = 'center';
    ctx.fillText('Glutamate release dose (µM·µm)', (area.left + area.right) / 2, height - 16);
    ctx.save(); ctx.translate(12, (area.top + area.bottom) / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText('GABA-A availability (relative ×)', 0, 0); ctx.restore();
    const barX = area.right + 20, barWidth = 12;
    if (valid.length) {
      for (let pixel = 0; pixel < area.bottom - area.top; pixel++) {
        ctx.fillStyle = cellColor(constant ? .5 : 1 - pixel / (area.bottom - area.top));
        ctx.fillRect(barX, area.top + pixel, barWidth, 1.1);
      }
      ctx.fillStyle = '#62656B'; ctx.font = '9px Segoe UI, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(compact(constant ? low : high, metric.decimals), barX + 17, area.top + 7);
      ctx.fillText(compact(low, metric.decimals), barX + 17, area.bottom);
      ctx.fillText(metric.unit, barX - 1, area.bottom + 18);
    } else {
      // A grid without a spike has no numerical latency range. Do not invent
      // a zero-to-one scale or visually imply that "no spike" means zero ms.
      ctx.fillStyle = '#62656B'; ctx.font = '9px Segoe UI, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText('No spike', barX - 3, area.top + 10);
      ctx.fillText('Latency', barX - 3, area.top + 29);
      ctx.fillText('undefined', barX - 3, area.top + 42);
    }
    if (this.hoverCell) {
      const {row, column} = this.hoverCell;
      const value = values[row][column];
      ctx.strokeStyle = value === null ? '#6C1D45' : cellTextColor(constant ? .5 : (value - low) / (high - low)); ctx.lineWidth = 2;
      ctx.strokeRect(area.left + column * cellWidth + 1, area.bottom - (row + 1) * cellHeight + 1, cellWidth - 2, cellHeight - 2);
    }
  }

  showTooltip(event) {
    if (!this.data || !this.area) return;
    const rect = this.elements.sweepCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    const a = this.area;
    if (x < a.left || x >= a.right || y < a.top || y >= a.bottom) {
      this.hoverCell = null; this.elements.sweepTooltip.hidden = true; this.scheduleDraw(); return;
    }
    const column = Math.floor((x - a.left) / a.cellWidth);
    const row = Math.min(a.ys.length - 1, Math.floor((a.bottom - y) / a.cellHeight));
    this.hoverCell = {row, column};
    this.positionTooltip(x, y);
    this.scheduleDraw();
  }

  positionTooltip(x, y) {
    if (!this.hoverCell || !this.data || !this.area) return;
    const {row, column} = this.hoverCell;
    const value = this.data[this.metric][row][column];
    const metric = METRICS[this.metric];
    const description = value === null ? 'No spike' : `${exact(value)} ${metric.unit}`;
    const tooltip = this.elements.sweepTooltip;
    tooltip.textContent = `Glutamate dose: ${exact(this.data.axes.glutamate_doses_uM_um[column])} µM·µm\nGABA-A availability: ${exact(this.data.axes.gaba_availabilities[row])}×\n${metric.label}: ${description}`;
    if (this.metric === 'first_spike_latency_ms') {
      tooltip.textContent += `\nFrom ${sweepLatencyReference(this.data)}`;
    }
    tooltip.hidden = false;
    tooltip.style.left = `${Math.max(4, Math.min(x + 12, this.area.width - tooltip.offsetWidth - 5))}px`;
    tooltip.style.top = `${Math.max(3, Math.min(y + 12, this.area.height - tooltip.offsetHeight - 4))}px`;
    this.elements.sweepCanvas.setAttribute('aria-description', tooltip.textContent.replaceAll('\n', '. '));
  }

  moveKeyboardCell(event) {
    if (!this.data || !this.area || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const cell = this.hoverCell || {row: 0, column: 0};
    const delta = {ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [1, 0], ArrowDown: [-1, 0]}[event.key];
    this.hoverCell = {
      row: Math.max(0, Math.min(this.area.ys.length - 1, cell.row + delta[0])),
      column: Math.max(0, Math.min(this.area.xs.length - 1, cell.column + delta[1])),
    };
    this.positionTooltip(this.area.left + (this.hoverCell.column + .5) * this.area.cellWidth,
      this.area.bottom - (this.hoverCell.row + .5) * this.area.cellHeight);
    this.scheduleDraw();
  }

  snapshot() {
    const cells = [];
    if (this.area && this.data) {
      for (let row = 0; row < this.area.ys.length; row++) {
        for (let col = 0; col < this.area.xs.length; col++) {
          cells.push({row, col, x: this.area.left + (col + .5) * this.area.cellWidth,
            y: this.area.bottom - (row + .5) * this.area.cellHeight});
        }
      }
    }
    return clone({
      sweep_id: this.data?.sweep_id ?? null,
      source_run_id: this.sourceRunId,
      axes: this.data?.axes ?? null,
      x_values: this.data?.axes?.glutamate_doses_uM_um ?? null,
      y_values: this.data?.axes?.gaba_availabilities ?? null,
      x_labels: this.data ? sweepAxisLabels(this.data.axes.glutamate_doses_uM_um, 2) : null,
      y_labels: this.data ? sweepAxisLabels(this.data.axes.gaba_availabilities, 3) : null,
      metric: this.metric,
      values: this.data?.[this.metric] ?? null,
      running: this.running,
      cells,
      grid_bounds: this.area ? {left: this.area.left, right: this.area.right,
        top: this.area.top, bottom: this.area.bottom,
        cell_width: this.area.cellWidth, cell_height: this.area.cellHeight} : null,
    });
  }
}

function shortId(value) { return String(value || 'unknown').slice(0, 10); }
function linspace(minimum, maximum, count) {
  return Array.from({length: count}, (_, index) => index === count - 1 ? maximum : minimum + (maximum - minimum) * index / (count - 1));
}
function compact(value, decimals = 2) {
  return Number(value).toLocaleString('en-US', {maximumFractionDigits: decimals});
}
// Keep ordinary grids compact, but never merge distinct axis values by rounding.
export function sweepAxisLabels(values, minimumDecimals = 0) {
  const distinctValues = new Set(values).size;
  for (let decimals = minimumDecimals; decimals <= 20; decimals++) {
    const labels = values.map(value => compact(value, decimals));
    if (new Set(labels).size === distinctValues) return labels;
  }
  // Round-trip formatting also distinguishes extremely small or adjacent doubles.
  return values.map(value => String(value));
}
function exact(value) { return Number(value).toLocaleString('en-US', {maximumSignificantDigits: 12}); }
export function sweepLatencyReference(data) {
  return data?.parameters?.pharmacology ? 'observation start (t = 0)' : 'the first transmitter release';
}
function cellColor(value) {
  return `rgb(${cellChannels(value).join(',')})`;
}
function cellChannels(value) {
  // Concordia gold and maroon, with a light cream start for the sequential scale.
  const fraction = Math.max(0, Math.min(1, value));
  const stops = [[255, 246, 219], [234, 170, 0], [108, 29, 69]];
  const scaled = fraction * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  return stops[index].map((value, channel) => Math.round(value + (stops[index + 1][channel] - value) * mix));
}
function cellTextColor(value) {
  const luminance = channels => channels.map(channel => channel / 255)
    .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
    .reduce((total, channel, index) => total + channel * [.2126, .7152, .0722][index], 0);
  const background = luminance(cellChannels(value));
  const slate = luminance([51, 63, 72]);
  const whiteContrast = 1.05 / (background + .05);
  const slateContrast = (Math.max(background, slate) + .05) / (Math.min(background, slate) + .05);
  // Small quantitative labels need contrast throughout the interpolated palette.
  if (Math.max(whiteContrast, slateContrast) < 4.5) return '#000000';
  return whiteContrast > slateContrast ? '#FFFFFF' : '#333F48';
}
async function readResponse(response) {
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error('The sweep server returned an unreadable response. Please try again.'); }
  if (!response.ok) throw new Error(payload.error || payload.message || `The sweep request failed (${response.status}).`);
  return payload;
}
function validateSweep(data) {
  const xs = data?.axes?.glutamate_doses_uM_um;
  const ys = data?.axes?.gaba_availabilities;
  if (!data?.sweep_id || !Array.isArray(xs) || !Array.isArray(ys) || xs.length < 2 || ys.length < 2) {
    throw new Error('The sweep result is incomplete.');
  }
  for (const key of Object.keys(METRICS)) {
    if (!Array.isArray(data[key]) || data[key].length !== ys.length || data[key].some(row => !Array.isArray(row) || row.length !== xs.length || row.some(value => value === null ? key !== 'first_spike_latency_ms' : !finite(value)))) {
      throw new Error(`The sweep returned invalid ${METRICS[key].label.toLowerCase()} values.`);
    }
  }
}
