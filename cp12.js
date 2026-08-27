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
  el.addEventListener('keydown', e => {
    // Allow backspace/delete to remove characters cleanly
    if (e.key === 'Backspace' || e.key === 'Delete') {
      const pos = el.selectionStart;
      const val = el.value;
      // Skip over slashes when backspacing
      if (e.key === 'Backspace' && pos > 0 && val[pos - 1] === '/') {
        e.preventDefault();
        const newPos = pos - 1;
        el.value = val.slice(0, newPos) + val.slice(pos);
        el.setSelectionRange(newPos, newPos);
      }
    }
  });
  el.addEventListener('input', () => {
    const raw = el.value;
    const cursorBefore = el.selectionStart;
    // Count digits before cursor in raw string
    const digitsBefore = raw.slice(0, cursorBefore).replace(/\D/g, '').length;
    const digits = dateDigits(raw);
    const formatted = formatDateDigits(digits);
    el.value = formatted;
    // Find cursor position in formatted string after digitsBefore digits
    let dCount = 0, newCursor = formatted.length;
    for (let i = 0; i < formatted.length; i++) {
      if (formatted[i] !== '/') { dCount++; if (dCount === digitsBefore) { newCursor = i + 1; break; } }
    }
    if (el.dataset.field === 'cert_date') {
      const next = oneYearMinusOneDayUK(formatted);
      const nc = document.querySelector('[data-field="next_check_date"]');
      if (nc && formatted.length === 10) nc.value = next;
    }
    try { el.setSelectionRange(newCursor, newCursor); } catch(e) {}
    formDirty = true;
  });
}

// ── Field defaults (applied when no stored value exists) ──────────────────────
const FIELD_DEFAULTS = (() => {
  const d = {
    work_details:    'N/A',
    remedial_action: 'N/A',
  };
  for (let i = 1; i <= 5; i++) {
    d['defect_' + i]      = 'N/A';
    d['defect_warn_' + i] = 'N/A';
    // Appliance text defaults
    d[`app${i}_op_pressure`] = '20 mbar';
    d[`app${i}_combustion`]  = 'N/A';
    d[`app${i}_flue_type`]   = 'FL';
  }
  return d;
})();

// ── Choice cycle controls ────────────────────────────────────────────────────
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
    if (el.readOnly) return;
    const key = AUTOSAVE_PREFIX + el.dataset.field;
    state[key] = el.value;
  });
  return state;
}

let _storageWarned = false;
function saveForm() {
  const state = collectFormState();
  let failed = false;
  Object.entries(state).forEach(([k, v]) => {
    try { localStorage.setItem(k, v); } catch(e) { failed = true; }
  });
  if (failed && !_storageWarned) {
    _storageWarned = true;
    showToast('⚠ Auto-save unavailable — download a backup to preserve your work');
  }
}

