const express = require('express');
const Datastore = require('nedb');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const multer = require('multer');

const app = express();
const ENV_PATH = path.join(__dirname, '.env');
if (fs.existsSync(ENV_PATH)) {
  const envText = fs.readFileSync(ENV_PATH, 'utf8');
  envText.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) return;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  });
}
const PORT = parseInt(process.env.PORT || '3007', 10);
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT || '3443', 10);

// Ensure data directory exists
if (!fs.existsSync('./data')) fs.mkdirSync('./data');

// Initialize database
const db = new Datastore({ filename: './data/subcontractors.db', autoload: true });

// CSI MasterFormat Divisions
const CSI_DIVISIONS = [
  { num: '01', name: 'General Requirements' },
  { num: '02', name: 'Existing Conditions' },
  { num: '03', name: 'Concrete' },
  { num: '04', name: 'Masonry' },
  { num: '05', name: 'Metals' },
  { num: '06', name: 'Wood, Plastics, and Composites' },
  { num: '07', name: 'Thermal and Moisture Protection' },
  { num: '08', name: 'Openings' },
  { num: '09A', name: '09 - Metal Studs, Drywall, & Acoustics' },
  { num: '09B', name: '09 - Flooring' },
  { num: '09C', name: '09 - Painting' },
  { num: '10', name: 'Specialties' },
  { num: '11', name: 'Equipment' },
  { num: '12', name: 'Furnishings' },
  { num: '13', name: 'Special Construction' },
  { num: '14', name: 'Conveying Equipment' },
  { num: '21', name: 'Fire Suppression' },
  { num: '22', name: 'Plumbing' },
  { num: '23', name: 'HVAC' },
  { num: '25', name: 'Integrated Automation' },
  { num: '26', name: 'Electrical' },
  { num: '27', name: 'Communications' },
  { num: '28', name: 'Electronic Safety and Security' },
  { num: '31', name: 'Earthwork' },
  { num: '32', name: 'Exterior Improvements' },
  { num: '33', name: 'Utilities' },
  { num: '34', name: 'Transportation' },
  { num: '35', name: 'Waterway and Marine' },
  { num: '40', name: 'Process Integration' },
  { num: '41', name: 'Material Processing and Handling' },
  { num: '48', name: 'Electrical Power Generation' },
];
const BOUNDARY_COLORS = ['#f4d03f', '#3fb0ff', '#ff7f50', '#7ed957', '#f78ff8', '#95a5a6'];

app.use(express.json());
app.use(express.static('public'));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

function extractResponseText(responseJson) {
  if (responseJson && typeof responseJson.output_text === 'string' && responseJson.output_text.trim()) {
    return responseJson.output_text.trim();
  }
  const chunks = [];
  const outputs = Array.isArray(responseJson?.output) ? responseJson.output : [];
  outputs.forEach((item) => {
    const content = Array.isArray(item?.content) ? item.content : [];
    content.forEach((part) => {
      const maybeText = typeof part?.text === 'string' ? part.text : '';
      if (maybeText) chunks.push(maybeText);
    });
  });
  return chunks.join('\n').trim();
}

function safeParseJsonObject(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (innerErr) {
      return null;
    }
  }
}

function extractCountyFromAddress(address) {
  if (!address || typeof address !== 'object') return '';
  const county = address.county || address.state_district || '';
  return String(county || '').replace(/\s+County$/i, '').trim();
}

