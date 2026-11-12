// Presets and imported files alter draft settings. Downloads always identify the
// last completed numerical result, independent of unapplied control changes.
const $ = id => document.getElementById(id);

export class ExperimentTools {
  constructor({getResult, loadParameters}) {
    this.getResult = getResult;
    this.loadParameters = loadParameters;
    this.presets = [];
    this.busy = false;
    this.importing = false;
    this.draftRevision = 0;
    this.presetsReady = false;
    this.exporting = new Set();
    this.bindControls();
    this.loadPresets();
    document.addEventListener('neurochemsim:result', event => this.onResult(event.detail));
    document.addEventListener('neurochemsim:draft-change', () => { this.draftRevision += 1; });
    document.addEventListener('neurochemsim:busy', event => {
      this.busy = event.detail;
      this.updateEnabled();
    });
  }

  bindControls() {
    $('presetSelect').addEventListener('change', () => {
      const selected = this.presets.find(preset => preset.id === $('presetSelect').value);
      if (!selected) return;
      try {
        this.clearError();
        this.loadParameters(selected.parameters, 'Scenario loaded. Run to apply it.');
        $('presetSelect').value = selected.id;
        $('presetDescription').textContent = selected.description;
        this.message(`“${selected.name}” loaded into the controls. Run the simulation to calculate its response.`);
      } catch (error) { this.error(error.message); }
    });
    $('importSettingsButton').addEventListener('click', () => $('importSettingsFile').click());
    $('importSettingsFile').addEventListener('change', () => this.importSettings());
    $('parameterForm').addEventListener('input', () => {
      $('presetSelect').value = '';
      $('presetDescription').textContent = 'Custom settings · run the simulation to apply your changes.';
    });
    $('resetParameters').addEventListener('click', () => {
      $('presetSelect').value = '';
      $('presetDescription').textContent = 'Default settings restored · run the simulation to apply them.';
    });
    const exportOptions = [
      ['exportExperimentZip', 'experiment.zip', 'SynaptiCob_experiment.zip'],
      ['exportTraceCsv', 'trace.csv', 'SynaptiCob_trace.csv'],
      ['exportSpikesCsv', 'spikes.csv', 'SynaptiCob_spikes.csv'],
      ['exportFigurePng', 'figure.png', 'SynaptiCob_figure.png'],
      ['exportParametersJson', 'parameters.json', 'SynaptiCob_parameters.json'],
      ['exportSummaryTxt', 'summary.txt', 'SynaptiCob_summary.txt'],
    ];
    this.exportButtons = exportOptions.map(([id]) => $(id));
    for (const [id, suffix, filename] of exportOptions) {
      $(id).addEventListener('click', () => this.exportResult(id, suffix, filename));
    }
    document.addEventListener('click', event => {
      if (!$('exportMenu').contains(event.target)) $('exportMenu').open = false;
    });
  }

  async loadPresets() {
    try {
      const response = await fetch('/api/presets');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The experimental presets could not be loaded.');
      if (!Array.isArray(data.presets)) throw new Error('The preset list is incomplete.');
      this.presets = data.presets;
      for (const preset of this.presets) {
        const option = document.createElement('option');
        option.value = preset.id;
        option.textContent = preset.name;
        $('presetSelect').append(option);
      }
      this.presetsReady = true;
      this.updateEnabled();
    } catch (error) {
      $('presetDescription').textContent = 'Presets are unavailable. The experimental controls remain usable.';
      this.error(error.message);
    }
  }

  updateEnabled() {
    const hasResult = Boolean(this.getResult());
    $('presetSelect').disabled = !this.presetsReady || this.busy || this.importing || !hasResult;
    $('importSettingsButton').disabled = this.busy || this.importing || !hasResult;
    for (const button of this.exportButtons || []) button.disabled = !hasResult || this.exporting.has(button.id);
  }

  onResult(result) {
    $('completedRunLabel').textContent = `Run ${String(result.run_id).slice(0, 10)}`;
    $('completedRunLabel').title = `Completed run ${result.run_id}`;
    this.message('Saved experiments contain this completed run, its settings, and numerical provenance.');
    this.clearError();
    this.updateEnabled();
  }

  async importSettings() {
    const file = $('importSettingsFile').files?.[0];
    if (!file) return;
    const startedAtRevision = this.draftRevision;
    this.importing = true;
    this.updateEnabled();
    this.clearError();
    this.message(`Checking ${file.name}…`);
    if ($('importFeedback')) $('importFeedback').textContent = `Checking ${file.name}…`;
    try {
      if (file.size > 1024 * 1024) throw new Error('Choose a parameter JSON file smaller than 1 MB.');
      const text = await file.text();
      const response = await fetch('/api/validate-configuration', {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: text,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The parameter file is not valid.');
      if (!data.parameters) throw new Error('The validated file did not contain model parameters.');
      // Validation is asynchronous. Keep edits, Undo, or a lesson loaded while
      // the file was being checked instead of silently replacing that newer draft.
      if (this.draftRevision !== startedAtRevision) {
        throw new Error('Settings changed while the file was being checked. Your newer settings were kept. Load the file again to apply it.');
      }
      this.loadParameters(data.parameters, 'Saved settings loaded. Run to reproduce the experiment.');
      $('presetSelect').value = '';
      $('presetDescription').textContent = `Imported settings · ${data.parameters.model_mode === 'compartment' ? 'effective-compartment model' : 'spatial diffusion model'}`;
      this.message(`${file.name} is valid. Run the simulation to reproduce its settings. Your completed result remains available for export.`);
      if ($('importFeedback')) $('importFeedback').textContent = `${file.name} loaded. Run to calculate these settings.`;
    } catch (error) {
      this.error(error.message || 'Could not read the parameter file.');
      this.message('Import did not complete. Your existing settings and completed result are preserved.');
      if ($('importFeedback')) $('importFeedback').textContent = error.message || 'Import did not complete. Your settings are preserved.';
    } finally {
      this.importing = false;
      $('importSettingsFile').value = '';
      this.updateEnabled();
    }
  }

  async exportResult(buttonId, suffix, filename) {
    const result = this.getResult();
    if (!result || this.exporting.has(buttonId)) return;
    const runId = result.run_id;
    this.exporting.add(buttonId);
    this.updateEnabled();
    this.clearError();
    this.message(`Preparing ${suffix} from completed run ${String(runId).slice(0, 10)}…`);
    try {
      const response = await fetch(`/api/export/${encodeURIComponent(runId)}/${suffix}`);
      if (!response.ok) {
        let details = {};
        try { details = await response.json(); } catch { /* A readable fallback remains below. */ }
        throw new Error(details.error || `Could not export ${suffix}. Run the experiment again and retry.`);
      }
      await downloadBlob(await response.blob(), filename);
      $('exportMenu').open = false;
      this.message(`Download started: ${filename}, from completed run ${String(runId).slice(0, 10)}.`);
    } catch (error) {
      this.error(error.message || 'The export could not be completed.');
    } finally {
      this.exporting.delete(buttonId);
      this.updateEnabled();
    }
  }

  message(text) { $('experimentMessage').textContent = text; }
  clearError() { $('experimentError').hidden = true; $('experimentError').textContent = ''; }
  error(text) { $('experimentError').textContent = text; $('experimentError').hidden = false; }
}

export async function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // A short delayed revocation lets browsers consume the local Blob download.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
