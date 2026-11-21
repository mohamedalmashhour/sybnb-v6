// QRide (Québec rides) — rider quotes/requests/live status, driver console, admin review.
import { createApi } from '../shared/api.mjs'
import {
  $, SHARED_CSS, accountBar, busy, cad, errorText, esc, pctText, fmtDateTime, i18n, installDialog, message, openDialog,
  quebecDate, takeParam, renderApplication, renderApplicationsReview, requireSignIn, statusLabel, statusPill, t,
} from '../shared/ui.mjs'

const api = createApi('qride')
const state = { page: 'ride', quote: null, activeRideId: null, historyId: null, health: null, form: { pickup: '', dropoff: '', category: 'STANDARD', when: 'now', date: '', time: '', pet: false, accessible: false }, catalog: null, driverPos: '' }
let poll = null
const ACTIVE = ['PAYMENT_PENDING', 'REQUESTED', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS']

document.head.insertAdjacentHTML('beforeend', `<style>${SHARED_CSS}
.live{display:flex;gap:12px;align-items:center}.dot{width:10px;height:10px;border-radius:50%;background:#3b9a62;animation:pulse 1.4s infinite}
@keyframes pulse{50%{opacity:.3}}.events{list-style:none;padding:0;margin:12px 0 0}.events li{padding:7px 0;border-bottom:1px dashed var(--line);font-size:13px}
.plate{font-family:ui-monospace,monospace;background:#f4f6ef;border:1px solid var(--line);border-radius:6px;padding:2px 7px}
.options{flex-wrap:wrap}.check{display:flex!important;flex-direction:row;align-items:center;gap:8px;font-weight:500;font-size:14px}.check input{width:auto}
.pinBox{display:grid;gap:4px;background:#fff;border:2px solid var(--green);border-radius:16px;padding:14px 16px;margin-top:16px}.pinBox b{font-size:36px;letter-spacing:10px;font-family:ui-monospace,monospace}
.sos{background:#c62828;color:#fff;border:0;border-radius:12px;padding:13px 18px;font-weight:800;letter-spacing:1px}
.stars{display:flex;gap:6px;margin:6px 0 10px}.stars button{font-size:32px;background:none;border:0;color:#cfd5df;padding:0 2px}.stars button.on{color:#f5a623}
.starmini{background:none;border:0;color:#f5a623;font-size:16px;padding:0 1px}</style>`)

// Known places for quick entry; the map, "my location" and "lat, lng" also work.
const PLACES = [
  ['Montréal – Centre-ville', 45.5017, -73.5673], ['Montréal – Gare Centrale', 45.4996, -73.5664], ['Montréal – Plateau-Mont-Royal', 45.5236, -73.5817],
  ['Montréal – Vieux-Port', 45.5075, -73.5523], ['Aéroport Montréal-Trudeau (YUL)', 45.4706, -73.7408], ['Laval – Centropolis', 45.5603, -73.7477],
  ['Longueuil – Métro', 45.525, -73.5219], ['Québec – Vieux-Québec', 46.8123, -71.2055], ['Aéroport Québec (YQB)', 46.7911, -71.3933],
  ['Gatineau – Centre', 45.4283, -75.7139], ['Sherbrooke – Centre', 45.4042, -71.8929],
]

function parsePlace(value) {
  const v = String(value ?? '').trim()
  const known = PLACES.find(([name]) => name.toLowerCase() === v.toLowerCase())
  if (known) return { lat: known[1], lng: known[2], label: known[0] }
  const m = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(v)
  if (m) return { lat: Number(m[1]), lng: Number(m[2]), label: v }
  return null
}

function categoryOptions() {
  const list = state.catalog?.categories ?? Object.keys(CATEGORY).map((code) => ({ code }))
  return list.map((c) => `<option value="${esc(c.code)}">${esc(catName(c.code))}</option>`).join('')
}
const catName = (code) => {
  const c = state.catalog?.categories?.find((x) => x.code === code)
  return c ? `${c.name?.[i18n.lang] ?? code} · 1–${c.seats} ${t('places', 'seats')}` : (CATEGORY[code] ? t(...CATEGORY[code]) : code)
}
const CATEGORY = { STANDARD: ['Standard · 1–4 places', 'Standard · 1–4 seats'], COMFORT: ['Confort · 1–4 places', 'Comfort · 1–4 seats'], XL: ['XL · 1–6 places', 'XL · 1–6 seats'] }
const placeLabel = (p) => esc(p?.label || `${p?.lat?.toFixed(4)}, ${p?.lng?.toFixed(4)}`)
const km = (m) => `${(m / 1000).toFixed(1)} km`
const mins = (s) => `${Math.max(1, Math.round(s / 60))} min`
const stopPoll = () => { if (poll) clearInterval(poll); poll = null }
const startPoll = (fn, ms) => { stopPoll(); poll = setInterval(() => fn().catch(() => {}), ms) }
const loading = () => { $('main').innerHTML = `<p class="small">${t('Chargement…', 'Loading…')}</p>` }

function go(page, extra = {}) {
  Object.assign(state, { page }, extra)
  render()
}

function chrome() {
  document.documentElement.lang = i18n.lang
  $('language').textContent = i18n.lang === 'fr' ? 'EN' : 'FR'
  $('banner').textContent = state.health?.payments === 'simulated'
    ? t('ENVIRONNEMENT DE TEST · Paiements simulés · Aucun montant n’est prélevé', 'TEST ENVIRONMENT · Simulated payments · No money is charged')
    : t('Paiement en ligne bientôt disponible', 'Online payment coming soon')
  $('foot1').textContent = t('Prix en dollars canadiens, TPS et TVQ incluses. Vérifiez toujours la plaque avant de monter.', 'Prices in Canadian dollars, GST and QST included. Always check the plate before boarding.')
  $('foot2').textContent = '9375-7649 QUÉBEC INC.'
  const nav = [['ride', 'Course', 'Ride'], ['trips', 'Mes courses', 'My rides'], ['driver', 'Chauffeurs', 'Drivers']]
  if (api.hasRole('ADMIN')) nav.push(['admin', 'Administration', 'Admin'])
  $('nav').innerHTML = nav.map(([key, fr, en]) => `<button data-page="${key}" class="${state.page === key ? 'active' : ''}" ${state.page === key ? 'aria-current="page"' : ''}>${t(fr, en)}</button>`).join('')
  document.querySelectorAll('[data-page]').forEach((b) => { b.onclick = () => go(b.dataset.page, { historyId: null }) })
  $('accountSlot').replaceChildren(accountBar(api, () => go(state.page, { activeRideId: null, quote: null })))
}
window.addEventListener('qc:auth', chrome)

async function render() {
  stopPoll()
  chrome()
  try {
    if (state.page === 'ride') await ride()
    else if (state.page === 'trips') await trips()
    else if (state.page === 'driver') await driver()
    else if (state.page === 'admin') await admin()
  } catch (err) {
    $('main').innerHTML = `<section class="card"><h2>${t('Erreur', 'Error')}</h2><p>${esc(errorText(err))}</p></section>`
  }
  window.dispatchEvent(new CustomEvent('qride:render'))
}

function locate(input, statusEl) {
  if (!navigator.geolocation) { statusEl.textContent = t('Localisation indisponible.', 'Location unavailable.'); return }
  statusEl.textContent = t('Recherche de votre position…', 'Finding your location…')
  navigator.geolocation.getCurrentPosition((pos) => {
    input.value = `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`
    input.dispatchEvent(new Event('change'))
    statusEl.textContent = ''
    window.dispatchEvent(new CustomEvent('qride:location', { detail: { lat: pos.coords.latitude, lng: pos.coords.longitude } }))
  }, (err) => {
    statusEl.textContent = err.code === 1 ? t('Permission refusée. Choisissez un lieu dans la liste.', 'Permission denied. Pick a place from the list.') : t('Position indisponible.', 'Location unavailable.')
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 })
}

// ---------------- Rider ----------------
async function ride() {
  if (api.user && !state.activeRideId) {
    const { rides } = await api.get('/api/rides')
    const active = rides.find((r) => ACTIVE.includes(r.status) && !r.scheduledFor)
    if (active) state.activeRideId = active.id
  }
  if (state.activeRideId) return liveRide()
  const f = state.form
  $('main').innerHTML = `<datalist id="places">${PLACES.map(([n]) => `<option value="${esc(n)}">`).join('')}</datalist>
    <div class="grid hero"><section><span class="eyebrow">QRIDE · QUÉBEC</span><h1>${t('Votre ville.<br>Votre prochaine course.', 'Your city.<br>Your next ride.')}</h1>
    <p>${t('Voyez le prix total, taxes incluses, avant de confirmer.', 'See the total price, taxes included, before you confirm.')}</p>
    <form class="form" id="rideForm">
      <label>${t('Départ', 'Pickup')}<input id="pickup" list="places" required value="${esc(f.pickup)}" placeholder="${t('Lieu, ou « lat, lng »', 'Place, or "lat, lng"')}"></label>
      <div class="row"><button class="secondary" type="button" id="myLocation">${t('Utiliser ma position', 'Use my location')}</button></div>
      <div id="locationStatus" class="small" role="status"></div>
      <label>${t('Destination', 'Destination')}<input id="dropoff" list="places" required value="${esc(f.dropoff)}" placeholder="${t('Lieu, ou « lat, lng »', 'Place, or "lat, lng"')}"></label>
      <div class="row"><label>${t('Catégorie', 'Category')}<select id="category">${categoryOptions()}</select></label>
      <label>${t('Quand', 'When')}<select id="when"><option value="now">${t('Maintenant', 'Now')}</option><option value="schedule">${t('Planifier', 'Schedule')}</option></select></label></div>
      <div class="row options"><label class="check"><input type="checkbox" id="optPet" ${f.pet ? 'checked' : ''}> ${t('Animal de compagnie', 'Pet')}${state.catalog?.options?.petFeeCents ? ` (+${cad(state.catalog.options.petFeeCents)})` : ''}</label>
        <label class="check"><input type="checkbox" id="optAccessible" ${f.accessible ? 'checked' : ''}> ${t('Accessible en fauteuil roulant', 'Wheelchair accessible')}</label></div>
      <div class="row" id="schedulePanel" hidden><label>${t('Date', 'Date')}<input id="sDate" type="date" min="${quebecDate()}" max="${quebecDate(30)}" value="${esc(f.date)}"></label><label>${t('Heure (Québec)', 'Time (Québec)')}<input id="sTime" type="time" value="${esc(f.time)}"></label></div>
      <p class="error" id="rideError" role="alert"></p>
      <button class="primary" id="quoteBtn">${t('Voir le prix', 'See price')}</button></form></section>
    <section class="card"><div id="qrideGoogleMap" class="map"><p class="small" style="padding:16px">${t('Choisissez un lieu dans la liste ou utilisez votre position.', 'Pick a place from the list or use your location.')}</p></div><div id="quoteBox" class="quote"></div></section></div>`
  $('category').value = f.category
  $('when').value = f.when
  $('schedulePanel').hidden = f.when !== 'schedule'
  $('when').onchange = () => { $('schedulePanel').hidden = $('when').value !== 'schedule' }
  $('myLocation').onclick = () => locate($('pickup'), $('locationStatus'))
  for (const id of ['pickup', 'dropoff']) $(id).onfocus = () => { window.qrideMapTarget = id }
  if (state.quote) showQuote()
  $('rideForm').onsubmit = (e) => {
    e.preventDefault()
    Object.assign(f, { pickup: $('pickup').value, dropoff: $('dropoff').value, category: $('category').value, when: $('when').value, date: $('sDate').value, time: $('sTime').value, pet: $('optPet').checked, accessible: $('optAccessible').checked })
    const pickup = parsePlace(f.pickup)
    const dropoff = parsePlace(f.dropoff)
    if (!pickup || !dropoff) { $('rideError').textContent = t('Choisissez un lieu de la liste, la carte, votre position, ou entrez « lat, lng ».', 'Pick a place from the list, the map, your location, or enter "lat, lng".'); return }
    busy($('quoteBtn'), $('rideError'), async () => {
      if (!(await requireSignIn(api, t('Connectez-vous pour obtenir un prix. Un code vous est envoyé par courriel.', 'Sign in to get a price. We will email you a code.')))) return
      const { quote } = await api.post('/api/rides/quote', { pickup, dropoff, category: f.category, pet: f.pet, accessible: f.accessible })
      state.quote = quote
      showQuote()
    })
  }
}

function scheduledInstant() {
  const { date, time } = state.form
  if (!date || !time) return null
  // Interpret the entered wall-clock time in America/Toronto.
  const guess = new Date(`${date}T${time}:00Z`)
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(guess).map((p) => [p.type, p.value]))
  const offset = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute) - guess.getTime()
  return new Date(guess.getTime() - offset)
}

