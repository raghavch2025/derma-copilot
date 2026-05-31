import { NextRequest, NextResponse } from 'next/server';
import { validateTwilioSignature } from '@/lib/twilio/signature';
import { supabaseAdmin } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MEDIA_BUCKET = 'patient-media';

export async function POST(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const accountSid = process.env.TWILIO_ACCOUNT_SID;

  if (!authToken || !accountSid) {
    return new NextResponse('Twilio credentials not configured', { status: 500 });
  }

  const rawForm = await req.formData();
  const params: Record<string, string> = {};
  rawForm.forEach((v, k) => { params[k] = String(v); });

  // DEBUG: log all params
  console.log('WEBHOOK PARAMS:', JSON.stringify(params, null, 2));

  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '';
  const fullUrl = `${proto}://${host}${req.nextUrl.pathname}${req.nextUrl.search}`;

  console.log('FULL URL:', fullUrl);

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

  const rawTo = params['To'] ?? '';
  const toNumber = rawTo.replace(/^whatsapp:/i, '').trim();

  const rawFrom = params['From'] ?? '';
  const fromNumber = rawFrom.replace(/^whatsapp:/i, '').trim();

  console.log('TO NUMBER:', toNumber);
  console.log('FROM NUMBER:', fromNumber);

  const { data: clinic, error: clinicErr } = await supabase
    .from('clinics')
    .select('id')
    .eq('twilio_number', toNumber)
    .single();

  console.log('CLINIC LOOKUP:', JSON.stringify({ clinic, clinicErr }));

  if (clinicErr || !clinic) {
    // Try with whatsapp: prefix as fallback
    const { data: clinic2, error: clinic2Err } = await supabase
      .from('clinics')
      .select('id')
      .eq('twilio_number', rawTo)
      .single();

    console.log('CLINIC LOOKUP FALLBACK:', JSON.stringify({ clinic2, clinic2Err }));

    if (clinic2Err || !clinic2) {
      return new NextResponse('Unknown destination number', { status: 404 });
    }

    // Use clinic2 if found
    const profileName = params['ProfileName'] ?? 'Unknown';
    const { data: patient } = await supabase
      .from('patients')
      .upsert(
        { clinic_id: clinic2.id, phone_e164: fromNumber, full_name: profileName, consent_whatsapp: true },
        { onConflict: 'clinic_id,phone_e164', ignoreDuplicates: false }
      )
      .select('id')
      .single();

    await supabase.from('whatsapp_conversations').upsert({
      clinic_id: clinic2.id,
      patient_id: patient?.id,
      twilio_message_sid: params['MessageSid'],
      direction: 'inbound',
      status: 'received',
      from_number: fromNumber,
      to_number: rawTo,
      body: params['Body'] ?? null,
      media_count: parseInt(params['NumMedia'] ?? '0', 10),
      media_storage_paths: [],
    }, { onConflict: 'twilio_message_sid' });

    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response/>',
      { status: 200, headers: { 'Content-Type': 'text/xml' } }
    );
  }

  const profileName = params['ProfileName'] ?? 'Unknown';
  const { data: patient } = await supabase
    .from('patients')
    .upsert(
      { clinic_id: clinic.id, phone_e164: fromNumber, full_name: profileName, consent_whatsapp: true },
      { onConflict: 'clinic_id,phone_e164', ignoreDuplicates: false }
    )
    .select('id')
    .single();

  const mediaCount = parseInt(params['NumMedia'] ?? '0', 10);
  const storagePaths: string[] = [];

  for (let i = 0; i < mediaCount; i++) {
    const mediaUrl = params[`MediaUrl${i}`];
    const contentType = params[`MediaContentType${i}`] ?? 'application/octet-stream';
    if (!mediaUrl) continue;
    const ext = contentType.split('/')[1]?.split(';')[0] ?? 'bin';
    const objectPath = `clinic_${clinic.id}/patient_${patient?.id}/${params['MessageSid']}_${i}.${ext}`;
    const mediaResp = await fetch(mediaUrl, {
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
      },
    });
    if (!mediaResp.ok) continue;
    const arrayBuf = await mediaResp.arrayBuffer();
    const { error: upErr } = await supabase.storage
      .from(MEDIA_BUCKET)
      .upload(objectPath, new Uint8Array(arrayBuf), { contentType, upsert: false });
    if (!upErr) storagePaths.push(objectPath);
  }

  await supabase.from('whatsapp_conversations').upsert({
    clinic_id: clinic.id,
    patient_id: patient?.id,
    twilio_message_sid: params['MessageSid'],
    direction: 'inbound',
    status: 'received',
    from_number: fromNumber,
    to_number: toNumber,
    body: params['Body'] ?? null,
    media_count: mediaCount,
    media_storage_paths: storagePaths,
  }, { onConflict: 'twilio_message_sid' });

  const internalToken = process.env.INTERNAL_PIPELINE_TOKEN;
  if (internalToken && mediaCount > 0 && storagePaths.length > 0) {
    fetch(`${proto}://${host}/api/llm/ocr-parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-token': internalToken },
      body: JSON.stringify({ clinic_id: clinic.id, patient_id: patient?.id, storage_paths: storagePaths, message_sid: params['MessageSid'] }),
    }).catch(() => {});
  }

  return new NextResponse(
    '<?xml version="1.0" encoding="UTF-8"?><Response/>',
    { status: 200, headers: { 'Content-Type': 'text/xml' } }
  );
}
