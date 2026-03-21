'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

export default function DashboardPage() {
  const [user, setUser] = useState<any>(null)
  const [roles, setRoles] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }
      setUser(user)

      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('is_archived', false)

      if (roleData) setRoles(roleData.map((r: any) => r.role))
      setLoading(false)
    }
    load()
  }, [])

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <p className="text-white">Yükleniyor...</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <nav className="bg-gray-800 px-6 py-4 flex justify-between items-center border-b border-gray-700">
        <div>
          <h1 className="text-xl font-bold">Sesco ERP</h1>
          <p className="text-gray-400 text-sm">Chartering & Operations</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-sm text-white">{user?.email}</p>
            <p className="text-xs text-blue-400">{roles.join(', ')}</p>
          </div>
          <button
            onClick={handleLogout}
            className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
          >
            Çıkış
          </button>
        </div>
      </nav>

      <main className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-gray-800 rounded-lg p-5 border border-gray-700">
            <p className="text-gray-400 text-sm">Aktif Voyages</p>
            <p className="text-3xl font-bold mt-1">0</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-5 border border-gray-700">
            <p className="text-gray-400 text-sm">Bekleyen Cargo Plans</p>
            <p className="text-3xl font-bold mt-1">0</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-5 border border-gray-700">
            <p className="text-gray-400 text-sm">Açık Payment Orders</p>
            <p className="text-3xl font-bold mt-1">0</p>
          </div>
        </div>

        <div className="bg-gray-800 rounded-lg border border-gray-700 p-5">
          <h2 className="text-lg font-semibold mb-4">Modüller</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Berth Schedule', href: '/dashboard/berth-schedule' },
              { label: 'Cargo Plans', href: '/dashboard/cargo-plans' },
              { label: 'Voyages', href: '/dashboard/voyages' },
              { label: 'Payment Orders', href: '/dashboard/payment-orders' },
            ].map(item => (
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                className="p-4 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium text-left transition-colors"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}