function loadForm() {
  const disabledApps = new Set();
  for (let i = 1; i <= 5; i++) {
    if (localStorage.getItem(AUTOSAVE_PREFIX + `app${i}_disabled`) === '1') disabledApps.add(i);
  }
  document.querySelectorAll('[data-field]').forEach(el => {
    const appMatch = el.dataset.field.match(/^app(\d+)_/);
    const appN = appMatch ? parseInt(appMatch[1]) : null;
    if (appN && disabledApps.has(appN)) { el.value = ''; return; }
    const key = AUTOSAVE_PREFIX + el.dataset.field;
    const stored = localStorage.getItem(key);
    if (stored !== null && stored !== '') {
      el.value = stored;
    } else if (FIELD_DEFAULTS[el.dataset.field] !== undefined) {
      el.value = FIELD_DEFAULTS[el.dataset.field];
    }
  });
  disabledApps.forEach(n => {
    const card = document.querySelector(`[data-appliance-row="${n}"]`);
    if (!card) return;
    card.classList.add('is-disabled');
    const btn = card.querySelector('.app-row-toggle');
    if (btn) btn.textContent = '+ add appliance';
  });
  refreshChoiceGroups();
  updateFullReference();
  loadLogo();
  loadSignatures();
  // Trigger auto-sizers for pre-filled appliance text fields
  document.querySelectorAll('.appliance-value-cell.location textarea, .appliance-value-cell.type textarea, .appliance-value-cell.make textarea, .appliance-value-cell.model textarea').forEach(el => {
    el.dispatchEvent(new Event('input'));
  });
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

  // Clear all input/textarea/hidden values; reset disabled rows
  for (let i = 1; i <= 5; i++) {
    const card = document.querySelector(`[data-appliance-row="${i}"]`);
    if (card) {
      card.classList.remove('is-disabled');
      const btn = card.querySelector('.app-row-toggle');
      if (btn) btn.textContent = '— not in use';
    }
  }
  document.querySelectorAll('[data-field]').forEach(el => {
    const def = FIELD_DEFAULTS[el.dataset.field];
    el.value = (def !== undefined) ? def : '';
  });

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
    ctx.lineWidth = 3.5;
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

// ── Signature modal ────────────────────────────────────────────────────────────
let _sigModalKey = null;
let _sigModalReady = false;
let _sigModalPrevFocus = null;

function openSigModal(fieldKey, titleText) {
  _sigModalKey = fieldKey;
  const modal  = document.getElementById('sigModal');
  _sigModalPrevFocus = document.activeElement;
  const title  = document.getElementById('sigModalTitle');
  const canvas = document.getElementById('sigModalCanvas');
  if (!modal || !canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const stored = localStorage.getItem('cp12_v5_' + fieldKey);
  if (stored) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.src = stored;
  }
  if (title) title.textContent = titleText || 'Signature';
  modal.classList.add('open');
  if (!_sigModalReady) { _initSigModalCanvas(canvas); _sigModalReady = true; }
  requestAnimationFrame(() => {
    const firstBtn = modal.querySelector('button');
    if (firstBtn) firstBtn.focus();
  });
}

function _initSigModalCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const r0 = canvas.getBoundingClientRect();
  canvas.width  = Math.round(r0.width  * dpr);
  canvas.height = Math.round(r0.height * dpr);
  canvas.getContext('2d').scale(dpr, dpr);

  let drawing = false, lastX = 0, lastY = 0;
  function pos(e) {
    const r = canvas.getBoundingClientRect();
    if (e.touches && e.touches[0]) return { x: (e.touches[0].clientX - r.left) * dpr, y: (e.touches[0].clientY - r.top) * dpr };
    return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr };
  }
  function onStart(e) { e.preventDefault(); drawing = true; const p = pos(e); lastX = p.x; lastY = p.y; }
  function onMove(e) {
    if (!drawing) return; e.preventDefault();
    const ctx = canvas.getContext('2d'), p = pos(e);
    ctx.beginPath(); ctx.moveTo(lastX, lastY); ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = '#111827'; ctx.lineWidth = 3.5 * dpr; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
    lastX = p.x; lastY = p.y;
  }
  function onEnd() { drawing = false; }
  canvas.addEventListener('mousedown', onStart);
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseup', onEnd);
  canvas.addEventListener('mouseleave', onEnd);
  canvas.addEventListener('touchstart', onStart, { passive: false });
  canvas.addEventListener('touchmove',  onMove,  { passive: false });
  canvas.addEventListener('touchend',   onEnd);
}

