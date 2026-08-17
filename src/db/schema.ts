/**
 * データベーススキーマ定義
 *
 * 詳細設計書 03_db_schema.md の実装。
 *
 * 方針（同書 第1節）：
 * - 守れるものはすべてデータベースに守らせる。一意性・参照整合性・状態の妥当性を
 *   制約として表現し、アプリケーションにバグがあってもデータが壊れないようにする
 * - 状態値は PostgreSQL の ENUM 型ではなく text + CHECK 制約とする（決定 T-14）
 * - 物理削除しない。状態列で表す（決定 T-16。profile_cards のみ例外）
 */
import { sql, type SQL } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

/* ------------------------------------------------------------------ *
 * 共通ヘルパー
 * ------------------------------------------------------------------ */

/**
 * CHECK 制約用に「列が指定の値のいずれかであること」を表す SQL を組み立てる。
 *
 * CHECK 制約の DDL にはバインドパラメータを置けないため値を文字列として埋め込む。
 * 埋め込む値はすべてこのファイル内の定数だが、将来の変更で不正な値が混ざらないよう
 * 実行時にも形式を検査する。
 */
function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  for (const value of values) {
    if (!/^[A-Za-z0-9_]+$/.test(value)) {
      throw new Error(`CHECK 制約に使用できない値です: ${value}`);
    }
  }
  const list = values.map((value) => `'${value}'`).join(', ');
  return sql`${column} in (${sql.raw(list)})`;
}

/** すべてのテーブルが持つ日時列（詳細設計 第1.3節） */
const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    // データベーストリガではなく ORM 側で更新する。スキーマ変更を drizzle-kit に
    // 一元管理させる方針（決定 T-24）と、手書き DDL の併存を避けるため。
    .$onUpdate(() => new Date()),
};

/* ------------------------------------------------------------------ *
 * 状態値の定義
 * ------------------------------------------------------------------ */

export const USER_STATUS = ['active', 'suspended', 'withdrawn'] as const;
export type UserStatus = (typeof USER_STATUS)[number];

export const GROUP_KIND = ['official', 'project', 'event', 'other'] as const;
export type GroupKind = (typeof GROUP_KIND)[number];

export const JOIN_POLICY = ['invite', 'request', 'open'] as const;
export type JoinPolicy = (typeof JOIN_POLICY)[number];

export const GROUP_STATUS = ['active', 'archived', 'dormant'] as const;
export type GroupStatus = (typeof GROUP_STATUS)[number];

export const REQUEST_STATUS = ['pending', 'approved', 'rejected', 'withdrawn'] as const;
export type RequestStatus = (typeof REQUEST_STATUS)[number];

export const CERTIFICATION_STATUS = ['pending', 'approved', 'rejected'] as const;
export type CertificationStatus = (typeof CERTIFICATION_STATUS)[number];

export const MEMBERSHIP_STATUS = ['invited', 'requested', 'active', 'rejected', 'left'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUS)[number];

export const MEMBERSHIP_ROLE = ['admin', 'member'] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLE)[number];

export const POST_SCOPE = ['self', 'descendants'] as const;
export type PostScope = (typeof POST_SCOPE)[number];

export const CONTENT_STATUS = ['published', 'deleted'] as const;
export type ContentStatus = (typeof CONTENT_STATUS)[number];

/** 了解 / 参加したい（決定36） */
export const REACTION_KIND = ['ack', 'joining'] as const;
export type ReactionKind = (typeof REACTION_KIND)[number];

/** 会場QR / 点呼（決定39） */
export const ACQUISITION_METHOD = ['venue_qr', 'roll_call'] as const;
export type AcquisitionMethod = (typeof ACQUISITION_METHOD)[number];

export const GRANT_METHOD = ['venue_qr', 'roll_call', 'manual'] as const;
export type GrantMethod = (typeof GRANT_METHOD)[number];

export const GRANT_STATUS = ['valid', 'revoked'] as const;
export type GrantStatus = (typeof GRANT_STATUS)[number];

export const CONNECTION_STATUS = ['active', 'released'] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUS)[number];

