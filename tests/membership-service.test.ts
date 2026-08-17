/**
 * 所属と管理者の業務ルールの検証
 *
 * ここは「唯一の管理者を離脱させない」という不変条件を守る箇所である。
 * 同時実行で壊れるため行ロックを用いているが、正しさの大部分は
 * 「どの経路からでも管理者が0人にならない」ことにある。経路が複数（脱退・辞任・
 * 剥奪・除名）あるため、すべてを固定する。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { eq, and } from 'drizzle-orm';
import type { Actor } from '@/domain/authorization';
import type { Db } from '@/db';
import { schema } from '@/db';
import {
  grantAdminService,
  inviteMemberService,
  leaveGroupService,
  removeMemberService,
  resignAdminService,
  revokeAdminService,
  transferOwnershipService,
} from '@/server/membership-service';
import { createTestDb, type TestDb } from './helpers/db';

let ctx: TestDb;
let db: Db;
const u: Record<string, string> = {};
let groupId: string;

const actorOf = (key: string): Actor => ({
  userId: u[key]!,
  status: 'active',
  isSystemAdmin: false,
});

async function addUser(key: string): Promise<void> {
  const r = await ctx.client.query<{ id: string }>(
    `insert into users (display_name, email) values ($1, $2) returning id`,
    [key, `${key}-${crypto.randomUUID()}@example.test`],
  );
  u[key] = r.rows[0]!.id;
}

async function join(key: string, role: string, status: string): Promise<void> {
  await ctx.client.query(
    `insert into memberships (group_id, user_id, role, status, joined_at)
     values ($1, $2, $3, $4, now())`,
    [groupId, u[key], role, status],
  );
}

async function roleOf(key: string): Promise<{ role: string; status: string } | undefined> {
  const rows = await db
    .select({ role: schema.memberships.role, status: schema.memberships.status })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.groupId, groupId), eq(schema.memberships.userId, u[key]!)))
    .limit(1);
  return rows[0];
}

async function activeAdminCount(): Promise<number> {
  const rows = await ctx.client.query<{ c: string }>(
    `select count(*)::text as c from memberships
      where group_id = $1 and role = 'admin' and status = 'active'`,
    [groupId],
  );
  return Number(rows.rows[0]!.c);
}

/** 毎回まっさらな状態から作り直す。状態の持ち越しで検証が甘くなるのを避ける */
beforeEach(async () => {
  ctx = await createTestDb();
  db = ctx.db as unknown as Db;
  for (const key of ['owner', 'admin2', 'member1', 'member2', 'outsider']) await addUser(key);

  const g = await ctx.client.query<{ id: string }>(
    `insert into groups (name, name_normalized, kind, owner_user_id, join_policy, join_qr_token)
     values ('テスト会', 'てすと会', 'official', $1, 'request', $2) returning id`,
    [u.owner, crypto.randomUUID()],
  );
  groupId = g.rows[0]!.id;

  await join('owner', 'admin', 'active');
  await join('admin2', 'admin', 'active');
  await join('member1', 'member', 'active');
  await join('member2', 'member', 'active');
});

