// Country-neutral Google Maps capsule. Explicit activation; no credentials embedded here.
let pendingSdk
let sdkKey

export function validMapPoint(point) {
  return Boolean(point && Number.isFinite(point.lat) && Number.isFinite(point.lng)
    && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180)
}

export function loadGoogleMaps({ apiKey, language = 'en', windowRef = globalThis.window, documentRef = globalThis.document, timeoutMs = 15000 } = {}) {
  if (typeof apiKey !== 'string' || !/^[A-Za-z0-9_-]{10,200}$/.test(apiKey)) return Promise.reject(new Error('MAPS_NOT_CONFIGURED'))
  if (!windowRef || !documentRef) return Promise.reject(new Error('MAPS_BROWSER_REQUIRED'))
  if (sdkKey && sdkKey !== apiKey) return Promise.reject(new Error('MAPS_CONFIGURATION_CONFLICT'))
  if (windowRef.google?.maps?.Map && windowRef.google?.maps?.marker?.AdvancedMarkerElement) return Promise.resolve(windowRef.google.maps)
  if (pendingSdk) return pendingSdk
  sdkKey = apiKey
  pendingSdk = new Promise((resolve, reject) => {
    const script = documentRef.createElement('script')
    const callback = '__sybnbGoogleMapsReady'
    const previousAuthFailure = windowRef.gm_authFailure
    let finished = false
    const clean = () => { clearTimeout(timer); delete windowRef[callback]; script.onerror = null }
    const fail = () => { if (finished) return; finished = true; clean(); script.remove(); windowRef.gm_authFailure = previousAuthFailure; pendingSdk = undefined; sdkKey = undefined; reject(new Error('MAPS_UNAVAILABLE')) }
    const timer = setTimeout(fail, timeoutMs)
    windowRef.gm_authFailure = () => {
      fail()
      windowRef.dispatchEvent(new windowRef.CustomEvent('sybnb:maps-auth-error'))
    }
    windowRef[callback] = () => {
      if (finished) return
      if (!windowRef.google?.maps?.Map || !windowRef.google?.maps?.marker?.AdvancedMarkerElement) return fail()
      finished = true; clean(); resolve(windowRef.google.maps)
    }
    const url = new URL('https://maps.googleapis.com/maps/api/js')
    url.search = new URLSearchParams({ key: apiKey, v: 'weekly', loading: 'async', libraries: 'marker', callback, language: ['en', 'fr', 'ar'].includes(language) ? language : 'en' }).toString()
    script.src = url.href; script.async = true; script.onerror = fail
    script.referrerPolicy = 'strict-origin-when-cross-origin'
    documentRef.head.append(script)
  })
  return pendingSdk
}

export function createGoogleMapCapsule({ container, apiKey, mapId, center, language = 'en', onSelect = () => {}, loadSdk = loadGoogleMaps }) {
  if (!container || !validMapPoint(center)) throw new Error('MAPS_CAPSULE_INVALID')
  const fr = language === 'fr'
  const text = (en, french) => fr ? french : en
  const doc = container.ownerDocument
  const button = doc.createElement('button'); button.type = 'button'; button.className = 'secondary'
  button.textContent = text('Load Google Maps in app', 'Afficher Google Maps dans l’application')
  const notice = doc.createElement('p'); notice.className = 'small'
  notice.textContent = text('Loading shares map and location data with Google. Tap the map to choose a pin. No live route or fare is calculated.', 'Le chargement partage les données de carte et de localisation avec Google. Touchez la carte pour choisir un point. Aucun itinéraire ou tarif réel n’est calculé.')
  const status = doc.createElement('p'); status.setAttribute('role', 'status'); status.className = 'small'
  const canvas = doc.createElement('div'); canvas.style.height = '300px'; canvas.style.borderRadius = '16px'; canvas.style.overflow = 'hidden'; canvas.hidden = true
  container.replaceChildren(button, notice, canvas, status)
  let disposed = false, map, marker, maps, listener, point
  const authError = () => {
    if (disposed) return
    listener?.remove(); if (marker) marker.map = null
    if (map) maps.event?.clearInstanceListeners(map)
    map = undefined; marker = undefined
    canvas.hidden = true; button.hidden = false; button.disabled = false
    status.textContent = text('Map access unavailable. Enter the address manually.', 'Accès à la carte indisponible. Saisissez l’adresse manuellement.')
  }
  doc.defaultView.addEventListener('sybnb:maps-auth-error', authError)
  const place = (value, notify = false) => {
    if (!validMapPoint(value) || disposed) return false
    point = { lat: value.lat, lng: value.lng }
    if (map) {
      if (marker) marker.position = point
      else marker = new maps.marker.AdvancedMarkerElement({ map, position: point, title: text('Selected location', 'Position choisie') })
      map.panTo(point)
    }
    if (notify) onSelect({ ...point })
    return true
  }
  button.onclick = async () => {
    if (disposed || map || button.disabled) return
    if (!apiKey || !mapId) { status.textContent = text('Maps is not configured yet. You can enter the address manually.', 'La carte n’est pas encore configurée. Vous pouvez saisir l’adresse manuellement.'); return }
    button.disabled = true; status.textContent = text('Loading map…', 'Chargement de la carte…')
    try {
      maps = await loadSdk({ apiKey, language })
      if (disposed) return
      canvas.hidden = false
      map = new maps.Map(canvas, { center: point || center, zoom: 13, mapId, streetViewControl: false, mapTypeControl: false })
      listener = map.addListener('click', event => {
        const next = { lat: event.latLng?.lat(), lng: event.latLng?.lng() }
        if (place(next, true)) status.textContent = text('Pin selected. Confirm the street side before booking.', 'Point choisi. Vérifiez le côté de la rue avant de réserver.')
      })
      if (point) place(point)
      button.hidden = true; status.textContent = text('Google Maps loaded. Tap to select.', 'Google Maps chargée. Touchez pour sélectionner.')
    } catch {
      if (disposed) return
      canvas.hidden = true; button.disabled = false
      status.textContent = text('Map unavailable. Retry or enter the address manually.', 'Carte indisponible. Réessayez ou saisissez l’adresse manuellement.')
    }
  }
  return {
    setPoint: value => place(value),
    dispose() { disposed = true; button.onclick = null; doc.defaultView.removeEventListener('sybnb:maps-auth-error', authError); listener?.remove(); if (marker) marker.map = null; if (map) maps.event?.clearInstanceListeners(map); container.replaceChildren() },
  }
}
