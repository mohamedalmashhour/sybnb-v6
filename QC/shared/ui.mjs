// Shared UI pieces for QRide and QTR: language, formatting, dialog, email-code sign-in,
// host/driver applications and the admin application review.

export const i18n = {
  lang: (() => { try { return localStorage.getItem('qc.lang') || 'fr' } catch { return 'fr' } })(),
  set(lang) { this.lang = lang; try { localStorage.setItem('qc.lang', lang) } catch {} },
}
export const t = (fr, en) => (i18n.lang === 'fr' ? fr : en)
export const $ = (id) => document.getElementById(id)

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c])

export const cad = (cents) => new Intl.NumberFormat(i18n.lang === 'fr' ? 'fr-CA' : 'en-CA', { style: 'currency', currency: 'CAD' }).format((cents ?? 0) / 100)
export const pctText = (bp) => new Intl.NumberFormat(i18n.lang === 'fr' ? 'fr-CA' : 'en-CA', { style: 'percent', maximumFractionDigits: 3 }).format(bp / 10_000)
export const fmtDate = (iso) => new Intl.DateTimeFormat(i18n.lang === 'fr' ? 'fr-CA' : 'en-CA', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))
export const fmtDateTime = (v) => new Intl.DateTimeFormat(i18n.lang === 'fr' ? 'fr-CA' : 'en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto' }).format(new Date(v))

