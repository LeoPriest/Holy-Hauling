import { useEffect, useRef, useState } from 'react'
import { useChatMessages, useSendChatMessage } from '../hooks/useLeads'
import { fmtLocalTime } from '../utils/time'

interface Props {
  leadId: string
  aiReviewId?: string
  onContextUpdate?: (text: string) => void
}

export function AiChatThread({ leadId, aiReviewId, onContextUpdate }: Props) {
  const { data: messages = [], isLoading } = useChatMessages(leadId)
  const sendMessage = useSendChatMessage()
  const [input, setInput] = useState('')
  const [contextFlash, setContextFlash] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text) return
    sendMessage.mutate(
      { leadId, message: text, aiReviewId },
      {
        onSuccess: (data) => {
          setInput('')
          if (data.quote_context_update && onContextUpdate) {
            onContextUpdate(data.quote_context_update)
            setContextFlash(true)
            setTimeout(() => setContextFlash(false), 3000)
          }
        },
      },
    )
  }

  return (
    <div className="flex flex-col">

      {/* Thread */}
      <div className="space-y-3 min-h-[4rem]">
        {isLoading && <p className="text-xs text-gray-400">Loading chat…</p>}
        {!isLoading && messages.length === 0 && (
          <p className="text-xs text-gray-400 italic">
            No messages yet. Challenge the pricing or add context.
          </p>
        )}
        {messages.map(m => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-br-sm'
                  : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm'
              }`}
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
              <p className={`text-[10px] mt-1 ${m.role === 'user' ? 'text-indigo-300' : 'text-gray-400'}`}>
                {fmtLocalTime(m.created_at)}
              </p>
            </div>
          </div>
        ))}
        {sendMessage.isPending && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-xs text-gray-400">
              Thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Context update flash */}
      {contextFlash && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5 mt-2 flex items-center gap-1.5">
          <span>↑</span>
          <span>Context updated above — re-run AI Review to apply.</span>
        </div>
      )}

      {/* Error */}
      {sendMessage.isError && (
        <p className="text-xs text-red-600 mt-2">
          {(sendMessage.error as Error)?.message ?? 'Send failed'}
        </p>
      )}

      {/* Input */}
      <form onSubmit={handleSend} className="flex gap-2 mt-3">
        <input
          className="flex-1 border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
          placeholder="Challenge this or add context…"
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={sendMessage.isPending}
        />
        <button
          type="submit"
          disabled={!input.trim() || sendMessage.isPending}
          className="bg-indigo-600 text-white rounded-xl px-4 py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 shrink-0"
        >
          Send
        </button>
      </form>
    </div>
  )
}
