/* CP12 App Shell — Routing, Dashboard, Certificate Archive, Settings
   Works alongside cp12.js (which handles the form itself). */

'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────
const CERT_ARCHIVE_KEY  = 'cp12_cert_archive_v1';
const SETTINGS_KEY      = 'cp12_app_settings_v1';

// ── Settings helpers ──────────────────────────────────────────────────────────
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch(e) { return {}; }
}
function saveSettings(obj) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(obj)); } catch(e) {}
}
function getSetting(key, fallback) {
  return loadSettings()[key] || fallback || '';
}

// ── Certificate archive ───────────────────────────────────────────────────────
function getCertArchive() {
  try { return JSON.parse(localStorage.getItem(CERT_ARCHIVE_KEY) || '[]'); } catch(e) { return []; }
}
function setCertArchive(records) {
  try { localStorage.setItem(CERT_ARCHIVE_KEY, JSON.stringify(records)); } catch(e) {}
}

function saveCertToArchive(fields) {
  const get = k => (fields['cp12_v5_' + k] || '').trim();
  const id  = 'cert_' + Date.now();
  const rec = {
    id,
    ref:             get('cert_ref'),
    certDate:        get('cert_date'),
    nextCheckDate:   get('next_check_date'),
    installAddress:  get('install_address'),
    installPostcode: get('install_postcode'),
    landlordAddress: get('landlord_address'),
    companyName:     get('company_name'),
    gasSafeNo:       get('gas_safe_no'),
    savedAt:         new Date().toISOString(),
    fields,
  };
  const archive = getCertArchive();
  // Replace if same ref already exists
  const existing = archive.findIndex(r => r.ref && r.ref === rec.ref);
  if (existing >= 0) archive.splice(existing, 1);
  archive.unshift(rec);
  setCertArchive(archive);
}

// Hook: cp12.js calls this after a successful PDF download
window.onCertificateExported = function(fields) {
  saveCertToArchive(fields);
  updateSidebarBadge();
};

// ── Cert status helpers ───────────────────────────────────────────────────────
function certStatus(cert) {
  if (!cert.nextCheckDate) return 'draft';
  const parts = cert.nextCheckDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!parts) return 'draft';
  const due = new Date(+parts[3], +parts[2] - 1, +parts[1]);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const daysLeft = Math.round((due - now) / 86400000);
  if (daysLeft < 0)  return 'overdue';
  if (daysLeft <= 30) return 'soon';
  return 'valid';
}

function statusPill(cert) {
  const s = certStatus(cert);
  const map = {
    overdue: ['pill pill-overdue', 'Overdue'],
    soon:    ['pill pill-soon',    'Due soon'],
    valid:   ['pill pill-valid',   'Valid'],
    draft:   ['pill pill-draft',   'Draft'],
  };
  const [cls, label] = map[s] || map.draft;
  return `<span class="${cls}">${label}</span>`;
}

// ── Sidebar badge ─────────────────────────────────────────────────────────────
function updateSidebarBadge() {
  const archive = getCertArchive();
  const overdue = archive.filter(c => certStatus(c) === 'overdue').length;
  const soon    = archive.filter(c => certStatus(c) === 'soon').length;
  const badge   = document.getElementById('sbRenewalBadge');
  if (!badge) return;
  if (overdue + soon === 0) {
    badge.style.display = 'none';
    return;
  }
  badge.style.display = '';
  document.getElementById('sbRenewalVal').textContent  = overdue ? overdue + ' overdue' : soon + ' due soon';
  document.getElementById('sbRenewalSub').textContent  = overdue ? 'Certificates need renewal' : 'Within the next 30 days';
}

