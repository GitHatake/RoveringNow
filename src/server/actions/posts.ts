'use server';

/**
 * 連絡に関する操作（04_api_spec.md 第4.3節・第5.1節）
 */
import { and, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getDb, schema } from '@/db';
import { can } from '@/domain/authorization';
import { resolveAudience } from '@/domain/broadcast';
import { fail, ok, type Result } from '@/lib/result';
import { getActor } from '@/lib/session';
import { loadGroup } from '@/server/group-context';
import type { PostScope, ReactionKind } from '@/db/schema';

const BODY_MAX_LENGTH = 2000;
/** 一括挿入の分割単位。1 文が長くなりすぎるのを避けるための実務上の区切り */
const INSERT_CHUNK = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

/** 通知の本文に使う要約。改行を潰し、長すぎる場合は省略する */
function summarize(body: string, limit = 60): string {
  const oneLine = body.replace(/\s+/g, ' ').trim();
  return oneLine.length <= limit ? oneLine : `${oneLine.slice(0, limit)}…`;
}

export type CreatePostInput = {
  groupId: string;
  body: string;
  scope: PostScope;
  eventAt?: string | null;
};

/**
 * 連絡を投稿する。
 *
 * 投稿・配信対象の確定・通知の作成を同一トランザクションに収める
 * （02_architecture.md 第4.3節）。「投稿はあるが誰にも届かない」中間状態を作らない。
 * プッシュ送信はトランザクションの外で行う（本工程では未実装）。
 */
export async function createPost(input: CreatePostInput): Promise<Result<{ postId: string; audienceCount: number }>> {
  const actor = await getActor();
  if (!actor) return fail('UNAUTHENTICATED', 'ログインが必要です。');

  const body = input.body.trim();
  if (body.length === 0 || body.length > BODY_MAX_LENGTH) {
    return fail('VALIDATION_FAILED', `本文は1〜${BODY_MAX_LENGTH}文字で入力してください。`);
  }
  if (input.scope !== 'self' && input.scope !== 'descendants') {
    return fail('VALIDATION_FAILED', '配信範囲が不正です。');
  }

  const db = await getDb();
  const group = await loadGroup(db, input.groupId, actor.userId);
  if (!group) return fail('NOT_FOUND', '対象が見つかりませんでした。');

  if (!can(actor, { action: 'post.create', group: group.context })) {
    return fail('FORBIDDEN', 'この操作を行う権限がありません。');
  }
  if (group.status !== 'active') {
    return fail('GROUP_NOT_ACTIVE', 'このグループは活動を終えているため、投稿できません。');
  }

  const eventAt = input.eventAt ? new Date(input.eventAt) : null;
  if (eventAt !== null && Number.isNaN(eventAt.getTime())) {
    return fail('VALIDATION_FAILED', '日時の形式が不正です。');
  }

  const postId = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.posts)
      .values({
        groupId: input.groupId,
        authorUserId: actor.userId,
        body,
        scope: input.scope,
        eventAt,
      })
      .returning({ id: schema.posts.id, createdAt: schema.posts.createdAt });

    const post = inserted[0];
    if (!post) throw new Error('連絡の作成に失敗しました');

    const audience = await resolveAudience(tx, {
      originGroupId: input.groupId,
      scope: input.scope,
    });

    if (audience.length > 0) {
      for (const part of chunk(audience, INSERT_CHUNK)) {
        await tx.insert(schema.postAudiences).values(
          part.map((row) => ({
            postId: post.id,
            userId: row.userId,
            sourceGroupId: row.sourceGroupId,
            postCreatedAt: post.createdAt,
          })),
        );
      }

      // 投稿者本人には通知しない
      const recipients = audience.filter((row) => row.userId !== actor.userId);
      for (const part of chunk(recipients, INSERT_CHUNK)) {
        await tx.insert(schema.notifications).values(
          part.map((row) => ({
            userId: row.userId,
            channel: 'N1' as const,
            body: `${group.name}：${summarize(body)}`,
            link: `/posts/${post.id}`,
          })),
        );
      }
    }

    return post.id;
  });

  const audienceCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.postAudiences)
    .where(eq(schema.postAudiences.postId, postId));

  revalidatePath('/');
  revalidatePath(`/groups/${input.groupId}`);

  return ok({ postId, audienceCount: audienceCount[0]?.count ?? 0 });
}

/**
 * 配信対象の人数を数える（連絡作成画面の常時表示・決定 T-48）。
 *
 * 「配下すべて」が何人なのかは投稿者に見えない。数字が出ていれば、
 * 38人のつもりが340人だったという事故に気づける。
 */
