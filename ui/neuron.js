import { deriveAnimationState } from './animation_state.js';

// Playback is a pure view of an already computed trajectory. It never simulates
// a second neuron, creates spike events, or calls the Python simulation endpoint.
export class NeuralScene {
  constructor(container) {
    this.container = container;
    this.result = null;
    this.plotter = null;
    this.currentTime = 0;
    this.speed = 1;
    this.playing = false;
    this.animationFrame = null;
    this.lastWallTime = null;
    this.renderCount = 0;
    this.frameState = null;
    container.innerHTML = `
      <svg id="neuronDiagram" viewBox="0 0 1100 440" role="img" aria-labelledby="neuronDiagramTitle neuronDiagramDescription">
        <title id="neuronDiagramTitle">Separate excitatory and inhibitory inputs converge on one postsynaptic neuron</title>
        <desc id="neuronDiagramDescription">Glutamate acts on AMPA receptors on one dendritic branch. GABA acts on GABA-A receptors on a separate branch. Both connect to a shared soma and axon. Particle distributions and receptor activity follow the computed simulation; transverse motion and axonal propagation are schematic, not to scale.</desc>
        <defs>
          <radialGradient id="somaFill"><stop stop-color="#FAF6F0"/><stop offset="1" stop-color="#F3E6EB"/></radialGradient>
          <linearGradient id="dendriteStroke" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#B49CAA"/><stop offset="1" stop-color="#9B838F"/></linearGradient>
          <linearGradient id="excTerminal" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#FAF1F5"/><stop offset="1" stop-color="#F1DEE7"/></linearGradient>
          <linearGradient id="inhTerminal" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#FFF8E5"/><stop offset="1" stop-color="#F7E8BD"/></linearGradient>
          <filter id="somaSoftGlow"><feGaussianBlur stdDeviation="16"/></filter>
          <filter id="spikeBloom" filterUnits="userSpaceOnUse" x="100" y="145" width="970" height="250" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="5"/></filter>
          <radialGradient id="spikeSomaLight"><stop stop-color="#F5D47C" stop-opacity=".66"/><stop offset=".45" stop-color="#EAAA00" stop-opacity=".36"/><stop offset="1" stop-color="#6C1D45" stop-opacity="0"/></radialGradient>
        </defs>

        <g opacity=".27" fill="none" stroke="#B4ABAF" stroke-width="1"><circle cx="595" cy="275" r="101" stroke-dasharray="3 7"/><circle cx="595" cy="275" r="129" stroke-dasharray="1 12"/></g>
        <ellipse id="membraneGlow" cx="595" cy="279" rx="84" ry="66" fill="#6C1D45" opacity=".10" filter="url(#somaSoftGlow)"/>

        <!-- Shared postsynaptic membrane and dendritic arbor. -->
        <g fill="none" stroke-linecap="round" stroke-linejoin="round">
          <path d="M212 204C221 242 259 249 307 250S423 224 486 248L546 275" stroke="#D7D1D3" stroke-width="25"/>
          <path d="M212 204C221 242 259 249 307 250S423 224 486 248L546 275" stroke="url(#dendriteStroke)" stroke-width="16"/>
          <path d="M314 249C318 274 300 296 270 308M375 242C369 215 350 208 329 205M480 246C476 221 460 209 444 201" stroke="#9C969C" stroke-width="8"/>
          <path d="M270 308L242 302M270 308L253 329M329 205L315 187M329 205L307 207" stroke="#9C969C" stroke-width="4"/>
          <path d="M612 204C608 219 601 225 598 242" stroke="#D7D1D3" stroke-width="27"/>
          <path d="M612 204C608 219 601 225 598 242" stroke="#B4A99A" stroke-width="16"/>
          <path d="M650 258C689 246 705 224 716 203S743 180 773 181" stroke="#9E9098" stroke-width="11"/>
          <path d="M716 203C707 187 708 174 718 161M741 184L756 166M773 181L794 175" stroke="#9E9098" stroke-width="5"/>
          <path d="M572 315C559 336 537 343 514 348M635 315C654 339 678 345 706 343" stroke="#A5969F" stroke-width="8"/>
          <path d="M514 348L500 368M514 348L492 347M706 343L726 354M706 343L725 332" stroke="#A5969F" stroke-width="4"/>
        </g>

        <!-- Distinct glutamate input. Vesicles are an anatomical symbol, not particle data. -->
        <g id="excitatoryTerminal">
          <text class="neuron-label neuron-label-primary" x="104" y="32" fill="#6C1D45" font-size="23" font-weight="600">Excitatory input</text>
          <text class="neuron-label" x="104" y="66" fill="#5D6870" font-size="20">Glutamate</text>
          <path d="M191 73L191 90C149 90 128 112 131 139C132 155 146 160 165 160H265C286 160 300 151 299 137C297 110 274 92 235 90V73" fill="url(#excTerminal)" stroke="#9C5C7B" stroke-width="1.5"/>
          <path d="M157 156C185 163 250 163 277 156" fill="none" stroke="#6C1D45" stroke-width="2"/>
          <g fill="#E9CBD9" stroke="#8E4468" stroke-width="1.1" opacity=".8"><circle cx="168" cy="127" r="8"/><circle cx="207" cy="113" r="8"/><circle cx="249" cy="125" r="8"/><circle cx="211" cy="143" r="7"/></g>
          <g fill="#6C1D45" opacity=".7"><circle cx="168" cy="127" r="2"/><circle cx="207" cy="113" r="2"/><circle cx="249" cy="125" r="2"/><circle cx="211" cy="143" r="2"/></g>
          <path d="M127 201Q214 184 301 201" fill="none" stroke="#A28A96" stroke-width="6" stroke-linecap="round"/>
          <g id="ampaReceptors" fill="#F3E3EA" stroke="#6C1D45" stroke-width="1.5">
            <path d="M164 183v15h9v-15m-9 0-4-5m13 5 4-5"/><path d="M195 178v17h9v-17m-9 0-4-5m13 5 4-5"/>
            <path d="M227 178v17h9v-17m-9 0-4-5m13 5 4-5"/><path d="M258 183v15h9v-15m-9 0-4-5m13 5 4-5"/>
          </g>
          <path class="neuron-annotation" d="M104 173H119" stroke="#A9ADB0" stroke-width="1.5"/><text class="neuron-label" x="100" y="179" fill="#5D6870" font-size="18" text-anchor="end">Cleft</text>
          <path class="neuron-annotation" d="M169 199L137 238H30" fill="none" stroke="#9C5C7B" stroke-width="1.5"/>
          <text class="neuron-label neuron-label-primary" x="30" y="280" fill="#6C1D45" font-size="23" font-weight="600">AMPA receptors</text>
          <text class="neuron-label" id="ampaAvailability" x="30" y="312" fill="#5D6870" font-size="17">Relative availability 1.0×</text>
        </g>

        <!-- Distinct GABA input. It never releases glutamate into the other field. -->
        <g id="inhibitoryTerminal">
          <text class="neuron-label neuron-label-primary" x="502" y="32" fill="#A86F00" font-size="23" font-weight="600">GABAergic input</text>
          <text class="neuron-label" x="502" y="66" fill="#5D6870" font-size="20">GABA</text>
          <path d="M590 73V91C550 94 529 114 530 139C531 153 544 160 565 160H664C684 160 698 151 697 137C694 112 675 94 633 91V73" fill="url(#inhTerminal)" stroke="#B88A2E" stroke-width="1.5"/>
          <path d="M556 156C586 163 646 163 675 156" fill="none" stroke="#A86F00" stroke-width="2"/>
          <g fill="#FAE6AD" stroke="#A86F00" stroke-width="1.1" opacity=".8"><circle cx="567" cy="127" r="8"/><circle cx="607" cy="113" r="8"/><circle cx="650" cy="126" r="8"/><circle cx="610" cy="144" r="7"/></g>
          <g fill="#EAAA00" opacity=".7"><circle cx="567" cy="127" r="2"/><circle cx="607" cy="113" r="2"/><circle cx="650" cy="126" r="2"/><circle cx="610" cy="144" r="2"/></g>
          <path d="M525 201Q612 184 699 201" fill="none" stroke="#B8A374" stroke-width="6" stroke-linecap="round"/>
          <g id="gabaaReceptors" fill="#FFF3CD" stroke="#A86F00" stroke-width="1.5">
            <path d="M563 183v15h9v-15m-9 0-4-5m13 5 4-5"/><path d="M594 178v17h9v-17m-9 0-4-5m13 5 4-5"/>
            <path d="M626 178v17h9v-17m-9 0-4-5m13 5 4-5"/><path d="M657 183v15h9v-15m-9 0-4-5m13 5 4-5"/>
          </g>
          <text class="neuron-label neuron-label-primary" x="796" y="115" fill="#A86F00" font-size="23" font-weight="600">GABA-A receptors</text>
          <path class="neuron-annotation" d="M686 185Q735 160 783 145" fill="none" stroke="#AD9B73" stroke-width="1.5"/>
          <text class="neuron-label" id="gabaaAvailability" x="796" y="146" fill="#5D6870" font-size="17">Relative availability 1.0×</text>
        </g>

        <!-- One electrical compartment, then a schematic axonal output. -->
        <path id="axonPath" d="M648 288C698 286 717 302 759 300S835 283 881 296S953 308 1002 294" fill="none" stroke="#9BA3A7" stroke-width="10" stroke-linecap="round"/>
        <path d="M1002 294L1023 277M1002 294L1029 299M1002 294L1015 316" fill="none" stroke="#9BA3A7" stroke-width="4" stroke-linecap="round"/>
        <g fill="#F7F0E1" stroke="#AFA48C" stroke-width="1.2"><rect x="739" y="288" width="43" height="23" rx="10" transform="rotate(-2 760 299)"/><rect x="809" y="279" width="43" height="23" rx="10" transform="rotate(-3 830 290)"/><rect x="882" y="287" width="43" height="23" rx="10" transform="rotate(8 903 298)"/><rect x="950" y="292" width="37" height="22" rx="10" transform="rotate(-5 968 303)"/></g>
        <path id="neuronSoma" d="M551 245C565 234 579 241 593 237C608 234 617 225 630 235C646 248 640 262 654 272C668 285 658 304 644 314C628 325 612 317 598 324C579 331 568 317 556 308C544 300 528 296 533 280C537 266 537 254 551 245Z" fill="url(#somaFill)" stroke="#9F7589" stroke-width="1.8"/>
        <circle cx="596" cy="278" r="23" fill="#FFF9ED" stroke="#BD97A9" stroke-width="1"/>
        <text class="neuron-label" x="596" y="284" fill="#333F48" font-size="18" text-anchor="middle">LIF</text>
        <text class="neuron-label neuron-label-primary" x="594" y="395" fill="#333F48" font-size="23" text-anchor="middle" font-weight="600">Postsynaptic neuron</text>
        <text class="neuron-label" x="594" y="426" fill="#5D6870" font-size="17" text-anchor="middle">One membrane compartment</text>
        <text class="neuron-label neuron-label-primary" x="878" y="235" fill="#333F48" font-size="23" text-anchor="middle" font-weight="600">Axon</text>
        <text class="neuron-label" x="878" y="266" fill="#5D6870" font-size="17" text-anchor="middle">Schematic spike propagation</text>
        <text class="neuron-label" x="79" y="380" fill="#606970" font-size="16">Simplified geometry · not to scale</text>
      </svg>
      <div class="neuron-compact-key" aria-hidden="true">
        <span class="neuron-key-excitatory">Glutamate → AMPA</span>
        <span class="neuron-key-gaba">GABA → GABA-A</span>
        <span class="neuron-key-path">Inputs → postsynaptic neuron → axon</span>
      </div>`;
    this.svg = container.querySelector('svg');
    this.particleElements = {glutamate: [], gaba: []};
    this.pulseElements = [];
    this.prepareDynamicLayers();
    this.prepareReceptorStateView();
    this.bindPlayback();
  }

