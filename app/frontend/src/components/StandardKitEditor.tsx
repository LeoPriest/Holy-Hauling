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

  if (isLoading) return <p className="py-2 text-sm text-gray-500 dark:text-gray-400">Loading…</p>
  if (isError) return <p className="py-2 text-sm text-amber-600 dark:text-amber-400">Couldn't load the standard kit.</p>

  const addDraft = () => {
    const label = draft.trim()
    if (!label) return
    setItems(prev => (prev.some(i => i.toLowerCase() === label.toLowerCase()) ? prev : [...prev, label]))
    setDraft('')
  }
  const removeAt = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx))

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-600">
        {items.length === 0 && (
          <p className="px-3 py-3 text-sm text-gray-500 dark:text-gray-400">No standard items yet.</p>
        )}
        {items.map((item, idx) => (
          <div key={`${item}-${idx}`} className="flex min-h-11 items-center gap-2 border-t border-gray-100 px-3 first:border-t-0 dark:border-gray-700">
            <span className="flex-1 text-sm text-gray-900 dark:text-white">{item}</span>
            <button type="button" aria-label={`Remove ${item}`} onClick={() => removeAt(idx)} className="-my-1 -mr-1.5 flex h-11 w-11 shrink-0 items-center justify-center text-gray-400 hover:text-red-500">✕</button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addDraft() }}
          placeholder="Add a standard item…"
          className="min-h-11 flex-1 rounded-lg border border-gray-200 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        />
        <button type="button" onClick={addDraft} disabled={!draft.trim()} className="min-h-11 rounded-lg bg-gray-200 px-4 text-sm font-semibold text-gray-700 disabled:opacity-40 dark:bg-gray-600 dark:text-white">Add</button>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={() => save.mutate(items)}
          disabled={save.isPending}
          className="min-h-11 rounded-lg bg-emerald-500 px-4 text-sm font-semibold text-white disabled:opacity-40"
        >
          {save.isPending ? 'Saving…' : 'Save kit'}
        </button>
        {save.isSuccess && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
        {save.isError && <span className="text-xs text-red-500">Couldn't save. Try again.</span>}
      </div>
      <p className="text-xs text-gray-400">The always-bring base list. Smart extras (stairs, large move, hauling, truck) are added automatically per job.</p>
    </div>
  )
}
