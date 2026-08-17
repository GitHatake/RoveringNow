'use server';

/**
 * グループに関する操作（04_api_spec.md 第4.2節）
 */
import { and, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getDb, schema } from '@/db';
import { can } from '@/domain/authorization';
import { checkGroupName, suggestAlternativeNames } from '@/domain/group-name';
import { fail, ok, type Result } from '@/lib/result';
import { getActor } from '@/lib/session';
import { loadGroup } from '@/server/group-context';
import type { GroupKind, JoinPolicy } from '@/db/schema';

/** 名前が使用可能かを調べる。一意性の保証は UNIQUE 制約が行い、ここは即時表示のため */
async function isNameAvailable(normalized: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(eq(schema.groups.nameNormalized, normalized))
    .limit(1);
  return rows.length === 0;
}

export type NameCheckResult =
  | { state: 'available'; name: string }
  | { state: 'taken'; name: string; suggestions: string[] }
  | { state: 'invalid'; reason: string };

/**
 * グループ名の重複判定（デザインシステム 第6.7節）。
 *
 * 重複はエラーとして赤く示さない。利用者の間違いではなく、
 * 単に先に使われていたというだけであるため、事実の提示と代替案の提案にとどめる。
 */
export async function checkName(rawName: string, hints: string[] = []): Promise<NameCheckResult> {
  const checked = checkGroupName(rawName);
  if (!checked.ok) {
    const reason =
      checked.error === 'too_long'
        ? '名前が長すぎます。'
        : checked.error === 'normalized_too_long'
          ? 'この文字は使えません。'
          : '名前を入力してください。';
    return { state: 'invalid', reason };
  }

  if (await isNameAvailable(checked.normalized)) {
    return { state: 'available', name: checked.name };
  }

  const suggestions = await suggestAlternativeNames(rawName, hints, isNameAvailable);
  return { state: 'taken', name: checked.name, suggestions };
}

export type CreateGroupInput = {
  name: string;
  kind: GroupKind;
  joinPolicy: JoinPolicy;
  description?: string;
  expiresAt?: string | null;
};

export async function createGroup(input: CreateGroupInput): Promise<Result<{ groupId: string }>> {
  const actor = await getActor();
  if (!actor) return fail('UNAUTHENTICATED', 'ログインが必要です。');
  if (!can(actor, { action: 'group.create' })) {
    return fail('FORBIDDEN', 'この操作を行う権限がありません。');
  }

  const checked = checkGroupName(input.name);
  if (!checked.ok) return fail('VALIDATION_FAILED', '名前を確認してください。');

  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  if (expiresAt !== null && Number.isNaN(expiresAt.getTime())) {
    return fail('VALIDATION_FAILED', '期限の形式が不正です。');
  }

  const db = await getDb();
  try {
    const groupId = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(schema.groups)
        .values({
          name: checked.name,
          nameNormalized: checked.normalized,
          kind: input.kind,
          ownerUserId: actor.userId,
          joinPolicy: input.joinPolicy,
          description: input.description?.trim() || null,
          expiresAt,
          joinQrToken: crypto.randomUUID(),
        })
        .returning({ id: schema.groups.id });

      const group = inserted[0];
      if (!group) throw new Error('グループの作成に失敗しました');

      // 作成者はオーナーであり、同時に管理者として所属する
      await tx.insert(schema.memberships).values({
        groupId: group.id,
        userId: actor.userId,
        status: 'active',
        role: 'admin',
        joinedAt: new Date(),
      });

      return group.id;
    });

    revalidatePath('/groups');
    revalidatePath('/mypage');
    return ok({ groupId });
  } catch (error) {
    // 一意性の最終的な担保はデータベースが行う。同時作成の競合はここに来る
    if (String(error).includes('uq_groups_name_normalized')) {
      return fail('GROUP_NAME_TAKEN', 'この名前は直前に使用されました。別の名前をお試しください。');
    }
    throw error;
  }
}

