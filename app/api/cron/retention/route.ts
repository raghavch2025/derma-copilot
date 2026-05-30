import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { twilioClient, TEMPLATES } from '@/lib/twilio/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RetentionAction =
  | {
      kind: 'inquiry_to_booking';
      clinic_id: string;
      patient_id: string;
      phone: string;
      clinic_name: string;
    }
  | {
      kind: 'med_reminder';
      clinic_id: string;
      patient_id: string;
      phone: string;
      salt: string;
      time: string;
    }
  | {
      kind: 'pre_procedure';
      clinic_id: string;
      patient_id: string;
      phone: string;
      procedure: string;
      hours: number;
    };

/**
 * Retention Bot Outbound Engine — invoked by Vercel Cron every 15 minutes.
 *
 * Drives three state-machine transitions:
 *   1. inquiry → booking      (24h-old WhatsApp inquiry with no appointment)
 *   2. medication reminder    (per-patient exact time within 15-min window)
 *   3. pre-procedure prep     (T-24h and T-6h before confirmed procedure)
 */
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const supabase = supabaseAdmin();
  const now = new Date();

  const { data: inquiries, error: inqErr } = await supabase.rpc(
    'find_unconverted_inquiries',
    { p_lookback_hours: 24 }
  );

  const { data: medDue, error: medErr } = await supabase.rpc(
    'find_due_medications',
    { p_window_minutes: 15 }
  );

  const { data: prepDue, error: prepErr } = await supabase.rpc(
    'find_pre_procedure_due'
  );

  if (inqErr || medErr || prepErr) {
    return NextResponse.json(
      {
        ok: false,
        errors: {
          inquiries: inqErr?.message ?? null,
          medications: medErr?.message ?? null,
          pre_procedure: prepErr?.message ?? null,
        },
      },
      { status: 500 }
    );
  }

  const actions: RetentionAction[] = [
    ...(inquiries ?? []).map(
      (r: any): RetentionAction => ({
        kind: 'inquiry_to_booking',
        clinic_id: r.clinic_id,
        patient_id: r.patient_id,
        phone: r.phone_e164,
        clinic_name: r.clinic_name,
      })
    ),
    ...(medDue ?? []).map(
      (r: any): RetentionAction => ({
        kind: 'med_reminder',
        clinic_id: r.clinic_id,
        patient_id: r.patient_id,
        phone: r.phone_e164,
        salt: r.chemical_salt,
        time: r.exact_time,
      })
    ),
    ...(prepDue ?? []).map(
      (r: any): RetentionAction => ({
        kind: 'pre_procedure',
        clinic_id: r.clinic_id,
        patient_id: r.patient_id,
        phone: r.phone_e164,
        procedure: r.procedure_name,
        hours: r.hours_before,
      })
    ),
  ];

  const results = await Promise.allSettled(actions.map((a) => dispatch(a)));

  return NextResponse.json({
    ran_at: now.toISOString(),
    total_actions: actions.length,
    dispatched: results.filter((r) => r.status === 'fulfilled').length,
    failed: results.filter((r) => r.status === 'rejected').length,
  });
}

async function dispatch(action: RetentionAction): Promise<void> {
  const supabase = supabaseAdmin();
  const tw = twilioClient();
  const fromNumber = await resolveClinicTwilioNumber(action.clinic_id);

  let contentSid: string;
  let contentVariables: Record<string, string>;

  switch (action.kind) {
    case 'inquiry_to_booking':
      contentSid = TEMPLATES.INQUIRY_TO_BOOKING;
      contentVariables = { '1': action.clinic_name };
      break;
    case 'med_reminder':
      contentSid = TEMPLATES.DAILY_MED_REMINDER;
      contentVariables = { '1': action.salt, '2': action.time };
      break;
    case 'pre_procedure':
      contentSid = TEMPLATES.PRE_PROCEDURE_PREP;
      contentVariables = {
        '1': String(action.hours),
        '2': action.procedure,
      };
      break;
  }

  if (!contentSid) {
    throw new Error(`No content template configured for ${action.kind}`);
  }

  const publicBase = process.env.PUBLIC_BASE_URL;
  const msg = await tw.messages.create({
    from: `whatsapp:${fromNumber}`,
    to: `whatsapp:${action.phone}`,
    contentSid,
    contentVariables: JSON.stringify(contentVariables),
    ...(publicBase
      ? { statusCallback: `${publicBase}/api/webhook/twilio-status` }
      : {}),
  });

  await supabase.from('whatsapp_conversations').insert({
    clinic_id: action.clinic_id,
    patient_id: action.patient_id,
    twilio_message_sid: msg.sid,
    direction: 'outbound',
    status: 'queued',
    from_number: fromNumber,
    to_number: action.phone,
    template_sid: contentSid,
    template_variables: contentVariables,
  });
}

async function resolveClinicTwilioNumber(clinicId: string): Promise<string> {
  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from('clinics')
    .select('twilio_number')
    .eq('id', clinicId)
    .single();

  if (error || !data) {
    throw new Error(`Clinic ${clinicId} not found`);
  }
  return data.twilio_number;
}
