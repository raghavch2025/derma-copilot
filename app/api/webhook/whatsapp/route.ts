import { NextRequest, NextResponse } from 'next/server';
import { validateTwilioSignature } from '@/lib/twilio/signature';
import { supabaseAdmin } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MEDIA_BUCKET = 'patient-media';

/**
 * Inbound Twilio WhatsApp webhook.
 *
 * Flow:
 *  1. Validate X-Twilio-Signature (HMAC-SHA1) — reject before any DB write.
 *  2. Resolve clinic by destination (To) number.
 *  3. Upsert patient by source (From) number.
 *  4. Stream any media into a private Supabase Storage bucket.
 *  5. Insert a whatsapp_conversations row keyed by Twilio MessageSid.
 *  6. Fire-and-forget OCR pipeline if media is present.
 *  7. Respond with empty TwiML within 15 seconds.
 */
export async function POST(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const accountSid = process.env.TWILIO_ACCOUNT_SID;

  if (!authToken || !accountSid) {
    return new NextResponse('Twilio credentials not configured', { status: 500 });
  }

  // Parse form payload.
  const rawForm = await req.formData();
  const params: Record<string, string> = {};
  rawForm.forEach((v, k) => {
    params[k] = String(v);
  });

  // Reconstruct full URL Twilio called.
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  const host =
    req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '';
  const fullUrl = `${proto}://${host}${req.nextUrl.pathname}${req.nextUrl.search}`;

  const signatureValid = validateTwilioSignature({
    authToken,
    signatureHeader: req.headers.get('x-twilio-signature'),
    url: fullUrl,
    params,
  });

  if (!signatureValid) {
    return new NextResponse('Invalid Twilio signature', { status: 403 });
  }

  const supabase = supabaseAdmin();

  // 1. Clinic resolution by To number.
  const toNumber = (params['To'] ?? '').replace('whatsapp:', '');
  const { data: clinic, error: clinicErr } = await supabase
    .from('clinics')
    .select('id')
    .eq('twilio_number', toNumber)
    .single();

  if (clinicErr || !clinic) {
    return new NextResponse('Unknown destination number', { status: 404 });
  }

  // 2. Patient upsert by From number.
  const fromNumber = (params['From'] ?? '').replace('whatsapp:', '');
  const profileName = params['ProfileName'] ?? 'Unknown';

  const { data: patient, error: patientErr } = await supabase
    .from('patients')
    .upsert(
      {
        clinic_id: clinic.id,
        phone_e164: fromNumber,
        full_name: profileName,
        consent_whatsapp: true,
      },
      { onConflict: 'clinic_id,phone_e164', ignoreDuplicates: false }
    )
    .select('id')
    .single();

  if (patientErr || !patient) {
    return new NextResponse('Patient upsert failed', { status: 500 });
  }

  // 3. Media ingestion.
  const mediaCount = parseInt(params['NumMedia'] ?? '0', 10);
  const storagePaths: string[] = [];

  for (let i = 0; i < mediaCount; i++) {
    const mediaUrl = params[`MediaUrl${i}`];
    const contentType =
      params[`MediaContentType${i}`] ?? 'application/octet-stream';
    if (!mediaUrl) continue;

    const ext = contentType.split('/')[1]?.split(';')[0] ?? 'bin';
    const objectPath = `clinic_${clinic.id}/patient_${patient.id}/${params['MessageSid']}_${i}.${ext}`;

    const mediaResp = await fetch(mediaUrl, {
      headers: {
        Authorization:
          'Basic ' +
          Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
      },
    });

    if (!mediaResp.ok) continue;
    const arrayBuf = await mediaResp.arrayBuffer();

    const { error: upErr } = await supabase.storage
      .from(MEDIA_BUCKET)
      .upload(objectPath, new Uint8Array(arrayBuf), {
        contentType,
        upsert: false,
      });

    if (!upErr) storagePaths.push(objectPath);
  }

  // 4. Conversation row insert.
  const { error: insErr } = await supabase
    .from('whatsapp_conversations')
    .upsert(
      {
        clinic_id: clinic.id,
        patient_id: patient.id,
        twilio_message_sid: params['MessageSid'],
        direction: 'inbound',
        status: 'received',
        from_number: fromNumber,
        to_number: toNumber,
        body: params['Body'] ?? null,
        media_count: mediaCount,
        media_storage_paths: storagePaths,
      },
      { onConflict: 'twilio_message_sid' }
    );

  if (insErr) {
    return new NextResponse('DB write failed', { status: 500 });
  }

  // 5. Async OCR dispatch (fire-and-forget; Twilio expects fast ack).
  if (mediaCount > 0 && storagePaths.length > 0) {
    const internalToken = process.env.INTERNAL_PIPELINE_TOKEN;
    if (internalToken) {
      const ocrEndpoint = `${proto}://${host}/api/llm/ocr-parse`;
      fetch(ocrEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-token': internalToken,
        },
        body: JSON.stringify({
          clinic_id: clinic.id,
          patient_id: patient.id,
          storage_paths: storagePaths,
          message_sid: params['MessageSid'],
        }),
      }).catch(() => {
        // Log downstream — never block webhook ack.
      });
    }
  }

  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response/>`,
    { status: 200, headers: { 'Content-Type': 'text/xml' } }
  );
}
