# Sub Tracker — Columbus Market Intelligence

Subcontractor database and map tool for tracking the Columbus, OH market.
Runs as a Node.js server on your Raspberry Pi.

## Setup

```bash
# Install dependencies
npm install

# Start the server
npm start
# or: node server.js
```

Access at: http://<pi-ip>:3007

## HTTPS (recommended for clipboard auto-paste)

Clipboard read APIs are more reliable in secure contexts. The server now supports HTTPS if a cert/key are present:

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout certs/localhost.key \
  -out certs/localhost.crt \
  -days 365 \
  -subj "/CN=localhost"
```

Then start normally:

```bash
node server.js
```

- HTTPS URL: `https://<host>:3443`
- HTTP port 3007 will redirect to HTTPS when certs exist.
- Override paths/ports with env vars: `SSL_CERT_PATH`, `SSL_KEY_PATH`, `PORT`, `HTTPS_PORT`.

## Features

- **List Tab**: Add, edit, delete subcontractors with CSI MasterFormat divisions
- **Map Tab**: Ohio county map with color-coded pins per division
- **Global Filter**: Filter by division — updates both list and map
- **Geocoding**: Addresses automatically geocoded via OpenStreetMap Nominatim
- **Search**: Real-time search across name, city, contact fields
- **Sort**: Sort by name, division, city, or date added

## Data

Database stored at `./data/subcontractors.db` (NeDB flat file — no install needed)

## Port

Default: **3007** — change in `server.js` if needed

## Future Ideas (planned)

- Coverage radius heatmap overlay (circular coverage areas with overlap darkening)
- School district boundary layer toggle
- Notes/relationship status tracking
- Export to Excel/CSV
- Contact log / activity history
