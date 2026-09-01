'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import AiChat from '@/components/AiChat'

// BiOLiS AI のフルスクリーン画面。
// PWA（ホーム画面に追加）でここが直接開くので、勤怠の画面は目に触れない。
export default function AiPage() {
  const router = useRouter()
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/'); return }
      setChecked(true)
    }
    init()
  }, [router])

  if (!checked) {
    return (
      <div
        className="flex items-center justify-center text-sm"
        style={{ height: '100dvh', background: 'var(--navy)', color: 'var(--gray)' }}
      >
        読み込み中…
      </div>
    )
  }

  return (
    <div className="flex flex-col" style={{ height: '100dvh', background: 'var(--navy)' }}>
      <header
        className="flex items-center justify-between px-4 py-3 border-b shrink-0"
        style={{ borderColor: 'rgba(255,255,255,0.12)' }}
      >
        <div>
          <h1
            className="text-base font-semibold tracking-wide"
            style={{ color: 'var(--gold-light)' }}
          >
            BiOLiS AI
          </h1>
          <p className="text-[11px]" style={{ color: 'var(--gray)' }}>
            シフトと売上について聞けます
          </p>
        </div>
        <button
          onClick={() => router.push('/dashboard')}
          className="text-xs px-3 py-1 rounded-full border"
          style={{ borderColor: 'rgba(255,255,255,0.25)', color: '#fff' }}
        >
          閉じる
        </button>
      </header>

      <div className="flex-1 min-h-0">
        <AiChat variant="full" />
      </div>
    </div>
  )
}
