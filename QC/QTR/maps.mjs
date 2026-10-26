import { renderAccountCapsule } from '../../apps/shared/account-capsule.mjs'
window.renderAccountCapsule = renderAccountCapsule
import { createGoogleMapCapsule } from '../../src/shared/maps/googleMapsClient.mjs'
import { canadaMapPresentation } from '../../countries/canada/maps.public.mjs'

let capsule
const mount = () => {
  capsule?.dispose(); capsule = undefined
  const container = document.getElementById('qtrGoogleMap')
  if (!container) return
  capsule = createGoogleMapCapsule({
    container,
    apiKey: import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY,
    mapId: import.meta.env.VITE_GOOGLE_MAPS_MAP_ID,
    language: document.documentElement.lang,
    center: canadaMapPresentation.center,
    onSelect(point) {
      const input = document.getElementById('stayDestination')
      if (input) input.value = `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`
    },
  })
}
window.addEventListener('qtr:render', mount)
window.addEventListener('pagehide', () => capsule?.dispose())
mount()
