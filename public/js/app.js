/* ═══════════════════════════════════════════════════════════
   Sub Tracker — Main App JS
   ═══════════════════════════════════════════════════════════ */

// ── State ──────────────────────────────────────────────────
const state = {
  subs: [],
  divisions: [],
  filter: { divisions: [], search: '', notesSearch: '', mapSearch: '', divisionMode: 'all' },
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
  showCountyBorders: false,
  mapCountyLayer: null,
  countyBordersLoaded: false,
  countyFeatures: [],
  countyFeaturesPromise: null,
  boundaryCatalog: [],
  activeBoundaryIds: new Set(),
  boundaryLayers: new Map(),
  tempPinMarker: null,
  manualCoordsId: null,
  exportColumns: [],
};

// Division color palette (for map pins)
const DIVISION_COLORS = [
  '#e8a020','#3b7dd8','#27ae60','#9b59b6','#e74c3c',
  '#1abc9c','#f39c12','#2980b9','#8e44ad','#16a085',
  '#d35400','#2ecc71','#c0392b','#2c3e50','#7f8c8d',
  '#e91e63','#00bcd4','#ff5722','#607d8b','#795548',
];
const MAP_HOVER_COLOR = '#e8a020';
const COVERAGE_RING_HOVER_COLOR = '#ffd166';
const COUNTY_GEOJSON_URL = 'https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json';
const BOUNDARY_STROKE_COLORS = ['#000000', '#1e63ff', '#d62828', '#1f9d55'];
const RECENT_PROJECT_PINS_KEY = 'subtracker_recent_project_pin_addresses';
const MAX_RECENT_PROJECT_PINS = 10;

function getLocalStorageSafe() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch (err) {
    return null;
  }
}

const EXPORT_FIELDS = [
  { key: 'company_name', label: 'Company Name', value: sub => sub.company_name || '' },
  { key: 'division_nums', label: 'Division Numbers', value: sub => getSubDivisionNums(sub).join(', ') },
  { key: 'division_names', label: 'Division Names', value: sub => getSubDivisionNames(sub).join(', ') },
  { key: 'address', label: 'Street Address', value: sub => sub.address || '' },
  { key: 'city', label: 'City', value: sub => sub.city || '' },
  { key: 'state', label: 'State', value: sub => sub.state || '' },
  { key: 'zip', label: 'ZIP', value: sub => sub.zip || '' },
  { key: 'website', label: 'Website', value: sub => sub.website || '' },
  { key: 'contact_name', label: 'Contact Name', value: sub => sub.contact_name || '' },
  { key: 'contact_phone', label: 'Contact Phone', value: sub => sub.contact_phone || '' },
  { key: 'contact_email', label: 'Contact Email', value: sub => sub.contact_email || '' },
  { key: 'notes', label: 'Notes', value: sub => sub.notes || '' },
  { key: 'lat', label: 'Latitude', value: sub => sub.lat ?? '' },
  { key: 'lng', label: 'Longitude', value: sub => sub.lng ?? '' },
  { key: 'created_at', label: 'Created At', value: sub => sub.created_at || '' },
];

const divColorMap = {};

// ── Init ───────────────────────────────────────────────────
async function init() {
  await loadDivisions();
  try {
    await ensureCountyFeaturesLoaded();
  } catch (err) {
    console.warn('County features could not be preloaded:', err.message);
  }
  await loadSubs();
  state.exportColumns = EXPORT_FIELDS.map(field => field.key);
  setupTabs();
  setupFilters();
  setupModal();
  setupConfirmModal();
  setupExportModal();
  setupRecentProjectAddressUi();
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

  renderGlobalDivisionFilterMenu();
  selectAllDivisions();

  setDivisionSelections([state.divisions[0]?.num].filter(Boolean));
}

