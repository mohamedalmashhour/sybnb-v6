// Syria: governorate slug -> the English city name stored in Location.city (what the browse/search
// city filter matches). MUST mirror server/lib/listing-location.mjs GOV_SLUG_TO_CITY.
// Country data: reached from master code only through src/engines/search/index.ts.
export const GOVERNORATE_CITY_NAME: Record<string, string> = {
  damascus: 'Damascus',
  'rif-dimashq': 'Rif Dimashq',
  aleppo: 'Aleppo',
  homs: 'Homs',
  hama: 'Hama',
  latakia: 'Latakia',
  tartus: 'Tartus',
  idlib: 'Idlib',
  daraa: 'Daraa',
  sweida: 'As-Suwayda',
  'deir-ezzor': 'Deir ez-Zor',
  raqqa: 'Raqqa',
  hasakah: 'Al-Hasakah',
  quneitra: 'Quneitra',
}
