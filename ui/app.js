import { ScientificPlots } from './plots.js';
import { NeuralScene } from './neuron.js';
import { ExperimentTools } from './experiments_ui.js';
import { SweepPanel } from './sweep.js';
import { DrugLab } from './drugs.js';
import { WorkspaceNavigation } from './workspace.js';

const $ = id => document.getElementById(id);
const hosted = document.documentElement.dataset.deployment === 'hosted';
const state = { defaults: null, parameters: null, controls: [], result: null, running: false, dirty: false };
let workspace;
const plots = new ScientificPlots($('plots'));
const neuron = new NeuralScene($('neuronScene'));
neuron.connectPlots(plots);
const clone = value => JSON.parse(JSON.stringify(value));
const getPath = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);
function setPath(object, path, value) {
  const pieces = path.split('.');
  const key = pieces.pop();
  pieces.reduce((current, part) => current[part], object)[key] = value;
}

function status(message, tone = '') {
  $('statusText').textContent = message;
  $('statusBanner').dataset.tone = tone;
}

function clearError() {
  $('errorBanner').hidden = true;
  $('errorBanner').textContent = '';
  $('fieldValidationMessage')?.remove();
  for (const input of document.querySelectorAll('[aria-invalid=true]')) {
    input.removeAttribute('aria-invalid');
    const descriptions = (input.getAttribute('aria-describedby') || '').split(/\s+/)
      .filter(id => id && id !== 'errorBanner' && id !== 'fieldValidationMessage');
    if (descriptions.length) input.setAttribute('aria-describedby', descriptions.join(' '));
    else input.removeAttribute('aria-describedby');
  }
}

function showError(message) {
  $('errorBanner').textContent = message;
  $('errorBanner').hidden = false;
  document.body.dataset.state = 'error';
}

async function fetchFromServer(url, options) {
  try { return await fetch(url, options); }
  catch {
    throw new Error(hosted
      ? 'Could not reach SynaptiCob. Check your internet connection and try again.' + (state.result ? ' Your last completed result is still shown.' : '')
      : 'Could not reach the local simulation server. Start SynaptiCob and try again.');
  }
}

function requestProblem(response, details, fallback) {
  if (typeof details?.error === 'string' && details.error) return details.error;
  if (typeof details?.message === 'string' && details.message) return details.message;
  if (hosted && (response.status === 429 || response.status === 503)) {
    return 'SynaptiCob is busy or temporarily unavailable. Wait a moment, then try again.' + (state.result ? ' Your previous result is preserved.' : '');
  }
  return fallback;
}

function markDirty() {
  state.dirty = true;
  document.body.dataset.dirty = 'true';
  $('parameterStatus').textContent = 'Changes are applied when you run the simulation.';
  $('importFeedback').textContent = '';
  status(state.result ? 'Changes pending — showing the last completed run.' : 'Parameters changed. Run the simulation when ready.', 'pending');
  clearError();
  document.dispatchEvent(new CustomEvent('neurochemsim:draft-change'));
  workspace?.update();
}

function fieldError(input, message) {
  const error = new Error(message);
  error.inputId = input.id;
  return error;
}

function createGroup(name) {
  const group = document.createElement('section');
  group.className = 'control-group';
  const heading = document.createElement('h3');
  heading.className = 'group-heading';
  const dot = document.createElement('span');
  dot.className = 'group-dot';
  heading.append(dot, document.createTextNode(name));
  group.append(heading);
  return group;
}

function createControl(meta) {
  const id = `control-${meta.path.replaceAll('.', '-')}`;
  const value = getPath(state.parameters, meta.path);
  const field = document.createElement('div');
  field.className = 'control-field';
  field.dataset.tone = /gaba/i.test(meta.path) ? 'amber' : 'teal';
  const labelRow = document.createElement('div');
  labelRow.className = 'control-label-row';
  const label = document.createElement('label');
  label.className = 'control-label';
  label.htmlFor = id;
  label.textContent = meta.label;
  if (meta.help) label.title = meta.help;
  const unit = document.createElement('span');
  unit.className = 'control-unit';
  unit.textContent = meta.unit || '';
  labelRow.append(label, unit);
  field.append(labelRow);
  const input = document.createElement('input');
  input.id = id;
  input.dataset.path = meta.path;
  input.setAttribute('aria-label', `${meta.label}${meta.unit ? ` (${meta.unit})` : ''}`);
  if (meta.help) input.title = meta.help;

  if (meta.kind === 'times') {
    input.type = 'text';
    input.className = 'control-times';
    input.value = Array.isArray(value) ? value.join(', ') : '';
    input.placeholder = 'e.g. 10, 30, 50';
    input.addEventListener('input', markDirty);
    field.append(input);
    const help = document.createElement('p');
    help.className = 'control-help';
    help.textContent = 'Release times, separated by commas. Leave empty for no events.';
    field.append(help);
  } else {
    input.type = 'number';
    input.className = 'control-number';
    input.step = 'any'; // Scientific values need not align with a UI slider's increment.
    if (meta.min !== undefined) input.min = meta.min;
    if (meta.max !== undefined) input.max = meta.max;
    input.value = value;
    const row = document.createElement('div');
    row.className = 'control-value-row';
    const range = document.createElement('input');
    range.id = id.replace('control-', 'slider-');
    range.type = 'range';
    range.className = 'control-range';
    range.min = meta.slider_min ?? meta.min ?? 0;
    range.max = meta.slider_max ?? meta.max ?? Math.max(1, value * 2);
    range.step = meta.step ?? 'any';
    range.value = value;
    range.setAttribute('aria-label', `${meta.label} slider`);
    range.setAttribute('aria-controls', input.id);
    // An imported valid number can exceed the ergonomic slider range. The number
    // stays exact; only the slider thumb is clamped for display.
    range.addEventListener('input', () => { input.value = range.value; markDirty(); });
    input.addEventListener('input', () => { if (input.value !== '' && Number.isFinite(Number(input.value))) range.value = input.value; markDirty(); });
    row.append(range, input);
    field.append(row);
  }
  return field;
}

