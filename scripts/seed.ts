/**
 * 動作確認用のデータ投入
 *
 *   npm run db:seed
 *
 * 既存のデータをすべて消してから、基本設計書の例に沿った構成を作る。
 * 本番データベースに対しては実行しないこと（DATABASE_URL があると中止する）。
 */
import { sql } from 'drizzle-orm';
import { getDb, schema } from '../src/db/index';
import { normalizeGroupName } from '../src/domain/group-name';
import { resolveAudience } from '../src/domain/broadcast';

if (process.env.DATABASE_URL) {
  console.error('DATABASE_URL が設定されています。動作確認用のデータ投入は中止します。');
  process.exit(1);
}

const db = await getDb();

/* ------------------------------------------------------------------ *
 * 既存データの削除（外部キーの依存順）
 * ------------------------------------------------------------------ */
await db.execute(sql`
  truncate table
    audit_logs, reports, push_subscriptions, notification_settings, notifications,
    group_mutes, blocks, connections, stamp_grants, stamps, reactions, comments,
    post_audiences, posts, memberships, group_certification_requests,
    group_broadcast_exclusions, group_parent_requests, groups, profile_cards, users
  restart identity cascade
`);

/* ------------------------------------------------------------------ *
 * 利用者
 * ------------------------------------------------------------------ */
type SeedUser = { key: string; name: string; bio: string };

const seedUsers: SeedUser[] = [
  { key: 'unno', name: '海野 千尋', bio: '大学2年。カヌーと野営が好きです。' },
  { key: 'kaji', name: '梶 亮太', bio: '社会人1年目。すみだ地区の役員をしています。' },
  { key: 'sone', name: '曽根 みなみ', bio: '大学4年。広報と写真担当。' },
  { key: 'tobe', name: '戸部 健', bio: 'ローバー隊長。指導者として関わっています。' },
  { key: 'arai', name: '荒井 ひかる', bio: '大学1年。はじめたばかりです。' },
  { key: 'ops', name: 'RoveringNow 運営', bio: 'アプリの運営アカウントです。' },
];

const users: Record<string, string> = {};
for (const user of seedUsers) {
  const inserted = await db
    .insert(schema.users)
    .values({
      displayName: user.name,
      email: `${user.key}@example.test`,
      status: 'active',
    })
    .returning({ id: schema.users.id });
  const id = inserted[0]!.id;
  users[user.key] = id;

  await db.insert(schema.profileCards).values({
    userId: id,
    displayName: user.name,
    bio: user.bio,
    qrToken: `card-${user.key}`,
    showsAffiliation: true,
  });

  // 通知チャンネルの既定値
  for (const channel of ['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8'] as const) {
    await db.insert(schema.notificationSettings).values({ userId: id, channel, enabled: true });
  }
}

/* ------------------------------------------------------------------ *
 * グループ
 * ------------------------------------------------------------------ */
type SeedGroup = {
  key: string;
  name: string;
  kind: 'official' | 'project' | 'event' | 'other';
  parent: string | null;
  policy: 'invite' | 'request' | 'open';
  certified: boolean;
  description: string;
  expiresInDays?: number;
};

