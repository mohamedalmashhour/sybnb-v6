// QTR (Québec short-term stays) — guest search/booking, host listings/calendar, admin review.
import { createApi } from '../shared/api.mjs'
import {
  $, SHARED_CSS, accountBar, busy, cad, closeDialog, errorText, esc, pctText, fmtDate, fmtDateTime, i18n, installDialog, message,
  openDialog, quebecDate, takeParam, renderApplication, renderApplicationsReview, requireSignIn, statusPill, t,
} from '../shared/ui.mjs'

const api = createApi('qtr')
const state = { page: 'stay', listingId: null, search: { city: 'Montréal', checkIn: quebecDate(14), checkOut: quebecDate(16), guests: 2 }, editing: null, health: null }

document.head.insertAdjacentHTML('beforeend', `<style>${SHARED_CSS}</style>`)

const PLACEHOLDER = `<div class="photo"></div>`
const photo = (l) => (l.photos?.[0] ? `<img src="${esc(l.photos[0])}" alt="" loading="lazy">` : PLACEHOLDER)
const loading = () => { $('main').innerHTML = `<p class="small">${t('Chargement…', 'Loading…')}</p>` }
const fail = (err) => { $('main').innerHTML = `<section class="card"><h2>${t('Erreur', 'Error')}</h2><p>${esc(errorText(err))}</p></section>` }

function go(page, extra = {}) {
  Object.assign(state, { page }, extra)
  render()
}

function chrome() {
  document.documentElement.lang = i18n.lang
  $('language').textContent = i18n.lang === 'fr' ? 'EN' : 'FR'
  const payments = state.health?.payments
  $('banner').textContent = payments === 'simulated'
    ? t('ENVIRONNEMENT DE TEST · Paiements simulés · Aucun montant n’est prélevé', 'TEST ENVIRONMENT · Simulated payments · No money is charged')
    : t('Paiement en ligne bientôt disponible', 'Online payment coming soon')
  $('foot1').textContent = t('Tous les prix sont en dollars canadiens, taxes du Québec incluses au total.', 'All prices in Canadian dollars, Québec taxes included in the total.')
  $('foot2').textContent = '9375-7649 QUÉBEC INC.'
  const nav = [['stay', 'Séjours', 'Stays'], ['trips', 'Mes réservations', 'My bookings'], ['host', 'Hôtes', 'Hosts']]
  if (api.hasRole('ADMIN')) nav.push(['admin', 'Administration', 'Admin'])
  $('nav').innerHTML = nav.map(([key, fr, en]) => `<button data-page="${key}" class="${state.page === key ? 'active' : ''}" ${state.page === key ? 'aria-current="page"' : ''}>${t(fr, en)}</button>`).join('')
  document.querySelectorAll('[data-page]').forEach((b) => { b.onclick = () => go(b.dataset.page, { listingId: null, editing: null }) })
  $('accountSlot').replaceChildren(accountBar(api, () => go(state.page)))
}
window.addEventListener('qc:auth', chrome)

async function render() {
  chrome()
  try {
    if (state.page === 'stay') await (state.listingId ? listingDetail() : search())
    else if (state.page === 'trips') await trips()
    else if (state.page === 'host') await host()
    else if (state.page === 'admin') await admin()
  } catch (err) { fail(err) }
  window.dispatchEvent(new CustomEvent('qtr:render'))
}

