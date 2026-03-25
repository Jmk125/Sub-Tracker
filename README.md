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
