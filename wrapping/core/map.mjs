// Country-neutral map settings. A country changes where maps open, how far they zoom, the service
// area and the map provider by editing profile.map only.
const DEFAULTS = { zoom: 11, provider: 'leaflet-osm', tileUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png' }

export function mapSettings(profile) {
  const m = profile?.map
  if (!m?.center || !Number.isFinite(m.center.lat) || !Number.isFinite(m.center.lng)) throw new Error(`country '${profile?.key}' has no map.center`)
  return Object.freeze({ ...DEFAULTS, ...m, bounds: m.bounds ?? profile.rides?.serviceBounds ?? null })
}

// Starting view: the first real point we know, else the country centre.
export function initialView(profile, ...points) {
  const s = mapSettings(profile)
  const p = points.find((x) => x && Number.isFinite(x.lat) && Number.isFinite(x.lng))
  return { center: p ?? s.center, zoom: p ? Math.max(s.zoom, 14) : s.zoom }
}