// ---------------- Guest: search ----------------
async function search() {
  const s = state.search
  $('main').innerHTML = `<div class="sectionhead"><span class="eyebrow">QTR · QUÉBEC</span><h1>${t('Un séjour.<br>Un accueil local.', 'A stay.<br>A local welcome.')}</h1>
    <p>${t('Des logements enregistrés et vérifiés avant publication, avec un prix total clair.', 'Registered places reviewed before publication, with a clear total price.')}</p></div>
    <div class="grid"><section class="card"><form class="form" id="stayForm">
      <label>${t('Ville', 'City')}<input id="city" value="${esc(s.city)}"></label>
      <div class="row"><label>${t('Arrivée', 'Check-in')}<input id="checkIn" type="date" min="${quebecDate()}" value="${esc(s.checkIn)}" required></label>
      <label>${t('Départ', 'Check-out')}<input id="checkOut" type="date" min="${quebecDate(1)}" value="${esc(s.checkOut)}" required></label></div>
      <label>${t('Voyageurs', 'Guests')}<input id="guests" type="number" min="1" max="30" value="${esc(s.guests)}" required></label>
      <p class="error" id="searchError" role="alert"></p>
      <button class="primary" id="searchBtn">${t('Rechercher', 'Search')}</button></form></section>
    <section class="card"><h2 id="resultsTitle">${t('Résultats', 'Results')}</h2><div id="results"><p class="small">${t('Chargement…', 'Loading…')}</p></div></section></div>`
  const run = async () => {
    const q = new URLSearchParams({ checkIn: s.checkIn, checkOut: s.checkOut, guests: String(s.guests) })
    if (s.city) q.set('city', s.city)
    const { listings } = await api.get(`/api/stays?${q}`)
    $('resultsTitle').textContent = `${t('Résultats', 'Results')} (${listings.length})`
    $('results').innerHTML = listings.length
      ? listings.map((l) => `<button class="listing" data-listing="${l.id}">${photo(l)}<div><h3>${esc(l.title)}</h3>
          <p class="small">${esc(l.city)} · ${l.maxGuests} ${t('voyageurs', 'guests')} · ${l.bedrooms} ${t('ch.', 'bd')} · ${l.beds} ${t('lits', 'beds')}</p>
          <b>${cad(l.nightlyCents)}</b> <span class="small">/ ${t('nuit', 'night')}</span></div></button>`).join('')
      : `<p>${t('Aucun logement disponible pour ces dates.', 'No places available for these dates.')}</p>`
    document.querySelectorAll('[data-listing]').forEach((b) => { b.onclick = () => go('stay', { listingId: b.dataset.listing }) })
  }
  $('stayForm').onsubmit = (e) => {
    e.preventDefault()
    Object.assign(s, { city: $('city').value.trim(), checkIn: $('checkIn').value, checkOut: $('checkOut').value, guests: Number($('guests').value) })
    if (s.checkOut <= s.checkIn) { $('searchError').textContent = t('Le départ doit suivre l’arrivée.', 'Check-out must follow check-in.'); return }
    busy($('searchBtn'), $('searchError'), run)
  }
  try { await run() } catch (err) { $('results').innerHTML = `<p class="error">${esc(errorText(err))}</p>` }
}

function quoteLines(q) {
  const label = { ACCOMMODATION: t(`${q.lines[0].nights} nuits × ${cad(q.lines[0].nightlyCents)}`, `${q.lines[0].nights} nights × ${cad(q.lines[0].nightlyCents)}`), CLEANING: t('Ménage', 'Cleaning'), SERVICE_FEE: t('Frais de service', 'Service fee') }
  return `<div class="lines">${q.lines.filter((l) => l.cents || l.code !== 'CLEANING').map((l) => `<div class="fare"><span>${label[l.code]}</span><span>${cad(l.cents)}</span></div>`).join('')}
    ${q.taxes.map((x) => `<div class="fare"><span>${esc(x.label[i18n.lang] ?? x.code)} (${pctText(x.rateBp)})</span><span>${cad(x.cents)}</span></div>`).join('')}
    <div class="fare total"><span>Total (CAD)</span><span>${cad(q.totalCents)}</span></div></div>`
}