function lineLabel(l) {
  if (l.code === 'FARE') return t('Course', 'Fare') + (l.minimumApplied ? ` (${t('minimum', 'minimum')})` : '')
  if (l.code === 'BOOKING_FEE') return t('Frais de réservation', 'Booking fee')
  if (l.code === 'PET_FEE') return t('Animal de compagnie', 'Pet fee')
  if (l.code === 'REGULATORY_FEE') return state.catalog?.regulatoryFee?.label?.[i18n.lang] ?? t('Redevance du Québec', 'Québec levy')
  return l.code
}

function showQuote() {
  const q = state.quote
  const b = q.breakdown
  const expired = new Date(q.expiresAt) <= new Date()
  $('quoteBox').innerHTML = `<div class="fare"><div><b>${esc(catName(q.category))}</b><div class="small">${km(q.distanceM)} · ~${mins(q.durationS)} · ${t('estimation', 'estimate')}</div></div><div class="price">${cad(q.totalCents)}</div></div>
    <div class="lines">${b.lines.map((l) => `<div class="fare"><span>${lineLabel(l)}</span><span>${cad(l.cents)}</span></div>`).join('')}
    ${b.taxes.map((x) => `<div class="fare"><span>${esc(x.label[i18n.lang] ?? x.code)}</span><span>${cad(x.cents)}</span></div>`).join('')}
    <div class="fare total"><span>Total (CAD)</span><span>${cad(b.totalCents)}</span></div></div>
    <p class="small">${t('Prix garanti jusqu’à', 'Price held until')} ${fmtDateTime(q.expiresAt)}.</p>
    <p class="error" id="requestError" role="alert">${expired ? t('Ce prix a expiré. Demandez un nouveau prix.', 'This price expired. Get a new price.') : ''}</p>
    <button class="primary" id="requestBtn" ${expired ? 'disabled' : ''}>${state.form.when === 'schedule' ? t('Planifier la course', 'Schedule ride') : t('Commander', 'Request ride')}</button>`
  $('requestBtn').onclick = () => busy($('requestBtn'), $('requestError'), async () => {
    const scheduledFor = state.form.when === 'schedule' ? scheduledInstant() : null
    if (state.form.when === 'schedule' && !scheduledFor) throw new Error(t('Choisissez la date et l’heure.', 'Choose the date and time.'))
    const { ride: r, checkoutUrl } = await api.post('/api/rides', { quoteId: q.id, scheduledFor: scheduledFor?.toISOString() })
    state.quote = null
    if (checkoutUrl) { location.assign(checkoutUrl); return }
    if (scheduledFor) { message(t('Course planifiée', 'Ride scheduled'), `${fmtDateTime(scheduledFor)} · ${cad(r.totalCents)}`); go('trips') } else go('ride', { activeRideId: r.id })
  })
}

