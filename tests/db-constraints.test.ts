/**
 * データベース制約の検証
 *
 * 「守れるものはすべてデータベースに守らせる」（03_db_schema.md 第1節）方針の実証。
 * アプリケーションを経由せず直接 SQL を実行しても、不正なデータが入らないことを確かめる。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, expectViolation, type TestDb } from './helpers/db';

let ctx: TestDb;

/** 連番でユーザーを作り、ID を返す */
async function makeUser(name = 'テスト'): Promise<string> {
  const result = await ctx.client.query<{ id: string }>(
    `insert into users (display_name, email, auth_user_id, status)
     values ($1, $2, gen_random_uuid(), 'active') returning id`,
    [name, `${crypto.randomUUID()}@example.test`],
  );
  return result.rows[0]!.id;
}

async function makeGroup(params: {
  ownerId: string;
  name: string;
  normalized: string;
  parentId?: string | null;
  status?: string;
}): Promise<string> {
  const result = await ctx.client.query<{ id: string }>(
    `insert into groups (name, name_normalized, kind, owner_user_id, parent_group_id,
                         join_policy, status, join_qr_token)
     values ($1, $2, 'official', $3, $4, 'request', $5, $6) returning id`,
    [
      params.name,
      params.normalized,
      params.ownerId,
      params.parentId ?? null,
      params.status ?? 'active',
      crypto.randomUUID(),
    ],
  );
  return result.rows[0]!.id;
}

beforeAll(async () => {
  ctx = await createTestDb();
});

