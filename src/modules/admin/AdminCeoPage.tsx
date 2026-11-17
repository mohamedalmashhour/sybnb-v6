import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import {
  fetchCeoAdvisories,
  runCeoAction,
  type CeoSnapshot,
  type CeoAdvisory,
} from '../../shared/api/platformApi'

type Props = { lang: Lang }

// CEO advisor (migration 084). ADMIN only. ADVISORY, MONEY-FREE, SEND-FREE. The only actions are
// "queue a CRM task" and "draft a campaign" — both write a CRM row against a chosen contact; neither
// sends, charges, pays or refunds. Sending a draft is always a separate human step.

function errText(e: unknown) { return e instanceof Error ? e.message : String(e) }

const SEV_COLOR: Record<CeoAdvisory['severity'], string> = { act: '#ff6b57', watch: '#e0b66f', info: '#6fb3e0' }

export function AdminCeoPage({ lang }: Props) {
  const t = (ar: string, en: string, fr: string) => pick(lang, ar, en, fr)
  const [snapshot, setSnapshot] = useState<CeoSnapshot | null>(null)
  const [advisories, setAdvisories] = useState<CeoAdvisory[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [contactId, setContactId] = useState('')

  async function load() {
    setLoading(true); setError('')
    try {
      const r = await fetchCeoAdvisories()
      setSnapshot(r.snapshot)
      setAdvisories(r.advisories)
    } catch (e) { setError(errText(e)) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  async function act(a: CeoAdvisory) {
    if (!a.recommendedAction) return
    if (!contactId.trim()) { setError(t('أدخل معرّف جهة اتصال أولاً.', 'Enter a target contact id first.', 'Entrez d’abord un identifiant de contact.')); return }
    setError(''); setNotice('')
    try {
      await runCeoAction({ action: a.recommendedAction, contactId: contactId.trim(), ruleKey: a.key, title: a.title, detail: a.detail })
      setNotice(a.recommendedAction === 'draft_campaign'
        ? t('تم إنشاء مسودة حملة (لم تُرسل).', 'Campaign draft created (not sent).', 'Brouillon de campagne créé (non envoyé).')
        : t('تمت إضافة مهمة CRM.', 'CRM task queued.', 'Tâche CRM ajoutée.'))
    } catch (e) { setError(errText(e)) }
  }

  const kpis: Array<[string, number | undefined]> = snapshot ? [
    [t('إقامات نشطة', 'Active listings', 'Annonces actives'), snapshot.activeListings],
    [t('سائقون', 'Drivers', 'Chauffeurs'), snapshot.activeDrivers],
    [t('طلب رحلات مفتوح', 'Open ride demand', 'Demande de courses'), snapshot.openRideDemand],
    [t('مضيفون خاملون', 'Dormant hosts', 'Hôtes inactifs'), snapshot.dormantHosts],
    [t('قيد المراجعة', 'Submitted (30d)', 'Soumises (30j)'), snapshot.submittedListings],
    [t('موافق عليها', 'Approved (30d)', 'Approuvées (30j)'), snapshot.approvedListings],
  ] : []

  return (
    <div style={S.wrap}>
      <h1 style={S.h1}>{t('مستشار القيادة (CEO)', 'CEO advisor', 'Conseiller CEO')}</h1>
      <p style={S.sub}>{t('مؤشرات للقراءة فقط وتوصيات استشارية — بلا أي حركة مالية أو إرسال.', 'Read-only signals and advisory recommendations — no money moves, nothing is sent.', 'Signaux en lecture seule et recommandations — aucun argent, aucun envoi.')}</p>

      <div style={S.kpis}>
        {kpis.map(([label, value]) => (
          <div key={label} style={S.kpi}><span style={S.kpiVal}>{value ?? '—'}</span><span style={S.kpiLabel}>{label}</span></div>
        ))}
      </div>

      <div style={S.targetRow}>
        <label style={S.muted}>{t('جهة الاتصال المستهدفة للإجراءات:', 'Target contact id for actions:', 'Contact cible des actions :')}</label>
        <input style={S.input} placeholder="contact uuid" value={contactId} onChange={(e) => setContactId(e.target.value)} />
        <button style={S.btn} onClick={() => void load()}>{t('تحديث', 'Refresh', 'Actualiser')}</button>
      </div>

      {error && <p style={S.error}>{error}</p>}
      {notice && <p style={S.notice}>{notice}</p>}
      {loading && <p style={S.muted}>…</p>}

      {advisories.length === 0 && !loading && <p style={S.ok}>{t('لا توجد إشارات تستدعي الانتباه. 👍', 'No signals need attention right now. 👍', 'Aucun signal à signaler. 👍')}</p>}

      <div style={S.cards}>
        {advisories.map((a) => (
          <div key={a.key} style={{ ...S.card, borderInlineStartColor: SEV_COLOR[a.severity] }}>
            <div style={S.cardHead}>
              <strong>{a.title}</strong>
              <span style={{ ...S.sevTag, background: SEV_COLOR[a.severity] }}>{a.severity.toUpperCase()}</span>
            </div>
            <p style={S.detail}>{a.detail}</p>
            {a.recommendedAction && (
              <button style={S.btnPrimary} onClick={() => void act(a)}>
                {a.recommendedAction === 'draft_campaign'
                  ? t('إنشاء مسودة حملة', 'Draft campaign', 'Créer un brouillon')
                  : t('أضف مهمة CRM', 'Queue CRM task', 'Ajouter une tâche CRM')}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  wrap: { padding: 16, maxWidth: 1000, margin: '0 auto' },
  h1: { fontSize: 22, margin: '8px 0 4px' },
  sub: { color: '#9fb3c8', margin: '0 0 16px', fontSize: 14 },
  kpis: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 16 },
  kpi: { background: '#111f33', border: '1px solid #1e3550', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 2 },
  kpiVal: { fontSize: 24, fontWeight: 800 },
  kpiLabel: { fontSize: 12, color: '#9fb3c8' },
  targetRow: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 },
  input: { background: '#0f1b2d', border: '1px solid #26405a', color: '#e8ecf4', borderRadius: 8, padding: '8px 10px', fontSize: 14, minWidth: 260 },
  btn: { background: 'transparent', border: '1px solid #3a5a4c', color: '#cfe0d8', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontWeight: 700 },
  btnPrimary: { background: '#e07a52', border: 0, color: '#14261f', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 800, alignSelf: 'flex-start' },
  cards: { display: 'flex', flexDirection: 'column', gap: 12 },
  card: { background: '#111f33', border: '1px solid #1e3550', borderInlineStartWidth: 4, borderInlineStartStyle: 'solid', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 },
  cardHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sevTag: { fontSize: 11, color: '#14261f', borderRadius: 999, padding: '2px 8px', fontWeight: 800 },
  detail: { margin: 0, color: '#cfddea', fontSize: 14 },
  muted: { color: '#9fb3c8', fontSize: 14 },
  ok: { color: '#8fd19e', fontSize: 15 },
  error: { color: '#ff9b8a', fontSize: 14 },
  notice: { color: '#8fd19e', fontSize: 14 },
}