function rideCard(r, { asDriver = false } = {}) {
  const d = r.driver
  const price = asDriver ? `${cad(r.breakdown.driver.payoutCents)}<div class="small">${t('votre gain', 'your earnings')}</div>` : cad(r.totalCents)
  const person = asDriver
    ? (r.rider ? `<div class="details"><div class="avatar">${esc((r.rider.name || '?')[0])}</div><div><b>${esc(r.rider.name || t('Passager', 'Rider'))}</b><br><span class="small">${t('Passager', 'Rider')}</span></div></div>` : '')
    : (d ? `<div class="details"><div class="avatar">${esc((d.name || '?')[0])}</div><div><b>${esc(d.name)}</b><br><span class="small">${esc(d.vehicle?.colour)} ${esc(d.vehicle?.make)} ${esc(d.vehicle?.model)}</span> <span class="plate">${esc(d.vehicle?.plate)}</span>${d.rating ? ` <span class="small">★ ${d.rating.average} (${d.rating.count})</span>` : ''}</div></div>` : '')
  const opts = [r.pet ? t('Animal', 'Pet') : '', r.accessible ? t('Accessible', 'Accessible') : ''].filter(Boolean)
  return `<div class="fare"><div><b>${statusLabel(r.status)}</b>${opts.map((o) => ` <span class="pill">${o}</span>`).join('')}<div class="small">${placeLabel(r.pickup)} → ${placeLabel(r.dropoff)}</div></div><div class="price" style="text-align:right">${price}</div></div>
    ${person}
    <ul class="events">${(r.events ?? []).map((e) => `<li>${fmtDateTime(e.at)} · ${esc(eventLabel(e.type))}</li>`).join('')}</ul>`
}

