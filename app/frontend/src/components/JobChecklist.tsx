import { useState } from 'react'
import {
  useChecklist,
  useToggleChecklistItem,
  useAddChecklistItem,
  useDeleteChecklistItem,
} from '../hooks/useChecklist'
import type { ChecklistItem } from '../services/api'

function Tag({ source }: { source: ChecklistItem['source'] }) {
  if (source === 'standard') return null
  const label = source === 'scope' ? 'scope' : 'added'
  const cls = source === 'scope'
    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200'
    : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300'
  return (
    <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {label}
    </span>
  )
}

function Row({
  item, onToggle, onDelete,
}: {
  item: ChecklistItem
  onToggle: (item: ChecklistItem) => void
  onDelete: (item: ChecklistItem) => void
}) {
  return (
    <div className="flex min-h-11 items-center gap-3 border-t border-gray-100 py-1.5 first:border-t-0 dark:border-gray-700">
      <button
        type="button"
        aria-pressed={item.is_checked}
        aria-label={`${item.is_checked ? 'Uncheck' : 'Check'} ${item.label}`}
        onClick={() => onToggle(item)}
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 text-sm transition-colors ${
          item.is_checked
            ? 'border-emerald-500 bg-emerald-500 text-white'
            : 'border-gray-300 text-transparent dark:border-gray-600'
        }`}
      >
        ✓
      </button>
      <span className={`min-w-0 flex-1 truncate ${item.is_checked ? 'text-gray-400 line-through dark:text-gray-500' : 'text-gray-900 dark:text-white'}`}>
        {item.label}
        <Tag source={item.source} />
      </span>
      <button
        type="button"
        aria-label={`Delete ${item.label}`}
        onClick={() => onDelete(item)}
        className="shrink-0 px-2 text-gray-400 hover:text-red-500"
      >
        ✕
      </button>
    </div>
  )
}

export function JobChecklist({ leadId }: { leadId: string }) {
  const { data, isLoading, isError } = useChecklist(leadId)
  const toggle = useToggleChecklistItem(leadId)
  const add = useAddChecklistItem(leadId)
  const remove = useDeleteChecklistItem(leadId)
  const [newLabel, setNewLabel] = useState('')

  const items = data ?? []
  const checked = items.filter(i => i.is_checked).length
  const total = items.length
  const pct = total > 0 ? Math.round((checked / total) * 100) : 0

  const submitAdd = () => {
    const label = newLabel.trim()
    if (!label) return
    add.mutate(label, { onSuccess: () => setNewLabel('') })
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Items to bring</p>
        {total > 0 && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">{checked}</span>/{total} packed
          </span>
        )}
      </div>

      {total > 0 && (
        <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}

      {isLoading && <p className="py-2 text-sm text-gray-500 dark:text-gray-400">Loading…</p>}
      {isError && <p className="py-2 text-sm text-amber-600 dark:text-amber-400">Couldn't load the checklist.</p>}

      {!isLoading && !isError && total === 0 && (
        <p className="py-2 text-sm text-gray-500 dark:text-gray-400">No items — add what you need below.</p>
      )}

      {items.map(item => (
        <Row
          key={item.id}
          item={item}
          onToggle={i => toggle.mutate({ itemId: i.id, isChecked: !i.is_checked })}
          onDelete={i => remove.mutate(i.id)}
        />
      ))}

      <div className="flex items-center gap-2 pt-1">
        <input
          value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submitAdd() }}
          placeholder="Add an item…"
          className="min-h-11 flex-1 rounded-lg border border-gray-200 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        />
        <button
          type="button"
          onClick={submitAdd}
          disabled={!newLabel.trim() || add.isPending}
          className="min-h-11 rounded-lg bg-emerald-500 px-4 text-sm font-semibold text-white disabled:opacity-40"
        >
          {add.isPending ? 'Adding…' : 'Add'}
        </button>
      </div>
      {add.isError && <p className="text-xs text-red-500">Couldn't add the item. Try again.</p>}
    </div>
  )
}
