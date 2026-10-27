import { createGoogleMapCapsule } from '../../src/shared/maps/googleMapsClient.mjs'
import { canadaMapPresentation } from '../../countries/canada/maps.public.mjs'

// Mounts the in-app map wherever the current screen has #qtrGoogleMap (host listing form).
let capsule
const mount = () => {
  capsule?.dispose(); capsule = undefined
  const container = document.getElementById('qtrGoogleMap')
  if (!container) return
  const lat = Number(document.getElementById('listingLat')?.value)
  const lng = Number(document.getElementById('listingLng')?.value)
  capsule = createGoogleMapCapsule({
    container,
    apiKey: import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY,
    mapId: import.meta.env.VITE_GOOGLE_MAPS_MAP_ID,
    language: document.documentElement.lang,
    center: Number.isFinite(lat) && Number.isFinite(lng) && lat ? { lat, lng } : canadaMapPresentation.center,
    onSelect(point) {
      const latInput = document.getElementById('listingLat')
      const lngInput = document.getElementById('listingLng')
      if (latInput) latInput.value = point.lat.toFixed(6)
      if (lngInput) lngInput.value = point.lng.toFixed(6)
    },
  })
}
window.addEventListener('qtr:render', mount)
window.addEventListener('pagehide', () => capsule?.dispose())
