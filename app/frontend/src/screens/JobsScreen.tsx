import { useAuth } from '../context/AuthContext'
import { useJobs, usePatchJobStatus } from '../hooks/useJobs'

const STATUS_BUTTONS = [
  { value: 'en_route', label: 'En Route' },
  { value: 'started', label: 'Started' },
  { value: 'completed', label: 'Completed' },
]

export function JobsScreen() {
  const { user, logout } = useAuth()
  const { data: jobs = [], isLoading } = useJobs()
  const patchStatus = usePatchJobStatus()

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <h1 className="font-bold text-gray-900 dark:text-white text-lg">Jobs</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              const next = document.documentElement.classList.toggle('dark') ? 'dark' : 'light'
              localStorage.setItem('hh_theme', next)
            }}
            className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-lg"
            title="Toggle dark mode"
          >
            🌓
          </button>
          <span className="text-xs text-gray-500 dark:text-gray-400">{user?.username}</span>
          <button
            onClick={logout}
            className="text-xs text-red-500 hover:text-red-700 dark:text-red-400"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="p-4 space-y-4 pb-10">
        {isLoading && (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-10">Loading jobs…</p>
        )}
        {!isLoading && jobs.length === 0 && (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-10">No active jobs.</p>
        )}
        {jobs.map(job => (
          <div key={job.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
            <div className="flex justify-between items-start mb-3">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 dark:text-white truncate">
                  {job.customer_name ?? <span className="italic text-gray-400 font-normal">Unnamed</span>}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 capitalize mt-0.5">
                  {job.service_type} · {job.job_location ?? 'No location'}
                </p>
                {job.job_date_requested && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">📅 {job.job_date_requested}</p>
                )}
                {job.scope_notes && (
                  <p className="text-sm text-gray-700 dark:text-gray-300 mt-1 line-clamp-2">{job.scope_notes}</p>
                )}
                {job.customer_phone && (
                  <a href={`tel:${job.customer_phone}`} className="text-sm text-indigo-600 dark:text-indigo-400 mt-1 block">
                    📞 {job.customer_phone}
                  </a>
                )}
              </div>
              {job.assigned_to && (
                <span className="ml-3 shrink-0 text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200 px-2 py-0.5 rounded-full">
                  {job.assigned_to}
                </span>
              )}
            </div>

            {user?.role === 'supervisor' && (
              <div className="flex gap-2 flex-wrap mt-2">
                {STATUS_BUTTONS.map(btn => (
                  <button
                    key={btn.value}
                    onClick={() => patchStatus.mutate({ id: job.id, status: btn.value })}
                    disabled={patchStatus.isPending}
                    className={`px-3 py-1 text-sm rounded-lg font-medium transition-colors disabled:opacity-50 ${
                      btn.value === 'completed'
                        ? 'bg-green-600 text-white hover:bg-green-700'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </main>
    </div>
  )
}
