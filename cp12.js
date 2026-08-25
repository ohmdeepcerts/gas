/* CP12 Gas Safety Certificate — JavaScript V5
   Split from single-file V4.8. Fixes applied:
   GAS-001 jsPDF local   GAS-002 backup/restore   GAS-004 sig canvas
   GAS-008/012 work truncation   GAS-009 Gas Safe validation
   GAS-011 clearAll draft   GAS-016 placeholder warn   FEAT-08 beforeunload
*/

'use strict';

// ── Dirty-form guard (FEAT-08) ──────────────────────────────────────────────
let formDirty = false;
window.addEventListener('beforeunload', e => {
  if (formDirty) { e.preventDefault(); e.returnValue = ''; }
});

// ── Reference storage keys ──────────────────────────────────────────────────
const REF_STORAGE = {
  BASE:   'cp12_ref_base',
  LOCK:   'cp12_ref_lock',
  DOOR:   'cp12_ref_door',
  TAG:    'cp12_ref_tag',
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function pdfField(fieldName) {
  const el = document.querySelector(`[data-field="${fieldName}"]`);
  return el ? el.value.trim() : '';
}

function incStr(s) {
  const m = s.match(/^(.*?)(\d+)$/);
  if (!m) return s + '1';
  return m[1] + String(Number(m[2]) + 1).padStart(m[2].length, '0');
}

function genRef() {
  const base = localStorage.getItem(REF_STORAGE.BASE) || 'OHM100';
  return base;
}

function getCurrentBaseReference() {
  return localStorage.getItem(REF_STORAGE.BASE) || 'OHM100';
}

function reserveNewBaseReference() {
  const current = getCurrentBaseReference();
  const next = incStr(current);
  localStorage.setItem(REF_STORAGE.BASE, next);
  return next;
}

function getDoorNumber(addr) {
  if (!addr) return '';
  const m = addr.trim().match(/^(\d+[A-Za-z]?)/);
  return m ? m[1] : '';
}

function getPostcodeScore(postcode) {
  if (!postcode) return 0;
  let s = 0;
  const clean = postcode.replace(/\s+/g, '').toUpperCase();
  for (let i = 0; i < clean.length; i++) s += clean.charCodeAt(i);
  return s % 10000;
}

function addressRefPart(addr) {
  if (!addr || !addr.trim()) return '';
  const lines = addr.trim().split(/\n/).map(l => l.trim()).filter(Boolean);
  const first = lines[0] || '';
  const m = first.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
  if (m) return (m[1] + ' ' + m[2]).substring(0, 30);
  return first.substring(0, 30);
}

function composeRef() {
  const base = getCurrentBaseReference();
  const door = localStorage.getItem(REF_STORAGE.DOOR) || '';
  const tag  = localStorage.getItem(REF_STORAGE.TAG)  || '';
  let ref = base;
  if (door) ref += door;
  if (tag)  ref += ' / ' + tag;
  return ref;
}

function generateFullReference() {
  const addr = pdfField('install_address');
  const pc   = pdfField('install_postcode');
  const door = getDoorNumber(addr);
  const score = getPostcodeScore(pc);
  const tag  = addressRefPart(addr);
  localStorage.setItem(REF_STORAGE.DOOR, door ? door : '');
  localStorage.setItem(REF_STORAGE.TAG, tag);
  return composeRef();
}

function updateFullReference() {
  const ref = generateFullReference();
  document.querySelectorAll('[data-field="cert_ref"], [data-field="cert_ref_p2"]').forEach(el => {
    el.value = ref;
  });
}

function openReferenceSettings() {
  const current = getCurrentBaseReference();
  const input = window.prompt(
    'Enter a new base certificate reference number.\nCurrent: ' + current +
    '\n\nThis will be the prefix used for new certificates.\nExample: OHM157 or CP12-2024',
    current
  );
  if (!input || !input.trim()) return;
  const val = input.trim();
  localStorage.setItem(REF_STORAGE.BASE, val);
  updateFullReference();
  showToast('Reference updated to: ' + val);
}

// ── Copy installation address to landlord ────────────────────────────────────
function copyInstallationToLandlord(btn) {
  const addr = document.querySelector('[data-field="install_address"]');
  const pc   = document.querySelector('[data-field="install_postcode"]');
  const lAddr = document.querySelector('[data-field="landlord_address"]');
  const lPc   = document.querySelector('[data-field="landlord_postcode"]');
  if (!addr || !lAddr) return;
  lAddr.value = addr.value;
  lPc.value   = pc ? pc.value : '';
  [lAddr, lPc].forEach(el => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  if (btn) {
    btn.classList.add('copied');
    setTimeout(() => btn.classList.remove('copied'), 1500);
  }
}

// ── Date handling ────────────────────────────────────────────────────────────
function dateDigits(s) {
  return (s || '').replace(/\D/g, '').slice(0, 8);
}

function formatDateDigits(digits) {
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return digits.slice(0, 2) + '/' + digits.slice(2);
  return digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4, 8);
}

function parseUKDate(s) {
  if (!s) return null;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m.map(Number);
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() + 1 !== mo || date.getDate() !== d) return null;
  return date;
}