async function loadSubs() {
  state.subs = await api('GET', '/api/subcontractors');
  renderList();
  renderDataTab();
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
  const divisionFilter = document.getElementById('globalDivisionFilter');
  if (divisionFilter) {
    let closeTimer = null;
    const scheduleClose = () => {
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = setTimeout(() => {
        if (!divisionFilter.matches(':hover')) {
          divisionFilter.open = false;
        }
      }, 120);
    };
    const cancelClose = () => {
      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
      }
    };

    divisionFilter.addEventListener('mouseenter', cancelClose);
    divisionFilter.addEventListener('mouseleave', scheduleClose);

    document.addEventListener('click', (e) => {
      if (!divisionFilter.open) return;
      if (!(e.target instanceof Node)) return;
      if (!divisionFilter.contains(e.target)) {
        divisionFilter.open = false;
      }
    });
  }

  document.getElementById('globalDivisionFilterMenu').addEventListener('change', (e) => {
    if (!(e.target instanceof HTMLInputElement) || e.target.type !== 'checkbox') return;
    if (e.target.dataset.action === 'all') {
      selectAllDivisions();
    } else if (e.target.dataset.action === 'none') {
      clearDivisionSelection();
    } else {
      const divNum = e.target.value;
      if (e.target.checked) {
        if (!state.filter.divisions.includes(divNum)) state.filter.divisions.push(divNum);
      } else {
        state.filter.divisions = state.filter.divisions.filter((num) => num !== divNum);
      }
      const allSelected = state.filter.divisions.length === state.divisions.length;
      state.filter.divisionMode = allSelected ? 'all' : (state.filter.divisions.length ? 'some' : 'none');
      syncDivisionFilterUi();
    }
    renderList();
    if (state.mapReady) renderPins();
    renderDataTab();
  });

  document.getElementById('searchInput').addEventListener('input', e => {
    state.filter.search = e.target.value.toLowerCase();
    renderList();
  });

  document.getElementById('notesSearchInput').addEventListener('input', e => {
    state.filter.notesSearch = e.target.value.toLowerCase();
    renderList();
  });
  document.getElementById('mapSearchInput').addEventListener('input', e => {
    state.filter.mapSearch = e.target.value.toLowerCase();
    if (state.mapReady) renderPins();
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

  if (state.filter.divisionMode === 'none') return [];

  if (state.filter.divisionMode !== 'all' && state.filter.divisions.length) {
    list = list.filter((s) => getSubDivisionNums(s).some((num) => state.filter.divisions.includes(num)));
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

  if (state.filter.notesSearch) {
    const notesQuery = state.filter.notesSearch;
    list = list.filter((s) => (s.notes || '').toLowerCase().includes(notesQuery));
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

function renderGlobalDivisionFilterMenu() {
  const menu = document.getElementById('globalDivisionFilterMenu');
  menu.innerHTML = '';
  const rows = [
    { label: 'All', value: '__all__', action: 'all' },
    { label: 'None', value: '__none__', action: 'none' },
  ];

  rows.forEach((row) => {
    menu.appendChild(buildDivisionFilterOption(row.label, row.value, row.action));
  });

  state.divisions.forEach((d) => {
    menu.appendChild(buildDivisionFilterOption(`Div ${d.num} — ${d.name}`, d.num));
  });
}

function buildDivisionFilterOption(label, value, action = '') {
  const row = document.createElement('label');
  row.className = 'division-filter-item';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.value = value;
  if (action) checkbox.dataset.action = action;
  const text = document.createElement('span');
  text.textContent = label;
  row.appendChild(checkbox);
  row.appendChild(text);
  return row;
}

function selectAllDivisions() {
  state.filter.divisions = state.divisions.map((d) => d.num);
  state.filter.divisionMode = 'all';
  syncDivisionFilterUi();
}

function clearDivisionSelection() {
  state.filter.divisions = [];
  state.filter.divisionMode = 'none';
  syncDivisionFilterUi();
}

function syncDivisionFilterUi() {
  const allSelected = state.divisions.length > 0 && state.filter.divisions.length === state.divisions.length;
  const noneSelected = state.filter.divisionMode === 'none';

  document.querySelectorAll('#globalDivisionFilterMenu input[type="checkbox"]').forEach((input) => {
    if (input.dataset.action === 'all') input.checked = allSelected;
    else if (input.dataset.action === 'none') input.checked = noneSelected;
    else input.checked = state.filter.divisions.includes(input.value);
  });

  const summary = document.getElementById('globalDivisionFilterSummary');
  if (noneSelected) {
    summary.textContent = 'No Divisions';
  } else if (allSelected) {
    summary.textContent = 'All Divisions';
  } else {
    summary.textContent = `${state.filter.divisions.length} Division${state.filter.divisions.length === 1 ? '' : 's'} Selected`;
  }
}

function updateBadge() {
  document.getElementById('subCount').textContent = state.subs.length;
}

function renderDataTab() {
  renderDivisionData();
  renderCountyData();
}

function renderDivisionData() {
  const rows = state.divisions.map((division) => {
    const members = state.subs
      .filter((sub) => getSubDivisionNums(sub).includes(division.num))
      .map((sub) => ({ id: sub._id, name: sub.company_name || 'Unnamed contractor' }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      key: division.num,
      label: `Div ${division.num} — ${division.name}`,
      count: members.length,
      members,
    };
  }).filter((row) => row.count > 0).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  document.getElementById('divisionDataSummary').textContent = `${state.subs.length} contractors total`;
  renderDataTable('divisionDataTable', 'Division', rows);
  renderDataChart('divisionDataChart', rows, 'No division chart data yet.');
}

function renderCountyData() {
  const map = new Map();
  state.subs.forEach((sub) => {
    const county = getSubCounty(sub);
    if (!map.has(county)) map.set(county, []);
    map.get(county).push({ id: sub._id, name: sub.company_name || 'Unnamed contractor' });
  });
  const rows = [...map.entries()]
    .map(([label, members]) => ({
      key: label,
      label,
      count: members.length,
      members: [...members].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  document.getElementById('countyDataSummary').textContent = `${rows.length} counties represented`;
  renderDataTable('countyDataTable', 'County', rows);
  renderDataChart('countyDataChart', rows, 'No county chart data yet.');
}

function renderDataTable(containerId, headerLabel, rows) {
  const container = document.getElementById(containerId);
  if (!rows.length) {
    container.innerHTML = '<div class="data-empty">No data available yet.</div>';
    return;
  }
  const tableRows = rows.map((row) => {
    const memberItems = row.members.length
      ? row.members.map((member) => `
        <li>
          <button
            type="button"
            class="sub-link-btn"
            data-sub-id="${escAttr(member.id)}"
          >${escHtml(member.name)}</button>
        </li>
      `).join('')
      : '<li>No contractors found.</li>';

    return `
      <tr class="expandable-row" data-key="${escAttr(row.key)}" aria-expanded="false">
        <td>${escHtml(row.label)}</td>
        <td>${row.count}</td>
      </tr>
      <tr class="expanded-content-row" data-parent-key="${escAttr(row.key)}">
        <td colspan="2">
          <div class="expanded-content-wrap">
            <div class="expanded-content-title">Contractors in ${escHtml(row.label)} (${row.count})</div>
            <ul class="expanded-sub-list">${memberItems}</ul>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <table class="data-table">
      <thead><tr><th>${escHtml(headerLabel)}</th><th>Contractors</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
  `;

  let expandedKey = null;
  container.querySelectorAll('tbody tr.expandable-row').forEach((tableRow) => {
    tableRow.addEventListener('click', (event) => {
      if (event.target instanceof HTMLElement && event.target.closest('.sub-link-btn')) return;
      const nextKey = tableRow.dataset.key;
      expandedKey = expandedKey === nextKey ? null : nextKey;

      container.querySelectorAll('tbody tr.expandable-row').forEach((rowEl) => {
        const isExpanded = rowEl.dataset.key === expandedKey;
        rowEl.classList.toggle('selected', isExpanded);
        rowEl.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
      });

      container.querySelectorAll('tbody tr.expanded-content-row').forEach((detailRow) => {
        detailRow.classList.toggle('is-open', detailRow.dataset.parentKey === expandedKey);
      });
    });
  });

  container.querySelectorAll('.sub-link-btn[data-sub-id]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      openEditModal(button.dataset.subId);
    });
  });
}

function renderDataChart(containerId, rows, emptyMessage) {
  const container = document.getElementById(containerId);
  if (!rows.length) {
    container.innerHTML = `<div class="data-empty">${escHtml(emptyMessage)}</div>`;
    return;
  }

  const maxCount = Math.max(...rows.map((row) => row.count), 1);
  const bars = rows.map((row) => {
    const pct = Math.max((row.count / maxCount) * 100, 4);
    return `
      <div class="chart-row">
        <div class="chart-label" title="${escAttr(row.label)}">${escHtml(row.label)}</div>
        <div class="chart-track">
          <div class="chart-bar" style="width:${pct}%">${row.count}</div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <h4>Contractor Count Chart</h4>
    <div class="data-chart-rows">${bars}</div>
  `;
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

// ── Export Workbook ───────────────────────────────────────
function setupExportModal() {
  document.getElementById('btnExportSubs').addEventListener('click', openExportModal);
  document.getElementById('exportClose').addEventListener('click', closeExportModal);
  document.getElementById('exportCancel').addEventListener('click', closeExportModal);
  document.getElementById('exportRun').addEventListener('click', runExcelExport);
  document.getElementById('exportModal').querySelector('.modal-backdrop').addEventListener('click', closeExportModal);
}

function openExportModal() {
  renderExportFields();
  document.getElementById('exportModal').classList.remove('hidden');
}

function closeExportModal() {
  document.getElementById('exportModal').classList.add('hidden');
}

function renderExportFields() {
  const list = document.getElementById('exportFieldsList');
  list.innerHTML = '';

  state.exportColumns.forEach((fieldKey, index) => {
    const field = EXPORT_FIELDS.find(item => item.key === fieldKey);
    if (!field) return;

    const row = document.createElement('div');
    row.className = 'export-field-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.dataset.key = field.key;
    checkbox.addEventListener('change', () => toggleExportField(field.key, checkbox.checked));

    const label = document.createElement('label');
    label.textContent = field.label;
    label.htmlFor = '';

    const moveControls = document.createElement('div');
    moveControls.className = 'export-move-controls';
    const upBtn = document.createElement('button');
    upBtn.className = 'btn btn-ghost btn-sm';
    upBtn.type = 'button';
    upBtn.textContent = '↑';
    upBtn.disabled = index === 0;
    upBtn.addEventListener('click', () => moveExportField(field.key, -1));

    const downBtn = document.createElement('button');
    downBtn.className = 'btn btn-ghost btn-sm';
    downBtn.type = 'button';
    downBtn.textContent = '↓';
    downBtn.disabled = index === state.exportColumns.length - 1;
    downBtn.addEventListener('click', () => moveExportField(field.key, 1));

    moveControls.appendChild(upBtn);
    moveControls.appendChild(downBtn);
    row.appendChild(checkbox);
    row.appendChild(label);
    row.appendChild(moveControls);
    list.appendChild(row);
  });

  // Render unselected fields at bottom so users can add them back.
  EXPORT_FIELDS
    .filter(field => !state.exportColumns.includes(field.key))
    .forEach((field) => {
      const row = document.createElement('div');
      row.className = 'export-field-row';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = false;
      checkbox.addEventListener('change', () => toggleExportField(field.key, checkbox.checked));

      const label = document.createElement('label');
      label.textContent = field.label;

      row.appendChild(checkbox);
      row.appendChild(label);
      row.appendChild(document.createElement('div'));
      list.appendChild(row);
    });
}

function toggleExportField(fieldKey, shouldInclude) {
  const hasField = state.exportColumns.includes(fieldKey);
  if (shouldInclude && !hasField) state.exportColumns.push(fieldKey);
  if (!shouldInclude && hasField) state.exportColumns = state.exportColumns.filter(k => k !== fieldKey);
  renderExportFields();
}

function moveExportField(fieldKey, offset) {
  const idx = state.exportColumns.indexOf(fieldKey);
  if (idx < 0) return;
  const next = idx + offset;
  if (next < 0 || next >= state.exportColumns.length) return;
  [state.exportColumns[idx], state.exportColumns[next]] = [state.exportColumns[next], state.exportColumns[idx]];
  renderExportFields();
}

function runExcelExport() {
  if (!window.XLSX) {
    window.alert('Excel export library did not load. Refresh and try again.');
    return;
  }

  if (!state.exportColumns.length) {
    window.alert('Choose at least one column to export.');
    return;
  }

  const selectedFields = state.exportColumns
    .map(key => EXPORT_FIELDS.find(field => field.key === key))
    .filter(Boolean);

  const workbook = XLSX.utils.book_new();
  const masterRows = buildExportRows(state.subs, selectedFields);
  const masterSheet = XLSX.utils.json_to_sheet(masterRows, {
    header: selectedFields.map(field => field.label),
  });
  XLSX.utils.book_append_sheet(workbook, masterSheet, 'Master');

  state.divisions.forEach((division) => {
    const divisionSubs = state.subs.filter(sub => getSubDivisionNums(sub).includes(division.num));
    if (!divisionSubs.length) return;
    const divisionRows = buildExportRows(divisionSubs, selectedFields);
    const divisionSheet = XLSX.utils.json_to_sheet(divisionRows, {
      header: selectedFields.map(field => field.label),
    });
    XLSX.utils.book_append_sheet(workbook, divisionSheet, buildSheetName(division));
  });

  const dateStamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `subcontractors-export-${dateStamp}.xlsx`);
  closeExportModal();
}

function buildExportRows(subs, selectedFields) {
  return subs.map((sub) => {
    const row = {};
    selectedFields.forEach((field) => {
      row[field.label] = field.value(sub);
    });
    return row;
  });
}

function buildSheetName(division) {
  const raw = `${division.num} ${division.name}`;
  return raw.replace(/[\\/?*[\]:]/g, '').slice(0, 31);
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

function getRecentProjectPinAddresses() {
  const storage = getLocalStorageSafe();
  if (!storage) return [];

  try {
    const parsed = JSON.parse(storage.getItem(RECENT_PROJECT_PINS_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value) => typeof value === 'string' && value.trim()).slice(0, MAX_RECENT_PROJECT_PINS);
  } catch (err) {
    return [];
  }
}

function saveRecentProjectPinAddress(address) {
  const next = String(address || '').trim();
  if (!next) return;
  const existing = getRecentProjectPinAddresses();
  const deduped = [next, ...existing.filter((item) => item.toLowerCase() !== next.toLowerCase())];
  const storage = getLocalStorageSafe();
  if (!storage) return;

  try {
    storage.setItem(RECENT_PROJECT_PINS_KEY, JSON.stringify(deduped.slice(0, MAX_RECENT_PROJECT_PINS)));
  } catch (err) {
    return;
  }

  renderRecentProjectAddressOptions();
}

function renderRecentProjectAddressOptions() {
  const select = document.getElementById('recentProjectAddressSelect');
  const datalist = document.getElementById('recentProjectAddresses');
  if (!select || !datalist) return;

  const recent = getRecentProjectPinAddresses();
  select.innerHTML = '<option value="">Recent pinned addresses…</option>';
  datalist.innerHTML = '';

  recent.forEach((address) => {
    const option = document.createElement('option');
    option.value = address;
    option.textContent = address;
    select.appendChild(option);

    const dataOption = document.createElement('option');
    dataOption.value = address;
    datalist.appendChild(dataOption);
  });
}

function setupRecentProjectAddressUi() {
  renderRecentProjectAddressOptions();
  const select = document.getElementById('recentProjectAddressSelect');
  const addressInput = document.getElementById('projectPinAddress');
  if (!select || !addressInput) return;

  select.addEventListener('change', () => {
    if (!select.value) return;
    addressInput.value = select.value;
    select.value = '';
    addressInput.focus();
  });
}

function setupTempPinControls() {
  const btnAdd = document.getElementById('btnAddProjectPin');
  const btnClear = document.getElementById('btnClearProjectPin');
  if (!btnAdd || !btnClear) return;

  btnAdd.addEventListener('click', addTemporaryProjectPin);
  btnClear.addEventListener('click', clearTemporaryProjectPin);
}

async function addTemporaryProjectPin() {
  if (!state.mapLeaflet) return;
  const address = document.getElementById('projectPinAddress').value.trim();
  const coordsRaw = document.getElementById('projectPinCoords').value.trim();

  let lat = NaN;
  let lng = NaN;

  if (address) {
    try {
      const geo = await api('POST', '/api/geocode-address', { address });
      lat = parseFloat(geo.lat);
      lng = parseFloat(geo.lng);
      setProjectPinStatus('Pinned from address.', 'ok');
      saveRecentProjectPinAddress(address);
    } catch (err) {
      // fall through to coordinate parsing
    }
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    const parsed = parseLatLng(coordsRaw);
    lat = parsed[0];
    lng = parsed[1];
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      setProjectPinStatus(address ? 'Address failed; used coordinates fallback.' : 'Pinned from coordinates.', 'warn');
    }
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    setProjectPinStatus('Enter a valid address or coordinates (lat, lng).', 'error');
    return;
  }

  placeTemporaryProjectPin(lat, lng, address || coordsRaw || 'Temporary Pin');
}

function placeTemporaryProjectPin(lat, lng, label) {
  if (!state.mapLeaflet) return;
  if (state.tempPinMarker && state.mapLeaflet.hasLayer(state.tempPinMarker)) {
    state.mapLeaflet.removeLayer(state.tempPinMarker);
  }

  state.tempPinMarker = L.marker([lat, lng], {
    title: 'Temporary Project Pin',
  }).addTo(state.mapLeaflet);
  state.tempPinMarker.bindPopup(`
    <div>
      <strong>Temporary Project Pin</strong><br>
      ${escHtml(label)}<br>
      ${lat.toFixed(6)}, ${lng.toFixed(6)}
    </div>
  `);
  state.tempPinMarker.openPopup();
  state.mapLeaflet.setView([lat, lng], Math.max(state.mapLeaflet.getZoom(), 11));
}

function clearTemporaryProjectPin() {
  if (state.tempPinMarker && state.mapLeaflet && state.mapLeaflet.hasLayer(state.tempPinMarker)) {
    state.mapLeaflet.removeLayer(state.tempPinMarker);
  }
  state.tempPinMarker = null;
  document.getElementById('projectPinAddress').value = '';
  document.getElementById('projectPinCoords').value = '';
  setProjectPinStatus('Temporary pin cleared.', 'ok');
}

function setProjectPinStatus(message, type = 'ok') {
  const el = document.getElementById('projectPinStatus');
  if (!el) return;
  el.textContent = message;
  el.dataset.type = type;
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
  const countyToggle = document.getElementById('showCountyBorders');
  radiusSlider.value = String(state.coverageRadiusMiles);
  radiusToggle.checked = state.showCoverageRadius;
  radiusSlider.disabled = !state.showCoverageRadius;
  countyToggle.checked = state.showCountyBorders;
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
  countyToggle.addEventListener('change', async () => {
    state.showCountyBorders = countyToggle.checked;
    await syncCountyBordersLayer();
  });
  setupTempPinControls();

  await loadBoundaryCatalog();
  renderBoundaryList();
  await syncCountyBordersLayer();

  map.on('popupopen', (event) => {
    const popupEl = event.popup?.getElement();
    if (!popupEl) return;
    const editBtn = popupEl.querySelector('.map-popup-edit-btn[data-sub-id]');
    if (!editBtn) return;
    editBtn.addEventListener('click', () => {
      const subId = editBtn.getAttribute('data-sub-id');
      if (subId) openEditModal(subId);
    }, { once: true });
  });

  map.on('zoomend moveend', () => {
    hideMapHoverTooltip();
  });
  state.mapReady = true;
  renderPins();
}


async function syncCountyBordersLayer() {
  if (!state.mapLeaflet) return;

  if (!state.showCountyBorders) {
    if (state.mapCountyLayer && state.mapLeaflet.hasLayer(state.mapCountyLayer)) {
      state.mapLeaflet.removeLayer(state.mapCountyLayer);
    }
    return;
  }

  if (!state.countyBordersLoaded) {
    try {
      await ensureCountyFeaturesLoaded();
      state.mapCountyLayer = L.geoJSON({
        type: 'FeatureCollection',
        features: state.countyFeatures,
      }, {
        style: {
          color: '#5f6f8f',
          weight: 1,
          opacity: 0.9,
          fillOpacity: 0,
          interactive: false,
        },
      });
      state.countyBordersLoaded = true;
    } catch (err) {
      state.showCountyBorders = false;
      const countyToggle = document.getElementById('showCountyBorders');
      if (countyToggle) countyToggle.checked = false;
      console.error(err);
      window.alert('Could not load county borders right now.');
      return;
    }
  }

  if (state.mapCountyLayer && !state.mapLeaflet.hasLayer(state.mapCountyLayer)) {
    state.mapCountyLayer.addTo(state.mapLeaflet);
    state.mapCountyLayer.bringToBack();
  }
}

async function ensureCountyFeaturesLoaded() {
  if (state.countyFeatures.length) return state.countyFeatures;
  if (state.countyFeaturesPromise) return state.countyFeaturesPromise;

  state.countyFeaturesPromise = fetch(COUNTY_GEOJSON_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`County boundary request failed (${res.status})`);
      return res.json();
    })
    .then((geojson) => {
      state.countyFeatures = (geojson.features || []).filter((feature) => String(feature.id || '').startsWith('39'));
      return state.countyFeatures;
    })
    .finally(() => {
      state.countyFeaturesPromise = null;
    });

  return state.countyFeaturesPromise;
}

function renderPins() {
  if (!state.mapReady || !state.mapLeaflet || !state.mapLayerGroup) return;

  const filtered = getMapFilteredSubs();
  const coverageMeters = state.coverageRadiusMiles * 1609.34;
  state.mapLayerGroup.clearLayers();
  state.mapPinLookup.clear();
  state.highlightedPinId = null;

  // Update sidebar stats
  const visibleCounties = new Set();

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
      ${escHtml([sub.city, sub.state].filter(Boolean).join(', '))}<br>
      <em>Click pin for more info</em>
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

    let coverageCircle = null;
    if (state.showCoverageRadius) {
      coverageCircle = L.circle([sub.lat, sub.lng], {
        radius: coverageMeters,
        ...getCoverageRingStyle(color),
        interactive: false,
      }).addTo(state.mapLayerGroup);
    }

    state.mapPinLookup.set(sub._id, { marker, baseColor: color, coverageCircle });
    marker.on('mouseover', (evt) => {
      setMapPinHighlight(sub._id);
      showMapHoverTooltip(sub, evt.originalEvent);
    });
    marker.on('mousemove', (evt) => {
      showMapHoverTooltip(sub, evt.originalEvent);
    });
    marker.on('mouseout', () => {
      setMapPinHighlight(null);
      hideMapHoverTooltip();
    });

    visibleCounties.add(getSubCounty(sub).toLowerCase());
  });

  // Update sidebar stats
  document.getElementById('mapSubCount').textContent = filtered.length;
  document.getElementById('mapCountyCount').textContent = visibleCounties.size;

  // Update legend
  renderMapLegend(filtered);

  // Update pin list
  renderMapPinList(filtered);
}

function getMapFilteredSubs() {
  let list = getFilteredSubs().filter(s => s.lat && s.lng);
  if (!state.filter.mapSearch) return list;
  const q = state.filter.mapSearch;
  return list.filter((s) =>
    (s.company_name || '').toLowerCase().includes(q) ||
    (s.city || '').toLowerCase().includes(q) ||
    (s.contact_name || '').toLowerCase().includes(q) ||
    (s.division_name || '').toLowerCase().includes(q)
  );
}

async function loadBoundaryCatalog() {
  try {
    state.boundaryCatalog = await api('GET', '/api/boundaries');
  } catch (err) {
    console.warn('Could not load custom boundary catalog:', err.message);
    state.boundaryCatalog = [];
  }
}

function renderBoundaryList() {
  const container = document.getElementById('mapBoundaryList');
  if (!container) return;
  container.innerHTML = '';

  if (!state.boundaryCatalog.length) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:11px;">No custom boundary files found in /public/boundaries.</div>';
    return;
  }

  state.boundaryCatalog.forEach((item) => {
    const row = document.createElement('label');
    row.className = 'map-boundary-item';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.activeBoundaryIds.has(item.id);
    checkbox.addEventListener('change', async () => {
      if (checkbox.checked) {
        await addBoundaryLayer(item);
      } else {
        removeBoundaryLayer(item.id);
      }
    });
    const text = document.createElement('span');
    text.textContent = item.name;
    row.appendChild(checkbox);
    row.appendChild(text);
    container.appendChild(row);
  });
}

async function addBoundaryLayer(item) {
  if (!state.mapLeaflet || state.boundaryLayers.has(item.id)) return;
  try {
    const res = await fetch(item.url);
    if (!res.ok) throw new Error(`Boundary load failed (${res.status})`);
    const geojson = await res.json();
    const layer = L.geoJSON(geojson, {
      style: buildBoundaryStyle(0),
      pointToLayer: (feature, latlng) => {
        const label = getBoundaryFeatureLabel(feature);
        return L.marker(latlng, {
          icon: L.divIcon({
            className: 'boundary-point-label-wrap',
            html: `<div class="boundary-point-label">${escHtml(label)}</div>`,
            iconSize: null,
            iconAnchor: [0, 0],
          }),
          keyboard: false,
        });
      },
      onEachFeature: (feature, featureLayer) => {
        const name = getBoundaryFeatureLabel(feature);
        if (name) featureLayer.bindTooltip(String(name), { sticky: true });
      },
    }).addTo(state.mapLeaflet);
    state.boundaryLayers.set(item.id, layer);
    state.activeBoundaryIds.add(item.id);
    applyBoundaryLayerStyles();
  } catch (err) {
    console.error(err);
    window.alert(`Could not load boundary "${item.name}".`);
    state.activeBoundaryIds.delete(item.id);
    renderBoundaryList();
  }
}

function removeBoundaryLayer(boundaryId) {
  const layer = state.boundaryLayers.get(boundaryId);
  if (layer && state.mapLeaflet && state.mapLeaflet.hasLayer(layer)) {
    state.mapLeaflet.removeLayer(layer);
  }
  state.boundaryLayers.delete(boundaryId);
  state.activeBoundaryIds.delete(boundaryId);
  applyBoundaryLayerStyles();
}

function applyBoundaryLayerStyles() {
  const orderedIds = [...state.activeBoundaryIds];
  orderedIds.forEach((boundaryId, index) => {
    const layer = state.boundaryLayers.get(boundaryId);
    if (layer && typeof layer.setStyle === 'function') {
      layer.setStyle(buildBoundaryStyle(index));
    }
  });
}

function buildBoundaryStyle(colorIndex = 0) {
  const color = BOUNDARY_STROKE_COLORS[colorIndex] || BOUNDARY_STROKE_COLORS[BOUNDARY_STROKE_COLORS.length - 1];
  return {
    color,
    weight: 3.5,
    opacity: 1,
    fillOpacity: 0.01,
  };
}

function getBoundaryFeatureLabel(feature) {
  const props = feature?.properties || {};
  const name = props.name || props.NAME || props.label || props.LABEL || 'Label';
  const labelType = props.label_type || props.labelType || props.TYPE || '';
  return labelType ? `${name} (${labelType})` : name;
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
    item.addEventListener('mouseenter', (evt) => showMapHoverTooltip(sub, evt));
    item.addEventListener('mousemove', (evt) => showMapHoverTooltip(sub, evt));
    item.addEventListener('mouseleave', hideMapHoverTooltip);
    container.appendChild(item);
  });
}

function getCoverageRingStyle(color, highlighted = false) {
  if (highlighted) {
    return {
      color: COVERAGE_RING_HOVER_COLOR,
      weight: 3,
      opacity: 1,
      fillColor: color,
      fillOpacity: 0.08,
    };
  }

  return {
    color,
    weight: 1,
    opacity: 0.45,
    fillColor: color,
    fillOpacity: 0.08,
  };
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
    if (previousPin.coverageCircle) {
      previousPin.coverageCircle.setStyle(getCoverageRingStyle(previousPin.baseColor));
    }
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
  if (pin.coverageCircle) {
    pin.coverageCircle.setStyle(getCoverageRingStyle(pin.baseColor, true));
    pin.coverageCircle.bringToFront();
  }
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
      <button type="button" class="btn btn-sm btn-ghost map-popup-edit-btn" data-sub-id="${escAttr(sub._id)}" style="margin-top:8px;">Edit Full Details</button>
    </div>
  `;
}

function buildMapHoverTooltipHtml(sub) {
  const cityState = [sub.city, sub.state].filter(Boolean).join(', ');
  return `
    <strong>${escHtml(sub.company_name)}</strong>
    <div class="tt-div">${renderDivisionTooltip(sub)}</div>
    ${cityState ? `<div class="tt-addr">${escHtml(cityState)}</div>` : ''}
    <div class="tt-tip">Click pin for more info</div>
  `;
}

function showMapHoverTooltip(sub, event) {
  const tooltip = document.getElementById('mapTooltip');
  if (!tooltip) return;
  tooltip.innerHTML = buildMapHoverTooltipHtml(sub);
  tooltip.style.display = 'block';

  const mapArea = document.getElementById('map-area');
  const mapAreaRect = mapArea.getBoundingClientRect();
  const pageX = event?.clientX ?? (mapAreaRect.left + 20);
  const pageY = event?.clientY ?? (mapAreaRect.top + 20);
  const left = Math.min(pageX - mapAreaRect.left + 14, mapArea.clientWidth - tooltip.offsetWidth - 8);
  const top = Math.min(pageY - mapAreaRect.top + 14, mapArea.clientHeight - tooltip.offsetHeight - 8);
  tooltip.style.left = `${Math.max(8, left)}px`;
  tooltip.style.top = `${Math.max(8, top)}px`;
}

function hideMapHoverTooltip() {
  const tooltip = document.getElementById('mapTooltip');
  if (!tooltip) return;
  tooltip.style.display = 'none';
}

function getSubDivisionNums(sub) {
  if (Array.isArray(sub.division_nums) && sub.division_nums.length) return sub.division_nums;
  return sub.division_num ? [sub.division_num] : [];
}

function getSubDivisionNames(sub) {
  const nums = getSubDivisionNums(sub);
  return nums.map((num) => {
    const div = state.divisions.find(d => d.num === num);
    return div?.name || '';
  }).filter(Boolean);
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

function getSubCounty(sub) {
  const county = (sub.county || '').trim();
  if (county) return county.toLowerCase().endsWith('county') ? county : `${county} County`;
  const inferredCounty = inferCountyFromCoordinates(sub.lat, sub.lng);
  if (inferredCounty) return inferredCounty;
  return 'Unknown';
}

function inferCountyFromCoordinates(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !state.countyFeatures.length) return '';
  const point = [lng, lat];
  for (const feature of state.countyFeatures) {
    if (geometryContainsPoint(feature.geometry, point)) {
      return formatCountyName(feature.properties?.NAME || feature.properties?.name || '');
    }
  }
  return '';
}

function geometryContainsPoint(geometry, point) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') {
    return polygonContainsPoint(geometry.coordinates, point);
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((polygon) => polygonContainsPoint(polygon, point));
  }
  return false;
}

function polygonContainsPoint(rings, point) {
  if (!Array.isArray(rings) || !rings.length) return false;
  if (!ringContainsPoint(rings[0], point)) return false;
  for (let i = 1; i < rings.length; i += 1) {
    if (ringContainsPoint(rings[i], point)) return false;
  }
  return true;
}

function ringContainsPoint(ring, point) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects = ((yi > point[1]) !== (yj > point[1]))
      && (point[0] < ((xj - xi) * (point[1] - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function formatCountyName(rawName) {
  const name = String(rawName || '').trim();
  if (!name) return '';
  return name.toLowerCase().endsWith('county') ? name : `${name} County`;
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
