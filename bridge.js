// Browser adapter: scenario metadata, drafts, and device APIs.
// Rust/WASM owns CVSS validation, scoring, metric rendering, and XLSX packaging.
const enc = new TextEncoder(),
  dec = new TextDecoder();
let engine;
const root = document.getElementById('app');
function call(action = 0, input = '') {
  const data = enc.encode(input);
  if (data.length > 262144) throw Error('Input exceeds the 256 KB bridge limit.');
  new Uint8Array(engine.memory.buffer, engine.input_ptr(), data.length).set(data);
  const len = engine.run(action, data.length);
  if (!len) throw Error('The calculator could not process this input.');
  return dec.decode(new Uint8Array(engine.memory.buffer, engine.output_ptr(), len));
}
function paint(action = 0, input = '', focus) {
  if ([1, 2, 4].includes(action)) assertEditable();
  if ([1, 2, 4].includes(action)) {
    dirty = true;
    active = true;
  }
  const open = [...root.querySelectorAll('details[open]')].map(
    (x) => x.closest('.metric')?.querySelector('input')?.name || x.className,
  );
  root.innerHTML = call(action, input);
  renderScenario();
  for (const d of root.querySelectorAll('details')) {
    const key = d.closest('.metric')?.querySelector('input')?.name || d.className;
    if (open.includes(key)) d.open = true;
  }
  if (focus) {
    const el = focus.startsWith('tab-')
      ? document.getElementById(focus)
      : root.querySelector(`input[name="${focus}"]:checked`);
    el?.focus({ preventScroll: true });
  }
}
let toastTimer;
function toast(message) {
  const t = document.getElementById('toast');
  t.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.textContent = ''), 5000);
}
function download(text, type, name) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function importVector(vector, preserve = false) {
  paint(1, vector);
  const err = root.querySelector('.error');
  if (err) throw Error(err.textContent);
  if (!preserve) {
    wizard = null;
    reviewed = [];
    paint();
  }
  return JSON.parse(call(8));
}
function extractFile(text, name) {
  if (name.toLowerCase().endsWith('.json')) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw Error('Invalid JSON. Choose a JSON assessment exported by this calculator.');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.vector !== 'string')
      throw Error('The JSON file must contain a string named "vector".');
    if (data.format !== undefined && (data.format !== 'quiet-cvss' || data.schemaVersion !== 1))
      throw Error('Unsupported assessment format or schema version.');
    if (data.cvssVersion !== undefined && data.cvssVersion !== '4.0')
      throw Error('Only CVSS 4.0 assessments are supported.');
    return data.vector;
  }
  const candidates = text
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter((x) => x.startsWith('CVSS:'));
  if (candidates.length !== 1)
    throw Error('The text file must contain exactly one CVSS vector on its own line.');
  return candidates[0];
}
// BROWSER_EVENTS_BEGIN
root.addEventListener('submit', (e) => {
  e.preventDefault();
  if (readOnly) {
    toast('Clone this sample before editing.');
    return;
  }
  const input = document.getElementById('vector-input').value;
  paint(1, input);
});
root.addEventListener('change', async (e) => {
  try {
    if (e.target.id === 'appearance') {
      appearance = e.target.value;
      paint();
      document.getElementById('appearance').focus({ preventScroll: true });
      return;
    }
    if (e.target.matches('input[type="radio"]'))
      paint(2, `${e.target.name}:${e.target.value}`, e.target.name);
    if (e.target.id === 'file-input') {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 262144) throw Error('Choose a text or JSON assessment smaller than 256 KB.');
      const vector = extractFile(await file.text(), file.name);
      importVector(vector);
      if (file.name.toLowerCase().endsWith('.json')) {
        const details = JSON.parse(await file.text()).scenario;
        if (details) {
          if (
            typeof details.title !== 'string' ||
            details.title.length > 160 ||
            typeof details.notes !== 'string' ||
            details.notes.length > 8000
          )
            throw Error(
              'Invalid scenario details in JSON. Vector was imported; scenario details were not.',
            );
          scenario = {
            id: null,
            title: details.title,
            notes: details.notes,
            sampleId: SAMPLES.some((s) => s.id === details.sampleId) ? details.sampleId : null,
            metricNotes: validMetricNotes(details.metricNotes),
          };
          paint();
        }
      }
      toast('Assessment imported and score recalculated locally.');
    }
  } catch (error) {
    toast(error.message);
  }
});
root.addEventListener('keydown', (e) => {
  if (
    e.target.matches('[role="tab"]') &&
    ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)
  ) {
    e.preventDefault();
    let tab = Number(e.target.dataset.tab);
    tab = e.key === 'Home' ? 0 : e.key === 'End' ? 3 : (tab + (e.key === 'ArrowRight' ? 1 : 3)) % 4;
    paint(3, String(tab), `tab-${tab}`);
  }
});
root.addEventListener('click', async (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    paint(3, tab.dataset.tab, `tab-${tab.dataset.tab}`);
    return;
  }
  const button = e.target.closest('[data-action]');
  if (!button) return;
  try {
    switch (button.dataset.action) {
      case 'file':
        document.getElementById('file-input').click();
        break;
      case 'reset':
        if (!confirm('Reset all classifications? Your saved drafts will remain available.')) break;
        wizard = null;
        reviewed = [];
        paint(4);
        break;
      case 'pdf':
        exportPdf();
        break;
      case 'excel':
        exportExcel();
        break;
      case 'json':
        download(
          JSON.stringify(
            {
              ...JSON.parse(call(5)),
              scenario: {
                title: scenario.title,
                notes: scenario.notes,
                sampleId: scenario.sampleId,
                metricNotes: scenario.metricNotes ?? {},
              },
            },
            null,
            2,
          ),
          'application/json',
          'cvss-assessment.json',
        );
        toast('JSON downloaded.');
        break;
      case 'text':
        download(
          `Scenario: ${scenario.title}\nAssessment notes: ${scenario.notes}\n\n${call(6)}\nMetric notes:\n${Object.entries(
            scenario.metricNotes ?? {},
          )
            .map(([key, note]) => key + ': ' + note)
            .join('\n')}`,
          'text/plain;charset=utf-8',
          'cvss-assessment.txt',
        );
        toast('Text assessment downloaded.');
        break;
      case 'copy': {
        const vector = call(7);
        try {
          await navigator.clipboard.writeText(vector);
        } catch {
          const input = document.getElementById('vector-input');
          input.value = vector;
          input.focus();
          input.select();
          if (!document.execCommand('copy')) {
            toast('Vector selected. Press Ctrl+C or Cmd+C to copy.');
            return;
          }
        }
        toast('Vector copied.');
        break;
      }
    }
  } catch (error) {
    toast(error.message);
  }
});
// BROWSER_FEATURES_BEGIN
function shouldShowMetricNotes(note, locked) {
  return !locked || (typeof note === 'string' && note.trim().length > 0);
}
// Browser storage and print are opt-in device APIs; scoring remains in Rust/WASM.
const DRAFT_KEY = 'quietscore.drafts.v1';
let scenario = { id: null, title: '', notes: '', sampleId: null, metricNotes: {} },
  wizard = null,
  reviewed = [],
  dirty = false,
  active = false,
  readOnly = false,
  appearance = 'system';
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
function assertEditable() {
  if (readOnly)
    throw Error('Published samples are read-only. Clone as starting point to make changes.');
}
function cloneCurrentSample() {
  if (!readOnly) return;
  readOnly = false;
  scenario = { ...scenario, id: null, title: scenario.title + ' · my assessment' };
  wizard = null;
  reviewed = [];
  dirty = true;
  paint();
  toast('Editable clone created. Save a draft to keep your work.');
  document.getElementById('scenario-title')?.focus();
}
function assessment() {
  return JSON.parse(call(11, call(7)));
}
function readDrafts() {
  let records;
  try {
    records = JSON.parse(localStorage.getItem(DRAFT_KEY) || '[]');
  } catch {
    throw Error(
      'Local drafts are unavailable. Browser storage may be disabled or damaged. Export your assessment to keep a copy.',
    );
  }
  if (
    !Array.isArray(records) ||
    records.some(
      (d) =>
        !d ||
        typeof d.id !== 'string' ||
        typeof d.title !== 'string' ||
        typeof d.notes !== 'string' ||
        typeof d.vector !== 'string' ||
        !Array.isArray(d.reviewed) ||
        !Number.isInteger(d.step) ||
        d.step < 0 ||
        d.step > 32 ||
        typeof d.guided !== 'boolean' ||
        typeof d.updated !== 'string',
    )
  )
    throw Error('Saved drafts have an unsupported format. They have not been changed.');
  return records;
}
function writeDrafts(records) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(records));
  } catch {
    throw Error(
      'Draft could not be saved. Storage may be blocked or full. Export JSON or text instead.',
    );
  }
}
function renderScenario() {
  document.documentElement.dataset.theme = appearance;
  const themeControl = document.createElement('label');
  themeControl.className = 'appearance-control';
  themeControl.innerHTML =
    '<span>Appearance</span><select id="appearance" aria-label="Appearance"><option value="system">Device setting</option><option value="light">Light</option><option value="dark">Dark</option><option value="contrast">High contrast</option></select>';
  root.querySelector('header').append(themeControl);
  themeControl.querySelector('select').value = appearance;
  root.querySelector('h1').textContent = 'Understand severity. Build a clear assessment.';
  root.querySelector('.subtitle').textContent =
    'Walk through a scenario, continue a draft, or explore a real vulnerability. Private CVSS 4.0 scoring on your device.';
  root.querySelector('.workspace').hidden = !active;
  const metrics = assessment().metrics;
  const panel = document.createElement('section');
  panel.className = 'scenario-card';
  panel.setAttribute('aria-label', 'Scenario and local drafts');
  panel.innerHTML = `<div class="start-paths"><button data-scenario="new" class="start-path primary"><b>＋ New guided scenario</b><span>Answer clear questions, one step at a time.</span></button><button data-scenario="drafts" class="start-path"><b>Continue a draft</b><span>Reopen work saved in this browser.</span></button><button data-scenario="samples" class="start-path"><b>Explore real vulnerabilities</b><span>10 sourced examples, including Log4Shell.</span></button></div><h2 class="scenario-heading" ${active ? '' : 'hidden'}>${readOnly ? 'Published sample · read-only' : 'Your assessment'}</h2>
 <div class="scenario-fields" ${active ? '' : 'hidden'}><label>Scenario name<input id="scenario-title" ${readOnly ? 'readonly' : ''} maxlength="160" placeholder="e.g. Customer portal authorization bypass" value="${escapeHtml(scenario.title)}"></label><label>Assessment notes <button type="button" class="notes-expand" aria-label="Expand assessment notes" data-scenario="notes">⤢ Expand notes</button><textarea aria-label="Assessment notes" id="scenario-notes" ${readOnly ? 'readonly' : ''} maxlength="8000" rows="2" placeholder="Affected component, assumptions, and evidence">${escapeHtml(scenario.notes)}</textarea></label></div>
 <div class="assessment-actions" ${active && !readOnly ? '' : 'hidden'}><button data-scenario="save" class="primary">Save draft locally</button><button data-scenario="guide">${wizard === null ? 'Guide this assessment' : 'Show all metrics'}</button><span>${dirty ? 'Unsaved changes' : scenario.id ? 'Draft saved on this device' : 'Editable assessment'}</span></div><div class="sample-lock" ${active && readOnly ? '' : 'hidden'}><span>◇ Published classifications are locked. Browse the metrics or export the reference.</span><button data-scenario="clone" class="primary">Clone as starting point</button></div><details class="local-drafts"><summary>Local drafts · save and resume</summary><div class="draft-toolbar"><button data-scenario="save-copy" ${readOnly || !active ? 'disabled' : ''}>Save as new draft</button><label>Saved drafts<select id="draft-select"><option value="">Choose a draft…</option></select></label><button data-scenario="load">Open draft</button><button data-scenario="delete">Delete selected draft</button></div>
 <p class="export-note">Drafts are saved only when you choose Save, in this browser on this device. They are not encrypted or synced. Clearing browser data removes them. Export a file for a portable backup.</p><p id="draft-status" role="status"></p></details><details class="sample-library"><summary>Published samples · 2026 and a classic</summary><p>Bundled public examples, verified 4 October 2026. Scores belong to the named source and scenario. Samples are read-only references. Clone one to create your own editable assessment.</p><div class="sample-grid">${SAMPLES.map((sample) => `<article class="sample-card"><div class="sample-meta">${sample.id} · ${sample.published}</div><h3>${escapeHtml(sample.title)}</h3><span class="sample-score">${sample.score.toFixed(1)} / 10 · ${escapeHtml(sample.scorer)}</span><p>${escapeHtml(sample.lesson)}</p><p class="sample-kind">${escapeHtml(sample.kind)}</p><div class="sample-actions"><button data-sample="${sample.id}">View sample →</button><button data-sample="${sample.id}" data-clone="true">Clone as starting point</button>${sample.variation ? `<button data-sample="${sample.id}" data-variation="true">Compare mitigation →</button>` : ''}</div><details><summary>Sources & assessment details</summary>${sample.sources.map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.label)} ↗</a>`).join('')}<code>${escapeHtml(sample.vector)}</code>${sample.caveat ? `<p>${escapeHtml(sample.caveat)}</p>` : ''}</details></article>`).join('')}</div></details>`;
  const vectorCard = root.querySelector('.vector-card'),
    importPanel = document.createElement('details');
  importPanel.className = 'vector-import';
  importPanel.hidden = readOnly;
  importPanel.innerHTML = '<summary>Have a vector or assessment file? Import it here</summary>';
  vectorCard.before(panel);
  vectorCard.before(importPanel);
  importPanel.append(vectorCard);
  const selectedSample = SAMPLES.find((sample) => sample.id === scenario.sampleId);
  if (selectedSample && active) {
    const context = document.createElement('div');
    context.className = 'sample-context';
    context.innerHTML = `<b>Based on ${selectedSample.id} · ${escapeHtml(selectedSample.scorer)}</b><p>${escapeHtml(selectedSample.lesson)}</p><p>${readOnly ? 'Reference scenario. Classifications are locked.' : 'Cloned assessment. Changes apply only to your copy.'} Published Base/reference score: ${selectedSample.score.toFixed(1)}.</p>${selectedSample.sources.map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.label)} ↗</a>`).join(' · ')}`;
    panel.querySelector('.scenario-heading').after(context);
  }
  const select = panel.querySelector('select');
  try {
    for (const d of readDrafts()) {
      const option = document.createElement('option');
      option.value = d.id;
      option.textContent = `${d.title || 'Untitled scenario'} · ${new Date(d.updated).toLocaleString()}`;
      option.selected = d.id === scenario.id;
      select.append(option);
    }
  } catch (error) {
    panel.querySelector('#draft-status').textContent = error.message;
  }
  if (dirty)
    panel.querySelector('#draft-status').textContent =
      'Unsaved changes — save a draft to keep this work.';
  if (readOnly) {
    for (const field of root.querySelectorAll('.metric')) field.disabled = true;
    root.querySelector('[data-action="reset"]').hidden = true;
    root.querySelector('.score-top .eyebrow').textContent = 'PUBLISHED SAMPLE · READ-ONLY';
  }
  root.querySelector('.export-buttons').innerHTML = [
    ['json', 'JSON', 'file-json'],
    ['text', 'Plain text', 'file-text'],
    ['pdf', 'PDF', 'file-type'],
    ['excel', 'Excel', 'file-spreadsheet'],
  ]
    .map(
      ([action, label, icon]) =>
        `<button data-action="${action}" aria-label="Export ${label}">${EXPORT_ICONS[icon]}<span>${label}</span></button>`,
    )
    .join('');
  decorateMetrics(metrics);
  if (wizard === null) return;
  const heading = root.querySelector('.group-heading'),
    guide = document.createElement('div');
  guide.className = 'wizard-card';
  root.querySelector('.tabs').hidden = true;
  heading.hidden = true;
  root.querySelector('.group-intro').hidden = true;
  for (const node of root.querySelectorAll('.subgroup,.scope-note')) node.hidden = true;
  for (const field of root.querySelectorAll('.metric'))
    field.hidden =
      wizard >= metrics.length || field.querySelector('input').name !== metrics[wizard].metric;
  if (wizard < metrics.length) {
    const m = metrics[wizard];
    guide.innerHTML = `<p class="eyebrow">GUIDED SCENARIO · ${escapeHtml(m.group.toUpperCase())}</p><h2 tabindex="-1" id="wizard-heading">Step ${wizard + 1} of ${metrics.length}: ${escapeHtml(m.name)}</h2><progress max="${metrics.length}" value="${wizard}" aria-label="Wizard progress"></progress><p>${wizard < 11 ? 'Choose a classification below, then confirm it. The starting value is a placeholder until you review it.' : 'This metric is optional. Not defined uses the standard CVSS defaults; Supplemental metrics do not affect severity.'}</p>`;
  } else {
    guide.innerHTML = `<p class="eyebrow">GUIDED SCENARIO · REVIEW</p><h2 tabindex="-1" id="wizard-heading">Review your assessment</h2><p>All 11 Base classifications have been reviewed. Check your vector and severity, add evidence to the scenario notes, then save or export.</p><ul>${metrics
      .filter((m) => m.group === 'Base' || m.value !== 'X')
      .map((m) => `<li><b>${escapeHtml(m.name)} (${m.metric}):</b> ${escapeHtml(m.label)}</li>`)
      .join('')}</ul>`;
  }
  root.querySelector('#metric-content').prepend(guide);
  const navigation = document.createElement('div');
  navigation.className = 'wizard-nav';
  navigation.innerHTML = `<button data-scenario="back" ${wizard === 0 ? 'disabled' : ''}>← Back</button>${wizard < metrics.length ? `<button class="primary" data-scenario="next">${wizard < 11 ? 'Confirm classification & continue' : 'Keep selection & continue'} →</button>${wizard >= 11 ? '<button data-scenario="skip">Skip remaining optional metrics</button>' : ''}` : '<button data-action="pdf">Export PDF</button>'}`;
  root.querySelector('#metric-content').append(navigation);
  if (!root.querySelector('.error'))
    root.querySelector('.score-top .eyebrow').textContent =
      wizard < 11 ? 'PROVISIONAL · REVIEW BASE METRICS' : 'LIVE SEVERITY';
}
function paintWizard(focus = true) {
  const groups = { Base: 0, Threat: 1, Environmental: 2, Supplemental: 3 };
  const m = assessment().metrics[wizard];
  paint(3, String(m ? groups[m.group] : 0));
  if (focus) {
    const heading = document.getElementById('wizard-heading');
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
root.addEventListener('input', (e) => {
  if (readOnly) return;
  if (e.target.dataset.metricNote) {
    scenario.metricNotes ??= {};
    scenario.metricNotes[e.target.dataset.metricNote] = e.target.value;
    dirty = true;
  }
  if (e.target.id === 'scenario-title') {
    scenario.title = e.target.value;
    dirty = true;
  }
  if (e.target.id === 'scenario-notes') {
    scenario.notes = e.target.value;
    dirty = true;
  }
});
root.addEventListener('change', (e) => {
  if (readOnly) return;
  if (e.target.matches('input[type="radio"]')) {
    dirty = true;
    document.getElementById('draft-status').textContent =
      'Unsaved changes — save a draft to keep this work.';
  }
});
root.addEventListener('submit', () => {
  if (readOnly) return;
  if (!root.querySelector('.error')) {
    wizard = null;
    reviewed = [];
    dirty = true;
    paint();
  }
});
root.addEventListener('click', (e) => {
  const sampleButton = e.target.closest('[data-sample]');
  if (sampleButton) {
    try {
      const sample = SAMPLES.find((s) => s.id === sampleButton.dataset.sample);
      if (!sample) return;
      if (dirty && !confirm('Discard unsaved changes and explore this sample?')) return;
      const variation = sampleButton.dataset.variation ? sample.variation : null;
      readOnly = false;
      scenario = {
        id: null,
        sampleId: sample.id,
        title: sample.title + (variation ? ' · mitigation scenario' : ''),
        metricNotes: {},
        notes: `${sample.id} · Published ${sample.published}.\n${sample.kind} from ${sample.scorer}. Published score ${sample.score}.\n${sample.lesson}\n${sample.sources.map((s) => s.label + ': ' + s.url).join('\n')}${sample.caveat ? '\n' + sample.caveat : ''}${variation ? '\nVariation: ' + variation.label : ''}`,
      };
      active = true;
      wizard = null;
      reviewed = [];
      importVector(variation?.vector ?? sample.vector);
      readOnly = !sampleButton.dataset.clone;
      dirty = !readOnly;
      if (!readOnly) scenario.title += ' · my assessment';
      paint();
      root.querySelector('.sample-library').open = false;
      toast(
        readOnly
          ? 'Read-only sample opened. Clone it to make changes.'
          : 'Editable clone created. Save a draft to keep changes.',
      );
      root
        .querySelector('.scenario-heading')
        .scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      toast(error.message);
    }
    return;
  }
  const button = e.target.closest('[data-scenario]');
  if (!button) return;
  try {
    if (
      readOnly &&
      ['guide', 'back', 'next', 'skip', 'save', 'save-copy'].includes(button.dataset.scenario)
    )
      assertEditable();
    switch (button.dataset.scenario) {
      case 'clone':
        cloneCurrentSample();
        break;
      case 'notes':
        expandNotes();
        break;
      case 'drafts':
        root.querySelector('.local-drafts').open = true;
        document.getElementById('draft-select').focus();
        break;
      case 'samples':
        root.querySelector('.sample-library').open = true;
        root
          .querySelector('.sample-library')
          .scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
      case 'new':
        if (dirty && !confirm('Discard unsaved changes and start a new scenario?')) return;
        readOnly = false;
        scenario = { id: null, title: '', notes: '', sampleId: null, metricNotes: {} };
        active = true;
        reviewed = [];
        wizard = 0;
        dirty = true;
        paint(4);
        paintWizard();
        root.querySelector('.sample-library').open = false;
        root.querySelector('.local-drafts').open = false;
        document.getElementById('scenario-title').focus();
        break;
      case 'guide':
        active = true;
        wizard = wizard === null ? 0 : null;
        dirty = true;
        paintWizard();
        root.querySelector('.sample-library').open = false;
        break;
      case 'back':
        wizard = Math.max(0, wizard - 1);
        dirty = true;
        paintWizard();
        break;
      case 'next':
        reviewed = [...new Set([...reviewed, assessment().metrics[wizard].metric])];
        wizard++;
        dirty = true;
        paintWizard();
        break;
      case 'skip':
        wizard = 32;
        dirty = true;
        paintWizard();
        break;
      case 'save':
      case 'save-copy': {
        if (root.querySelector('.error'))
          throw Error('Fix the invalid vector before saving a draft.');
        const records = readDrafts(),
          id =
            button.dataset.scenario === 'save-copy' || !scenario.id
              ? crypto.randomUUID()
              : scenario.id;
        const record = {
          id,
          metricNotes: scenario.metricNotes ?? {},
          sampleId: scenario.sampleId,
          title: scenario.title.trim() || 'Untitled scenario',
          notes: scenario.notes,
          vector: call(7),
          reviewed,
          step: wizard ?? 0,
          guided: wizard !== null,
          updated: new Date().toISOString(),
        };
        const index = records.findIndex((d) => d.id === id);
        if (index < 0) records.push(record);
        else records[index] = record;
        writeDrafts(records);
        scenario.id = id;
        scenario.title = record.title;
        dirty = false;
        paint();
        toast('Draft saved on this device.');
        break;
      }
      case 'load': {
        const d = readDrafts().find((d) => d.id === document.getElementById('draft-select').value);
        if (!d) throw Error('Choose a saved draft first.');
        const validation = JSON.parse(call(10, d.vector));
        if (!validation.valid)
          throw Error('This draft contains an invalid vector: ' + validation.error);
        if (dirty && !confirm('Discard unsaved changes and open the selected draft?')) return;
        readOnly = false;
        scenario = {
          id: d.id,
          title: d.title,
          notes: d.notes,
          sampleId: d.sampleId ?? null,
          metricNotes: validMetricNotes(d.metricNotes),
        };
        active = true;
        reviewed = d.reviewed;
        wizard = d.guided ? d.step : null;
        importVector(d.vector, true);
        dirty = false;
        paintWizard();
        root.querySelector('.local-drafts').open = false;
        root.querySelector('.sample-library').open = false;
        toast('Draft opened; score recalculated locally.');
        break;
      }
      case 'delete': {
        const id = document.getElementById('draft-select').value,
          records = readDrafts(),
          d = records.find((d) => d.id === id);
        if (!d) throw Error('Choose a saved draft first.');
        if (!confirm(`Delete “${d.title}” from this browser? This cannot be undone.`)) return;
        writeDrafts(records.filter((d) => d.id !== id));
        if (scenario.id === id) {
          scenario.id = null;
          dirty = true;
        }
        paint();
        toast('Saved draft deleted. Current assessment remains open.');
        break;
      }
    }
  } catch (error) {
    toast(error.message);
  }
});
function validMetricNotes(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Invalid metric notes.');
  const allowed = assessment().metrics.map((m) => m.metric);
  for (const [key, note] of Object.entries(value))
    if (!allowed.includes(key) || typeof note !== 'string' || note.length > 2000)
      throw Error('Invalid metric note: ' + key);
  return { ...value };
}
function sampleContext(key) {
  return SAMPLES.find((s) => s.id === scenario.sampleId)?.metricContext?.[key];
}
function sampleReason(key) {
  const c = sampleContext(key);
  return c ? `Published ${key}:${c.value} · ${c.status}. ${c.text}` : '';
}
function metricCue(key, value) {
  if (value === 'X') return { tone: 'neutral', text: 'Not defined' };
  if (['S', 'AU', 'R', 'V', 'RE', 'U'].includes(key))
    return { tone: 'neutral', text: 'Context only' };
  const k = key.startsWith('M') ? key.slice(1) : key;
  const order = {
    AV: ['P', 'L', 'A', 'N'],
    AC: ['H', 'L'],
    AT: ['P', 'N'],
    PR: ['H', 'L', 'N'],
    UI: ['A', 'P', 'N'],
    VC: ['N', 'L', 'H'],
    VI: ['N', 'L', 'H'],
    VA: ['N', 'L', 'H'],
    SC: ['N', 'L', 'H'],
    SI: ['N', 'L', 'H', 'S'],
    SA: ['N', 'L', 'H', 'S'],
    E: ['U', 'P', 'A'],
    CR: ['L', 'M', 'H'],
    IR: ['L', 'M', 'H'],
    AR: ['L', 'M', 'H'],
  }[k];
  if (!order) return { tone: 'neutral', text: 'Context only' };
  const index = order.indexOf(value);
  const tone = index === 0 ? 'lower' : index === order.length - 1 ? 'higher' : 'middle';
  return {
    tone,
    text:
      tone === 'higher'
        ? 'Higher severity tendency'
        : tone === 'lower'
          ? 'Lower severity tendency'
          : 'Intermediate severity tendency',
  };
}
function decorateMetrics(metrics) {
  for (const field of root.querySelectorAll('.metric')) {
    const key = field.querySelector('input').name,
      m = metrics.find((m) => m.metric === key);
    for (const label of field.querySelectorAll('.option')) {
      const input = label.querySelector('input'),
        cue = metricCue(key, input.value);
      label.dataset.cue = cue.tone;
      label.title = cue.text;
      const marker = document.createElement('span');
      marker.className = 'metric-cue';
      marker.textContent =
        cue.tone === 'higher'
          ? '↑'
          : cue.tone === 'lower'
            ? '↓'
            : cue.tone === 'middle'
              ? '↔'
              : '·';
      marker.setAttribute('aria-label', cue.text);
      label.append(marker);
    }
    const reason = sampleReason(key);
    if (reason) {
      const block = document.createElement('p');
      block.className = 'sample-rationale';
      block.textContent = 'Sample rationale: ' + reason;
      const c = sampleContext(key);
      for (const [i, url] of c.sources.entries()) {
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = ' Source ' + (i + 1) + ' ↗';
        block.append(link);
      }
      field.append(block);
    }
    const noteText = scenario.metricNotes?.[key] ?? '';
    if (!shouldShowMetricNotes(noteText, readOnly)) continue;
    const note = document.createElement('label');
    note.className = 'metric-notes';
    note.innerHTML = `Optional notes for ${escapeHtml(m.name)}<textarea data-metric-note="${key}" maxlength="2000" rows="2" ${readOnly ? 'readonly' : ''} placeholder="Why this classification? Add assumptions or evidence.">${escapeHtml(scenario.metricNotes?.[key] ?? '')}</textarea>`;
    field.append(note);
  }
  const legend = document.createElement('p');
  legend.className = 'cue-legend';
  legend.textContent =
    '↑ Red: higher severity tendency · ↔ Amber: intermediate · ↓ Pale yellow: lower. These cues describe individual choices, not independent CVSS scores. Context-only metrics are neutral.';
  root.querySelector('#metric-content').prepend(legend);
}
function expandNotes() {
  let dialog = document.getElementById('notes-dialog');
  if (dialog) dialog.remove();
  dialog = document.createElement('dialog');
  dialog.id = 'notes-dialog';
  dialog.innerHTML = `<div class="notes-dialog-heading"><h2>Assessment notes</h2><button type="button" data-close-notes aria-label="Close expanded notes">Close ×</button></div><p>${readOnly ? 'Published sample notes are read-only. Clone the sample to edit.' : 'Optional. Changes are kept in this assessment; save a draft to retain them.'}</p><textarea aria-label="Expanded assessment notes" maxlength="8000" ${readOnly ? 'readonly' : ''}>${escapeHtml(scenario.notes)}</textarea>`;
  document.body.append(dialog);
  const input = dialog.querySelector('textarea');
  input.addEventListener('input', () => {
    if (readOnly) return;
    scenario.notes = input.value;
    dirty = true;
    document.getElementById('scenario-notes').value = input.value;
  });
  dialog.querySelector('[data-close-notes]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    dialog.remove();
    document.querySelector('[data-scenario="notes"]')?.focus();
  });
  dialog.showModal();
  input.focus();
}
function exportExcel() {
  if (root.querySelector('.error')) throw Error('Fix the invalid vector before exporting.');
  const result = assessment();
  const rows = [
    ['QuietScore CVSS 4.0 assessment'],
    ['Scenario', scenario.title || 'Untitled scenario'],
    ['Reference mode', readOnly ? 'Published sample (read-only)' : 'Editable assessment'],
    ['Score', 'n:' + result.score],
    ['Severity', result.severity],
    ['Score type', result.nomenclature],
    ['Vector', result.vector],
    ['Exported', new Date().toISOString()],
    [
      'Review status',
      wizard !== null && wizard < 11
        ? 'Provisional — Base review incomplete'
        : 'Review selected classifications',
    ],
  ];
  for (let i = 0; i < scenario.notes.length; i += 500)
    rows.push([
      i ? 'Assessment notes (continued)' : 'Assessment notes',
      scenario.notes.slice(i, i + 500),
    ]);
  rows.push(
    ['CVSS source', 'https://www.first.org/cvss/v4.0/specification-document'],
    [
      'Meaning',
      'Static assessment snapshot. CVSS describes severity, not complete business risk. Editing Excel cells does not recalculate CVSS.',
    ],
    [],
    [
      'Group',
      'Metric',
      'Classification',
      'Value',
      'Effective value',
      'Classification meaning',
      'Sample rationale',
      'Assessor notes',
      'Sources',
    ],
  );
  const sample = SAMPLES.find((s) => s.id === scenario.sampleId);
  for (const m of result.metrics)
    rows.push([
      m.group,
      m.metric + ' — ' + m.name,
      m.label,
      m.value,
      m.effectiveValue,
      m.explanation,
      sampleReason(m.metric),
      scenario.metricNotes?.[m.metric] ?? '',
      sampleContext(m.metric)?.sources.join('\n') ?? result.source,
    ]);
  const packet = rows
    .map((row) =>
      row
        .map((value) => String(value).replace(/[\x00-\x1f]/g, (c) => (c === '\n' ? '\n' : ' ')))
        .join('\x1f'),
    )
    .join('\x1e');
  const data = enc.encode(packet);
  if (data.length > 262144) throw Error('Assessment exceeds the export limit.');
  new Uint8Array(engine.memory.buffer, engine.input_ptr(), data.length).set(data);
  const length = engine.run(13, data.length);
  if (!length) throw Error('Excel export failed.');
  const bytes = new Uint8Array(engine.memory.buffer, engine.output_ptr(), length).slice();
  download(
    bytes,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'quietscore-assessment.xlsx',
  );
  toast('Entire assessment exported as Excel.');
}
function exportPdf() {
  if (root.querySelector('.error')) throw Error('Fix the invalid vector before exporting a PDF.');
  const result = assessment();
  let report = document.getElementById('print-report');
  if (!report) {
    report = document.createElement('article');
    report.id = 'print-report';
    document.body.append(report);
  }
  report.innerHTML = `<h1>QuietScore · CVSS 4.0 ${readOnly ? 'published sample · read-only' : 'assessment'}</h1><h2>${escapeHtml(scenario.title || 'Untitled scenario')}</h2><p>${result.score.toFixed(1)} / 10 · ${result.severity} · ${result.nomenclature}</p>${wizard !== null && wizard < 11 ? '<p><b>Provisional: Base classifications have not all been reviewed.</b></p>' : ''}<p>Exported ${escapeHtml(new Date().toLocaleString())}</p><p class="report-notes">${escapeHtml(scenario.notes)}</p><p class="report-vector">${escapeHtml(result.vector)}</p><h2>Classifications</h2>${result.metrics.map((m) => `<section><h3>${escapeHtml(m.group)} · ${escapeHtml(m.name)} (${m.metric})</h3><p><b>${escapeHtml(m.label)} (${escapeHtml(m.value)})</b>${m.value !== m.effectiveValue ? ` · Effective value: ${escapeHtml(m.effectiveValue)}` : ''}</p><p>${escapeHtml(m.explanation)}</p>${sampleReason(m.metric) ? `<p><b>Sample rationale:</b> ${escapeHtml(sampleReason(m.metric))}</p>` : ''}${scenario.metricNotes?.[m.metric] ? `<p><b>Assessor notes:</b> ${escapeHtml(scenario.metricNotes[m.metric])}</p>` : ''}</section>`).join('')}<p>CVSS describes vulnerability severity, not complete business risk. Supplemental metrics do not affect the score. Calculated locally with Rust/WebAssembly.</p><p>Scoring and classifications based on FIRST CVSS 4.0: https://www.first.org/cvss/v4.0/specification-document. Guidance is a plain-language interpretation.</p>`;
  toast('Choose “Save as PDF” in your browser’s print dialog.');
  window.print();
}
// ENGINE_BOOTSTRAP
try {
  const binary = Uint8Array.from(atob(WASM_BASE64), (c) => c.charCodeAt(0));
  engine = (await WebAssembly.instantiate(binary, {})).instance.exports;
  paint();
  // Opt-in browser standard. Never sends anything to a server; unavailable in most browsers.
  if (document.modelContext?.registerTool) {
    const lifecycle = new AbortController();
    addEventListener('pagehide', () => lifecycle.abort(), { once: true });
    await Promise.resolve(
      document.modelContext.registerTool(
        {
          name: 'apply_cvss_vector',
          title: 'Apply CVSS 4.0 vector',
          description:
            'Validate a CVSS 4.0 vector locally, update the visible calculator, and return its recalculated severity.',
          inputSchema: {
            type: 'object',
            properties: { vector: { type: 'string', maxLength: 8192 } },
            required: ['vector'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute(input) {
            if (
              !input ||
              typeof input.vector !== 'string' ||
              Object.keys(input).some((k) => k !== 'vector')
            )
              throw Error('Provide only a vector string.');
            return importVector(input.vector);
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => {});
  }
} catch (error) {
  root.innerHTML =
    '<section class="loading"><h1>The local engine could not start.</h1><p>This calculator requires a browser with WebAssembly enabled. No assessment was sent anywhere.</p></section>';
}