async function geocodeAddress(fullAddress) {
  if (!fullAddress.trim()) {
    return { lat: null, lng: null, county: '' };
  }

  const geoUrl = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&q=${encodeURIComponent(fullAddress)}&limit=1&countrycodes=us`;
  const geoRes = await fetch(geoUrl, {
    headers: { 'User-Agent': 'SubTrackerApp/1.0 (construction-internal)' }
  });
  const geoData = await geoRes.json();

  if (!Array.isArray(geoData) || geoData.length === 0) {
    return { lat: null, lng: null, county: '' };
  }

  return {
    lat: parseFloat(geoData[0].lat),
    lng: parseFloat(geoData[0].lon),
    county: extractCountyFromAddress(geoData[0].address),
  };
}

// ─── API: Get all divisions ───────────────────────────────────────────────────
app.get('/api/divisions', (req, res) => {
  res.json(CSI_DIVISIONS);
});

app.get('/api/boundaries', (req, res) => {
  const boundaryDir = path.join(__dirname, 'public', 'boundaries');
  if (!fs.existsSync(boundaryDir)) return res.json([]);

  const files = fs.readdirSync(boundaryDir)
    .filter((file) => /\.(geojson|json)$/i.test(file))
    .sort((a, b) => a.localeCompare(b));

  const catalog = files.map((file, index) => {
    const id = file.replace(/\.(geojson|json)$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return {
      id,
      name: file.replace(/\.(geojson|json)$/i, '').replace(/[_-]+/g, ' '),
      url: `/boundaries/${encodeURIComponent(file)}`,
      color: BOUNDARY_COLORS[index % BOUNDARY_COLORS.length],
    };
  });

  res.json(catalog);
});

app.post('/api/geocode-address', async (req, res) => {
  const address = String(req.body?.address || '').trim();
  if (!address) return res.status(400).json({ error: 'Address is required.' });
  try {
    const geo = await geocodeAddress(address);
    if (!Number.isFinite(geo.lat) || !Number.isFinite(geo.lng)) {
      return res.status(404).json({ error: 'Could not geocode that address.' });
    }
    res.json(geo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ai/parse-quote', upload.single('quotePdf'), async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(400).json({ error: 'OPENAI_API_KEY not configured on server.' });
  }
  if (!req.file) return res.status(400).json({ error: 'quotePdf file is required.' });
  try {
    const dataUrl = `data:application/pdf;base64,${req.file.buffer.toString('base64')}`;
    const prompt = 'Extract subcontractor quote contact data. Return ONLY a JSON object with keys: company_name, contact_name, contact_phone, contact_email, address, city, state, zip, notes, division_num. Use empty string when unknown.';
    const aiRes = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4.1',
        input: [
          { role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_file', filename: req.file.originalname, file_data: dataUrl }] }
        ],
      }),
    });
    const aiData = await aiRes.json();
    if (!aiRes.ok) throw new Error(aiData.error?.message || 'OpenAI API request failed');
    const textOut = extractResponseText(aiData);
    const fields = safeParseJsonObject(textOut);
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      return res.status(422).json({
        error: 'AI could not return valid JSON fields for this quote. Please try again or enter fields manually.',
      });
    }
    res.json({ fields });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Get all subcontractors ─────────────────────────────────────────────
app.get('/api/subcontractors', (req, res) => {
  const { division } = req.query;
  const query = division && division !== 'all'
    ? { $or: [{ division_num: division }, { division_nums: division }] }
    : {};
  db.find(query).sort({ company_name: 1 }).exec((err, docs) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(docs.map((doc) => ({
      ...doc,
      labor_type: ['union', 'non_union'].includes(doc.labor_type) ? doc.labor_type : 'unknown',
    })));
  });
});

// ─── API: Add subcontractor ──────────────────────────────────────────────────
app.post('/api/subcontractors', async (req, res) => {
  const { company_name, address, website, city, state, zip, division_num, division_nums, division_name, contact_name, contact_phone, contact_email, contact2_name, contact2_phone, contact2_email, labor_type, notes } = req.body;
  const normalizedDivisionNums = [...new Set((Array.isArray(division_nums) ? division_nums : [division_num]).filter(Boolean))];
  const primaryDivisionNum = normalizedDivisionNums[0];

  if (!company_name || !primaryDivisionNum) {
    return res.status(400).json({ error: 'Company name and division are required.' });
  }

  // Geocode the address
  let lat = null, lng = null, county = '';
  const fullAddress = [address, city, state || 'OH', zip].filter(Boolean).join(', ');
  if (fullAddress.trim()) {
    try {
      const geo = await geocodeAddress(fullAddress);
      lat = geo.lat;
      lng = geo.lng;
      county = geo.county;
    } catch (e) {
      console.warn('Geocoding failed:', e.message);
    }
  }

  const divisionNames = normalizedDivisionNums.map((num) => {
    const info = CSI_DIVISIONS.find(d => d.num === num);
    return info ? info.name : '';
  }).filter(Boolean);
  const divInfo = CSI_DIVISIONS.find(d => d.num === primaryDivisionNum);
  const doc = {
    company_name,
    address,
    website: website || '',
    city,
    state: state || 'OH',
    zip,
    division_num: primaryDivisionNum,
    division_nums: normalizedDivisionNums,
    division_name: divInfo ? divInfo.name : division_name,
    division_names: divisionNames,
    contact_name: contact_name || '',
    contact_phone: contact_phone || '',
    contact_email: contact_email || '',
    contact2_name: contact2_name || '',
    contact2_phone: contact2_phone || '',
    contact2_email: contact2_email || '',
    labor_type: ['union', 'non_union'].includes(labor_type) ? labor_type : 'unknown',
    notes: notes || '',
    lat,
    lng,
    county,
    created_at: new Date().toISOString()
  };

  db.insert(doc, (err, newDoc) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(newDoc);
  });
});

// ─── API: Update subcontractor ───────────────────────────────────────────────
app.put('/api/subcontractors/:id', async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  if (Object.prototype.hasOwnProperty.call(updates, 'labor_type')) {
    updates.labor_type = ['union', 'non_union'].includes(updates.labor_type) ? updates.labor_type : 'unknown';
  }
  if (updates.division_nums || updates.division_num) {
    const normalizedDivisionNums = [...new Set((Array.isArray(updates.division_nums) ? updates.division_nums : [updates.division_num]).filter(Boolean))];
    updates.division_nums = normalizedDivisionNums;
    updates.division_num = normalizedDivisionNums[0] || '';
    updates.division_names = normalizedDivisionNums.map((num) => {
      const info = CSI_DIVISIONS.find(d => d.num === num);
      return info ? info.name : '';
    }).filter(Boolean);
  }

  // Re-geocode if address fields changed
  if (updates.address || updates.city || updates.zip) {
    const fullAddress = [updates.address, updates.city, updates.state || 'OH', updates.zip].filter(Boolean).join(', ');
    try {
      const geo = await geocodeAddress(fullAddress);
      if (Number.isFinite(geo.lat) && Number.isFinite(geo.lng)) {
        updates.lat = geo.lat;
        updates.lng = geo.lng;
      }
      updates.county = geo.county || '';
    } catch (e) {
      console.warn('Geocoding failed:', e.message);
    }
  }

  // Update division name if division_num changed
  if (updates.division_num) {
    const divInfo = CSI_DIVISIONS.find(d => d.num === updates.division_num);
    if (divInfo) updates.division_name = divInfo.name;
  }

  db.update({ _id: id }, { $set: updates }, {}, (err, numReplaced) => {
    if (err) return res.status(500).json({ error: err.message });
    db.findOne({ _id: id }, (err2, doc) => {
      res.json(doc);
    });
  });
});

// ─── API: Delete subcontractor ───────────────────────────────────────────────
app.delete('/api/subcontractors/:id', (req, res) => {
  db.remove({ _id: req.params.id }, {}, (err, numRemoved) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, removed: numRemoved });
  });
});

// ─── API: Re-geocode a specific sub ──────────────────────────────────────────
app.post('/api/subcontractors/:id/geocode', async (req, res) => {
  db.findOne({ _id: req.params.id }, async (err, doc) => {
    if (err || !doc) return res.status(404).json({ error: 'Not found' });
    const fullAddress = [doc.address, doc.city, doc.state || 'OH', doc.zip].filter(Boolean).join(', ');
    try {
      const geo = await geocodeAddress(fullAddress);
      if (Number.isFinite(geo.lat) && Number.isFinite(geo.lng)) {
        db.update({ _id: req.params.id }, { $set: { lat: geo.lat, lng: geo.lng, county: geo.county || '' } }, {}, () => {
          res.json({ lat: geo.lat, lng: geo.lng, county: geo.county || '' });
        });
      } else {
        res.status(404).json({ error: 'Could not geocode address' });
      }
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

function startServers() {
  const certPath = process.env.SSL_CERT_PATH || path.join(__dirname, 'certs', 'localhost.crt');
  const keyPath = process.env.SSL_KEY_PATH || path.join(__dirname, 'certs', 'localhost.key');

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    const credentials = {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
    };

    https.createServer(credentials, app).listen(HTTPS_PORT, '0.0.0.0', () => {
      console.log(`Sub Tracker running at https://localhost:${HTTPS_PORT}`);
    });

    http.createServer((req, res) => {
      const host = req.headers.host ? req.headers.host.split(':')[0] : 'localhost';
      res.writeHead(301, { Location: `https://${host}:${HTTPS_PORT}${req.url}` });
      res.end();
    }).listen(PORT, '0.0.0.0', () => {
      console.log(`HTTP redirect enabled at http://localhost:${PORT} -> https://localhost:${HTTPS_PORT}`);
    });
    return;
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Sub Tracker running at http://localhost:${PORT}`);
    console.log(`HTTPS not enabled. Add cert/key at ${certPath} and ${keyPath} (or set SSL_CERT_PATH/SSL_KEY_PATH).`);
  });
}

startServers();
