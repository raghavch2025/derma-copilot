import crypto from 'node:crypto';

/**
 * Validates X-Twilio-Signature for an incoming webhook.
 *
 * Algorithm:
 *   1. Sort POST params alphabetically by key.
 *   2. Concatenate: full_url + key1 + value1 + key2 + value2 + ...
 *   3. HMAC-SHA1 using TWILIO_AUTH_TOKEN as the key.
 *   4. Base64-encode the digest.
 *   5. Constant-time compare to the X-Twilio-Signature header.
 *
 * The `url` argument MUST be the exact public URL Twilio called, including
 * protocol, host, path, and any query string. Mismatches here are the #1
 * cause of signature validation failures.
 */
export function validateTwilioSignature(args: {
  authToken: string;
  signatureHeader: string | null;
  url: string;
  params: Record<string, string>;
}): boolean {
  const { authToken, signatureHeader, url, params } = args;
  if (!signatureHeader) return false;

  const sortedKeys = Object.keys(params).sort();
  const concatenated = sortedKeys.reduce(
    (acc, k) => acc + k + params[k],
    url
  );

  const computed = crypto
    .createHmac('sha1', authToken)
    .update(Buffer.from(concatenated, 'utf-8'))
    .digest('base64');

  const a = Buffer.from(computed);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}
