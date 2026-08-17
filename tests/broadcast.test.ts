/**
 * 配下配信の対象決定
 *
 * 基本設計書 第9.3節の 5 規則と、決定31（経路の切断）・決定32（ミュートの基準）を検証する。
 * 本アプリの中核機能であり、静かに壊れると「連絡が届かない」という元の課題が再発する。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { isDescendantOf, listDescendants, resolveAudience } from '@/domain/broadcast';
import { createTestDb, type TestDb } from './helpers/db';

let ctx: TestDb;

/*
 * 検証に用いるツリー
 *
 *   A 東京連絡会
 *   ├── B すみだ協議会
 *   │   ├── D あさひ第3隊
 *   │   ├── E みどりが丘隊（あとでアーカイブする）
 *   │   └── P キャンプ実行委員会（あとで A から切断する）
 *   │        └── Q 班チーム（P の配下）
 *   └── C たまがわ会
 *   X 夏季合同キャンプ（親を持たない独立イベント）
 */
const g: Record<string, string> = {};
const u: Record<string, string> = {};

async function addUser(key: string, status = 'active'): Promise<void> {
  const result = await ctx.client.query<{ id: string }>(
    `insert into users (display_name, email, status) values ($1, $2, $3) returning id`,
    [key, `${key}@example.test`, status],
  );
  u[key] = result.rows[0]!.id;
}

async function addGroup(key: string, parentKey: string | null, status = 'active'): Promise<void> {
  const result = await ctx.client.query<{ id: string }>(
    `insert into groups (name, name_normalized, kind, owner_user_id, parent_group_id,
                         join_policy, status, join_qr_token)
     values ($1, $2, 'official', $3, $4, 'request', $5, $6) returning id`,
    [key, key.toLowerCase(), u.owner, parentKey === null ? null : g[parentKey], status, key],
  );
  g[key] = result.rows[0]!.id;
}

async function join(userKey: string, groupKey: string, status = 'active'): Promise<void> {
  await ctx.client.query(
    `insert into memberships (group_id, user_id, status, role, joined_at)
     values ($1, $2, $3, 'member', now())`,
    [g[groupKey], u[userKey], status],
  );
}

/** 対象者の ID 集合を、指定キーの集合と比較しやすい形に直す */
function userKeys(rows: Array<{ userId: string }>): string[] {
  const byId = new Map(Object.entries(u).map(([key, id]) => [id, key]));
  return rows.map((row) => byId.get(row.userId) ?? row.userId).sort();
}

beforeAll(async () => {
  ctx = await createTestDb();

  await addUser('owner');
  await addGroup('A', null);
  await addGroup('B', 'A');
  await addGroup('C', 'A');
  await addGroup('D', 'B');
  await addGroup('E', 'B');
  await addGroup('P', 'B');
  await addGroup('Q', 'P');
  await addGroup('X', null);

  // 各グループのメンバー
  await addUser('inA');
  await join('inA', 'A');
  await addUser('inB');
  await join('inB', 'B');
  await addUser('inC');
  await join('inC', 'C');
  await addUser('inD');
  await join('inD', 'D');
  await addUser('inE');
  await join('inE', 'E');
  await addUser('inP');
  await join('inP', 'P');
  await addUser('inQ');
  await join('inQ', 'Q');
  await addUser('inX');
  await join('inX', 'X');

  // B と D の両方に所属する（重複排除の検証用）
  await addUser('inBD');
  await join('inBD', 'B');
  await join('inBD', 'D');

  // 申請中のまま承認されていない
  await addUser('pendingD');
  await join('pendingD', 'D', 'requested');

  // 脱退済み
  await addUser('leftD');
  await join('leftD', 'D', 'left');

  // 停止中の利用者
  await addUser('suspendedD', 'suspended');
  await join('suspendedD', 'D');
});

