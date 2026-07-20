import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase, authHeader } from '@/lib/supabase'
import { Save, User, Lock, Camera, Loader } from 'lucide-react'

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

const emptyForm = {
  full_name: '', username: '', password: '', confirm_password: '',
  personal_email: '', official_email: '', whatsapp_number: '', contact_number: '',
  position: '', designation: '',
}

export default function ProfilePage() {
  const router = useRouter()
  const [form, setForm] = useState(emptyForm)
  const [isAdmin, setIsAdmin] = useState(false)
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState('')
  const [avatarUploading, setAvatarUploading] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      // This page (unlike admin/*) doesn't go through AdminLayout's guard —
      // without this, a logged-out visitor could still open /profile directly.
      if (!user) { router.replace('/'); return }
      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      if (data) setForm(f => ({
        ...f,
        full_name: data.full_name ?? '', username: data.username ?? '',
        personal_email: data.personal_email ?? '', official_email: data.official_email ?? '',
        whatsapp_number: data.whatsapp_number ?? '', contact_number: data.contact_number ?? '',
        position: data.position ?? '', designation: data.designation ?? '',
      }))
      setIsAdmin(!!data?.is_admin)
      setAvatarUrl(data?.avatar_url || '')
    })
  }, [])

  async function handleAvatarChange(file: File) {
    setAvatarUploading(true); setMsg('')
    try {
      const base64 = await fileToBase64(file)
      const res = await fetch('/api/upload-profile-picture', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ base64, mimeType: file.type }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setAvatarUrl(d.avatar_url)
      setMsg('Profile picture updated')
    } catch (e: any) { setMsg(`✗ ${e.message}`) }
    finally { setAvatarUploading(false) }
  }

  async function handleSave() {
    setLoading(true)
    if (form.password && form.password !== form.confirm_password) {
      setMsg('Passwords do not match'); setLoading(false); return
    }
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const patch: Record<string, string> = {
      full_name: form.full_name, username: form.username,
      personal_email: form.personal_email, official_email: form.official_email,
      whatsapp_number: form.whatsapp_number, contact_number: form.contact_number,
    }
    // Position/designation are set by admins only — the input is disabled for
    // everyone else, but guard here too in case the request is replayed.
    if (isAdmin) {
      patch.position = form.position
      patch.designation = form.designation
    }
    await supabase.from('profiles').update(patch).eq('id', user.id)
    if (form.password) {
      await supabase.auth.updateUser({ password: form.password })
    }
    setMsg('Profile updated successfully')
    setLoading(false)
  }

  const basicFields: [string, string, string][] = [
    ['Full Name', 'full_name', 'text'],
    ['Username', 'username', 'text'],
    ['Personal Email', 'personal_email', 'email'],
    ['Official Email', 'official_email', 'email'],
    ['WhatsApp Number', 'whatsapp_number', 'text'],
    ['Contact Number', 'contact_number', 'text'],
  ]
  const lockedFields: [string, string][] = [
    ['Position', 'position'],
    ['Designation', 'designation'],
  ]

  return (
    <div className="max-w-lg mx-auto p-8">
      <div className="flex items-center gap-3 mb-6">
        <label className="relative w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 cursor-pointer overflow-hidden group" style={{background:'#22A87A'}}>
          {avatarUrl ? <img src={avatarUrl} alt="" className="w-full h-full object-cover"/> : <User size={24} color="white"/>}
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
            {avatarUploading ? <Loader size={16} color="white" className="animate-spin"/> : <Camera size={16} color="white"/>}
          </div>
          <input type="file" accept="image/*" className="hidden" disabled={avatarUploading}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleAvatarChange(f); e.target.value = '' }}/>
        </label>
        <div>
          <h1 className="text-xl font-bold">My Profile</h1>
          <p className="text-gray-500 text-sm">Update your details · click your picture to change it</p>
        </div>
      </div>

      <div className="card space-y-4">
        {basicFields.map(([label, key, type]) => (
          <div key={key}>
            <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
            <input type={type} value={(form as any)[key]} onChange={e => setForm({...form, [key]: e.target.value})}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
          </div>
        ))}

        {lockedFields.map(([label, key]) => (
          <div key={key}>
            <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 mb-1">
              {label}
              {!isAdmin && <span title="Only an admin can set this" className="flex items-center gap-0.5 text-gray-400"><Lock size={11}/></span>}
            </label>
            <input value={(form as any)[key]} disabled={!isAdmin} onChange={e => setForm({...form, [key]: e.target.value})}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 disabled:bg-gray-50 disabled:text-gray-400"/>
          </div>
        ))}

        {['New Password', 'Confirm Password'].map((label, i) => {
          const key = i === 0 ? 'password' : 'confirm_password'
          return (
            <div key={key}>
              <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
              <input type="password" value={(form as any)[key]} onChange={e => setForm({...form, [key]: e.target.value})}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
            </div>
          )
        })}

        {msg && <p className="text-green-600 text-sm bg-green-50 px-3 py-2 rounded-lg">{msg}</p>}

        <button onClick={handleSave} disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
          <Save size={16}/>{loading ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}
