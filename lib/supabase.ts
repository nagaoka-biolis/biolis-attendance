import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// globalThis を使ったシングルトン（Next.js hot reload 対応）
const globalForSupabase = globalThis as unknown as { supabase: ReturnType<typeof createClient> }

export const supabase = globalForSupabase.supabase ?? createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    storageKey: 'biolis-attendance-auth',
  }
})

if (process.env.NODE_ENV !== 'production') {
  globalForSupabase.supabase = supabase
}

export type Profile = {
  id: string
  name: string
  role: 'staff' | 'admin'
  created_at: string
}

export type Attendance = {
  id: string
  user_id: string
  type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end'
  timestamp: string
  latitude: number | null
  longitude: number | null
  is_valid: boolean
}

export type Message = {
  id: string
  user_id: string
  body: string
  created_at: string
  resolved: boolean
}

export type Shift = {
  id: string
  user_id: string
  date: string            // YYYY-MM-DD
  start_time: string | null  // "10:00"
  end_time: string | null    // "19:00"
  kind: 'work' | 'off' | 'paid'  // 出勤 / 休み / 有給
  status: string          // 確定 / 申請中 など
  note: string | null
}
