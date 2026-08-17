/**
 * 認可モジュール
 *
 * 基本設計書 第8.2節の権限マトリクスの「唯一の実装」（決定 T-05）。
 * すべてのサーバ側処理は、データを変更する前に必ず can() を通る（決定 T-40）。
 *
 * 設計上の規律：
 * - 副作用を持たない。引数と戻り値だけで完結する（総当たり検証を可能にするため）
 * - 未知の action は拒否する
 * - action は権限マトリクスの各行と 1 対 1 で対応する。行が増えたら型エラーで気づける
 *
 * ここで扱わないもの：
 * - グループの状態（アーカイブ・休眠）による制限 … 業務ルールとして API 層で判定する
 * - 「唯一の管理者は離脱できない」… 同時実行の制御が必要なため、行ロックを伴う
 *   トランザクション内で判定する（詳細設計 03_db_schema.md 第5.3節）
 */
import type { MembershipRole, MembershipStatus, UserStatus } from '@/db/schema';

/* ------------------------------------------------------------------ *
 * 型
 * ------------------------------------------------------------------ */

export type Actor = {
  userId: string;
  status: UserStatus;
  /** アプリ運営。認証・通報対応・規約違反への措置のみを担う */
  isSystemAdmin: boolean;
};

/** グループにおける操作者の役割 */
export type GroupRole = 'owner' | 'admin' | 'member' | null;

export type GroupContext = {
  id: string;
  /** オーナー（原則として作成者）。他の管理者から除名・権限剥奪されない */
  ownerUserId: string;
  /** 操作者の所属。非メンバーは null */
  membership: { role: MembershipRole; status: MembershipStatus } | null;
};

/** 権限マトリクス（基本設計書 第8.2節）の各行に 1 対 1 で対応する */
export const ACTIONS = [
  'group.create',
  'group.searchAndJoin',
  'group.leave',
  'membership.decideRequest',
  'membership.invite',
  'membership.remove',
  'admin.grant',
  'admin.revoke',
  'admin.resign',
  'owner.transfer',
  'parent.request',
  'parent.decide',
  'tree.view',
  'tree.sever',
  'certification.request',
  'certification.decide',
  'post.create',
  'post.modify',
  'post.read',
  'comment.create',
  'comment.modify',
  'reaction.set',
  'stamp.create',
  'stamp.claim',
  'stampGrant.revoke',
  'profileCard.update',
  'card.exchange',
  'connection.manage',
  'collection.view',
  'report.create',
  'report.handle',
  'content.removeForViolation',
  'group.restoreDormant',
  'user.suspend',
  'audit.lookup',
] as const;

export type Action = (typeof ACTIONS)[number];

/**
 * 操作と、その判定に必要な資源。
 * action ごとに必要な文脈が型で決まるため、渡し忘れが型エラーになる。
 */
export type Permission =
  // --- 資源を必要としない操作（全ユーザー可） ---
  | { action: 'group.create' }
  | { action: 'group.searchAndJoin' }
  | { action: 'stamp.claim' }
  | { action: 'profileCard.update' }
  | { action: 'card.exchange' }
  | { action: 'connection.manage' }
  | { action: 'collection.view' }
  | { action: 'report.create' }
  // --- グループを対象とする操作 ---
  | { action: 'group.leave'; group: GroupContext }
  | { action: 'membership.decideRequest'; group: GroupContext }
  | { action: 'membership.invite'; group: GroupContext }
  | { action: 'membership.remove'; group: GroupContext; targetUserId: string }
  | { action: 'admin.grant'; group: GroupContext }
  | { action: 'admin.revoke'; group: GroupContext }
  | { action: 'admin.resign'; group: GroupContext }
  | { action: 'owner.transfer'; group: GroupContext }
  | { action: 'parent.request'; group: GroupContext }
  /** 親子関係の承認。group は「親になる側」のグループ */
  | { action: 'parent.decide'; group: GroupContext }
  | { action: 'tree.view'; group: GroupContext }
  | { action: 'tree.sever'; group: GroupContext }
  | { action: 'certification.request'; group: GroupContext }
  | { action: 'post.create'; group: GroupContext }
  | { action: 'post.modify'; group: GroupContext; post: { authorUserId: string } }
  | { action: 'post.read'; group: GroupContext }
  | { action: 'comment.create'; group: GroupContext }
  | { action: 'comment.modify'; group: GroupContext; comment: { authorUserId: string } }
  | { action: 'reaction.set'; group: GroupContext }
  | { action: 'stamp.create'; group: GroupContext }
  | { action: 'stampGrant.revoke'; group: GroupContext }
  // --- システム管理者のみ ---
  | { action: 'certification.decide' }
  | { action: 'report.handle' }
  | { action: 'content.removeForViolation' }
  | { action: 'group.restoreDormant' }
  | { action: 'user.suspend' }
  | { action: 'audit.lookup' };

/* ------------------------------------------------------------------ *
 * 判定
 * ------------------------------------------------------------------ */