function renderControls() {
  const container = $('controls');
  container.replaceChildren();
  const normalGroups = new Map();
  const advancedGroups = new Map();
  for (const meta of state.controls) {
    if (getPath(state.parameters, meta.path) === undefined) continue;
    const target = meta.advanced ? advancedGroups : normalGroups;
    const name = meta.group || 'Parameters';
    if (!target.has(name)) target.set(name, createGroup(name));
    target.get(name).append(createControl(meta));
  }
  for (const section of normalGroups.values()) container.append(section);
  if (advancedGroups.size) {
    const details = document.createElement('details');
    details.className = 'advanced-controls';
    details.id = 'advancedControls';
    const summary = document.createElement('summary');
    summary.textContent = 'Advanced settings';
    const body = document.createElement('div');
    body.className = 'advanced-body';
    for (const section of advancedGroups.values()) body.append(section);
    details.append(summary, body);
    container.append(details);
  }
  updateModelControls();
}

function updateModelControls() {
  const active = Boolean($('drugLabEnabled')?.checked);
  for (const meta of state.controls.filter(item => /\.(kon_uM_ms|koff_per_ms)$/.test(item.path))) {
    const input = $(`control-${meta.path.replaceAll('.', '-')}`);
    if (input) input.closest('.control-field').hidden = active;
  }
}

function readParameters() {
  const parameters = clone(state.parameters);
  for (const meta of state.controls) {
    if ($('drugLabEnabled')?.checked && /\.(kon_uM_ms|koff_per_ms)$/.test(meta.path)) continue;
    const input = $(`control-${meta.path.replaceAll('.', '-')}`);
    if (!input) continue;
    const text = input.value.trim();
    let value;
    if (meta.kind === 'times') {
      // Number('') is zero: reject empty comma-delimited groups before parsing
      // so a stray leading comma can never create an unintended release at t=0.
      if (text !== '' && text.split(',').some(group => group.trim() === '')) {
        input.classList.add('invalid');
        throw fieldError(input, `${meta.label}: remove leading, trailing, or repeated commas. Use times such as 10, 30 or 10 30.`);
      }
      value = text === '' ? [] : text.split(/[\s,]+/).map(Number);
      if (value.some(v => !Number.isFinite(v) || v < 0)) {
        input.classList.add('invalid');
        throw fieldError(input, `${meta.label}: enter nonnegative times in milliseconds, separated by commas.`);
      }
      input.classList.remove('invalid');
    } else {
      value = Number(text);
      if (text === '' || !Number.isFinite(value)) throw fieldError(input, `${meta.label}: enter a finite number.`);
      if ((meta.min !== undefined && value < meta.min) || (meta.max !== undefined && value > meta.max)) {
        throw fieldError(input, `${meta.label}: choose a value from ${meta.min} to ${meta.max}${meta.unit ? ` ${meta.unit}` : ''}.`);
      }
    }
    setPath(parameters, meta.path, value);
  }
  return drugLab.applyTo(parameters);
}

function setBusy(busy) {
  state.running = busy;
  $('runSimulation').disabled = busy;
  $('resetParameters').disabled = busy;
  $('runSimulation').querySelector('span').textContent = busy ? 'Calculating…' : 'Run simulation';
  for (const input of $('parameterForm').querySelectorAll('input')) input.disabled = busy;
  if (busy) document.body.dataset.state = 'running';
  document.dispatchEvent(new CustomEvent('neurochemsim:busy', {detail: busy}));
  workspace?.update();
}

