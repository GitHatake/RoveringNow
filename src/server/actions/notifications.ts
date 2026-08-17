'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getDb, schema } from '@/db';
import { getActor } from '@/lib/session';

/** 通知を既読にする。既読済みなら何もしない（冪等・決定 T-41） */
export async function markAllNotificationsRead(): Promise<void> {
  const actor = await getActor();
  if (!actor) return;

  const db = await getDb();
  await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(
      and(eq(schema.notifications.userId, actor.userId), isNull(schema.notifications.readAt)),
    );
  revalidatePath('/notifications');
  revalidatePath('/', 'layout');
}