function formatUKDate(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return d + '/' + m + '/' + y;
}

function oneYearMinusOneDayUK(value) {
  const date = parseUKDate(value);
  if (!date) return '';
  const next = new Date(date.getFullYear() + 1, date.getMonth(), date.getDate() - 1);
  return formatUKDate(next);
}

function attachFastDateInput(el) {
  el.addEventListener('input', () => {
    const digits = dateDigits(el.value);
    const formatted = formatDateDigits(digits);
    const sel = el.selectionStart;
    el.value = formatted;
    if (el.dataset.field === 'cert_date') {
      const next = oneYearMinusOneDayUK(formatted);
      const nc = document.querySelector('[data-field="next_check_date"]');
      if (nc && formatted.length === 10) nc.value = next;
    }
    try { el.setSelectionRange(sel, sel); } catch(e) {}
    formDirty = true;
  });
}

// ── Choice cycle controls ────────────────────────────────────────────────────
const CHOICE_DEFAULTS = {
  safe_to_use: ['Yes', 'No', 'N/A'],
};
const CHOICE_STANDARD = ['✓', '✕', 'N/A'];

function normaliseChoiceValue(group, value) {
  if (!value) return null;
  const v = String(value).trim();
  const map = { 'tick': '✓', 'cross': '✕', 'true': '✓', 'false': '✕', 'yes': 'Yes', 'no': 'No', 'na': 'N/A', 'n/a': 'N/A' };
  return map[v.toLowerCase()] || v;
}

function refreshChoiceGroup(btn) {
  const group = btn.dataset.group;
  const hidden = document.querySelector(`[data-field="${group}"]`);
  const rawVal = hidden ? hidden.value : '';
  const options = (btn.dataset.options || '✓,✕,N/A').split(',');
  const norm = normaliseChoiceValue(group, rawVal);
  const current = options.includes(norm) ? norm : options[0];
  btn.dataset.current = current;
  btn.textContent = current;
  if (hidden) hidden.value = current;
}

function refreshChoiceGroups() {
  document.querySelectorAll('.choice-cycle').forEach(refreshChoiceGroup);
}

function cycleChoice(btn) {
  const options = (btn.dataset.options || '✓,✕,N/A').split(',');
  const idx = options.indexOf(btn.dataset.current);
  const next = options[(idx + 1) % options.length];
  btn.dataset.current = next;
  btn.textContent = next;
  const group = btn.dataset.group;
  const hidden = document.querySelector(`[data-field="${group}"]`);
  if (hidden) {
    hidden.value = next;
    hidden.dispatchEvent(new Event('change', { bubbles: true }));
  }
  formDirty = true;
}

// ── Auto-save loop ───────────────────────────────────────────────────────────
const AUTOSAVE_PREFIX = 'cp12_v5_';

function collectFormState() {
  const state = {};
  document.querySelectorAll('[data-field]').forEach(el => {
    const key = AUTOSAVE_PREFIX + el.dataset.field;
    state[key] = el.value;
  });
  return state;
}

function saveForm() {
  const state = collectFormState();
  Object.entries(state).forEach(([k, v]) => {
    try { localStorage.setItem(k, v); } catch(e) {}
  });
}

function loadForm() {
  document.querySelectorAll('[data-field]').forEach(el => {
    const key = AUTOSAVE_PREFIX + el.dataset.field;
    const val = localStorage.getItem(key);
    if (val !== null) el.value = val;
  });
  refreshChoiceGroups();
  updateFullReference();
  loadLogo();
  loadSignatures();
  updateWorkCount(document.querySelector('[data-field="work_details"]'));
}

setInterval(saveForm, 4000);

// ── Logo upload and optimisation ─────────────────────────────────────────────
const LOGO_KEY = 'cp12_v5_logo';

function optimiseLogoDataUrl(dataUrl, cb) {
  const img = new Image();
  img.onload = () => {
    const MAX_W = 700, MAX_H = 220;
    let w = img.naturalWidth, h = img.naturalHeight;
    if (w > MAX_W || h > MAX_H) {
      const ratio = Math.min(MAX_W / w, MAX_H / h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
    }
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1e3a5f';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    cb(canvas.toDataURL('image/jpeg', 0.86));
  };
  img.onerror = () => cb(dataUrl);
  img.src = dataUrl;
}

function handleLogoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    optimiseLogoDataUrl(e.target.result, optimised => {
      try { localStorage.setItem(LOGO_KEY, optimised); } catch(err) {}
      applyLogo(optimised);
    });
  };
  reader.readAsDataURL(file);
}

function applyLogo(dataUrl) {
  const img = document.getElementById('logoImg');
  const zone = document.getElementById('logoZone');
  if (!img || !zone) return;
  img.src = dataUrl;
  zone.classList.add('has-logo');
}

function loadLogo() {
  const stored = localStorage.getItem(LOGO_KEY);
  if (stored) applyLogo(stored);
}