const EVENTS = {
  REQUESTED: ['Course demandée', 'Ride requested'], PAYMENT_AUTHORIZED: ['Paiement autorisé', 'Payment authorized'], ACCEPTED: ['Chauffeur assigné', 'Driver assigned'], DRIVER_ARRIVED: ['Chauffeur arrivé', 'Driver arrived'],
  TRIP_STARTED: ['Course commencée', 'Trip started'], TRIP_COMPLETED: ['Course terminée', 'Trip completed'], CANCELLED_BY_RIDER: ['Annulée par le passager', 'Cancelled by rider'],
  RELEASED_BY_DRIVER: ['Chauffeur désisté — recherche d’un autre chauffeur', 'Driver released — finding another driver'],
  SOS: ['Alerte SOS', 'SOS alert'], RIDER_RATED_DRIVER: ['Le passager a noté le chauffeur', 'Rider rated the driver'], DRIVER_RATED_RIDER: ['Le chauffeur a noté le passager', 'Driver rated the rider'], TIP_ADDED: ['Pourboire ajouté', 'Tip added'],
}
const eventLabel = (type) => (EVENTS[type] ? t(...EVENTS[type]) : type)

async function liveRide() {
  let signature = ''
  const draw = async () => {
    const { ride: r } = await api.get(`/api/rides/${state.activeRideId}`)
    if (!ACTIVE.includes(r.status)) stopPoll()
    const nextSignature = JSON.stringify([r.status, r.events?.length, i18n.lang])
    if (nextSignature === signature) return
    signature = nextSignature
    $('main').innerHTML = `<div class="grid hero"><section><span class="eyebrow">${t('COURSE EN DIRECT', 'LIVE RIDE')}</span>
      <h1>${r.status === 'REQUESTED' ? t('Recherche d’un<br>chauffeur…', 'Finding your<br>driver…') : r.status === 'PAYMENT_PENDING' ? t('Confirmation du<br>paiement…', 'Confirming<br>payment…') : statusLabel(r.status)}</h1>
      ${r.status === 'PAYMENT_PENDING' ? `<p>${t('Le montant est autorisé sur votre carte et prélevé seulement à la fin de la course.', 'The amount is authorized on your card and charged only when the trip ends.')}</p>` : ''}
      ${ACTIVE.includes(r.status) ? `<div class="live"><span class="dot"></span><span class="small">${t('Mise à jour automatique', 'Updating automatically')}</span></div>` : ''}
      ${ACTIVE.includes(r.status) ? `<p class="notice" role="note">● ${recordedNotice()}</p>` : ''}
      ${r.driver && ACTIVE.includes(r.status) ? `<p class="notice">${t('Vérifiez le nom, le véhicule et la plaque avant de monter.', 'Check the name, vehicle and plate before boarding.')}</p>` : ''}
      ${r.pickupPin && ['REQUESTED', 'ACCEPTED', 'ARRIVED'].includes(r.status) ? `<div class="pinBox"><span class="small">${t('Votre code de prise en charge', 'Your pickup code')}</span><b>${esc(r.pickupPin)}</b><span class="small">${t('Donnez-le au chauffeur une fois à bord. Ne montez pas si le chauffeur ne vous le demande pas.', 'Give it to the driver once on board. Don’t ride if the driver doesn’t ask for it.')}</span></div>` : ''}
      ${ACTIVE.includes(r.status) && r.status !== 'PAYMENT_PENDING' ? `<div class="row" style="margin-top:14px"><button class="secondary" id="shareTrip">${t('Partager mon trajet', 'Share my trip')}</button>${['ACCEPTED', 'ARRIVED', 'IN_PROGRESS'].includes(r.status) ? `<button class="sos" id="sosBtn">SOS</button>` : ''}</div>` : ''}
      ${r.status === 'COMPLETED' ? endOfTrip(r) : ''}
      <div class="row" style="margin-top:20px">${['PAYMENT_PENDING', 'REQUESTED', 'ACCEPTED', 'ARRIVED'].includes(r.status) ? `<button class="secondary" id="cancelRide">${t('Annuler la course', 'Cancel ride')}</button>` : ''}
      ${!ACTIVE.includes(r.status) ? `<button class="primary" id="newRide">${t('Nouvelle course', 'New ride')}</button>` : ''}</div></section>
      <section class="card">${rideCard(r)}</section></div>`
    $('cancelRide')?.addEventListener('click', (e) => {
      if (!confirm(t('Annuler cette course ?', 'Cancel this ride?'))) return
      busy(e.target, null, async () => { await api.post(`/api/rides/${r.id}/cancel`); go('ride', { activeRideId: null }) })
    })
    $('newRide')?.addEventListener('click', () => go('ride', { activeRideId: null }))
    $('shareTrip')?.addEventListener('click', () => shareTrip(r))
    $('sosBtn')?.addEventListener('click', (e) => sos(e.target, r.id))
    wireEndOfTrip(r, () => { signature = ''; draw() })
  }
  await draw()
  startPoll(draw, 4000)
}

