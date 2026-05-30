# Architecture Overview

## CODE Framework Mapping

| Layer | Component | Files |
|---|---|---|
| **Capture** | Twilio inbound webhook + media ingest | `app/api/webhook/whatsapp/route.ts` |
| **Organize** | Stage-enforced medical records | `supabase/migrations/0001_init_derma_copilot.sql` |
| **Distill** | 3-bullet doctor summary | `app/api/llm/distill/route.ts` |
| **Execute** | Retention bot state machine | `app/api/cron/retention/route.ts` |

## Data Flow

### Inbound (Patient → System)
```
WhatsApp message
   ↓
Twilio (signs payload with HMAC-SHA1)
   ↓
POST /api/webhook/whatsapp
   ├─ Validate X-Twilio-Signature        (lib/twilio/signature.ts)
   ├─ Resolve clinic by To number
   ├─ Upsert patient by From number
   ├─ Stream media → Supabase Storage (private bucket)
   ├─ Insert whatsapp_conversations row
   └─ Async dispatch → /api/llm/ocr-parse
        ↓
        Anthropic Claude (vision)
        ↓
        Validate against PrescriptionOCRResultSchema (Zod)
        ↓
        Materialize → medical_records (stage = symptom/diagnosis/prescription/lab_test)
                    + prescriptions + medication_timelines
```

### Outbound (System → Patient)
```
Vercel Cron (every 15 min)
   ↓
GET /api/cron/retention (Bearer CRON_SECRET)
   ↓
Postgres RPCs:
  ├─ find_unconverted_inquiries()
  ├─ find_due_medications()
  └─ find_pre_procedure_due()
   ↓
For each action:
  └─ Twilio Content API → WhatsApp template
       ↓
       Insert outbound row in whatsapp_conversations
       ↓
       Twilio status callbacks → /api/webhook/twilio-status
           ↓
           Update message_status (sent → delivered → read)
```

### Real-time Surfaces
```
Supabase Postgres
   ↓ (logical replication)
Supabase Realtime
   ↓ (WebSocket, RLS-filtered)
Doctor Dashboard / Front-Desk View
```

## Security Boundaries

1. **Twilio signature**: Every webhook hit is HMAC-verified before any state mutation.
2. **Internal pipeline token**: Async LLM dispatch from webhook is gated by `INTERNAL_PIPELINE_TOKEN`.
3. **Cron secret**: Retention cron requires `Bearer ${CRON_SECRET}`.
4. **RLS**: All clinical tables enforce `clinic_id = auth_clinic_id()` per row.
5. **Service role key**: Confined to server-side Route Handlers; never reaches browser.
6. **Storage**: Private bucket; access only via 15-min signed URLs.

## Zero-Hallucination Contract

- `PrescriptionOCRResultSchema` requires explicit `null` for uncertain fields.
- `parse_warnings[]` captures every unreadable field.
- `confidence` scores are mandatory; values < 0.5 flag human review.
- Distiller bullets with insufficient data MUST state so explicitly, not fabricate.

## Multi-Tenant Isolation

- Every clinical row carries `clinic_id`.
- `auth_clinic_id()` SQL function resolves the calling user's clinic via `doctors` or `staff` tables.
- RLS policies use this function for both `USING` (read) and `WITH CHECK` (write) clauses.
- Realtime subscriptions inherit the same RLS enforcement.
