/**
 * 所属と管理者に関する業務ルール
 *
 * Server Action から切り離してあるのは、`next/headers` に依存せず単体で検証できる
 * ようにするため。操作者の解決は呼び出し側（actions）が行う。
 *
 * 唯一の管理者の離脱は同時実行で壊れるため、管理者行をロックしてから数える
 * （03_db_schema.md 第5.3節・決定34）。
 */
import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { schema } from '@/db';
import { can, type Actor } from '@/domain/authorization';
import { fail, ok, type Result } from '@/lib/result';
import { loadGroup } from '@/server/group-context';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tx = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result !== null && typeof result === 'object' && 'rows' in result) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

/**
 * 承認済みの管理者を、**行をロックしたうえで**数える。
 * 同時に2人が辞任して管理者が0人になる競合を防ぐ。
 *
 * `count(*)` と `for update` は併用できない（PostgreSQL は
 * 「FOR UPDATE is not allowed with aggregate functions」で拒否する）。
 * そのため行を取得してロックし、件数はアプリケーション側で数える。
 *
 * 行ロックは既存の管理者行に対してかかる。新たな管理者の追加（ファントム）は
 * 防げないが、それは件数を増やす方向なので不変条件（0人にしない）は破られない。
 *
 * トランザクションの中で呼ぶこと。
 */
export async function countActiveAdminsForUpdate(tx: Tx, groupId: string): Promise<number> {
  const result = await tx.execute(sql`
    select user_id
      from memberships
     where group_id = ${groupId}
       and role = 'admin'
       and status = 'active'
       for update
  `);
  return rowsOf<{ user_id: string }>(result).length;
}

/** 対象が承認済みメンバーであることを確かめる */
async function activeMembership(
  db: Db,
  groupId: string,
  userId: string,
): Promise<{ role: 'admin' | 'member' } | null> {
  const rows = await db
    .select({ role: schema.memberships.role, status: schema.memberships.status })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.groupId, groupId), eq(schema.memberships.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row || row.status !== 'active') return null;
  return { role: row.role };
}

async function notify(
  db: Db,
  userId: string,
  channel: 'N5' | 'N6',
  body: string,
  link: string,
): Promise<void> {
  await db.insert(schema.notifications).values({ userId, channel, body, link });
}

/* ------------------------------------------------------------------ *
 * F-16 グループからの脱退
 * ------------------------------------------------------------------ */

export async function leaveGroupService(
  db: Db,
  actor: Actor,
  groupId: string,
): Promise<Result<null>> {
  const group = await loadGroup(db, groupId, actor.userId);
  if (!group) return fail('NOT_FOUND', '対象が見つかりませんでした。');

  if (!can(actor, { action: 'group.leave', group: group.context })) {
    // オーナーはここに来る。移譲を促す（決定45）
    if (group.context.ownerUserId === actor.userId) {
      return fail(
        'FORBIDDEN',
        'オーナーは脱退できません。先に別の管理者へオーナーを移譲してください。',
      );
    }
    return fail('FORBIDDEN', 'この操作を行う権限がありません。');
  }

  return db.transaction(async (tx: Tx): Promise<Result<null>> => {
    if (group.context.membership?.role === 'admin') {
      if ((await countActiveAdminsForUpdate(tx, groupId)) <= 1) {
        return fail('LAST_ADMIN', 'あなたはこのグループの唯一の管理者です。先に後任を決めてください。');
      }
    }
    await tx
      .update(schema.memberships)
      .set({ status: 'left', role: 'member', leftAt: new Date() })
      .where(
        and(eq(schema.memberships.groupId, groupId), eq(schema.memberships.userId, actor.userId)),
      );
    return ok(null);
  });
}

/* ------------------------------------------------------------------ *
 * F-04 メンバーの招待・除名
 * ------------------------------------------------------------------ */