/** 通知チャンネル（基本設計書 第10.2節） */
export const NOTIFICATION_CHANNEL = ['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNEL)[number];

/** OFF にできない唯一のチャンネル（運営からのお知らせ） */
export const ALWAYS_ON_CHANNEL: NotificationChannel = 'N8';

export const REPORT_TARGET_TYPE = ['post', 'comment', 'card', 'stamp', 'group'] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPE)[number];

export const REPORT_STATUS = ['pending', 'in_progress', 'resolved', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUS)[number];

/* ------------------------------------------------------------------ *
 * 1. users
 * ------------------------------------------------------------------ */

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 認証基盤側の ID。退会時に NULL にする（決定 T-06） */
    authUserId: uuid('auth_user_id').unique(),
    displayName: text('display_name'),
    email: text('email'),
    status: text('status').$type<UserStatus>().notNull().default('active'),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check('ck_users_status', oneOf(t.status, USER_STATUS)),
    // 退会状態なら個人を特定する情報がすべて NULL であることを強制する（決定 T-22）。
    // アプリケーション側の削除漏れが本番データに残らないようにするための制約。
    check(
      'ck_users_withdrawn_is_anonymized',
      sql`${t.status} <> 'withdrawn' or (${t.displayName} is null and ${t.email} is null and ${t.authUserId} is null)`,
    ),
  ],
);

/* ------------------------------------------------------------------ *
 * 2. profile_cards
 * ------------------------------------------------------------------ */

export const profileCards = pgTable('profile_cards', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  displayName: text('display_name').notNull(),
  avatarPath: text('avatar_path'),
  bio: text('bio'),
  externalLinks: jsonb('external_links').notNull().default(sql`'[]'::jsonb`),
  /** 認証済みグループへの所属を表示するか（決定38） */
  showsAffiliation: boolean('shows_affiliation').notNull().default(true),
  design: jsonb('design').notNull().default(sql`'{}'::jsonb`),
  /** カードQRの識別子。盗撮対策として本人が再発行できる（決定30） */
  qrToken: text('qr_token').notNull().unique(),
  qrTokenRotatedAt: timestamp('qr_token_rotated_at', { withTimezone: true }).notNull().defaultNow(),
  ...timestamps,
});

/* ------------------------------------------------------------------ *
 * 3. groups
 * ------------------------------------------------------------------ */