// ---------------- Guest: listing detail, quote, book ----------------
async function listingDetail() {
  loading()
  const { listing: l, unavailable } = await api.get(`/api/stays/${state.listingId}`)
  const s = state.search
  $('main').innerHTML = `<button class="secondary" id="back">← ${t('Retour aux résultats', 'Back to results')}</button>
    <div class="grid" style="margin-top:20px"><article class="card">${l.photos.length ? `<img class="photo" src="${esc(l.photos[0])}" alt="">` : PLACEHOLDER}
      <h1 style="font-size:34px">${esc(l.title)}</h1>
      <p>${esc(l.city)} · ${l.maxGuests} ${t('voyageurs', 'guests')} · ${l.bedrooms} ${t('chambres', 'bedrooms')} · ${l.beds} ${t('lits', 'beds')} · ${l.bathrooms} ${t('salles de bain', 'baths')}</p>
      <p style="white-space:pre-line">${esc(l.description)}</p>
      ${l.amenities.length ? `<p>${l.amenities.map((a) => `<span class="pill">${esc(a)}</span>`).join(' ')}</p>` : ''}
      <p class="small">${t('N° d’enregistrement CITQ', 'CITQ registration no.')} : <b>${esc(l.registrationNumber)}</b></p>
      ${unavailable.length ? `<p class="small">${t('Dates indisponibles', 'Unavailable dates')} : ${unavailable.map((u) => `${fmtDate(u.start)} → ${fmtDate(u.end)}`).join(' · ')}</p>` : ''}
    </article>
    <section class="card"><div class="price">${cad(l.nightlyCents)} <span class="small">/ ${t('nuit', 'night')}</span></div>
      <p class="small">${t(`Minimum ${l.minNights} nuit(s)`, `Minimum ${l.minNights} night(s)`)}</p>
      <form class="form" id="quoteForm"><div class="row"><label>${t('Arrivée', 'Check-in')}<input id="qIn" type="date" min="${quebecDate()}" value="${esc(s.checkIn)}" required></label>
      <label>${t('Départ', 'Check-out')}<input id="qOut" type="date" min="${quebecDate(1)}" value="${esc(s.checkOut)}" required></label></div>
      <label>${t('Voyageurs', 'Guests')}<input id="qGuests" type="number" min="1" max="${l.maxGuests}" value="${Math.min(s.guests, l.maxGuests)}" required></label></form>
      <div id="quote"></div><p class="error" id="bookError" role="alert"></p>
      <button class="primary" id="bookBtn" disabled>${t('Réserver', 'Reserve')}</button>
      <p class="small">${t('Annulation gratuite jusqu’à 72 h avant l’arrivée (heure du Québec), puis remboursement de 50 % jusqu’à l’arrivée.', 'Free cancellation until 72 h before check-in (Québec time), then a 50% refund until check-in.')}</p></section></div>`
  $('back').onclick = () => go('stay', { listingId: null })
  const params = () => ({ checkIn: $('qIn').value, checkOut: $('qOut').value, guests: Number($('qGuests').value) })
  const refresh = async () => {
    $('bookBtn').disabled = true
    $('bookError').textContent = ''
    Object.assign(s, params())
    try {
      const { quote } = await api.post(`/api/stays/${l.id}/quote`, params())
      $('quote').innerHTML = quoteLines(quote)
      $('bookBtn').disabled = false
    } catch (err) { $('quote').innerHTML = ''; $('bookError').textContent = errorText(err) }
  }
  ;['qIn', 'qOut', 'qGuests'].forEach((id) => { $(id).onchange = refresh })
  $('bookBtn').onclick = async () => {
    if (!(await requireSignIn(api, t('Connectez-vous pour réserver. Un code vous est envoyé par courriel.', 'Sign in to reserve. We will email you a code.')))) return
    busy($('bookBtn'), $('bookError'), async () => {
      const { booking } = await api.post(`/api/stays/${l.id}/book`, params())
      checkout(booking)
    })
  }
  await refresh()
}