// ── Work Carried Out truncation indicator (GAS-008/GAS-012) ─────────────────
function updateWorkCount(textarea) {
  if (!textarea) return;
  const counter = document.getElementById('workCharCount');
  const box = textarea.closest('.work-box');
  const val = textarea.value;
  const lines = val.split('\n').length;
  const chars = val.length;
  const over = lines > 3 || chars > 220;
  if (counter) {
    counter.textContent = over ? `⚠ ${chars} chars / ${lines} lines — may truncate in PDF` : `${chars} chars`;
    counter.classList.toggle('over', over);
  }
  if (box) box.classList.toggle('overflow-warning', over);
}

// ── Backup / Restore (GAS-002) ───────────────────────────────────────────────
function exportBackup() {
  const data = {};
  Object.keys(localStorage).forEach(key => {
    if (key.startsWith('cp12_')) data[key] = localStorage.getItem(key);
  });
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = 'CP12_backup_' + dateStr + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Backup downloaded: CP12_backup_' + dateStr + '.json');
}

function importBackup() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid format');
        let count = 0;
        Object.entries(data).forEach(([key, value]) => {
          if (key.startsWith('cp12_')) { localStorage.setItem(key, value); count++; }
        });
        showToast('Restored ' + count + ' items — reloading…');
        setTimeout(() => location.reload(), 1200);
      } catch(e) {
        alert('Could not read backup file.\nPlease select a valid CP12 JSON backup.');
      }
    };
    reader.readAsText(file);
  });
  document.body.appendChild(input);
  input.click();
  document.body.removeChild(input);
}

// ── clearAll (improved — GAS-011) ────────────────────────────────────────────
function clearAll() {
  if (!confirm('Clear all fields and start a new certificate?\n\nYour data will be saved as a recoverable draft, and you can use "Restore" to bring it back.')) return;

  // Pre-clear snapshot (GAS-011)
  const draft = {};
  Object.keys(localStorage).forEach(key => {
    if (key.startsWith('cp12_')) draft[key] = localStorage.getItem(key);
  });
  try { localStorage.setItem('cp12_last_cleared_draft', JSON.stringify(draft)); } catch(e) {}

  // Wipe all form fields except company name and logo
  const keepCompany = (localStorage.getItem('cp12_v5_company_name') || '').trim();
  const keepLogo = localStorage.getItem(LOGO_KEY);

  const wipeKeys = [];
  Object.keys(localStorage).forEach(k => {
    if (k.startsWith('cp12_v5_') || k.startsWith('cp12_ref_')) wipeKeys.push(k);
  });
  wipeKeys.forEach(k => localStorage.removeItem(k));

  if (keepCompany) localStorage.setItem('cp12_v5_company_name', keepCompany);
  if (keepLogo)    localStorage.setItem(LOGO_KEY, keepLogo);

  // Clear all input/textarea/hidden values
  document.querySelectorAll('[data-field]').forEach(el => { el.value = ''; });

  // Restore company name to field
  const compEl = document.querySelector('[data-field="company_name"]');
  if (compEl && keepCompany) compEl.value = keepCompany;

  // Clear signatures
  document.querySelectorAll('.sig-canvas').forEach(c => {
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    if (c.dataset.sigField) localStorage.removeItem('cp12_v5_' + c.dataset.sigField);
  });

  // Reset choice cycles
  refreshChoiceGroups();

  // Reserve next reference
  reserveNewBaseReference();
  updateFullReference();

  formDirty = false;
  showToast('Form cleared. Use Restore to recover if needed.');
}

// ── Toast notification ───────────────────────────────────────────────────────
function showToast(msg, duration) {
  let t = document.getElementById('cp12Toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'cp12Toast';
    t.className = 'history-toast no-print';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), duration || 3000);
}

// ── Signature canvas pads (GAS-004) ──────────────────────────────────────────
function initSignaturePad(canvas) {
  const fieldKey = canvas.dataset.sigField;
  const storageKey = 'cp12_v5_' + fieldKey;

  // Restore saved signature
  const saved = localStorage.getItem(storageKey);
  if (saved) {
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth || canvas.width;
      canvas.height = img.naturalHeight || canvas.height;
      canvas.getContext('2d').drawImage(img, 0, 0);
    };
    img.src = saved;
  }

  let drawing = false, lastX = 0, lastY = 0;

  function pos(e) {
    const r = canvas.getBoundingClientRect();
    const sx = canvas.width  / r.width;
    const sy = canvas.height / r.height;
    if (e.touches && e.touches[0]) {
      return { x: (e.touches[0].clientX - r.left) * sx, y: (e.touches[0].clientY - r.top) * sy };
    }
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  }

  function onStart(e) {
    e.preventDefault();
    drawing = true;
    const p = pos(e);
    lastX = p.x; lastY = p.y;
  }

  function onMove(e) {
    if (!drawing) return;
    e.preventDefault();
    const ctx = canvas.getContext('2d');
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    lastX = p.x; lastY = p.y;
  }

  function onEnd() {
    if (!drawing) return;
    drawing = false;
    try { localStorage.setItem(storageKey, canvas.toDataURL('image/png')); } catch(e) {}
    formDirty = true;
  }

  canvas.addEventListener('mousedown', onStart);
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseup', onEnd);
  canvas.addEventListener('mouseleave', onEnd);
  canvas.addEventListener('touchstart', onStart, { passive: false });
  canvas.addEventListener('touchmove', onMove, { passive: false });
  canvas.addEventListener('touchend', onEnd);
}

