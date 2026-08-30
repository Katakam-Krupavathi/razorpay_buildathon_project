import crypto from 'node:crypto';
import type {
  NotificationPayload,
  NotificationSendResult,
} from '@recovery/shared';

/**
 * Swappable Notification Provider Interface.
 *
 * Supports email, SMS, WhatsApp, and in-app communications for proactive nudges,
 * dunning escalations, and payment update requests.
 */
export interface NotificationProvider {
  send(payload: NotificationPayload): Promise<NotificationSendResult>;
}

/**
 * Console-based Notification Provider (Default).
 *
 * Logs formatted communications to standard output/logs and returns delivery confirmation.
 */
export class ConsoleNotificationProvider implements NotificationProvider {
  async send(payload: NotificationPayload): Promise<NotificationSendResult> {
    const messageId = `msg_${payload.channel}_${crypto.randomUUID()}`;
    const deliveredAt = new Date().toISOString();

    console.log(
      `[Notification: ${payload.channel.toUpperCase()}] Delivered to: ${payload.recipient} | Template: ${payload.template} | MsgID: ${messageId}`,
    );

    return {
      success: true,
      messageId,
      channel: payload.channel,
      deliveredAt,
    };
  }
}

/**
 * In-Memory Mock Notification Provider (for Unit Testing & Simulations).
 */
export class MockNotificationProvider implements NotificationProvider {
  private sentNotifications: Array<{
    payload: NotificationPayload;
    result: NotificationSendResult;
  }> = [];

  async send(payload: NotificationPayload): Promise<NotificationSendResult> {
    const messageId = `msg_mock_${crypto.randomUUID()}`;
    const deliveredAt = new Date().toISOString();

    const result: NotificationSendResult = {
      success: true,
      messageId,
      channel: payload.channel,
      deliveredAt,
    };

    this.sentNotifications.push({ payload, result });
    return result;
  }

  getSentNotifications(): Array<{
    payload: NotificationPayload;
    result: NotificationSendResult;
  }> {
    return [...this.sentNotifications];
  }

  clear(): void {
    this.sentNotifications = [];
  }
}
