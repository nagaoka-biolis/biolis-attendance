import type { Metadata } from 'next'

// BiOLiS AI 専用のPWA設定。
// スマホで「ホーム画面に追加」すると、勤怠アプリとは別のアイコンとして並び、
// タップするとブラウザのバー無しで直接このチャットが開く（start_url が /ai）。
export const metadata: Metadata = {
  title: 'BiOLiS AI',
  description: 'BiOLiS CLINIC 経営アシスタント',
  manifest: '/manifest-ai.json',
  appleWebApp: {
    capable: true,
    title: 'BiOLiS AI',
    statusBarStyle: 'black-translucent',
  },
}

export default function AiLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