// Today's date in Québec as YYYY-MM-DD, plus N days.
export function quebecDate(addDays = 0) {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const d = new Date(`${s}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + addDays)
  return d.toISOString().slice(0, 10)
}

export const errorText = (err) => (err?.code === 'NETWORK'
  ? t('Le service QC est injoignable. Démarrez-le avec « npm run qc:api ».', 'The QC service is unreachable. Start it with "npm run qc:api".')
  : err?.message || t('Une erreur est survenue.', 'Something went wrong.'))

export const statusPill = (s) => `<span class="status status-${esc(String(s).toLowerCase())}">${esc(statusLabel(s))}</span>`
const STATUS = {
  PENDING: ['En attente', 'Pending'], PAID: ['Payé', 'Paid'], APPROVED: ['Approuvé', 'Approved'], REJECTED: ['Refusé', 'Rejected'],
  DRAFT: ['Brouillon', 'Draft'], PENDING_REVIEW: ['En révision', 'In review'], PUBLISHED: ['Publié', 'Published'], SUSPENDED: ['Suspendu', 'Suspended'],
  HOLD: ['Retenu', 'On hold'], CONFIRMED: ['Confirmé', 'Confirmed'], CANCELLED: ['Annulé', 'Cancelled'], EXPIRED: ['Expiré', 'Expired'], COMPLETED: ['Terminé', 'Completed'],
  PAYMENT_PENDING: ['Paiement en attente', 'Awaiting payment'], REQUESTED: ['Recherche chauffeur', 'Finding driver'], ACCEPTED: ['Chauffeur en route', 'Driver on the way'], ARRIVED: ['Chauffeur arrivé', 'Driver arrived'], IN_PROGRESS: ['En course', 'In progress'],
}
export const statusLabel = (s) => (STATUS[s] ? t(...STATUS[s]) : s)

// ---- Dialog ----
export function openDialog(html) {
  const dialog = $('modal')
  $('modalBody').innerHTML = html
  if (!dialog.open) dialog.showModal()
  return $('modalBody')
}
export const closeDialog = () => $('modal').open && $('modal').close()
export function message(title, text) {
  const body = openDialog(`<h2>${esc(title)}</h2><p>${esc(text)}</p><button class="primary" id="dlgOk">OK</button>`)
  body.querySelector('#dlgOk').onclick = closeDialog
}

export function installDialog() {
  $('close').onclick = closeDialog
}

// Busy-state wrapper for form submits: disables the button and shows errors in `errorEl`.
export async function busy(button, errorEl, fn) {
  if (errorEl) errorEl.textContent = ''
  button.disabled = true
  try { return await fn() } catch (err) {
    if (errorEl) errorEl.textContent = errorText(err)
    else message(t('Erreur', 'Error'), errorText(err))
  } finally { button.disabled = false }
}

// ---- Email-code sign-in ----
export function signIn(api, { reason } = {}) {
  return new Promise((resolve) => {
    let email = ''
    const dialog = $('modal')
    const onClose = () => { dialog.removeEventListener('close', onClose); resolve(api.user) }
    dialog.addEventListener('close', onClose)
    const step1 = () => {
      const body = openDialog(`<h2>${t('Connexion', 'Sign in')}</h2>
        <p>${esc(reason || t('Recevez un code à usage unique par courriel. Aucun mot de passe.', 'Get a one-time code by email. No password.'))}</p>
        <form class="form" id="emailForm"><label>${t('Courriel', 'Email')}<input id="authEmail" type="email" autocomplete="email" required value="${esc(email)}"></label>
        <p class="error" id="authError" role="alert"></p><button class="primary" id="authSend">${t('Recevoir le code', 'Send code')}</button></form>`)
      body.querySelector('#authEmail').focus()
      body.querySelector('#emailForm').onsubmit = (e) => {
        e.preventDefault()
        email = body.querySelector('#authEmail').value.trim()
        busy(body.querySelector('#authSend'), body.querySelector('#authError'), async () => {
          await api.post('/api/auth/code', { email, locale: i18n.lang })
          step2()
        })
      }
    }
    const step2 = () => {
      const body = openDialog(`<h2>${t('Entrez le code', 'Enter the code')}</h2>
        <p>${t(`Un code à 6 chiffres a été envoyé à ${esc(email)}. Il expire dans 10 minutes.`, `A 6-digit code was sent to ${esc(email)}. It expires in 10 minutes.`)}</p>
        <form class="form" id="codeForm"><label>${t('Code', 'Code')}<input id="authCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>
        <p class="error" id="authError" role="alert"></p>
        <div class="row"><button type="button" class="secondary" id="authBack">${t('Changer de courriel', 'Change email')}</button><button class="primary" id="authVerify">${t('Se connecter', 'Sign in')}</button></div></form>`)
      body.querySelector('#authCode').focus()
      body.querySelector('#authBack').onclick = step1
      body.querySelector('#codeForm').onsubmit = (e) => {
        e.preventDefault()
        busy(body.querySelector('#authVerify'), body.querySelector('#authError'), async () => {
          await api.verify(email, body.querySelector('#authCode').value.trim())
          closeDialog()
          window.dispatchEvent(new Event('qc:auth'))
        })
      }
    }
    step1()
  })
}

export async function requireSignIn(api, reason) {
  if (api.user) return api.user
  return signIn(api, { reason })
}

export function accountBar(api, onChange) {
  const el = document.createElement('div')
  el.className = 'account'
  if (api.user) {
    el.innerHTML = `<span class="small">${esc(api.user.email)}</span><button class="lang" id="signOut">${t('Déconnexion', 'Sign out')}</button>`
    el.querySelector('#signOut').onclick = async () => { await api.logout(); onChange() }
  } else {
    el.innerHTML = `<button class="lang" id="signInBtn">${t('Connexion', 'Sign in')}</button>`
    el.querySelector('#signInBtn').onclick = async () => { await signIn(api); onChange() }
  }
  return el
}

// ---- Role applications ----
export async function renderApplication(container, api, role, onChange) {
  const { applications } = await api.get('/api/applications')
  const latest = applications.find((a) => a.role === role)
  if (latest?.status === 'PENDING') {
    container.innerHTML = `<section class="card"><span class="eyebrow">${t('DEMANDE', 'APPLICATION')}</span><h2>${t('Votre dossier est en révision', 'Your application is under review')}</h2>
      <p>${t('Un administrateur vérifie vos informations. Vous aurez accès dès l’approbation.', 'An admin is reviewing your details. You will get access once approved.')}</p>${statusPill('PENDING')}</section>`
    return
  }
  const driver = role === 'DRIVER'
  const year = new Date().getFullYear()
  container.innerHTML = `<section class="card">
    <span class="eyebrow">${driver ? t('DEVENIR CHAUFFEUR', 'BECOME A DRIVER') : t('DEVENIR HÔTE', 'BECOME A HOST')}</span>
    <h2>${driver ? t('Votre dossier chauffeur', 'Your driver application') : t('Votre dossier hôte', 'Your host application')}</h2>
    ${latest?.status === 'REJECTED' ? `<p class="notice">${t('Demande précédente refusée', 'Previous application rejected')}: ${esc(latest.note)}</p>` : ''}
    <form class="form" id="applyForm">
      <label>${t('Nom légal', 'Legal name')}<input name="legalName" required maxlength="120"></label>
      <label>${t('Téléphone', 'Phone')}<input name="phone" type="tel" required maxlength="30" placeholder="+1 514 555 0000"></label>
      ${driver ? `
        <div class="row"><label>${t('N° de permis', 'Licence number')}<input name="licenceNumber" required maxlength="40"></label>
        <label>${t('Expiration du permis', 'Licence expiry')}<input name="licenceExpiry" type="date" required min="${quebecDate(1)}"></label></div>
        <label>${t('Expiration de l’assurance', 'Insurance expiry')}<input name="insuranceExpiry" type="date" required min="${quebecDate(1)}"></label>
        <label>${t('Catégorie', 'Category')}<select name="category"><option value="STANDARD">Standard</option><option value="COMFORT">Confort</option><option value="XL">XL (6)</option></select></label>
        <div class="row"><label>${t('Marque', 'Make')}<input name="make" required maxlength="40"></label><label>${t('Modèle', 'Model')}<input name="model" required maxlength="40"></label></div>
        <div class="row"><label>${t('Année', 'Year')}<input name="year" type="number" required min="${year - 15}" max="${year + 1}"></label><label>${t('Couleur', 'Colour')}<input name="colour" required maxlength="30"></label><label>${t('Plaque', 'Plate')}<input name="plate" required maxlength="12"></label></div>`
      : `<label>${t('Adresse', 'Address')}<input name="address" required maxlength="200"></label>`}
      <p class="small">${t('Les pièces justificatives (permis, assurance, enregistrement) seront demandées par l’équipe de vérification.', 'Supporting documents (licence, insurance, registration) will be requested by the review team.')}</p>
      <p class="error" id="applyError" role="alert"></p>
      <button class="primary" id="applySubmit">${t('Envoyer ma demande', 'Submit application')}</button>
    </form></section>`
  const form = container.querySelector('#applyForm')
  form.onsubmit = (e) => {
    e.preventDefault()
    const f = Object.fromEntries(new FormData(form))
    const details = driver
      ? { legalName: f.legalName, phone: f.phone, licenceNumber: f.licenceNumber, licenceExpiry: f.licenceExpiry, insuranceExpiry: f.insuranceExpiry, category: f.category, vehicle: { make: f.make, model: f.model, year: Number(f.year), colour: f.colour, plate: f.plate } }
      : { legalName: f.legalName, phone: f.phone, address: f.address }
    busy(container.querySelector('#applySubmit'), container.querySelector('#applyError'), async () => {
      await api.post('/api/applications', { role, details })
      onChange()
    })
  }
}

// ---- Admin: role applications ----
export async function renderApplicationsReview(container, api, role, onChange) {
  const { applications } = await api.get('/api/admin/applications?status=PENDING')
  const mine = applications.filter((a) => a.role === role)
  container.innerHTML = `<section class="card"><h2>${role === 'DRIVER' ? t('Chauffeurs à vérifier', 'Drivers to review') : t('Hôtes à vérifier', 'Hosts to review')} (${mine.length})</h2>
    ${mine.length ? '' : `<p>${t('Aucune demande en attente.', 'No pending applications.')}</p>`}
    ${mine.map((a) => `<div class="reviewItem">
      <div><b>${esc(a.details.legalName)}</b> · ${esc(a.user.email)} · ${esc(a.details.phone)}<br>
      <span class="small">${role === 'DRIVER'
        ? `${esc(a.details.vehicle.year)} ${esc(a.details.vehicle.make)} ${esc(a.details.vehicle.model)} · ${esc(a.details.vehicle.colour)} · ${esc(a.details.vehicle.plate)} · ${esc(a.details.category)} · ${t('permis', 'licence')} ${esc(a.details.licenceNumber)} → ${esc(a.details.licenceExpiry)} · ${t('assurance', 'insurance')} → ${esc(a.details.insuranceExpiry)}`
        : esc(a.details.address)} · ${fmtDateTime(a.createdAt)}</span></div>
      <div class="actions"><button class="primary" data-approve="${a.id}">${t('Approuver', 'Approve')}</button><button class="secondary" data-reject="${a.id}">${t('Refuser', 'Reject')}</button></div>
    </div>`).join('')}</section>`
  container.querySelectorAll('[data-approve]').forEach((b) => { b.onclick = () => busy(b, null, async () => { await api.post(`/api/admin/applications/${b.dataset.approve}/decision`, { decision: 'APPROVE' }); onChange() }) })
  container.querySelectorAll('[data-reject]').forEach((b) => {
    b.onclick = () => {
      const note = prompt(t('Motif du refus (visible par le demandeur)', 'Reason for rejection (shown to the applicant)'))
      if (note) busy(b, null, async () => { await api.post(`/api/admin/applications/${b.dataset.reject}/decision`, { decision: 'REJECT', note }); onChange() })
    }
  })
}

export const SHARED_CSS = `
[hidden]{display:none!important}
.account{display:flex;gap:8px;align-items:center}
textarea{width:100%;padding:13px 14px;border:1px solid var(--line);border-radius:11px;background:#fbfcf9;color:var(--ink);font:inherit}
.map{min-height:240px}
.error{color:#a3322a;font-size:13px;margin:0;min-height:0}
.error:empty{display:none}
button:disabled{opacity:.55;cursor:progress}
.status-cancelled,.status-expired,.status-rejected,.status-suspended{background:#f6e1dc}
.status-pending,.status-pending_review,.status-hold,.status-requested,.status-payment_pending{background:#f4efd9}
.reviewItem{display:flex;justify-content:space-between;gap:16px;align-items:center;border-bottom:1px solid var(--line);padding:14px 0}
.reviewItem .actions{display:flex;gap:8px;flex:none}
.reviewItem .actions button{padding:9px 13px}
.listing{display:grid;grid-template-columns:150px 1fr;gap:16px;border-bottom:1px solid var(--line);padding:16px 0;cursor:pointer;text-align:left;background:none;border-width:0 0 1px;width:100%;color:inherit}
.listing img,.photo{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:14px;background:#e4e5d9}
.listing h3{margin:0 0 6px}
.lines .fare{padding:9px 0;font-size:14px}
.lines .total{font-weight:750;font-size:17px;border-bottom:0}
.stack{display:grid;gap:18px}
@media(max-width:760px){.reviewItem{flex-direction:column;align-items:flex-start}.listing{grid-template-columns:1fr}}
`

// Reads and removes a one-time query parameter set by the Stripe return URLs.
export function takeParam(name) {
  const url = new URL(location.href)
  const value = url.searchParams.get(name)
  if (value) {
    url.searchParams.delete(name)
    history.replaceState(null, '', url.pathname + (url.search || '') + url.hash)
  }
  return value
}
