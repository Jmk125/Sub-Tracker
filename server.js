const express = require('express');
const Datastore = require('nedb');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3007;

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
  { num: '09', name: 'Finishes' },
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

app.use(express.json());
app.use(express.static('public'));

// ─── API: Get all divisions ───────────────────────────────────────────────────
app.get('/api/divisions', (req, res) => {
  res.json(CSI_DIVISIONS);
});

// ─── API: Get all subcontractors ─────────────────────────────────────────────
app.get('/api/subcontractors', (req, res) => {
  const { division } = req.query;
  const query = division && division !== 'all'
    ? { $or: [{ division_num: division }, { division_nums: division }] }
    : {};
  db.find(query).sort({ company_name: 1 }).exec((err, docs) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(docs);
  });
});

// ─── API: Add subcontractor ──────────────────────────────────────────────────
app.post('/api/subcontractors', async (req, res) => {
  const { company_name, address, city, state, zip, division_num, division_nums, division_name, contact_name, contact_phone, contact_email, notes } = req.body;
  const normalizedDivisionNums = [...new Set((Array.isArray(division_nums) ? division_nums : [division_num]).filter(Boolean))];
  const primaryDivisionNum = normalizedDivisionNums[0];

  if (!company_name || !primaryDivisionNum) {
    return res.status(400).json({ error: 'Company name and division are required.' });
  }

  // Geocode the address
  let lat = null, lng = null;
  const fullAddress = [address, city, state || 'OH', zip].filter(Boolean).join(', ');
  if (fullAddress.trim()) {
    try {
      const geoUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(fullAddress)}&limit=1&countrycodes=us`;
      const geoRes = await fetch(geoUrl, {
        headers: { 'User-Agent': 'SubTrackerApp/1.0 (construction-internal)' }
      });
      const geoData = await geoRes.json();
      if (geoData.length > 0) {
        lat = parseFloat(geoData[0].lat);
        lng = parseFloat(geoData[0].lon);
      }
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
    notes: notes || '',
    lat,
    lng,
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
      const geoUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(fullAddress)}&limit=1&countrycodes=us`;
      const geoRes = await fetch(geoUrl, {
        headers: { 'User-Agent': 'SubTrackerApp/1.0 (construction-internal)' }
      });
      const geoData = await geoRes.json();
      if (geoData.length > 0) {
        updates.lat = parseFloat(geoData[0].lat);
        updates.lng = parseFloat(geoData[0].lon);
      }
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
      const geoUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(fullAddress)}&limit=1&countrycodes=us`;
      const geoRes = await fetch(geoUrl, {
        headers: { 'User-Agent': 'SubTrackerApp/1.0 (construction-internal)' }
      });
      const geoData = await geoRes.json();
      if (geoData.length > 0) {
        const lat = parseFloat(geoData[0].lat);
        const lng = parseFloat(geoData[0].lon);
        db.update({ _id: req.params.id }, { $set: { lat, lng } }, {}, () => {
          res.json({ lat, lng });
        });
      } else {
        res.status(404).json({ error: 'Could not geocode address' });
      }
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Sub Tracker running at http://localhost:${PORT}`);
});