function metric(element, value, unit) {
  element.replaceChildren(document.createTextNode(value));
  if (unit) {
    const span = document.createElement('span');
    span.className = 'metric-unit';
    span.textContent = unit;
    element.append(span);
  }
}

function showResult(result) {
  const s = result.summary;
  const p = result.parameters;
  const resolutionNeedsReview = result.numerical_resolution?.status === 'review_required';
  $('resultOutcomeLabel').textContent = resolutionNeedsReview ? 'COMPUTED SPIKE OUTCOME' : 'ACTION POTENTIAL';
  $('resultOutcome').textContent = s.action_potential_generated ? 'Generated' : 'No spike';
  $('resultOutcome').dataset.resolution = resolutionNeedsReview ? 'review_required' : 'not_flagged';
  $('resultOutcome').parentElement.dataset.outcome = s.action_potential_generated ? 'yes' : 'no';
  $('outcomeDescription').textContent = resolutionNeedsReview ? 'Computed outcome; resolution unverified'
    : s.action_potential_generated ? 'Firing threshold was reached' : 'Activity remained below threshold';
  $('resultSpikeCount').textContent = s.spike_count;
  metric($('resultLatency'), s.first_spike_latency_ms == null ? '—' : Number(s.first_spike_latency_ms).toFixed(2), s.first_spike_latency_ms == null ? '' : 'ms');
  $('latencyReference').textContent = p.pharmacology ? 'From observation start (drugs pre-applied)' : 'From the first transmitter release';
  metric($('resultPeak'), Number(s.peak_membrane_mV).toFixed(1), 'mV');
  $('thresholdSummary').textContent = `Threshold ${Number(p.membrane.threshold_mV).toFixed(1)} mV`;
  $('modelMode').textContent = `${p.model_mode === 'spatial' ? 'Spatial diffusion' : 'Effective compartment'} · ${p.pharmacology ? 'receptor-state pharmacology' : 'two-state receptors'}`;
  $('runDescription').textContent = `${format(p.duration_ms)} ms · ${format(p.dt_ms)} ms step${p.transport ? ` · ${p.transport.n_cells} spatial cells` : ''}`;
  $('simulationId').textContent = `Run ${String(result.run_id || '').slice(0, 10)}${result.provenance?.model_source_sha256 ? ` · source ${result.provenance.model_source_sha256.slice(0, 8)}` : ''}`;
  showNumericalResolution(result.numerical_resolution);
  plots.setResult(result);
  neuron.setResult(result);
  document.dispatchEvent(new CustomEvent('neurochemsim:result', { detail: result }));
  workspace?.update();
}

function showNumericalResolution(resolution) {
  const warning = $('numericalResolutionWarning');
  const messages = $('numericalResolutionMessages');
  messages.replaceChildren();
  $('numericalResolutionRecommendation').textContent = '';
  $('peakEstimateNote').textContent = resolution?.peak_note ||
    'Peak concentrations and open fractions are estimates from recorded samples; a spiking LIF voltage peak includes the threshold.';
  warning.hidden = resolution?.status !== 'review_required';
  if (warning.hidden) return;
  const uniqueMessages = [...new Set((resolution.warnings || []).map(item => item.message).filter(message => typeof message === 'string' && message))];
  for (const message of uniqueMessages) {
    const item = document.createElement('li');
    item.textContent = message;
    messages.append(item);
  }
  const suggested = resolution.recommended_dt_ms;
  const supportedMinimum = state.controls.find(control => control.path === 'dt_ms')?.min ?? .001;
  const display = value => Number(value).toLocaleString('en-US', {maximumSignificantDigits: 4});
  let recommendation = 'Reduce the timestep and compare successive refinements before interpreting these outcomes.';
  if (Number.isFinite(suggested) && suggested > 0) {
    recommendation = suggested < supportedMinimum
      ? `The suggested timestep (${display(suggested)} ms) is below the supported minimum (${display(supportedMinimum)} ms). Adjust the settings and compare numerical refinements.`
      : suggested === supportedMinimum
      ? `Reduce the timestep toward the supported minimum of ${display(supportedMinimum)} ms while comparing successive refinements. If outcomes remain sensitive at that limit, adjust the settings.`
      : `Try a timestep of ${display(suggested)} ms, then compare successive refinements within the supported range.`;
  }
  $('numericalResolutionRecommendation').textContent = recommendation + ' This guidance does not guarantee numerical accuracy.';
}

function format(value) { return Number(value).toLocaleString('en-US', {maximumFractionDigits: 4}); }

