import { useEffect, useState } from 'react'
import { useStandardKit, useSaveStandardKit } from '../hooks/useStandardKit'

export function StandardKitEditor() {
  const { data, isLoading, isError } = useStandardKit()
  const save = useSaveStandardKit()
  const [items, setItems] = useState<string[]>([])
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (data) setItems(data.items)
  }, [data])

  if (isLoading) return <p className="py-2 text-sm text-mu">Loading…</p>
  if (isError) return <p className="py-2 text-sm text-[#b86e00]">Couldn't load the standard kit.</p>

  const addDraft = () => {
    const label = draft.trim()
    if (!label) return
    setItems(prev => (prev.some(i => i.toLowerCase() === label.toLowerCase()) ? prev : [...prev, label]))
    setDraft('')
  }
  const removeAt = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx))

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-chip border border-ln">
        {items.length === 0 && (
          <p className="px-3 py-3 text-sm text-mu">No standard items yet.</p>
        )}
        {items.map((item, idx) => (
          <div key={`${item}-${idx}`} className="flex min-h-11 items-center gap-2 border-t border-ln px-3 first:border-t-0">
            <span className="flex-1 text-sm text-ink">{item}</span>
            <button type="button" aria-label={`Remove ${item}`} onClick={() => removeAt(idx)} className="-my-1 -mr-1.5 flex h-11 w-11 shrink-0 items-center justify-center text-mu">✕</button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addDraft() }}
          placeholder="Add a standard item…"
          className="min-h-11 flex-1 rounded-chip border border-ln bg-sf px-3 text-sm"
        />
        <button type="button" onClick={addDraft} disabled={!draft.trim()} className="min-h-11 rounded-chip bg-ln px-4 text-sm font-semibold text-ink disabled:opacity-40">Add</button>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={() => save.mutate(items)}
          disabled={save.isPending}
          className="wd-btn-sm"
        >
          {save.isPending ? 'Saving…' : 'Save kit'}
        </button>
        {save.isSuccess && <span className="text-xs text-ok">Saved</span>}
        {save.isError && <span className="text-xs text-danger">Couldn't save. Try again.</span>}
      </div>
      <p className="text-xs text-mu">The always-bring base list. Smart extras (stairs, large move, hauling, truck) are added automatically per job.</p>
    </div>
  )
}