export const groups = pgTable(
  'groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 表示用。利用者が入力したまま保持する */
    name: text('name').notNull(),
    /** 一意性の判定用に正規化した名前（決定 T-10） */
    nameNormalized: text('name_normalized').notNull(),
    kind: text('kind').$type<GroupKind>().notNull(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    /** 承認済みの親のみが入る（決定 T-17） */
    parentGroupId: uuid('parent_group_id').references((): AnyPgColumn => groups.id),
    joinPolicy: text('join_policy').$type<JoinPolicy>().notNull(),
    isCertified: boolean('is_certified').notNull().default(false),
    description: text('description'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    status: text('status').$type<GroupStatus>().notNull().default('active'),
    /** 参加QRの識別子（基本設計書 F-03） */
    joinQrToken: text('join_qr_token').notNull().unique(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    dormantAt: timestamp('dormant_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // グループ名の全国一意をデータベースで担保する（決定21・決定 T-10）
    uniqueIndex('uq_groups_name_normalized').on(t.nameNormalized),
    index('idx_groups_parent').on(t.parentGroupId),
    index('idx_groups_status').on(t.status),
    check('ck_groups_kind', oneOf(t.kind, GROUP_KIND)),
    check('ck_groups_join_policy', oneOf(t.joinPolicy, JOIN_POLICY)),
    check('ck_groups_status', oneOf(t.status, GROUP_STATUS)),
    check('ck_groups_not_self_parent', sql`${t.parentGroupId} is distinct from ${t.id}`),
  ],
);

/* ------------------------------------------------------------------ *
 * 4. group_parent_requests
 * ------------------------------------------------------------------ */

export const groupParentRequests = pgTable(
  'group_parent_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    childGroupId: uuid('child_group_id')
      .notNull()
      .references(() => groups.id),
    parentGroupId: uuid('parent_group_id')
      .notNull()
      .references(() => groups.id),
    requestedByUserId: uuid('requested_by_user_id')
      .notNull()
      .references(() => users.id),
    status: text('status').$type<RequestStatus>().notNull().default('pending'),
    decidedByUserId: uuid('decided_by_user_id').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // 1つのグループが同時に複数の親へ申請することを防ぐ
    uniqueIndex('uq_gpr_pending_child')
      .on(t.childGroupId)
      .where(sql`${t.status} = 'pending'`),
    index('idx_gpr_parent').on(t.parentGroupId),
    check('ck_gpr_status', oneOf(t.status, REQUEST_STATUS)),
    check('ck_gpr_not_self', sql`${t.childGroupId} <> ${t.parentGroupId}`),
  ],
);

/* ------------------------------------------------------------------ *
 * 5. group_broadcast_exclusions
 *
 * 上位グループが自ツリー内の子孫との配信経路を切断した記録（決定31）。
 * 切断は「その上位グループの配下配信から外す」という意味であり、
 * 親子関係そのものを断つわけではない。
 * ------------------------------------------------------------------ */

export const groupBroadcastExclusions = pgTable(
  'group_broadcast_exclusions',
  {
    ancestorGroupId: uuid('ancestor_group_id')
      .notNull()
      .references(() => groups.id),
    excludedGroupId: uuid('excluded_group_id')
      .notNull()
      .references(() => groups.id),
    excludedByUserId: uuid('excluded_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.ancestorGroupId, t.excludedGroupId] }),
    check('ck_gbe_not_self', sql`${t.ancestorGroupId} <> ${t.excludedGroupId}`),
  ],
);

/* ------------------------------------------------------------------ *
 * 6. group_certification_requests
 * ------------------------------------------------------------------ */

export const groupCertificationRequests = pgTable(
  'group_certification_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    requestedByUserId: uuid('requested_by_user_id')
      .notNull()
      .references(() => users.id),
    status: text('status').$type<CertificationStatus>().notNull().default('pending'),
    decidedByUserId: uuid('decided_by_user_id').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /** 判断の記録。審査者が交代しても一貫性を保つため（運用設計 第5.5節） */
    note: text('note'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('uq_gcr_pending_group')
      .on(t.groupId)
      .where(sql`${t.status} = 'pending'`),
    check('ck_gcr_status', oneOf(t.status, CERTIFICATION_STATUS)),
  ],
);

/* ------------------------------------------------------------------ *
 * 7. memberships
 * ------------------------------------------------------------------ */

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    status: text('status').$type<MembershipStatus>().notNull(),
    role: text('role').$type<MembershipRole>().notNull().default('member'),
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id),
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    leftAt: timestamp('left_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('uq_memberships_group_user').on(t.groupId, t.userId),
    // 管理者数のロック付き確認に用いる（詳細設計 第5.3節）
    index('idx_memberships_admin')
      .on(t.groupId)
      .where(sql`${t.role} = 'admin' and ${t.status} = 'active'`),
    index('idx_memberships_user_active')
      .on(t.userId)
      .where(sql`${t.status} = 'active'`),
    check('ck_memberships_status', oneOf(t.status, MEMBERSHIP_STATUS)),
    check('ck_memberships_role', oneOf(t.role, MEMBERSHIP_ROLE)),
  ],
);

/* ------------------------------------------------------------------ *
 * 8. posts
 * ------------------------------------------------------------------ */

export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    scope: text('scope').$type<PostScope>().notNull(),
    /** 任意の日時。受信側にカレンダー追加ボタンが出る（詳細設計 第10.4節） */
    eventAt: timestamp('event_at', { withTimezone: true }),
    status: text('status').$type<ContentStatus>().notNull().default('published'),
    /** 設定されていれば「編集済み」と表示する */
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('idx_posts_group').on(t.groupId, t.createdAt),
    check('ck_posts_scope', oneOf(t.scope, POST_SCOPE)),
    check('ck_posts_status', oneOf(t.status, CONTENT_STATUS)),
  ],
);

