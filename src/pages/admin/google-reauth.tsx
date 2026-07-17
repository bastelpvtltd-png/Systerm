import AdminLayout from '@/components/admin/AdminLayout'
import { AlertTriangle, RefreshCw } from 'lucide-react'

function GoogleReauthContent() {
  return (
    <div className="p-6 max-w-lg">
      <h1 className="text-xl font-bold text-gray-900 mb-1">Google OAuth Re-authorize</h1>
      <p className="text-gray-500 text-sm mb-6">
        Google Sheets / Drive API eke <code className="bg-gray-100 px-1 rounded text-xs">unauthorized_client</code> error auwam
        me button eka click karanna. Google account select karama new refresh token auto-save wenawa saha deploy trigger wenawa.
      </p>

      <a
        href="/api/auth/google-reauth"
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-white"
        style={{ background: '#1B3A5C' }}
      >
        <RefreshCw size={15} />
        Re-authorize Google Account
      </a>

      <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-2">
        <p className="font-semibold flex items-center gap-1.5"><AlertTriangle size={13}/>Before clicking — Google Cloud Console check karanna:</p>
        <ol className="list-decimal list-inside space-y-1 pl-1">
          <li>console.cloud.google.com → APIs &amp; Services → OAuth consent screen</li>
          <li>Publishing status <strong>"Testing"</strong> nam → <strong>Publish App</strong> click karanna</li>
          <li>OAuth 2.0 Client → Authorized redirect URIs eke <code className="bg-amber-100 px-1 rounded">https://export-system.vercel.app/api/auth/google-callback</code> add wela thiyennawadha check karanna</li>
        </ol>
      </div>
    </div>
  )
}

export default function GoogleReauthPage() {
  return <GoogleReauthContent />
}
GoogleReauthPage.getLayout = (page: React.ReactElement) => <AdminLayout>{page}</AdminLayout>
