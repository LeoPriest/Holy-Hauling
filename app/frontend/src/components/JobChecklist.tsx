import { useState } from 'react'
import {
  useChecklist,
  useToggleChecklistItem,
  useAddChecklistItem,
  useDeleteChecklistItem,
} from '../hooks/useChecklist'
import type { ChecklistItem } from '../services/api'
import { Working } from './Logo'

function Tag({ source }: { source: ChecklistItem['source'] }) {
  if (source === 'standard') return null
  return (
    <span className={`wd-flag ml-2 align-middle ${source === 'scope' ? '' : '!bg-ln !text-mu'}`}>
      {source === 'scope' ? 'scope' : 'added'}
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
    <div className="wd-chk" data-on={item.is_checked}>
      <button
        type="button"
        aria-pressed={item.is_checked}
        aria-label={`${item.is_checked ? 'Uncheck' : 'Check'} ${item.label}`}
        onClick={() => onToggle(item)}
        className="-ml-2.5 flex h-11 w-11 shrink-0 items-center justify-center"
      >
        <span className="wd-bx" aria-hidden="true">✓</span>
      </button>
      <span className="wd-ck-l min-w-0 flex-1 truncate">
        {item.label}
        <Tag source={item.source} />
      </span>
      <button
        type="button"
        aria-label={`Delete ${item.label}`}
        onClick={() => onDelete(item)}
        className="-mr-2.5 flex h-11 w-11 shrink-0 items-center justify-center text-mu active:text-danger"
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
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <p className="wd-fl !mb-0">Items to bring</p>
        {total > 0 && (
          <span className="text-xs text-mu">
            <b className="text-ok">{checked}</b>/{total} packed
          </span>
        )}
      </div>

      {total > 0 && (
        <div className="wd-prog" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
      )}

      {isLoading && <Working label="Loading the list…" className="sm" />}
      {isError && <p className="wd-err py-2">Couldn't load the checklist.</p>}

      {!isLoading && !isError && total === 0 && (
        <p className="py-2 text-sm text-mu">No items. Add what you need below.</p>
      )}

      <div>
        {items.map(item => (
          <Row
            key={item.id}
            item={item}
            onToggle={i => toggle.mutate({ itemId: i.id, isChecked: !i.is_checked })}
            onDelete={i => remove.mutate(i.id)}
          />
        ))}
      </div>
      {(toggle.isError || remove.isError) && <p className="wd-err">Couldn't save that change. Try again.</p>}

      <div className="flex items-center gap-2 pt-1">
        <input
          value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submitAdd() }}
          placeholder="Add an item…"
          aria-label="New item"
          className="wd-input min-w-0 flex-1"
        />
        <button
          type="button"
          onClick={submitAdd}
          disabled={!newLabel.trim() || add.isPending}
          className="wd-btn shrink-0"
        >
          {add.isPending ? 'Adding…' : 'Add'}
        </button>
      </div>
      {add.isError && <p className="wd-err">Couldn't add the item. Try again.</p>}
    </div>
  )
}