function clearSigCanvas(fieldKey) {
  const canvas = document.querySelector(`.sig-canvas[data-sig-field="${fieldKey}"]`);
  if (!canvas) return;
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  localStorage.removeItem('cp12_v5_' + fieldKey);
}

function loadSignatures() {
  document.querySelectorAll('.sig-canvas').forEach(c => {
    const key = 'cp12_v5_' + c.dataset.sigField;
    const saved = localStorage.getItem(key);
    if (saved) {
      const img = new Image();
      img.onload = () => {
        c.width = img.naturalWidth || c.width;
        c.height = img.naturalHeight || c.height;
        c.getContext('2d').drawImage(img, 0, 0);
      };
      img.src = saved;
    }
  });
}

// ── Appliance history (data layer — still used by autocomplete) ───────────────
const APPLIANCE_HISTORY_KEY = 'cp12_appliance_history_v1';
const APPLIANCE_HISTORY_MAX = 200;

function escapeHistoryHtml(value) {
  if (!value) return '';
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getApplianceHistory() {
  try {
    const raw = localStorage.getItem(APPLIANCE_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch(e) { return []; }
}

function saveApplianceHistory(records) {
  try { localStorage.setItem(APPLIANCE_HISTORY_KEY, JSON.stringify(records)); } catch(e) {}
}

function buildFingerprintId(record) {
  const parts = [
    pdfField('install_address'),
    pdfField('install_postcode'),
    record.location, record.appType, record.make, record.model,
  ];
  return parts.map(s => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()).join('|');
}

function saveCurrentAppliancesToHistory(source) {
  const cards = document.querySelectorAll('.appliance-card');
  if (!cards.length) return;
  const records = getApplianceHistory();
  cards.forEach(card => {
    const get = field => {
      const el = card.querySelector(`[data-field$="${field}"]`) || document.querySelector(`[data-field="${field}"]`);
      return el ? el.value.trim() : '';
    };
    const location = get('_location') || get('location');
    const appType  = get('_type')     || get('type');
    const make     = get('_make')     || get('make');
    const model    = get('_model')    || get('model');
    if (!make && !model && !location) return;

    const id = [
      pdfField('install_address').toLowerCase().replace(/\s+/g,' ').trim(),
      pdfField('install_postcode').toLowerCase(),
      location, appType, make, model
    ].join('|');

    const existing = records.findIndex(r => r.id === id);
    const record = {
      id,
      location, appType, make, model,
      ownership: get('_ownership') || get('ownership'),
      flueType:  get('_flue_type') || get('flue_type'),
      installAddress:  pdfField('install_address'),
      installPostcode: pdfField('install_postcode'),
      savedAt: new Date().toISOString(),
      certRef: pdfField('cert_ref'),
    };
    if (existing >= 0) { records.splice(existing, 1); }
    records.unshift(record);
    if (records.length > APPLIANCE_HISTORY_MAX) records.pop();
  });
  saveApplianceHistory(records);
}

// ── Autocomplete engine ───────────────────────────────────────────────────────
let _acDropdown = null;

function _acGetOrCreate() {
  if (!_acDropdown || !document.body.contains(_acDropdown)) {
    _acDropdown = document.createElement('div');
    _acDropdown.className = 'ac-dropdown';
    _acDropdown.style.display = 'none';
    document.body.appendChild(_acDropdown);
  }
  return _acDropdown;
}

function _acPosition(input) {
  const r = input.getBoundingClientRect();
  _acDropdown.style.left = r.left + 'px';
  _acDropdown.style.top  = (r.bottom + 3) + 'px';
  _acDropdown.style.width = Math.max(r.width, 240) + 'px';
}

function _acHide() {
  if (_acDropdown) _acDropdown.style.display = 'none';
}

function applyHistoryToCard(record, card) {
  const map = {
    location: record.location,
    type:     record.appType,
    make:     record.make,
    model:    record.model,
    ownership:record.ownership,
    flue_type:record.flueType,
  };
  Object.entries(map).forEach(([suffix, val]) => {
    const el = card.querySelector(`[data-field$="_${suffix}"]`);
    if (el && val !== undefined) {
      el.value = val || '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  formDirty = true;
  showToast('Appliance details filled');
}

function initApplianceAutocomplete(input, card) {
  input.setAttribute('autocomplete', 'off');

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) { _acHide(); return; }

    const records = getApplianceHistory();
    const matches = records.filter(r =>
      [r.make, r.model, r.appType, r.location]
        .some(f => f && f.toLowerCase().includes(q))
    ).slice(0, 8);

    if (!matches.length) { _acHide(); return; }

    const dd = _acGetOrCreate();
    _acPosition(input);
    dd.innerHTML = matches.map((r, i) => {
      const title = [r.make, r.model].filter(Boolean).join(' — ') || r.appType || '—';
      const sub   = [r.location, r.appType, r.flueType].filter(Boolean).join(' · ');
      return `<div class="ac-item" data-idx="${i}">
        <div class="ac-title">${escapeHistoryHtml(title)}</div>
        ${sub ? `<div class="ac-sub">${escapeHistoryHtml(sub)}</div>` : ''}
      </div>`;
    }).join('');
    dd.style.display = 'block';

    dd.querySelectorAll('.ac-item').forEach((item, i) => {
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        applyHistoryToCard(matches[i], card);
        _acHide();
      });
    });
  });

  input.addEventListener('blur', () => setTimeout(_acHide, 160));
  input.addEventListener('focus', () => {
    if (input.value.trim().length >= 2) input.dispatchEvent(new Event('input'));
  });
}

function initAddressAutocomplete(textarea, postcodeInput) {
  textarea.setAttribute('autocomplete', 'off');

  function search() {
    const q = textarea.value.trim().toLowerCase();
    if (q.length < 2) { _acHide(); return; }

    // Collect unique addresses from appliance history + cert archive
    const seen = new Set();
    const results = [];

    getApplianceHistory().forEach(r => {
      const addr = (r.installAddress || '').trim();
      const pc   = (r.installPostcode || '').trim();
      if (!addr || seen.has(addr.toLowerCase())) return;
      if ((addr + ' ' + pc).toLowerCase().includes(q)) {
        seen.add(addr.toLowerCase());
        results.push({ address: addr, postcode: pc });
      }
    });

    // Also search cert archive if available (from app.js)
    if (typeof getCertArchive === 'function') {
      getCertArchive().forEach(c => {
        const addr = (c.installAddress || '').trim();
        const pc   = (c.installPostcode || '').trim();
        if (!addr || seen.has(addr.toLowerCase())) return;
        if ((addr + ' ' + pc).toLowerCase().includes(q)) {
          seen.add(addr.toLowerCase());
          results.push({ address: addr, postcode: pc });
        }
      });
    }

    if (!results.length) { _acHide(); return; }

    const dd = _acGetOrCreate();
    _acPosition(textarea);
    const top = results.slice(0, 6);
    dd.innerHTML = top.map((r, i) => {
      const firstLine = r.address.split('\n')[0].trim();
      return `<div class="ac-item" data-idx="${i}">
        <div class="ac-addr-line">${escapeHistoryHtml(firstLine)}</div>
        ${r.postcode ? `<div class="ac-addr-pc">${escapeHistoryHtml(r.postcode)}</div>` : ''}
      </div>`;
    }).join('');
    dd.style.display = 'block';

    dd.querySelectorAll('.ac-item').forEach((item, i) => {
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        textarea.value = top[i].address;
        if (postcodeInput) postcodeInput.value = top[i].postcode || '';
        [textarea, postcodeInput].filter(Boolean).forEach(el => {
          el.dispatchEvent(new Event('input', { bubbles: true }));
        });
        _acHide();
        formDirty = true;
      });
    });
  }

  textarea.addEventListener('input', search);
  textarea.addEventListener('focus', () => { if (textarea.value.trim().length >= 2) search(); });
  textarea.addEventListener('blur', () => setTimeout(_acHide, 160));
}

