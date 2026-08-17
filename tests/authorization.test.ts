/**
 * 認可モジュールの総当たり検証
 *
 * 基本設計書 第8.2節の権限マトリクス 35 行 × 5 ロール = 175 通りをすべて検証する。
 * 認可を各所に散らさず 1 か所に集約した目的は、この総当たりを可能にすることにある
 * （決定 T-05）。
 */
import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  can,
  type Action,
  type Actor,
  type GroupContext,
  type Permission,
} from '@/domain/authorization';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';
const OUTSIDER_ID = '44444444-4444-4444-8444-444444444444';
const SYSADMIN_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_MEMBER_ID = '66666666-6666-4666-8666-666666666666';

/**
 * マトリクスの列に対応する操作者。
 * 「システム管理者」の列は、当該グループに所属していないアプリ運営者を表す。
 */
const COLUMNS = ['system', 'owner', 'admin', 'member', 'registered'] as const;
type Column = (typeof COLUMNS)[number];

function actorFor(column: Column): Actor {
  const base = { status: 'active' } as const;
  switch (column) {
    case 'system':
      return { ...base, userId: SYSADMIN_ID, isSystemAdmin: true };
    case 'owner':
      return { ...base, userId: OWNER_ID, isSystemAdmin: false };
    case 'admin':
      return { ...base, userId: ADMIN_ID, isSystemAdmin: false };
    case 'member':
      return { ...base, userId: MEMBER_ID, isSystemAdmin: false };
    case 'registered':
      return { ...base, userId: OUTSIDER_ID, isSystemAdmin: false };
  }
}

function groupFor(column: Column): GroupContext {
  const group = { id: 'g-1', ownerUserId: OWNER_ID };
  switch (column) {
    case 'owner':
      return { ...group, membership: { role: 'admin', status: 'active' } };
    case 'admin':
      return { ...group, membership: { role: 'admin', status: 'active' } };
    case 'member':
      return { ...group, membership: { role: 'member', status: 'active' } };
    // 非メンバー
    case 'system':
    case 'registered':
      return { ...group, membership: null };
  }
}

/**
 * 操作ごとの Permission を組み立てる。
 * 「自分が投稿したもの」条件のある操作は、操作者本人を投稿者として渡す
 * （マトリクスの ※4 が満たされる状態での判定を見るため）。
 */
function permissionFor(action: Action, column: Column): Permission {
  const group = groupFor(column);
  const actor = actorFor(column);

  switch (action) {
    case 'group.create':
    case 'group.searchAndJoin':
    case 'stamp.claim':
    case 'profileCard.update':
    case 'card.exchange':
    case 'connection.manage':
    case 'collection.view':
    case 'report.create':
    case 'certification.decide':
    case 'report.handle':
    case 'content.removeForViolation':
    case 'group.restoreDormant':
    case 'user.suspend':
    case 'audit.lookup':
      return { action };

    case 'membership.remove':
      // 対象は一般メンバー（オーナーでも自分自身でもない）
      return { action, group, targetUserId: OTHER_MEMBER_ID };

    case 'post.modify':
      return { action, group, post: { authorUserId: actor.userId } };

    case 'comment.modify':
      return { action, group, comment: { authorUserId: actor.userId } };

    default:
      return { action, group } as Permission;
  }
}

/**
 * 基本設計書 第8.2節の権限マトリクス。
 *
 * 記号の読み替え：
 *   ✅ → true（無条件）
 *   ⭕️ → 所属グループに限り可。非メンバーの列（system / registered）では false
 *   ❌ / — → false
 */
const MATRIX: Record<Action, Record<Column, boolean>> = {
  //                             system  owner  admin  member registered
  'group.create': { system: true, owner: true, admin: true, member: true, registered: true },
  'group.searchAndJoin': { system: true, owner: true, admin: true, member: true, registered: true },
  // 【設計修正 1】オーナーは脱退できない（オーナーの移譲が先）。
  // 【設計修正 2】システム管理者も、所属していないグループからは脱退できない。
  'group.leave': { system: false, owner: false, admin: true, member: true, registered: false },
  'membership.decideRequest': {
    system: false,
    owner: true,
    admin: true,
    member: false,
    registered: false,
  },
  'membership.invite': {
    system: false,
    owner: true,
    admin: true,
    member: false,
    registered: false,
  },
  'membership.remove': {
    system: false,
    owner: true,
    admin: true,
    member: false,
    registered: false,
  },
  'admin.grant': { system: false, owner: true, admin: true, member: false, registered: false },
  'admin.revoke': { system: false, owner: true, admin: false, member: false, registered: false },
  'admin.resign': { system: false, owner: false, admin: true, member: false, registered: false },
  'owner.transfer': { system: false, owner: true, admin: false, member: false, registered: false },
  'parent.request': { system: false, owner: true, admin: true, member: false, registered: false },
  'parent.decide': { system: false, owner: true, admin: true, member: false, registered: false },
  // 通報対応で構造を確認する必要があるため、システム管理者も閲覧できる
  'tree.view': { system: true, owner: true, admin: true, member: false, registered: false },
  'tree.sever': { system: false, owner: true, admin: true, member: false, registered: false },
  'certification.request': {
    system: false,
    owner: true,
    admin: true,
    member: false,
    registered: false,
  },
  'certification.decide': {
    system: true,
    owner: false,
    admin: false,
    member: false,
    registered: false,
  },
  'post.create': { system: false, owner: true, admin: true, member: false, registered: false },
  'post.modify': { system: false, owner: true, admin: true, member: false, registered: false },
  'post.read': { system: false, owner: true, admin: true, member: true, registered: false },
  'comment.create': { system: false, owner: true, admin: true, member: true, registered: false },
  'comment.modify': { system: false, owner: true, admin: true, member: true, registered: false },
  'reaction.set': { system: false, owner: true, admin: true, member: true, registered: false },
  'stamp.create': { system: false, owner: true, admin: true, member: false, registered: false },
  'stamp.claim': { system: true, owner: true, admin: true, member: true, registered: true },
  'stampGrant.revoke': {
    system: false,
    owner: true,
    admin: true,
    member: false,
    registered: false,
  },
  'profileCard.update': { system: true, owner: true, admin: true, member: true, registered: true },
  'card.exchange': { system: true, owner: true, admin: true, member: true, registered: true },
  'connection.manage': { system: true, owner: true, admin: true, member: true, registered: true },
  'collection.view': { system: true, owner: true, admin: true, member: true, registered: true },
  'report.create': { system: true, owner: true, admin: true, member: true, registered: true },
  'report.handle': { system: true, owner: false, admin: false, member: false, registered: false },
  'content.removeForViolation': {
    system: true,
    owner: false,
    admin: false,
    member: false,
    registered: false,
  },
  'group.restoreDormant': {
    system: true,
    owner: false,
    admin: false,
    member: false,
    registered: false,
  },
  'user.suspend': { system: true, owner: false, admin: false, member: false, registered: false },
  'audit.lookup': { system: true, owner: false, admin: false, member: false, registered: false },
};

