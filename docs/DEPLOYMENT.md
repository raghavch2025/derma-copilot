# Deployment Guide

## 1. Supabase Setup

### Create Project
1. Create a new project at https://supabase.com/dashboard
2. Save the **Project URL** and **anon key** + **service role key**

### Apply Migrations
```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

### Create Storage Bucket
1. Storage → Create Bucket → name: `patient-media`
2. Public: **OFF** (must be private)
3. Add policy: only service role can read/write

## 2. Twilio Setup

### WhatsApp Sender
1. Activate the WhatsApp Sender in the Twilio Console
2. Note the E.164 number (e.g., `+14155238886` for sandbox)

### Webhook Configuration
After deploying to Vercel:
- Inbound webhook: `https://<your-domain>/api/webhook/whatsapp` (HTTP POST)
- Status callback: `https://<your-domain>/api/webhook/twilio-status` (HTTP POST)

### Content Templates
Register these three templates via the Twilio Content API + submit for Meta approval:

| Variable | Body |
|---|---|
| `TPL_INQUIRY_TO_BOOKING` | "Thanks for reaching out to {{1}}. Would you like to book a consultation?" |
| `TPL_DAILY_MED_REMINDER` | "Reminder: take your {{1}} dose at {{2}}." |
| `TPL_PRE_PROCEDURE_PREP` | "Reminder: Do not consume food {{1}} hours before your {{2}}." |

Capture each returned `HX...` SID into the corresponding env variable.

## 3. Vercel Deployment

```bash
# Install Vercel CLI
npm i -g vercel

# Link project
vercel link

# Pull env vars (or set them in the dashboard)
vercel env pull .env.local

# Deploy
vercel --prod
```

### Required Environment Variables
Set all variables from `.env.example` in the Vercel project dashboard.

### Cron Job
The `vercel.json` already declares the cron schedule (`*/15 * * * *`). Vercel will automatically register it on next deploy. Verify in the Vercel dashboard → Cron Jobs.

## 4. Verify Security

### Twilio Signature
Test that unsigned requests are rejected:
```bash
curl -X POST https://<your-domain>/api/webhook/whatsapp \
  -d "From=whatsapp:%2B919999999999" \
  -d "Body=test"
# Expected: 403 Invalid Twilio signature
```

### RLS Isolation
Authenticate as a doctor from Clinic A and attempt to read patients from Clinic B:
```sql
select * from patients;  -- should return ONLY Clinic A patients
```

### Cron Secret
The retention cron rejects requests without the `Authorization: Bearer ${CRON_SECRET}` header.

## 5. Operational Runbook

### Health Checks
- Inbound: send a WhatsApp message → row appears in `whatsapp_conversations` within seconds
- Outbound: insert test medication with current time → reminder fires on next cron tick
- OCR: send a prescription photo → records materialize in `medical_records`

### Common Failure Modes
| Symptom | Cause | Fix |
|---|---|---|
| 403 on webhook | Wrong PUBLIC_BASE_URL or proxy stripping host | Verify `x-forwarded-host` matches Twilio call |
| Empty media in Supabase | Twilio Basic Auth failed | Confirm `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` env vars |
| OCR returns empty | LLM call rate-limited or schema rejected | Inspect `parse_warnings` + LLM provider logs |
| Cron not firing | Vercel plan limits | Verify Pro plan + cron registration |