function updateSidebarBrand() {
  const s = loadSettings();
  const companyEl = document.getElementById('sbCompanyName');
  const gasEl     = document.getElementById('sbGasSafe');
  const logoMark  = document.getElementById('sbLogoMark');
  const logoImg   = document.getElementById('sbLogoImg');
  const initialsEl= document.getElementById('sbLogoInitials');

  if (companyEl) companyEl.textContent = s.company_name || 'Gas Safety App';
  if (gasEl)     gasEl.innerHTML = s.gas_safe_no ? `Gas Safe: <span>${s.gas_safe_no}</span>` : 'Gas Safe: not set';

  const logo = s.logo || localStorage.getItem('cp12_v5_logo') || '';
  if (logoImg && logoMark) {
    if (logo) {
      logoImg.src = logo;
      logoMark.classList.add('has-logo');
    } else {
      logoMark.classList.remove('has-logo');
    }
    // Initials fallback
    const name = s.company_name || '';
    if (initialsEl) {
      const parts = name.split(/\s+/).filter(Boolean);
      initialsEl.textContent = parts.length >= 2
        ? (parts[0][0] + parts[1][0]).toUpperCase()
        : (name.slice(0, 3).toUpperCase() || 'GAS');
    }
  }
}

// ── Routing ───────────────────────────────────────────────────────────────────
const VIEWS = ['dashboard', 'new', 'certificates', 'settings'];

function navigate(view) {
  if (!VIEWS.includes(view)) view = 'dashboard';

  // Update views
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  const el = document.getElementById('view-' + view);
  if (el) el.classList.add('active');

  // Update sidebar links
  document.querySelectorAll('.sb-link').forEach(a => {
    a.classList.toggle('active', a.dataset.view === view);
  });

  // Update app-main scroll position
  const main = document.getElementById('appMain');
  if (main) main.scrollTop = 0;

  // Render the active view
  if (view === 'dashboard')    renderDashboard();
  if (view === 'certificates') renderCertList();
  if (view === 'settings')     renderSettingsForm();

  // Auto-fill new cert from settings when navigating to the form
  if (view === 'new') autoFillNewCertFromSettings();
}

function goTo(view) {
  navigate(view);
  history.replaceState(null, '', '#' + view);
}