describe('権限マトリクス（基本設計書 第8.2節）', () => {
  it('マトリクスが 35 行あり、ACTIONS と過不足なく一致する', () => {
    expect(ACTIONS).toHaveLength(35);
    expect(Object.keys(MATRIX).sort()).toEqual([...ACTIONS].sort());
  });

  it('総当たりの件数が 175 通りである', () => {
    expect(ACTIONS.length * COLUMNS.length).toBe(175);
  });

  for (const action of ACTIONS) {
    for (const column of COLUMNS) {
      const expected = MATRIX[action][column];
      it(`${action} / ${column} → ${expected ? '可' : '不可'}`, () => {
        expect(can(actorFor(column), permissionFor(action, column))).toBe(expected);
      });
    }
  }
});

describe('マトリクスに現れない条件', () => {
  const owner = actorFor('owner');
  const admin = actorFor('admin');
  const group = groupFor('admin');

  it('停止中の利用者は、誰でも可の操作すら行えない', () => {
    const suspended: Actor = { ...admin, status: 'suspended' };
    expect(can(suspended, { action: 'group.create' })).toBe(false);
    expect(can(suspended, { action: 'report.create' })).toBe(false);
  });

  it('退会済みの利用者は、いかなる操作も行えない', () => {
    const withdrawn: Actor = { ...admin, status: 'withdrawn' };
    for (const action of ACTIONS) {
      expect(can(withdrawn, permissionFor(action, 'admin'))).toBe(false);
    }
  });

  it('管理者は他人の連絡を編集できない（※4）', () => {
    expect(
      can(admin, { action: 'post.modify', group, post: { authorUserId: OWNER_ID } }),
    ).toBe(false);
  });

  it('メンバーは他人のコメントを編集できない（※4）', () => {
    const memberGroup = groupFor('member');
    expect(
      can(actorFor('member'), {
        action: 'comment.modify',
        group: memberGroup,
        comment: { authorUserId: OTHER_MEMBER_ID },
      }),
    ).toBe(false);
  });

  it('管理者はオーナーを除名できない（※2）', () => {
    expect(can(admin, { action: 'membership.remove', group, targetUserId: OWNER_ID })).toBe(false);
  });

  it('オーナー自身も、除名という手段では自分を外せない', () => {
    const ownerGroup = groupFor('owner');
    expect(
      can(owner, { action: 'membership.remove', group: ownerGroup, targetUserId: OWNER_ID }),
    ).toBe(false);
  });

  it('所属が承認済みでないメンバーは、メンバーとして扱われない', () => {
    const pending: GroupContext = {
      id: 'g-1',
      ownerUserId: OWNER_ID,
      membership: { role: 'member', status: 'requested' },
    };
    expect(can(actorFor('member'), { action: 'post.read', group: pending })).toBe(false);
  });

  it('脱退済みの元メンバーは、メンバーとして扱われない', () => {
    const left: GroupContext = {
      id: 'g-1',
      ownerUserId: OWNER_ID,
      membership: { role: 'admin', status: 'left' },
    };
    expect(can(actorFor('admin'), { action: 'post.create', group: left })).toBe(false);
  });

  it('システム管理者であっても、所属しないグループの連絡は閲覧できない', () => {
    expect(can(actorFor('system'), { action: 'post.read', group: groupFor('system') })).toBe(false);
  });

  it('システム管理者が当該グループのメンバーであれば、連絡を閲覧できる', () => {
    const sysAsMember: GroupContext = {
      id: 'g-1',
      ownerUserId: OWNER_ID,
      membership: { role: 'member', status: 'active' },
    };
    expect(can(actorFor('system'), { action: 'post.read', group: sysAsMember })).toBe(true);
  });
});
