import { createGoogleMapCapsule } from '../../src/shared/maps/googleMapsClient.mjs'
import { canadaMapPresentation } from '../../countries/canada/maps.public.mjs'

// Tapping the map fills whichever of pickup/destination was focused last (pickup by default).
let capsule
const mount = () => {
  capsule?.dispose(); capsule = undefined
  const container = document.getElementById('qrideGoogleMap')
  if (!container) return
  capsule = createGoogleMapCapsule({
    container,
    apiKey: import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY,
    mapId: import.meta.env.VITE_GOOGLE_MAPS_MAP_ID,
    language: document.documentElement.lang,
    center: canadaMapPresentation.center,
    onSelect(point) {
      const input = document.getElementById(window.qrideMapTarget || 'pickup')
      if (input) input.value = `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`
    },
  })
}
window.addEventListener('qride:render', mount)
window.addEventListener('qride:location', (event) => capsule?.setPoint(event.detail))
window.addEventListener('pagehide', () => capsule?.dispose())
