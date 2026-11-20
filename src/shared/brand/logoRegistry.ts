import { BRAND_NAME } from './brandName'
export type LogoKey =
  | 'platform'
  | 'archMonogram'
  | 'gridArabic'
  | 'stays'
  | 'property'
  | 'cars'
  | 'marketplace'
  | 'wallet'
  | 'finance'
  | 'plus'
  | 'aiBrain'
  | 'srRide'

export type LogoAsset = {
  key: LogoKey
  src: string
  label: string
  usage: string
}

export const LOGO_ASSETS: Record<LogoKey, LogoAsset> = {
  platform: {
    key: 'platform',
    src: '/assets/logos/sybnb-platform.png',
    label: `${BRAND_NAME} Platform`,
    usage: 'Main platform navigation and landing.',
  },
  archMonogram: {
    key: 'archMonogram',
    src: '/assets/logos/sybnb-arch-monogram.png',
    label: `${BRAND_NAME} Arch Monogram`,
    usage: 'Square app mark, splash, favicon candidate.',
  },
  gridArabic: {
    key: 'gridArabic',
    src: '/assets/logos/sybnb-grid-arabic.png',
    label: `${BRAND_NAME} Grid Arabic`,
    usage: 'Arabic-first marketing lockup.',
  },
  stays: {
    key: 'stays',
    src: '/assets/logos/str-short-rent.png',
    label: 'STR - Stay Trust Relax',
    usage: 'Stay. Trust. Relax. Short-term rental division and STR admin control room.',
  },
  property: {
    key: 'property',
    src: '/assets/logos/sybnb-property.png',
    label: `${BRAND_NAME} Property`,
    usage: 'Property, buy, rentals, and new construction.',
  },
  cars: {
    key: 'cars',
    src: '/assets/logos/sybnb-cars.png',
    label: `${BRAND_NAME} Cars`,
    usage: 'Cars marketplace division.',
  },
  marketplace: {
    key: 'marketplace',
    src: '/assets/logos/sybnb-marketplace.png',
    label: `${BRAND_NAME} Marketplace`,
    usage: 'General marketplace division.',
  },
  wallet: {
    key: 'wallet',
    src: '/assets/logos/sybnb-wallet.png',
    label: `${BRAND_NAME} Wallet`,
    usage: 'Wallet, prepaid credit, and gift credit flows.',
  },
  finance: {
    key: 'finance',
    src: '/assets/logos/sybnb-finance.png',
    label: `${BRAND_NAME} Finance`,
    usage: 'Finance, proof review, and payment admin flows.',
  },
  plus: {
    key: 'plus',
    src: '/assets/logos/sybnb-plus.png',
    label: `${BRAND_NAME} Plus`,
    usage: 'Plus plan and premium account surfaces.',
  },
  aiBrain: {
    key: 'aiBrain',
    src: '/assets/logos/sybnb-ai-brain.png',
    label: `${BRAND_NAME} AI Brain`,
    usage: 'AI Brain autonomous manager and owner dashboards.',
  },
  srRide: {
    key: 'srRide',
    src: '/assets/logos/sr-ride.png',
    label: 'SR Ride',
    usage: 'SR ride app and future ride division.',
  },
}

export function getLogoAsset(key: LogoKey) {
  return LOGO_ASSETS[key]
}