const seedGroups: SeedGroup[] = [
  {
    key: 'tokyo',
    name: '東京ローバースカウト連絡会',
    kind: 'official',
    parent: null,
    policy: 'request',
    certified: true,
    description: '東京都内のローバースカウトをつなぐ連絡会です。',
  },
  {
    key: 'sumida',
    name: 'すみだローバースカウト協議会',
    kind: 'official',
    parent: 'tokyo',
    policy: 'request',
    certified: true,
    description: 'すみだ地区のローバースカウト協議会。月1回の集会があります。',
  },
  {
    key: 'tamagawa',
    name: 'たまがわローバー会',
    kind: 'official',
    parent: 'tokyo',
    policy: 'request',
    certified: true,
    description: '多摩川沿いの団が集まるローバー会です。',
  },
  {
    key: 'asahi',
    name: 'あさひ第3ローバー隊',
    kind: 'official',
    parent: 'sumida',
    policy: 'request',
    certified: true,
    description: 'あさひ第3団のローバー隊。',
  },
  {
    key: 'midori',
    name: 'みどりが丘ローバー隊',
    kind: 'official',
    parent: 'sumida',
    policy: 'request',
    certified: true,
    description: 'みどりが丘団のローバー隊。',
  },
  {
    key: 'campteam',
    name: 'すみだ地区キャンプ実行委員会',
    kind: 'project',
    parent: 'sumida',
    policy: 'invite',
    certified: false,
    description: '夏の地区キャンプを企画する実行委員会です。',
    expiresInDays: 120,
  },
  {
    key: 'summercamp',
    name: '夏季合同キャンプ2027',
    kind: 'event',
    parent: null,
    policy: 'open',
    certified: false,
    description: '8月14日〜16日、丹沢での合同キャンプ。どなたでも参加できます。',
    expiresInDays: 60,
  },
];

const groups: Record<string, string> = {};
for (const group of seedGroups) {
  const inserted = await db
    .insert(schema.groups)
    .values({
      name: group.name,
      nameNormalized: normalizeGroupName(group.name),
      kind: group.kind,
      ownerUserId: users.kaji!,
      parentGroupId: group.parent ? groups[group.parent]! : null,
      joinPolicy: group.policy,
      isCertified: group.certified,
      description: group.description,
      expiresAt: group.expiresInDays
        ? new Date(Date.now() + group.expiresInDays * 24 * 60 * 60 * 1000)
        : null,
      joinQrToken: `join-${group.key}`,
    })
    .returning({ id: schema.groups.id });
  groups[group.key] = inserted[0]!.id;
}

/* ------------------------------------------------------------------ *
 * 所属
 * ------------------------------------------------------------------ */
const memberships: Array<[string, string, 'admin' | 'member', 'active' | 'requested']> = [
  ['kaji', 'tokyo', 'admin', 'active'],
  ['kaji', 'sumida', 'admin', 'active'],
  ['kaji', 'campteam', 'admin', 'active'],
  ['tobe', 'asahi', 'admin', 'active'],
  ['tobe', 'sumida', 'member', 'active'],
  ['sone', 'midori', 'admin', 'active'],
  ['sone', 'summercamp', 'admin', 'active'],
  ['unno', 'asahi', 'member', 'active'],
  ['unno', 'sumida', 'member', 'active'],
  ['unno', 'campteam', 'member', 'active'],
  ['unno', 'summercamp', 'member', 'active'],
  ['arai', 'midori', 'member', 'active'],
  ['arai', 'summercamp', 'member', 'active'],
  // 承認待ち（グループ管理画面で確認できる）
  ['arai', 'sumida', 'member', 'requested'],
];

for (const [userKey, groupKey, role, status] of memberships) {
  await db.insert(schema.memberships).values({
    groupId: groups[groupKey]!,
    userId: users[userKey]!,
    role,
    status,
    joinedAt: status === 'active' ? new Date() : null,
  });
}

/* ------------------------------------------------------------------ *
 * 連絡（配信対象と通知も作る）
 * ------------------------------------------------------------------ */
type SeedPost = {
  group: string;
  author: string;
  body: string;
  scope: 'self' | 'descendants';
  daysAgo: number;
  eventInDays?: number;
};