// Hold → payment. Payment confirmation goes through the provider once enabled.
function checkout(booking) {
  const body = openDialog(`<h2>${t('Finaliser la réservation', 'Complete your booking')}</h2>
    <p>${t('Vos dates sont retenues jusqu’à', 'Your dates are held until')} <b>${fmtDateTime(booking.holdExpiresAt)}</b>.</p>
    ${quoteLines(booking.quote)}<p class="error" id="payError" role="alert"></p>
    <div class="row"><button class="secondary" id="payLater">${t('Plus tard', 'Later')}</button><button class="primary" id="payNow">${t('Payer', 'Pay')} ${cad(booking.totalCents)}</button></div>`)
  body.querySelector('#payLater').onclick = () => { closeDialog(); go('trips') }
  body.querySelector('#payNow').onclick = () => busy(body.querySelector('#payNow'), body.querySelector('#payError'), async () => {
    const { booking: b, checkoutUrl } = await api.post(`/api/bookings/${booking.id}/checkout`)
    if (checkoutUrl) { location.assign(checkoutUrl); return }
    closeDialog()
    message(t('Réservation confirmée', 'Booking confirmed'), t(`Votre séjour du ${fmtDate(b.checkIn)} au ${fmtDate(b.checkOut)} est confirmé. Adresse : ${b.listing.address}`, `Your stay from ${fmtDate(b.checkIn)} to ${fmtDate(b.checkOut)} is confirmed. Address: ${b.listing.address}`))
    go('trips')
  })
}

// ---------------- Guest: bookings ----------------
async function trips() {
  if (!api.user) {
    $('main').innerHTML = `<section class="card"><h2>${t('Mes réservations', 'My bookings')}</h2><p>${t('Connectez-vous pour voir vos réservations.', 'Sign in to see your bookings.')}</p><button class="primary" id="tripSignIn">${t('Connexion', 'Sign in')}</button></section>`
    $('tripSignIn').onclick = async () => { if (await requireSignIn(api)) render() }
    return
  }
  loading()
  const { bookings } = await api.get('/api/bookings')
  $('main').innerHTML = `<div class="sectionhead"><span class="eyebrow">${t('VOYAGEUR', 'GUEST')}</span><h1>${t('Mes réservations', 'My bookings')}</h1></div>
    <section class="card">${bookings.length ? `<table class="table"><thead><tr><th>${t('Logement', 'Place')}</th><th>${t('Dates', 'Dates')}</th><th>Total</th><th>${t('Statut', 'Status')}</th><th></th></tr></thead><tbody>
    ${bookings.map((b) => `<tr><td><b>${esc(b.listing.title)}</b><br><span class="small">${esc(b.listing.address ?? b.listing.city)}</span></td>
      <td>${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)}</td><td>${cad(b.totalCents)}${b.refundCents != null ? `<br><span class="small">${t('Remboursé', 'Refunded')} ${cad(b.refundCents)}</span>` : ''}</td>
      <td>${statusPill(b.status)}</td><td>${b.status === 'HOLD' ? `<button class="primary" data-pay="${b.id}">${t('Payer', 'Pay')}</button> ` : ''}${['HOLD', 'CONFIRMED'].includes(b.status) ? `<button class="secondary" data-cancel="${b.id}">${t('Annuler', 'Cancel')}</button>` : ''}</td></tr>`).join('')}
    </tbody></table>` : `<p>${t('Aucune réservation pour l’instant.', 'No bookings yet.')}</p>`}</section>`
  document.querySelectorAll('[data-pay]').forEach((b) => { b.onclick = () => checkout(bookings.find((x) => x.id === b.dataset.pay)) })
  document.querySelectorAll('[data-cancel]').forEach((b) => {
    b.onclick = () => {
      if (!confirm(t('Annuler cette réservation ? Le remboursement suit la politique d’annulation.', 'Cancel this booking? The refund follows the cancellation policy.'))) return
      busy(b, null, async () => {
        const { booking } = await api.post(`/api/bookings/${b.dataset.cancel}/cancel`)
        message(t('Réservation annulée', 'Booking cancelled'), t(`Remboursement : ${cad(booking.refundCents)}`, `Refund: ${cad(booking.refundCents)}`))
        render()
      })
    }
  })
}

