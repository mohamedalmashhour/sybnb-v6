export type GooglePoint = { lat: number; lng: number }
export type GoogleListener = { remove(): void }
export type GoogleMapHandle = {
  addListener(type: string, handler: (event: { latLng?: { lat(): number; lng(): number } }) => void): GoogleListener
  panTo(point: GooglePoint): void
  fitBounds(bounds: GoogleBounds, padding?: number): void
}
export type GoogleBounds = { extend(point: GooglePoint): void }
export type GoogleMarker = { map: GoogleMapHandle | null; position: GooglePoint }
export type GoogleMapsSdk = {
  Map: new (container: HTMLElement, options: Record<string, unknown>) => GoogleMapHandle
  LatLngBounds: new () => GoogleBounds
  marker: { AdvancedMarkerElement: new (options: Record<string, unknown>) => GoogleMarker }
  event?: { clearInstanceListeners(map: GoogleMapHandle): void }
}
export function validMapPoint(value: unknown): value is GooglePoint
export function loadGoogleMaps(options: { apiKey: string; language?: string }): Promise<GoogleMapsSdk>
export function createGoogleMapCapsule(options: {
  container: HTMLElement; apiKey: string; mapId: string; center: GooglePoint;
  language?: string; onSelect?: (point: GooglePoint) => void
}): { setPoint(point: GooglePoint): boolean; dispose(): void }
