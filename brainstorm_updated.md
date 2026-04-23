# Holy Hauling App Brainstorming

## 1. Project Overview
Design and build an internal mobile application for **Holy Hauling**, a junk removal and moving company. The primary focus of the app is administrative support, specifically streamlining lead intake and end-to-end job management. 

## 2. Primary Goals & Success Metrics
- **Speed & Accuracy:** Drastically reduce the time it takes to deliver accurate quotes.
- **Frictionless Workflow:** Eliminate existing frictions in the lead intake and job management processes, ensuring smooth execution from lead capture to final payment.

## 3. Core Features & Capabilities

### Lead Intake & Management
- **Automated New Lead Alerting:** The app should actively notify the lead intake facilitator when a new lead is waiting to be processed. This should include an automated phone call option so the facilitator can be immediately alerted even when not actively watching the app. The alerting system should be structured to later support fallback or companion notifications such as SMS and push notifications.
- **OCR & Screen Capture Integration:** Build a screen capture/OCR ingestion flow to automatically parse lead data from screenshots (e.g., from the Thumbtack app) instead of relying strictly on APIs.
- **Multi-Source Expansion:** While initially targeting Thumbtack, structure the ingestion architecture to easily support Yelp, Google Business Profile (GBP), and web lead forms down the line.
- **End-to-End Tracking:** Follow leads through the entire lifecycle—from the initial intake workflow to job completion and final payment.
- **Facilitator Workflow:** Empower the lead intake facilitator to handle the entire process start-to-finish, including quoting and scheduling.
- **Automated Alerts:** Support the facilitator with automated calls and texts from the system regarding new leads and customer follow-ups. New lead alerts should be high-priority and able to trigger an immediate phone call to the lead intake facilitator when a lead is waiting in queue.

### AI & Quoting Optimization
- **SOP-Driven Baseline:** Ground the AI's core logic firmly on existing Holy Hauling company documentations and SOPs to standardize the intake and output structure.
- **AI-Powered Intake & Quoting:** Utilize AI to accurately extract and evaluate details from incoming lead screenshots and generate an immediate, reliable quote.
- **Dynamic Pricing Matrix:** Track updates and notes from secured jobs to feed relevant field experience back into the pricing matrix, improving future quoting accuracy.
- **Self-Improving System:** Ensure the system learns from job outcomes to continuously improve its suggestions, pricing models, and AI prompts.

### Field & Operations Support
- **Offline Usability:** Ensure field employees can access schedules, job details, and upload data even when operating in areas with poor or no cell service.
- **Media Collection:** Require crews to capture "Before and After" photos. This ensures quality control, helps scale field operations, and provides visual assets for future marketing material.
- **Job Overview:** Provide field employees with all necessary job details and active scheduling.
- **Resource Management:** Outline specific equipment requirements needed for each secured job.
- **Safety & Compliance:** Supply relevant safety advisories and operational best practices tailored to the specific job at hand.


## 4. Alerting & Escalation Preferences

### New Lead Alerting
- New leads should not rely only on passive in-app visibility.
- The system should be able to place an automated phone call to the lead intake facilitator to announce that a new lead is waiting to be processed.
- This should be treated as a priority operational alert, especially for time-sensitive marketplace leads.
- The system should eventually support alert hierarchy/fallbacks such as:
  - phone call first
  - SMS second
  - push notification/in-app badge third
- The app should allow future configuration for:
  - who gets called
  - when calls are triggered
  - quiet hours / after-hours behavior
  - repeated alert attempts if a lead remains unprocessed
  - escalation to owner/admin if the lead is not acknowledged in time

### Why this matters
- Marketplace leads are time-sensitive.
- Speed to acknowledgment and processing can affect close rate.
- The facilitator may not always be actively watching the app.
- A phone call is harder to miss than a passive dashboard notification.

