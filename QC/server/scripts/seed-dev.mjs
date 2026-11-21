// Dev-only sample data for QC_DATABASE_URL: an approved host with published listings and an
// approved driver. Idempotent. Refuses to run with NODE_ENV=production.
import { db, disconnectDb } from '../lib/db.mjs'

if (process.env.NODE_ENV === 'production') {
  console.error('seed-dev refuses to run in production')
  process.exit(1)
}

const future = new Date(Date.UTC(new Date().getUTCFullYear() + 2, 0, 1))

async function user(email, name, roles) {
  return db().user.upsert({ where: { email }, create: { email, name, roles }, update: { roles, name, status: 'ACTIVE' } })
}

const host = await user('host@qc.local', 'Hôte Démo', ['GUEST', 'HOST'])
const driver = await user('driver@qc.local', 'Chauffeur Démo', ['GUEST', 'DRIVER'])
await db().driverProfile.upsert({
  where: { userId: driver.id },
  create: { userId: driver.id, category: 'STANDARD', vehicle: { make: 'Toyota', model: 'Corolla', year: 2023, colour: 'Gris', plate: 'QCD001' }, licenceExpiry: future, insuranceExpiry: future },
  update: { licenceExpiry: future, insuranceExpiry: future },
})

const listings = [
  { title: 'Loft lumineux au Plateau', city: 'Montréal', address: '4321 rue Saint-Denis', lat: 45.5236, lng: -73.5817, nightlyCents: 14500, cleaningCents: 6000, maxGuests: 2, bedrooms: 1, beds: 1, bathrooms: 1, minNights: 2, registrationNumber: '300001' },
  { title: 'Condo avec vue sur le Vieux-Port', city: 'Montréal', address: '100 rue de la Commune Ouest', lat: 45.5075, lng: -73.5523, nightlyCents: 22000, cleaningCents: 8000, maxGuests: 4, bedrooms: 2, beds: 2, bathrooms: 1.5, minNights: 1, registrationNumber: '300002' },
  { title: 'Maison ancestrale dans le Vieux-Québec', city: 'Québec', address: '25 rue Saint-Louis', lat: 46.8123, lng: -71.2055, nightlyCents: 18900, cleaningCents: 7500, maxGuests: 5, bedrooms: 3, beds: 3, bathrooms: 2, minNights: 2, registrationNumber: '300003' },
]
for (const l of listings) {
  const existing = await db().listing.findFirst({ where: { hostId: host.id, title: l.title } })
  if (existing) continue
  await db().listing.create({
    data: { ...l, hostId: host.id, status: 'PUBLISHED', amenities: ['Wi-Fi', 'Cuisine', 'Chauffage'], description: `${l.title}. Logement de démonstration pour l’environnement de test QC — aucune réservation réelle.` },
  })
}
console.log('Seeded: host@qc.local (HOST, 3 published listings), driver@qc.local (DRIVER, STANDARD, QCD001)')
// Q EAT demo restaurants (clearly marked as demo; no real orders or payments).
const resto = await user('resto@qc.local', 'Restaurateur Démo', ['GUEST', 'MERCHANT'])
const demoMerchants = [
  { name: 'Casse-croûte du Plateau (démo)', category: 'fastfood', address: '4400 rue Saint-Denis, Montréal', lat: 45.5245, lng: -73.5822, prepMinutes: 15,
    items: [['Poutines', 'Poutine classique', 1195, 'Lait'], ['Poutines', 'Poutine italienne', 1395, 'Lait, gluten'], ['Burgers', 'Burger maison', 1495, 'Gluten, lait, œuf'], ['Boissons', 'Limonade', 395, null]] },
  { name: 'Bagels Mile End (démo)', category: 'bakery', address: '120 rue Saint-Viateur O, Montréal', lat: 45.5230, lng: -73.6005, prepMinutes: 10,
    items: [['Bagels', 'Bagel sésame (6)', 900, 'Gluten, sésame'], ['Bagels', 'Bagel saumon fumé', 1250, 'Gluten, poisson, lait'], ['Café', 'Café filtre', 300, null]] },
  { name: 'Pho Centre-Ville (démo)', category: 'restaurant', address: '1050 boul. Saint-Laurent, Montréal', lat: 45.5080, lng: -73.5610, prepMinutes: 20,
    items: [['Soupes', 'Pho au bœuf', 1450, 'Soja'], ['Soupes', 'Pho végé', 1350, 'Soja'], ['Entrées', 'Rouleaux impériaux (2)', 650, 'Gluten']] },
]
for (const dm of demoMerchants) {
  let m = await db().merchant.findFirst({ where: { ownerId: resto.id, name: dm.name } })
  if (!m) {
    m = await db().merchant.create({ data: { ownerId: resto.id, name: dm.name, category: dm.category, address: dm.address, lat: dm.lat, lng: dm.lng, prepMinutes: dm.prepMinutes, status: 'APPROVED', permitNumber: 'DEMO-MAPAQ', neq: '0000000000', description: 'Restaurant de démonstration — environnement de test, aucune commande réelle.' } })
    let sort = 0
    for (const [section, name, priceCents, allergens] of dm.items) await db().menuItem.create({ data: { merchantId: m.id, section, name, priceCents, allergens, sort: sort++ } })
  }
}
console.log('Seeded: resto@qc.local (MERCHANT, 3 demo restaurants)')
await disconnectDb()
