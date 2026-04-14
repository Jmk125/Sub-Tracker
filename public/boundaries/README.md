# Custom map boundaries

Drop any `.geojson` or `.json` GeoJSON file in this folder.

The map tab will automatically show each file as a checkbox under **Boundaries**.

## Tips
- Use EPSG:4326 coordinates (longitude, latitude) for GeoJSON.
- `Polygon` and `MultiPolygon` are both supported.
- Optional feature property names:
  - `name`
  - `NAME`
  - `label_type` (optional suffix shown in parentheses)

If present, the name is shown as a tooltip on hover.

Point features are rendered as text label boxes on the map (instead of default map pins).
