# Derma-Copilot

**AI-Powered Clinic Co-Pilot** — an administrative and patient retention system for Dermatology Clinics, built on the **CODE** framework:

- **C**apture — Omnichannel ingestion via Twilio WhatsApp (text, image, audio)
- **O**rganize — Zero-friction, chronological medical compliance (Symptoms → Diagnosis → Prescription → Lab Tests)
- **D**istill — Concise 3-bullet pre-consultation summaries for the doctor
- **E**xecute — WhatsApp/Call outbound micro-tasks (retention, reminders, prep)

---

## Stack

| Layer | Technology |
|---|---|
| Frontend / Hosting | Next.js 14 (App Router, RSC) on Vercel |
| Database / Auth | Supabase (PostgreSQL + RLS + Storage + Realtime) |
| Messaging | Twilio API for WhatsApp |
| LLM | Anthropic Claude (OCR parsing + doctor distillation) |
| CI/CD | GitHub → Vercel |

---

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/<your-org>/derma-copilot.git
cd derma-copilot
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env.local
# Fill in Supabase, Twilio, and LLM credentials
```

### 3. Apply Database Migrations

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

### 4. Run Locally

```bash
npm run dev
```

### 5. Deploy

Push to `main` — Vercel auto-deploys. Configure cron and webhook URLs as per `docs/DEPLOYMENT.md`.

---

## Project Structure

```
.
├── app/
│   ├── api/
│   │   ├── webhook/whatsapp/route.ts      # Inbound Twilio webhook
│   │   ├── webhook/twilio-status/route.ts # Delivery status callbacks
│   │   ├── cron/retention/route.ts        # Outbound retention engine
│   │   ├── llm/ocr-parse/route.ts         # Prescription OCR pipeline
│   │   └── llm/distill/route.ts           # Doctor pre-consult summary
│   ├── (dashboard)/                       # Doctor + Front-desk views
│   └── layout.tsx
├── lib/
│   ├── supabase/server.ts                 # Service-role client
│   ├── twilio/signature.ts                # X-Twilio-Signature verifier
│   ├── twilio/client.ts                   # Twilio SDK singleton
│   ├── llm/                               # LLM prompts + schemas
│   └── efficacy/tracker.ts                # Efficacy engine
├── supabase/migrations/                   # Postgres DDL
├── docs/                                  # Architecture + deployment
└── vercel.json                            # Cron + function config
```

---

## Security Posture

- **Twilio signature validation** (HMAC-SHA1) — mandatory on every webhook
- **Supabase Row-Level Security** — multi-tenant isolation per clinic
- **Service-role key** never leaves server-side route handlers
- **Private storage buckets** — signed URLs with 15-min TTL
- **Zero hallucination** in clinical schemas — missing data returns explicit null

---

## License

Proprietary. All rights reserved.
