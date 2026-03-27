/* ═══════════════════════════════════════════════════════════
   Sub Tracker — Main App JS
   ═══════════════════════════════════════════════════════════ */

// ── State ──────────────────────────────────────────────────
const state = {
  subs: [],
  divisions: [],
  filter: { division: 'all', search: '' },
  sort: { field: 'company_name', dir: 1 },
  editingId: null,
  pendingDeleteId: null,
  mapReady: false,
  mapLeaflet: null,
  mapLayerGroup: null,
  mapPinLookup: new Map(),
  highlightedPinId: null,
  coverageRadiusMiles: 25,
  showCoverageRadius: true,
  manualCoordsId: null,
};

// Division color palette (for map pins)
const DIVISION_COLORS = [
  '#e8a020','#3b7dd8','#27ae60','#9b59b6','#e74c3c',
  '#1abc9c','#f39c12','#2980b9','#8e44ad','#16a085',
  '#d35400','#2ecc71','#c0392b','#2c3e50','#7f8c8d',
  '#e91e63','#00bcd4','#ff5722','#607d8b','#795548',
];
const MAP_HOVER_COLOR = '#e8a020';

const divColorMap = {};

// ── Init ───────────────────────────────────────────────────
async function init() {
  await loadDivisions();
  await loadSubs();
  setupTabs();
  setupFilters();
  setupModal();
  setupConfirmModal();
}

// ── API ────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ── Load Data ──────────────────────────────────────────────
async function loadDivisions() {
  state.divisions = await api('GET', '/api/divisions');

  // Assign colors
  state.divisions.forEach((d, i) => {
    divColorMap[d.num] = DIVISION_COLORS[i % DIVISION_COLORS.length];
  });

  // Populate global filter
  const globalSel = document.getElementById('globalDivisionFilter');
  state.divisions.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.num;
    opt.textContent = `Div ${d.num} — ${d.name}`;
    globalSel.appendChild(opt);
  });

  setDivisionSelections([state.divisions[0]?.num].filter(Boolean));
}

async function loadSubs() {
  state.subs = await api('GET', '/api/subcontractors');
  renderList();
  if (state.mapReady) renderPins();
  updateBadge();
}

// ── Tabs ───────────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const target = document.getElementById('tab-' + tab.dataset.tab);
      target.classList.add('active');

      if (tab.dataset.tab === 'map' && !state.mapReady) {
        initMap();
      }
    });
  });
}

// ── Filters & Sort ─────────────────────────────────────────
function setupFilters() {
  document.getElementById('globalDivisionFilter').addEventListener('change', e => {
    state.filter.division = e.target.value;
    renderList();
    if (state.mapReady) renderPins();
  });

  document.getElementById('searchInput').addEventListener('input', e => {
    state.filter.search = e.target.value.toLowerCase();
    renderList();
  });

  document.getElementById('sortField').addEventListener('change', e => {
    state.sort.field = e.target.value;
    renderList();
  });

  const sortDirBtn = document.getElementById('sortDir');
  sortDirBtn.addEventListener('click', () => {
    state.sort.dir *= -1;
    sortDirBtn.textContent = state.sort.dir === 1 ? '↑' : '↓';
    renderList();
  });
}

// ── Filter Subs ────────────────────────────────────────────
function getFilteredSubs() {
  let list = [...state.subs];

  if (state.filter.division !== 'all') {
    list = list.filter(s => getSubDivisionNums(s).includes(state.filter.division));
  }

  if (state.filter.search) {
    const q = state.filter.search;
    list = list.filter(s =>
      (s.company_name || '').toLowerCase().includes(q) ||
      (s.city || '').toLowerCase().includes(q) ||
      (s.contact_name || '').toLowerCase().includes(q) ||
      (s.division_name || '').toLowerCase().includes(q)
    );
  }

  // Sort
  const f = state.sort.field;
  list.sort((a, b) => {
    const va = (a[f] || '').toString().toLowerCase();
    const vb = (b[f] || '').toString().toLowerCase();
    return va < vb ? -state.sort.dir : va > vb ? state.sort.dir : 0;
  });

  return list;
}

