# Holy Hauling App — Tech Stack

This document outlines the core technologies, frameworks, and services used to build the Holy Hauling internal application.

---

## 1. Frontend Architecture

| Technology | Purpose | Notes |
|------------|---------|-------|
| **React** | Core Frontend Framework | Handles UI components and client-side rendering. |
| **Tailwind CSS** | Styling & UI Design | Utility-first CSS for rapid, consistent styling. |
| **TanStack Query** | Data Fetching & State | Handles asynchronous data fetching, caching, and state management. |

---

## 2. Backend & Data

| Technology | Purpose | Notes |
|------------|---------|-------|
| **OpenViking** | Backend / Agent Context DB | Serves as the primary backend and database for storing lead context and AI memory. |

---

## 3. Testing & QA

| Technology | Purpose | Notes |
|------------|---------|-------|
| **Playwright** | UI/UX & End-to-End Testing | Automated browser testing to ensure critical lead flows and app UI work correctly. |
| **Jest** | Unit & Integration Testing | For testing individual components, utility logic, and isolated functions. |

---

## 4. Third-Party Integrations & Services

| Technology | Purpose | Notes |
|------------|---------|-------|
| **Square** | Payment Processing | Handles final job payments and deposits. |
| **MCP Server** | AI Integration *(Optional)* | Model Context Protocol server for executing or feeding project context to the AI. |