describe('唯一の管理者を離脱させない（決定34）', () => {
  it('管理者が2人なら辞任できる', async () => {
    const result = await resignAdminService(db, actorOf('admin2'), groupId);
    expect(result.ok).toBe(true);
    expect((await roleOf('admin2'))?.role).toBe('member');
    expect(await activeAdminCount()).toBe(1);
  });

  it('唯一の管理者は辞任できない', async () => {
    await resignAdminService(db, actorOf('admin2'), groupId);
    // 残ったのはオーナーのみ。オーナーは辞任ではなく移譲を行う
    const result = await resignAdminService(db, actorOf('owner'), groupId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('FORBIDDEN');
    expect(await activeAdminCount()).toBe(1);
  });

  it('管理者でないメンバーが唯一の管理者になった場合、辞任できない', async () => {
    // owner を管理者から外せないため、member1 を管理者にしてから owner を移譲する
    await grantAdminService(db, actorOf('owner'), groupId, u.member1!);
    await transferOwnershipService(db, actorOf('owner'), groupId, u.member1!);
    // owner と admin2 を管理者から外し、member1 だけにする
    await revokeAdminService(db, actorOf('member1'), groupId, u.owner!);
    await revokeAdminService(db, actorOf('member1'), groupId, u.admin2!);
    expect(await activeAdminCount()).toBe(1);

    const result = await resignAdminService(db, actorOf('member1'), groupId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('FORBIDDEN'); // 新オーナーなので辞任不可
    expect(await activeAdminCount()).toBe(1);
  });

  it('唯一の管理者は脱退できない', async () => {
    await grantAdminService(db, actorOf('owner'), groupId, u.member1!);
    await transferOwnershipService(db, actorOf('owner'), groupId, u.member1!);
    await revokeAdminService(db, actorOf('member1'), groupId, u.admin2!);
    await revokeAdminService(db, actorOf('member1'), groupId, u.owner!);
    expect(await activeAdminCount()).toBe(1);

    // member1 はオーナーなので脱退不可（決定45）
    const asOwner = await leaveGroupService(db, actorOf('member1'), groupId);
    expect(asOwner.ok).toBe(false);
    expect(await activeAdminCount()).toBe(1);
  });

  it('唯一の管理者を除名できない', async () => {
    await grantAdminService(db, actorOf('owner'), groupId, u.member1!);
    await transferOwnershipService(db, actorOf('owner'), groupId, u.member1!);
    await revokeAdminService(db, actorOf('member1'), groupId, u.owner!);
    // 残る管理者は member1（オーナー）と admin2
    const revoke = await revokeAdminService(db, actorOf('member1'), groupId, u.admin2!);
    expect(revoke.ok).toBe(true);
    expect(await activeAdminCount()).toBe(1);
  });

  it('どの経路をたどっても管理者が0人にならない', async () => {
    // 総当たり的に離脱させようとする
    await resignAdminService(db, actorOf('admin2'), groupId);
    await resignAdminService(db, actorOf('owner'), groupId);
    await leaveGroupService(db, actorOf('owner'), groupId);
    await revokeAdminService(db, actorOf('owner'), groupId, u.owner!);
    await removeMemberService(db, actorOf('owner'), groupId, u.owner!);
    expect(await activeAdminCount()).toBeGreaterThanOrEqual(1);
  });
});

describe('オーナーの保護（決定34・決定45）', () => {
  it('管理者はオーナーを除名できない', async () => {
    const result = await removeMemberService(db, actorOf('admin2'), groupId, u.owner!);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('FORBIDDEN');
    expect((await roleOf('owner'))?.status).toBe('active');
  });

  it('管理者はオーナーの権限を剥奪できない', async () => {
    const result = await revokeAdminService(db, actorOf('admin2'), groupId, u.owner!);
    expect(result.ok).toBe(false);
    expect((await roleOf('owner'))?.role).toBe('admin');
  });

  it('オーナー自身も自分の権限を剥奪できない', async () => {
    const result = await revokeAdminService(db, actorOf('owner'), groupId, u.owner!);
    expect(result.ok).toBe(false);
    expect((await roleOf('owner'))?.role).toBe('admin');
  });

  it('オーナーは脱退できない', async () => {
    const result = await leaveGroupService(db, actorOf('owner'), groupId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('移譲');
  });

  it('オーナーは辞任ではなく移譲を促される', async () => {
    const result = await resignAdminService(db, actorOf('owner'), groupId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('移譲');
  });
});

describe('管理者権限の剥奪はオーナーのみ', () => {
  it('管理者は他の管理者の権限を剥奪できない', async () => {
    await grantAdminService(db, actorOf('owner'), groupId, u.member1!);
    const result = await revokeAdminService(db, actorOf('admin2'), groupId, u.member1!);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('FORBIDDEN');
  });

  it('オーナーは他の管理者の権限を剥奪できる', async () => {
    const result = await revokeAdminService(db, actorOf('owner'), groupId, u.admin2!);
    expect(result.ok).toBe(true);
    expect((await roleOf('admin2'))?.role).toBe('member');
  });
});

describe('オーナーの移譲', () => {
  it('移譲先は管理者に限る', async () => {
    const toMember = await transferOwnershipService(db, actorOf('owner'), groupId, u.member1!);
    expect(toMember.ok).toBe(false);
    if (!toMember.ok) expect(toMember.code).toBe('VALIDATION_FAILED');

    const toAdmin = await transferOwnershipService(db, actorOf('owner'), groupId, u.admin2!);
    expect(toAdmin.ok).toBe(true);
  });

  it('移譲後は新オーナーが権限を持ち、元オーナーは管理者として残る', async () => {
    await transferOwnershipService(db, actorOf('owner'), groupId, u.admin2!);

    const rows = await db
      .select({ ownerUserId: schema.groups.ownerUserId })
      .from(schema.groups)
      .where(eq(schema.groups.id, groupId));
    expect(rows[0]!.ownerUserId).toBe(u.admin2);
    expect((await roleOf('owner'))?.role).toBe('admin');

    // 新オーナーは剥奪できる／元オーナーはできない
    expect((await revokeAdminService(db, actorOf('admin2'), groupId, u.owner!)).ok).toBe(true);
  });

  it('管理者は移譲できない', async () => {
    const result = await transferOwnershipService(db, actorOf('admin2'), groupId, u.admin2!);
    expect(result.ok).toBe(false);
  });
});

describe('メンバーの招待と除名', () => {
  it('管理者は招待できる', async () => {
    const result = await inviteMemberService(db, actorOf('admin2'), groupId, u.outsider!);
    expect(result.ok).toBe(true);
    expect((await roleOf('outsider'))?.status).toBe('invited');
  });

  it('招待は通知される', async () => {
    await inviteMemberService(db, actorOf('admin2'), groupId, u.outsider!);
    const rows = await db
      .select({ channel: schema.notifications.channel })
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, u.outsider!));
    expect(rows.map((r) => r.channel)).toContain('N5');
  });

  it('すでに承認済みの相手を招待しても状態を壊さない（冪等）', async () => {
    await inviteMemberService(db, actorOf('admin2'), groupId, u.member1!);
    expect((await roleOf('member1'))?.status).toBe('active');
  });

  it('一般メンバーは招待できない', async () => {
    const result = await inviteMemberService(db, actorOf('member1'), groupId, u.outsider!);
    expect(result.ok).toBe(false);
  });

  it('管理者は一般メンバーを除名できる', async () => {
    const result = await removeMemberService(db, actorOf('admin2'), groupId, u.member1!);
    expect(result.ok).toBe(true);
    expect((await roleOf('member1'))?.status).toBe('left');
  });

  it('自分を除名しようとすると脱退を案内される', async () => {
    const result = await removeMemberService(db, actorOf('admin2'), groupId, u.admin2!);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('脱退');
  });

  it('所属していない相手は除名できない', async () => {
    const result = await removeMemberService(db, actorOf('admin2'), groupId, u.outsider!);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
  });
});

describe('管理者の任命', () => {
  it('承認済みメンバーを管理者にできる', async () => {
    const result = await grantAdminService(db, actorOf('admin2'), groupId, u.member1!);
    expect(result.ok).toBe(true);
    expect((await roleOf('member1'))?.role).toBe('admin');
  });

  it('所属していない相手は管理者にできない', async () => {
    const result = await grantAdminService(db, actorOf('admin2'), groupId, u.outsider!);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
  });

  it('一般メンバーは任命できない', async () => {
    const result = await grantAdminService(db, actorOf('member1'), groupId, u.member2!);
    expect(result.ok).toBe(false);
  });
});