// ── Render List ────────────────────────────────────────────
function renderList() {
  const list = getFilteredSubs();
  const container = document.getElementById('subList');
  const empty = document.getElementById('emptyState');

  if (list.length === 0) {
    empty.style.display = 'block';
    // Remove cards
    container.querySelectorAll('.sub-card').forEach(c => c.remove());
    return;
  }
  empty.style.display = 'none';

  // Diff render — rebuild for simplicity
  container.querySelectorAll('.sub-card').forEach(c => c.remove());

  list.forEach(sub => {
    const card = document.createElement('div');
    card.className = 'sub-card';
    card.dataset.id = sub._id;

    const color = divColorMap[sub.division_num] || '#7a8496';
    card.style.borderLeftColor = color;

    const addr = [sub.address, sub.city, sub.state, sub.zip].filter(Boolean).join(', ');
    const websiteUrl = normalizeWebsite(sub.website);
    const websiteHtml = websiteUrl
      ? `<span>🌐 <a href="${escAttr(websiteUrl)}" target="_blank" rel="noopener noreferrer">${escHtml(sub.website)}</a></span>`
      : '';
    const geoHtml = sub.lat
      ? `<span class="geo-indicator geo-ok">📍 Mapped</span>`
      : `<span class="geo-indicator geo-missing" data-id="${sub._id}" title="Click to retry geocoding">⚠ No Coords</span>`;

    const contactParts = [];
    if (sub.contact_name) contactParts.push(sub.contact_name);
    if (sub.contact_phone) contactParts.push(sub.contact_phone);
    if (sub.contact_email) contactParts.push(`<a href="mailto:${sub.contact_email}" style="color:var(--accent2)">${sub.contact_email}</a>`);

    card.innerHTML = `
      <div class="sub-card-main">
        <div class="sub-name">${escHtml(sub.company_name)}</div>
        <div class="sub-meta">
          ${renderDivisionBadges(sub)}
          ${addr ? `<span>📍 ${escHtml(addr)}</span>` : ''}
          ${websiteHtml}
        </div>
        ${contactParts.length ? `<div class="sub-contact">👤 ${contactParts.join(' · ')}</div>` : ''}
        ${sub.notes ? `<div class="sub-notes">${escHtml(sub.notes)}</div>` : ''}
      </div>
      <div class="sub-card-actions">
        ${geoHtml}
        <button class="btn btn-sm btn-ghost btn-edit" data-id="${sub._id}">Edit</button>
        <button class="btn btn-sm btn-danger btn-delete" data-id="${sub._id}">Delete</button>
      </div>
    `;

    container.appendChild(card);
  });

  // Wire actions
  container.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', () => openEditModal(btn.dataset.id));
  });
  container.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', () => openConfirm(btn.dataset.id));
  });
  container.querySelectorAll('.geo-missing[data-id]').forEach(el => {
    el.addEventListener('click', () => retryGeocode(el.dataset.id));
  });

  updateBadge();
}

function updateBadge() {
  document.getElementById('subCount').textContent = state.subs.length;
}

// ── Modal: Add/Edit ────────────────────────────────────────
function setupModal() {
  document.getElementById('btnAddSub').addEventListener('click', openAddModal);
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalCancel').addEventListener('click', closeModal);
  document.getElementById('modal').querySelector('.modal-backdrop').addEventListener('click', closeModal);
  document.getElementById('modalSave').addEventListener('click', saveModal);
  document.getElementById('btnAddDivisionRow').addEventListener('click', () => addDivisionRow());
  document.getElementById('btnPasteAddress').addEventListener('click', pasteAddressFromClipboard);
  setupPhoneFormatting();
  setupManualCoordsModal();
}

function openAddModal() {
  state.editingId = null;
  document.getElementById('modalTitle').textContent = 'Add Subcontractor';
  clearForm();
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('fCompanyName').focus();
}