  connectPlots(plotter) { this.plotter = plotter; }

  setResult(result) {
    this.pause();
    this.result = result;
    const p = result.parameters;
    this.container.querySelector('#ampaAvailability').textContent = `Relative availability ${format(p.glutamate.receptor_availability)}×`;
    this.container.querySelector('#gabaaAvailability').textContent = `Relative availability ${format(p.gaba.receptor_availability)}×`;
    document.getElementById('ampaPeak').textContent = `Peak this run ${(result.summary.peak_ampa_occupancy * 100).toFixed(1)}%`;
    document.getElementById('gabaPeak').textContent = `Peak this run ${(result.summary.peak_gabaa_occupancy * 100).toFixed(1)}%`;
    for (const id of ['playbackPlay', 'playbackReset', 'playbackTimeline']) document.getElementById(id).disabled = false;
    document.getElementById('playbackTimeline').max = p.duration_ms;
    document.getElementById('playbackDuration').textContent = `${format(p.duration_ms)} ms simulation`;
    document.getElementById('sceneMode').textContent = 'DATA-DRIVEN PLAYBACK';
    this.statePanel.hidden = !result.pharmacology?.states;
    this.updateDrugBathLabel();
    document.getElementById('spatialCard').hidden = !result.spatial;
    document.getElementById('animationDisclaimer').textContent = result.spatial
      ? 'Particles are representative samples of calculated concentrations in two separate 1D domains. Their transverse motion and the neuron-to-axon light cascade are illustrative. Each cascade marks a recorded spike, not calculated dendritic or axonal propagation. Each terminal represents a group of synaptic contacts.'
      : 'Particles illustrate uniform effective compartments; no spatial diffusion is calculated in this mode. Particle motion and the neuron-to-axon light cascade are illustrative. Each cascade marks a recorded spike, not calculated dendritic or axonal propagation. Each terminal represents a group of synaptic contacts.';
    this.profileMaximum = 1;
    const profileRows = result.spatial
      ? [...result.spatial.glutamate_uM, ...result.spatial.gaba_uM]
      : [result.series.glutamate_uM, result.series.gaba_uM];
    for (const row of profileRows) for (const value of row) this.profileMaximum = Math.max(this.profileMaximum, value);
    this.seek(0);
  }