describe('規則1 — 重複排除', () => {
  it('複数の対象グループに所属していても1件としてのみ届く', async () => {
    const rows = await resolveAudience(ctx.db, { originGroupId: g.A!, scope: 'descendants' });
    const ids = rows.map((row) => row.userId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(userKeys(rows)).toContain('inBD');
    expect(userKeys(rows).filter((key) => key === 'inBD')).toHaveLength(1);
  });
});

describe('配信範囲', () => {
  it('自グループのみ — そのグループの承認済みメンバーだけに届く', async () => {
    const rows = await resolveAudience(ctx.db, { originGroupId: g.B!, scope: 'self' });
    expect(userKeys(rows)).toEqual(['inB', 'inBD']);
  });

  it('配下すべて — 起点と全子孫のメンバーに届く', async () => {
    const rows = await resolveAudience(ctx.db, { originGroupId: g.B!, scope: 'descendants' });
    expect(userKeys(rows)).toEqual(['inB', 'inBD', 'inD', 'inE', 'inP', 'inQ']);
  });

  it('最上位からの配下配信は、独立イベントには届かない', async () => {
    const rows = await resolveAudience(ctx.db, { originGroupId: g.A!, scope: 'descendants' });
    expect(userKeys(rows)).not.toContain('inX');
  });

  it('孫より深い階層にも届く（A から Q まで）', async () => {
    const rows = await resolveAudience(ctx.db, { originGroupId: g.A!, scope: 'descendants' });
    expect(userKeys(rows)).toContain('inQ');
  });
});

describe('決定32 — 配信元グループは「投稿したグループ」である', () => {
  it('どの経路で届いても、配信元は投稿元グループになる', async () => {
    const rows = await resolveAudience(ctx.db, { originGroupId: g.A!, scope: 'descendants' });
    expect(rows.every((row) => row.sourceGroupId === g.A)).toBe(true);
  });

  it('自グループのみの配信でも配信元は投稿元グループになる', async () => {
    const rows = await resolveAudience(ctx.db, { originGroupId: g.B!, scope: 'self' });
    expect(rows.every((row) => row.sourceGroupId === g.B)).toBe(true);
  });

  it('団に所属する人が県連の配下配信を受けても、配信元は団ではない', async () => {
    // これが所属グループ基準だと、県連を静かにするために団をミュートすることになり
    // 団自身の連絡まで消えてしまう（基本設計書 第10.3節）
    const rows = await resolveAudience(ctx.db, { originGroupId: g.A!, scope: 'descendants' });
    const forInD = rows.find((row) => row.userId === u.inD);
    expect(forInD?.sourceGroupId).toBe(g.A);
    expect(forInD?.sourceGroupId).not.toBe(g.D);
  });
});

describe('所属状態による除外', () => {
  it('申請中のメンバーには届かない', async () => {
    const rows = await resolveAudience(ctx.db, { originGroupId: g.D!, scope: 'self' });
    expect(userKeys(rows)).not.toContain('pendingD');
  });

  it('脱退済みのメンバーには届かない', async () => {
    const rows = await resolveAudience(ctx.db, { originGroupId: g.D!, scope: 'self' });
    expect(userKeys(rows)).not.toContain('leftD');
  });

  it('停止中の利用者には届かない', async () => {
    const rows = await resolveAudience(ctx.db, { originGroupId: g.D!, scope: 'self' });
    expect(userKeys(rows)).not.toContain('suspendedD');
  });
});

describe('規則3 — アーカイブ・休眠の除外', () => {
  it('アーカイブされたグループは対象から外れる', async () => {
    await ctx.client.query(`update groups set status = 'archived' where id = $1`, [g.E]);
    const rows = await resolveAudience(ctx.db, { originGroupId: g.B!, scope: 'descendants' });
    expect(userKeys(rows)).not.toContain('inE');
    await ctx.client.query(`update groups set status = 'active' where id = $1`, [g.E]);
  });

  it('休眠グループは、その配下ごと対象から外れる', async () => {
    await ctx.client.query(`update groups set status = 'dormant' where id = $1`, [g.P]);
    const rows = await resolveAudience(ctx.db, { originGroupId: g.B!, scope: 'descendants' });
    expect(userKeys(rows)).not.toContain('inP');
    // P の配下である Q も、P が経路から外れるため届かない
    expect(userKeys(rows)).not.toContain('inQ');
    await ctx.client.query(`update groups set status = 'active' where id = $1`, [g.P]);
  });

  it('起点グループ自体がアーカイブなら誰にも届かない', async () => {
    await ctx.client.query(`update groups set status = 'archived' where id = $1`, [g.C]);
    const rows = await resolveAudience(ctx.db, { originGroupId: g.C!, scope: 'descendants' });
    expect(rows).toHaveLength(0);
    await ctx.client.query(`update groups set status = 'active' where id = $1`, [g.C]);
  });
});

describe('決定31 — 配下経路の切断', () => {
  it('切断したグループには、その配下ごと届かなくなる', async () => {
    await ctx.client.query(
      `insert into group_broadcast_exclusions (ancestor_group_id, excluded_group_id, excluded_by_user_id)
       values ($1, $2, $3)`,
      [g.A, g.P, u.owner],
    );

    const fromA = await resolveAudience(ctx.db, { originGroupId: g.A!, scope: 'descendants' });
    expect(userKeys(fromA)).not.toContain('inP');
    expect(userKeys(fromA)).not.toContain('inQ');
  });

  it('切断は上位グループごとに効き、直上の親からの配信には影響しない', async () => {
    // A は P を切断したが、P の直上の親である B からの配信には引き続き含まれる
    const fromB = await resolveAudience(ctx.db, { originGroupId: g.B!, scope: 'descendants' });
    expect(userKeys(fromB)).toContain('inP');
    expect(userKeys(fromB)).toContain('inQ');
  });

  it('切断を解除すると再び届くようになる', async () => {
    await ctx.client.query(
      `delete from group_broadcast_exclusions where ancestor_group_id = $1 and excluded_group_id = $2`,
      [g.A, g.P],
    );
    const fromA = await resolveAudience(ctx.db, { originGroupId: g.A!, scope: 'descendants' });
    expect(userKeys(fromA)).toContain('inP');
  });
});

describe('深さの上限', () => {
  it('上限を超える階層には届かない', async () => {
    // A(0) → B(1) → P(2) → Q(3)。上限 2 なら Q は範囲外
    const rows = await resolveAudience(ctx.db, {
      originGroupId: g.A!,
      scope: 'descendants',
      maxDepth: 2,
    });
    expect(userKeys(rows)).toContain('inP');
    expect(userKeys(rows)).not.toContain('inQ');
  });

  it('上限 0 なら起点グループのみになる', async () => {
    const rows = await resolveAudience(ctx.db, {
      originGroupId: g.A!,
      scope: 'descendants',
      maxDepth: 0,
    });
    expect(userKeys(rows)).toEqual(['inA']);
  });
});

describe('循環参照への耐性', () => {
  it('循環があっても探索が終了し、重複なく返る', async () => {
    // 制約を一時的に外して循環を作る（アプリからは作成できないが、防御を確かめる）
    await ctx.client.query(`update groups set parent_group_id = $1 where id = $2`, [g.Q, g.B]);

    const rows = await resolveAudience(ctx.db, { originGroupId: g.B!, scope: 'descendants' });
    const ids = rows.map((row) => row.userId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(userKeys(rows)).toContain('inB');

    await ctx.client.query(`update groups set parent_group_id = $1 where id = $2`, [g.A, g.B]);
  });
});

describe('isDescendantOf — 循環の事前検査', () => {
  it('直接の子は子孫である', async () => {
    expect(
      await isDescendantOf(ctx.db, { ancestorGroupId: g.A!, candidateGroupId: g.B! }),
    ).toBe(true);
  });

  it('孫も子孫である', async () => {
    expect(
      await isDescendantOf(ctx.db, { ancestorGroupId: g.A!, candidateGroupId: g.Q! }),
    ).toBe(true);
  });

  it('自分自身は子孫として扱う（自己参照を禁じるため）', async () => {
    expect(
      await isDescendantOf(ctx.db, { ancestorGroupId: g.A!, candidateGroupId: g.A! }),
    ).toBe(true);
  });

  it('祖先は子孫ではない', async () => {
    expect(
      await isDescendantOf(ctx.db, { ancestorGroupId: g.D!, candidateGroupId: g.A! }),
    ).toBe(false);
  });

  it('無関係なグループは子孫ではない', async () => {
    expect(
      await isDescendantOf(ctx.db, { ancestorGroupId: g.A!, candidateGroupId: g.X! }),
    ).toBe(false);
  });

  it('アーカイブされたグループも子孫として検出する', async () => {
    // 循環の検査では、状態にかかわらず構造を見る必要がある
    await ctx.client.query(`update groups set status = 'archived' where id = $1`, [g.E]);
    expect(
      await isDescendantOf(ctx.db, { ancestorGroupId: g.A!, candidateGroupId: g.E! }),
    ).toBe(true);
    await ctx.client.query(`update groups set status = 'active' where id = $1`, [g.E]);
  });
});

describe('listDescendants — 配下ツリーの閲覧（S-11）', () => {
  it('孫以降まで一覧に出る', async () => {
    const rows = await listDescendants(ctx.db, { originGroupId: g.A! });
    const ids = rows.map((row) => row.groupId);
    expect(ids).toContain(g.B);
    expect(ids).toContain(g.D);
    expect(ids).toContain(g.Q);
    expect(ids).not.toContain(g.A);
    expect(ids).not.toContain(g.X);
  });

  it('切断済みの経路も「切断中」として表示される', async () => {
    await ctx.client.query(
      `insert into group_broadcast_exclusions (ancestor_group_id, excluded_group_id, excluded_by_user_id)
       values ($1, $2, $3)`,
      [g.A, g.P, u.owner],
    );

    const rows = await listDescendants(ctx.db, { originGroupId: g.A! });
    const severed = rows.filter((row) => row.severed).map((row) => row.groupId);
    expect(severed).toEqual([g.P]);
    // 切断されていても一覧からは消えない（復帰させるため）
    expect(rows.map((row) => row.groupId)).toContain(g.P);

    await ctx.client.query(
      `delete from group_broadcast_exclusions where ancestor_group_id = $1 and excluded_group_id = $2`,
      [g.A, g.P],
    );
  });

  it('深さの昇順で並ぶ', async () => {
    const rows = await listDescendants(ctx.db, { originGroupId: g.A! });
    const depths = rows.map((row) => row.depth);
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
  });
});
