import crypto from 'node:crypto';
import type { NotificationChannel, NotificationDeliveryResult } from '@recovery/shared';
import type { NotificationMessage, NotificationProvider } from './types.js';

/**
 * In-memory / Console Notification Provider.
 * Swappable with SendGrid/Twilio/Gupshup production adapters.
 */
export class InMemoryNotificationProvider implements NotificationProvider {
  private delivered: NotificationDeliveryResult[] = [];

  async send(message: NotificationMessage): Promise<NotificationDeliveryResult> {
    const messageId = `msg_${crypto.randomUUID()}`;
    const result: NotificationDeliveryResult = {
      messageId,
      recipient: message.recipient,
      channel: message.channel,
      template: message.template,
      status: 'delivered',
      deliveredAt: new Date().toISOString(),
      details: {
        subject: message.subject,
        params: message.params,
        idempotencyKey: message.idempotencyKey,
      },
    };

    this.delivered.push(result);
    return result;
  }

  getDelivered(): NotificationDeliveryResult[] {
    return [...this.delivered];
  }

  clear(): void {
    this.delivered = [];
  }
}

/**
 * Notification Service abstraction for proactive customer nudges.
 */
export class NotificationService {
  private provider: NotificationProvider;

  constructor(provider?: NotificationProvider) {
    this.provider = provider || new InMemoryNotificationProvider();
  }

  async sendNudge(options: {
    recipient?: string;
    channel?: NotificationChannel;
    template?: string;
    subject?: string;
    params?: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<NotificationDeliveryResult> {
    const channel = options.channel || 'email';
    const recipient = options.recipient || 'subscriber@example.com';
    const template = options.template || 'PROACTIVE_CARD_EXPIRY_NUDGE';
    const subject = options.subject || 'Action Required: Update your subscription payment method';

    return this.provider.send({
      recipient,
      channel,
      template,
      subject,
      params: options.params || {},
      idempotencyKey: options.idempotencyKey,
    });
  }

  getProvider(): NotificationProvider {
    return this.provider;
  }
}
