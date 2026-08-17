'use server';

/**
 * 所属と管理者に関する操作（04_api_spec.md 第4.2節）
 *
 * 業務ルールは src/server/membership-service.ts にある。
 * ここは操作者の解決と再検証だけを担う薄い層。
 */
import { revalidatePath } from 'next/cache';
import { getDb } from '@/db';
import { fail, type Result } from '@/lib/result';
import { getActor } from '@/lib/session';
import {
  grantAdminService,
  inviteMemberService,
  leaveGroupService,
  removeMemberService,
  resignAdminService,
  revokeAdminService,
  transferOwnershipService,
} from '@/server/membership-service';

type GroupAction = (groupId: string, targetUserId?: string) => Promise<Result<null>>;

/** 操作者の解決・DB取得・再検証を共通化する */
function withActor(
  run: (
    db: Awaited<ReturnType<typeof getDb>>,
    actor: NonNullable<Awaited<ReturnType<typeof getActor>>>,
    groupId: string,
    targetUserId: string,
  ) => Promise<Result<null>>,
): GroupAction {
  return async (groupId, targetUserId = '') => {
    const actor = await getActor();
    if (!actor) return fail('UNAUTHENTICATED', 'ログインが必要です。');

    const db = await getDb();
    const result = await run(db, actor, groupId, targetUserId);

    if (result.ok) {
      revalidatePath(`/groups/${groupId}`);
      revalidatePath('/groups');
      revalidatePath('/mypage');
      revalidatePath('/');
    }
    return result;
  };
}

export const leaveGroup: GroupAction = withActor((db, actor, groupId) =>
  leaveGroupService(db, actor, groupId),
);

export const inviteMember: GroupAction = withActor((db, actor, groupId, targetUserId) =>
  inviteMemberService(db, actor, groupId, targetUserId),
);

export const removeMember: GroupAction = withActor((db, actor, groupId, targetUserId) =>
  removeMemberService(db, actor, groupId, targetUserId),
);

export const grantAdmin: GroupAction = withActor((db, actor, groupId, targetUserId) =>
  grantAdminService(db, actor, groupId, targetUserId),
);

export const revokeAdmin: GroupAction = withActor((db, actor, groupId, targetUserId) =>
  revokeAdminService(db, actor, groupId, targetUserId),
);

export const resignAdmin: GroupAction = withActor((db, actor, groupId) =>
  resignAdminService(db, actor, groupId),
);

export const transferOwnership: GroupAction = withActor((db, actor, groupId, targetUserId) =>
  transferOwnershipService(db, actor, groupId, targetUserId),
);