function shareTrip(r) {
  const url = `${location.origin}${location.pathname}?trip=${encodeURIComponent(r.shareToken)}`
  const text = t('Suivez mon trajet Q RIDE en direct :', 'Follow my Q RIDE trip live:')
  if (navigator.share) navigator.share({ title: 'Q RIDE', text, url }).catch(() => {})
  else navigator.clipboard?.writeText(url).then(() => message(t('Lien copié', 'Link copied'), t('Envoyez ce lien à un proche. Il fonctionne jusqu’à 2 heures après la fin du trajet.', 'Send this link to someone you trust. It works until 2 hours after the trip ends.')), () => message(t('Lien du trajet', 'Trip link'), url))
}

function sos(button, rideId) {
  const body = openDialog(`<h2 style="color:#a3322a">${t('Urgence', 'Emergency')}</h2>
    <p><b>${t('En cas de danger, appelez le 911 immédiatement.', 'If you are in danger, call 911 now.')}</b></p>
    <a class="sos" style="display:block;text-align:center;text-decoration:none;margin:12px 0" href="tel:911">${t('Appeler le 911', 'Call 911')}</a>
    <p class="small">${t('Signaler aussi à l’équipe de sécurité Q RIDE : votre position et le trajet sont ajoutés au registre du trajet, conservé pour enquête.', 'Also alert the Q RIDE safety team: your position and the trip are added to the trip record and kept for review.')}</p>
    <p class="error" id="sosError" role="alert"></p><button class="secondary" id="sosReport">${t('Alerter l’équipe de sécurité', 'Alert the safety team')}</button>`)
  body.querySelector('#sosReport').onclick = (e) => busy(e.target, body.querySelector('#sosError'), async () => {
    const pos = await new Promise((res) => navigator.geolocation ? navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }), () => res({}), { timeout: 5000 }) : res({}))
    await api.post(`/api/rides/${rideId}/sos`, pos)
    message(t('Alerte envoyée', 'Alert sent'), t('L’équipe de sécurité a été alertée. Si vous êtes en danger, appelez le 911.', 'The safety team has been alerted. If you are in danger, call 911.'))
  })
}

