// Live Q RIDE map — Leaflet + OpenStreetMap tiles: no API key, no per-call cost.
// Request screen: your pickup and the cars available around you (positions blurred by the server,
//   no driver identity). Tapping the map fills the field focused last (pickup by default).
// Live trip: the assigned driver's car, your pickup and destination, refreshed with each poll.
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const MONTREAL = [45.5019, -73.5674]
const fr = () => document.documentElement.lang !== 'en'

const carIcon = (mine) => L.divIcon({
  className: 'qcar',
  iconSize: [34, 34],
  iconAnchor: [17, 17],
  html: `<svg viewBox="0 0 34 34" width="34" height="34" aria-hidden="true"><circle cx="17" cy="17" r="16" fill="${mine ? '#13294b' : '#fff'}" stroke="#13294b" stroke-width="2"/>
    <path d="M10 19.5l1.6-4.6A2 2 0 0 1 13.5 13.5h7a2 2 0 0 1 1.9 1.4l1.6 4.6v3a1 1 0 0 1-1 1h-1.2a1 1 0 0 1-1-1v-.8h-7.6v.8a1 1 0 0 1-1 1H11a1 1 0 0 1-1-1z" fill="${mine ? '#ffd166' : '#13294b'}"/></svg>`,
})
const pinIcon = (label, color) => L.divIcon({
  className: 'qpin', iconSize: [28, 28], iconAnchor: [14, 14],
  html: `<div style="width:28px;height:28px;border-radius:50%;background:${color};color:#fff;display:grid;place-items:center;font:700 13px system-ui;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)">${label}</div>`,
})

let map, layer, nearbyTimer, badge
function reset() {
  clearInterval(nearbyTimer); nearbyTimer = undefined
  map?.remove(); map = undefined; layer = undefined
}

function create(el, center, zoom) {
  el.innerHTML = ''
  el.style.minHeight = '300px'
  map = L.map(el, { zoomControl: false, attributionControl: true }).setView(center, zoom)
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>')
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map)
  L.control.zoom({ position: 'bottomright' }).addTo(map)
  layer = L.layerGroup().addTo(map)
  badge = L.control({ position: 'topleft' })
  badge.onAdd = () => Object.assign(L.DomUtil.create('div', 'qbadge'), { innerHTML: '' })
  badge.addTo(map)
}
const setBadge = (text) => { const el = document.querySelector('.qbadge'); if (el) { el.textContent = text; el.style.display = text ? '' : 'none' } }

// ---- Request screen: cars around the pickup ----
function pickupPoint() {
  const raw = document.getElementById('pickup')?.value ?? ''
  const m = raw.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/)
  if (m) return [Number(m[1]), Number(m[2])]
  const opt = window.qridePlaces?.find(([name]) => name === raw.trim())
  return opt ? [opt[1], opt[2]] : null
}

async function refreshNearby() {
  if (!map) return
  const p = pickupPoint() ?? MONTREAL
  const category = document.getElementById('category')?.value || 'STANDARD'
  try {
    const { count, cars } = await window.qrideApi.get(`/api/rides/nearby?lat=${p[0]}&lng=${p[1]}&category=${encodeURIComponent(category)}`)
    layer.clearLayers()
    if (pickupPoint()) L.marker(p, { icon: pinIcon('A', '#2e7d32') }).addTo(layer)
    for (const c of cars) L.marker([c.lat, c.lng], { icon: carIcon(false), interactive: false }).addTo(layer)
    setBadge(count ? (fr() ? `${count} voiture${count > 1 ? 's' : ''} à proximité` : `${count} car${count > 1 ? 's' : ''} nearby`) : (fr() ? 'Aucune voiture à proximité pour le moment' : 'No cars nearby right now'))
  } catch { setBadge('') }
}

function mountRequest(el) {
  create(el, pickupPoint() ?? MONTREAL, 13)
  map.on('click', (e) => {
    const input = document.getElementById(window.qrideMapTarget || 'pickup')
    if (input) { input.value = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`; input.dispatchEvent(new Event('change')) }
    if ((window.qrideMapTarget || 'pickup') === 'pickup') { map.panTo(e.latlng); refreshNearby() }
  })
  for (const id of ['pickup', 'category']) document.getElementById(id)?.addEventListener('change', () => { const p = pickupPoint(); if (p) map.setView(p, 14); refreshNearby() })
  refreshNearby()
  nearbyTimer = setInterval(refreshNearby, 8000)
}

// ---- Live trip: the driver's car ----
function drawRide(ride) {
  if (!map || !ride) return
  layer.clearLayers()
  const pts = []
  const a = [ride.pickup.lat, ride.pickup.lng]; L.marker(a, { icon: pinIcon('A', '#2e7d32') }).addTo(layer); pts.push(a)
  const b = [ride.dropoff.lat, ride.dropoff.lng]; L.marker(b, { icon: pinIcon('B', '#13294b') }).addTo(layer); pts.push(b)
  const d = ride.driver
  if (d?.lat != null && ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS'].includes(ride.status)) {
    const c = [d.lat, d.lng]; L.marker(c, { icon: carIcon(true) }).addTo(layer); pts.push(c)
    const target = ride.status === 'IN_PROGRESS' ? b : a
    const km = map.distance(c, target) / 1000
    const min = Math.max(1, Math.round((km * 1.3) / 30 * 60)) // road factor 1.3, ~30 km/h in town
    setBadge(ride.status === 'ARRIVED' ? (fr() ? 'Votre chauffeur est arrivé' : 'Your driver has arrived')
      : ride.status === 'IN_PROGRESS' ? (fr() ? `Arrivée dans ≈ ${min} min` : `Arriving in ≈ ${min} min`)
      : (fr() ? `Chauffeur à ≈ ${min} min` : `Driver ≈ ${min} min away`))
  } else setBadge(ride.status === 'REQUESTED' ? (fr() ? 'Recherche d’un chauffeur…' : 'Finding a driver…') : '')
  map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 15 })
}

window.addEventListener('qride:render', () => {
  reset()
  const req = document.getElementById('qrideGoogleMap')
  const live = document.getElementById('liveMap')
  if (req) mountRequest(req)
  else if (live) { create(live, MONTREAL, 13); drawRide(window.qrideRide) }
})
window.addEventListener('qride:ride', (e) => {
  if (!document.getElementById('liveMap')) return
  if (!map) { create(document.getElementById('liveMap'), MONTREAL, 13) }
  drawRide(e.detail)
})
window.addEventListener('qride:location', (e) => { if (map && e.detail) { map.setView([e.detail.lat, e.detail.lng], 15); refreshNearby() } })
window.addEventListener('pagehide', reset)
