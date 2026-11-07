import {
  type NotificationCursorPage,
  NotificationCursorPageSchema,
} from '@careloop/shared';
import { apiFetch } from './api';

export const PATIENT_NOTIFICATIONS_CHANGED_EVENT = 'careloop:patient-notifications-changed';

export async function loadPatientNotifications(): Promise<NotificationCursorPage['items']> {
  const items: NotificationCursorPage['items'] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ limit: '100' });
    if (cursor) query.set('cursor', cursor);
    const page = await apiFetch<NotificationCursorPage>(`/api/v1/notifications?${query}`, {
      method: 'GET', schema: NotificationCursorPageSchema,
    });
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}
