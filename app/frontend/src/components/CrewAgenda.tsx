import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Job } from '../hooks/useJobs'
import { bucketJobsByDay } from '../utils/jobAgenda'
import { fmtTimeSlot } from '../utils/time'

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

function mapsHref(job: Job): string | null {
  const target = job.job_address || job.job_location
  return target ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(target)}` : null
}

function rowTime(job: Job): string {
  return job.appointment_time_slot ? fmtTimeSlot(job.appointment_time_slot) : 'All day'
}

function AgendaRow({ job, onOpen }: { job: Job; onOpen: (job: Job) => void }) {
  const href = mapsHref(job)
  const target = job.job_address || job.job_location
  return (
    <div className="flex items-start gap-3 rounded-xl border border-gray-100 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <button onClick={() => onOpen(job)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
        <div className="w-14 shrink-0 text-right">
          <div className="text-sm font-bold text-gray-900 dark:text-white">{rowTime(job)}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-gray-900 dark:text-white">
            {job.customer_name ?? <span className="font-normal italic text-gray-400">Unnamed</span>}
          </div>
          <div className="text-xs capitalize text-gray-500 dark:text-gray-400">{job.service_type}</div>
          {target && <div className="mt-1 truncate text-xs text-gray-400 dark:text-gray-500">{target}</div>}
        </div>
      </button>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            onClick={e => e.stopPropagation()}
            className="min-h-11 rounded-lg border border-blue-200 px-2.5 py-1 text-xs font-semibold text-blue-600 dark:border-blue-800 dark:text-blue-300"
          >
            Navigate
          </a>
        )}
      </div>
    </div>
  )
}

function ActiveCard({ job, onOpen }: { job: Job; onOpen: (job: Job) => void }) {
  const target = job.job_address || job.job_location
  const stateLabel =
    job.job_phase === 'started' ? 'Working'
    : job.job_phase === 'arrived' ? 'On site'
    : job.job_phase === 'en_route' ? 'En route'
    : 'Dispatched'
  return (
    <div className="rounded-2xl border-2 border-green-300 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/20">
      <div className="flex items-center justify-between gap-2">
        <div className="text-lg font-bold text-gray-900 dark:text-white">
          {job.customer_name ?? 'Unnamed'}
        </div>
        <span className="rounded-full bg-green-200 px-2 py-0.5 text-xs font-bold text-green-800 dark:bg-green-800 dark:text-green-100">
          {stateLabel}
        </span>
      </div>
      <div className="mt-0.5 text-sm capitalize text-gray-600 dark:text-gray-300">{job.service_type}</div>
      {target && <div className="mt-2 text-sm text-blue-700 dark:text-blue-300">{target}</div>}
      <button
        onClick={() => onOpen(job)}
        className="mt-3 min-h-11 w-full rounded-xl bg-green-600 py-3 text-center text-base font-bold text-white hover:bg-green-700"
      >
        Continue job -&gt;
      </button>
    </div>
  )
}

interface Props {
  jobs: Job[]
  completedJobs: Job[]
  isLoading: boolean
  onOpenJob: (job: Job) => void
}

export function CrewAgenda({ jobs, completedJobs, isLoading, onOpenJob }: Props) {
  const navigate = useNavigate()
  const [segment, setSegment] = useState<'upcoming' | 'completed'>('upcoming')
  const { active, buckets } = bucketJobsByDay(jobs)
  const empty = active.length === 0 && buckets.length === 0

  return (
    <div>
      <div className="flex gap-1.5 bg-gray-100 p-1 mx-4 mt-3 rounded-xl dark:bg-gray-700/50">
        {(['upcoming', 'completed'] as const).map(seg => (
          <button
            key={seg}
            onClick={() => setSegment(seg)}
            className={`min-h-11 flex-1 rounded-lg text-sm font-semibold capitalize transition-colors ${
              segment === seg
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-white'
                : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            {seg}
          </button>
        ))}
      </div>

      <main className="space-y-3 p-4 pb-10">
        {segment === 'upcoming' && (
          <>
            {isLoading && <p className="py-10 text-center text-sm text-gray-400 dark:text-gray-500">Loading...</p>}
            {!isLoading && empty && (
              <p className="py-10 text-center text-sm text-gray-400 dark:text-gray-500">No upcoming jobs scheduled.</p>
            )}
            {active.length > 0 && (
              <section className="space-y-2">
                <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-green-700 dark:text-green-400">&#9658; Active now</h2>
                {active.map(job => <ActiveCard key={job.id} job={job} onOpen={onOpenJob} />)}
              </section>
            )}
            {buckets.map(bucket => (
              <section key={bucket.key} className="space-y-2">
                <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">{bucket.label}</h2>
                {bucket.jobs.map(job => <AgendaRow key={job.id} job={job} onOpen={onOpenJob} />)}
              </section>
            ))}
          </>
        )}

        {segment === 'completed' && (
          <>
            <div className="px-1 py-1 text-sm text-gray-500 dark:text-gray-400">
              {completedJobs.length} completed &middot; {fmtMoney(completedJobs.reduce((sum, j) => sum + (j.realized_revenue_cents ?? 0), 0) / 100)} realized
            </div>
            {completedJobs.length === 0 ? (
              <p className="py-10 text-center text-sm text-gray-400 dark:text-gray-500">No completed jobs yet.</p>
            ) : (
              completedJobs.map(job => (
                <button
                  key={job.id}
                  onClick={() => navigate(`/leads/${job.id}`)}
                  className="w-full rounded-xl border border-gray-100 bg-white p-4 text-left shadow-sm dark:border-gray-700 dark:bg-gray-800"
                >
                  <div className="font-semibold text-gray-900 dark:text-white">{job.customer_name ?? 'Unnamed'}</div>
                  <div className="text-xs capitalize text-gray-500 dark:text-gray-400">{job.service_type}</div>
                  {job.realized_revenue_cents != null && (
                    <div className="mt-1 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                      {fmtMoney(job.realized_revenue_cents / 100)} realized
                    </div>
                  )}
                </button>
              ))
            )}
          </>
        )}
      </main>
    </div>
  )
}