// After the trip: rate the driver and leave an optional tip (100% to the driver).
function endOfTrip(r) {
  const tipMax = state.catalog?.options?.maxTipCents ?? 0
  return `<div class="card" style="margin-top:18px"><h2 style="margin-top:0">${t('Comment s’est passé votre trajet ?', 'How was your trip?')}</h2>
    ${r.myRating ? `<p>${t('Merci ! Votre note', 'Thanks! Your rating')} : ${'★'.repeat(r.myRating)}</p>` : `<div class="stars" id="stars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" aria-label="${n}">★</button>`).join('')}</div>
      <textarea id="rateComment" rows="2" maxlength="500" placeholder="${t('Commentaire (facultatif)', 'Comment (optional)')}"></textarea>
      <button class="primary" id="rateBtn" disabled style="margin-top:10px">${t('Envoyer la note', 'Submit rating')}</button>`}
    ${tipMax ? (r.tipCents ? `<p>${t('Pourboire envoyé', 'Tip sent')} : <b>${cad(r.tipCents)}</b> — ${t('100 % au chauffeur', '100% to the driver')}</p>` : `<h3>${t('Pourboire', 'Tip')} <span class="small">${t('100 % au chauffeur', '100% to the driver')}</span></h3>
      <div class="suggest">${[200, 500, 1000].map((c) => `<button type="button" data-tip="${c}">${cad(c)}</button>`).join('')}<button type="button" data-tip="other">${t('Autre', 'Other')}</button></div>`) : ''}
    <p class="error" id="endError" role="alert"></p></div>`
}

function wireEndOfTrip(r, redraw) {
  let chosen = 0
  document.querySelectorAll('[data-star]').forEach((b) => {
    b.onclick = () => {
      chosen = Number(b.dataset.star)
      document.querySelectorAll('[data-star]').forEach((x) => x.classList.toggle('on', Number(x.dataset.star) <= chosen))
      $('rateBtn').disabled = false
    }
  })
  $('rateBtn')?.addEventListener('click', (e) => busy(e.target, $('endError'), async () => {
    await api.post(`/api/rides/${r.id}/rate`, { rating: chosen, comment: $('rateComment').value.trim() || undefined })
    redraw()
  }))
  document.querySelectorAll('[data-tip]').forEach((b) => {
    b.onclick = () => {
      let cents = Number(b.dataset.tip)
      if (b.dataset.tip === 'other') {
        const v = prompt(t('Montant du pourboire ($)', 'Tip amount ($)'))
        if (!v) return
        cents = Math.round(Number(String(v).replace(',', '.')) * 100)
      }
      busy(b, $('endError'), async () => { await api.post(`/api/rides/${r.id}/tip`, { cents }); redraw() })
    }
  })
}

// Public view of a trip someone shared (?trip=token). No sign-in, no prices.
async function sharedTrip(token) {
  const draw = async () => {
    const { trip } = await api.get(`/api/share/${encodeURIComponent(token)}`)
    if (!ACTIVE.includes(trip.status)) stopPoll()
    $('main').innerHTML = `<div class="sectionhead"><span class="eyebrow">${t('TRAJET PARTAGÉ', 'SHARED TRIP')}</span><h1>${statusLabel(trip.status)}</h1>
      <p>${placeLabel(trip.pickup)} → ${placeLabel(trip.dropoff)}</p></div>
      <section class="card">${trip.driver ? `<div class="details"><div class="avatar">${esc((trip.driver.name || '?')[0])}</div><div><b>${esc(trip.driver.name)}</b><br><span class="small">${esc(trip.driver.vehicle?.colour)} ${esc(trip.driver.vehicle?.make)} ${esc(trip.driver.vehicle?.model)}</span> <span class="plate">${esc(trip.driver.vehicle?.plate)}</span></div></div>` : ''}
      <ul class="events">${trip.events.map((e) => `<li>${fmtDateTime(e.at)} · ${esc(eventLabel(e.type))}</li>`).join('')}</ul>
      <p class="small">${t('En cas d’urgence, appelez le 911.', 'In an emergency, call 911.')}</p></section>`
  }
  try { await draw(); startPoll(draw, 6000) } catch { $('main').innerHTML = `<section class="card"><h2>${t('Lien expiré', 'Link expired')}</h2><p>${t('Ce trajet n’est plus partagé.', 'This trip is no longer shared.')}</p></section>` }
}

async function trips() {
  if (!api.user) {
    $('main').innerHTML = `<section class="card"><h2>${t('Mes courses', 'My rides')}</h2><p>${t('Connectez-vous pour voir vos courses.', 'Sign in to see your rides.')}</p><button class="primary" id="tripSignIn">${t('Connexion', 'Sign in')}</button></section>`
    $('tripSignIn').onclick = async () => { if (await requireSignIn(api)) render() }
    return
  }
  loading()
  const { rides } = await api.get('/api/rides')
  const selected = rides.find((r) => r.id === state.historyId)
  $('main').innerHTML = `<div class="sectionhead"><span class="eyebrow">${t('PASSAGER', 'RIDER')}</span><h1>${t('Mes courses', 'My rides')}</h1></div>
    <div class="grid"><section class="card">${rides.length ? `<table class="table"><tbody>${rides.map((r) => `<tr><td>${fmtDateTime(r.scheduledFor ?? r.createdAt)}${r.scheduledFor ? ` <span class="pill">${t('planifiée', 'scheduled')}</span>` : ''}<br><span class="small">${placeLabel(r.pickup)} → ${placeLabel(r.dropoff)}</span></td>
      <td>${cad(r.totalCents)}</td><td>${statusPill(r.status)}</td><td><button class="secondary" data-ride="${r.id}">${t('Détails', 'Details')}</button></td></tr>`).join('')}</tbody></table>`
      : `<p>${t('Aucune course pour l’instant.', 'No rides yet.')}</p>`}</section>
    <section class="card">${selected ? `<h2>${t('Registre du trajet', 'Trip record')}</h2>${rideCard(selected)}
      ${['PAYMENT_PENDING', 'REQUESTED', 'ACCEPTED', 'ARRIVED'].includes(selected.status) ? `<button class="secondary" id="cancelSel" style="margin-top:14px">${t('Annuler', 'Cancel')}</button>` : ''}`
      : `<p>${t('Choisissez une course pour voir le chauffeur, le véhicule et chaque étape horodatée.', 'Pick a ride to see the driver, vehicle and every timestamped step.')}</p>`}</section></div>`
  document.querySelectorAll('[data-ride]').forEach((b) => { b.onclick = () => go('trips', { historyId: b.dataset.ride }) })
  $('cancelSel')?.addEventListener('click', (e) => busy(e.target, null, async () => { await api.post(`/api/rides/${selected.id}/cancel`); render() }))
}

// ---------------- Driver ----------------
async function driver() {
  const head = `<div class="sectionhead"><span class="eyebrow">${t('ESPACE CHAUFFEUR', 'DRIVER WORKSPACE')}</span><h1>${t('Conduisez avec Q RIDE.', 'Drive with Q RIDE.')}</h1></div>`
  if (!api.user) {
    $('main').innerHTML = `${head}<section class="card"><p>${t('Connectez-vous pour déposer votre dossier chauffeur.', 'Sign in to submit your driver application.')}</p><button class="primary" id="drvSignIn">${t('Connexion', 'Sign in')}</button></section>`
    $('drvSignIn').onclick = async () => { if (await requireSignIn(api)) render() }
    return
  }
  if (!api.hasRole('DRIVER')) {
    $('main').innerHTML = `${head}<div id="apply"></div>`
    await renderApplication($('apply'), api, 'DRIVER', render)
    return
  }
  loading()
  let signature = ''
  const draw = async () => {
    const [{ rides, earningsCents, tipsCents, driver: me }, offersRes] = await Promise.all([api.get('/api/driver/rides'), api.get('/api/driver/offers').catch((err) => ({ error: err }))])
    const active = rides.find((r) => ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS'].includes(r.status))
    if (document.activeElement?.closest?.('#main form')) return // don't redraw under the driver's typing
    const nextSignature = JSON.stringify([rides.map((r) => [r.id, r.status, r.events?.length]), offersRes.offers?.map((o) => [o.id, o.pickupDistanceM]), offersRes.error?.code, me.online, i18n.lang])
    if (nextSignature === signature) return
    signature = nextSignature
    const next = { ACCEPTED: ['arrive', t('Je suis arrivé', 'I have arrived')], ARRIVED: ['start', t('Commencer la course', 'Start trip')], IN_PROGRESS: ['complete', t('Terminer la course', 'Complete trip')] }
    $('main').innerHTML = `${head}<datalist id="places">${PLACES.map(([n]) => `<option value="${esc(n)}">`).join('')}</datalist>
      <div class="grid"><section class="stack">
      ${offersRes.error ? `<div class="card"><p class="error">${esc(errorText(offersRes.error))}</p></div>` : ''}
      <div class="card"><h2>${t('Disponibilité', 'Availability')}</h2><form class="form" id="statusForm">
        <label>${t('Ma position', 'My position')}<input id="drvPos" list="places" value="${esc(state.driverPos)}" placeholder="${t('Lieu, ou « lat, lng »', 'Place, or "lat, lng"')}"></label>
        <div class="row"><button type="button" class="secondary" id="drvLocate">${t('Utiliser ma position', 'Use my location')}</button><button class="primary" id="goOnline">${t('Être en ligne', 'Go online')}</button><button type="button" class="secondary" id="goOffline">${t('Hors ligne', 'Go offline')}</button></div>
        <div class="row options"><label class="check"><input type="checkbox" id="optPets" ${me.acceptsPets ? 'checked' : ''}> ${t('J’accepte les animaux', 'I accept pets')}</label><label class="check"><input type="checkbox" id="optAcc" ${me.accessible ? 'checked' : ''}> ${t('Véhicule accessible', 'Accessible vehicle')}</label></div>
        <p class="small" id="drvStatus" role="status">${me.online ? `<span class="status">${t('En ligne', 'Online')}</span>` : `<span class="status status-cancelled">${t('Hors ligne', 'Offline')}</span>`} · ${esc(me.category)} · ${esc(me.vehicle?.make)} ${esc(me.vehicle?.model)} <span class="plate">${esc(me.vehicle?.plate)}</span>${me.rating ? ` · ★ ${me.rating} (${me.ratingCount})` : ''}</p></form></div>
      ${active ? `<div class="card"><h2>${t('Course en cours', 'Current ride')}</h2>${rideCard(active, { asDriver: true })}
        <p class="notice" role="note">● ${recordedNotice()}</p>
        ${active.status === 'ARRIVED' ? `<label style="margin-top:12px">${t('Code du passager (4 chiffres)', 'Rider’s code (4 digits)')}<input id="ridePin" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" autocomplete="off"></label>` : ''}
        <p class="error" id="advanceError" role="alert"></p>
        <div class="row" style="margin-top:14px"><button class="primary" id="advance">${next[active.status][1]}</button>${active.status !== 'IN_PROGRESS' ? `<button class="secondary" id="release">${t('Me désister', 'Release ride')}</button>` : ''}</div></div>` : ''}
      <div class="card"><h2>${t('Demandes à proximité', 'Nearby requests')}</h2>
        ${offersRes.offers?.length ? offersRes.offers.map((o) => `<div class="reviewItem"><div><b>${placeLabel(o.pickup)}</b> → ${placeLabel(o.dropoff)}<br><span class="small">${t('à', '')} ${km(o.pickupDistanceM)} ${t('', 'away')} · ${t('gain', 'earn')} ${cad(o.breakdown.driver.payoutCents)}${o.scheduledFor ? ` · ${fmtDateTime(o.scheduledFor)}` : ''}${o.pet ? ` · ${t('animal', 'pet')}` : ''}${o.accessible ? ` · ${t('accessible', 'accessible')}` : ''}</span></div>
          <div class="actions"><button class="primary" data-accept="${o.id}" ${active ? 'disabled' : ''}>${t('Accepter', 'Accept')}</button></div></div>`).join('')
          : `<p>${t('Aucune demande pour l’instant. Restez en ligne.', 'No requests right now. Stay online.')}</p>`}</div></section>
      <section class="card"><h2>${t('Mes gains', 'My earnings')}</h2><div class="walletAmount">${cad(earningsCents)}</div><p class="small">${t('Versement net après commission, courses terminées, pourboires inclus', 'Net payout after commission, completed rides, tips included')}${tipsCents ? ` (${t('pourboires', 'tips')} ${cad(tipsCents)})` : ''}.</p>
        <table class="table"><tbody>${rides.slice(0, 20).map((r) => `<tr><td>${fmtDateTime(r.createdAt)}</td><td>${statusPill(r.status)}</td><td>${cad(r.breakdown.driver.payoutCents + (r.tipCents ?? 0))}${r.tipCents ? ` <span class="small">(${t('pourboire', 'tip')} ${cad(r.tipCents)})</span>` : ''}</td>
          <td>${r.status === 'COMPLETED' ? (r.myRating ? `<span class="small">${t('Passager noté', 'Rider rated')} ${'★'.repeat(r.myRating)}</span>` : `<span class="small">${t('Noter le passager', 'Rate rider')}</span> ${[1, 2, 3, 4, 5].map((n) => `<button class="starmini" data-rate-rider="${r.id}" data-stars="${n}" aria-label="${n}">★</button>`).join('')}`) : ''}</td></tr>`).join('')}</tbody></table></section></div>`
    const setStatus = (online) => (e) => {
      e?.preventDefault()
      const pos = parsePlace($('drvPos').value)
      if (online && !pos) { $('drvStatus').textContent = t('Indiquez votre position pour recevoir des demandes.', 'Set your position to receive requests.'); return }
      state.driverPos = $('drvPos').value
      busy(online ? $('goOnline') : $('goOffline'), $('drvStatus'), async () => {
        await api.post('/api/driver/status', { online, ...(pos ? { lat: pos.lat, lng: pos.lng } : {}) })
        $('drvPos').blur()
        signature = ''
        await draw()
      })
    }
    $('statusForm').onsubmit = setStatus(true)
    $('goOffline').onclick = setStatus(false)
    $('drvLocate').onclick = () => locate($('drvPos'), $('drvStatus'))
    document.querySelectorAll('[data-accept]').forEach((b) => { b.onclick = () => busy(b, null, async () => { await api.post(`/api/driver/rides/${b.dataset.accept}/accept`); await draw() }) })
    $('advance')?.addEventListener('click', (e) => busy(e.target, $('advanceError'), async () => {
      await api.post(`/api/driver/rides/${active.id}/${next[active.status][0]}`, active.status === 'ARRIVED' ? { pin: $('ridePin').value.trim() } : undefined)
      signature = ''; await draw()
    }))
    document.querySelectorAll('[data-rate-rider]').forEach((b) => { b.onclick = () => busy(b, null, async () => { await api.post(`/api/driver/rides/${b.dataset.rateRider}/rate`, { rating: Number(b.dataset.stars) }); signature = ''; await draw() }) })
    $('optPets')?.addEventListener('change', (e) => busy(e.target, $('drvStatus'), async () => { await api.post('/api/driver/status', { online: me.online, acceptsPets: e.target.checked }); signature = ''; await draw() }))
    $('optAcc')?.addEventListener('change', (e) => busy(e.target, $('drvStatus'), async () => { await api.post('/api/driver/status', { online: me.online, accessible: e.target.checked }); signature = ''; await draw() }))
    $('release')?.addEventListener('click', (e) => { if (confirm(t('Rendre cette course à un autre chauffeur ?', 'Give this ride to another driver?'))) busy(e.target, null, async () => { await api.post(`/api/rides/${active.id}/cancel`); await draw() }) })
  }
  await draw()
  startPoll(draw, 5000)
}

