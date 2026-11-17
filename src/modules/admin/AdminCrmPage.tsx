import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { pick, type Lang } from '../../engines/language/languageEngine'
import {
  fetchCrmContacts,
  createCrmContact,
  fetchCrmContact,
  addCrmActivity,
  setCrmActivityStatus,
  type CrmContact,
  type CrmActivity,
  type CrmContactKind,
  type CrmContactStage,
} from '../../shared/api/platformApi'

type Props = { lang: Lang }

// CRM desk (migration 084). ADMIN/SUPPORT. Money-free: contacts + notes/tasks/follow-ups/campaign
// drafts. Nothing here charges, pays, refunds or sends.

const STAGES: CrmContactStage[] = ['NEW', 'ACTIVE', 'DORMANT', 'CHURNED']
const KINDS: CrmContactKind[] = ['LEAD', 'GUEST', 'HOST', 'DRIVER', 'SELLER', 'MERCHANT', 'BUSINESS']

function errText(e: unknown) { return e instanceof Error ? e.message : String(e) }

export function AdminCrmPage({ lang }: Props) {
  const t = (ar: string, en: string, fr: string) => pick(lang, ar, en, fr)
  const [contacts, setContacts] = useState<CrmContact[]>([])
  const [stage, setStage] = useState<CrmContactStage | ''>('')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<(CrmContact & { activities: CrmActivity[] }) | null>(null)
  const [newName, setNewName] = useState('')
  const [newKind, setNewKind] = useState<CrmContactKind>('LEAD')
  const [activityTitle, setActivityTitle] = useState('')

  async function load() {
    setLoading(true); setError('')
    try { setContacts(await fetchCrmContacts({ stage: stage || undefined, q })) }
    catch (e) { setError(errText(e)) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [stage]) // eslint-disable-line react-hooks/exhaustive-deps

  async function openContact(id: string) {
    setError('')
    try { setSelected(await fetchCrmContact(id)) } catch (e) { setError(errText(e)) }
  }

  async function onCreate() {
    if (!newName.trim()) return
    setError('')
    try {
      const c = await createCrmContact({ displayName: newName.trim(), kind: newKind })
      setNewName('')
      await load()
      await openContact(c.id)
    } catch (e) { setError(errText(e)) }
  }

  async function onAddActivity() {
    if (!selected || !activityTitle.trim()) return
    setError('')
    try {
      await addCrmActivity(selected.id, { title: activityTitle.trim(), kind: 'TASK' })
      setActivityTitle('')
      await openContact(selected.id)
    } catch (e) { setError(errText(e)) }
  }

  async function onToggle(a: CrmActivity) {
    setError('')
    try {
      await setCrmActivityStatus(a.id, a.status === 'DONE' ? 'OPEN' : 'DONE')
      if (selected) await openContact(selected.id)
    } catch (e) { setError(errText(e)) }
  }

  return (
    <div style={S.wrap}>
      <h1 style={S.h1}>{t('إدارة العلاقات (CRM)', 'CRM', 'CRM')}</h1>
      <p style={S.sub}>{t('جهات الاتصال والمهام والمتابعات — بلا أي حركة مالية.', 'Contacts, tasks and follow-ups — no money ever moves here.', 'Contacts, tâches et suivis — aucun mouvement d’argent.')}</p>

      <div style={S.filters}>
        <input style={S.input} placeholder={t('بحث بالاسم/البريد/الهاتف', 'Search name/email/phone', 'Rechercher')} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void load() }} />
        <select style={S.input} value={stage} onChange={(e) => setStage(e.target.value as CrmContactStage | '')}>
          <option value="">{t('كل المراحل', 'All stages', 'Toutes étapes')}</option>
          {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button style={S.btn} onClick={() => void load()}>{t('تحديث', 'Refresh', 'Actualiser')}</button>
      </div>

      <div style={S.createRow}>
        <input style={S.input} placeholder={t('اسم جهة اتصال جديدة', 'New contact name', 'Nouveau contact')} value={newName} onChange={(e) => setNewName(e.target.value)} />
        <select style={S.input} value={newKind} onChange={(e) => setNewKind(e.target.value as CrmContactKind)}>
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <button style={S.btnPrimary} onClick={() => void onCreate()}>{t('إضافة', 'Add', 'Ajouter')}</button>
      </div>

      {error && <p style={S.error}>{error}</p>}
      {loading && <p style={S.muted}>…</p>}

      <div style={S.grid}>
        <div style={S.col}>
          {contacts.map((c) => (
            <button key={c.id} style={{ ...S.card, ...(selected?.id === c.id ? S.cardOn : null) }} onClick={() => void openContact(c.id)}>
              <strong>{c.displayName}</strong>
              <span style={S.tag}>{c.kind} · {c.stage}</span>
              {c.email && <span style={S.muted}>{c.email}</span>}
            </button>
          ))}
          {!loading && contacts.length === 0 && <p style={S.muted}>{t('لا توجد جهات اتصال.', 'No contacts yet.', 'Aucun contact.')}</p>}
        </div>

        <div style={S.col}>
          {selected ? (
            <div style={S.detail}>
              <h2 style={S.h2}>{selected.displayName}</h2>
              <p style={S.muted}>{selected.kind} · {selected.stage}{selected.email ? ` · ${selected.email}` : ''}</p>
              <div style={S.createRow}>
                <input style={S.input} placeholder={t('مهمة جديدة', 'New task', 'Nouvelle tâche')} value={activityTitle} onChange={(e) => setActivityTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void onAddActivity() }} />
                <button style={S.btnPrimary} onClick={() => void onAddActivity()}>{t('أضف مهمة', 'Add task', 'Ajouter')}</button>
              </div>
              {selected.activities.map((a) => (
                <div key={a.id} style={S.activity}>
                  <label style={S.activityLabel}>
                    <input type="checkbox" checked={a.status === 'DONE'} onChange={() => void onToggle(a)} />
                    <span style={a.status === 'DONE' ? S.done : undefined}>{a.title}</span>
                  </label>
                  <span style={S.tag}>{a.kind}{a.source ? ` · ${a.source}` : ''}</span>
                </div>
              ))}
              {selected.activities.length === 0 && <p style={S.muted}>{t('لا توجد مهام بعد.', 'No activities yet.', 'Aucune activité.')}</p>}
            </div>
          ) : <p style={S.muted}>{t('اختر جهة اتصال.', 'Select a contact.', 'Sélectionnez un contact.')}</p>}
        </div>
      </div>
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  wrap: { padding: 16, maxWidth: 1100, margin: '0 auto' },
  h1: { fontSize: 22, margin: '8px 0 4px' },
  h2: { fontSize: 18, margin: '0 0 4px' },
  sub: { color: '#9fb3c8', margin: '0 0 16px', fontSize: 14 },
  filters: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 },
  createRow: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 },
  input: { background: '#0f1b2d', border: '1px solid #26405a', color: '#e8ecf4', borderRadius: 8, padding: '8px 10px', fontSize: 14 },
  btn: { background: 'transparent', border: '1px solid #3a5a4c', color: '#cfe0d8', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontWeight: 700 },
  btnPrimary: { background: '#e07a52', border: 0, color: '#14261f', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 800 },
  grid: { display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) minmax(260px, 1.4fr)', gap: 16 },
  col: { display: 'flex', flexDirection: 'column', gap: 8 },
  card: { textAlign: 'start', display: 'flex', flexDirection: 'column', gap: 2, background: '#111f33', border: '1px solid #1e3550', borderRadius: 10, padding: 12, cursor: 'pointer', color: '#e8ecf4' },
  cardOn: { borderColor: '#e07a52' },
  detail: { background: '#111f33', border: '1px solid #1e3550', borderRadius: 10, padding: 14 },
  activity: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 0', borderTop: '1px solid #1e3550' },
  activityLabel: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' },
  done: { textDecoration: 'line-through', color: '#6f8098' },
  tag: { fontSize: 12, color: '#9fb3c8' },
  muted: { color: '#9fb3c8', fontSize: 14 },
  error: { color: '#ff9b8a', fontSize: 14 },
}
