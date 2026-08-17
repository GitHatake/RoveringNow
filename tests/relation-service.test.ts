/**
 * つながり・ブロック・プロフィールカードの検証
 *
 * 重点は次の2つ。
 * ① 2人の組み合わせが常に同じ順序で格納されること（決定 T-21）
 * ② 交換できない理由が区別できないこと（決定 T-42）。ブロックと不存在が
 *    別の応答になると、スキャンを繰り返すだけでブロックの有無を判定できてしまう
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { Actor } from '@/domain/authorization';
import type { Db } from '@/db';
import { schema } from '@/db';
import {
  blockUserService,
  exchangeCardService,
  orderPair,
  releaseConnectionService,
  listBlocked,
  rotateCardQrTokenService,
  unblockUserService,
  updateProfileCardService,
} from '@/server/relation-service';
import { createTestDb, type TestDb } from './helpers/db';

let ctx: TestDb;
let db: Db;
const u: Record<string, string> = {};
const token: Record<string, string> = {};

const actorOf = (key: string): Actor => ({
  userId: u[key]!,
  status: 'active',
  isSystemAdmin: false,
});

async function addUser(key: string, status = 'active'): Promise<void> {
  const r = await ctx.client.query<{ id: string }>(
    `insert into users (display_name, email, status) values ($1, $2, $3) returning id`,
    [key, `${key}-${crypto.randomUUID()}@example.test`, status],
  );
  u[key] = r.rows[0]!.id;
  token[key] = `card-${key}-${crypto.randomUUID()}`;
  await ctx.client.query(
    `insert into profile_cards (user_id, display_name, qr_token) values ($1, $2, $3)`,
    [u[key], key, token[key]],
  );
}

async function connectionOf(a: string, b: string) {
  const [x, y] = orderPair(u[a]!, u[b]!);
  const rows = await db
    .select({ status: schema.connections.status })
    .from(schema.connections)
    .where(and(eq(schema.connections.userAId, x), eq(schema.connections.userBId, y)))
    .limit(1);
  return rows[0];
}

beforeEach(async () => {
  ctx = await createTestDb();
  db = ctx.db as unknown as Db;
  for (const key of ['a', 'b', 'c']) await addUser(key);
  await addUser('suspended', 'suspended');
});

describe('組み合わせの正規化（決定 T-21）', () => {
  it('どちらから交換しても同じ1行になる', async () => {
    await exchangeCardService(db, actorOf('a'), token.b!);
    const first = await db.select().from(schema.connections);
    expect(first).toHaveLength(1);

    // 逆方向から交換しても行は増えない
    await exchangeCardService(db, actorOf('b'), token.a!);
    const second = await db.select().from(schema.connections);
    expect(second).toHaveLength(1);
  });

  it('常に小さい ID が user_a_id に入る', async () => {
    await exchangeCardService(db, actorOf('b'), token.a!);
    const rows = await db.select().from(schema.connections);
    expect(rows[0]!.userAId < rows[0]!.userBId).toBe(true);
  });
});

describe('カード交換（F-14）', () => {
  it('交換が成立し、双方に通知が届く（決定30）', async () => {
    const result = await exchangeCardService(db, actorOf('a'), token.b!);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.alreadyConnected).toBe(false);

    const notes = await db
      .select({ userId: schema.notifications.userId, channel: schema.notifications.channel })
      .from(schema.notifications);
    const recipients = notes.filter((n) => n.channel === 'N4').map((n) => n.userId);
    expect(recipients).toContain(u.a);
    expect(recipients).toContain(u.b);
  });

  it('二度スキャンしても成功として扱い、通知は増やさない（冪等・決定 T-41）', async () => {
    await exchangeCardService(db, actorOf('a'), token.b!);
    const before = (await db.select().from(schema.notifications)).length;

    const again = await exchangeCardService(db, actorOf('a'), token.b!);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.data.alreadyConnected).toBe(true);

    const after = (await db.select().from(schema.notifications)).length;
    expect(after).toBe(before);
  });

  it('解除したあと再交換すると、つながりが戻る', async () => {
    await exchangeCardService(db, actorOf('a'), token.b!);
    await releaseConnectionService(db, actorOf('a'), u.b!);
    expect((await connectionOf('a', 'b'))?.status).toBe('released');

    await exchangeCardService(db, actorOf('a'), token.b!);
    expect((await connectionOf('a', 'b'))?.status).toBe('active');
  });
});

describe('交換できない理由を区別させない（決定 T-42）', () => {
  const expectSameFailure = (results: Array<{ ok: boolean; code?: string; message?: string }>) => {
    for (const r of results) expect(r.ok).toBe(false);
    const codes = new Set(results.map((r) => (r as { code: string }).code));
    const messages = new Set(results.map((r) => (r as { message: string }).message));
    // すべて同じコード・同じ文言でなければ、応答から内部状態が読める
    expect(codes.size).toBe(1);
    expect(messages.size).toBe(1);
  };

  it('ブロック・不存在・退会・自分自身が、すべて同じ応答になる', async () => {
    await blockUserService(db, actorOf('c'), u.a!);

    const blocked = await exchangeCardService(db, actorOf('a'), token.c!);
    const missing = await exchangeCardService(db, actorOf('a'), 'card-does-not-exist');
    const suspended = await exchangeCardService(db, actorOf('a'), token.suspended!);
    const itself = await exchangeCardService(db, actorOf('a'), token.a!);

    expectSameFailure([blocked, missing, suspended, itself]);
    expect((blocked as { code: string }).code).toBe('EXCHANGE_UNAVAILABLE');
  });

  it('自分がブロックした相手とも交換できない', async () => {
    await blockUserService(db, actorOf('a'), u.b!);
    const result = await exchangeCardService(db, actorOf('a'), token.b!);
    expect(result.ok).toBe(false);
  });

  it('QRを再発行すると、古いQRでは交換できなくなる（決定30）', async () => {
    const old = token.b!;
    const rotated = await rotateCardQrTokenService(db, actorOf('b'));
    expect(rotated.ok).toBe(true);

    const withOld = await exchangeCardService(db, actorOf('a'), old);
    expect(withOld.ok).toBe(false);

    if (rotated.ok) {
      const withNew = await exchangeCardService(db, actorOf('a'), rotated.data.qrToken);
      expect(withNew.ok).toBe(true);
    }
  });
});

describe('つながりの解除とブロック（F-16）', () => {
  it('解除は相手に通知しない（決定29）', async () => {
    await exchangeCardService(db, actorOf('a'), token.b!);
    await db.delete(schema.notifications);

    await releaseConnectionService(db, actorOf('a'), u.b!);
    const notes = await db.select().from(schema.notifications);
    expect(notes).toHaveLength(0);
  });

  it('どちらからでも解除できる', async () => {
    await exchangeCardService(db, actorOf('a'), token.b!);
    await releaseConnectionService(db, actorOf('b'), u.a!);
    expect((await connectionOf('a', 'b'))?.status).toBe('released');
  });

  it('ブロックするとつながりも解除される', async () => {
    await exchangeCardService(db, actorOf('a'), token.b!);
    await blockUserService(db, actorOf('a'), u.b!);
    expect((await connectionOf('a', 'b'))?.status).toBe('released');
  });

  it('ブロックは一方向で、相手には通知しない', async () => {
    await db.delete(schema.notifications);
    await blockUserService(db, actorOf('a'), u.b!);

    const blocks = await db.select().from(schema.blocks);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.blockerId).toBe(u.a);
    expect(await db.select().from(schema.notifications)).toHaveLength(0);
  });

  it('二度ブロックしても1行にとどまる（冪等）', async () => {
    await blockUserService(db, actorOf('a'), u.b!);
    await blockUserService(db, actorOf('a'), u.b!);
    expect(await db.select().from(schema.blocks)).toHaveLength(1);
  });

  it('自分をブロックできない', async () => {
    const result = await blockUserService(db, actorOf('a'), u.a!);
    expect(result.ok).toBe(false);
  });

  it('ブロックを解除できる', async () => {
    await blockUserService(db, actorOf('a'), u.b!);
    await unblockUserService(db, actorOf('a'), u.b!);
    expect(await db.select().from(schema.blocks)).toHaveLength(0);
  });

  it('ブロック中の一覧を返す', async () => {
    await blockUserService(db, actorOf('a'), u.b!);
    const rows = await listBlocked(db, u.a!);
    expect(rows.map((r) => r.displayName)).toEqual(['b']);
  });
});

describe('プロフィールカードの編集（F-13）', () => {
  it('表示名と自己紹介を保存し、users にも反映する', async () => {
    const result = await updateProfileCardService(db, actorOf('a'), {
      displayName: '海野 千尋',
      bio: 'カヌーが好きです。',
      showsAffiliation: true,
    });
    expect(result.ok).toBe(true);

    const card = await db
      .select()
      .from(schema.profileCards)
      .where(eq(schema.profileCards.userId, u.a!));
    expect(card[0]!.displayName).toBe('海野 千尋');

    const user = await db.select().from(schema.users).where(eq(schema.users.id, u.a!));
    expect(user[0]!.displayName).toBe('海野 千尋');
  });

  it('空の表示名を拒否する', async () => {
    const result = await updateProfileCardService(db, actorOf('a'), {
      displayName: '   ',
      showsAffiliation: true,
    });
    expect(result.ok).toBe(false);
  });

  it('http(s) 以外のリンクを拒否する', async () => {
    for (const link of ['javascript:alert(1)', 'data:text/html,x', 'ftp://example.test']) {
      const result = await updateProfileCardService(db, actorOf('a'), {
        displayName: 'a',
        externalLinks: [link],
        showsAffiliation: true,
      });
      expect(result.ok).toBe(false);
    }
  });

  it('https のリンクは受け付ける', async () => {
    const result = await updateProfileCardService(db, actorOf('a'), {
      displayName: 'a',
      externalLinks: ['https://example.test/me'],
      showsAffiliation: true,
    });
    expect(result.ok).toBe(true);
  });

  it('リンクの上限を超えると拒否する', async () => {
    const result = await updateProfileCardService(db, actorOf('a'), {
      displayName: 'a',
      externalLinks: Array.from({ length: 5 }, (_, i) => `https://example.test/${i}`),
      showsAffiliation: true,
    });
    expect(result.ok).toBe(false);
  });

  it('所属の表示可否を保存する（決定38）', async () => {
    await updateProfileCardService(db, actorOf('a'), {
      displayName: 'a',
      showsAffiliation: false,
    });
    const card = await db
      .select()
      .from(schema.profileCards)
      .where(eq(schema.profileCards.userId, u.a!));
    expect(card[0]!.showsAffiliation).toBe(false);
  });
});