// ── Build appliance cards (Page 2) ────────────────────────────────────────────
function buildApplianceCards() {
  const container = document.getElementById('applianceCards');
  if (!container) return;
  container.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    container.appendChild(buildSingleApplianceCard(i));
  }
}

function buildSingleApplianceCard(n) {
  const card = document.createElement('div');
  card.className = 'appliance-card';
  card.dataset.applianceRow = n;

  // Main row
  const shell = document.createElement('div');
  shell.className = 'appliance-main-shell';
  const row = document.createElement('div');
  row.className = 'appliance-value-row';

  const cells = [
    { cls: 'number-cell', html: `<input class="appliance-number-input" value="${n}" readonly tabindex="-1">` },
    { cls: 'location',    field: `app${n}_location`,   ph: 'Location' },
    { cls: 'type',        field: `app${n}_type`,       ph: 'Type' },
    { cls: 'make',        field: `app${n}_make`,       ph: 'Make' },
    { cls: 'model',       field: `app${n}_model`,      ph: 'Model' },
    { cls: '',            field: `app${n}_ownership`,  ph: 'LL / T' },
    { cls: '',            field: `app${n}_flue_type`,  ph: 'Flue' },
    { cls: 'choice-cell', choice: `app${n}_gas_tight`, opts: '✓,✕,N/A' },
    { cls: '',            field: `app${n}_burner_pressure`, ph: '' },
    { cls: '',            field: `app${n}_combustion`,      ph: '' },
    { cls: 'choice-cell', choice: `app${n}_visual`,    opts: '✓,✕,N/A' },
    { cls: 'choice-cell', choice: `app${n}_flue_flow`, opts: '✓,✕,N/A' },
    { cls: 'choice-cell', choice: `app${n}_vent`,      opts: '✓,✕,N/A' },
    { cls: 'choice-cell', choice: `app${n}_safety_dev`,opts: '✓,✕,N/A' },
    { cls: 'choice-cell', choice: `app${n}_safe_to_use`,opts: 'Yes,No,N/A' },
    { cls: '',            field: `app${n}_insp_no`,    ph: '' },
  ];

  // Fields that trigger appliance history autocomplete
  const AC_FIELDS = [`app${n}_location`, `app${n}_type`, `app${n}_make`, `app${n}_model`];

  cells.forEach(c => {
    const td = document.createElement('div');
    td.className = 'appliance-value-cell' + (c.cls ? ' ' + c.cls : '');
    if (c.choice) {
      td.innerHTML = `<div class="choice-group"><button type="button" class="choice-cycle" data-group="${c.choice}" data-options="${c.opts}"></button><input type="hidden" data-field="${c.choice}"></div>`;
    } else if (c.field) {
      td.innerHTML = `<input type="text" data-field="${c.field}" placeholder="${c.ph || ''}">`;
    } else {
      td.innerHTML = c.html || '';
    }
    row.appendChild(td);
  });

  // Attach autocomplete to identity fields after row is built
  AC_FIELDS.forEach(fieldName => {
    const input = row.querySelector(`[data-field="${fieldName}"]`);
    if (input) initApplianceAutocomplete(input, card);
  });

  shell.appendChild(row);
  card.appendChild(shell);

  // CO hanger
  const co = document.createElement('div');
  co.className = 'co-hanger';
  co.innerHTML = `
    <div class="co-hanger-title">CO&nbsp;Alarm</div>
    <div class="co-mini-grid">
      <div class="co-mini">
        <label>Present</label>
        <select data-field="app${n}_co_present"><option value="">—</option><option>Yes</option><option>No</option><option>N/A</option></select>
      </div>
      <div class="co-mini">
        <label>Location</label>
        <select data-field="app${n}_co_location"><option value="">—</option><option>Room</option><option>Hall</option><option>Other</option></select>
      </div>
      <div class="co-mini">
        <label>Tested</label>
        <select data-field="app${n}_co_tested"><option value="">—</option><option>Yes</option><option>No</option><option>N/A</option></select>
      </div>
    </div>`;
  card.appendChild(co);

  return card;
}