// ---------------- Host ----------------
async function host() {
  const head = `<div class="sectionhead"><span class="eyebrow">${t('ESPACE HÔTE', 'HOST WORKSPACE')}</span><h1>${t('Accueillez des voyageurs<br>au Québec.', 'Welcome guests<br>in Québec.')}</h1></div>`
  if (!api.user) {
    $('main').innerHTML = `${head}<section class="card"><p>${t('Connectez-vous pour créer votre dossier hôte.', 'Sign in to start your host application.')}</p><button class="primary" id="hostSignIn">${t('Connexion', 'Sign in')}</button></section>`
    $('hostSignIn').onclick = async () => { if (await requireSignIn(api)) render() }
    return
  }
  if (!api.hasRole('HOST')) {
    $('main').innerHTML = `${head}<div id="apply"></div>`
    await renderApplication($('apply'), api, 'HOST', render)
    return
  }
  if (state.editing) return listingForm(state.editing === 'new' ? null : state.editing)
  loading()
  const [{ listings }, { bookings }] = await Promise.all([api.get('/api/host/listings'), api.get('/api/host/bookings')])
  $('main').innerHTML = `${head}<div class="stack"><section class="card"><div class="row" style="justify-content:space-between"><h2 style="flex:none">${t('Mes logements', 'My listings')}</h2>
      <button class="primary" id="newListing" style="flex:none">+ ${t('Nouveau logement', 'New listing')}</button></div>
    ${listings.length ? listings.map((l) => `<div class="reviewItem"><div><b>${esc(l.title)}</b> · ${esc(l.city)} · ${cad(l.nightlyCents)}/${t('nuit', 'night')} ${statusPill(l.status)}
      ${l.reviewNote ? `<br><span class="small">${t('Note de révision', 'Review note')} : ${esc(l.reviewNote)}</span>` : ''}</div>
      <div class="actions"><button class="secondary" data-edit="${l.id}">${t('Modifier', 'Edit')}</button>
      ${['DRAFT', 'REJECTED'].includes(l.status) ? `<button class="primary" data-submit="${l.id}">${t('Soumettre', 'Submit')}</button>` : ''}
      <button class="secondary" data-calendar="${l.id}">${t('Calendrier', 'Calendar')}</button></div></div><div id="cal-${l.id}"></div>`).join('')
      : `<p>${t('Créez votre premier logement. Il sera publié après vérification.', 'Create your first listing. It is published after review.')}</p>`}</section>
    <section class="card"><h2>${t('Réservations', 'Bookings')}</h2>${bookings.length ? `<table class="table"><tbody>${bookings.map((b) => `<tr><td>${esc(b.listing.title)}</td><td>${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)}</td><td>${b.guests} ${t('voy.', 'guests')}</td>
      <td>${t('Versement', 'Payout')} ${cad(b.quote.host.payoutCents)}</td><td>${statusPill(b.status)}</td><td>${b.status === 'CONFIRMED' ? `<button class="secondary" data-hcancel="${b.id}">${t('Annuler', 'Cancel')}</button>` : ''}</td></tr>`).join('')}</tbody></table>`
      : `<p>${t('Aucune réservation confirmée.', 'No confirmed bookings yet.')}</p>`}</section></div>`
  $('newListing').onclick = () => go('host', { editing: 'new' })
  document.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => go('host', { editing: listings.find((l) => l.id === b.dataset.edit) }) })
  document.querySelectorAll('[data-submit]').forEach((b) => { b.onclick = () => busy(b, null, async () => { await api.post(`/api/host/listings/${b.dataset.submit}/submit`); message(t('Envoyé', 'Submitted'), t('Votre logement est en révision.', 'Your listing is in review.')); render() }) })
  document.querySelectorAll('[data-calendar]').forEach((b) => { b.onclick = () => calendar(b.dataset.calendar) })
  document.querySelectorAll('[data-hcancel]').forEach((b) => {
    b.onclick = () => {
      const reason = prompt(t('Motif de l’annulation (le voyageur est remboursé en totalité)', 'Reason for cancelling (the guest is refunded in full)'))
      if (reason) busy(b, null, async () => { await api.post(`/api/host/bookings/${b.dataset.hcancel}/cancel`, { reason }); render() })
    }
  })
}