/* ------------------------------------------------------------------ *
 * 9. post_audiences
 *
 * 配信対象のスナップショット（決定33）。投稿時点で確定し、以後変化しない。
 * ------------------------------------------------------------------ */

export const postAudiences = pgTable(
  'post_audiences',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** どのグループ経由で届いたか。ミュート判定に用いる（決定32） */
    sourceGroupId: uuid('source_group_id')
      .notNull()
      .references(() => groups.id),
    /**
     * posts.created_at の複製（決定 T-19）。
     * タイムラインの並べ替えを本テーブルだけで完結させる。
     * 投稿日時は作成後に変化しないため不整合は起きない。
     */
    postCreatedAt: timestamp('post_created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.userId] }),
    index('idx_post_audiences_timeline').on(t.userId, t.postCreatedAt.desc()),
  ],
);

/* ------------------------------------------------------------------ *
 * 10. comments
 * ------------------------------------------------------------------ */

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id),
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    status: text('status').$type<ContentStatus>().notNull().default('published'),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('idx_comments_post').on(t.postId, t.createdAt),
    check('ck_comments_status', oneOf(t.status, CONTENT_STATUS)),
  ],
);

/* ------------------------------------------------------------------ *
 * 11. reactions
 * ------------------------------------------------------------------ */

export const reactions = pgTable(
  'reactions',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind').$type<ReactionKind>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 種別ごとに1行。「了解」と「参加したい」は排他ではない
    primaryKey({ columns: [t.postId, t.userId, t.kind] }),
    check('ck_reactions_kind', oneOf(t.kind, REACTION_KIND)),
  ],
);

/* ------------------------------------------------------------------ *
 * 12. stamps
 * ------------------------------------------------------------------ */

export const stamps = pgTable(
  'stamps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    name: text('name').notNull(),
    activityDate: date('activity_date', { mode: 'string' }).notNull(),
    design: jsonb('design').notNull().default(sql`'{}'::jsonb`),
    acquisitionMethod: text('acquisition_method').$type<AcquisitionMethod>().notNull(),
    /** venue_qr のときのみ発行する */
    qrToken: text('qr_token').unique(),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
    validUntil: timestamp('valid_until', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [
    index('idx_stamps_group').on(t.groupId),
    check('ck_stamps_method', oneOf(t.acquisitionMethod, ACQUISITION_METHOD)),
    check('ck_stamps_valid_period', sql`${t.validFrom} < ${t.validUntil}`),
    check(
      'ck_stamps_qr_token_presence',
      sql`(${t.acquisitionMethod} = 'venue_qr') = (${t.qrToken} is not null)`,
    ),
  ],
);

/* ------------------------------------------------------------------ *
 * 13. stamp_grants
 * ------------------------------------------------------------------ */

export const stampGrants = pgTable(
  'stamp_grants',
  {
    stampId: uuid('stamp_id')
      .notNull()
      .references(() => stamps.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    method: text('method').$type<GrantMethod>().notNull(),
    grantedByUserId: uuid('granted_by_user_id').references(() => users.id),
    status: text('status').$type<GrantStatus>().notNull().default('valid'),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    // 二度押しや再送での重複付与を構造的に防ぐ（決定 T-41）
    primaryKey({ columns: [t.stampId, t.userId] }),
    index('idx_stamp_grants_user').on(t.userId),
    check('ck_stamp_grants_method', oneOf(t.method, GRANT_METHOD)),
    check('ck_stamp_grants_status', oneOf(t.status, GRANT_STATUS)),
  ],
);

/* ------------------------------------------------------------------ *
 * 14. connections
 * ------------------------------------------------------------------ */

export const connections = pgTable(
  'connections',
  {
    userAId: uuid('user_a_id')
      .notNull()
      .references(() => users.id),
    userBId: uuid('user_b_id')
      .notNull()
      .references(() => users.id),
    status: text('status').$type<ConnectionStatus>().notNull().default('active'),
    establishedAt: timestamp('established_at', { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.userAId, t.userBId] }),
    index('idx_connections_b').on(t.userBId),
    check('ck_connections_status', oneOf(t.status, CONNECTION_STATUS)),
    // 2人の組み合わせを常に同じ順序で格納し、(A,B) と (B,A) の二重登録を防ぐ（決定 T-21）。
    // アプリケーション側で並べ替えを忘れてもデータベースが拒否する。
    check('ck_connections_order', sql`${t.userAId} < ${t.userBId}`),
  ],
);

/* ------------------------------------------------------------------ *
 * 15. blocks
 * ------------------------------------------------------------------ */

export const blocks = pgTable(
  'blocks',
  {
    blockerId: uuid('blocker_id')
      .notNull()
      .references(() => users.id),
    blockedId: uuid('blocked_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // ブロックは一方向。connections と異なり順序の正規化は行わない
    primaryKey({ columns: [t.blockerId, t.blockedId] }),
    index('idx_blocks_blocked').on(t.blockedId),
    check('ck_blocks_not_self', sql`${t.blockerId} <> ${t.blockedId}`),
  ],
);

/* ------------------------------------------------------------------ *
 * 16. group_mutes
 *
 * ミュートは「配信元グループ」に対して設定する（決定32）。
 * 自分が所属していない上位グループも対象にできるため、
 * memberships ではなく groups を参照する。
 * ------------------------------------------------------------------ */

export const groupMutes = pgTable(
  'group_mutes',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.groupId] })],
);