describe('マイグレーションの適用', () => {
  it('21 個のテーブルが作られる', async () => {
    const result = await ctx.client.query<{ count: string }>(
      `select count(*)::text as count from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    expect(Number(result.rows[0]!.count)).toBe(21);
  });
});

describe('users — 退会時の匿名化（決定 T-22）', () => {
  it('退会状態で表示名が残っていると拒否される', async () => {
    const violation = await expectViolation(() =>
      ctx.client.query(
        `insert into users (display_name, status, withdrawn_at)
         values ('残っている名前', 'withdrawn', now())`,
      ),
    );
    expect(violation.message).toContain('ck_users_withdrawn_is_anonymized');
  });

  it('退会状態でメールアドレスが残っていると拒否される', async () => {
    const violation = await expectViolation(() =>
      ctx.client.query(
        `insert into users (email, status) values ('a@example.test', 'withdrawn')`,
      ),
    );
    expect(violation.message).toContain('ck_users_withdrawn_is_anonymized');
  });

  it('すべて NULL であれば退会状態を登録できる', async () => {
    await expect(
      ctx.client.query(`insert into users (status, withdrawn_at) values ('withdrawn', now())`),
    ).resolves.toBeDefined();
  });

  it('既存ユーザーを不完全に退会させる更新も拒否される', async () => {
    const userId = await makeUser('退会予定');
    const violation = await expectViolation(() =>
      ctx.client.query(`update users set status = 'withdrawn' where id = $1`, [userId]),
    );
    expect(violation.message).toContain('ck_users_withdrawn_is_anonymized');
  });

  it('個人特定情報を消したうえでなら退会できる', async () => {
    const userId = await makeUser('退会する人');
    await ctx.client.query(
      `update users
          set status = 'withdrawn', display_name = null, email = null,
              auth_user_id = null, withdrawn_at = now()
        where id = $1`,
      [userId],
    );
    const result = await ctx.client.query<{ status: string }>(
      `select status from users where id = $1`,
      [userId],
    );
    expect(result.rows[0]!.status).toBe('withdrawn');
  });

  it('未知の状態値を拒否する', async () => {
    const violation = await expectViolation(() =>
      ctx.client.query(`insert into users (status) values ('deleted')`),
    );
    expect(violation.message).toContain('ck_users_status');
  });
});

describe('groups — 名前の全国一意（決定21）', () => {
  it('正規形が衝突する登録を拒否する', async () => {
    const ownerId = await makeUser();
    await makeGroup({ ownerId, name: 'すみだローバー会', normalized: 'すみだろーばー会' });

    const violation = await expectViolation(() =>
      makeGroup({ ownerId, name: 'ＳＵＭＩＤＡ表記ゆれ', normalized: 'すみだろーばー会' }),
    );
    expect(violation.message).toContain('uq_groups_name_normalized');
  });

  it('表示名が同じでも正規形が異なれば登録できる', async () => {
    const ownerId = await makeUser();
    await makeGroup({ ownerId, name: '同名テスト', normalized: '同名テスト-a' });
    await expect(
      makeGroup({ ownerId, name: '同名テスト', normalized: '同名テスト-b' }),
    ).resolves.toBeTruthy();
  });

  it('自分自身を親に設定できない', async () => {
    const ownerId = await makeUser();
    const groupId = await makeGroup({ ownerId, name: '自己親テスト', normalized: '自己親てすと' });
    const violation = await expectViolation(() =>
      ctx.client.query(`update groups set parent_group_id = id where id = $1`, [groupId]),
    );
    expect(violation.message).toContain('ck_groups_not_self_parent');
  });
});

describe('connections — 順序の正規化（決定 T-21）', () => {
  it('user_a_id > user_b_id の登録を拒否する', async () => {
    const a = await makeUser('A');
    const b = await makeUser('B');
    const [small, large] = a < b ? [a, b] : [b, a];

    const violation = await expectViolation(() =>
      ctx.client.query(`insert into connections (user_a_id, user_b_id) values ($1, $2)`, [
        large,
        small,
      ]),
    );
    expect(violation.message).toContain('ck_connections_order');
  });

  it('正しい順序なら登録できる', async () => {
    const a = await makeUser('A');
    const b = await makeUser('B');
    const [small, large] = a < b ? [a, b] : [b, a];
    await expect(
      ctx.client.query(`insert into connections (user_a_id, user_b_id) values ($1, $2)`, [
        small,
        large,
      ]),
    ).resolves.toBeDefined();
  });

  it('同じ組み合わせの二重登録を拒否する', async () => {
    const a = await makeUser('A');
    const b = await makeUser('B');
    const [small, large] = a < b ? [a, b] : [b, a];
    await ctx.client.query(`insert into connections (user_a_id, user_b_id) values ($1, $2)`, [
      small,
      large,
    ]);
    const violation = await expectViolation(() =>
      ctx.client.query(`insert into connections (user_a_id, user_b_id) values ($1, $2)`, [
        small,
        large,
      ]),
    );
    expect(violation.message).toMatch(/connections_pkey|duplicate key/);
  });

  it('自分自身とのつながりを拒否する', async () => {
    const a = await makeUser('A');
    const violation = await expectViolation(() =>
      ctx.client.query(`insert into connections (user_a_id, user_b_id) values ($1, $1)`, [a]),
    );
    expect(violation.message).toContain('ck_connections_order');
  });
});

describe('blocks — 一方向であること', () => {
  it('自分自身をブロックできない', async () => {
    const a = await makeUser();
    const violation = await expectViolation(() =>
      ctx.client.query(`insert into blocks (blocker_id, blocked_id) values ($1, $1)`, [a]),
    );
    expect(violation.message).toContain('ck_blocks_not_self');
  });

  it('相互ブロックは別々の行として成立する', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await ctx.client.query(`insert into blocks (blocker_id, blocked_id) values ($1, $2)`, [a, b]);
    await expect(
      ctx.client.query(`insert into blocks (blocker_id, blocked_id) values ($1, $2)`, [b, a]),
    ).resolves.toBeDefined();
  });
});

describe('stamp_grants — 冪等性（決定 T-41）', () => {
  it('同じスタンプを二度獲得できない', async () => {
    const ownerId = await makeUser();
    const groupId = await makeGroup({ ownerId, name: 'スタンプ元', normalized: 'すたんぷもと' });
    const stamp = await ctx.client.query<{ id: string }>(
      `insert into stamps (group_id, name, activity_date, acquisition_method, qr_token,
                           valid_from, valid_until)
       values ($1, '夏キャンプ', '2027-08-14', 'venue_qr', $2, now(), now() + interval '1 day')
       returning id`,
      [groupId, crypto.randomUUID()],
    );
    const stampId = stamp.rows[0]!.id;
    const userId = await makeUser();

    await ctx.client.query(
      `insert into stamp_grants (stamp_id, user_id, method) values ($1, $2, 'venue_qr')`,
      [stampId, userId],
    );
    const violation = await expectViolation(() =>
      ctx.client.query(
        `insert into stamp_grants (stamp_id, user_id, method) values ($1, $2, 'venue_qr')`,
        [stampId, userId],
      ),
    );
    expect(violation.message).toMatch(/stamp_grants_pkey|duplicate key/);
  });
});

describe('stamps — 取得方式と QR の整合（決定39）', () => {
  let groupId: string;

  beforeAll(async () => {
    const ownerId = await makeUser();
    groupId = await makeGroup({ ownerId, name: '方式テスト', normalized: 'ほうしきてすと' });
  });

  it('会場QR方式なのに QR がないと拒否される', async () => {
    const violation = await expectViolation(() =>
      ctx.client.query(
        `insert into stamps (group_id, name, activity_date, acquisition_method,
                             valid_from, valid_until)
         values ($1, 'QRなし', '2027-08-14', 'venue_qr', now(), now() + interval '1 day')`,
        [groupId],
      ),
    );
    expect(violation.message).toContain('ck_stamps_qr_token_presence');
  });

  it('点呼方式なのに QR があると拒否される', async () => {
    const violation = await expectViolation(() =>
      ctx.client.query(
        `insert into stamps (group_id, name, activity_date, acquisition_method, qr_token,
                             valid_from, valid_until)
         values ($1, '点呼QRあり', '2027-08-14', 'roll_call', $2, now(), now() + interval '1 day')`,
        [groupId, crypto.randomUUID()],
      ),
    );
    expect(violation.message).toContain('ck_stamps_qr_token_presence');
  });

  it('有効期間の前後が逆だと拒否される', async () => {
    const violation = await expectViolation(() =>
      ctx.client.query(
        `insert into stamps (group_id, name, activity_date, acquisition_method,
                             valid_from, valid_until)
         values ($1, '期間逆転', '2027-08-14', 'roll_call', now(), now() - interval '1 day')`,
        [groupId],
      ),
    );
    expect(violation.message).toContain('ck_stamps_valid_period');
  });
});

describe('notification_settings — N8 は OFF にできない', () => {
  it('N8 を無効にする登録を拒否する', async () => {
    const userId = await makeUser();
    const violation = await expectViolation(() =>
      ctx.client.query(
        `insert into notification_settings (user_id, channel, enabled) values ($1, 'N8', false)`,
        [userId],
      ),
    );
    expect(violation.message).toContain('ck_ns_n8_always_on');
  });

  it('N8 以外は無効にできる', async () => {
    const userId = await makeUser();
    await expect(
      ctx.client.query(
        `insert into notification_settings (user_id, channel, enabled) values ($1, 'N7', false)`,
        [userId],
      ),
    ).resolves.toBeDefined();
  });
});

describe('group_parent_requests — 同時に複数の親へ申請できない', () => {
  it('申請中が2件になる登録を拒否する', async () => {
    const ownerId = await makeUser();
    const child = await makeGroup({ ownerId, name: '子グループ', normalized: 'こぐるーぷ' });
    const parentA = await makeGroup({ ownerId, name: '親A', normalized: 'おやa' });
    const parentB = await makeGroup({ ownerId, name: '親B', normalized: 'おやb' });

    await ctx.client.query(
      `insert into group_parent_requests (child_group_id, parent_group_id, requested_by_user_id)
       values ($1, $2, $3)`,
      [child, parentA, ownerId],
    );
    const violation = await expectViolation(() =>
      ctx.client.query(
        `insert into group_parent_requests (child_group_id, parent_group_id, requested_by_user_id)
         values ($1, $2, $3)`,
        [child, parentB, ownerId],
      ),
    );
    expect(violation.message).toContain('uq_gpr_pending_child');
  });

  it('先の申請が決着していれば次の申請ができる', async () => {
    const ownerId = await makeUser();
    const child = await makeGroup({ ownerId, name: '子2', normalized: 'こ2' });
    const parentA = await makeGroup({ ownerId, name: '親C', normalized: 'おやc' });
    const parentB = await makeGroup({ ownerId, name: '親D', normalized: 'おやd' });

    await ctx.client.query(
      `insert into group_parent_requests (child_group_id, parent_group_id, requested_by_user_id,
                                          status, decided_at)
       values ($1, $2, $3, 'rejected', now())`,
      [child, parentA, ownerId],
    );
    await expect(
      ctx.client.query(
        `insert into group_parent_requests (child_group_id, parent_group_id, requested_by_user_id)
         values ($1, $2, $3)`,
        [child, parentB, ownerId],
      ),
    ).resolves.toBeDefined();
  });
});
