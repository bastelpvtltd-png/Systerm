import { useEffect, useState } from 'react'
import AdminLayout, { TAB_ITEMS, SECTION_ITEMS, usePermission } from '@/components/admin/AdminLayout'
import { supabase, authHeader } from '@/lib/supabase'
import { Users, Plus, Edit2, X, Save, Trash2, Loader, BarChart2, ChevronDown, ChevronRight } from 'lucide-react'

interface Profile {
  id: string
  username: string
  full_name: string
  position: string
  designation: string
  personal_email: string
  official_email: string
  whatsapp_number: string
  contact_number: string
  is_admin: boolean
  is_owner?: boolean
  allowed_tabs: string[]
  assigned_shippers: string[]
  is_shipper?: boolean
  shipper_name?: string
  created_at: string
}

// Sentinel stored in assigned_shippers meaning "every shipper" — checked for
// server-side in shipment-overview.ts instead of trying to enumerate and
// store every current + future exporter name.
const ALL_SHIPPERS = '__ALL__'

const emptyForm = {
  username: '', full_name: '', position: '', designation: '',
  personal_email: '', official_email: '', whatsapp_number: '', contact_number: '',
  password: '', is_admin: false, is_owner: false, allowed_tabs: [] as string[], assigned_shippers: [] as string[],
  is_shipper: false, shipper_name: '',
}