function openEditModal(id) {
  const sub = state.subs.find(s => s._id === id);
  if (!sub) return;
  state.editingId = id;
  document.getElementById('modalTitle').textContent = 'Edit Subcontractor';
  document.getElementById('fCompanyName').value = sub.company_name || '';
  setDivisionSelections(getSubDivisionNums(sub));
  document.getElementById('fAddress').value = sub.address || '';
  document.getElementById('fWebsite').value = cleanWebsiteValue(sub.website || '');
  document.getElementById('fCity').value = sub.city || '';
  document.getElementById('fState').value = sub.state || 'OH';
  document.getElementById('fZip').value = sub.zip || '';
  document.getElementById('fContactName').value = sub.contact_name || '';
  document.getElementById('fContactPhone').value = formatPhoneInput(sub.contact_phone || '');
  document.getElementById('fContactEmail').value = sub.contact_email || '';
  document.getElementById('fNotes').value = sub.notes || '';
  hideGeoStatus();
  document.getElementById('modal').classList.remove('hidden');
}

function clearForm() {
  ['fCompanyName','fAddress','fWebsite','fCity','fContactName','fContactPhone','fContactEmail','fNotes'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('fState').value = 'OH';
  document.getElementById('fZip').value = '';
  setDivisionSelections([state.divisions[0]?.num].filter(Boolean));
  clearAddressFieldHighlights();
  hideGeoStatus();
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  state.editingId = null;
}

async function saveModal() {
  const company_name = document.getElementById('fCompanyName').value.trim();
  const division_nums = getDivisionSelections();
  const division_num = division_nums[0];

  if (!company_name || !division_num) {
    document.getElementById('fCompanyName').focus();
    return;
  }

  const payload = {
    company_name,
    division_num,
    division_nums,
    address: document.getElementById('fAddress').value.trim(),
    website: cleanWebsiteValue(document.getElementById('fWebsite').value),
    city: document.getElementById('fCity').value.trim(),
    state: document.getElementById('fState').value.trim() || 'OH',
    zip: document.getElementById('fZip').value.trim(),
    contact_name: document.getElementById('fContactName').value.trim(),
    contact_phone: document.getElementById('fContactPhone').value.trim(),
    contact_email: document.getElementById('fContactEmail').value.trim(),
    notes: document.getElementById('fNotes').value.trim(),
  };

  setGeoStatus('loading', '⏳ Geocoding address...');
  document.getElementById('modalSave').disabled = true;

  try {
    let savedDoc;
    if (state.editingId) {
      savedDoc = await api('PUT', `/api/subcontractors/${state.editingId}`, payload);
    } else {
      savedDoc = await api('POST', '/api/subcontractors', payload);
    }
    await loadSubs();
    closeModal();
    if (savedDoc && !(savedDoc.lat && savedDoc.lng)) {
      openManualCoordsModal(savedDoc._id, {
        reason: 'We could not geocode that address.',
      });
    }
  } catch (e) {
    setGeoStatus('error', '❌ ' + e.message);
  } finally {
    document.getElementById('modalSave').disabled = false;
  }
}

function setupPhoneFormatting() {
  const phoneInput = document.getElementById('fContactPhone');
  if (!phoneInput) return;

  phoneInput.addEventListener('input', () => {
    phoneInput.value = formatPhoneInput(phoneInput.value);
  });

  phoneInput.addEventListener('paste', () => {
    setTimeout(() => {
      phoneInput.value = formatPhoneInput(phoneInput.value);
    }, 0);
  });
}

function cleanWebsiteValue(value) {
  if (!value) return '';
  return String(value).trim().replace(/\s+/g, '');
}

function formatPhoneInput(value) {
  const digits = (value || '').replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)})${digits.slice(3)}`;
  return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function addDivisionRow(value = '') {
  const rows = document.getElementById('divisionRows');
  const row = document.createElement('div');
  row.className = 'division-row';

  const select = document.createElement('select');
  select.className = 'division-select';
  state.divisions.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.num;
    opt.textContent = `${d.num} — ${d.name}`;
    select.appendChild(opt);
  });
  if (value) select.value = value;

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn btn-danger btn-sm btn-inline';
  removeBtn.textContent = '−';
  removeBtn.title = 'Remove division';
  removeBtn.addEventListener('click', () => {
    row.remove();
    ensureDivisionRows();
  });

  row.appendChild(select);
  row.appendChild(removeBtn);
  rows.appendChild(row);
  ensureDivisionRows();
}

function ensureDivisionRows() {
  const rows = document.getElementById('divisionRows');
  if (!rows.children.length) addDivisionRow(state.divisions[0]?.num || '');
  rows.querySelectorAll('.division-row').forEach((row, idx) => {
    const btn = row.querySelector('button');
    btn.disabled = rows.children.length === 1 && idx === 0;
  });
}

function getDivisionSelections() {
  const nums = [...document.querySelectorAll('.division-select')]
    .map(el => el.value)
    .filter(Boolean);
  return [...new Set(nums)];
}

function setDivisionSelections(nums) {
  const rows = document.getElementById('divisionRows');
  rows.innerHTML = '';
  (nums.length ? nums : [state.divisions[0]?.num]).forEach(n => addDivisionRow(n));
}

async function pasteAddressFromClipboard() {
  clearAddressFieldHighlights();
  try {
    const text = await navigator.clipboard.readText();
    applyParsedAddress(text);
  } catch (e) {
    const manualPaste = window.prompt(
      'Clipboard access is blocked in this browser context.\nPaste the full address here and press OK:',
      ''
    );
    if (manualPaste && manualPaste.trim()) {
      applyParsedAddress(manualPaste);
      return;
    }
    setGeoStatus('error', `❌ Clipboard blocked. ${getClipboardHelpText()}`);
  }
}

function applyParsedAddress(rawAddressText) {
  const parsed = parseAddressText(rawAddressText);
  if (!parsed) {
    setGeoStatus('error', '❌ Could not parse that address. Please paste manually.');
    return;
  }

  document.getElementById('fAddress').value = parsed.address || '';
  document.getElementById('fCity').value = parsed.city || '';
  document.getElementById('fState').value = parsed.state || 'OH';
  document.getElementById('fZip').value = parsed.zip || '';

  const missing = [];
  if (!parsed.address) missing.push('fAddress');
  if (!parsed.city) missing.push('fCity');
  if (!parsed.state) missing.push('fState');
  if (!parsed.zip) missing.push('fZip');

  if (missing.length) {
    missing.forEach(id => document.getElementById(id).classList.add('field-missing'));
    setGeoStatus('error', `⚠ Address pasted, but missing: ${missing.map(id => id.replace('f', '')).join(', ')}.`);
  } else {
    setGeoStatus('ok', '✅ Address pasted into all fields.');
  }
}

function getClipboardHelpText() {
  const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  if (window.location.protocol !== 'https:' && !isLocalhost) {
    return 'Use HTTPS (or localhost) and enable site clipboard permissions in your browser settings.';
  }
  return 'Enable clipboard permissions for this site in your browser settings, then refresh.';
}

function parseAddressText(text) {
  if (!text) return null;
  const normalized = text.replace(/\n/g, ', ').replace(/\s+/g, ' ').trim();
  const fullMatch = normalized.match(/^(.*?),\s*([^,]+),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (fullMatch) {
    return {
      address: fullMatch[1].trim(),
      city: fullMatch[2].trim(),
      state: fullMatch[3].toUpperCase(),
      zip: fullMatch[4],
    };
  }
  const partialMatch = normalized.match(/^(.*?)(?:,\s*([^,]+))?(?:,\s*([A-Za-z]{2}))?(?:\s+(\d{5}(?:-\d{4})?))?$/);
  if (!partialMatch) return null;
  return {
    address: (partialMatch[1] || '').trim(),
    city: (partialMatch[2] || '').trim(),
    state: (partialMatch[3] || '').toUpperCase(),
    zip: (partialMatch[4] || '').trim(),
  };
}

function clearAddressFieldHighlights() {
  ['fAddress', 'fCity', 'fState', 'fZip'].forEach(id => {
    document.getElementById(id).classList.remove('field-missing');
  });
}

function setGeoStatus(type, msg) {
  const el = document.getElementById('geocodeStatus');
  el.className = `geocode-status ${type}`;
  el.textContent = msg;
}

function hideGeoStatus() {
  document.getElementById('geocodeStatus').className = 'geocode-status hidden';
}

// ── Confirm Delete ─────────────────────────────────────────
function setupConfirmModal() {
  document.getElementById('confirmCancel').addEventListener('click', () => {
    document.getElementById('confirmModal').classList.add('hidden');
  });
  document.getElementById('confirmModal').querySelector('.modal-backdrop').addEventListener('click', () => {
    document.getElementById('confirmModal').classList.add('hidden');
  });
  document.getElementById('confirmDelete').addEventListener('click', async () => {
    if (!state.pendingDeleteId) return;
    await api('DELETE', `/api/subcontractors/${state.pendingDeleteId}`);
    state.pendingDeleteId = null;
    document.getElementById('confirmModal').classList.add('hidden');
    await loadSubs();
  });
}

function openConfirm(id) {
  const sub = state.subs.find(s => s._id === id);
  state.pendingDeleteId = id;
  document.getElementById('confirmMsg').textContent =
    `Delete "${sub ? sub.company_name : 'this subcontractor'}"? This cannot be undone.`;
  document.getElementById('confirmModal').classList.remove('hidden');
}

// ── Retry Geocode ──────────────────────────────────────────
async function retryGeocode(id) {
  try {
    const result = await api('POST', `/api/subcontractors/${id}/geocode`);
    await loadSubs();
    if (!(result.lat && result.lng)) {
      openManualCoordsModal(id, { reason: 'Geocoding did not return coordinates.' });
    }
  } catch (e) {
    openManualCoordsModal(id, { reason: `Could not geocode this address (${e.message}).` });
  }
}

function setupManualCoordsModal() {
  const modal = document.getElementById('manualCoordsModal');
  modal.querySelector('.modal-backdrop').addEventListener('click', closeManualCoordsModal);
  document.getElementById('manualCoordsClose').addEventListener('click', closeManualCoordsModal);
  document.getElementById('manualCoordsCancel').addEventListener('click', closeManualCoordsModal);
  document.getElementById('manualCoordsSave').addEventListener('click', saveManualCoords);
}

function openManualCoordsModal(subId, options = {}) {
  state.manualCoordsId = subId;
  document.getElementById('manualCoordsReason').textContent = options.reason || 'Unable to geocode this address.';
  document.getElementById('fManualCoords').value = '';
  document.getElementById('manualCoordsError').classList.add('hidden');
  document.getElementById('manualCoordsModal').classList.remove('hidden');
  document.getElementById('fManualCoords').focus();
}

function closeManualCoordsModal() {
  document.getElementById('manualCoordsModal').classList.add('hidden');
  state.manualCoordsId = null;
}

async function saveManualCoords() {
  if (!state.manualCoordsId) return;
  const coordsRaw = document.getElementById('fManualCoords').value.trim();
  const [lat, lng] = parseLatLng(coordsRaw);
  const errorEl = document.getElementById('manualCoordsError');

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    errorEl.textContent = 'Enter valid coordinates in this format: "lat, lng" (example: 39.9612, -82.9988).';
    errorEl.classList.remove('hidden');
    return;
  }

  document.getElementById('manualCoordsSave').disabled = true;
  try {
    await api('PUT', `/api/subcontractors/${state.manualCoordsId}`, { lat, lng });
    await loadSubs();
    closeManualCoordsModal();
  } catch (e) {
    errorEl.textContent = e.message || 'Could not save coordinates.';
    errorEl.classList.remove('hidden');
  } finally {
    document.getElementById('manualCoordsSave').disabled = false;
  }
}

function parseLatLng(value) {
  const parts = String(value || '').split(',').map(v => v.trim()).filter(Boolean);
  if (parts.length !== 2) return [NaN, NaN];
  return [parseFloat(parts[0]), parseFloat(parts[1])];
}

// ── MAP ────────────────────────────────────────────────────
async function initMap() {
  const map = L.map('ohioMap', {
    zoomControl: false,
    minZoom: 6,
    maxZoom: 18,
  }).setView([40.25, -82.85], 7);

  state.mapLeaflet = map;
  state.mapLayerGroup = L.layerGroup().addTo(map);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  // Zoom controls
  document.getElementById('btnZoomIn').addEventListener('click', () => {
    map.zoomIn();
  });
  document.getElementById('btnZoomOut').addEventListener('click', () => {
    map.zoomOut();
  });
  document.getElementById('btnResetZoom').addEventListener('click', () => {
    map.setView([40.25, -82.85], 7);
  });

  const radiusSlider = document.getElementById('coverageRadiusMiles');
  const radiusToggle = document.getElementById('showCoverageRadius');
  radiusSlider.value = String(state.coverageRadiusMiles);
  radiusToggle.checked = state.showCoverageRadius;
  radiusSlider.disabled = !state.showCoverageRadius;
  radiusSlider.addEventListener('change', () => {
    const next = parseInt(radiusSlider.value, 10);
    state.coverageRadiusMiles = Number.isFinite(next) ? Math.max(1, Math.min(300, next)) : 25;
    radiusSlider.value = String(state.coverageRadiusMiles);
    renderPins();
  });
  radiusToggle.addEventListener('change', () => {
    state.showCoverageRadius = radiusToggle.checked;
    radiusSlider.disabled = !state.showCoverageRadius;
    renderPins();
  });

  map.on('zoomend moveend', () => {
    const tooltip = document.getElementById('mapTooltip');
    tooltip.style.display = 'none';
  });
  state.mapReady = true;
  renderPins();
}

function renderPins() {
  if (!state.mapReady || !state.mapLeaflet || !state.mapLayerGroup) return;

  const filtered = getFilteredSubs().filter(s => s.lat && s.lng);
  const coverageMeters = state.coverageRadiusMiles * 1609.34;
  state.mapLayerGroup.clearLayers();
  state.mapPinLookup.clear();
  state.highlightedPinId = null;

  // Update sidebar stats
  const visibleCities = new Set();

  filtered.forEach(sub => {
    const primaryDivision = getSubDivisionNums(sub)[0];
    const color = divColorMap[primaryDivision] || '#7a8496';
    const marker = L.circleMarker([sub.lat, sub.lng], {
      radius: 7,
      color: '#0f1114',
      weight: 1.5,
      fillColor: color,
      fillOpacity: 0.95,
    });

    marker.bindTooltip(`
      <strong>${escHtml(sub.company_name)}</strong><br>
      ${renderDivisionTooltip(sub)}<br>
      ${escHtml([sub.city, sub.state].filter(Boolean).join(', '))}
    `, {
      direction: 'top',
      offset: [0, -8],
      opacity: 0.95,
    });

    marker.bindPopup(buildMapPopup(sub), {
      maxWidth: 320,
      className: 'sub-popup',
    });

    marker.addTo(state.mapLayerGroup);
    state.mapPinLookup.set(sub._id, { marker, baseColor: color });

    if (state.showCoverageRadius) {
      L.circle([sub.lat, sub.lng], {
        radius: coverageMeters,
        color,
        weight: 1,
        opacity: 0.45,
        fillColor: color,
        fillOpacity: 0.08,
        interactive: false,
      }).addTo(state.mapLayerGroup);
    }

    if (sub.city) visibleCities.add(sub.city.toLowerCase());
  });

  // Update sidebar stats
  document.getElementById('mapSubCount').textContent = filtered.length;
  document.getElementById('mapCountyCount').textContent = visibleCities.size;

  // Update legend
  renderMapLegend(filtered);

  // Update pin list
  renderMapPinList(filtered);
}

function renderMapLegend(filtered) {
  const container = document.getElementById('legendItems');
  container.innerHTML = '';

  // Get unique divisions present
  const divs = [...new Set(filtered.flatMap(s => getSubDivisionNums(s)))].sort();

  if (divs.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:11px;">No pins visible</div>';
    return;
  }

  divs.forEach(num => {
    const div = state.divisions.find(d => d.num === num);
    const color = divColorMap[num] || '#7a8496';
    const count = filtered.filter(s => getSubDivisionNums(s).includes(num)).length;

    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `
      <span class="legend-dot" style="background:${color}"></span>
      <span>${num} ${div ? div.name.split(',')[0] : ''}</span>
      <span style="margin-left:auto;color:var(--accent);font-weight:700">${count}</span>
    `;
    container.appendChild(item);
  });
}

function renderMapPinList(filtered) {
  const container = document.getElementById('mapPinList');
  container.innerHTML = '';

  if (filtered.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:11px;">No subcontractors match the current filter.</div>';
    return;
  }

  filtered.forEach(sub => {
    const item = document.createElement('div');
    item.className = 'pin-list-item';
    const color = divColorMap[getSubDivisionNums(sub)[0]] || '#7a8496';
    item.innerHTML = `
      <div class="pin-list-name" style="color:${color}">${escHtml(sub.company_name)}</div>
      <div>${sub.city || '—'}</div>
    `;
    item.addEventListener('click', () => {
      if (!state.mapLeaflet) return;
      state.mapLeaflet.setView([sub.lat, sub.lng], Math.max(state.mapLeaflet.getZoom(), 11));
    });
    item.addEventListener('mouseenter', () => setMapPinHighlight(sub._id));
    item.addEventListener('mouseleave', () => setMapPinHighlight(null));
    container.appendChild(item);
  });
}

function setMapPinHighlight(subId) {
  if (state.highlightedPinId && state.mapPinLookup.has(state.highlightedPinId)) {
    const previousPin = state.mapPinLookup.get(state.highlightedPinId);
    previousPin.marker.setStyle({
      radius: 7,
      fillColor: previousPin.baseColor,
      color: '#0f1114',
      weight: 1.5,
    });
  }

  state.highlightedPinId = subId;

  if (!subId || !state.mapPinLookup.has(subId)) return;

  const pin = state.mapPinLookup.get(subId);
  pin.marker.setStyle({
    radius: 10,
    fillColor: MAP_HOVER_COLOR,
    color: MAP_HOVER_COLOR,
    weight: 2.5,
  });
  pin.marker.bringToFront();
}

function buildMapPopup(sub) {
  const addr = [sub.address, sub.city, sub.state, sub.zip].filter(Boolean).join(', ');
  const website = normalizeWebsite(sub.website);
  return `
    <div>
      <div style="font-family:var(--font-display);font-size:15px;font-weight:700;color:#fff;margin-bottom:6px;">
        ${escHtml(sub.company_name)}
      </div>
      <div style="font-size:12px;color:var(--accent);margin-bottom:6px;">${renderDivisionTooltip(sub)}</div>
      ${addr ? `<div style="margin-bottom:4px;">📍 ${escHtml(addr)}</div>` : ''}
      ${sub.contact_name ? `<div>👤 ${escHtml(sub.contact_name)}</div>` : ''}
      ${sub.contact_phone ? `<div>📞 ${escHtml(sub.contact_phone)}</div>` : ''}
      ${sub.contact_email ? `<div>✉️ <a href="mailto:${escAttr(sub.contact_email)}">${escHtml(sub.contact_email)}</a></div>` : ''}
      ${website ? `<div>🌐 <a href="${escAttr(website)}" target="_blank" rel="noopener noreferrer">${escHtml(sub.website)}</a></div>` : ''}
      ${sub.notes ? `<div style="margin-top:6px;color:var(--text-dim);">${escHtml(sub.notes)}</div>` : ''}
    </div>
  `;
}

function getSubDivisionNums(sub) {
  if (Array.isArray(sub.division_nums) && sub.division_nums.length) return sub.division_nums;
  return sub.division_num ? [sub.division_num] : [];
}

function renderDivisionBadges(sub) {
  return getSubDivisionNums(sub).map((num) => {
    const color = divColorMap[num] || '#7a8496';
    const div = state.divisions.find(d => d.num === num);
    return `<span class="division-badge" style="color:${color};border-color:${color}33"><span>${num}</span><span>${escHtml(div?.name || '')}</span></span>`;
  }).join('');
}

function renderDivisionTooltip(sub) {
  return getSubDivisionNums(sub)
    .map((num) => {
      const div = state.divisions.find(d => d.num === num);
      return `Div ${num} — ${escHtml(div?.name || '')}`;
    })
    .join('<br>');
}

// ── Util ───────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  return escHtml(str).replace(/'/g, '&#39;');
}

function normalizeWebsite(rawWebsite) {
  if (!rawWebsite) return '';
  const trimmed = String(rawWebsite).trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

// ── Boot ───────────────────────────────────────────────────
init();
