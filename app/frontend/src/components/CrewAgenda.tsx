import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Job } from '../hooks/useJobs'
import { bucketJobsByDay } from '../utils/jobAgenda'
import { fmtTimeSlot } from '../utils/time'
import { Segmented } from './Segmented'
import { Working } from './Logo'

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

const PIN = 'M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z'
const SEND = 'M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5'

export function mapsHref(job: Job): string | null {
  const target = job.job_address || job.job_location
  return target ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(target)}` : null
}

export const PHASE_LABEL: Record<NonNullable<Job['job_phase']>, string> = {
  dispatched: 'Dispatched',
  en_route: 'En route',
  arrived: 'On site',
  started: 'Working',
}

function rowTime(job: Job): string {
  return job.appointment_time_slot ? fmtTimeSlot(job.appointment_time_slot) : 'All day'
}

function serviceLine(job: Job): string {
  const svc = job.service_type && job.service_type !== 'unknown'
    ? job.service_type.charAt(0).toUpperCase() + job.service_type.slice(1)
    : 'Job'
  return job.appointment_time_slot ? `${svc} · ${fmtTimeSlot(job.appointment_time_slot)}` : svc
}

function AgendaRow({ job, onOpen }: { job: Job; onOpen: (job: Job) => void }) {
  const href = mapsHref(job)
  const target = job.job_address || job.job_location
  return (
    <div className="wd-ag wd-box wd-box-soft">
      <button type="button" onClick={() => onOpen(job)} aria-label={job.customer_name ?? 'Unnamed job'}>
        <span className="wd-ag-t">{rowTime(job)}</span>
        <span className="min-w-0">
          <span className="wd-ag-n block truncate">{job.customer_name ?? <i className="font-normal text-mu">Unnamed</i>}</span>
          <span className="wd-ag-s block capitalize">{job.service_type}</span>
          {target && <span className="wd-ag-a block">{target}</span>}
        </span>
      </button>
      {href && (
        <a href={href} target="_blank" rel="noreferrer" className="wd-btn-sm wd-btn-ghost">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d={SEND} /></svg>
          Go
        </a>
      )}
    </div>
  )
}

function ActiveCard({ job, onOpen }: { job: Job; onOpen: (job: Job) => void }) {
  const target = job.job_address || job.job_location
  const href = mapsHref(job)
  return (
    <div className="wd-act">
      <div className="flex items-start justify-between gap-2">
        <p className="wd-act-n min-w-0">{job.customer_name ?? 'Unnamed'}</p>
        {job.job_phase && <span className="wd-st wd-st-green shrink-0">{PHASE_LABEL[job.job_phase]}</span>}
      </div>
      <p className="text-[13px] text-mu">{serviceLine(job)}</p>
      {target && href && (
        <a href={href} target="_blank" rel="noreferrer" className="wd-act-a">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d={PIN} /></svg>
          <span className="min-w-0 truncate">{target}</span>
        </a>
      )}
      <button type="button" onClick={() => onOpen(job)} className="wd-btn w-full">
        Continue job →
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
    <div className="mx-auto max-w-3xl">
      <div className="px-3.5 pt-4">
        <Segmented
          options={[{ key: 'upcoming', label: 'Upcoming' }, { key: 'completed', label: 'Completed' }]}
          value={segment}
          onChange={setSegment}
        />
      </div>

      <main key={segment} className="wd-pane flex flex-col gap-3 px-3.5 pb-6 pt-4">
        {segment === 'upcoming' && (
          <>
            {isLoading && <Working label="Loading jobs…" />}
            {!isLoading && empty && (
              <p className="py-10 text-center text-sm text-mu">No upcoming jobs scheduled.</p>
            )}
            {active.length > 0 && (
              <section className="flex flex-col gap-2">
                <h2 className="wd-label !text-ok">▸ Active now</h2>
                {active.map(job => <ActiveCard key={job.id} job={job} onOpen={onOpenJob} />)}
              </section>
            )}
            {buckets.map(bucket => (
              <section key={bucket.key} className="flex flex-col gap-2">
                <h2 className="wd-label pt-1">{bucket.label}</h2>
                {bucket.jobs.map(job => <AgendaRow key={job.id} job={job} onOpen={onOpenJob} />)}
              </section>
            ))}
          </>
        )}

        {segment === 'completed' && (
          <>
            <p className="px-1 text-sm text-mu">
              {completedJobs.length} completed · {fmtMoney(completedJobs.reduce((sum, j) => sum + (j.realized_revenue_cents ?? 0), 0) / 100)} realized
            </p>
            {completedJobs.length === 0 ? (
              <p className="py-10 text-center text-sm text-mu">No completed jobs yet.</p>
            ) : (
              completedJobs.map(job => (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => navigate(`/leads/${job.id}`)}
                  className="wd-card"
                >
                  <span className="wd-disp text-[19px] leading-tight">{job.customer_name ?? 'Unnamed'}</span>
                  <span className="text-[13px] capitalize text-mu">{job.service_type}</span>
                  {job.realized_revenue_cents != null && (
                    <span className="text-sm font-semibold text-ok">{fmtMoney(job.realized_revenue_cents / 100)} realized</span>
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
