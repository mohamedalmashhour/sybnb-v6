// Shared e2e fixture: make a DRIVER account pass every ride-safety gate that real drivers pass —
// approved ID (sr-rides.mjs), approved inspected vehicle on duty, and every required document
// approved and unexpired (driver-base.mjs dutyBlockers). Idempotent.
const DOCS = ['LICENCE', 'CRIMINAL_RECORD', 'REGISTRATION', 'INSURANCE', 'MECHANIC_REPORT',
  'CAR_PHOTO_FRONT', 'CAR_PHOTO_BACK', 'CAR_PHOTO_LEFT', 'CAR_PHOTO_RIGHT', 'CAR_PHOTO_INSIDE', 'CAR_PHOTO_BOOT']

export async function makeDriverReady(db, userId) {
  const in30 = new Date(Date.now() + 864e5 * 120)
  await db.user.update({ where: { id: userId }, data: { idDocumentStatus: 'APPROVED' } })
  await db.driverProfile.upsert({
    where: { userId },
    create: { userId, vehicleMake: 'Kia', vehicleModel: 'Rio', vehiclePlate: `E2E-${userId.slice(0, 8)}`, vehicleStatus: 'APPROVED', vehicleCategory: 'ECONOMY', inspectionStatus: 'PASSED', inspectionExpiresAt: in30, registrationExpiresAt: in30, onDutyAt: new Date() },
    update: { vehicleMake: 'Kia', vehicleModel: 'Rio', vehiclePlate: `E2E-${userId.slice(0, 8)}`, vehicleCategory: 'ECONOMY', vehicleStatus: 'APPROVED', inspectionStatus: 'PASSED', inspectionExpiresAt: in30, registrationExpiresAt: in30, onDutyAt: new Date() },
  })
  const have = new Set((await db.driverDocument.findMany({ where: { userId, status: 'APPROVED' }, select: { kind: true } })).map((d) => d.kind))
  for (const kind of DOCS.filter((k) => !have.has(k))) {
    await db.driverDocument.create({ data: { userId, kind, storageKey: `e2e/${kind}`, mimeType: 'image/png', status: 'APPROVED', expiresAt: in30 } })
  }
}