  prepareReceptorStateView() {
    const panel = document.createElement('details');
    panel.id = 'receptorStatePanel';
    panel.className = 'receptor-state-disclosure';
    panel.hidden = true;
    const title = document.createElement('summary');
    title.id = 'receptorStateTitle';
    title.textContent = 'Inspect receptor states';
    const body = document.createElement('div');
    body.className = 'receptor-state-body';
    const note = document.createElement('p');
    note.textContent = 'Calculated receptor-state fractions follow the recorded sample. A bound receptor can remain closed or desensitized. These are model estimates, not measured binding.';
    note.style.cssText = 'margin:0 0 12px;font-size:11px;line-height:1.55;color:#62656B';
    this.drugBathLabel = document.createElement('p');
    this.drugBathLabel.id = 'neuronDrugBath';
    this.drugBathLabel.style.cssText = 'margin:0 0 12px;font-size:11px;line-height:1.5;color:#6C1D45';
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:16px';
    const states = [
      ['unbound', 'Unbound', '#D6CFD3'],
      ['ligand_bound_closed', 'Agonist-bound, closed', '#EAAA00'],
      ['open', 'Open', '#6C1D45'],
      ['desensitized', 'Desensitized', '#677581'],
      ['antagonist_bound', 'Antagonist-bound', '#C29BAF'],
    ];
    this.receptorStateRows = {};
    for (const [receptor, name] of [['ampa', 'AMPA'], ['gabaa', 'GABA-A']]) {
      const card = document.createElement('div');
      const heading = document.createElement('strong');
      heading.textContent = name;
      heading.style.cssText = 'display:block;margin-bottom:7px;font-size:12px';
      const bar = document.createElement('div');
      bar.setAttribute('aria-hidden', 'true');
      bar.style.cssText = 'display:flex;overflow:hidden;width:100%;height:12px;border-radius:3px;border:1px solid #cdbdc5;background:#fff';
      const values = document.createElement('div');
      values.style.cssText = 'display:flex;gap:6px 12px;flex-wrap:wrap;margin-top:8px';
      const rows = {};
      const receptorStates = receptor === 'ampa'
        ? [...states, ['functionally_inhibited', 'Functionally inhibited', '#A99C88']]
        : states;
      for (const [key, label, color] of receptorStates) {
        const segment = document.createElement('span');
        segment.style.cssText = `display:block;height:100%;background:${color};width:0`;
        bar.append(segment);
        const labelNode = document.createElement('span');
        labelNode.style.cssText = 'font-size:10px;white-space:nowrap;line-height:1.5';
        const dot = document.createElement('i');
        dot.setAttribute('aria-hidden', 'true');
        dot.style.cssText = `display:inline-block;width:7px;height:7px;border-radius:2px;background:${color};margin-right:4px`;
        const value = document.createElement('output');
        value.id = `${receptor}State_${key}`;
        value.textContent = '—';
        value.style.fontVariantNumeric = 'tabular-nums';
        labelNode.append(dot, document.createTextNode(label + ' '), value);
        values.append(labelNode);
        rows[key] = {segment, value};
      }
      card.append(heading, bar, values);
      if (receptor === 'gabaa') {
        this.muscimolBoundReadout = document.createElement('p');
        this.muscimolBoundReadout.id = 'muscimolBoundReadout';
        this.muscimolBoundReadout.style.cssText = 'font-size:10px;line-height:1.5;margin:8px 0 0;color:#62656B';
        card.append(this.muscimolBoundReadout);
      }
      grid.append(card);
      this.receptorStateRows[receptor] = rows;
    }
    this.drugEffectReadout = document.createElement('p');
    this.drugEffectReadout.id = 'neuronDrugEffects';
    this.drugEffectReadout.style.cssText = 'font-size:11px;line-height:1.55;margin:8px 0 0;color:#62656B';
    const modelDetails = document.createElement('details');
    modelDetails.style.cssText = 'margin-top:12px;font-size:11px';
    const detailLabel = document.createElement('summary');
    detailLabel.textContent = 'Drug association estimates and model limits';
    detailLabel.style.cssText = 'cursor:pointer;color:#6C1D45';
    modelDetails.append(detailLabel, this.drugEffectReadout);
    body.append(note, this.drugBathLabel, grid, modelDetails);
    panel.append(title, body);
    document.getElementById('receptorInspection').append(panel);
    this.statePanel = panel;
  }

