# Current Project

## What we are building
An internal mobile application for **Holy Hauling**, a junk removal and moving company. The app acts as an administrative powerhouse that streamlines lead intake using OCR for screenshots, accelerates accurate AI-driven quoting based on internal SOPs, and manages the entire job lifecycle through to completion and final payment. 

## What good looks like
- The time to generate an accurate quote is drastically reduced.
- The lead intake facilitator has a frictionless, centralized dashboard to follow a lead from initial contact to job completion without redundant manual entry.
- Field workers have an easy-to-use interface displaying schedules and job equipment requirements.
- The app handles offline access robustly for remote or poor cell-reception areas.
- Crews are effectively required to submit "Before and After" photos to create quality control and marketing assets.
- AI logic continuously improves by learning from secured job inputs and company documents.

## What to avoid
- Relying on brittle or unsupported third-party APIs (like Thumbtack's API)—favor OCR screenshot ingestion as our primary lead intake.
- Over-complicating the field worker views with unnecessary administrative noise.
- Proceeding with unstructured AI outputs—ensure all AI is securely grounded on actual Holy Hauling SOPs.
- Losing any data or state changes due to offline field operation drops.