window.addEventListener('hashchange', () => {
  const view = location.hash.replace('#', '') || 'dashboard';
  navigate(view);
});

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
function renderDashboard() {
  const archive = getCertArchive();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const total    = archive.length;
  const thisMonth= archive.filter(c => c.savedAt && new Date(c.savedAt) >= monthStart).length;
  const overdue  = archive.filter(c => certStatus(c) === 'overdue').length;
  const soon     = archive.filter(c => certStatus(c) === 'soon').length;

  // Stats
  const setEl = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
  setEl('dashTotal', total);
  setEl('dashMonth', thisMonth);
  setEl('dashSoon',  soon);
  setEl('dashOverdue', overdue);

  // Recent table
  const tbody = document.getElementById('dashRecentBody');
  if (!tbody) return;

  if (!archive.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:28px;color:#94a3b8;font-size:12px;">
      No certificates yet — <button class="dash-table .td-btn" style="border:none;background:none;color:#1e3a5f;font-weight:700;cursor:pointer;font-size:12px;" onclick="goTo('new')">create your first one →</button>
    </td></tr>`;
    return;
  }

  const recent = archive.slice(0, 8);
  tbody.innerHTML = recent.map(c => {
    const addr = (c.installAddress || '').split('\n')[0].trim() || '—';
    const s = certStatus(c);
    const rowCls = s === 'overdue' ? 'style="background:#fff8f8"' : '';
    return `<tr ${rowCls}>
      <td class="ref-cell">${esc(c.ref || '—')}</td>
      <td class="addr-cell" title="${esc(c.installAddress || '')}">${esc(addr)}</td>
      <td>${esc(c.certDate || '—')}</td>
      <td>${esc(c.nextCheckDate || '—')}</td>
      <td>${statusPill(c)}</td>
      <td class="action-cell">
        <button class="td-btn" onclick="openCert('${esc(c.id)}')">View</button>
        <button class="td-btn" onclick="reExportCert('${esc(c.id)}')">PDF</button>
      </td>
    </tr>`;
  }).join('');
}

// ── ALL CERTIFICATES ──────────────────────────────────────────────────────────
let certFilter = 'all';
let certSearch = '';

function renderCertList() {
  const archive = getCertArchive();
  let records = archive;

  // Filter
  if (certFilter !== 'all') {
    records = records.filter(c => certStatus(c) === certFilter);
  }

  // Search
  if (certSearch.trim()) {
    const q = certSearch.trim().toLowerCase();
    records = records.filter(c => {
      const blob = [c.ref, c.installAddress, c.installPostcode, c.certDate, c.companyName].join(' ').toLowerCase();
      return blob.includes(q);
    });
  }

  // Count label
  const countEl = document.getElementById('certsCount');
  if (countEl) countEl.textContent = records.length + ' certificate' + (records.length !== 1 ? 's' : '');

  const grid = document.getElementById('certsGrid');
  if (!grid) return;

  if (!records.length) {
    grid.innerHTML = `<div class="certs-empty">
      <div class="empty-icon">📋</div>
      ${archive.length ? 'No certificates match your search.' : 'No certificates saved yet.<br>Download a PDF to save the first one.'}
    </div>`;
    return;
  }

  grid.innerHTML = records.map(c => {
    const addr = (c.installAddress || '').split('\n')[0].trim() || '—';
    const s = certStatus(c);
    const cardCls = s === 'overdue' ? ' overdue' : s === 'soon' ? ' due-soon' : '';
    return `<div class="cert-card${cardCls}">
      <div class="cert-card-pill">${statusPill(c)}</div>
      <div class="cert-card-ref">${esc(c.ref || 'No reference')}</div>
      <div class="cert-card-addr">${esc(addr)}${c.installPostcode ? ', ' + esc(c.installPostcode) : ''}</div>
      <div class="cert-card-footer">
        <span class="cert-card-date">Issued ${esc(c.certDate || '—')} · Due ${esc(c.nextCheckDate || '?')}</span>
        <div class="cert-card-actions">
          <button class="cert-card-btn" onclick="event.stopPropagation();openCert('${esc(c.id)}')">View</button>
          <button class="cert-card-btn" onclick="event.stopPropagation();reExportCert('${esc(c.id)}')">PDF</button>
          <button class="cert-card-btn danger" onclick="event.stopPropagation();deleteCert('${esc(c.id)}')">Del</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function setCertFilter(f, btn) {
  certFilter = f;
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderCertList();
}

function openCert(id) {
  const archive = getCertArchive();
  const cert = archive.find(c => c.id === id);
  if (!cert || !cert.fields) return;
  // Load field values into localStorage then reload the form
  Object.entries(cert.fields).forEach(([k, v]) => {
    try { localStorage.setItem(k, v); } catch(e) {}
  });
  // Reload form state
  if (typeof loadForm === 'function') loadForm();
  goTo('new');
}

function reExportCert(id) {
  openCert(id);
  // Give form time to load, then trigger PDF
  setTimeout(() => {
    const btn = document.getElementById('quickPdfBtn');
    if (btn) btn.click();
  }, 600);
}

function deleteCert(id) {
  if (!confirm('Remove this certificate from the archive?\n\nThis only removes the record — it does not delete any PDFs you have already saved.')) return;
  const archive = getCertArchive().filter(c => c.id !== id);
  setCertArchive(archive);
  updateSidebarBadge();
  renderCertList();
}

function exportCertsCSV() {
  const archive = getCertArchive();
  if (!archive.length) { alert('No certificates to export.'); return; }
  const headers = ['Reference', 'Cert Date', 'Next Due', 'Address', 'Postcode', 'Company', 'Gas Safe No', 'Status', 'Saved At'];
  const rows = archive.map(c => [
    c.ref, c.certDate, c.nextCheckDate,
    (c.installAddress || '').replace(/\n/g, ' '),
    c.installPostcode, c.companyName, c.gasSafeNo,
    certStatus(c), c.savedAt,
  ].map(v => '"' + String(v || '').replace(/"/g, '""') + '"').join(','));
  const csv = [headers.join(','), ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'CP12_certificates_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// ── SETTINGS ──────────────────────────────────────────────────────────────────
function renderSettingsForm() {
  const s = loadSettings();
  const fields = ['company_name', 'gas_safe_no', 'phone', 'email', 'address', 'postcode', 'ref_prefix'];
  fields.forEach(k => {
    const el = document.getElementById('setting_' + k);
    if (el) el.value = s[k] || '';
  });
  // Logo preview
  const logo = s.logo || localStorage.getItem('cp12_v5_logo') || '';
  const zone  = document.getElementById('settingsLogoZone');
  const preview = document.getElementById('settingsLogoPreview');
  if (zone && preview && logo) {
    preview.src = logo;
    zone.classList.add('has-logo');
    zone.querySelector('.settings-logo-text').textContent = 'Logo uploaded — click to change';
  }
}

function saveSettingsForm() {
  const s = {};
  ['company_name', 'gas_safe_no', 'phone', 'email', 'address', 'postcode', 'ref_prefix'].forEach(k => {
    const el = document.getElementById('setting_' + k);
    if (el) s[k] = el.value.trim();
  });
  // Carry over logo from existing settings or logo localStorage key
  const existing = loadSettings();
  s.logo = existing.logo || localStorage.getItem('cp12_v5_logo') || '';
  saveSettings(s);
  // Sync to cp12 form fields too
  syncSettingsToForm(s);
  updateSidebarBrand();
  // Also update ref prefix
  if (s.ref_prefix) {
    const currentBase = localStorage.getItem('cp12_ref_base') || '';
    // Only update prefix if the base doesn't already start with it
    if (!currentBase.startsWith(s.ref_prefix)) {
      localStorage.setItem('cp12_ref_base', s.ref_prefix + '100');
    }
  }
  const note = document.getElementById('settingsSaveNote');
  if (note) { note.classList.add('show'); setTimeout(() => note.classList.remove('show'), 2500); }
}

function syncSettingsToForm(s) {
  const map = {
    company_name: 'company_name',
    gas_safe_no:  'gas_safe_no',
    phone:        'business_phone',
    email:        'business_email',
    address:      'business_address',
    postcode:     'business_postcode',
  };
  Object.entries(map).forEach(([sk, fk]) => {
    if (s[sk]) {
      const el = document.querySelector(`[data-field="${fk}"]`);
      if (el && !el.value.trim()) el.value = s[sk];
      localStorage.setItem('cp12_v5_' + fk, s[sk]);
    }
  });
}

function autoFillNewCertFromSettings() {
  const s = loadSettings();
  if (!s.company_name) return;
  syncSettingsToForm(s);
  // Reload form fields
  if (typeof loadForm === 'function') loadForm();
}

function handleSettingsLogoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    if (typeof optimiseLogoDataUrl === 'function') {
      optimiseLogoDataUrl(e.target.result, optimised => {
        _applySettingsLogo(optimised);
      });
    } else {
      _applySettingsLogo(e.target.result);
    }
  };
  reader.readAsDataURL(file);
}

function _applySettingsLogo(dataUrl) {
  const s = loadSettings();
  s.logo = dataUrl;
  saveSettings(s);
  // Also write to the cp12 logo key so the form picks it up
  try { localStorage.setItem('cp12_v5_logo', dataUrl); } catch(e) {}
  // Update preview
  const zone    = document.getElementById('settingsLogoZone');
  const preview = document.getElementById('settingsLogoPreview');
  if (zone && preview) {
    preview.src = dataUrl;
    zone.classList.add('has-logo');
    zone.querySelector('.settings-logo-text').textContent = 'Logo uploaded — click to change';
  }
  // Update sidebar
  updateSidebarBrand();
  // Update form logo if visible
  if (typeof applyLogo === 'function') applyLogo(dataUrl);
}

// ── Utility ───────────────────────────────────────────────────────────────────
function esc(v) {
  return String(v || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  updateSidebarBrand();
  updateSidebarBadge();

  // Sidebar link clicks
  document.querySelectorAll('.sb-link').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      const view = a.dataset.view;
      goTo(view);
    });
  });

  // Certs search
  const searchEl = document.getElementById('certsSearchInput');
  if (searchEl) {
    searchEl.addEventListener('input', () => { certSearch = searchEl.value; renderCertList(); });
  }

  // Settings logo upload trigger
  const settingsLogoZone = document.getElementById('settingsLogoZone');
  const settingsLogoInput = document.getElementById('settingsLogoInput');
  if (settingsLogoZone && settingsLogoInput) {
    settingsLogoZone.addEventListener('click', () => settingsLogoInput.click());
    settingsLogoInput.addEventListener('change', handleSettingsLogoUpload);
  }

  // Route on load
  const hash = location.hash.replace('#', '') || 'dashboard';
  navigate(hash);
});