  showReceptorStates() {
    if (this.statePanel.hidden) return false;
    this.statePanel.open = true;
    return true;
  }

  updateDrugBathLabel() {
    const concentrations = this.result.parameters.pharmacology?.concentrations_uM || {};
    const names = {cx614: 'CX614', nbqx: 'NBQX', perampanel: 'Perampanel', diazepam: 'Diazepam',
      gabazine: 'Gabazine', muscimol: 'Muscimol', flumazenil: 'Flumazenil'};
    const bathConcentration = value => `${Number(value < 1 ? value * 1000 : value).toLocaleString('en-US', {maximumSignificantDigits: 4})} ${value < 1 ? 'nM' : 'µM'}`;
    const active = Object.entries(concentrations).filter(([, value]) => value > 0)
      .map(([key, value]) => `${names[key] || key} ${bathConcentration(value)}`);
    this.drugBathLabel.textContent = active.length
      ? `Pre-applied bath: ${active.join(' · ')}`
      : 'No-drug control in the pharmacology receptor model';
    const effects = this.result.pharmacology?.drug_effects || {};
    const descriptions = Object.entries(effects).filter(([key]) => concentrations[key] > 0)
      .map(([key, effect]) => `${names[key] || key}: ${effect.label || 'model effect'}${Number.isFinite(effect.model_effect_fraction) ? ' ' + (effect.model_effect_fraction * 100).toFixed(1) + '%' : ''}`);
    this.drugEffectReadout.textContent = descriptions.length
      ? `${descriptions.join(' · ')}. Operational model effects are not measurements of molecular occupancy. The AMPA functionally inhibited pool represents perampanel's response suppression.`
      : 'The state bars partition the modeled receptor population. Functional inhibition is a response-level estimate, not a ligand-binding measurement.';
  }

  renderReceptorStates(sampleIndex) {
    const states = this.result.pharmacology?.states;
    if (!states) return;
    for (const [receptor, rows] of Object.entries(this.receptorStateRows)) {
      for (const [key, row] of Object.entries(rows)) {
        const fraction = states[receptor]?.[key]?.[sampleIndex];
        row.value.textContent = Number.isFinite(fraction) ? `${(fraction * 100).toFixed(1)}%` : '—';
        row.value.dataset.fraction = Number.isFinite(fraction) ? String(fraction) : '';
        row.segment.style.width = Number.isFinite(fraction) ? `${Math.max(0, Math.min(1, fraction)) * 100}%` : '0%';
      }
    }
    const muscimolBound = states.gabaa?.muscimol_bound?.[sampleIndex]
      ?? this.result.series.gabaa_muscimol_bound_fraction?.[sampleIndex];
    this.muscimolBoundReadout.hidden = !Number.isFinite(muscimolBound) || !(this.result.parameters.pharmacology?.concentrations_uM?.muscimol > 0);
    this.muscimolBoundReadout.textContent = Number.isFinite(muscimolBound)
      ? `Muscimol-bound model fraction: ${(muscimolBound * 100).toFixed(1)}% (overlaps the closed, open and desensitized states above).`
      : '';
    this.statePanel.dataset.sampleTimeMs = String(this.result.series.time_ms[sampleIndex]);
  }

