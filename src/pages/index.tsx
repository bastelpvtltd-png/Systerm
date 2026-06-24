import { useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '@/lib/supabase'
import { Eye, EyeOff, Shield } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    // Get IP
    let ip = 'unknown'
    try {
      const res = await fetch('https://api.ipify.org?format=json')
      const data = await res.json()
      ip = data.ip
    } catch {}

    // Find user by username
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', username)
      .single()

    // Attempt sign in (email = username@system.local convention)
    const email = `${username}@exportsys.local`
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password })

    // Log attempt
    await supabase.from('login_logs').insert({
      user_id: profile?.id ?? null,
      username,
      ip_address: ip,
      user_agent: navigator.userAgent,
      status: signInError ? 'failed' : 'success'
    })

    if (signInError || !data.user) {
      setError('Invalid username or password')
      setLoading(false)
      return
    }

    const { data: prof } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', data.user.id)
      .single()

    router.push(prof?.role === 'admin' ? '/admin' : '/worker')
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{background:'linear-gradient(135deg,#0D1B2A 0%,#1B3A5C 60%,#1A6B5A 100%)'}}>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style={{background:'#22A87A'}}>
            <Shield size={32} color="white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Export System</h1>
          <p className="text-blue-200 text-sm mt-1">Sign in to your account</p>
        </div>

        <form onSubmit={handleLogin} className="bg-white rounded-2xl p-8 shadow-2xl space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
              placeholder="Enter username"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 pr-10"
                placeholder="Enter password"
                required
              />
              <button type="button" onClick={() => setShowPw(!showPw)}
                className="absolute right-3 top-3.5 text-gray-400">
                {showPw ? <EyeOff size={16}/> : <Eye size={16}/>}
              </button>
            </div>
          </div>

          {error && <p className="text-red-500 text-sm bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

          <button type="submit" disabled={loading}
            className="w-full py-3 rounded-lg text-white font-semibold transition-colors"
            style={{background: loading ? '#94a3b8' : '#22A87A'}}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}