// ── Pre-export validation (GAS-009, GAS-016) ─────────────────────────────────
function runExportValidation() {
  const warnings = [];
  const company = pdfField('company_name');
  if (!company || company.toLowerCase().includes('your company name')) {
    warnings.push('Company name still shows "Your Company Name Ltd". This will appear on the issued certificate.');
  }
  const gasSafeNo = pdfField('gas_safe_no');
  if (!gasSafeNo || !/^\d{4,10}$/.test(gasSafeNo.replace(/\s+/g, ''))) {
    warnings.push('Gas Safe Register number is missing or not numeric. The certificate may be legally invalid.');
  }
  const workEl = document.querySelector('[data-field="work_details"]');
  if (workEl) {
    const v = workEl.value;
    if (v.split('\n').length > 3 || v.length > 220) {
      warnings.push('Work Carried Out text may be truncated in the PDF (exceeds ~3 lines). Review the yellow warning above the field.');
    }
  }
  if (!warnings.length) return true;
  return confirm('⚠ Before generating PDF:\n\n' + warnings.map((w, i) => (i + 1) + '. ' + w).join('\n\n') + '\n\nProceed anyway?');
}

// ── Architecture V2: DOM-mapped vector PDF ─────────────────────────────────────
function makePdfMapper(pageEl) {
  const pageRect = pageEl.getBoundingClientRect();
  const MM_PER_PX = 297 / pageRect.width;
  return {
    rect(el) {
      const r = el.getBoundingClientRect();
      return {
        x: (r.left - pageRect.left) * MM_PER_PX,
        y: (r.top  - pageRect.top)  * MM_PER_PX,
        w: r.width  * MM_PER_PX,
        h: r.height * MM_PER_PX,
      };
    },
    mm(px) { return px * MM_PER_PX; },
  };
}

function isPdfVisible(el) {
  if (!el) return false;
  let cur = el;
  while (cur && cur !== document.body) {
    const st = window.getComputedStyle(cur);
    if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) === 0) return false;
    cur = cur.parentElement;
  }
  return true;
}