  prepareDynamicLayers() {
    this.particleGroup = svgElement('g', {id: 'transmitterParticles', 'aria-hidden': 'true'});
    this.sourceGroup = svgElement('g', {id: 'releaseIndicators', 'aria-hidden': 'true'});
    this.pulseGroup = svgElement('g', {id: 'axonPulses', 'aria-hidden': 'true'});
    this.svg.append(this.particleGroup, this.sourceGroup, this.pulseGroup);
    this.sourceIndicators = {};
    for (const [name, color] of [['glutamate', '#6C1D45'], ['gaba', '#A86F00']]) {
      const ring = svgElement('circle', {cy: 160, r: 5, fill: 'none', stroke: color, 'stroke-width': 1.2, opacity: 0});
      this.sourceGroup.append(ring);
      this.sourceIndicators[name] = ring;
      for (let index = 0; index < 100; index++) {
        const particle = name === 'glutamate'
          ? svgElement('circle', {r: 1.65, fill: color})
          : svgElement('rect', {width: 3.1, height: 3.1, x: -1.55, y: -1.55, rx: .4, fill: color});
        particle.style.display = 'none';
        this.particleGroup.append(particle);
        this.particleElements[name].push(particle);
      }
    }
    this.axonPath = this.svg.querySelector('#axonPath');
    this.axonLength = this.axonPath.getTotalLength();
  }

