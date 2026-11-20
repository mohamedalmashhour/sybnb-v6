import type { Plugin } from 'vite'
import { brandSkin } from './brandPlugin'

// Kept for the existing Rezekme app configs: Rezekme is now one entry in brands/registry.mjs and
// uses the generic brand skin (same renaming rules as before).
export function rezekmeBrand(): Plugin {
  return brandSkin('rezekme')
}