export async function countAudience(
  groupId: string,
  scope: PostScope,
): Promise<Result<{ count: number }>> {
  const actor = await getActor();
  if (!actor) return fail('UNAUTHENTICATED', 'ログインが必要です。');

  const db = await getDb();
  const group = await loadGroup(db, groupId, actor.userId);
  if (!group) return fail('NOT_FOUND', '対象が見つかりませんでした。');
  if (!can(actor, { action: 'post.create', group: group.context })) {
    return fail('FORBIDDEN', 'この操作を行う権限がありません。');
  }

  const audience = await resolveAudience(db, { originGroupId: groupId, scope });
  return ok({ count: audience.length });
}

export async function setReaction(
  postId: string,
  kind: ReactionKind,
): Promise<Result<{ active: boolean }>> {
  const actor = await getActor();
  if (!actor) return fail('UNAUTHENTICATED', 'ログインが必要です。');

  const db = await getDb();
  const postRows = await db
    .select({ groupId: schema.posts.groupId })
    .from(schema.posts)
    .where(eq(schema.posts.id, postId))
    .limit(1);
  const post = postRows[0];
  if (!post) return fail('NOT_FOUND', '対象が見つかりませんでした。');

  const group = await loadGroup(db, post.groupId, actor.userId);
  // 権限がない場合も存在しない場合と同じ応答にし、存在を漏らさない（決定 T-43）
  if (!group || !can(actor, { action: 'reaction.set', group: group.context })) {
    return fail('NOT_FOUND', '対象が見つかりませんでした。');
  }

  const existing = await db
    .select({ postId: schema.reactions.postId })
    .from(schema.reactions)
    .where(
      and(
        eq(schema.reactions.postId, postId),
        eq(schema.reactions.userId, actor.userId),
        eq(schema.reactions.kind, kind),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .delete(schema.reactions)
      .where(
        and(
          eq(schema.reactions.postId, postId),
          eq(schema.reactions.userId, actor.userId),
          eq(schema.reactions.kind, kind),
        ),
      );
    revalidatePath(`/posts/${postId}`);
    revalidatePath('/');
    return ok({ active: false });
  }

  // 主キー制約により、二度押しや再送でも 1 行にとどまる（決定 T-41）
  await db
    .insert(schema.reactions)
    .values({ postId, userId: actor.userId, kind })
    .onConflictDoNothing();

  revalidatePath(`/posts/${postId}`);
  revalidatePath('/');
  return ok({ active: true });
}

export async function createComment(postId: string, rawBody: string): Promise<Result<{ commentId: string }>> {
  const actor = await getActor();
  if (!actor) return fail('UNAUTHENTICATED', 'ログインが必要です。');

  const body = rawBody.trim();
  if (body.length === 0 || body.length > BODY_MAX_LENGTH) {
    return fail('VALIDATION_FAILED', `本文は1〜${BODY_MAX_LENGTH}文字で入力してください。`);
  }

  const db = await getDb();
  const postRows = await db
    .select({ groupId: schema.posts.groupId, authorUserId: schema.posts.authorUserId })
    .from(schema.posts)
    .where(eq(schema.posts.id, postId))
    .limit(1);
  const post = postRows[0];
  if (!post) return fail('NOT_FOUND', '対象が見つかりませんでした。');

  const group = await loadGroup(db, post.groupId, actor.userId);
  if (!group || !can(actor, { action: 'comment.create', group: group.context })) {
    return fail('NOT_FOUND', '対象が見つかりませんでした。');
  }
  if (group.status !== 'active') {
    return fail('GROUP_NOT_ACTIVE', 'このグループは活動を終えているため、投稿できません。');
  }

  const inserted = await db
    .insert(schema.comments)
    .values({ postId, authorUserId: actor.userId, body })
    .returning({ id: schema.comments.id });

  const comment = inserted[0];
  if (!comment) return fail('INTERNAL', '処理中に問題が発生しました。');

  // 連絡の投稿者へ通知する（チャンネル N-2）
  if (post.authorUserId !== actor.userId) {
    await db.insert(schema.notifications).values({
      userId: post.authorUserId,
      channel: 'N2',
      body: `あなたの連絡にコメントがつきました：${summarize(body, 40)}`,
      link: `/posts/${postId}`,
    });
  }

  revalidatePath(`/posts/${postId}`);
  return ok({ commentId: comment.id });
}
