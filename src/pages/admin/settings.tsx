import AdminLayout from '@/components/admin/AdminLayout'
import { Settings } from 'lucide-react'

export default function SettingsPage() {
  return (
    <AdminLayout>
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-500 text-sm mt-1">System Settings</p>
        </div>
        <div className="card flex flex-col items-center justify-center py-20 text-center">
          <Settings size={48} className="text-gray-300 mb-4"/>
          <h2 className="text-lg font-semibold text-gray-500">Coming Soon</h2>
          <p className="text-sm text-gray-400 mt-1">Settings module is under development</p>
        </div>
      </div>
    </AdminLayout>
  )
}
