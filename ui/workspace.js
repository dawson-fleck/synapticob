/* Navigation and view state only. One completed experiment and one neuron. */
export class WorkspaceNavigation {
  constructor({getState, runSimulation, restoreCompletedRun, redraw}) {
    this.getState = getState;
    this.redraw = redraw;
    this.tabs = [...document.querySelectorAll('[data-workspace-tab]')];
    this.deck = document.getElementById('observationDeck');
    this.active = 'experiment';
    for (const tab of this.tabs) {
      tab.addEventListener('click', () => this.show(tab.dataset.workspaceTab));
      tab.addEventListener('keydown', event => {
        const index = this.tabs.indexOf(tab);
        let next;
        if (event.key === 'ArrowRight') next = (index + 1) % this.tabs.length;
        if (event.key === 'ArrowLeft') next = (index + this.tabs.length - 1) % this.tabs.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = this.tabs.length - 1;
        if (next === undefined) return;
        event.preventDefault();
        this.show(this.tabs[next].dataset.workspaceTab, {focus: true});
      });
    }
    document.addEventListener('click', event => {
      const link = event.target.closest('[data-workspace-target]');
      if (!link) return;
      event.preventDefault();
      this.show(link.dataset.workspaceTarget, {focus: true, reveal: true});
    });
    document.getElementById('globalRun').addEventListener('click', runSimulation);
    document.getElementById('restoreCompletedRun').addEventListener('click', restoreCompletedRun);
    document.getElementById('observationToggle').addEventListener('click', () => {
      this.setExpanded(this.deck.dataset.expanded !== 'true');
    });
    document.getElementById('observationResolutionLink').addEventListener('click', () => {
      this.show('results');
      const warning = document.getElementById('numericalResolutionWarning');
      warning.tabIndex = -1;
      warning.focus({preventScroll: true});
      warning.scrollIntoView({block: 'start'});
    });
    this.resizeObserver = new ResizeObserver(() => {
      const height = Math.ceil(this.deck.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--observation-height', `${height}px`);
    });
    this.resizeObserver.observe(this.deck);
    this.show('experiment');
    this.update();
  }

  show(name, {focus = false, reveal = false} = {}) {
    const selected = this.tabs.find(tab => tab.dataset.workspaceTab === name);
    if (!selected) return;
    this.active = name;
    for (const tab of this.tabs) {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
    }
    document.body.dataset.workspaceTab = name;
    if (focus) selected.focus({preventScroll: true});
    if (reveal) selected.scrollIntoView({block: 'nearest'});
    requestAnimationFrame(() => {
      this.redraw?.();
      document.dispatchEvent(new CustomEvent('neurochemsim:workspace-tab', {detail: name}));
    });
  }

  setExpanded(expanded) {
    this.deck.dataset.expanded = String(expanded);
    const button = document.getElementById('observationToggle');
    button.setAttribute('aria-expanded', String(expanded));
    button.textContent = expanded ? 'Compact neuron' : 'Expand neuron';
  }

  revealField(id) {
    const field = document.getElementById(id);
    if (!field) return;
    document.getElementById('fieldValidationMessage')?.remove();
    const panel = field.closest('[role=tabpanel]');
    if (panel) this.show(panel.id.replace('panel-', ''));
    for (let parent = field.parentElement; parent; parent = parent.parentElement) {
      if (parent.tagName === 'DETAILS') parent.open = true;
    }
    if (matchMedia('(max-width: 1050px)').matches) this.setExpanded(false);
    const message = document.createElement('p');
    message.id = 'fieldValidationMessage';
    message.className = 'field-validation-message';
    message.textContent = document.getElementById('errorBanner').textContent;
    const row = field.closest('.control-value-row, .drug-dose-row') || field;
    row.insertAdjacentElement('afterend', message);
    field.setAttribute('aria-invalid', 'true');
    const descriptions = new Set((field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
    descriptions.add(message.id);
    field.setAttribute('aria-describedby', [...descriptions].join(' '));
    field.focus({preventScroll: true});
    field.scrollIntoView({block: 'start'});
  }

  update() {
    const {result, dirty, running, defaults} = this.getState();
    const button = document.getElementById('globalRun');
    button.disabled = running || !defaults;
    button.textContent = running ? 'Calculating…' : 'Run experiment';
    document.getElementById('restoreCompletedRun').disabled = running || !result || !dirty;
    const run = result ? result.run_id.slice(0, 8) : '';
    const header = running ? 'Calculating your experiment…'
      : dirty ? 'Changes pending · run to apply'
      : result ? `Completed run ${run}` : 'Preparing your first experiment…';
    document.getElementById('currentRunStatus').textContent = header;
    document.getElementById('observationRunStatus').textContent = result
      ? `${result.parameters.pharmacology ? 'Drug lab' : 'Standard model'} · run ${run}${running ? ' · Showing previous result while calculating' : dirty ? ' · Showing previous result; changes pending' : ' · Readings match the completed experiment'}`
      : 'The neuron and live readings will appear after your first run.';
    this.deck.dataset.pending = String(Boolean(dirty || running));
    document.getElementById('observationResolutionLink').hidden = result?.numerical_resolution?.status !== 'review_required';
  }
}