function clearSigModal() {
  const canvas = document.getElementById('sigModalCanvas');
  if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

function closeSigModal() {
  const modal = document.getElementById('sigModal');
  if (modal) modal.classList.remove('open');
  _sigModalKey = null;
  if (_sigModalPrevFocus && typeof _sigModalPrevFocus.focus === 'function') {
    _sigModalPrevFocus.focus();
    _sigModalPrevFocus = null;
  }
}

function confirmSigModal() {
  const modalCanvas = document.getElementById('sigModalCanvas');
  const fieldKey = _sigModalKey;
  if (!modalCanvas || !fieldKey) { closeSigModal(); return; }
  const realCanvas = document.querySelector(`.sig-canvas[data-sig-field="${fieldKey}"]`);
  if (realCanvas) {
    const rect = realCanvas.getBoundingClientRect();
    const scale = 3;
    realCanvas.width  = Math.round(rect.width  * scale);
    realCanvas.height = Math.round(rect.height * scale);
    const ctx = realCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, realCanvas.width, realCanvas.height);
    ctx.drawImage(modalCanvas, 0, 0, realCanvas.width, realCanvas.height);
    try { localStorage.setItem('cp12_v5_' + fieldKey, realCanvas.toDataURL('image/png')); } catch(e) {}
    formDirty = true;
  }
  closeSigModal();
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
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
  // Text fields
  [['location', record.location], ['type', record.appType], ['make', record.make],
   ['model', record.model], ['flue_type', record.flueType]].forEach(([suffix, val]) => {
    const el = card.querySelector(`[data-field$="_${suffix}"]`);
    if (el && val) { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  // Refresh choice-cycle buttons that have data-field (hidden inputs)
  card.querySelectorAll('.choice-cycle').forEach(btn => refreshChoiceGroup(btn));
  formDirty = true;
  card.classList.add('history-target-card');
  setTimeout(() => card.classList.remove('history-target-card'), 2000);
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

  input.addEventListener('keydown', e => {
    const dd = _acDropdown;
    if (!dd || dd.style.display === 'none') return;
    const items = dd.querySelectorAll('.ac-item');
    if (!items.length) return;
    const active = dd.querySelector('.ac-item.ac-focused');
    let idx = active ? parseInt(active.dataset.idx, 10) : -1;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      idx = Math.min(idx + 1, items.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      idx = Math.max(idx - 1, 0);
    } else if (e.key === 'Enter' && active) {
      e.preventDefault();
      active.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      return;
    } else if (e.key === 'Escape') {
      _acHide();
      return;
    } else { return; }
    items.forEach(it => it.classList.toggle('ac-focused', parseInt(it.dataset.idx, 10) === idx));
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
    { cls: 'number-cell', html: `<div style="display:flex;flex-direction:column;width:100%;height:100%"><input class="appliance-number-input" value="${n}" readonly tabindex="-1" style="flex:1;width:100%"><button type="button" class="app-row-toggle" onclick="toggleAppRow(${n})">— not in use</button></div>` },
    { cls: 'location',    html:  `<textarea data-field="app${n}_location" placeholder="Location" maxlength="30" rows="1"></textarea>` },
    { cls: 'type',        html: `<textarea data-field="app${n}_type" placeholder="Type" maxlength="28" rows="1"></textarea>` },
    { cls: 'make',        html: `<textarea data-field="app${n}_make" placeholder="Manufacturer" maxlength="28" rows="1"></textarea>` },
    { cls: 'model',       html:  `<textarea data-field="app${n}_model" placeholder="Model" maxlength="30" rows="1"></textarea>` },
    { cls: 'choice-cell', choice: `app${n}_ownership`,  opts: 'Yes,No' },
    { cls: 'choice-cell', choice: `app${n}_inspected`,  opts: 'Yes,No' },
    { cls: '',            field: `app${n}_flue_type`,   ph: 'FL' },
    { cls: '',            field: `app${n}_op_pressure`, ph: '20 mbar' },
    { cls: 'choice-cell', choice: `app${n}_safety_dev`, opts: 'Pass,Fail,N/A' },
    { cls: 'choice-cell', choice: `app${n}_vent`,       opts: 'Pass,Fail,N/A' },
    { cls: 'choice-cell', choice: `app${n}_visual`,     opts: 'N/A,Pass,Fail' },
    { cls: 'choice-cell', choice: `app${n}_flue_flow`,  opts: 'N/A,Pass,Fail' },
    { cls: '',            field: `app${n}_combustion`,  ph: 'N/A' },
    { cls: 'choice-cell', choice: `app${n}_serviced`,   opts: 'No,Yes' },
    { cls: 'choice-cell', choice: `app${n}_safe_to_use`,opts: 'Yes,No' },
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

  // Autocomplete on identity fields
  AC_FIELDS.forEach(fieldName => {
    const input = row.querySelector(`[data-field="${fieldName}"]`);
    if (input) initApplianceAutocomplete(input, card);
  });

  // Auto-font-sizer on all free-text cells
  ['location', 'type', 'make', 'model'].forEach(f => {
    const el = row.querySelector(`[data-field="app${n}_${f}"]`);
    if (el) initAutoSizeTextarea(el);
  });

  // Smart defaults: watch type field for boiler detection
  const typeInput = row.querySelector(`[data-field="app${n}_type"]`);
  if (typeInput) typeInput.addEventListener('input', () => _applyBoilerDefaults(n, row));

  shell.appendChild(row);
  card.appendChild(shell);

  // CO alarm hanger — choice-cycle buttons with Yes/No defaults
  const co = document.createElement('div');
  co.className = 'co-hanger';
  co.innerHTML = `
    <div class="co-hanger-title">CO&nbsp;Alarm</div>
    <div class="co-mini-grid">
      <div class="co-mini">
        <label>Approved CO Alarm Fitted?</label>
        <div class="choice-group"><button type="button" class="choice-cycle" data-group="app${n}_co_present" data-options="Yes,No,N/A"></button><input type="hidden" data-field="app${n}_co_present"></div>
      </div>
      <div class="co-mini">
        <label>Is CO Alarm in Date?</label>
        <div class="choice-group"><button type="button" class="choice-cycle" data-group="app${n}_co_in_date" data-options="Yes,No,N/A"></button><input type="hidden" data-field="app${n}_co_in_date"></div>
      </div>
      <div class="co-mini">
        <label>CO Alarm Test Satisfactory?</label>
        <div class="choice-group"><button type="button" class="choice-cycle" data-group="app${n}_co_tested" data-options="Yes,No,N/A"></button><input type="hidden" data-field="app${n}_co_tested"></div>
      </div>
    </div>`;
  card.appendChild(co);

  return card;
}

function toggleAppRow(n) {
  const card = document.querySelector(`[data-appliance-row="${n}"]`);
  if (!card) return;
  const nowDisabled = !card.classList.contains('is-disabled');
  card.classList.toggle('is-disabled', nowDisabled);
  const btn = card.querySelector('.app-row-toggle');
  if (btn) btn.textContent = nowDisabled ? '+ add appliance' : '— not in use';
  localStorage.setItem(AUTOSAVE_PREFIX + `app${n}_disabled`, nowDisabled ? '1' : '');
  card.querySelectorAll('[data-field]').forEach(el => {
    const f = el.dataset.field;
    if (nowDisabled) {
      el.value = '';
      localStorage.setItem(AUTOSAVE_PREFIX + f, '');
    } else {
      const def = FIELD_DEFAULTS[f];
      if (def !== undefined) el.value = def;
    }
  });
  if (!nowDisabled) refreshChoiceGroups();
  formDirty = true;
}

function _applyBoilerDefaults(n, row) {
  const typeEl   = row.querySelector(`[data-field="app${n}_type"]`);
  const isBoiler = typeEl && /boiler/i.test(typeEl.value);

  const flueEl = row.querySelector(`[data-field="app${n}_flue_type"]`);
  if (flueEl && (!flueEl.value || flueEl.value === 'FL' || flueEl.value === 'RS'))
    flueEl.value = isBoiler ? 'RS' : 'FL';

  const combEl = row.querySelector(`[data-field="app${n}_combustion"]`);
  if (combEl && (!combEl.value || combEl.value === 'N/A' || /^0\.000[89]$/.test(combEl.value)))
    combEl.value = isBoiler ? (Math.random() < 0.5 ? '0.0008' : '0.0009') : 'N/A';

  ['visual', 'flue_flow'].forEach(suffix => {
    const btn = row.querySelector(`[data-group="app${n}_${suffix}"]`);
    const hid = row.querySelector(`[data-field="app${n}_${suffix}"]`);
    if (!btn || !hid) return;
    if (!hid.value || hid.value === 'N/A' || hid.value === 'Pass') {
      hid.value = isBoiler ? 'Pass' : 'N/A';
      refreshChoiceGroup(btn);
    }
  });
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
      warnings.push('Work Carried Out text may be truncated in the PDF (exceeds ~3 lines).');
    }
  }
  if (!warnings.length) return true;
  return confirm('⚠ Before generating PDF:\n\n' + warnings.map((w, i) => (i + 1) + '. ' + w).join('\n\n') + '\n\nProceed anyway?');
}

// ── Appliance text field auto-sizer ──────────────────────────────────────────
function initAutoSizeTextarea(el) {
  const TIERS = [
    { max: 17, pt: 8.5 },
    { max: 24, pt: 7.5 },
    { max: Infinity, pt: 7.0 },
  ];
  function update() {
    const tier = TIERS.find(t => el.value.length <= t.max) || TIERS[TIERS.length - 1];
    el.style.fontSize = tier.pt + 'pt';
    // Expand to rows=2 if content wraps
    el.rows = 1;
    el.rows = el.scrollHeight > el.clientHeight ? 2 : 1;
    // If rows=2 still overflows, trim characters until it fits (3rd line prevention)
    if (el.rows === 2 && el.scrollHeight > el.clientHeight) {
      while (el.scrollHeight > el.clientHeight && el.value.length > 0) {
        el.value = el.value.slice(0, -1);
      }
      // Re-apply tier after trim
      const newTier = TIERS.find(t => el.value.length <= t.max) || TIERS[TIERS.length - 1];
      el.style.fontSize = newTier.pt + 'pt';
    }
  }
  el.addEventListener('input', update);
  update();
}

// ── Signature clear helper (for sig-clear-btn) ───────────────────────────────
function clearSigCanvas(fieldKey) {
  const canvas = document.querySelector(`.sig-canvas[data-sig-field="${fieldKey}"]`);
  if (!canvas) return;
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  localStorage.removeItem('cp12_v5_' + fieldKey);
  formDirty = true;
}

// ── Inline appliance history panel ───────────────────────────────────────────
function toggleInlineHistory() {
  const btn  = document.getElementById('inlineHistoryToggle');
  const body = document.getElementById('inlineHistoryBody');
  if (!btn || !body) return;
  const open = body.classList.toggle('open');
  btn.classList.toggle('open', open);
  if (open) renderInlineHistory('');
}

function renderInlineHistory(q) {
  const grid = document.getElementById('inlineHistoryGrid');
  const sub  = document.getElementById('ihtSub');
  if (!grid) return;
  let records = typeof getApplianceHistory === 'function' ? getApplianceHistory() : [];
  const total = records.length;
  if (sub) sub.textContent = total ? `(${total} saved)` : '';
  if (q && q.trim()) {
    const lq = q.trim().toLowerCase();
    records = records.filter(r => [r.make, r.model, r.appType, r.location].some(f => f && f.toLowerCase().includes(lq)));
  }
  if (!records.length) {
    grid.innerHTML = '<div class="ihl-empty">' + (total ? 'No matches.' : 'No appliance history yet.<br>Previous appliances are saved automatically when you download a PDF.') + '</div>';
    return;
  }
  grid.innerHTML = records.slice(0, 24).map((r, i) => {
    const title = [r.make, r.model].filter(Boolean).join(' ') || 'Unknown appliance';
    const sub   = [r.appType, r.location].filter(Boolean).join(' · ') || '';
    const meta  = r.ref ? 'Ref: ' + r.ref : '';
    return `<div class="ihl-card" onclick="applyInlineHistoryRecord(${i},${JSON.stringify(q||'').replace(/</g,'\\x3c')})" title="Click to apply to next empty appliance card">
      <div class="ihl-card-title">${escapeHistoryHtml(title)}</div>
      ${sub ? '<div class="ihl-card-sub">' + escapeHistoryHtml(sub) + '</div>' : ''}
      ${meta ? '<div class="ihl-card-meta">' + escapeHistoryHtml(meta) + '</div>' : ''}
    </div>`;
  }).join('');
}

function applyInlineHistoryRecord(idx, q) {
  let records = typeof getApplianceHistory === 'function' ? getApplianceHistory() : [];
  if (q && q.trim()) {
    const lq = q.trim().toLowerCase();
    records = records.filter(r => [r.make, r.model, r.appType, r.location].some(f => f && f.toLowerCase().includes(lq)));
  }
  const record = records[idx];
  if (!record) return;
  // Find first active (non-disabled) card
  const cards = document.querySelectorAll('.appliance-card:not(.is-disabled)');
  if (!cards.length) { showToast('No active appliance cards available'); return; }
  applyHistoryToCard(record, cards[0]);
}

// ── Download PDF via html2canvas (pixel-perfect browser render) ───────────────
async function downloadVectorPDF(btn) {
  if (!runExportValidation()) return;

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Generating…';
  }
  saveCurrentAppliancesToHistory('pdf');
  saveForm();

  const viewBody = document.querySelector('#view-new .view-body');
  const origScroll = viewBody ? viewBody.scrollTop : 0;

  try {
    if (document.activeElement) document.activeElement.blur();

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    const pages = [...document.querySelectorAll('.page')];
    for (let i = 0; i < pages.length; i++) {
      if (i > 0) doc.addPage('a4', 'landscape');

      // Scroll the page into view so html2canvas gets correct positions
      if (viewBody) viewBody.scrollTop = pages[i].offsetTop;
      await new Promise(r => setTimeout(r, 80));

      const canvas = await html2canvas(pages[i], {
        scale: 2,
        useCORS: true,
        allowTaint: false,
        logging: false,
        backgroundColor: '#ffffff',
        onclone: (clonedDoc) => {
          // Remove UI-only elements from clone so they don't appear in PDF
          const hide = ['.no-print', '.app-row-toggle', '.sig-clear-btn', '.ac-dropdown',
                        '.inline-history-section', '.resume-banner'];
          hide.forEach(sel => clonedDoc.querySelectorAll(sel).forEach(el => { el.style.display = 'none'; }));
        },
      });

      doc.addImage(canvas.toDataURL('image/jpeg', 0.93), 'JPEG', 0, 0, 297, 210);
    }

    const ref = pdfField('cert_ref') || 'CP12';
    const addr = pdfField('install_address').split('\n')[0].trim().replace(/[^a-z0-9 \-]/gi, '_').slice(0, 40) || 'Certificate';
    const safeRef = ref.replace(/[^a-z0-9\-_]/gi, '_');
    const safeAddr = addr.replace(/\s+/g, '_');
    doc.save(`CP12_${safeRef}_${safeAddr}.pdf`);
    formDirty = false;
    showToast('PDF downloaded — saved to archive');
    if (typeof window.onCertificateExported === 'function') {
      window.onCertificateExported(collectFormState());
    }
  } catch(e) {
    console.error('PDF error:', e);
    alert('PDF generation failed: ' + (e.message || e));
  } finally {
    if (viewBody) viewBody.scrollTop = origScroll;
    if (btn) { btn.disabled = false; btn.textContent = '⬇ Download PDF'; }
  }
}

// ── Initialise ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  buildApplianceCards();
  loadForm();

  // Apply engineer signature from settings if no sig is stored yet
  try {
    const _s = JSON.parse(localStorage.getItem('cp12_app_settings_v1') || '{}');
    if (_s.engineer_sig && typeof _applyEngineerSig === 'function') _applyEngineerSig(_s.engineer_sig);
  } catch(e) {}

  // Resume prompt: show a non-blocking banner if there is meaningful saved data
  const _skip = new Set(['company_name']);
  const _hasMeaningfulData = Object.keys(localStorage).some(k => {
    if (!k.startsWith(AUTOSAVE_PREFIX)) return false;
    const field = k.slice(AUTOSAVE_PREFIX.length);
    if (_skip.has(field)) return false;
    const v = (localStorage.getItem(k) || '').trim();
    if (!v) return false;
    return FIELD_DEFAULTS[field] === undefined || v !== String(FIELD_DEFAULTS[field]).trim();
  });
  if (_hasMeaningfulData) {
    const banner = document.createElement('div');
    banner.id = 'resumeBanner';
    banner.className = 'resume-banner no-print';
    banner.innerHTML = '<span>Saved certificate loaded.</span>'
      + ' <button type="button" class="resume-btn-keep" onclick="document.getElementById(\'resumeBanner\').remove()">Keep it ✓</button>'
      + ' <button type="button" class="resume-btn-clear" onclick="document.getElementById(\'resumeBanner\').remove();clearAll()">Start fresh</button>';
    const controls = document.querySelector('.controls');
    if (controls) controls.insertAdjacentElement('afterend', banner);
    else document.body.prepend(banner);
  }

  // Fast date inputs
  document.querySelectorAll('.fast-date').forEach(attachFastDateInput);

  // Choice cycle buttons
  document.addEventListener('click', e => {
    if (e.target.classList.contains('choice-cycle')) cycleChoice(e.target);
  });
  document.addEventListener('keydown', e => {
    if (e.target.classList.contains('choice-cycle') && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      cycleChoice(e.target);
    }
    if (e.key === 'Escape') {
      const modal = document.getElementById('sigModal');
      if (modal && modal.classList.contains('open')) closeSigModal();
    }
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