// ---------------- Admin ----------------
async function admin() {
  if (!api.hasRole('ADMIN')) { go('ride'); return }
  loading()
  $('main').innerHTML = `<div class="sectionhead"><span class="eyebrow">${t('ADMINISTRATION', 'ADMIN')}</span><h1>${t('Chauffeurs et courses', 'Drivers and rides')}</h1></div>
    <div class="stack"><div id="driverApps"></div><div id="rideList"></div></div>`
  const { rides } = await api.get('/api/admin/rides')
  await renderApplicationsReview($('driverApps'), api, 'DRIVER', render)
  $('rideList').innerHTML = `<section class="card"><h2>${t('Courses récentes', 'Recent rides')} (${rides.length})</h2><table class="table"><tbody>
    ${rides.map((r) => `<tr><td>${fmtDateTime(r.createdAt)}</td><td>${placeLabel(r.pickup)} → ${placeLabel(r.dropoff)}</td><td>${esc(r.category)}</td><td>${cad(r.totalCents)}</td><td>${statusPill(r.status)}</td><td class="small">${r.events.length} ${t('étapes', 'steps')}</td></tr>`).join('')}
    </tbody></table></section>`
}

// ---------------- Boot ----------------
$('language').onclick = () => { i18n.set(i18n.lang === 'fr' ? 'en' : 'fr'); render() }
installDialog()
;(async () => {
  try { [state.health, , state.catalog] = await Promise.all([api.get('/api/health'), api.loadUser(), api.get('/api/rides/categories')]) } catch {}
  const shared = takeParam('trip')
  if (shared) { chrome(); return sharedTrip(shared) }
  // Back from Stripe: show the ride, which goes live once Stripe confirms the authorization.
  const paidRide = takeParam('ride')
  const unpaidRide = takeParam('unpaid')
  if (paidRide) state.activeRideId = paidRide
  if (unpaidRide) {
    state.activeRideId = unpaidRide
    message(t('Paiement non terminé', 'Payment not completed'), t('La course n’est pas envoyée aux chauffeurs tant que le paiement n’est pas autorisé. Annulez-la et demandez un nouveau prix.', 'The ride is not sent to drivers until payment is authorized. Cancel it and get a new price.'))
  }
  render()
})()

// "This trip is recorded" (owner 2026-11-20): shown to rider and driver for the whole trip.
function recordedNotice() {
  return t('Ce trajet est enregistré : le parcours et les événements du trajet sont conservés 7 jours pour la sécurité de tous. Signalez tout problème dans ce délai.', 'This trip is recorded: the route and trip events are kept for 7 days for everyone’s safety. Report any problem within that week.')
}
