export type HelpSection =
  | { id: string; icon: string; title: string; subtitle?: string; kind: 'steps'; steps: { title: string; detail: string }[] }
  | { id: string; icon: string; title: string; subtitle?: string; kind: 'terms'; terms: { word: string; def: string }[] }
  | { id: string; icon: string; title: string; subtitle?: string; kind: 'text'; paragraphs: string[] }

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'flow',
    icon: '🧭',
    title: 'How a lead flows',
    subtitle: 'What you do, in order',
    kind: 'steps',
    steps: [
      { title: 'A lead comes in', detail: 'From Thumbtack it lands in your queue. Open it and skim the customer’s request, address, and move details.' },
      { title: 'Get the customer’s number', detail: 'Thumbtack hides the number until you reply — the lead shows a prompt. Reply on Thumbtack, then add the number that appears to the lead.' },
      { title: 'Draft the quote', detail: 'Tap “✨ Suggest with AI”. Review “What this quote is based on” (the comparable past jobs it used) and the AI pricing guidance, then adjust the price and line items.' },
      { title: 'Lock & book', detail: 'When the customer’s ready, lock the quote and book the job. It moves to the Jobs tab for the crew.' },
    ],
  },
  {
    id: 'reading-quote',
    icon: '💬',
    title: 'Reading an AI quote',
    subtitle: 'Grounded vs SOP-only, the basis',
    kind: 'text',
    paragraphs: [
      'Every AI draft is either “grounded” — anchored on similar past local jobs — or “SOP-only” when no comparables exist yet. The “What this quote is based on” section shows which, and lists the comparable jobs it leaned on (their price and whether they were won or lost).',
      'The AI rationale explains its reasoning, but treat it as a starting point to review — not a fixed formula. You always have the final say on the number.',
      'The orange “AI Pricing Guidance” cards are internal pricing notes (band, position, guidance) that also feed the draft.',
    ],
  },
  {
    id: 'thumbtack',
    icon: '📞',
    title: 'Thumbtack specifics',
    subtitle: 'Proxy phone · lead cost · refunds',
    kind: 'text',
    paragraphs: [
      'Phone numbers: Thumbtack gives you a “Thumbtack line” — a proxy number that reaches the customer but isn’t their real number and can stop working after the job. When the customer shares their real number, add it in the “Real #” field so you don’t lose them.',
      'Lead cost: the fee Thumbtack charged for the lead is at the bottom of the lead (Direct lead / Bonus / Total). Snap that part as a photo and the AI fills it in, or type it. It feeds your profit and ROI.',
      'Refunds: if a customer never responds within 72 hours, the lead shows up as “refund-eligible”. It’s a candidate to review — mark “Customer responded” if they did, or “Mark refunded” if Thumbtack refunded it (that zeroes the lead’s cost).',
    ],
  },
  {
    id: 'terms',
    icon: '📖',
    title: 'Key terms',
    subtitle: 'The words that trip people up',
    kind: 'terms',
    terms: [
      { word: 'Grounded', def: 'The AI quote anchored on similar past jobs — a stronger pricing signal.' },
      { word: 'SOP-only / Cold start', def: 'No comparable jobs were available yet, so the quote leaned on the standard pricing (SOP). Normal early on.' },
      { word: 'Thumbtack line', def: 'A proxy number that reaches the customer through Thumbtack — not their real number, and it can stop working after the job.' },
      { word: 'Refund-eligible', def: 'A Thumbtack lead the customer never responded to within 72 hours. A candidate to mark refunded — the app never assumes it for you.' },
      { word: 'Escalation', def: 'A lead flagged as needing attention (aging, or manually raised). Resolve it or hand it off; it doesn’t change the lead’s pipeline stage.' },
      { word: 'Follow-up', def: 'A scheduled reminder to circle back on a lead.' },
    ],
  },
]
