/**
 * つながりとブロックの業務ルール（F-14・F-16）
 *
 * 2人の組み合わせは常に同じ順序で格納する（決定 T-21）。
 * データベースの CHECK 制約が最後の砦だが、ここでも並べ替えてから書く。
 *
 * ブロックの有無は相手に一切伝えない（決定29）。カード交換が成立しない理由も
 * 「読み取れませんでした」に統一し、ブロックと不存在を区別できないようにする
 * （決定 T-42）。
 */
import 'server-only';
import { and, eq, or, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { schema } from '@/db';
import { can, type Actor } from '@/domain/authorization';
import { fail, ok, type Result } from '@/lib/result';

/** 常に小さい ID を user_a_id に置く。CHECK 制約と同じ規則 */
export function orderPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** どちらか一方でもブロックしていれば true */
export async function isBlockedEitherWay(db: Db, a: string, b: string): Promise<boolean> {
  const rows = await db
    .select({ blockerId: schema.blocks.blockerId })
    .from(schema.blocks)
    .where(
      or(
        and(eq(schema.blocks.blockerId, a), eq(schema.blocks.blockedId, b)),
        and(eq(schema.blocks.blockerId, b), eq(schema.blocks.blockedId, a)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/* ------------------------------------------------------------------ *
 * F-14 カード交換
 * ------------------------------------------------------------------ */

export type ExchangeResult = {
  counterpartUserId: string;
  counterpartName: string;
  alreadyConnected: boolean;
};

/**
 * カードQRを読み取って交換を成立させる。
 *
 * 片方のスキャンで双方向に成立する（決定16）。同意を経ないため、
 * 成立時に双方へ通知し、いつでも解除できることで補償する（決定30）。
 *
 * 失敗の理由は区別しない。ブロックされている場合と相手が存在しない場合を
 * 同じ応答にすることで、スキャンの繰り返しによるブロック判定を防ぐ。
 */
export async function exchangeCardService(
  db: Db,
  actor: Actor,
  qrToken: string,
): Promise<Result<ExchangeResult>> {
  if (!can(actor, { action: 'card.exchange' })) {
    return fail('FORBIDDEN', 'この操作を行う権限がありません。');
  }

  const unavailable = fail<ExchangeResult>(
    'EXCHANGE_UNAVAILABLE',
    'このカードは読み取れませんでした。',
  );

  const rows = await db
    .select({
      userId: schema.profileCards.userId,
      displayName: schema.profileCards.displayName,
      userStatus: schema.users.status,
    })
    .from(schema.profileCards)
    .innerJoin(schema.users, eq(schema.users.id, schema.profileCards.userId))
    .where(eq(schema.profileCards.qrToken, qrToken.trim()))
    .limit(1);

  const counterpart = rows[0];
  if (!counterpart) return unavailable;
  if (counterpart.userStatus !== 'active') return unavailable;
  if (counterpart.userId === actor.userId) return unavailable;
  if (await isBlockedEitherWay(db, actor.userId, counterpart.userId)) return unavailable;

  const [a, b] = orderPair(actor.userId, counterpart.userId);

  const existing = await db
    .select({ status: schema.connections.status })
    .from(schema.connections)
    .where(and(eq(schema.connections.userAId, a), eq(schema.connections.userBId, b)))
    .limit(1);

  const alreadyConnected = existing[0]?.status === 'active';

  if (existing.length === 0) {
    await db.insert(schema.connections).values({ userAId: a, userBId: b });
  } else if (!alreadyConnected) {
    // 解除は行の削除ではなく状態遷移。再交換では状態を戻す（決定 T-16）
    await db
      .update(schema.connections)
      .set({ status: 'active', establishedAt: new Date(), releasedAt: null })
      .where(and(eq(schema.connections.userAId, a), eq(schema.connections.userBId, b)));
  }

  if (!alreadyConnected) {
    const myName = await db
      .select({ displayName: schema.profileCards.displayName })
      .from(schema.profileCards)
      .where(eq(schema.profileCards.userId, actor.userId))
      .limit(1);
    const mine = myName[0]?.displayName ?? '相手';

    // 気づかないうちにカードが渡ることを防ぐため、双方へ通知する（決定30）
    await db.insert(schema.notifications).values([
      {
        userId: counterpart.userId,
        channel: 'N4' as const,
        body: `${mine} さんとカードを交換しました。`,
        link: '/collection?tab=cards',
      },
      {
        userId: actor.userId,
        channel: 'N4' as const,
        body: `${counterpart.displayName} さんとカードを交換しました。`,
        link: '/collection?tab=cards',
      },
    ]);
  }

  return ok({
    counterpartUserId: counterpart.userId,
    counterpartName: counterpart.displayName,
    alreadyConnected,
  });
}

/* ------------------------------------------------------------------ *
 * F-16 つながりの解除とブロック
 * ------------------------------------------------------------------ */

/**
 * つながりを解除する。
 *
 * **相手には通知しない**（決定29）。同じ団や地区で顔を合わせ続ける関係において、
 * 解除されたことが相手に伝わる設計は、機能そのものを使えなくする。
 */
export async function releaseConnectionService(
  db: Db,
  actor: Actor,
  counterpartUserId: string,
): Promise<Result<null>> {
  if (!can(actor, { action: 'connection.manage' })) {
    return fail('FORBIDDEN', 'この操作を行う権限がありません。');
  }
  const [a, b] = orderPair(actor.userId, counterpartUserId);

  await db
    .update(schema.connections)
    .set({ status: 'released', releasedAt: new Date() })
    .where(
      and(
        eq(schema.connections.userAId, a),
        eq(schema.connections.userBId, b),
        eq(schema.connections.status, 'active'),
      ),
    );
  return ok(null);
}

/**
 * 相手をブロックする。つながりも同時に解除する。
 * ブロックは一方向であり、相手には通知しない。
 */
export async function blockUserService(
  db: Db,
  actor: Actor,
  targetUserId: string,
): Promise<Result<null>> {
  if (!can(actor, { action: 'connection.manage' })) {
    return fail('FORBIDDEN', 'この操作を行う権限がありません。');
  }
  if (targetUserId === actor.userId) {
    return fail('VALIDATION_FAILED', '自分をブロックすることはできません。');
  }

  await db
    .insert(schema.blocks)
    .values({ blockerId: actor.userId, blockedId: targetUserId })
    .onConflictDoNothing();

  await releaseConnectionService(db, actor, targetUserId);
  return ok(null);
}

export async function unblockUserService(
  db: Db,
  actor: Actor,
  targetUserId: string,
): Promise<Result<null>> {
  if (!can(actor, { action: 'connection.manage' })) {
    return fail('FORBIDDEN', 'この操作を行う権限がありません。');
  }
  await db
    .delete(schema.blocks)
    .where(
      and(eq(schema.blocks.blockerId, actor.userId), eq(schema.blocks.blockedId, targetUserId)),
    );
  return ok(null);
}

/** ブロック中の相手の一覧（設定画面 S-22） */
export async function listBlocked(db: Db, userId: string) {
  return db
    .select({
      userId: schema.blocks.blockedId,
      displayName: schema.profileCards.displayName,
      createdAt: schema.blocks.createdAt,
    })
    .from(schema.blocks)
    .leftJoin(schema.profileCards, eq(schema.profileCards.userId, schema.blocks.blockedId))
    .where(eq(schema.blocks.blockerId, userId))
    .orderBy(sql`${schema.blocks.createdAt} desc`);
}

/* ------------------------------------------------------------------ *
 * F-13 プロフィールカード
 * ------------------------------------------------------------------ */

export type ProfileCardInput = {
  displayName: string;
  bio?: string;
  externalLinks?: string[];
  showsAffiliation: boolean;
};

const DISPLAY_NAME_MAX = 40;
const BIO_MAX = 200;
const LINK_MAX_COUNT = 4;

export async function updateProfileCardService(
  db: Db,
  actor: Actor,
  input: ProfileCardInput,
): Promise<Result<null>> {
  if (!can(actor, { action: 'profileCard.update' })) {
    return fail('FORBIDDEN', 'この操作を行う権限がありません。');
  }

  const displayName = input.displayName.trim();
  if (displayName.length === 0 || displayName.length > DISPLAY_NAME_MAX) {
    return fail('VALIDATION_FAILED', `表示名は1〜${DISPLAY_NAME_MAX}文字で入力してください。`);
  }

  const bio = (input.bio ?? '').trim();
  if (bio.length > BIO_MAX) {
    return fail('VALIDATION_FAILED', `自己紹介は${BIO_MAX}文字以内で入力してください。`);
  }

  const links = (input.externalLinks ?? [])
    .map((link) => link.trim())
    .filter((link) => link.length > 0);
  if (links.length > LINK_MAX_COUNT) {
    return fail('VALIDATION_FAILED', `リンクは${LINK_MAX_COUNT}件までです。`);
  }
  for (const link of links) {
    // http(s) 以外のスキームを弾く。javascript: 等をカードに載せさせない
    if (!/^https?:\/\/\S+$/.test(link)) {
      return fail('VALIDATION_FAILED', 'リンクは http:// または https:// で始めてください。');
    }
  }

  const existing = await db
    .select({ userId: schema.profileCards.userId })
    .from(schema.profileCards)
    .where(eq(schema.profileCards.userId, actor.userId))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(schema.profileCards).values({
      userId: actor.userId,
      displayName,
      bio: bio || null,
      externalLinks: links,
      showsAffiliation: input.showsAffiliation,
      qrToken: crypto.randomUUID(),
    });
  } else {
    await db
      .update(schema.profileCards)
      .set({
        displayName,
        bio: bio || null,
        externalLinks: links,
        showsAffiliation: input.showsAffiliation,
      })
      .where(eq(schema.profileCards.userId, actor.userId));
  }

  // 表示名は users にも持っているため揃える
  await db
    .update(schema.users)
    .set({ displayName })
    .where(eq(schema.users.id, actor.userId));

  return ok(null);
}

/**
 * カードQRを再発行する。
 *
 * 盗撮された QR を無効にするための手段（決定30）。
 */
export async function rotateCardQrTokenService(
  db: Db,
  actor: Actor,
): Promise<Result<{ qrToken: string }>> {
  if (!can(actor, { action: 'profileCard.update' })) {
    return fail('FORBIDDEN', 'この操作を行う権限がありません。');
  }
  const qrToken = crypto.randomUUID();
  const updated = await db
    .update(schema.profileCards)
    .set({ qrToken, qrTokenRotatedAt: new Date() })
    .where(eq(schema.profileCards.userId, actor.userId))
    .returning({ qrToken: schema.profileCards.qrToken });

  const row = updated[0];
  if (!row) return fail('NOT_FOUND', 'プロフィールカードがまだありません。');
  return ok({ qrToken: row.qrToken });
}