const seedPosts: SeedPost[] = [
  {
    group: 'sumida',
    author: 'kaji',
    body: '10月12日（土）の地区集会について。\n\nいつもの公民館に9時集合です。持ち物は制服・筆記用具・昼食。雨天決行です。\n初めて参加する人は8時45分に来てもらえると助かります。',
    scope: 'descendants',
    daysAgo: 1,
    eventInDays: 5,
  },
  {
    group: 'tokyo',
    author: 'kaji',
    body: '来春の東京ローバースカウト大会の企画委員を募集します。\n月1回のオンライン会議に参加できる方、ぜひご連絡ください。',
    scope: 'descendants',
    daysAgo: 3,
  },
  {
    group: 'asahi',
    author: 'tobe',
    body: '今週の隊集会は、ロープワークの練習をします。ロープを持っている人は持参してください。',
    scope: 'self',
    daysAgo: 2,
  },
  {
    group: 'summercamp',
    author: 'sone',
    body: '夏季合同キャンプ2027の詳細が決まりました。\n\n日程：8月14日（金）〜16日（日）\n場所：丹沢キャンプ場\n参加費：6,000円\n\n申込はこのグループの連絡をご確認ください。',
    scope: 'self',
    daysAgo: 5,
    eventInDays: 30,
  },
  {
    group: 'campteam',
    author: 'kaji',
    body: '次回の実行委員会は水曜20時からオンラインで行います。\n担当割りの案を共有しますので、目を通しておいてください。',
    scope: 'self',
    daysAgo: 4,
  },
  {
    group: 'midori',
    author: 'sone',
    body: '先週の奉仕活動、おつかれさまでした。写真をアルバムにまとめました。\nスタンプを配布しているので、まだの人はスキャンしてください。',
    scope: 'self',
    daysAgo: 6,
  },
];

const postIds: Record<number, string> = {};
for (const [index, post] of seedPosts.entries()) {
  const createdAt = new Date(Date.now() - post.daysAgo * 24 * 60 * 60 * 1000);
  const inserted = await db
    .insert(schema.posts)
    .values({
      groupId: groups[post.group]!,
      authorUserId: users[post.author]!,
      body: post.body,
      scope: post.scope,
      eventAt: post.eventInDays
        ? new Date(Date.now() + post.eventInDays * 24 * 60 * 60 * 1000)
        : null,
      createdAt,
      updatedAt: createdAt,
    })
    .returning({ id: schema.posts.id });

  const postId = inserted[0]!.id;
  postIds[index] = postId;

  const audience = await resolveAudience(db, {
    originGroupId: groups[post.group]!,
    scope: post.scope,
  });

  if (audience.length > 0) {
    await db.insert(schema.postAudiences).values(
      audience.map((row) => ({
        postId,
        userId: row.userId,
        sourceGroupId: row.sourceGroupId,
        postCreatedAt: createdAt,
      })),
    );

    const recipients = audience.filter((row) => row.userId !== users[post.author]);
    if (recipients.length > 0) {
      await db.insert(schema.notifications).values(
        recipients.map((row) => ({
          userId: row.userId,
          channel: 'N1' as const,
          body: `${seedGroups.find((g) => g.key === post.group)!.name}：${post.body.split('\n')[0]!.slice(0, 40)}`,
          link: `/posts/${postId}`,
          createdAt,
        })),
      );
    }
  }
}

/* ------------------------------------------------------------------ *
 * リアクションとコメント
 * ------------------------------------------------------------------ */
const reactions: Array<[number, string, 'ack' | 'joining']> = [
  [0, 'unno', 'joining'],
  [0, 'tobe', 'joining'],
  [0, 'sone', 'ack'],
  [0, 'arai', 'joining'],
  [1, 'unno', 'ack'],
  [3, 'unno', 'joining'],
  [3, 'arai', 'joining'],
  [5, 'arai', 'ack'],
];
for (const [postIndex, userKey, kind] of reactions) {
  await db
    .insert(schema.reactions)
    .values({ postId: postIds[postIndex]!, userId: users[userKey]!, kind })
    .onConflictDoNothing();
}

