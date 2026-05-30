import twilio, { type Twilio } from 'twilio';

let cached: Twilio | null = null;

export function twilioClient(): Twilio {
  if (cached) return cached;

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;

  if (!sid || !token) {
    throw new Error('Twilio env vars missing: TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN');
  }

  cached = twilio(sid, token);
  return cached;
}

/**
 * Pre-approved Twilio Content Template SIDs (registered via Meta).
 * Each template SID begins with "HX".
 */
export const TEMPLATES = {
  INQUIRY_TO_BOOKING: process.env.TPL_INQUIRY_TO_BOOKING ?? '',
  DAILY_MED_REMINDER: process.env.TPL_DAILY_MED_REMINDER ?? '',
  PRE_PROCEDURE_PREP: process.env.TPL_PRE_PROCEDURE_PREP ?? '',
} as const;