  bindPlayback() {
    document.getElementById('playbackPlay').addEventListener('click', () => this.playing ? this.pause() : this.play());
    document.getElementById('playbackReset').addEventListener('click', () => { this.pause(); this.seek(0); });
    document.getElementById('playbackTimeline').addEventListener('input', event => { this.pause(); this.seek(Number(event.target.value)); });
    document.getElementById('playbackSpeed').addEventListener('change', event => {
      this.speed = Number(event.target.value);
      this.lastWallTime = null;
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); });
    document.getElementById('spatialCard').addEventListener('toggle', () => this.drawSpatialProfile());
    this.profileObserver = new ResizeObserver(() => this.drawSpatialProfile());
    this.profileObserver.observe(document.getElementById('spatialCard'));
  }

  play() {
    if (!this.result || this.playing) return;
    if (this.currentTime >= this.result.parameters.duration_ms) this.seek(0);
    this.playing = true;
    this.lastWallTime = null;
    this.updatePlayButton();
    const tick = timestamp => {
      if (!this.playing) return;
      if (this.lastWallTime !== null) {
        const elapsed = Math.max(0, timestamp - this.lastWallTime);
        this.seek(this.currentTime + elapsed * 0.005 * this.speed);
      }
      this.lastWallTime = timestamp;
      if (this.currentTime >= this.result.parameters.duration_ms) {
        this.pause();
      } else {
        this.animationFrame = requestAnimationFrame(tick);
      }
    };
    this.animationFrame = requestAnimationFrame(tick);
  }

  pause() {
    this.playing = false;
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.lastWallTime = null;
    this.updatePlayButton();
  }

  updatePlayButton() {
    const atEnd = Boolean(this.result && this.currentTime >= this.result.parameters.duration_ms);
    const label = this.playing ? 'Pause' : atEnd ? 'Replay' : 'Play';
    const icon = this.playing ? 'Ⅱ' : atEnd ? '↺' : '▶';
    const labelNode = document.getElementById('playbackPlayLabel');
    const iconNode = document.getElementById('playbackPlayIcon');
    if (labelNode.textContent !== label) labelNode.textContent = label;
    if (iconNode.textContent !== icon) iconNode.textContent = icon;
    document.getElementById('playbackPlay').setAttribute('aria-label', this.playing
      ? 'Pause simulation' : atEnd ? 'Replay simulation from start' : 'Play simulation');
    this.container.dataset.playing = String(this.playing);
  }

  seek(timeMs) {
    if (!this.result) return;
    this.currentTime = Math.max(0, Math.min(this.result.parameters.duration_ms, Number.isFinite(timeMs) ? timeMs : 0));
    this.updatePlayButton();
    this.frameState = deriveAnimationState(this.result, this.currentTime, 17);
    this.renderFrame();
    this.plotter?.setCursor(this.currentTime);
  }

  renderFrame() {
    const s = this.frameState;
    if (!s) return;
    const p = this.result.parameters;
    const length = p.compartment_length_um;
    for (const name of ['glutamate', 'gaba']) {
      const x0 = name === 'glutamate' ? 128 : 526;
      const span = 173;
      const items = s.particles[name];
      this.particleElements[name].forEach((element, index) => {
        const item = items[index];
        element.style.display = item ? '' : 'none';
        if (!item) return;
        const x = x0 + item.position_um / length * span;
        const y = 166 + item.transverse * 19;
        if (name === 'glutamate') {
          element.setAttribute('cx', x);
          element.setAttribute('cy', y);
        } else {
          element.setAttribute('transform', `translate(${x} ${y}) rotate(45)`);
        }
        element.setAttribute('opacity', .55 + item.phase * .4);
      });
      const age = s.source_release_age_ms[name];
      const ring = this.sourceIndicators[name];
      ring.setAttribute('cx', x0 + (p.transport?.source_position_um ?? length / 2) / length * span);
      ring.setAttribute('r', age !== null ? 3 + Math.min(age, 1.2) * 9 : 3);
      ring.setAttribute('opacity', age !== null && age < 1.2 ? Math.max(0, 1 - age / 1.2) * .55 : 0);
    }
    this.renderReceptors('#ampaReceptors', s.functional_ampa_activation, p.glutamate, '#6C1D45');
    this.renderReceptors('#gabaaReceptors', s.functional_gabaa_activation, p.gaba, '#A86F00');
    const membrane = p.membrane;
    const depolarization = Math.max(0, Math.min(1, (s.voltage_mV - membrane.resting_mV) / (membrane.threshold_mV - membrane.resting_mV)));
    this.svg.querySelector('#membraneGlow').setAttribute('opacity', .06 + depolarization * .17);
    this.svg.querySelector('#neuronSoma').setAttribute('stroke', interpolateColor('#9F7589', '#6C1D45', depolarization));
    this.renderPulses(s.pulses);
    this.updateReadouts(s);
    this.renderReceptorStates(s.series_index);
    this.container.dataset.timeMs = String(s.time_ms);
    this.container.dataset.spikeCount = String(s.spike_count);
    this.container.dataset.glutamateParticles = String(s.particle_counts.glutamate);
    this.container.dataset.gabaParticles = String(s.particle_counts.gaba);
    this.renderCount += 1;
    this.drawSpatialProfile();
  }

  renderReceptors(selector, relativeActivation, synapse, color) {
    const channels = this.svg.querySelector(selector);
    const functional = synapse.receptor_availability > 0 && synapse.max_conductance_nS > 0;
    const strength = functional ? Math.max(0, Math.min(1, relativeActivation)) : 0;
    channels.setAttribute('stroke', functional ? interpolateColor('#7B858B', color, .2 + strength * .8) : '#979B9D');
    channels.setAttribute('fill', functional ? interpolateColor('#FDFBF7', color, strength * .5) : '#F3F1ED');
    channels.setAttribute('opacity', functional ? .55 + .45 * strength : .20);
    channels.setAttribute('stroke-width', 1.2 + 1.2 * strength);
    channels.dataset.functionalActivation = String(functional ? relativeActivation : 0);
  }

  renderPulses(pulses) {
    // A presentation of recorded events only. The model and three-ms event
    // window are unchanged; all phases come from model time, including seeking.
    // Bound visual layers for extreme firing rates without changing the counter.
    const visiblePulses = pulses.slice(-6);
    while (this.pulseElements.length < visiblePulses.length) {
      this.pulseElements.push(this.createSpikeCascade());
    }
    this.pulseElements.forEach((cascade, index) => {
      const {group} = cascade;
      const pulse = visiblePulses[index];
      group.style.display = pulse ? '' : 'none';
      if (!pulse) return;
      const t = pulse.progress;
      group.dataset.spikeMs = String(pulse.spike_ms);
      group.dataset.progress = String(t);
      const dendriteIntensity = smoothPhase(0, .035, t) * (1 - smoothPhase(.35, .60, t));
      const somaIntensity = smoothPhase(.14, .30, t) * (1 - smoothPhase(.40, .65, t));
      const axonIntensity = smoothPhase(.34, .38, t) * (1 - smoothPhase(.92, 1, t));
      const terminalIntensity = smoothPhase(.80, .86, t) * (1 - smoothPhase(.94, 1, t));
      const axonTravel = (t - .34) / .49;
      Object.assign(group.dataset, {dendriteIntensity, somaIntensity, axonIntensity,
        axonProgress: Math.max(0, Math.min(1, axonTravel)), terminalIntensity});
      cascade.dendrites.setAttribute('opacity', dendriteIntensity);
      for (const route of cascade.routes) renderLightTrail(route, (t - route.start) / (route.end - route.start), .52);

      cascade.soma.setAttribute('opacity', somaIntensity);
      const expansion = smoothPhase(.22, .64, t);
      cascade.somaWave.setAttribute('rx', 59 + expansion * 26);
      cascade.somaWave.setAttribute('ry', 47 + expansion * 20);
      cascade.somaWave.setAttribute('opacity', (1 - expansion) * .55);
      cascade.somaWash.setAttribute('rx', 63 + expansion * 12);
      cascade.somaWash.setAttribute('ry', 51 + expansion * 9);

      cascade.axon.setAttribute('opacity', axonIntensity);
      renderLightTrail(cascade.axonRoute, axonTravel, .35);
      for (const node of cascade.nodes) {
        const age = axonTravel - node.position;
        // Each node brightens only after the leading edge has reached it.
        const brightness = age < 0 ? 0 : Math.exp(-age * 15) * smoothPhase(0, .025, age);
        node.group.setAttribute('opacity', brightness);
      }
      cascade.terminals.setAttribute('opacity', terminalIntensity);
      for (const route of cascade.terminalRoutes) renderLightTrail(route, (t - .81) / .10, .80);
    });
  }

  createSpikeCascade() {
    const group = svgElement('g', {class: 'spike-cascade', 'pointer-events': 'none'});
    const dendrites = svgElement('g', {class: 'spike-dendrites', opacity: 0});
    const soma = svgElement('g', {class: 'spike-soma', opacity: 0});
    const axon = svgElement('g', {class: 'spike-axon', opacity: 0});
    const terminals = svgElement('g', {class: 'spike-terminals', opacity: 0});
    group.append(dendrites, soma, axon, terminals);
    this.pulseGroup.append(group);

    // Paths trace the existing arbor, directed from distal branches to the soma.
    // Their timing is illustrative, not a second electrical compartment model.
    const branchGeometry = [
      ['M212 204C221 242 259 249 307 250S423 224 486 248L546 275', 0, .33, 9],
      ['M242 302L270 308C300 296 318 274 314 249', 0, .13, 4],
      ['M253 329L270 308', 0, .06, 3],
      ['M315 187L329 205C350 208 369 215 375 242', .03, .18, 4],
      ['M307 207L329 205', .02, .07, 3],
      ['M444 201C460 209 476 221 480 246', .13, .25, 4],
      ['M612 204C608 219 601 225 598 242', .14, .29, 8],
      ['M794 175L773 181C743 180 727 182 716 203S689 246 650 258', .02, .32, 5],
      ['M718 161C708 174 707 187 716 203', .02, .15, 3],
      ['M756 166L741 184', .02, .10, 3],
      ['M500 368L514 348C537 343 559 336 572 315', .05, .29, 4],
      ['M492 347L514 348', .05, .13, 3],
      ['M726 354L706 343C678 345 654 339 635 315', .06, .30, 4],
      ['M725 332L706 343', .04, .13, 3],
    ];
    const routes = branchGeometry.map(([d, start, end, width]) => ({
      ...createLightTrail(dendrites, d, width), start, end,
    }));

    const somaShape = this.svg.querySelector('#neuronSoma').getAttribute('d');
    const somaWash = svgElement('ellipse', {cx: 596, cy: 278, rx: 63, ry: 51, fill: 'url(#spikeSomaLight)'});
    const somaBloom = svgElement('path', {d: somaShape, fill: 'none', stroke: '#EAAA00', 'stroke-width': 13, opacity: .8, filter: 'url(#spikeBloom)'});
    const somaOutline = svgElement('path', {d: somaShape, fill: '#EAAA00', 'fill-opacity': .12, stroke: '#6C1D45', 'stroke-width': 2.5});
    const somaWave = svgElement('ellipse', {cx: 596, cy: 278, rx: 59, ry: 47, fill: 'none', stroke: '#A86F00', 'stroke-width': 1.4});
    const nucleus = svgElement('circle', {cx: 596, cy: 278, r: 24, fill: 'none', stroke: '#6C1D45', 'stroke-width': 1.2, opacity: .65});
    soma.append(somaWash, somaBloom, somaOutline, somaWave, nucleus);

    const axonRoute = createLightTrail(axon, this.axonPath.getAttribute('d'), 9);
    const nodes = [.14, .41, .61, .81].map(position => {
      const point = this.axonPath.getPointAtLength(position * this.axonLength);
      const node = svgElement('g', {class: 'spike-node', opacity: 0});
      node.append(
        svgElement('circle', {cx: point.x, cy: point.y, r: 9, fill: '#EAAA00', opacity: .25, filter: 'url(#spikeBloom)'}),
        svgElement('circle', {cx: point.x, cy: point.y, r: 4.7, fill: 'none', stroke: '#A86F00', 'stroke-width': 1.4}),
      );
      axon.append(node);
      return {group: node, position};
    });
    const terminalRoutes = ['M1002 294L1023 277', 'M1002 294L1029 299', 'M1002 294L1015 316']
      .map(d => createLightTrail(terminals, d, 4));
    return {group, dendrites, soma, somaWash, somaWave, axon, terminals,
      routes, axonRoute, nodes, terminalRoutes};
  }

  updateReadouts(s) {
    const p = this.result.parameters;
    document.getElementById('playbackClock').textContent = s.time_ms.toFixed(2);
    document.getElementById('playbackTimeline').value = s.time_ms;
    document.getElementById('playbackSpikeCount').textContent = s.spike_count;
    const sampleTime = this.result.series.time_ms[s.series_index];
    const sampleLabel = document.getElementById('liveSampleTime');
    sampleLabel.textContent = sampleTime.toLocaleString('en-US', {maximumFractionDigits: 6});
    sampleLabel.dataset.timeMs = String(sampleTime);
    setReadout('liveVoltage', s.voltage_mV.toFixed(1), 'mV');
    setReadout('liveAmPa', (s.ampa_occupancy * 100).toFixed(1), '%');
    setReadout('liveGaba', (s.gabaa_occupancy * 100).toFixed(1), '%');
    setReadout('gabaCurrent', s.gaba_current_pA.toFixed(1), 'pA');
    const effect = s.inhibitory_nS < 1e-8 ? 'No active GABA-A conductance'
      : Math.abs(s.gaba_driving_force_mV) < .05 ? 'Near reversal · conductance can shunt'
      : s.gaba_current_pA < 0 ? 'Hyperpolarizing drive at this voltage' : 'Depolarizing drive at this voltage';
    document.getElementById('gabaDirection').textContent = effect;
    const lo = Math.min(p.membrane.resting_mV, p.membrane.reset_mV, p.membrane.inhibitory_reversal_mV) - 5;
    const hi = p.membrane.threshold_mV + 5;
    document.getElementById('voltageMeterFill').style.width = `${Math.max(0, Math.min(100, (s.voltage_mV - lo) / (hi - lo) * 100))}%`;
    document.getElementById('voltageThresholdMarker').style.left = `${(p.membrane.threshold_mV - lo) / (hi - lo) * 100}%`;
    document.getElementById('voltageMeterCaption').textContent = `Threshold ${p.membrane.threshold_mV.toFixed(1)} mV`;
    document.getElementById('spatialFrameTime').textContent = `Sample at ${s.spatial_snapshot.time_ms.toFixed(2)} ms`;
    document.getElementById('ampaPeak').title = 'Open fraction is the model gating variable. Zero receptor availability means no functional AMPA conductance.';
    document.getElementById('gabaPeak').title = 'Open fraction is the model gating variable. Zero receptor availability means no functional GABA-A conductance.';
  }

  drawSpatialProfile() {
    if (!this.frameState || !document.getElementById('spatialCard').open) return;
    const canvas = document.getElementById('spatialProfile');
    if (canvas.getClientRects().length === 0) return;
    const width = Math.max(250, canvas.clientWidth);
    const height = 190;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, width, height);
    const data = this.frameState.spatial_snapshot;
    const length = this.result.parameters.compartment_length_um;
    const left = 59, right = width - 22, top = 23, bottom = 150;
    // Fixed scale over a run makes clearance and dose changes visible over time.
    const maximum = this.profileMaximum * 1.06;
    const x = position => left + position / length * (right - left);
    const y = value => bottom - value / maximum * (bottom - top);
    ctx.font = '10px Segoe UI, sans-serif';
    ctx.strokeStyle = '#E4E0DC'; ctx.lineWidth = 1;
    ctx.fillStyle = '#5D6870';
    for (let i = 0; i <= 4; i++) {
      const value = maximum * i / 4;
      ctx.beginPath();ctx.moveTo(left, y(value));ctx.lineTo(right, y(value));ctx.stroke();
      ctx.textAlign = 'right';ctx.fillText(value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toFixed(value < 10 ? 1 : 0), left - 9, y(value) + 3);
      const distance = length * i / 4;
      ctx.textAlign = 'center';ctx.fillText(Number(distance.toFixed(3)), x(distance), bottom + 17);
    }
    ctx.textAlign = 'left';ctx.fillText('µM', 13, 13);
    ctx.textAlign = 'right';ctx.fillText('Position in each independent domain (µm)', right, 181);
    for (const [values, color] of [[data.glutamate_uM, '#6C1D45'], [data.gaba_uM, '#A86F00']]) {
      ctx.strokeStyle = color;ctx.lineWidth = 1.8;ctx.beginPath();
      data.x_um.forEach((position, index) => index === 0 ? ctx.moveTo(x(position), y(values[index])) : ctx.lineTo(x(position), y(values[index])));
      ctx.stroke();
    }
    if (this.result.parameters.transport) {
      for (const [position, label, color] of [
        [this.result.parameters.transport.source_position_um, 'Release', '#8C4E6C'],
        [this.result.parameters.transport.receptor_position_um, 'Receptor', '#8A6A00']]) {
        ctx.strokeStyle = color;ctx.setLineDash([3, 4]);ctx.lineWidth = 1;
        ctx.beginPath();ctx.moveTo(x(position), top);ctx.lineTo(x(position), bottom);ctx.stroke();ctx.setLineDash([]);
        ctx.fillStyle = color;ctx.textAlign = 'center';ctx.fillText(label, x(position), top - (label === 'Release' ? 12 : 2));
      }
    }
  }

  getPlaybackState() {
    if (!this.frameState) return {time_ms: 0, playing: false, speed: this.speed, render_count: this.renderCount};
    const s = this.frameState;
    return {
      time_ms: s.time_ms, playing: this.playing, speed: this.speed, event_count: s.spike_count,
      active_pulses: s.pulses.map(pulse => ({...pulse})),
      glutamate_particles: s.particle_counts.glutamate, gaba_particles: s.particle_counts.gaba,
      particle_signature: particleSignature(s.particles),
      ampa_occupancy: s.ampa_occupancy, gabaa_occupancy: s.gabaa_occupancy,
      functional_ampa_activation: s.functional_ampa_activation,
      functional_gabaa_activation: s.functional_gabaa_activation,
      voltage_mV: s.voltage_mV, gaba_current_pA: s.gaba_current_pA,
      series_index: s.series_index, spatial_index: s.spatial_index,
      spatial_time_ms: s.spatial_snapshot.time_ms, render_count: this.renderCount,
    };
  }
}

