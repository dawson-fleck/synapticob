/* Classroom pharmacology controls. Python owns all receptor calculations.
   Draft controls never overwrite a completed run or its matched control. */
import { downloadBlob } from './experiments_ui.js';

const clone = value => JSON.parse(JSON.stringify(value));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const number = (value, digits = 4) => finite(value)
  ? Number(value).toLocaleString('en-US', {maximumSignificantDigits: digits}) : '—';
const concentration = value => value > 0 && value < 1
  ? `${number(value * 1000)} nM` : `${number(value)} µM`;
const lessonNote = lesson => /complete.*experiment/i.test(lesson.description)
  ? lesson.description : `${lesson.description} Loads a complete experiment.`;
const CUSTOM_LESSON = 'Lessons load a complete experiment. Or choose drugs below. Concentrations are free concentrations at the receptors, not clinical doses.';
const put = (object, path, value) => {
  const pieces = path.split('.');
  const key = pieces.pop();
  pieces.reduce((current, part) => current[part], object)[key] = value;
};

export class DrugLab {
  constructor(container, callbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.catalog = null;
    this.cards = new Map();
    this.busy = false;
    this.curveRunning = false;
    this.curve = null;
    this.result = null;
    this.prediction = null;
    this.render();
    this.bind();
    this.curveResizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(this.curveDrawFrame);
      this.curveDrawFrame = requestAnimationFrame(() => { if (this.curve) this.drawCurve(); });
    });
    this.curveResizeObserver.observe(this.elements.drugCurveChart);
    this.ready = this.loadCatalog();
    document.addEventListener('neurochemsim:busy', event => {
      this.busy = Boolean(event.detail);
      this.updateEnabled();
    });
    document.addEventListener('neurochemsim:result', event => this.onResult(event.detail));
    document.addEventListener('neurochemsim:draft-change', () => {
      this.elements.drugLabStatus.textContent = 'Changes pending. Run the simulation to apply this selection.';
      if (this.result?.parameters?.pharmacology) {
        this.elements.drugCompletedStatus.textContent = `Showing completed run ${this.result.run_id.slice(0, 10)}. Pending controls do not change this comparison.`;
      }
    });
  }

  render() {
    this.container.innerHTML = `
      <div class="drug-lab-heading">
        <div><span class="eyebrow">CLASSROOM PHARMACOLOGY</span><h2 id="drugLabTitle">Change the receptor. Follow the response.</h2><p>Explore seven compounds, compare with a matched no-drug control, and test your prediction.</p></div>
        <label class="drug-master"><input id="drugLabEnabled" type="checkbox" disabled><span>Enable drug lab</span></label>
      </div>
      <p id="drugLabLoad" class="drug-load-note" role="status">Loading drug descriptions and model information.</p>
      <div id="drugLabBody" class="drug-lab-body" hidden>
        <p class="drug-model-note" id="drugModelNote"></p>
        <div class="drug-lesson-bar"><label for="drugLessonSelect">Start with a lesson<select id="drugLessonSelect"><option value="">Choose your own combination</option></select></label><button id="drugLessonApply" class="button button-secondary" type="button">Load lesson</button><p id="drugLessonDescription">Lessons load a complete experiment. Or choose drugs below. Concentrations are free concentrations at the receptors, not clinical doses.</p></div>
        <div class="drug-target-head"><h3>Choose compounds</h3><button id="drugAllOff" type="button" class="drug-text-button">Turn all drugs off</button></div>
        <div class="drug-card-grid" id="drugCatalog"></div>
        <div class="drug-run-row"><button id="drugExperimentRun" type="button" class="button button-primary">Run drug experiment</button><p id="drugLabStatus" role="status" aria-live="polite">Run to calculate this selection and its matched control.</p></div>
        <details class="drug-lesson-details" id="drugPredictionPanel"><summary>Predict → run → explain <span>Optional student exercise</span></summary><div class="drug-exercise-body"><label for="drugPrediction">Compared with the matched no-drug control, I predict<select id="drugPrediction"><option value="">Choose before running</option><option value="more">More spikes</option><option value="fewer">Fewer spikes</option><option value="same">The same spike count</option></select></label><label for="drugPredictionReason">My reasoning <span>(optional)</span><textarea id="drugPredictionReason" rows="2" placeholder="Connect binding, receptor current, and threshold."></textarea></label><p id="drugPredictionFeedback" class="drug-feedback" role="status" aria-live="polite">Make a prediction, then run. Your prediction is captured when the experiment starts.</p><button id="drugWorksheetExport" type="button" class="button button-secondary" disabled>Save my explanation</button></div></details>
      </div>
      <div id="drugComparison" class="drug-comparison" hidden><div class="drug-comparison-heading"><h3>Drug experiment versus no-drug control</h3><p id="drugCompletedStatus"></p></div><div id="drugComparisonMetrics" class="drug-comparison-metrics"></div><p id="drugComparisonNote" class="drug-model-note"></p></div>
      <details id="drugCurvePanel" class="drug-lesson-details drug-curve-panel" hidden><summary>Concentration–response experiment <span>Explore competition and allostery</span></summary><div class="drug-curve-body"><p>Hold the membrane at −65 mV and calculate steady receptor responses. These curves use fixed concentrations at the receptor; they are not synaptic release traces or firing probabilities.</p>
        <div class="drug-curve-controls">
          <label for="drugCurveCompound">Compound<select id="drugCurveCompound"></select></label>
          <label for="drugCurveAxis">Vary<select id="drugCurveAxis"><option value="drug">Drug concentration</option><option value="agonist">Neurotransmitter concentration</option></select></label>
          <label for="drugCurveAgonist"><span id="drugCurveAgonistLabel">Fixed neurotransmitter (µM)</span><input id="drugCurveAgonist" type="number" min="0" max="10000" step="any" value="100"></label>
          <label for="drugCurveMin">Lowest positive concentration (µM)<input id="drugCurveMin" type="number" min="0.000001" max="10000" step="any" value="0.001"></label>
          <label for="drugCurveMax">Highest concentration (µM)<input id="drugCurveMax" type="number" min="0.000001" max="10000" step="any" value="100"></label>
        </div>
        <div class="drug-run-row"><button id="drugCurveRun" class="button button-primary" type="button">Calculate response curve</button><p id="drugCurveStatus" role="status" aria-live="polite">Uses the completed experiment. Other drugs stay at their completed concentrations; the control has all drugs off.</p></div>
        <div id="drugCurveError" class="drug-inline-error" role="alert" hidden></div>
        <div id="drugCurveOutput" hidden><p id="drugCurveSource" class="drug-model-note"></p><div id="drugCurveChart" class="drug-curve-chart"></div><p id="drugCurveInterpretation" class="drug-model-note"></p><details class="drug-table-details"><summary>Inspect exact values</summary><div class="drug-table-scroll"><table><thead><tr><th scope="col">Concentration (µM)</th><th scope="col">Open fraction (%)</th><th scope="col">Control (%)</th><th scope="col">Current (pA)</th><th scope="col">Control (pA)</th></tr></thead><tbody id="drugCurveRows"></tbody></table></div></details><div class="drug-downloads"><button id="drugCurveCsv" class="button button-secondary" type="button">Curve CSV</button><button id="drugCurveJson" class="button button-secondary" type="button">Curve data &amp; sources</button></div></div>
      </div></details>`;
    this.elements = Object.fromEntries([...this.container.querySelectorAll('[id]')].map(element => [element.id, element]));
  }

  bind() {
    const e = this.elements;
    e.drugLabEnabled.addEventListener('change', () => {
      e.drugLabBody.hidden = !e.drugLabEnabled.checked;
      this.changed();
      this.updateEnabled();
    });
    e.drugAllOff.addEventListener('click', () => {
      for (const card of this.cards.values()) { card.toggle.checked = false; this.updateCard(card); }
      this.changed();
    });
    e.drugExperimentRun.addEventListener('click', () => this.callbacks.runSimulation());
    e.drugLessonApply.addEventListener('click', () => this.loadLesson());
    e.drugLessonSelect.addEventListener('change', () => {
      const lesson = this.catalog?.lessons?.find(item => item.id === e.drugLessonSelect.value);
      e.drugLessonDescription.textContent = lesson ? lessonNote(lesson) : CUSTOM_LESSON;
      this.updateEnabled();
    });
    e.drugCurveCompound.addEventListener('change', () => this.resetCurveRange());
    e.drugCurveAxis.addEventListener('change', () => this.resetCurveRange());
    for (const input of [e.drugCurveMin,e.drugCurveMax,e.drugCurveAgonist]) input.addEventListener('input', () => this.markCurvePending());
    e.drugCurveRun.addEventListener('click', () => this.runCurve());
    e.drugCurveCsv.addEventListener('click', () => this.exportCurve('csv'));
    e.drugCurveJson.addEventListener('click', () => this.exportCurve('json'));
    e.drugWorksheetExport.addEventListener('click', () => this.exportWorksheet());
  }

  async loadCatalog() {
    try {
      const response = await fetch('/api/drugs');
      const catalog = await response.json();
      if (!response.ok || !Array.isArray(catalog.drugs)) throw new Error(catalog.error || 'Drug descriptions could not be loaded.');
      this.catalog = catalog;
      this.elements.drugModelNote.textContent = catalog.note || 'Drug-lab results use a separate receptor-state model. The paired control uses exactly the same model with all drugs off.';
      for (const meta of catalog.drugs) this.createCard(meta);
      for (const lesson of catalog.lessons || []) {
        const option = document.createElement('option');
        option.value = lesson.id;
        option.textContent = lesson.name;
        this.elements.drugLessonSelect.append(option);
      }
      this.elements.drugLabLoad.textContent = 'Off by default. Enable to explore receptor pharmacology; your standard simulation remains available.';
      this.resetCurveRange();
      this.updateEnabled();
    } catch (error) {
      this.elements.drugLabLoad.textContent = `${error.message} Restart the app to reload the drug module. Standard simulations remain available.`;
      this.elements.drugLabLoad.dataset.error = 'true';
    }
  }

  createCard(meta) {
    const element = document.createElement('article');
    element.className = 'drug-card';
    element.dataset.target = /gaba/i.test(meta.target) ? 'gaba' : 'ampa';
    element.dataset.drug = meta.id;
    const header = document.createElement('div');
    header.className = 'drug-card-header';
    const label = document.createElement('label');
    label.className = 'drug-toggle';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox'; toggle.id = `drug-${meta.id}-enabled`;
    toggle.setAttribute('aria-label', `Enable ${meta.name}`);
    const title = document.createElement('strong'); title.textContent = meta.name;
    label.append(toggle, title);
    const target = document.createElement('span'); target.className = 'drug-target'; target.textContent = meta.target;
    header.append(label, target);
    const mechanism = document.createElement('p'); mechanism.className = 'drug-mechanism'; mechanism.textContent = meta.mechanism;
    const description = document.createElement('p'); description.className = 'drug-description'; description.textContent = meta.description;
    const controls = document.createElement('div'); controls.className = 'drug-dose-controls'; controls.hidden = true;
    const doseLabel = document.createElement('label'); doseLabel.htmlFor = `drug-${meta.id}-dose`; doseLabel.textContent = 'Free concentration';
    const valueLabel = document.createElement('output'); valueLabel.className = 'drug-dose-display';
    const positivePresets = (meta.presets_uM || [meta.default_uM]).filter(value => finite(value) && value > 0);
    const logMinimum = meta.min_uM > 0 ? meta.min_uM : Math.min(...positivePresets) / 10;
    const range = document.createElement('input'); range.type = 'range'; range.min = Math.log10(logMinimum); range.max = Math.log10(meta.max_uM); range.step = 'any'; range.className = 'drug-dose-range'; range.setAttribute('aria-label', `${meta.name} concentration, logarithmic slider`);
    const numberInput = document.createElement('input'); numberInput.type = 'number'; numberInput.id = `drug-${meta.id}-dose`; numberInput.min = 0; numberInput.max = meta.max_uM; numberInput.step = 'any'; numberInput.value = meta.default_uM; numberInput.setAttribute('aria-label', `${meta.name} free concentration in micromolar`);
    const exact = document.createElement('div'); exact.className = 'drug-dose-exact'; exact.append(numberInput, document.createTextNode('µM'));
    const doseTop = document.createElement('div'); doseTop.className = 'drug-dose-top'; doseTop.append(doseLabel, valueLabel);
    const doseRow = document.createElement('div'); doseRow.className = 'drug-dose-row'; doseRow.append(range, exact);
    const presets = document.createElement('div'); presets.className = 'drug-dose-presets';
    const presetValues = Array.isArray(meta.presets_uM) ? meta.presets_uM : [meta.default_uM / 10, meta.default_uM, meta.default_uM * 10];
    presetValues.forEach((value, index) => {
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = ['Low', 'Medium', 'High'][index] || concentration(value);
      button.title = `${meta.name}: ${concentration(value)} (illustrative concentration preset)`;
      button.addEventListener('click', () => { numberInput.value = value; this.updateCard(card); this.changed(); });
      presets.append(button);
    });
    controls.append(doseTop, doseRow, presets);
    const details = document.createElement('details'); details.className = 'drug-info';
    const summary = document.createElement('summary'); summary.textContent = 'How it works & sources';
    const explanation = document.createElement('p'); explanation.textContent = meta.lesson || meta.description;
    const evidence = document.createElement('p'); evidence.className = 'drug-evidence-note'; evidence.textContent = meta.evidence_note || 'Parameters describe this educational model and its cited experimental preparation.';
    const sources = document.createElement('ul'); sources.className = 'drug-sources';
    for (const source of meta.sources || []) {
      const li = document.createElement('li'); const link = document.createElement('a');
      link.textContent = source.title || source.url; link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; li.append(link); sources.append(li);
    }
    details.append(summary, explanation, evidence, sources);
    element.append(header, mechanism, description, controls, details);
    this.elements.drugCatalog.append(element);
    const option = document.createElement('option'); option.value = meta.id; option.textContent = `${meta.name} · ${meta.target}`;
    this.elements.drugCurveCompound.append(option);
    const card = {meta, element, toggle, controls, range, numberInput, valueLabel, presets, logMinimum};
    this.cards.set(meta.id, card);
    toggle.addEventListener('change', () => { this.updateCard(card); this.changed(); });
    range.addEventListener('input', () => { numberInput.value = Number((10 ** Number(range.value)).toPrecision(6)); this.updateCard(card); this.changed(); });
    numberInput.addEventListener('input', () => { this.updateCard(card); this.changed(); });
    this.updateCard(card);
  }

  updateCard(card) {
    card.controls.hidden = !card.toggle.checked;
    card.element.dataset.active = String(card.toggle.checked);
    const value = Number(card.numberInput.value);
    card.valueLabel.textContent = card.numberInput.value.trim() !== '' && finite(value) && value >= 0 ? concentration(value) : 'Enter a concentration';
    if (value > 0) card.range.value = Math.log10(value);
    card.range.setAttribute('aria-valuetext', concentration(value));
  }

  changed() {
    this.elements.drugLessonSelect.value = '';
    this.elements.drugLessonDescription.textContent = CUSTOM_LESSON;
    this.callbacks.markDirty();
    this.updateEnabled();
    this.callbacks.onModelChange?.();
  }

  applyTo(parameters) {
    const output = clone(parameters);
    if (!this.elements.drugLabEnabled.checked) {
      delete output.pharmacology;
      if (output.transport == null) { delete output.transport; output.schema_version = 1; output.model_mode = 'compartment'; }
      else { output.schema_version = 2; output.model_mode = 'spatial'; }
      return output;
    }
    if (!this.catalog) throw new Error('Drug information is not ready. Disable the drug lab to use the standard model.');
    const concentrations_uM = {};
    for (const [id, card] of this.cards) {
      const text = card.numberInput.value.trim();
      const value = Number(text);
      if (card.toggle.checked && (text === '' || !finite(value) || value < 0 || value > card.meta.max_uM)) {
        const error = new Error(`${card.meta.name}: enter a free concentration from 0 to ${card.meta.max_uM} µM.`);
        error.inputId = card.numberInput.id;
        throw error;
      }
      concentrations_uM[id] = card.toggle.checked ? value : 0;
    }
    output.schema_version = 3;
    output.transport ??= null;
    output.pharmacology = {model_version: this.catalog.model_version, pre_equilibrated: true, concentrations_uM};
    return output;
  }

  loadParameters(parameters, {preserveExercise = false} = {}) {
    const config = parameters.pharmacology;
    this.elements.drugLabEnabled.checked = Boolean(config);
    this.elements.drugLabBody.hidden = !config;
    for (const [id, card] of this.cards) {
      const value = config?.concentrations_uM?.[id] ?? 0;
      card.toggle.checked = value > 0;
      card.numberInput.value = value > 0 ? value : card.meta.default_uM;
      this.updateCard(card);
    }
    if (!preserveExercise) {
      this.elements.drugPrediction.value = '';
      this.elements.drugPredictionReason.value = '';
    }
    this.elements.drugLessonSelect.value = '';
    this.elements.drugLessonDescription.textContent = CUSTOM_LESSON;
    this.updateEnabled();
    this.callbacks.onModelChange?.();
  }

  restoreCompletedFeedback() {
    this.pendingPrediction = null;
    this.elements.drugLabStatus.textContent = this.result?.parameters.pharmacology
      ? 'Settings match the completed drug experiment. Your comparison and explanation are preserved.'
      : 'Settings match the completed standard experiment.';
    if (this.result?.parameters.pharmacology) {
      this.elements.drugCompletedStatus.textContent = `Showing completed run ${this.result.run_id.slice(0, 10)}. Settings match this comparison.`;
    }
    this.updateEnabled();
  }

  loadLesson() {
    const lesson = this.catalog?.lessons?.find(item => item.id === this.elements.drugLessonSelect.value);
    if (!lesson) return;
    try {
      const parameters = lesson.parameters ? clone(lesson.parameters) : this.callbacks.getDraft();
      parameters.schema_version = 3;
      parameters.transport ??= null;
      parameters.pharmacology = {model_version: this.catalog.model_version, pre_equilibrated: true,
        concentrations_uM: Object.fromEntries([...this.cards.keys()].map(id => [id, lesson.concentrations_uM?.[id] || 0]))};
      for (const [path, value] of Object.entries(lesson.parameter_overrides || {})) put(parameters, path, value);
      this.callbacks.loadParameters(parameters, 'Lesson loaded. Make a prediction, then run.');
      this.elements.drugLessonSelect.value = lesson.id;
      this.elements.drugLessonDescription.textContent = lessonNote(lesson);
      this.elements.drugPredictionPanel.open = true;
      this.elements.drugLabStatus.textContent = `${lesson.name} loaded. Run to calculate the result.`;
    } catch (error) {
      this.elements.drugLabStatus.textContent = error.message;
    }
  }

  beforeRun(parameters) {
    this.pendingPrediction = parameters.pharmacology && this.elements.drugPrediction.value
      ? {choice: this.elements.drugPrediction.value, reasoning: this.elements.drugPredictionReason.value.trim(), parameters: clone(parameters)} : null;
  }

  onResult(result) {
    this.result = result;
    const baseline = result.comparison?.baseline;
    const pharmacology = Boolean(result.parameters.pharmacology);
    this.elements.drugComparison.hidden = !pharmacology || !baseline;
    this.elements.drugCurvePanel.hidden = !pharmacology;
    this.elements.drugLabStatus.textContent = pharmacology
      ? 'Completed. The neuron, graphs, comparison, and exports use this drug selection.'
      : 'Standard model completed. Enable the lab to calculate drug effects.';
    if (pharmacology && baseline) this.renderComparison(result, baseline);
    if (this.pendingPrediction && pharmacology && baseline) {
      const delta = result.summary.spike_count - baseline.summary.spike_count;
      const observed = delta > 0 ? 'more' : delta < 0 ? 'fewer' : 'same';
      const correct = observed === this.pendingPrediction.choice;
      const compounds = this.activeDescriptions(result.parameters);
      this.prediction = {...this.pendingPrediction, observed, matches: correct, run_id: result.run_id,
        drug_spike_count: result.summary.spike_count, control_spike_count: baseline.summary.spike_count,
        provenance: result.provenance};
      this.elements.drugPredictionFeedback.textContent = `${correct ? 'Your prediction matched.' : 'The result differed from your prediction.'} The drug experiment produced ${result.summary.spike_count} spikes; its control produced ${baseline.summary.spike_count}. ${compounds} A change in receptor current does not always change the integer spike count: timing and threshold also matter.${result.numerical_resolution?.status === 'review_required' ? ' Refine the timestep before treating this result as robust.' : ''}`;
      this.pendingPrediction = null;
    } else {
      this.prediction = null;
      this.elements.drugPredictionFeedback.textContent = 'Choose a prediction before the next run to compare it with the calculated result.';
    }
    if (this.curve && this.curve.source_run_id !== result.run_id) {
      this.elements.drugCurveStatus.textContent = 'The curve below belongs to an earlier completed experiment. Calculate again to use the new run.';
    }
    this.updateEnabled();
  }

  activeDescriptions(parameters) {
    return [...this.cards.values()].filter(card => parameters.pharmacology?.concentrations_uM?.[card.meta.id] > 0)
      .map(card => `${card.meta.name}: ${card.meta.mechanism}.`).join(' ');
  }

  renderComparison(result, baseline) {
    const e = this.elements;
    e.drugCompletedStatus.textContent = `Completed run ${result.run_id.slice(0, 10)} · same inputs and receptor model, all drugs off in control.`;
    e.drugComparisonMetrics.replaceChildren();
    const pairs = [
      ['Spike count', 'spike_count', ''],
      ['First-spike latency', 'first_spike_latency_ms', 'ms'],
      ['Peak voltage', 'peak_membrane_mV', 'mV'],
      ['AMPA charge', 'excitatory_charge_pC', 'pC'],
      ['GABA-A charge', 'inhibitory_charge_pC', 'pC'],
    ];
    for (const [label, key, unit] of pairs) {
      let treated = result.summary[key], control = baseline.summary[key];
      if (!finite(treated) && !finite(control) && /charge/.test(key)) continue;
      const item = document.createElement('div');
      const name = document.createElement('span'); name.textContent = label;
      const value = document.createElement('strong'); value.textContent = `${number(treated)}${unit ? ` ${unit}` : ''}`;
      const reference = document.createElement('small'); reference.textContent = `Control: ${number(control)}${unit ? ` ${unit}` : ''}`;
      item.append(name, value, reference); e.drugComparisonMetrics.append(item);
    }
    const selected = [...this.cards.values()].filter(card => result.parameters.pharmacology.concentrations_uM[card.meta.id] > 0)
      .map(card => `${card.meta.name} ${concentration(result.parameters.pharmacology.concentrations_uM[card.meta.id])}`).join(' · ');
    e.drugComparisonNote.textContent = `${selected || 'All drugs off: the drug-lab run and its matched control should agree.'} Latency is measured from observation start, with drugs pre-applied. Positive current/charge is depolarizing membrane drive; negative is hyperpolarizing. No-spike latency is undefined (—).`;
  }

  updateEnabled() {
    const ready = Boolean(this.catalog);
    const locked = this.busy || this.curveRunning;
    if (ready) this.elements.drugLabLoad.textContent = this.elements.drugLabEnabled.checked
      ? 'Drug lab is on. Run to apply the selection and calculate its matched no-drug control.'
      : 'Off by default. Enable to explore receptor pharmacology; your standard simulation remains available.';
    this.elements.drugLabEnabled.disabled = !ready || locked;
    for (const control of this.elements.drugLabBody.querySelectorAll('input,select,textarea,button')) control.disabled = !ready || locked;
    this.elements.drugLessonApply.disabled = !ready || locked || !this.elements.drugLessonSelect.value;
    this.elements.drugExperimentRun.textContent = this.busy ? 'Calculating…' : 'Run drug experiment';
    this.elements.drugWorksheetExport.disabled = !this.prediction || locked;
    for (const control of this.elements.drugCurvePanel.querySelectorAll('input,select,button')) control.disabled = !ready || locked;
    this.elements.drugCurveRun.disabled = !ready || locked || !this.result?.parameters?.pharmacology;
    this.elements.drugCurveRun.textContent = this.curveRunning ? 'Calculating curve…' : 'Calculate response curve';
    this.elements.drugCurveAgonist.disabled = locked || this.elements.drugCurveAxis.value === 'agonist';
    this.elements.drugCurveCsv.disabled = !this.curve || locked;
    this.elements.drugCurveJson.disabled = !this.curve || locked;
  }

  resetCurveRange() {
    const card = this.cards.get(this.elements.drugCurveCompound.value);
    if (!card) return;
    const gaba = /gaba/i.test(card.meta.target);
    const agonistAxis = this.elements.drugCurveAxis.value === 'agonist';
    this.elements.drugCurveAgonistLabel.textContent = `Fixed ${gaba ? 'GABA' : 'glutamate'} (µM)`;
    this.elements.drugCurveAgonist.value = gaba ? 3 : 100;
    this.elements.drugCurveMin.value = agonistAxis ? (gaba ? 0.01 : 0.1) : card.logMinimum;
    this.elements.drugCurveMax.value = agonistAxis ? (gaba ? 1000 : 10000) : card.meta.max_uM;
    this.markCurvePending();
    this.updateEnabled();
  }

  markCurvePending() {
    if (this.curve) this.elements.drugCurveStatus.textContent = 'Curve settings changed. Calculate again to apply them; the displayed curve and downloads retain their original settings.';
  }

  async runCurve() {
    if (this.curveRunning || !this.result?.parameters?.pharmacology) return;
    const e = this.elements;
    e.drugCurveError.hidden = true;
    const source = this.result;
    const card = this.cards.get(e.drugCurveCompound.value);
    try {
      const minimum = Number(e.drugCurveMin.value), maximum = Number(e.drugCurveMax.value), agonist = Number(e.drugCurveAgonist.value);
      if ([e.drugCurveMin, e.drugCurveMax, e.drugCurveAgonist].some(input => !input.value.trim()) || ![minimum, maximum, agonist].every(finite)
          || minimum <= 0 || maximum <= minimum || agonist < 0 || agonist > 10000 || maximum > (e.drugCurveAxis.value === 'drug' ? card.meta.max_uM : 10000)) {
        throw new Error(`Choose a positive increasing range within ${e.drugCurveAxis.value === 'drug' ? card.meta.max_uM : 10000} µM and a fixed transmitter concentration from 0 to 10,000 µM.`);
      }
      const values = [0, ...Array.from({length: 12}, (_, index) => 10 ** (Math.log10(minimum) + (Math.log10(maximum) - Math.log10(minimum)) * index / 11))];
      values[1] = minimum; values[values.length - 1] = maximum;
      const request = {parameters: clone(source.parameters), drug_id: card.meta.id, axis: e.drugCurveAxis.value, values_uM: values, agonist_uM: agonist};
      this.curveRunning = true; this.updateEnabled();
      e.drugCurveStatus.textContent = `Calculating steady receptor responses from completed run ${source.run_id.slice(0, 10)}.`;
      const response = await fetch('/api/drug-sweep', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(request)});
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.rows)) throw new Error(data.error || 'The response curve could not be calculated.');
      this.curve = {...data, source_run_id: source.run_id};
      this.drawCurve();
      e.drugCurveStatus.textContent = this.result?.run_id === source.run_id
        ? 'Curve complete. No neuron simulation or playback settings were changed.'
        : 'The curve below belongs to an earlier completed experiment. Calculate again to use the new run.';
    } catch (error) {
      e.drugCurveError.textContent = error.message || 'Could not calculate the concentration–response curve.';
      e.drugCurveError.hidden = false;
      e.drugCurveStatus.textContent = this.curve ? 'Your previous completed curve is preserved.' : 'Check the settings and try again.';
    } finally { this.curveRunning = false; this.updateEnabled(); }
  }

  drawCurve() {
    const e = this.elements, data = this.curve;
    e.drugCurveOutput.hidden = false;
    const meta = this.cards.get(data.drug_id)?.meta;
    const label = data.axis === 'drug' ? `${meta?.name || data.drug_id} concentration` : `${/gaba/i.test(data.target) ? 'GABA' : 'Glutamate'} concentration`;
    e.drugCurveSource.textContent = `Source run ${data.source_run_id.slice(0, 10)} · ${label} · steady receptor clamp at ${number(data.holding_mV)} mV. Zero concentration is plotted separately from the logarithmic axis.`;
    e.drugCurveInterpretation.textContent = data.interpretation || 'Solid: selected drug mixture. Dashed: all drugs off. A concentration–response curve measures functional response, not binding affinity.';
    e.drugCurveRows.replaceChildren();
    for (const row of data.rows) {
      const tr = document.createElement('tr');
      for (const value of [row.concentration_uM, row.open_fraction * 100, row.control_open_fraction * 100, row.current_pA, row.control_current_pA]) {
        const td = document.createElement('td'); td.textContent = number(value, 6); tr.append(td);
      }
      e.drugCurveRows.append(tr);
    }
    const ns = 'http://www.w3.org/2000/svg';
    const width = Math.max(280, e.drugCurveChart.clientWidth - 24);
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} 300`); svg.setAttribute('role', 'img');
    const title = document.createElementNS(ns, 'title'); title.textContent = `${label} versus receptor open fraction. Exact values are in the table below.`; svg.append(title);
    const make = (tag, attributes, text) => { const node = document.createElementNS(ns, tag); for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value); if (text !== undefined) node.textContent = text; svg.append(node); return node; };
    const positive = data.rows.filter(row => row.concentration_uM > 0);
    const low = Math.log10(positive[0].concentration_uM), high = Math.log10(positive.at(-1).concentration_uM);
    const x = value => value === 0 ? 60 : 112 + (Math.log10(value) - low) / (high - low) * (width - 132);
    const peak = Math.max(...data.rows.flatMap(row => [row.open_fraction, row.control_open_fraction]));
    const scale = peak > 0 ? 10 ** Math.floor(Math.log10(peak * 1.1)) : 1;
    const top = peak > 0 ? Math.min(1, Math.ceil(peak * 1.1 / scale) * scale) : 1;
    const y = value => 238 - Math.max(0, Math.min(top, value)) / top * 175;
    for (const fraction of [0, .25, .5, .75, 1].map(value => value * top)) {
      make('line', {x1: 48, x2: width - 20, y1: y(fraction), y2: y(fraction), stroke: '#E5DFE2'});
      make('text', {x: 39, y: y(fraction) + 4, 'text-anchor': 'end', fill: '#62656B', 'font-size': 11}, number(fraction * 100, 3));
    }
    make('text', {x: 48, y: 16, fill: '#333F48', 'font-size': 12}, 'Open fraction (%)');
    make('line', {x1: 90, x2: 90, y1: 57, y2: 244, stroke: '#B7AAB1', 'stroke-dasharray': '3 4'});
    make('text', {x: 60, y: 258, 'text-anchor': 'middle', fill: '#62656B', 'font-size': 11}, '0');
    for (const power of [low, (low + high) / 2, high]) {
      const value = 10 ** power;
      make('text', {x: x(value), y: 258, 'text-anchor': 'middle', fill: '#62656B', 'font-size': 11}, number(value, 3));
    }
    make('text', {x: width / 2, y: 284, 'text-anchor': 'middle', fill: '#333F48', 'font-size': 12}, 'Concentration (µM, log scale)');
    for (const [key, color, dashed] of [['control_open_fraction', '#62656B', true], ['open_fraction', /gaba/i.test(data.target) ? '#A86F00' : '#6C1D45', false]]) {
      const path = positive.map((row, index) => `${index ? 'L' : 'M'} ${x(row.concentration_uM)} ${y(row[key])}`).join(' ');
      make('path', {d: path, fill: 'none', stroke: color, 'stroke-width': 2.5, ...(dashed ? {'stroke-dasharray': '6 4'} : {})});
      for (const row of data.rows) make('circle', {cx: x(row.concentration_uM), cy: y(row[key]), r: dashed ? 4 : 2.5, fill: dashed ? '#FFFFFF' : color, stroke: color, 'stroke-width': 1.5});
    }
    make('text', {x: 48, y: 38, fill: /gaba/i.test(data.target) ? '#A86F00' : '#6C1D45', 'font-size': 10}, '● Selected mixture');
    make('text', {x: width < 400 ? 160 : 220, y: 38, fill: '#62656B', 'font-size': 10}, '– – No-drug control');
    e.drugCurveChart.replaceChildren(svg);
  }

  async exportCurve(format) {
    if (!this.curve) return;
    let content, type;
    if (format === 'json') { content = JSON.stringify(this.curve, null, 2); type = 'application/json'; }
    else {
      const {rows, ...metadata} = this.curve;
      content = `# ${JSON.stringify(metadata)}\nconcentration_uM,open_fraction,control_open_fraction,current_pA,control_current_pA\n`
        + rows.map(row => [row.concentration_uM, row.open_fraction, row.control_open_fraction, row.current_pA, row.control_current_pA].join(',')).join('\n') + '\n';
      type = 'text/csv';
    }
    await downloadBlob(new Blob([content], {type}), `SynaptiCob_${this.curve.drug_id}_response.${format}`);
  }

  async exportWorksheet() {
    if (!this.prediction) return;
    const content = {...this.prediction, explanation_after_run: this.elements.drugPredictionReason.value.trim(),
      note: 'Prediction was recorded before this run. Subsequent reasoning is separate. Scientific model outputs are illustrative, not clinical predictions.'};
    await downloadBlob(new Blob([JSON.stringify(content, null, 2)], {type: 'application/json'}), 'SynaptiCob_student_explanation.json');
  }
}