/* ------------------------------------------------------------------ *
 * 17-19. 通知
 * ------------------------------------------------------------------ */

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    channel: text('channel').$type<NotificationChannel>().notNull(),
    body: text('body').notNull(),
    /** 遷移先。必ず持つ（基本設計書 第10.1節 原則5） */
    link: text('link').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_notifications_user').on(t.userId, t.createdAt.desc()),
    check('ck_notifications_channel', oneOf(t.channel, NOTIFICATION_CHANNEL)),
  ],
);

export const notificationSettings = pgTable(
  'notification_settings',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    channel: text('channel').$type<NotificationChannel>().notNull(),
    enabled: boolean('enabled').notNull().default(true),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.channel] }),
    check('ck_ns_channel', oneOf(t.channel, NOTIFICATION_CHANNEL)),
    // N8（運営からのお知らせ）は OFF にできない（基本設計書 第10.2節）
    check('ck_ns_n8_always_on', sql`${t.channel} <> 'N8' or ${t.enabled} = true`),
  ],
);

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    failureCount: integer('failure_count').notNull().default(0),
    lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
    ...timestamps,
  },
  // 1人が複数の端末を使うため user_id に対して複数行を許す
  (t) => [index('idx_push_subscriptions_user').on(t.userId)],
);

/* ------------------------------------------------------------------ *
 * 20. reports
 * ------------------------------------------------------------------ */

export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reporterUserId: uuid('reporter_user_id')
      .notNull()
      .references(() => users.id),
    targetType: text('target_type').$type<ReportTargetType>().notNull(),
    /** 対象が複数テーブルにまたがるため外部キーは張らない（決定 T-23） */
    targetId: uuid('target_id').notNull(),
    reason: text('reason').notNull(),
    status: text('status').$type<ReportStatus>().notNull().default('pending'),
    handledByUserId: uuid('handled_by_user_id').references(() => users.id),
    handledAt: timestamp('handled_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('idx_reports_status').on(t.status, t.createdAt),
    index('idx_reports_target').on(t.targetType, t.targetId),
    check('ck_reports_target_type', oneOf(t.targetType, REPORT_TARGET_TYPE)),
    check('ck_reports_status', oneOf(t.status, REPORT_STATUS)),
  ],
);

/* ------------------------------------------------------------------ *
 * 21. audit_logs
 *
 * 匿名性ポリシー（基本設計書 第12.2節）を成立させる基盤。無期限に保持する（決定43）。
 * 書き込み専用として扱い、更新・削除は行わない。
 * ------------------------------------------------------------------ */

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 退会後も行は残る。個人特定情報が削除された後は特定の個人と結びつかない */
    userId: uuid('user_id').references(() => users.id),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: uuid('target_id'),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_audit_logs_user').on(t.userId, t.createdAt.desc()),
    index('idx_audit_logs_target').on(t.targetType, t.targetId),
  ],
);
