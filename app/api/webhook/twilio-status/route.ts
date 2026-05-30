import { NextRequest, NextResponse } from 'next/server';
import { validateTwilioSignature } from '@/lib/twilio/signature';
import { supabaseAdmin } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS_MAP: Record<string, string> = {
  queued: 'queued',
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
  undelivered: 'undelivered',
};

/**
 * Twilio status callback handler.
 * Receives delivery lifecycle events (sent → delivered → read | failed)
 * and updates the corresponding whatsapp_conversations row.
 */
export async function POST(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    return new NextResponse('Twilio auth token not configured', { status: 500 });
  }

  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => {
    params[k] = String(v);
  });

  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  const host =
    req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '';
  const fullUrl = `${proto}://${host}${req.nextUrl.pathname}${req.nextUrl.search}`;

  const valid = validateTwilioSignature({
    authToken,
    signatureHeader: req.headers.get('x-twilio-signature'),
    url: fullUrl,
    params,
  });

  if (!valid) {
    return new NextResponse('Invalid signature', { status: 403 });
  }

  const status = STATUS_MAP[params['MessageStatus']] ?? 'queued';
  const supabase = supabaseAdmin();

  const nowIso = new Date().toISOString();
  const timestampField: Record<string, string> =
    status === 'sent'
      ? { sent_at: nowIso }
      : status === 'delivered'
        ? { delivered_at: nowIso }
        : status === 'read'
          ? { read_at: nowIso }
          : {};

  await supabase
    .from('whatsapp_conversations')
    .update({
      status,
      error_code: params['ErrorCode'] ? Number(params['ErrorCode']) : null,
      error_message: params['ErrorMessage'] ?? null,
      ...timestampField,
    })
    .eq('twilio_message_sid', params['MessageSid']);

  return new NextResponse(null, { status: 204 });
}