const comments: Array<[number, string, string]> = [
  [0, 'unno', '了解しました。8時45分に行きます。'],
  [0, 'arai', '初参加です。制服はまだ揃っていないのですが大丈夫でしょうか。'],
  [0, 'kaji', '大丈夫です。動きやすい服装で来てください。'],
  [3, 'unno', '参加します！テントは持参でしょうか？'],
];
for (const [postIndex, userKey, body] of comments) {
  await db.insert(schema.comments).values({
    postId: postIds[postIndex]!,
    authorUserId: users[userKey]!,
    body,
  });
}

/* ------------------------------------------------------------------ *
 * スタンプ
 * ------------------------------------------------------------------ */
type SeedStamp = {
  key: string;
  group: string;
  name: string;
  date: string;
  shape: 'circle' | 'hexagon' | 'shield';
  color: string;
  icon: string;
  holders: string[];
};

const seedStamps: SeedStamp[] = [
  {
    key: 'natsucamp',
    group: 'sumida',
    name: '夏季キャンプ2026',
    date: '2026-08-14',
    shape: 'hexagon',
    color: '#0f6b8a',
    icon: '⛺',
    holders: ['unno', 'tobe', 'sone'],
  },
  {
    key: 'houshi',
    group: 'midori',
    name: '河川敷清掃奉仕',
    date: '2026-06-21',
    shape: 'circle',
    color: '#9b8d77',
    icon: '🧤',
    holders: ['unno', 'arai', 'sone'],
  },
  {
    key: 'zoukei',
    group: 'asahi',
    name: '工作技能講習',
    date: '2026-05-10',
    shape: 'shield',
    color: '#04384c',
    icon: '🪓',
    holders: ['unno'],
  },
  {
    key: 'kokusai',
    group: 'tokyo',
    name: '国際交流の集い',
    date: '2026-03-08',
    shape: 'circle',
    color: '#5f8ea6',
    icon: '🌏',
    holders: ['unno', 'sone', 'kaji'],
  },
];

for (const stamp of seedStamps) {
  const inserted = await db
    .insert(schema.stamps)
    .values({
      groupId: groups[stamp.group]!,
      name: stamp.name,
      activityDate: stamp.date,
      design: { shape: stamp.shape, color: stamp.color, icon: stamp.icon },
      acquisitionMethod: 'venue_qr',
      qrToken: `stamp-${stamp.key}`,
      validFrom: new Date(`${stamp.date}T00:00:00Z`),
      validUntil: new Date(`${stamp.date}T23:59:59Z`),
    })
    .returning({ id: schema.stamps.id });

  for (const holder of stamp.holders) {
    await db.insert(schema.stampGrants).values({
      stampId: inserted[0]!.id,
      userId: users[holder]!,
      method: 'venue_qr',
      grantedAt: new Date(`${stamp.date}T10:00:00Z`),
    });
  }
}

/* ------------------------------------------------------------------ *
 * つながり（カード交換）
 * ------------------------------------------------------------------ */
const connections: Array<[string, string]> = [
  ['unno', 'sone'],
  ['unno', 'tobe'],
  ['unno', 'arai'],
  ['sone', 'arai'],
];
for (const [a, b] of connections) {
  const [small, large] = [users[a]!, users[b]!].sort();
  await db
    .insert(schema.connections)
    .values({ userAId: small!, userBId: large! })
    .onConflictDoNothing();
}

/* ------------------------------------------------------------------ *
 * 完了
 * ------------------------------------------------------------------ */
const counts = await db.execute(sql`
  select
    (select count(*) from users) as users,
    (select count(*) from groups) as groups,
    (select count(*) from posts) as posts,
    (select count(*) from post_audiences) as audiences,
    (select count(*) from notifications) as notifications,
    (select count(*) from stamp_grants) as grants
`);
const row = (Array.isArray(counts) ? counts : (counts as { rows: unknown[] }).rows)[0];

console.log('データを投入しました:', row);
console.log('\n動作確認用の利用者:');
for (const user of seedUsers) {
  console.log(`  ${user.name.padEnd(20)} ${users[user.key]}`);
}
process.exit(0);
