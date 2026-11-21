// "This trip is recorded" notice (owner 2026-11-20), shown to the rider and the driver for the whole
// trip. Every trip is recorded in the black box (GPS route + trip events); when in-ride audio
// recording is switched on (ride.recording.audio), the notice says so too. Clear notice is what
// privacy law (e.g. Québec Law 25) expects before recording.
type Lang = 'ar' | 'en' | 'fr'

export function TripRecordedNotice({ lang, audio = false }: { lang: Lang; audio?: boolean }) {
  const tr = (ar: string, en: string, fr: string) => (lang === 'ar' ? ar : lang === 'fr' ? fr : en)
  return (
    <div role="note" aria-live="polite" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(224,122,82,.45)', background: 'rgba(224,122,82,.08)', margin: '8px 0' }}>
      <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>●</span>
      <div>
        <strong>{tr('هذه الرحلة مسجَّلة', 'This trip is recorded', 'Ce trajet est enregistré')}</strong>
        <div style={{ fontSize: 13, opacity: 0.85 }}>
          {audio
            ? tr('يُحفظ مسار الرحلة وأحداثها وقد يُسجَّل الصوت، من أجل سلامة الجميع.', 'The route, trip events and audio may be recorded for everyone’s safety.', 'Le parcours, les événements du trajet et l’audio peuvent être enregistrés pour la sécurité de tous.')
            : tr('يُحفظ مسار الرحلة وأحداثها من أجل سلامة الجميع.', 'The route and trip events are saved for everyone’s safety.', 'Le parcours et les événements du trajet sont conservés pour la sécurité de tous.')}
        </div>
      </div>
    </div>
  )
}
