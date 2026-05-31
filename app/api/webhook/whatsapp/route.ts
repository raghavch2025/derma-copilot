import { NextRequest, NextResponse } from 'next/server';
import { validateTwilioSignature } from '@/lib/twilio/signature';
import { supabaseAdmin } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MEDIA_BUCKET = 'patient-media';

function buildReply(body: string): string {
  const lower = body.toLowerCase().trim();

  if (lower.includes('book') || lower.includes('appointment') || lower.includes('consult')) {
    return `Thank you for reaching out! 📅 To book an appointment, please share:
1. Your name
2. Preferred date & time
3. Your concern (acne, skin check, etc.)

Our team will confirm shortly.`;
  }

  if (lower.includes('price') || lower.includes('cost') || lower.includes('fees') || lower.includes('charge')) {
    return `Our consultation fees:\n💊 General Skin Consult: ₹500\n🔬 Acne Treatment Package: ₹2,000\n✨ Skin Rejuvenation Bundle: ₹5,000\n\nReply BOOK to schedule your appointment.`;
  }

  if (lower.includes('acne') || lower.includes('pimple') || lower.includes('breakout')) {
    return `We specialize in acne treatment! 🌿\n\nOur dermatologists use a personalized approach combining topical treatments, diet guidance, and follow-up tracking.\n\nReply BOOK to schedule a consultation.`;
  }

  if (lower.includes('hi') || lower.includes('hello') || lower.includes('hey') || lower.includes('helo')) {
    return `Hello! 👋 Welcome to Derma Clinic.\n\nHow can we help you today?\n\n1. BOOK — Schedule appointment\n2. PRICE — View our fees\n3. ACNE — Acne treatment info\n\nJust reply with a keyword or describe your concern.`;
  }

  if (lower.includes('thank')) {
    return `You're welcome! 😊 Feel free to reach out anytime. We're here to help with all your skin care needs.`;
  }

  return `Thank you for your message! 🏥 Our team has received it and will respond shortly.\n\nFor faster assistance reply with:\n• BOOK — to schedule an appointment\n• PRICE — to know our fees\n• ACNE — for acne treatment info`;
}

export async function POST(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const accountSid = process.env.TWILIO_ACCOUNT_SID;

  if (!authToken || !accountSid) {
    return new NextResponse('Twilio credentials not configured', { status: 500 });
  }

  const rawForm = await req.formData();
  const params: Record<string, string> = {};
  rawForm.forEach((v, k) => { params[k] = String(v); });

  console.log('WEBHOOK PARAMS:', JSON.stringify(params, null, 2));

  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '';
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

  const rawTo = params['To'] ?? '';
  const toNumber = rawTo.replace(/^whatsapp:/i, '').trim();
  const rawFrom = params['From'] ?? '';
  const fromNumber = rawFrom.replace(/^whatsapp:/i, '').trim();

  const { data: clinic } = await supabase
    .from('clinics')
    .select('id')
    .eq('twilio_number', toNumber)
    .single();

  if (!clinic) {
    return new NextResponse('Unknown destination number', { status: 404 });
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

  const replyText = buildReply(params['Body'] ?? '');

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${replyText}</Message>
</Response>`;

  return new NextResponse(twiml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}