async function calendar(listingId) {
  const el = $(`cal-${listingId}`)
  const draw = async () => {
    const { bookings, blocks } = await api.get(`/api/host/listings/${listingId}/calendar`)
    el.innerHTML = `<div class="notice" style="margin:0 0 14px"><b>${t('Calendrier', 'Calendar')}</b>
      ${bookings.filter((b) => b.status !== 'COMPLETED').map((b) => `<div>${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)} · ${statusPill(b.status)}</div>`).join('')}
      ${blocks.map((b) => `<div>${fmtDate(b.startDate)} → ${fmtDate(b.endDate)} · ${t('bloqué', 'blocked')} <button class="secondary" data-unblock="${b.id}">${t('Débloquer', 'Unblock')}</button></div>`).join('')}
      <form class="row" id="blockForm-${listingId}" style="margin-top:10px"><input type="date" name="startDate" min="${quebecDate()}" required><input type="date" name="endDate" min="${quebecDate(1)}" required><button class="secondary">${t('Bloquer ces dates', 'Block dates')}</button></form>
      <p class="error" id="blockError-${listingId}"></p></div>`
    el.querySelectorAll('[data-unblock]').forEach((b) => { b.onclick = () => busy(b, null, async () => { await api.del(`/api/host/blocks/${b.dataset.unblock}`); draw() }) })
    const form = $(`blockForm-${listingId}`)
    form.onsubmit = (e) => {
      e.preventDefault()
      busy(form.querySelector('button'), $(`blockError-${listingId}`), async () => { await api.post(`/api/host/listings/${listingId}/blocks`, Object.fromEntries(new FormData(form))); draw() })
    }
  }
  try { await draw() } catch (err) { el.innerHTML = `<p class="error">${esc(errorText(err))}</p>` }
}