export default function UsersPage() {
  const { isAdmin } = usePermission()
  const [users, setUsers] = useState<Profile[]>([])
  const [modal, setModal] = useState(false)
  const [editId, setEditId] = useState<string|null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [shipperList, setShipperList] = useState<string[]>([])

  useEffect(() => {
    fetchUsers()
    fetchShippers()
    const t = setInterval(fetchUsers, 20000)
    return () => clearInterval(t)
  }, [])

  async function fetchUsers() {
    const { data } = await supabase.from('profiles').select('*').order('created_at')
    setUsers((data as any) ?? [])
  }

  async function fetchShippers() {
    // cusdec's RLS only allows service-role reads — a direct client-side
    // supabase.from('cusdec') call (even from a logged-in admin) always
    // came back empty, which is why this list showed "No exporters found"
    // regardless of how much data actually existed. Routing through the
    // existing service-role-backed endpoint is what every other cusdec
    // read in this app already does.
    const res = await fetch('/api/list-records?table=cusdec&limit=1000', { headers: await authHeader() })
    const d = await res.json()
    // exporter is often a multi-line address block — only the first line is
    // the actual company name, and it's what shipment-overview.ts's own
    // access check compares assigned_shippers against (server-side, since
    // that's the endpoint that can leak another shipper's data). Normalizing
    // the same way here is what makes an assignment actually match anything.
    const names: string[] = Array.from(new Set(
      ((d.records ?? []) as any[]).map((r: any) => (r.exporter || '').split('\n')[0].trim()).filter(Boolean)
    )).sort() as string[]
    setShipperList(names)
  }

  function toggleTab(href: string) {
    const sectionKeys = SECTION_ITEMS.filter(s => s.tabHref === href).map(s => s.key)
    setForm(f => {
      const isAdding = !f.allowed_tabs.includes(href)
      if (isAdding) {
        return { ...f, allowed_tabs: [...f.allowed_tabs, href, ...sectionKeys.filter(k => !f.allowed_tabs.includes(k))] }
      } else {
        return { ...f, allowed_tabs: f.allowed_tabs.filter(h => h !== href && !sectionKeys.includes(h)) }
      }
    })
  }

  function toggleShipper(name: string) {
    setForm(f => ({
      ...f,
      assigned_shippers: f.assigned_shippers.includes(name)
        ? f.assigned_shippers.filter(s => s !== name)
        : [...f.assigned_shippers, name],
    }))
  }

  async function handleSave() {
    setSaving(true)
    setSaveError('')
    const patch = {
      username: form.username, full_name: form.full_name, position: form.position, designation: form.designation,
      personal_email: form.personal_email, official_email: form.official_email,
      whatsapp_number: form.whatsapp_number, contact_number: form.contact_number,
      is_admin: form.is_admin, is_owner: form.is_owner, allowed_tabs: form.allowed_tabs,
      assigned_shippers: form.assigned_shippers,
      is_shipper: form.is_shipper, shipper_name: form.is_shipper ? form.shipper_name.trim() : null,
    }
    try {
      if (editId) {
        const { error } = await supabase.from('profiles').update(patch).eq('id', editId)
        if (error) throw error
      } else {
        if (!form.password) throw new Error('Password required for a new account')
        const res = await fetch('/api/create-user', {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
          body: JSON.stringify({ ...patch, password: form.password }),
        })
        const d = await res.json()
        if (!res.ok) throw new Error(d.error || 'Account creation failed')
      }
      setModal(false)
      fetchUsers()
    } catch (e: any) {
      setSaveError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Advanced access tree state ────────────────────────────────────────────
  const [permSearch, setPermSearch] = useState('')
  const [expandedTabs, setExpandedTabs] = useState<string[]>([])
  function toggleExpanded(href: string) {
    setExpandedTabs(prev => prev.includes(href) ? prev.filter(h => h !== href) : [...prev, href])
  }
  // Tabs paired with their own panels, filtered by the search box — a tab
  // matches if its own label matches, OR any of its panels do (in which case
  // only the matching panels are listed under it).
  const visibleTabs = TAB_ITEMS.map(tab => {
    const all = SECTION_ITEMS.filter(s => s.tabHref === tab.href)
    const q = permSearch.trim().toLowerCase()
    if (!q) return { tab, sections: all }
    const tabMatches = tab.label.toLowerCase().includes(q)
    const matching = all.filter(s => s.label.toLowerCase().includes(q))
    if (!tabMatches && matching.length === 0) return null
    return { tab, sections: tabMatches ? all : matching }
  }).filter(Boolean) as { tab: typeof TAB_ITEMS[number]; sections: typeof SECTION_ITEMS }[]

  const grantedTabCount = TAB_ITEMS.filter(t => form.allowed_tabs.includes(t.href)).length
  const grantedPanelCount = SECTION_ITEMS.filter(s => form.allowed_tabs.includes(s.key)).length

  function grantEverything() {
    setForm(f => ({ ...f, allowed_tabs: [...TAB_ITEMS.map(t => t.href), ...SECTION_ITEMS.map(s => s.key)] }))
  }
  function setSectionsForTab(href: string, on: boolean) {
    const keys = SECTION_ITEMS.filter(s => s.tabHref === href).map(s => s.key)
    setForm(f => ({
      ...f,
      allowed_tabs: on
        ? Array.from(new Set([...f.allowed_tabs, ...keys]))
        : f.allowed_tabs.filter(k => !keys.includes(k)),
    }))
  }

  const [workUser, setWorkUser] = useState<Profile | null>(null)
  const [workReports, setWorkReports] = useState<any[]>([])
  const [workLoading, setWorkLoading] = useState(false)
  async function openUserWork(u: Profile) {
    setWorkUser(u); setWorkLoading(true); setWorkReports([])
    try {
      const res = await fetch(`/api/balance-reports?user_id=${u.id}`, { headers: await authHeader() })
      const d = await res.json()
      if (res.ok) setWorkReports(d.reports || [])
    } finally {
      setWorkLoading(false)
    }
  }

  const [deletingId, setDeletingId] = useState<string | null>(null)
  async function handleDelete(u: Profile) {
    if (!confirm(`Permanently delete "${u.full_name || u.username}"? This removes their login and all their work counts, payments, and approval history. Their uploaded documents stay in the system.`)) return
    setDeletingId(u.id)
    try {
      const res = await fetch('/api/delete-user', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ user_id: u.id }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Delete failed')
      setUsers(prev => prev.filter(x => x.id !== u.id))
    } catch (e: any) {
      alert(e.message)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Users size={22} className="text-brand-green"/>Users</h1>
            <p className="text-gray-500 text-sm">Manage accounts and which tabs each person can access</p>
          </div>
          <button onClick={() => { setForm(emptyForm); setEditId(null); setSaveError(''); setModal(true) }} className="btn-primary flex items-center gap-2">
            <Plus size={16}/>Add User
          </button>
        </div>

        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {['Username','Full Name','Position','Access','Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{u.username}</td>
                  <td className="px-4 py-3">{u.full_name}</td>
                  <td className="px-4 py-3 text-gray-500">{u.position || '—'}</td>
                  <td className="px-4 py-3">
                    {u.is_admin
                      ? <span className="badge-released">Full access (all tabs)</span>
                      : u.is_owner
                      ? <span className="badge-released" style={{ background: '#ede9fe', color: '#6d28d9' }}>Owner/Director (view all, no delete)</span>
                      : <span className="text-xs text-gray-500">{u.allowed_tabs?.length || 0} tab{u.allowed_tabs?.length === 1 ? '' : 's'}</span>}
                  </td>
                  <td className="px-4 py-3 flex items-center gap-1">
                    <button onClick={() => {
                      setForm({
                        username: u.username, full_name: u.full_name, position: u.position || '', designation: u.designation || '',
                        personal_email: u.personal_email || '', official_email: u.official_email || '',
                        whatsapp_number: u.whatsapp_number || '', contact_number: u.contact_number || '',
                        password: '', is_admin: !!u.is_admin, is_owner: !!u.is_owner, allowed_tabs: u.allowed_tabs || [],
                        assigned_shippers: u.assigned_shippers || [],
                        is_shipper: !!u.is_shipper, shipper_name: u.shipper_name || '',
                      })
                      setEditId(u.id); setSaveError(''); setModal(true)
                    }}
                      className="p-1.5 rounded hover:bg-blue-50 text-blue-600"><Edit2 size={14}/></button>
                    {!u.is_shipper && (
                      <button onClick={() => openUserWork(u)} title="User Work — full report history"
                        className="p-1.5 rounded hover:bg-purple-50 text-purple-600"><BarChart2 size={14}/></button>
                    )}
                    {isAdmin && (
                      <button onClick={() => handleDelete(u)} disabled={deletingId === u.id}
                        className="p-1.5 rounded hover:bg-red-50 text-red-500 disabled:opacity-50">
                        {deletingId === u.id ? <Loader size={14} className="animate-spin"/> : <Trash2 size={14}/>}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b flex-shrink-0">
              <h2 className="font-bold text-lg">{editId ? 'Edit User' : 'Add User'}</h2>
              <button onClick={() => setModal(false)}><X size={20}/></button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto">
              {[
                ['Username','username','text'],['Full Name','full_name','text'],
                ['Position (job title)','position','text'],['Designation','designation','text'],
                ['Personal Email','personal_email','email'],['Official Email','official_email','email'],
                ['WhatsApp Number','whatsapp_number','text'],['Contact Number','contact_number','text'],
                ['Password (new only)','password','password'],
              ].map(([label,key,type]) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                  <input type={type} value={(form as any)[key]} onChange={e => setForm({...form, [key]: e.target.value})}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
                </div>
              ))}

              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <input type="checkbox" checked={form.is_admin} onChange={e => setForm({...form, is_admin: e.target.checked, is_owner: e.target.checked ? false : form.is_owner})}/>
                Full access (sees every tab)
              </label>

              {!form.is_admin && (
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  <input type="checkbox" checked={form.is_owner} onChange={e => setForm({...form, is_owner: e.target.checked})}/>
                  Owner/Director — sees every tab like Full Access, but can never delete anything
                </label>
              )}

              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <input type="checkbox" checked={form.is_shipper} onChange={e => setForm({...form, is_shipper: e.target.checked})}/>
                Shipper account (external — separate /shipper portal, not admin)
              </label>
              {form.is_shipper && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Shipper name — pick from known CUSDEC exporters</label>
                  <select value={form.shipper_name} onChange={e => setForm({...form, shipper_name: e.target.value})}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400">
                    <option value="">— select —</option>
                    {shipperList.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {form.shipper_name && !shipperList.includes(form.shipper_name) && (
                    <p className="text-[11px] text-amber-600 mt-1">"{form.shipper_name}" doesn't match any known exporter name yet — this account won't see any shipments until a CUSDEC with this exact exporter name exists.</p>
                  )}
                </div>
              )}

              {!form.is_admin && !form.is_owner && !form.is_shipper && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Assigned Shippers — {form.assigned_shippers.includes(ALL_SHIPPERS) ? 'All shippers' : form.assigned_shippers.length === 0 ? 'none selected (sees none)' : `${form.assigned_shippers.length} selected`}
                  </label>
                  <label className="flex items-center gap-2 text-sm py-1 px-1 mb-1 rounded hover:bg-gray-50 cursor-pointer font-medium">
                    <input type="checkbox" checked={form.assigned_shippers.includes(ALL_SHIPPERS)}
                      onChange={e => setForm(f => ({ ...f, assigned_shippers: e.target.checked ? [ALL_SHIPPERS] : [] }))}/>
                    <span>All shippers</span>
                  </label>
                  <div className={`space-y-1 max-h-40 overflow-y-auto border border-gray-100 rounded-lg p-2 ${form.assigned_shippers.includes(ALL_SHIPPERS) ? 'opacity-40 pointer-events-none' : ''}`}>
                    {shipperList.length === 0
                      ? <p className="text-xs text-gray-400 px-1 py-1">No exporters found in CUSDEC records yet.</p>
                      : shipperList.map(name => (
                        <label key={name} className="flex items-center gap-2 text-sm py-1 px-1 rounded hover:bg-gray-50 cursor-pointer">
                          <input type="checkbox" checked={form.assigned_shippers.includes(name)} onChange={() => toggleShipper(name)}/>
                          <span className="truncate">{name}</span>
                        </label>
                      ))}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1">Only these shippers' data shows in Shipment Overview. Admins always see all.</p>
                </div>
              )}

              {/* Advanced access tree. Shipper accounts run under their own
                  /shipper portal and rules entirely — these staff tab/panel
                  grants are meaningless for them (they never touch
                  AdminLayout/TAB_ITEMS routes), so the whole block is skipped
                  for is_shipper, as it is for admin/owner (who see all). */}
              {!form.is_admin && !form.is_owner && !form.is_shipper && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-gray-600">
                      Access — {grantedTabCount} tab{grantedTabCount === 1 ? '' : 's'}, {grantedPanelCount} panel{grantedPanelCount === 1 ? '' : 's'}
                    </label>
                    <div className="flex items-center gap-2 text-[11px]">
                      <button type="button" onClick={grantEverything} className="text-blue-600 hover:underline">Select all</button>
                      <span className="text-gray-300">|</span>
                      <button type="button" onClick={() => setForm(f => ({ ...f, allowed_tabs: [] }))} className="text-gray-500 hover:underline">Clear all</button>
                    </div>
                  </div>

                  <input value={permSearch} onChange={e => setPermSearch(e.target.value)}
                    placeholder="Search a tab or panel…"
                    className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs mb-2 focus:outline-none focus:ring-2 focus:ring-green-400"/>

                  <div className="border border-gray-100 rounded-lg divide-y divide-gray-50 max-h-80 overflow-y-auto">
                    {visibleTabs.length === 0 && (
                      <p className="text-xs text-gray-400 p-3 text-center">Nothing matches "{permSearch}"</p>
                    )}
                    {visibleTabs.map(({ tab, sections }) => {
                      const tabOn = form.allowed_tabs.includes(tab.href)
                      const onCount = sections.filter(s => form.allowed_tabs.includes(s.key)).length
                      const open = expandedTabs.includes(tab.href) || !!permSearch
                      return (
                        <div key={tab.href}>
                          <div className={`flex items-center gap-2 px-2 py-2 ${tabOn ? 'bg-green-50/40' : ''}`}>
                            <input type="checkbox" checked={tabOn} onChange={() => toggleTab(tab.href)}/>
                            <button type="button" onClick={() => sections.length && toggleExpanded(tab.href)}
                              className="flex-1 flex items-center justify-between text-left text-sm">
                              <span className={tabOn ? 'text-gray-900 font-medium' : 'text-gray-500'}>{tab.label}</span>
                              <span className="flex items-center gap-1.5 text-[11px] text-gray-400">
                                {sections.length > 0 && <span>{onCount}/{sections.length}</span>}
                                {sections.length > 0 && (open ? <ChevronDown size={13}/> : <ChevronRight size={13}/>)}
                              </span>
                            </button>
                          </div>
                          {open && sections.length > 0 && (
                            <div className={`bg-gray-50/60 px-2 py-1.5 ${tabOn ? '' : 'opacity-40 pointer-events-none'}`}>
                              <div className="flex items-center gap-2 mb-1 pl-6 text-[11px]">
                                <button type="button" onClick={() => setSectionsForTab(tab.href, true)} className="text-blue-600 hover:underline">All</button>
                                <span className="text-gray-300">|</span>
                                <button type="button" onClick={() => setSectionsForTab(tab.href, false)} className="text-gray-500 hover:underline">None</button>
                              </div>
                              {sections.map(s => (
                                <label key={s.key} className="flex items-start gap-2 text-xs py-1 pl-6 pr-1 rounded hover:bg-white cursor-pointer">
                                  <input type="checkbox" className="mt-0.5" checked={form.allowed_tabs.includes(s.key)} onChange={() => toggleTab(s.key)}/>
                                  <span className={form.allowed_tabs.includes(s.key) ? 'text-gray-800' : 'text-gray-500'}>{s.label}</span>
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1">A panel only takes effect while its parent tab is also ticked.</p>
                </div>
              )}

              {saveError && <p className="text-xs text-red-600">{saveError}</p>}
            </div>
            <div className="flex gap-3 p-6 border-t flex-shrink-0">
              <button onClick={() => setModal(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50">
                <Save size={16}/>{saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {workUser && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setWorkUser(null)}>
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
              <div>
                <h3 className="font-semibold text-gray-900 flex items-center gap-2"><BarChart2 size={16} className="text-purple-600"/>User Work — {workUser.full_name || workUser.username}</h3>
                <p className="text-xs text-gray-400 mt-0.5">Full report-wise achievement history</p>
              </div>
              <button onClick={() => setWorkUser(null)} className="text-gray-400 hover:text-gray-600"><X size={18}/></button>
            </div>
            <div className="p-6 overflow-y-auto space-y-2">
              {workLoading ? (
                <div className="flex justify-center py-10"><Loader size={18} className="animate-spin text-gray-300"/></div>
              ) : workReports.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-10">No reports generated for this person yet.</p>
              ) : workReports.map(r => (
                <div key={r.id} className="border border-gray-100 rounded-lg p-3 text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-gray-800">{r.range_label}</span>
                    <a href={r.drive_url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">View PDF</a>
                  </div>
                  <p className="text-xs text-gray-500">
                    Brought forward Rs.{Number(r.opening_balance || 0).toFixed(2)} · Earned Rs.{Number(r.period_earned || 0).toFixed(2)} ·
                    Received Rs.{Number(r.period_received || 0).toFixed(2)} · Closing <span className="font-semibold text-gray-700">Rs.{Number(r.amount).toFixed(2)}</span>
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
UsersPage.getLayout = (page: React.ReactElement) => <AdminLayout>{page}</AdminLayout>
