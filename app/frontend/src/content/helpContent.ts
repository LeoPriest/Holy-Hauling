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

const SUPERVISOR_SECTIONS: HelpSection[] = [
  {
    id: 'phases',
    icon: '🚚',
    title: 'Track the job through its phases',
    subtitle: 'Keep the office in sync',
    kind: 'steps',
    steps: [
      { title: 'Dispatched', detail: 'The job’s assigned and set to go. Tap it when you’re about to head out.' },
      { title: 'En route', detail: 'You and the crew are driving to the customer. Tap it when you leave.' },
      { title: 'Arrived', detail: 'You’re on site getting set up. Tap it when you pull in.' },
      { title: 'Started', detail: 'The move is underway. Tap it when you begin loading.' },
      { title: 'Completed', detail: 'The job’s done. Tap it to wrap up — it moves to the Completed tab.' },
    ],
  },
  {
    id: 'crew',
    icon: '👷',
    title: 'Your crew',
    subtitle: 'Who’s on the job',
    kind: 'text',
    paragraphs: [
      'Each job shows who’s assigned. As the on-site lead you can add or swap crew if something changes. Crew marked unavailable that day are flagged so you don’t assign them by mistake.',
    ],
  },
  {
    id: 'photos',
    icon: '📸',
    title: 'Photos & notes',
    subtitle: 'Keep a record',
    kind: 'text',
    paragraphs: [
      'Log before and after photos on the job, and add notes for anything worth recording — existing damage, tricky access, special customer requests. It keeps a record of the move and protects everyone if a question comes up later.',
    ],
  },
  {
    id: 'calendar',
    icon: '🗓️',
    title: 'The calendar',
    subtitle: 'What’s coming',
    kind: 'text',
    paragraphs: [
      'The Calendar tab shows your upcoming jobs by week or month — handy for seeing what’s ahead and planning your days.',
    ],
  },
  {
    id: 'terms',
    icon: '📖',
    title: 'Key terms',
    subtitle: 'The job phases',
    kind: 'terms',
    terms: [
      { word: 'Dispatched', def: 'The job is assigned and set to go; you haven’t left yet.' },
      { word: 'En route', def: 'You and the crew are driving to the customer.' },
      { word: 'Arrived', def: 'You’re on site, before the work starts.' },
      { word: 'Started', def: 'The move is actively underway.' },
      { word: 'Completed', def: 'The job’s finished and moved to the Completed tab.' },
    ],
  },
]

export interface HelpGuide {
  title: string
  tagline: string
  intro: string
  sections: HelpSection[]
}

export const HELP_GUIDES: Record<'facilitator' | 'supervisor', HelpGuide> = {
  facilitator: {
    title: 'Facilitator guide',
    tagline: 'How leads flow + key terms',
    intro: 'Your day-to-day with leads, start to finish — plus what the less-obvious words mean. Tap a section to open it.',
    sections: HELP_SECTIONS,
  },
  supervisor: {
    title: 'Supervisor guide',
    tagline: 'How jobs work + key terms',
    intro: 'You’re the lead on site — you run the move and the crew. Here’s how a job works and what the words mean. Tap a section to open it.',
    sections: SUPERVISOR_SECTIONS,
  },
}

export function guideForRole(role: string | undefined): HelpGuide {
  return role === 'supervisor' ? HELP_GUIDES.supervisor : HELP_GUIDES.facilitator
}
