import { useEffect, useRef, useState } from 'react'
import { useChatMessages, useSendChatMessage } from '../hooks/useLeads'
import { fmtLocalTime } from '../utils/time'
import { Working } from './Logo'

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
        {isLoading && <Working label="Loading chat…" className="sm" />}
        {!isLoading && messages.length === 0 && (
          <p className="text-xs text-mu italic">
            No messages yet. Challenge the pricing or add context.
          </p>
        )}
        {messages.map(m => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`wd-bub ${m.role === 'user' ? 'wd-bub-me' : 'wd-bub-ai'}`}
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
              <p className={`text-[10px] mt-1 ${m.role === 'user' ? 'text-white/70' : 'text-mu'}`}>
                {fmtLocalTime(m.created_at)}
              </p>
            </div>
          </div>
        ))}
        {sendMessage.isPending && (
          <div className="flex justify-start">
            <div className="wd-bub wd-bub-ai text-mu">
              Thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Context update flash */}
      {contextFlash && (
        <div className="text-xs text-ok bg-tint border border-ln rounded-chip px-3 py-1.5 mt-2 flex items-center gap-1.5">
          <span>↑</span>
          <span>Context updated above — re-run AI Review to apply.</span>
        </div>
      )}

      {/* Error */}
      {sendMessage.isError && (
        <p className="text-xs text-danger mt-2">
          {(sendMessage.error as Error)?.message ?? 'Send failed'}
        </p>
      )}

      {/* Input */}
      <form onSubmit={handleSend} className="flex gap-2 mt-3">
        <input
          className="wd-input min-w-0 flex-1 disabled:opacity-60"
          aria-label="Message"
          placeholder="Challenge this or add context…"
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={sendMessage.isPending}
        />
        <button
          type="submit"
          disabled={!input.trim() || sendMessage.isPending}
          className="wd-btn shrink-0"
        >
          Send
        </button>
      </form>
    </div>
  )
}
