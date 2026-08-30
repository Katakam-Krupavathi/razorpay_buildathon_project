import type { NotificationChannel, NotificationDeliveryResult } from '@recovery/shared';

export interface NotificationMessage {
  recipient: string;
  channel: NotificationChannel;
  subject?: string;
  template: string;
  params: Record<string, unknown>;
  idempotencyKey: string;
}

export interface NotificationProvider {
  send(message: NotificationMessage): Promise<NotificationDeliveryResult>;
}

export type { NotificationChannel, NotificationDeliveryResult };
