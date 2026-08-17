/**
 * 認可判定に必要なグループの文脈を組み立てる。
 *
 * すべての Server Action は、資源を取得してから can() を評価する
 * （04_api_spec.md 第2.1節）。その「資源の取得」をここに集約する。
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { schema } from '@/db';
import type { GroupContext } from '@/domain/authorization';
import type { GroupStatus } from '@/db/schema';

export type LoadedGroup = {
  /** 認可判定に渡す文脈 */
  context: GroupContext;
  name: string;
  status: GroupStatus;
  parentGroupId: string | null;
  isCertified: boolean;
};

export async function loadGroup(
  db: Db,
  groupId: string,
  actorUserId: string,
): Promise<LoadedGroup | null> {
  const groupRows = await db
    .select({
      id: schema.groups.id,
      name: schema.groups.name,
      status: schema.groups.status,
      ownerUserId: schema.groups.ownerUserId,
      parentGroupId: schema.groups.parentGroupId,
      isCertified: schema.groups.isCertified,
    })
    .from(schema.groups)
    .where(eq(schema.groups.id, groupId))
    .limit(1);

  const group = groupRows[0];
  if (!group) return null;

  const membershipRows = await db
    .select({ role: schema.memberships.role, status: schema.memberships.status })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.groupId, groupId),
        eq(schema.memberships.userId, actorUserId),
      ),
    )
    .limit(1);

  return {
    context: {
      id: group.id,
      ownerUserId: group.ownerUserId,
      membership: membershipRows[0] ?? null,
    },
    name: group.name,
    status: group.status,
    parentGroupId: group.parentGroupId,
    isCertified: group.isCertified,
  };
}