function listingForm(l) {
  const v = (k, d = '') => esc(l?.[k] ?? d)
  $('main').innerHTML = `<button class="secondary" id="back">← ${t('Mes logements', 'My listings')}</button>
    <div class="grid" style="margin-top:20px"><section class="card"><h2>${l ? t('Modifier le logement', 'Edit listing') : t('Nouveau logement', 'New listing')}</h2>
    ${l?.status === 'PUBLISHED' ? `<p class="notice">${t('Modifier le titre, la description, l’adresse, l’enregistrement ou la capacité renvoie le logement en révision.', 'Changing the title, description, address, registration or capacity sends the listing back to review.')}</p>` : ''}
    <form class="form" id="listingForm">
      <label>${t('Titre', 'Title')}<input name="title" required minlength="5" maxlength="90" value="${v('title')}"></label>
      <label>${t('Description', 'Description')}<textarea name="description" required minlength="20" maxlength="4000" rows="5">${v('description')}</textarea></label>
      <label>${t('Adresse (communiquée après confirmation)', 'Address (shared after confirmation)')}<input name="address" required maxlength="200" value="${v('address')}"></label>
      <div class="row"><label>${t('Ville', 'City')}<input name="city" required maxlength="80" value="${v('city', 'Montréal')}"></label>
      <label>${t('N° d’enregistrement CITQ', 'CITQ registration no.')}<input name="registrationNumber" maxlength="40" value="${v('registrationNumber')}"></label></div>
      <div class="row"><label>Latitude<input name="lat" id="listingLat" type="number" step="any" required value="${v('lat', '45.5017')}"></label><label>Longitude<input name="lng" id="listingLng" type="number" step="any" required value="${v('lng', '-73.5673')}"></label></div>
      <div class="row"><label>${t('Voyageurs max', 'Max guests')}<input name="maxGuests" type="number" min="1" max="30" required value="${v('maxGuests', 2)}"></label>
      <label>${t('Chambres', 'Bedrooms')}<input name="bedrooms" type="number" min="0" max="30" required value="${v('bedrooms', 1)}"></label>
      <label>${t('Lits', 'Beds')}<input name="beds" type="number" min="1" max="50" required value="${v('beds', 1)}"></label>
      <label>${t('Salles de bain', 'Baths')}<input name="bathrooms" type="number" min="0" max="30" step="0.5" required value="${v('bathrooms', 1)}"></label></div>
      <div class="row"><label>${t('Prix par nuit (CAD)', 'Nightly price (CAD)')}<input name="nightly" type="number" min="10" step="0.01" required value="${l ? (l.nightlyCents / 100).toFixed(2) : ''}"></label>
      <label>${t('Frais de ménage (CAD)', 'Cleaning fee (CAD)')}<input name="cleaning" type="number" min="0" step="0.01" value="${l ? (l.cleaningCents / 100).toFixed(2) : '0'}"></label>
      <label>${t('Nuits min.', 'Min nights')}<input name="minNights" type="number" min="1" max="30" value="${v('minNights', 1)}"></label></div>
      <label>${t('Équipements (séparés par des virgules)', 'Amenities (comma separated)')}<input name="amenities" value="${esc((l?.amenities ?? []).join(', '))}"></label>
      <label>${t('Photos (URL https, une par ligne)', 'Photos (https URLs, one per line)')}<textarea name="photos" rows="3">${esc((l?.photos ?? []).join('\n'))}</textarea></label>
      <p class="error" id="listingError" role="alert"></p><button class="primary" id="saveListing">${t('Enregistrer', 'Save')}</button></form></section>
    <section class="card"><h2>${t('Emplacement', 'Location')}</h2><p class="small">${t('Touchez la carte pour placer le logement, ou saisissez la latitude et la longitude.', 'Tap the map to place the listing, or enter latitude and longitude.')}</p>
      <div id="qtrGoogleMap" class="map"><p class="small" style="padding:16px">${t('Carte Google : clé requise (VITE_GOOGLE_MAPS_BROWSER_KEY).', 'Google map: key required (VITE_GOOGLE_MAPS_BROWSER_KEY).')}</p></div></section></div>`
  $('back').onclick = () => go('host', { editing: null })
  const form = $('listingForm')
  form.onsubmit = (e) => {
    e.preventDefault()
    const f = Object.fromEntries(new FormData(form))
    const body = {
      title: f.title, description: f.description, address: f.address, city: f.city, registrationNumber: f.registrationNumber || null,
      lat: Number(f.lat), lng: Number(f.lng), maxGuests: Number(f.maxGuests), bedrooms: Number(f.bedrooms), beds: Number(f.beds), bathrooms: Number(f.bathrooms),
      nightlyCents: Math.round(Number(f.nightly) * 100), cleaningCents: Math.round(Number(f.cleaning || 0) * 100), minNights: Number(f.minNights || 1),
      amenities: f.amenities.split(',').map((s) => s.trim()).filter(Boolean), photos: f.photos.split('\n').map((s) => s.trim()).filter(Boolean),
    }
    busy($('saveListing'), $('listingError'), async () => {
      if (l) await api.patch(`/api/host/listings/${l.id}`, body)
      else await api.post('/api/host/listings', body)
      go('host', { editing: null })
    })
  }
}

// ---------------- Admin ----------------
async function admin() {
  if (!api.hasRole('ADMIN')) { go('stay'); return }
  loading()
  $('main').innerHTML = `<div class="sectionhead"><span class="eyebrow">${t('ADMINISTRATION', 'ADMIN')}</span><h1>${t('Vérifications', 'Reviews')}</h1></div>
    <div class="stack"><div id="hostApps"></div><div id="listingReview"></div><div id="published"></div></div>`
  await Promise.all([renderApplicationsReview($('hostApps'), api, 'HOST', render), listingReview()])
}