function format(value) {
  return Number(value).toLocaleString('en-US', {maximumFractionDigits: 2, minimumFractionDigits: 1});
}

function svgElement(tag, attributes = {}) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function smoothPhase(start, end, value) {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

function createLightTrail(parent, d, width) {
  const common = {d, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0};
  const bloom = svgElement('path', {...common, class: 'spike-bloom', stroke: '#6C1D45', 'stroke-width': width + 13, filter: 'url(#spikeBloom)'});
  const trail = svgElement('path', {...common, class: 'spike-trail', stroke: '#EAAA00', 'stroke-width': width});
  const core = svgElement('path', {...common, class: 'spike-front', stroke: '#6C1D45', 'stroke-width': Math.max(1.8, width * .38)});
  parent.append(bloom, trail, core);
  return {bloom, trail, core, length: trail.getTotalLength()};
}

function renderLightTrail(route, progress, tail) {
  // One nonrepeating dash window travels along the actual membrane path.
  // Once it reaches the end, its tail exits smoothly instead of wrapping.
  const head = progress * route.length;
  for (const [element, span, opacity] of [
    [route.bloom, tail, .58], [route.trail, tail * .85, .85], [route.core, .10, 1],
  ]) {
    const start = Math.max(0, head - span * route.length);
    const end = Math.min(route.length, head);
    const visible = Math.max(0, end - start);
    element.setAttribute('opacity', visible > 0 ? opacity : 0);
    element.setAttribute('stroke-dasharray', `${visible} ${route.length * 3}`);
    element.setAttribute('stroke-dashoffset', String(-start));
  }
}

function setReadout(id, value, unit) {
  const element = document.getElementById(id);
  const small = document.createElement('small');
  small.textContent = ` ${unit}`;
  element.replaceChildren(document.createTextNode(value), small);
}

function interpolateColor(start, end, fraction) {
  const parse = color => [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
  const a = parse(start), b = parse(end);
  return `rgb(${a.map((value, index) => Math.round(value + (b[index] - value) * fraction)).join(',')})`;
}

function particleSignature(particles) {
  const text = JSON.stringify(particles);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}