function drawDomBox(doc, map, el, opts) {
  if (!isPdfVisible(el)) return;
  const r = map.rect(el);
  const o = opts || {};
  if (o.fill) {
    doc.setFillColor(o.fill);
    doc.rect(r.x, r.y, r.w, r.h, 'F');
  }
  if (o.border) {
    doc.setDrawColor(o.border);
    doc.setLineWidth(o.lineWidth || 0.3);
    doc.rect(r.x, r.y, r.w, r.h, 'S');
  }
  if (o.radius) {
    doc.setFillColor(o.fill || '#ffffff');
    doc.roundedRect(r.x, r.y, r.w, r.h, o.radius, o.radius, o.fill ? 'F' : 'S');
  }
}

const TEXT_CLIP_PADDING_MM = 0.5;

function drawDomText(doc, map, el, opts) {
  if (!isPdfVisible(el)) return;
  const r = map.rect(el);
  const o = opts || {};
  const st = window.getComputedStyle(el);

  let text = '';
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    text = el.value || '';
  } else if (el.tagName === 'SELECT') {
    text = el.options[el.selectedIndex]?.text || '';
  } else {
    text = el.innerText || el.textContent || '';
  }
  text = text.trim();
  if (!text) return;

  const fontSizePt = parseFloat(st.fontSize) * 0.75 * map.mm(1) * 2.835;
  const safeFs = Math.max(5, Math.min(fontSizePt, 14));
  doc.setFontSize(safeFs);

  const bold = st.fontWeight >= 600;
  const italic = st.fontStyle === 'italic';
  doc.setFont('helvetica', bold ? (italic ? 'bolditalic' : 'bold') : (italic ? 'italic' : 'normal'));

  const color = st.color.match(/\d+/g) || ['0', '0', '0'];
  doc.setTextColor(parseInt(color[0]), parseInt(color[1]), parseInt(color[2]));

  const align = o.align || (st.textAlign === 'center' ? 'center' : st.textAlign === 'right' ? 'right' : 'left');
  const padding = o.padding !== undefined ? o.padding : TEXT_CLIP_PADDING_MM;

  const textX = align === 'center' ? r.x + r.w / 2 : align === 'right' ? r.x + r.w - padding : r.x + padding;
  const textY = r.y + r.h / 2 + safeFs * 0.18;

  // Clip text to box
  if (el.tagName === 'TEXTAREA') {
    const lines = text.split('\n');
    const lineH = safeFs * 0.4;
    const maxLines = Math.floor(r.h / lineH);
    const clipped = lines.slice(0, maxLines);
    if (clipped.length < lines.length) clipped[clipped.length - 1] = clipped[clipped.length - 1].slice(0, -3) + '...';
    clipped.forEach((line, i) => {
      const lineText = doc.splitTextToSize(line, r.w - padding * 2)[0] || '';
      doc.text(lineText, textX, r.y + padding + lineH * (i + 0.8), { align });
    });
    return;
  }

  const maxW = r.w - padding * 2;
  const splitted = doc.splitTextToSize(text, maxW);
  let display = splitted[0] || '';
  if (splitted.length > 1) display = display.slice(0, -3) + '...';
  doc.text(display, textX, textY, { align });
}

function drawStatusControl(doc, map, el) {
  if (!isPdfVisible(el)) return;
  const btn = el.querySelector('.choice-cycle');
  if (!btn) return;
  const r = map.rect(el);
  const val = btn.dataset.current || '';
  if (!val || val === '—') return;
  doc.setFontSize(10);
  const color = val === '✓' || val === 'Yes' ? [22, 163, 74] : val === '✕' || val === 'No' ? [220, 38, 38] : [30, 58, 95];
  doc.setTextColor(...color);
  doc.setFont('helvetica', 'bold');
  doc.text(val, r.x + r.w / 2, r.y + r.h / 2 + 1.5, { align: 'center' });
}

function addDomLogo(doc, map, imgEl) {
  if (!isPdfVisible(imgEl) || !imgEl.src || imgEl.src.startsWith('data:') === false) return;
  const r = map.rect(imgEl);
  try {
    const fmt = imgEl.src.startsWith('data:image/png') ? 'PNG' : 'JPEG';
    doc.addImage(imgEl.src, fmt, r.x, r.y, r.w, r.h, undefined, 'FAST');
  } catch(e) {}
}

function addDomSignature(doc, map, canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const hasContent = Array.prototype.some.call(px, (v, i) => i % 4 === 3 && v > 10);
  if (!hasContent) return;
  const r = map.rect(canvas);
  try {
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', r.x, r.y, r.w, r.h, undefined, 'FAST');
  } catch(e) {}
}

function drawPageBoxesFromDom(doc, map, pageEl) {
  // Background
  doc.setFillColor('#ffffff');
  doc.rect(0, 0, 297, 210, 'F');

  // Walk all elements with explicit background or border colours
  const styled = pageEl.querySelectorAll('[class]');
  styled.forEach(el => {
    if (!isPdfVisible(el)) return;
    const st = window.getComputedStyle(el);
    const bg = st.backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
      const c = bg.match(/\d+/g);
      if (c && !(+c[0] === 255 && +c[1] === 255 && +c[2] === 255)) {
        const r = map.rect(el);
        if (r.w < 0.5 || r.h < 0.5) return;
        doc.setFillColor(+c[0], +c[1], +c[2]);
        doc.rect(r.x, r.y, r.w, r.h, 'F');
      }
    }
    const border = st.borderTopColor;
    const bw = parseFloat(st.borderTopWidth);
    if (bw > 0 && border && border !== 'rgba(0, 0, 0, 0)') {
      const bc = border.match(/\d+/g);
      if (bc) {
        const r = map.rect(el);
        if (r.w < 0.5 || r.h < 0.5) return;
        doc.setDrawColor(+bc[0], +bc[1], +bc[2]);
        doc.setLineWidth(map.mm(bw));
        doc.rect(r.x, r.y, r.w, r.h, 'S');
      }
    }
  });
}

