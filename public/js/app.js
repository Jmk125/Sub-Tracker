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
  mapProjection: null,
  mapZoom: null,
  mapSvg: null,
  mapG: null,
};

// Division color palette (for map pins)
const DIVISION_COLORS = [
  '#e8a020','#3b7dd8','#27ae60','#9b59b6','#e74c3c',
  '#1abc9c','#f39c12','#2980b9','#8e44ad','#16a085',
  '#d35400','#2ecc71','#c0392b','#2c3e50','#7f8c8d',
  '#e91e63','#00bcd4','#ff5722','#607d8b','#795548',
];

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
  document.getElementById('fCity').value = sub.city || '';
  document.getElementById('fState').value = sub.state || 'OH';
  document.getElementById('fZip').value = sub.zip || '';
  document.getElementById('fContactName').value = sub.contact_name || '';
  document.getElementById('fContactPhone').value = sub.contact_phone || '';
  document.getElementById('fContactEmail').value = sub.contact_email || '';
  document.getElementById('fNotes').value = sub.notes || '';
  hideGeoStatus();
  document.getElementById('modal').classList.remove('hidden');
}

function clearForm() {
  ['fCompanyName','fAddress','fCity','fContactName','fContactPhone','fContactEmail','fNotes'].forEach(id => {
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
    if (state.editingId) {
      await api('PUT', `/api/subcontractors/${state.editingId}`, payload);
    } else {
      await api('POST', '/api/subcontractors', payload);
    }
    await loadSubs();
    closeModal();
  } catch (e) {
    setGeoStatus('error', '❌ ' + e.message);
  } finally {
    document.getElementById('modalSave').disabled = false;
  }
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
    await api('POST', `/api/subcontractors/${id}/geocode`);
    await loadSubs();
  } catch (e) {
    alert('Could not geocode: ' + e.message);
  }
}

// ── MAP ────────────────────────────────────────────────────
async function initMap() {
  const svgEl = document.getElementById('ohioMap');
  const width = svgEl.clientWidth || 900;
  const height = svgEl.clientHeight || 700;

  const svg = d3.select('#ohioMap');
  svg.selectAll('*').remove();

  const g = svg.append('g').attr('class', 'map-root');
  state.mapSvg = svg;
  state.mapG = g;

  // Zoom behavior
  const zoom = d3.zoom()
    .scaleExtent([0.5, 12])
    .on('zoom', (event) => {
      g.attr('transform', event.transform);
    });

  svg.call(zoom);
  state.mapZoom = zoom;

  // Zoom controls
  document.getElementById('btnZoomIn').addEventListener('click', () => {
    svg.transition().call(zoom.scaleBy, 1.5);
  });
  document.getElementById('btnZoomOut').addEventListener('click', () => {
    svg.transition().call(zoom.scaleBy, 1 / 1.5);
  });
  document.getElementById('btnResetZoom').addEventListener('click', () => {
    svg.transition().call(zoom.transform, d3.zoomIdentity);
  });

  // Load Ohio TopoJSON
  let ohioTopo;
  try {
    ohioTopo = await d3.json('https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json');
  } catch (e) {
    console.error('Failed to load TopoJSON:', e);
    g.append('text')
      .attr('x', width / 2).attr('y', height / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', '#7a8496')
      .text('Map data failed to load. Check internet connection.');
    return;
  }

  // Extract Ohio counties (FIPS 39xxx)
  const allCounties = topojson.feature(ohioTopo, ohioTopo.objects.counties);
  const ohioCounties = {
    type: 'FeatureCollection',
    features: allCounties.features.filter(f => f.id && String(f.id).startsWith('39'))
  };

  // Projection fit to Ohio
  const projection = d3.geoAlbersUsa()
    .fitSize([width * 0.85, height * 0.85], ohioCounties);

  // Center the projection output
  const [[x0, y0], [x1, y1]] = d3.geoPath().projection(projection).bounds(ohioCounties);
  const offsetX = (width - (x1 - x0)) / 2 - x0;
  const offsetY = (height - (y1 - y0)) / 2 - y0;

  state.mapProjection = projection;

  const path = d3.geoPath().projection(projection);

  // Draw counties
  const countiesG = g.append('g').attr('class', 'counties').attr('transform', `translate(${offsetX},${offsetY})`);

  countiesG.selectAll('.county-path')
    .data(ohioCounties.features)
    .enter()
    .append('path')
    .attr('class', 'county-path')
    .attr('d', path)
    .attr('data-fips', d => d.id)
    .on('mouseover', function (event, d) {
      d3.select(this).style('fill', '#253560');
    })
    .on('mouseout', function (event, d) {
      const hasSubs = d3.select(this).classed('has-subs');
      d3.select(this).style('fill', hasSubs ? '#1e2d4a' : '#1a2030');
    });

  // Store offset for pin rendering
  state.mapOffset = { x: offsetX, y: offsetY };
  state.mapReady = true;

  renderPins();
}

function renderPins() {
  if (!state.mapReady || !state.mapG) return;

  const filtered = getFilteredSubs().filter(s => s.lat && s.lng);

  // Update sidebar stats
  const countiesWithSubs = new Set();

  // Remove old pins
  state.mapG.selectAll('.pin-group').remove();

  const tooltip = document.getElementById('mapTooltip');
  const mapArea = document.getElementById('map-area');

  // Track which counties have subs
  state.mapG.selectAll('.county-path').classed('has-subs', false);

  const pinsG = state.mapG.append('g').attr('class', 'pins-layer')
    .attr('transform', `translate(${state.mapOffset.x},${state.mapOffset.y})`);

  filtered.forEach(sub => {
    const projected = state.mapProjection([sub.lng, sub.lat]);
    if (!projected) return;

    const [px, py] = projected;
    const primaryDivision = getSubDivisionNums(sub)[0];
    const color = divColorMap[primaryDivision] || '#7a8496';

    const pinG = pinsG.append('g')
      .attr('class', 'pin-group')
      .attr('transform', `translate(${px},${py})`);

    // Outer ring
    pinG.append('circle')
      .attr('class', 'pin-outer')
      .attr('r', 9)
      .attr('stroke', color)
      .attr('fill', 'none')
      .attr('opacity', 0.4);

    // Inner dot
    pinG.append('circle')
      .attr('class', 'pin-inner sub-pin')
      .attr('r', 5)
      .attr('fill', color)
      .attr('stroke', '#0f1114')
      .attr('stroke-width', 1.5)
      .on('mouseover', function (event) {
        d3.select(this).attr('r', 8);
        tooltip.style.display = 'block';
        const addr = [sub.city, sub.state].filter(Boolean).join(', ');
        tooltip.innerHTML = `
          <strong>${escHtml(sub.company_name)}</strong>
          <div class="tt-div">${renderDivisionTooltip(sub)}</div>
          ${addr ? `<div class="tt-addr">📍 ${escHtml(addr)}</div>` : ''}
          ${sub.contact_name ? `<div class="tt-addr">👤 ${escHtml(sub.contact_name)}</div>` : ''}
        `;
      })
      .on('mousemove', function (event) {
        const rect = mapArea.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        tooltip.style.left = (x + 14) + 'px';
        tooltip.style.top = (y - 10) + 'px';
      })
      .on('mouseout', function () {
        d3.select(this).attr('r', 5);
        tooltip.style.display = 'none';
      });
  });

  // Update sidebar stats
  document.getElementById('mapSubCount').textContent = filtered.length;
  document.getElementById('mapCountyCount').textContent = countiesWithSubs.size;

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
    container.appendChild(item);
  });
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

// ── Boot ───────────────────────────────────────────────────
init();
