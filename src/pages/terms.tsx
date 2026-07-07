export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-10 px-6">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow p-8 space-y-4 text-sm text-gray-700">
        <h1 className="text-xl font-bold text-gray-900">Terms and Conditions</h1>
        <p>This system is for authorized use by Bastel staff only. By signing in, you agree to:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Use your own account credentials only — never share your username or password.</li>
          <li>Only access documents, shipments, and records relevant to your assigned role.</li>
          <li>Not attempt to bypass, disable, or work around any access restriction set for your account.</li>
          <li>Report any suspected unauthorized access or data issue to an admin immediately.</li>
          <li>Accept that all actions taken under your account (uploads, edits, deletions) are logged and attributable to you.</li>
        </ul>
        <p className="text-gray-400 text-xs pt-2">Contact an admin if you have questions about these terms.</p>
      </div>
    </div>
  )
}