function drawPageTextFromDom(doc, map, pageEl) {
  // Text inputs / textareas
  pageEl.querySelectorAll('input[data-field]:not([type=file]):not([type=hidden]), textarea[data-field]').forEach(el => {
    if (!isPdfVisible(el)) return;
    drawDomText(doc, map, el, {});
  });

  // Labels and static text
  pageEl.querySelectorAll('label, .doctitle, .info-box-header, .work-box-header, .sig-inner-title, .attn-head, .p2-title, .p2-ref-label, .history-panel-title, .p2-head-cell, .defects-box-header span, .pipe-box-header, .remedial-box-header').forEach(el => {
    if (!isPdfVisible(el)) return;
    drawDomText(doc, map, el, {});
  });

  // Choice cycles
  pageEl.querySelectorAll('.choice-group').forEach(el => {
    if (!isPdfVisible(el)) return;
    drawStatusControl(doc, map, el);
  });

  // Select dropdowns (CO alarm)
  pageEl.querySelectorAll('select[data-field]').forEach(el => {
    if (!isPdfVisible(el)) return;
    drawDomText(doc, map, el, { align: 'center' });
  });

  // Logo
  const logo = pageEl.querySelector('#logoImg');
  if (logo && logo.classList && logo.parentElement.classList.contains('has-logo')) {
    addDomLogo(doc, map, logo);
  }

  // Signatures
  pageEl.querySelectorAll('.sig-canvas').forEach(c => {
    addDomSignature(doc, map, c);
  });

  // Page footer
  const footer = pageEl.querySelector('.page-footer');
  if (footer && isPdfVisible(footer)) drawDomText(doc, map, footer, {});
}

function renderDomPageVector(doc, pageEl) {
  const map = makePdfMapper(pageEl);
  drawPageBoxesFromDom(doc, map, pageEl);
  drawPageTextFromDom(doc, map, pageEl);
}

// ── Download vector PDF (GAS-001 fixed — uses local jsPDF) ───────────────────
async function downloadVectorPDF(btn) {
  if (!runExportValidation()) return;

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Generating…';
  }
  saveCurrentAppliancesToHistory('pdf');
  saveForm();

  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    const pages = document.querySelectorAll('.page');
    pages.forEach((pageEl, idx) => {
      if (idx > 0) doc.addPage('a4', 'landscape');
      renderDomPageVector(doc, pageEl);
    });

    const ref = pdfField('cert_ref') || 'CP12';
    const addr = pdfField('install_address').split('\n')[0].trim().replace(/[^a-z0-9 \-]/gi, '_').slice(0, 40) || 'Certificate';
    const safeRef = ref.replace(/[^a-z0-9\-_]/gi, '_');
    const safeAddr = addr.replace(/\s+/g, '_');
    doc.save(`CP12_${safeRef}_${safeAddr}.pdf`);
    showToast('PDF downloaded — saved to archive');
    // Notify app shell to archive this certificate
    if (typeof window.onCertificateExported === 'function') {
      window.onCertificateExported(collectFormState());
    }
  } catch(e) {
    console.error('PDF error:', e);
    alert('PDF generation failed: ' + (e.message || e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬇ Download PDF'; }
  }
}

// ── Initialise ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  buildApplianceCards();
  loadForm();

  // Fast date inputs
  document.querySelectorAll('.fast-date').forEach(attachFastDateInput);

  // Choice cycle buttons
  document.addEventListener('click', e => {
    if (e.target.classList.contains('choice-cycle')) cycleChoice(e.target);
  });

  // Auto-save on change
  document.addEventListener('input', e => {
    if (e.target.matches('[data-field]')) {
      formDirty = true;
      if (e.target.dataset.field === 'install_address' || e.target.dataset.field === 'install_postcode') {
        updateFullReference();
      }
    }
  });
  document.addEventListener('change', e => {
    if (e.target.matches('[data-field]')) { formDirty = true; saveForm(); }
  });

  // Signature pads
  document.querySelectorAll('.sig-canvas').forEach(initSignaturePad);

  // Address autocomplete
  initAddressAutocomplete(
    document.querySelector('[data-field="install_address"]'),
    document.querySelector('[data-field="install_postcode"]')
  );
  initAddressAutocomplete(
    document.querySelector('[data-field="landlord_address"]'),
    document.querySelector('[data-field="landlord_postcode"]')
  );
});