/** 操作者のグループにおける役割を求める */
export function roleIn(actor: Actor, group: GroupContext): GroupRole {
  if (group.ownerUserId === actor.userId) return 'owner';
  if (group.membership === null || group.membership.status !== 'active') return null;
  return group.membership.role === 'admin' ? 'admin' : 'member';
}

/** 管理者以上（オーナーを含む） */
function isAdminOrAbove(role: GroupRole): boolean {
  return role === 'owner' || role === 'admin';
}

/** メンバー以上（オーナー・管理者を含む） */
function isMemberOrAbove(role: GroupRole): boolean {
  return role !== null;
}

/**
 * 権限マトリクス（基本設計書 第8.2節）の判定。
 *
 * @returns 操作が許可されるなら true
 */
export function can(actor: Actor, permission: Permission): boolean {
  // 停止中・退会済みの利用者は、いかなる操作も行えない
  if (actor.status !== 'active') return false;

  switch (permission.action) {
    /* --- 全ユーザーが行える操作 --------------------------------- */
    // 無所属の登録ユーザーにも機能制限を設けない（決定3）
    case 'group.create':
    case 'group.searchAndJoin':
    case 'stamp.claim':
    case 'profileCard.update':
    case 'card.exchange':
    case 'connection.manage':
    case 'collection.view':
    case 'report.create':
      return true;

    /* --- システム管理者のみ ------------------------------------- */
    // 運営の権限は認証・通報対応・規約違反への措置・休眠の復旧に限られる。
    // グループの運営には介入しない（基本設計書 第8.1節）
    case 'certification.decide':
    case 'report.handle':
    case 'content.removeForViolation':
    case 'group.restoreDormant':
    case 'user.suspend':
    case 'audit.lookup':
      return actor.isSystemAdmin;

    /* --- グループを対象とする操作 ------------------------------- */
    case 'group.leave': {
      const role = roleIn(actor, permission.group);
      // オーナーは脱退できない。オーナーの移譲を先に行う必要がある。
      // 脱退を許すと owner_user_id が非メンバーを指し、誰にも直せない状態が残る。
      if (role === 'owner') return false;
      return isMemberOrAbove(role);
    }

    case 'membership.remove': {
      const role = roleIn(actor, permission.group);
      if (!isAdminOrAbove(role)) return false;
      // オーナーは除名できない。手伝いのために任命した管理者による乗っ取りを防ぐ
      if (permission.targetUserId === permission.group.ownerUserId) return false;
      // 自分自身の除名は脱退として扱う
      if (permission.targetUserId === actor.userId) return false;
      return true;
    }

    case 'admin.revoke':
    case 'owner.transfer':
      // オーナーのみが行える。オーナー自身の権限は剥奪されない
      return roleIn(actor, permission.group) === 'owner';

    case 'admin.resign':
      // オーナーは辞任ではなくオーナーの移譲を行う
      return roleIn(actor, permission.group) === 'admin';

    case 'tree.view':
      // システム管理者も閲覧できる。通報対応でグループの構造を確認する必要があるため。
      // 閲覧はグループ運営への介入にあたらない
      return actor.isSystemAdmin || isAdminOrAbove(roleIn(actor, permission.group));

    case 'membership.decideRequest':
    case 'membership.invite':
    case 'admin.grant':
    case 'parent.request':
    case 'parent.decide':
    case 'tree.sever':
    case 'certification.request':
    case 'post.create':
    case 'stamp.create':
    case 'stampGrant.revoke':
      return isAdminOrAbove(roleIn(actor, permission.group));

    case 'post.modify':
      // 投稿者本人のみ。管理者であっても他人の連絡は編集・削除できない
      return (
        isAdminOrAbove(roleIn(actor, permission.group)) &&
        permission.post.authorUserId === actor.userId
      );

    case 'comment.modify':
      // 投稿者本人のみ
      return (
        isMemberOrAbove(roleIn(actor, permission.group)) &&
        permission.comment.authorUserId === actor.userId
      );

    case 'post.read':
    case 'comment.create':
    case 'reaction.set':
      // 所属していないグループの連絡は配信対象にそもそも含まれない。
      // システム管理者にも特別な閲覧権はない（基本設計書 第8.2節）
      return isMemberOrAbove(roleIn(actor, permission.group));

    default: {
      // 網羅性の検査。Permission に行を足して分岐を書き忘れると型エラーになる
      const exhaustive: never = permission;
      void exhaustive;
      return false;
    }
  }
}

/**
 * 認可に失敗したことを表すエラー。
 * API 層でこれを捕捉し、FORBIDDEN として応答する（04_api_spec.md 第3.1節）。
 */
export class ForbiddenError extends Error {
  readonly action: Action;

  constructor(action: Action) {
    super(`この操作は許可されていません: ${action}`);
    this.name = 'ForbiddenError';
    this.action = action;
  }
}

/** 許可されていなければ例外を投げる。Server Action の入口で用いる */
export function assertCan(actor: Actor, permission: Permission): void {
  if (!can(actor, permission)) {
    throw new ForbiddenError(permission.action);
  }
}
