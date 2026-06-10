'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError('メールアドレスまたはパスワードが正しくありません')
      setLoading(false)
      return
    }

    if (data.user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', data.user.id)
        .single()

      if ((profile as { role?: string } | null)?.role === 'admin') {
        router.push('/admin')
      } else {
        router.push('/dashboard')
      }
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6"
      style={{ background: 'linear-gradient(160deg, #1A1A2E 0%, #2A1A3E 50%, #1A2A3E 100%)' }}>

      {/* ロゴ・タイトル */}
      <div className="text-center mb-10">
        <div className="text-xs tracking-[0.4em] mb-3" style={{ color: 'var(--gold)' }}>
          ATTENDANCE SYSTEM
        </div>
        <h1 className="text-3xl font-light tracking-widest text-white mb-1">BiOLiS</h1>
        <div className="text-xs tracking-[0.3em] text-white/50 font-light">CLINIC</div>
        <div className="divider-gold mt-6 mx-auto w-24"></div>
      </div>

      {/* ログインカード */}
      <div className="card w-full max-w-sm p-8">
        <h2 className="text-center text-sm tracking-[0.2em] font-medium mb-8"
          style={{ color: 'var(--navy)' }}>
          サインイン
        </h2>

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block text-xs tracking-widest mb-2" style={{ color: 'var(--gray)' }}>
              EMAIL
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full px-4 py-3 rounded-lg text-sm border focus:outline-none transition"
              style={{
                borderColor: 'var(--gray-light)',
                background: 'var(--off-white)',
                color: 'var(--navy)'
              }}
              placeholder="example@biolisclinic.com"
            />
          </div>

          <div>
            <label className="block text-xs tracking-widest mb-2" style={{ color: 'var(--gray)' }}>
              PASSWORD
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full px-4 py-3 rounded-lg text-sm border focus:outline-none transition"
              style={{
                borderColor: 'var(--gray-light)',
                background: 'var(--off-white)',
                color: 'var(--navy)'
              }}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-red-500 text-xs text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-gold w-full py-3 rounded-lg text-sm tracking-widest mt-2"
          >
            {loading ? '...' : 'ログイン'}
          </button>
        </form>
      </div>

      <p className="mt-8 text-white/20 text-xs tracking-wider">
        © 2024 BiOLiS CLINIC
      </p>
    </div>
  )
}
