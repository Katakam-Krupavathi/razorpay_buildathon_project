import crypto from 'node:crypto';

/**
 * Validates the Razorpay webhook signature header using HMAC-SHA256.
 *
 * @param rawBody - The raw unparsed HTTP request body string
 * @param signature - The signature sent in the 'x-razorpay-signature' header
 * @param secret - The configured webhook secret from environment variables
 * @returns boolean - True if the signature is valid and authentic, false otherwise
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | undefined | null,
  secret: string | undefined | null,
): boolean {
  if (!rawBody || !signature || !secret) {
    return false;
  }

  try {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody, 'utf8')
      .digest('hex');

    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    const receivedBuffer = Buffer.from(signature, 'utf8');

    if (expectedBuffer.length !== receivedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
  } catch (error) {
    console.error('[WebhookVerifier] Error verifying webhook signature:', error);
    return false;
  }
}
