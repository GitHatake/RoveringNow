/**
 * 読み取りクエリの検証
 *
 * ここは、相関サブクエリの中で Drizzle の列オブジェクトを補間したために
 * 人数が常に 0、親グループ名が常に null になる不具合を起こした箇所である。
 * JOIN の有無で SQL の出力が変わるため、型検査でも lint でも検出できない。
 * 実データに対して値を突き合わせることでしか守れないため、ここで固定する。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getGroupDetail, listAdminGroups, searchGroups } from '@/server/queries';
import { createTestDb, type TestDb } from './helpers/db';
import type { Db } from '@/db';

let ctx: TestDb;
let db: Db;
const g: Record<string, string> = {};
const u: Record<string, string> = {};

async function addUser(key: string): Promise<void> {
  const r = await ctx.client.query<{ id: string }>(
    `insert into users (display_name, email) values ($1, $2) returning id`,
    [key, `${key}@example.test`],
  );
  u[key] = r.rows[0]!.id;
}

async function addGroup(
  key: string,
  parentKey: string | null,
  certified = false,
  policy = 'request',
): Promise<void> {
  const r = await ctx.client.query<{ id: string }>(
    `insert into groups (name, name_normalized, kind, owner_user_id, parent_group_id,
                         join_policy, is_certified, join_qr_token, description)
     values ($1, $2, 'official', $3, $4, $5, $6, $7, $8) returning id`,
    [key, key.toLowerCase(), u.owner, parentKey === null ? null : g[parentKey], policy, certified, key, `${key} の説明`],
  );
  g[key] = r.rows[0]!.id;
}

async function join(userKey: string, groupKey: string, role: string, status: string): Promise<void> {
  await ctx.client.query(
    `insert into memberships (group_id, user_id, role, status, joined_at)
     values ($1, $2, $3, $4, now())`,
    [g[groupKey], u[userKey], role, status],
  );
}

beforeAll(async () => {
  ctx = await createTestDb();
  db = ctx.db as unknown as Db;

  await addUser('owner');
  await addGroup('親グループ', null, true);
  await addGroup('子グループ', '親グループ', true);
  await addGroup('孫グループ', '子グループ');
  await addGroup('独立グループ', null, false, 'open');

  for (const key of ['a', 'b', 'c', 'pending']) await addUser(key);

  // 親グループ：承認済み2人＋申請中1人
  await join('a', '親グループ', 'admin', 'active');
  await join('b', '親グループ', 'member', 'active');
  await join('pending', '親グループ', 'member', 'requested');
  // 子グループ：1人
  await join('c', '子グループ', 'admin', 'active');
  // 独立グループ：0人
});

describe('searchGroups', () => {
  it('メンバー数は承認済みのみを数える', async () => {
    const rows = await searchGroups('親グループ', db);
    expect(rows).toHaveLength(1);
    // 申請中の1人は数えない
    expect(rows[0]!.memberCount).toBe(2);
  });

  it('メンバーが0人のグループは 0 を返す', async () => {
    const rows = await searchGroups('独立グループ', db);
    expect(rows[0]!.memberCount).toBe(0);
  });

  it('親グループ名を返す', async () => {
    const rows = await searchGroups('子グループ', db);
    expect(rows[0]!.parentName).toBe('親グループ');
  });

  it('親を持たないグループの親グループ名は null', async () => {
    const rows = await searchGroups('独立グループ', db);
    expect(rows[0]!.parentName).toBeNull();
  });

  it('認証バッジ付きを上位に並べる', async () => {
    const rows = await searchGroups('グループ', db);
    const certified = rows.map((row) => row.isCertified);
    // true が先、false が後
    expect(certified).toEqual([...certified].sort((a, b) => Number(b) - Number(a)));
  });

  it('説明文でも検索できる', async () => {
    const rows = await searchGroups('孫グループ の説明', db);
    expect(rows.map((row) => row.name)).toContain('孫グループ');
  });

  it('検索語が空なら全件返す', async () => {
    const rows = await searchGroups('', db);
    expect(rows.length).toBe(4);
  });
});

describe('getGroupDetail', () => {
  it('メンバー数と親グループ名を返す', async () => {
    const detail = await getGroupDetail(g['子グループ']!, u.a!, db);
    expect(detail).not.toBeNull();
    expect(detail!.memberCount).toBe(1);
    expect(detail!.parentName).toBe('親グループ');
  });

  it('承認済みでない所属は数に含めない', async () => {
    const detail = await getGroupDetail(g['親グループ']!, u.a!, db);
    expect(detail!.memberCount).toBe(2);
  });

  it('自分の所属状態と役割を返す', async () => {
    const detail = await getGroupDetail(g['親グループ']!, u.a!, db);
    expect(detail!.myStatus).toBe('active');
    expect(detail!.myRole).toBe('admin');
  });

  it('申請中の利用者には requested を返す', async () => {
    const detail = await getGroupDetail(g['親グループ']!, u.pending!, db);
    expect(detail!.myStatus).toBe('requested');
  });

  it('非メンバーには none を返す', async () => {
    const detail = await getGroupDetail(g['親グループ']!, u.c!, db);
    expect(detail!.myStatus).toBe('none');
  });

  it('管理者には参加申請の一覧を返す', async () => {
    const detail = await getGroupDetail(g['親グループ']!, u.a!, db);
    expect(detail!.pendingRequests.map((r) => r.userId)).toEqual([u.pending]);
  });

  it('一般メンバーには参加申請を見せない', async () => {
    const detail = await getGroupDetail(g['親グループ']!, u.b!, db);
    expect(detail!.pendingRequests).toEqual([]);
  });

  it('管理者には配下ツリーを孫まで返す', async () => {
    const detail = await getGroupDetail(g['親グループ']!, u.a!, db);
    const names = detail!.descendants.map((d) => d.name);
    expect(names).toContain('子グループ');
    expect(names).toContain('孫グループ');
    expect(names).not.toContain('親グループ');
  });

  it('存在しないグループには null を返す', async () => {
    const detail = await getGroupDetail('00000000-0000-4000-8000-000000000000', u.a!, db);
    expect(detail).toBeNull();
  });
});

describe('listAdminGroups', () => {
  it('管理者であるグループだけを返す', async () => {
    const rows = await listAdminGroups(u.a!, db);
    expect(rows.map((row) => row.name)).toEqual(['親グループ']);
  });

  it('一般メンバーには何も返さない', async () => {
    expect(await listAdminGroups(u.b!, db)).toEqual([]);
  });

  it('配下を持つかどうかを正しく返す', async () => {
    const parent = (await listAdminGroups(u.a!, db))[0]!;
    expect(parent.hasChildren).toBe(true);

    const child = (await listAdminGroups(u.c!, db))[0]!;
    expect(child.name).toBe('子グループ');
    // 孫グループを持つので true
    expect(child.hasChildren).toBe(true);
  });
});