export async function inviteMemberService(
  db: Db,
  actor: Actor,
  groupId: string,
  targetUserId: string,
): Promise<Result<null>> {
  const group = await loadGroup(db, groupId, actor.userId);
  if (!group) return fail('NOT_FOUND', '対象が見つかりませんでした。');
  if (!can(actor, { action: 'membership.invite', group: group.context })) {
    return fail('FORBIDDEN', 'この操作を行う権限がありません。');
  }
  if (group.status !== 'active') {
    return fail('GROUP_NOT_ACTIVE', 'このグループは活動を終えています。');
  }

  const existing = await db
    .select({ status: schema.memberships.status })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.groupId, groupId), eq(schema.memberships.userId, targetUserId)))
    .limit(1);

  if (existing[0]?.status === 'active') return ok(null);

  if (existing.length > 0) {
    await db
      .update(schema.memberships)
      .set({ status: 'invited', invitedByUserId: actor.userId, leftAt: null })
      .where(
        and(eq(schema.memberships.groupId, groupId), eq(schema.memberships.userId, targetUserId)),
      );
  } else {
    await db.insert(schema.memberships).values({
      groupId,
      userId: targetUserId,
      status: 'invited',
      role: 'member',
      invitedByUserId: actor.userId,
    });
  }

  await notify(db, targetUserId, 'N5', `${group.name} に招待されました。`, `/groups/${groupId}`);
  return ok(null);
}

export async function removeMemberService(
  db: Db,
  actor: Actor,
  groupId: string,
  targetUserId: string,
): Promise<Result<null>> {
  const group = await loadGroup(db, groupId, actor.userId);
  if (!group) return fail('NOT_FOUND', '対象が見つかりませんでした。');
  if (!can(actor, { action: 'membership.remove', group: group.context, targetUserId })) {
    if (targetUserId === group.context.ownerUserId) {
      return fail('FORBIDDEN', 'オーナーを除名することはできません。');
    }
    if (targetUserId === actor.userId) {
      return fail('FORBIDDEN', '自分を外す場合は脱退を使ってください。');
    }
    return fail('FORBIDDEN', 'この操作を行う権限がありません。');
  }

  const target = await activeMembership(db, groupId, targetUserId);
  if (!target) return fail('NOT_FOUND', '対象が見つかりませんでした。');

  return db.transaction(async (tx: Tx): Promise<Result<null>> => {
    // 管理者を除名すると管理者が0人になる場合は止める
    if (target.role === 'admin' && (await countActiveAdminsForUpdate(tx, groupId)) <= 1) {
      return fail('LAST_ADMIN', 'このグループの唯一の管理者です。先に後任を決めてください。');
    }
    await tx
      .update(schema.memberships)
      .set({ status: 'left', role: 'member', leftAt: new Date() })
      .where(
        and(eq(schema.memberships.groupId, groupId), eq(schema.memberships.userId, targetUserId)),
      );
    return ok(null);
  });
}

/* ------------------------------------------------------------------ *
 * F-17 管理者の交代
 * ------------------------------------------------------------------ */

export async function grantAdminService(
  db: Db,
  actor: Actor,
  groupId: string,
  targetUserId: string,
): Promise<Result<null>> {
  const group = await loadGroup(db, groupId, actor.userId);
  if (!group) return fail('NOT_FOUND', '対象が見つかりませんでした。');
  if (!can(actor, { action: 'admin.grant', group: group.context })) {
    return fail('FORBIDDEN', 'この操作を行う権限がありません。');
  }
  if (!(await activeMembership(db, groupId, targetUserId))) {
    return fail('NOT_FOUND', '承認済みのメンバーではありません。');
  }

  await db
    .update(schema.memberships)
    .set({ role: 'admin' })
    .where(and(eq(schema.memberships.groupId, groupId), eq(schema.memberships.userId, targetUserId)));

  await notify(
    db,
    targetUserId,
    'N6',
    `${group.name} の管理者になりました。`,
    `/groups/${groupId}`,
  );
  return ok(null);
}