async function listingReview() {
  const [{ listings: pending }, { listings: published }] = await Promise.all([api.get('/api/admin/listings?status=PENDING_REVIEW'), api.get('/api/admin/listings?status=PUBLISHED')])
  $('listingReview').innerHTML = `<section class="card"><h2>${t('Logements à vérifier', 'Listings to review')} (${pending.length})</h2>
    ${pending.length ? '' : `<p>${t('Aucun logement en attente.', 'No listings waiting.')}</p>`}
    ${pending.map((l) => `<div class="reviewItem"><div><b>${esc(l.title)}</b> · ${esc(l.host.email)}<br><span class="small">${esc(l.address)}, ${esc(l.city)} · CITQ <b>${esc(l.registrationNumber)}</b> · ${l.maxGuests} ${t('voy.', 'guests')} · ${cad(l.nightlyCents)}/${t('nuit', 'night')} · ${l.photos.length} photo(s)</span></div>
      <div class="actions"><button class="primary" data-ldec="PUBLISH" data-id="${l.id}">${t('Publier', 'Publish')}</button><button class="secondary" data-ldec="REJECT" data-id="${l.id}">${t('Refuser', 'Reject')}</button></div></div>`).join('')}</section>`
  $('published').innerHTML = `<section class="card"><h2>${t('Logements publiés', 'Published listings')} (${published.length})</h2>
    ${published.map((l) => `<div class="reviewItem"><div><b>${esc(l.title)}</b> · ${esc(l.city)} · ${esc(l.host.email)}</div><div class="actions"><button class="secondary" data-ldec="SUSPEND" data-id="${l.id}">${t('Suspendre', 'Suspend')}</button></div></div>`).join('')}</section>`
  document.querySelectorAll('[data-ldec]').forEach((b) => {
    b.onclick = () => {
      const decision = b.dataset.ldec
      const note = decision === 'PUBLISH' ? undefined : prompt(t('Motif (visible par l’hôte)', 'Reason (shown to the host)'))
      if (decision !== 'PUBLISH' && !note) return
      busy(b, null, async () => { await api.post(`/api/admin/listings/${b.dataset.id}/decision`, { decision, note }); render() })
    }
  })
}

// Back from Stripe: the booking is confirmed by Stripe's webhook, so wait for it here.
async function afterStripe() {
  const paid = takeParam('paid')
  const unpaid = takeParam('unpaid')
  if (unpaid) {
    message(t('Paiement non terminé', 'Payment not completed'), t('Vos dates restent retenues jusqu’à la fin du délai. Vous pouvez payer depuis « Mes réservations ».', 'Your dates stay held until the hold ends. You can pay from "My bookings".'))
    state.page = 'trips'
  }
  if (!paid || !api.user) return
  state.page = 'trips'
  openDialog(`<h2>${t('Confirmation du paiement…', 'Confirming payment…')}</h2><p>${t('Nous attendons la confirmation de Stripe. Cela prend quelques secondes.', 'Waiting for Stripe to confirm. This takes a few seconds.')}</p>`)
  for (let i = 0; i < 20; i++) {
    const { booking: b } = await api.get(`/api/bookings/${paid}`).catch(() => ({}))
    if (b?.status === 'CONFIRMED') {
      message(t('Réservation confirmée', 'Booking confirmed'), t(`Votre séjour du ${fmtDate(b.checkIn)} au ${fmtDate(b.checkOut)} est confirmé. Adresse : ${b.listing.address}`, `Your stay from ${fmtDate(b.checkIn)} to ${fmtDate(b.checkOut)} is confirmed. Address: ${b.listing.address}`))
      return
    }
    if (b && b.status !== 'HOLD') break
    await new Promise((r) => setTimeout(r, 1500))
  }
  message(t('Paiement en cours de traitement', 'Payment processing'), t('Votre paiement est reçu mais pas encore confirmé. Votre réservation s’affichera dans « Mes réservations » dès sa confirmation.', 'Your payment is received but not yet confirmed. The booking will show in "My bookings" once confirmed.'))
}

// ---------------- Boot ----------------
$('language').onclick = () => { i18n.set(i18n.lang === 'fr' ? 'en' : 'fr'); render() }
installDialog()
;(async () => {
  try { [state.health] = await Promise.all([api.get('/api/health'), api.loadUser()]) } catch {}
  const waiting = afterStripe()
  render()
  await waiting
  render()
})()