async function runSimulation() {
  if (state.running) return;
  clearError();
  let parameters;
  try { parameters = readParameters(); }
  catch (error) {
    showError(error.message);
    workspace?.revealField(error.inputId);
    status(state.result ? 'Check the highlighted setting. Your last completed result is preserved.' : 'Check the highlighted setting and try again.', 'pending');
    return;
  }
  setBusy(true);
  drugLab.beforeRun(parameters);
  status('Calculating diffusion, receptor activation and membrane integration…', 'running');
  try {
    const response = await fetchFromServer('/api/simulate', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(parameters)
    });
    let result;
    try { result = await response.json(); }
    catch { throw new Error(requestProblem(response, null, 'The simulation server returned an unreadable response. Please try again.')); }
    if (!response.ok) throw new Error(requestProblem(response, result, `Simulation could not finish (${response.status}).`));
    if (!result.series || !result.summary || !result.parameters) throw new Error('The result is incomplete. Your previous experiment has been preserved.');
    state.result = result;
    state.parameters = clone(result.parameters);
    state.dirty = false;
    document.body.dataset.dirty = 'false';
    showResult(result);
    document.body.dataset.state = 'ready';
    $('parameterStatus').textContent = 'All displayed results match these settings.';
    status(`Simulation complete · ${format(parameters.duration_ms)} ms of model time · ${result.summary.spike_count} ${result.summary.spike_count === 1 ? 'spike' : 'spikes'} recorded.`, 'success');
  } catch (error) {
    showError(error.message || (hosted ? 'Could not reach SynaptiCob. Check your connection and try again.' : 'Could not reach the local simulation server. Start SynaptiCob and try again.'));
    status(state.result ? 'Simulation did not complete. Your previous result is preserved.' : 'Simulation did not complete. Check the message above.', 'pending');
  } finally {
    setBusy(false);
  }
}

$('parameterForm').addEventListener('submit', event => { event.preventDefault(); runSimulation(); });
$('resetParameters').addEventListener('click', () => {
  loadParameters(state.defaults, 'Defaults restored. Run to apply them.');
});

function loadParameters(parameters, message = 'Settings loaded. Run to apply them.', options = {}) {
  if (state.running) throw new Error('Wait for the current simulation to finish before loading settings.');
  state.parameters = clone(parameters);
  renderControls();
  drugLab.loadParameters(state.parameters, options);
  $('presetSelect').value = '';
  $('presetDescription').textContent = message;
  markDirty();
  $('parameterStatus').textContent = message;
}

function restoreCompletedRun() {
  if (state.running || !state.result) return;
  loadParameters(state.result.parameters, 'Settings restored to the completed experiment.', {preserveExercise: true});
  state.dirty = false;
  document.body.dataset.dirty = 'false';
  document.body.dataset.state = 'ready';
  status('Unrun changes undone. The completed result and playback are preserved.', 'success');
  // Keep the existing result and playback clock; this only restores draft fields.
  drugLab.restoreCompletedFeedback();
  workspace.update();
}

async function initialize() {
  $('hostedSessionNote').hidden = !hosted;
  try {
    const response = await fetchFromServer('/api/defaults');
    if (!response.ok) {
      let details = {};
      try { details = await response.json(); } catch { /* Preserve a readable fallback. */ }
      throw new Error(requestProblem(response, details, hosted
        ? 'Could not load the model defaults. Reload this page and try again.'
        : 'Could not load the model defaults. Restart SynaptiCob and try again.'));
    }
    const config = await response.json();
    state.defaults = clone(config.parameters);
    state.parameters = clone(config.parameters);
    state.controls = config.controls;
    renderControls();
    await drugLab.ready;
    drugLab.loadParameters(state.parameters);
    $('runSimulation').disabled = false;
    $('resetParameters').disabled = false;
    await runSimulation();
  } catch (error) {
    showError(error.message);
    if (hosted) $('startupRetry').hidden = false;
    status(hosted ? 'SynaptiCob could not finish opening. Wait a moment, then reload this page.'
      : 'The local application is not ready yet. Restart it to reconnect.', 'pending');
  }
}

// A small stable bridge for subsequent stages; simulation state remains in Python.
window.NeuroChemSim = { get result() { return state.result; }, get parameters() { return clone(state.parameters); }, plots, neuron, runSimulation, loadParameters };
window.neurochemPlaybackState = () => neuron.getPlaybackState();
const experimentTools = new ExperimentTools({getResult: () => state.result, loadParameters});
const sweepPanel = new SweepPanel($('sweepPanel'), {getResult: () => state.result});
const drugLab = new DrugLab($('drugLab'), {
  getResult: () => state.result, getDraft: readParameters, loadParameters,
  markDirty, runSimulation, onModelChange: updateModelControls,
});
window.NeuroChemSim.drugLab = drugLab;
workspace = new WorkspaceNavigation({
  getState: () => state, runSimulation, restoreCompletedRun,
  redraw: () => { plots.scheduleDraw(); sweepPanel.scheduleDraw(); neuron.drawSpatialProfile(); },
});
window.NeuroChemSim.workspace = workspace;
initialize();