export async function revokeAdminService(
  db: Db,
  actor: Actor,
  groupId: string,
  targetUserId: string,
): Promise<Result<null>> {
  const group = await loadGroup(db, groupId, actor.userId);
  if (!group) return fail('NOT_FOUND', '対象が見つかりませんでした。');
  // オーナーのみが行える
  if (!can(actor, { action: 'admin.revoke', group: group.context })) {
    return fail('FORBIDDEN', '管理者権限の剥奪はオーナーのみが行えます。');
  }
  // オーナー自身の権限は剥奪されない
  if (targetUserId === group.context.ownerUserId) {
    return fail('FORBIDDEN', 'オーナーの権限は剥奪できません。');
  }

  const target = await activeMembership(db, groupId, targetUserId);
  if (!target || target.role !== 'admin') {
    return fail('NOT_FOUND', '対象は管理者ではありません。');
  }

  return db.transaction(async (tx: Tx): Promise<Result<null>> => {
    if ((await countActiveAdminsForUpdate(tx, groupId)) <= 1) {
      return fail('LAST_ADMIN', 'このグループの唯一の管理者です。先に後任を決めてください。');
    }
    await tx
      .update(schema.memberships)
      .set({ role: 'member' })
      .where(
        and(eq(schema.memberships.groupId, groupId), eq(schema.memberships.userId, targetUserId)),
      );
    return ok(null);
  });
}

export async function resignAdminService(
  db: Db,
  actor: Actor,
  groupId: string,
): Promise<Result<null>> {
  const group = await loadGroup(db, groupId, actor.userId);
  if (!group) return fail('NOT_FOUND', '対象が見つかりませんでした。');
  if (!can(actor, { action: 'admin.resign', group: group.context })) {
    if (group.context.ownerUserId === actor.userId) {
      return fail('FORBIDDEN', 'オーナーは辞任できません。先にオーナーを移譲してください。');
    }
    return fail('FORBIDDEN', 'この操作を行う権限がありません。');
  }

  return db.transaction(async (tx: Tx): Promise<Result<null>> => {
    if ((await countActiveAdminsForUpdate(tx, groupId)) <= 1) {
      return fail('LAST_ADMIN', 'あなたはこのグループの唯一の管理者です。先に後任を決めてください。');
    }
    await tx
      .update(schema.memberships)
      .set({ role: 'member' })
      .where(
        and(eq(schema.memberships.groupId, groupId), eq(schema.memberships.userId, actor.userId)),
      );
    return ok(null);
  });
}

/**
 * オーナーを移譲する。
 *
 * 移譲先は同じグループの承認済み管理者に限る。移譲後、元のオーナーは管理者として残る
 * （権限を失うのはオーナーとしての立場のみ）。
 */
export async function transferOwnershipService(
  db: Db,
  actor: Actor,
  groupId: string,
  targetUserId: string,
): Promise<Result<null>> {
  const group = await loadGroup(db, groupId, actor.userId);
  if (!group) return fail('NOT_FOUND', '対象が見つかりませんでした。');
  if (!can(actor, { action: 'owner.transfer', group: group.context })) {
    return fail('FORBIDDEN', 'オーナーの移譲はオーナーのみが行えます。');
  }
  if (targetUserId === actor.userId) {
    return fail('VALIDATION_FAILED', 'すでにあなたがオーナーです。');
  }

  const target = await activeMembership(db, groupId, targetUserId);
  if (!target || target.role !== 'admin') {
    return fail('VALIDATION_FAILED', '移譲先は、このグループの管理者から選んでください。');
  }

  await db
    .update(schema.groups)
    .set({ ownerUserId: targetUserId })
    .where(eq(schema.groups.id, groupId));

  await notify(
    db,
    targetUserId,
    'N6',
    `${group.name} のオーナーになりました。`,
    `/groups/${groupId}`,
  );
  return ok(null);
}