export async function joinGroup(groupId: string): Promise<Result<{ status: 'active' | 'requested' | 'unavailable' }>> {
  const actor = await getActor();
  if (!actor) return fail('UNAUTHENTICATED', 'ログインが必要です。');
  if (!can(actor, { action: 'group.searchAndJoin' })) {
    return fail('FORBIDDEN', 'この操作を行う権限がありません。');
  }

  const db = await getDb();
  const group = await loadGroup(db, groupId, actor.userId);
  if (!group) return fail('NOT_FOUND', '対象が見つかりませんでした。');
  if (group.status !== 'active') {
    return fail('GROUP_NOT_ACTIVE', 'このグループは活動を終えています。');
  }

  const policyRows = await db
    .select({ joinPolicy: schema.groups.joinPolicy })
    .from(schema.groups)
    .where(eq(schema.groups.id, groupId))
    .limit(1);
  const joinPolicy = policyRows[0]?.joinPolicy;
  if (!joinPolicy) return fail('NOT_FOUND', '対象が見つかりませんでした。');

  // 招待制のグループには、招待を受けていない限り参加できない
  if (joinPolicy === 'invite' && group.context.membership?.status !== 'invited') {
    return ok({ status: 'unavailable' });
  }

  const nextStatus = joinPolicy === 'request' ? 'requested' : 'active';
  const existing = group.context.membership;

  if (existing) {
    if (existing.status === 'active') return ok({ status: 'active' });
    await db
      .update(schema.memberships)
      .set({
        status: nextStatus,
        joinedAt: nextStatus === 'active' ? new Date() : null,
        leftAt: null,
      })
      .where(
        and(eq(schema.memberships.groupId, groupId), eq(schema.memberships.userId, actor.userId)),
      );
  } else {
    await db.insert(schema.memberships).values({
      groupId,
      userId: actor.userId,
      status: nextStatus,
      role: 'member',
      joinedAt: nextStatus === 'active' ? new Date() : null,
    });
  }

  revalidatePath(`/groups/${groupId}`);
  revalidatePath('/');
  return ok({ status: nextStatus });
}

/**
 * グループから脱退する。
 *
 * 唯一の管理者は後任を指名するまで脱退できない（決定34）。
 * 同時辞任により管理者が 0 人になる競合を防ぐため、管理者行をロックしてから数える
 * （03_db_schema.md 第5.3節）。
 */
export async function leaveGroup(groupId: string): Promise<Result<null>> {
  const actor = await getActor();
  if (!actor) return fail('UNAUTHENTICATED', 'ログインが必要です。');

  const db = await getDb();
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

  const result = await db.transaction(async (tx): Promise<Result<null>> => {
    if (group.context.membership?.role === 'admin') {
      const admins = await tx.execute(sql`
        select count(*)::int as count
          from memberships
         where group_id = ${groupId}
           and role = 'admin'
           and status = 'active'
           for update
      `);
      const rows = Array.isArray(admins)
        ? (admins as Array<{ count: number }>)
        : (admins as { rows: Array<{ count: number }> }).rows;
      if ((rows[0]?.count ?? 0) <= 1) {
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

  if (result.ok) {
    revalidatePath(`/groups/${groupId}`);
    revalidatePath('/');
  }
  return result;
}

export async function approveJoinRequest(groupId: string, targetUserId: string): Promise<Result<null>> {
  const actor = await getActor();
  if (!actor) return fail('UNAUTHENTICATED', 'ログインが必要です。');

  const db = await getDb();
  const group = await loadGroup(db, groupId, actor.userId);
  if (!group) return fail('NOT_FOUND', '対象が見つかりませんでした。');
  if (!can(actor, { action: 'membership.decideRequest', group: group.context })) {
    return fail('FORBIDDEN', 'この操作を行う権限がありません。');
  }

  await db
    .update(schema.memberships)
    .set({ status: 'active', joinedAt: new Date() })
    .where(
      and(
        eq(schema.memberships.groupId, groupId),
        eq(schema.memberships.userId, targetUserId),
        eq(schema.memberships.status, 'requested'),
      ),
    );

  await db.insert(schema.notifications).values({
    userId: targetUserId,
    channel: 'N5',
    body: `${group.name} への参加が承認されました。`,
    link: `/groups/${groupId}`,
  });

  revalidatePath(`/groups/${groupId}`);
  return ok(null);
}

/**
 * 配信元グループをミュートする（決定32）。
 *
 * 所属グループではなく配信元グループを対象にするため、
 * 自分が所属していない上位グループも静かにできる。
 */
export async function toggleMute(groupId: string): Promise<Result<{ muted: boolean }>> {
  const actor = await getActor();
  if (!actor) return fail('UNAUTHENTICATED', 'ログインが必要です。');

  const db = await getDb();
  const existing = await db
    .select({ userId: schema.groupMutes.userId })
    .from(schema.groupMutes)
    .where(
      and(eq(schema.groupMutes.userId, actor.userId), eq(schema.groupMutes.groupId, groupId)),
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .delete(schema.groupMutes)
      .where(
        and(eq(schema.groupMutes.userId, actor.userId), eq(schema.groupMutes.groupId, groupId)),
      );
    revalidatePath(`/groups/${groupId}`);
    return ok({ muted: false });
  }

  await db
    .insert(schema.groupMutes)
    .values({ userId: actor.userId, groupId })
    .onConflictDoNothing();
  revalidatePath(`/groups/${groupId}`);
  return ok({ muted: true });
}
