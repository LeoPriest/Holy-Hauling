import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  Job,
  useJobs,
  usePatchJobStatus,
  useAddJobAssignment,
  useRemoveJobAssignment,
  useElapsedTime,
} from '../hooks/useJobs'
import { useUsers, TeamMember } from '../hooks/useUsers'
import { UseMutationResult } from '@tanstack/react-query'

const STATUS_BUTTONS = [
  { value: 'en_route', label: '🚗 En Route' },
  { value: 'started', label: '🔨 Started' },
  { value: 'completed', label: '✅ Completed' },
]

function timerColor(warning: 'red' | 'orange' | 'normal'): string {
  if (warning === 'red') return 'text-red-600 dark:text-red-400'
  if (warning === 'orange') return 'text-orange-500 dark:text-orange-400'
  return 'text-gray-500 dark:text-gray-400'
}

function threshold(ms: number, warnMs: number, critMs: number): 'red' | 'orange' | 'normal' {
  if (ms >= critMs) return 'red'
  if (ms >= warnMs) return 'orange'
  return 'normal'
}

function fmtTime(iso: string | null): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

interface JobCardProps {
  job: Job
  userRole: string | undefined
  users: TeamMember[]
  patchStatus: UseMutationResult<Job, Error, { id: string; status: string }>
  addAssignment: UseMutationResult<Job, Error, { jobId: string; userId: string }>
  removeAssignment: UseMutationResult<Job, Error, { jobId: string; userId: string }>
}

function JobCard({ job, userRole, users, patchStatus, addAssignment, removeAssignment }: JobCardProps) {
  const travelElapsed = useElapsedTime(job.en_route_at)
  const jobElapsed = useElapsedTime(job.started_at)

  const now = Date.now()
  const enRouteMs = job.en_route_at ? now - new Date(job.en_route_at).getTime() : 0
  const startedMs = job.started_at ? now - new Date(job.started_at).getTime() : 0

  const travelWarning = threshold(enRouteMs, 45 * 60_000, 90 * 60_000)
  const jobWarning = threshold(startedMs, 3 * 3_600_000, 5 * 3_600_000)

  const canManageStatus = userRole === 'supervisor' || userRole === 'admin'
  const canAssign = userRole === 'supervisor' || userRole === 'admin' || userRole === 'facilitator'

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
      <div className="flex justify-between items-start mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-gray-900 dark:text-white truncate">
              {job.customer_name ?? <span className="italic text-gray-400 font-normal">Unnamed</span>}
            </p>
            {/* Phase badge */}
            {job.job_phase === 'en_route' && travelElapsed && (
              <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 ${timerColor(travelWarning)}`}>
                🚗 {travelElapsed}
              </span>
            )}
            {job.job_phase === 'started' && jobElapsed && (
              <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 ${timerColor(jobWarning)}`}>
                🔨 {jobElapsed}
              </span>
            )}
          </div>
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
      </div>

      {/* Phase timestamp log */}
      {(job.en_route_at || job.started_at) && (
        <div className="flex gap-3 flex-wrap text-xs text-gray-400 dark:text-gray-500 mb-3">
          {job.en_route_at && (
            <span>🚗 {fmtTime(job.en_route_at)}</span>
          )}
          {job.started_at && (
            <span>🔨 {fmtTime(job.started_at)}</span>
          )}
        </div>
      )}

      {/* Read-only crew badges — crew role only */}
      {job.crew.length > 0 && userRole === 'crew' && (
        <div className="flex gap-1 flex-wrap mb-3">
          {job.crew.map(name => (
            <span
              key={name}
              className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200 px-2 py-0.5 rounded-full"
            >
              {name}
            </span>
          ))}
        </div>
      )}

      {/* Status buttons — supervisor and admin */}
      {canManageStatus && (
        <div className="flex gap-2 flex-wrap mb-3">
          {STATUS_BUTTONS.map(btn => {
            const isActive = job.job_phase === btn.value
            // En Route is disabled once the job has started (can't go backward)
            const isLocked = btn.value === 'en_route' && job.started_at !== null
            const isDisabled = patchStatus.isPending || isLocked

            return (
              <button
                key={btn.value}
                onClick={() => patchStatus.mutate({ id: job.id, status: btn.value })}
                disabled={isDisabled}
                title={isLocked ? 'Job already started — cannot go back to En Route' : undefined}
                className={`px-3 py-1 text-sm rounded-lg font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  btn.value === 'completed'
                    ? 'bg-green-600 text-white hover:bg-green-700 active:bg-green-800'
                    : isActive
                      ? 'bg-indigo-600 text-white ring-2 ring-indigo-300 dark:ring-indigo-700'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {btn.label}
              </button>
            )
          })}
        </div>
      )}

      {/* Crew assignment — supervisor, admin, facilitator */}
      {canAssign && (
        <div className="border-t dark:border-gray-700 pt-3">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Assign crew</p>
          <div className="flex gap-2 flex-wrap items-center">
            <select
              className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              defaultValue=""
              onChange={e => {
                if (e.target.value) {
                  addAssignment.mutate({ jobId: job.id, userId: e.target.value })
                  e.target.value = ''
                }
              }}
            >
              <option value="" disabled>Add member…</option>
              {users
                .filter(u => u.is_active)
                .filter(u => !job.crew.includes(u.username))
                .map(u => (
                  <option key={u.id} value={u.id}>{u.username} ({u.role})</option>
                ))
              }
            </select>

            {job.crew.map(username => {
              const u = users.find(u => u.username === username)
              return (
                <span
                  key={username}
                  className="inline-flex items-center gap-1 text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200 px-2 py-0.5 rounded-full"
                >
                  {username}
                  <button
                    onClick={() => u && removeAssignment.mutate({ jobId: job.id, userId: u.id })}
                    disabled={!u}
                    className="text-blue-400 hover:text-blue-700 dark:hover:text-blue-100 font-bold leading-none disabled:opacity-40 disabled:cursor-not-allowed"
                    title={u ? `Remove ${username}` : `${username} (user not found)`}
                  >
                    ×
                  </button>
                </span>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export function JobsScreen() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const { data: jobs = [], isLoading } = useJobs()
  const { data: users = [] } = useUsers()
  const patchStatus = usePatchJobStatus()
  const addAssignment = useAddJobAssignment()
  const removeAssignment = useRemoveJobAssignment()

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <h1 className="font-bold text-gray-900 dark:text-white text-lg">Jobs</h1>
        <div className="flex items-center gap-3">
          {(user?.role === 'admin' || user?.role === 'facilitator') && (
            <button
              onClick={() => navigate('/')}
              className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-lg"
              title="Lead Queue"
            >
              📥
            </button>
          )}
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
        {patchStatus.isError && (
          <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-4 py-2">
            Failed to update job status — please try again.
          </p>
        )}
        {isLoading && (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-10">Loading jobs…</p>
        )}
        {!isLoading && jobs.length === 0 && (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-10">No active jobs.</p>
        )}
        {jobs.map(job => (
          <JobCard
            key={job.id}
            job={job}
            userRole={user?.role}
            users={users}
            patchStatus={patchStatus}
            addAssignment={addAssignment}
            removeAssignment={removeAssignment}
          />
        ))}
      </main>
    </div>
  )
}
