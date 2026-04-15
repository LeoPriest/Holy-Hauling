# References

## Examples of Good Work

The existing Holy Hauling company documents represent the gold standard for how this app's AI logic, intake flow, and outputs should behave. When in doubt, refer to these as the benchmark:

- **`system blueprint 2.2.md`** — The best example of a complete, locked, end-to-end intake process. Shows how gates, scripts, pricing lenses, and timing discipline all connect. This is the tone and structure the app should reflect.
- **`04_lead_handler_SOP.md`** — The clearest example of how a human should be guided through a decision. Every screen flow, AI suggestion, and facilitator prompt should feel like this document in action.
- **`06_lead_handler_quick_reference.md`** — A good example of what a well-scoped UI view should feel like: scannable, action-oriented, no unnecessary noise.
- **`01_ai_project_setup_pack.md`** — The A–H output format defined here is the exact structure the app's AI responses should follow. Nothing should deviate from this format without a deliberate reason.
- **`09_unreasonable_hospitality_foundation.md`** — Sets the tone and voice standard. Any customer-facing copy, automated message, or AI-generated text should feel like it came from this document.

---

## Relevant Links

### Internal Company Documents
All company documents live in: `company_docs/`

| File | Purpose |
|------|---------|
| `company_docs/system blueprint 2.2.md` | Master source of truth — gate logic, scripts, pricing lenses, flat-rate eligibility |
| `company_docs/Lead intake system/00_master_index.md` | Reading order and document guide for the full intake system |
| `company_docs/Lead intake system/01_ai_project_setup_pack.md` | AI workspace setup, master prompt, A–H format, startup checklist |
| `company_docs/Lead intake system/02_onboarding_training_plan.md` | Ramp plan for new lead handlers |
| `company_docs/Lead intake system/03_lead_intake_system_blueprint.md` | Operating model — gates, call-priority, escalation overview |
| `company_docs/Lead intake system/04_lead_handler_SOP.md` | Full SOP — all gates, call/text procedures, authority boundaries, logging |
| `company_docs/Lead intake system/05_ai_usage_guide.md` | How to use AI during live handling — when, how, when not to |
| `company_docs/Lead intake system/06_lead_handler_quick_reference.md` | Fast daily reference card for the facilitator |
| `company_docs/Lead intake system/07_pricing_matrix_framework.md` | Move buckets, transport paths, modifiers, worked examples |
| `company_docs/Lead intake system/08_escalation_contact_workflow.md` | Escalation levels, triggers, hold language, escalation format |
| `company_docs/Lead intake system/09_unreasonable_hospitality_foundation.md` | Hospitality philosophy, scriptural foundation, service standards |

### External Platforms
| Platform | Role | Notes |
|----------|------|-------|
| [Thumbtack](https://www.thumbtack.com) | Primary lead source | API access uncertain — use OCR/screenshot ingestion for V1 |
| [Google Business Profile](https://business.google.com) | Secondary lead source | Planned future integration |
| [Yelp for Business](https://biz.yelp.com) | Secondary lead source | Planned future integration |
| Twilio *(or similar)* | SMS/call alerts | Automated new lead notifications and follow-up texts to facilitator |

---

## Notes

**What the AI and any developer building this should know:**

1. **The company docs are the ground truth.** The app should not invent intake logic, pricing logic, or tone. Everything should trace back to the documents above — especially the SOP, the blueprint, and the hospitality foundation.

2. **The lead intake facilitator is the primary user for V1.** The app is an administrative tool first. Field worker features (scheduling, safety, before/after photos) are important but secondary to getting the facilitator workflow right.

3. **OCR-first is the strategy for lead ingestion.** Do not build around Thumbtack's API as a dependency. The intake flow should work by parsing screenshots.

4. **The A–H format is non-negotiable for AI outputs.** Any AI response during lead intake must follow the structure defined in `01_ai_project_setup_pack.md`: Quick Read → Contact Strategy → Gate Decisions → Next Message → Call Plan → Branch Replies → Pricing Posture → Escalation Notes.

5. **Pricing is internal until unlocked.** The AI should never surface raw pricing guidance as a customer-facing message. Pricing posture (G) is always internal-only until the facilitator explicitly chooses to use it.

6. **Hospitality shapes tone, not just content.** Automated messages, in-app prompts, and AI-generated text should feel warm, calm, and concise — not robotic or transactional. Refer to `09_unreasonable_hospitality_foundation.md` for the standard.

7. **The system learns from completed jobs.** Pricing accuracy improves over time by logging job notes and outcomes back into the pricing matrix. Build data capture with this in mind from the start.
