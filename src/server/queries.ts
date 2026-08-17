/**
 * 画面表示のための読み取り
 *
 * Server Components から呼ぶ。更新は Server Actions（src/server/actions）が担う。
 *
 * **相関サブクエリの中で Drizzle の列オブジェクトを補間しないこと。**
 * `${'${schema.groups.id}'}` は、外側のクエリに JOIN が無い場合にテーブル修飾なしの
 * `"id"` として出力される。サブクエリ側のテーブルに同名の列があると、そちらに
 * 静かに束縛されて条件が常に偽になる（実際に人数・親グループ名が 0／null になる
 * 不具合を起こした）。JOIN の有無で挙動が変わるため気づきにくい。
 *
 * そのため、集計や関連の取得は **明示的な JOIN を書いた生 SQL** で行う。
 */
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { getDb, schema, type Db } from '@/db';
import type { GroupKind, GroupStatus, JoinPolicy, ReactionKind } from '@/db/schema';

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowsOf<T>(result: any): T[] {
  return Array.isArray(result) ? (result as T[]) : ((result?.rows ?? []) as T[]);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export type TimelineItem = {
  postId: string;
  groupId: string;
  groupName: string;
  isCertified: boolean;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  eventAt: Date | null;
  ackCount: number;
  joiningCount: number;
  myReactions: ReactionKind[];
  joiningNames: string[];
};

const TIMELINE_PAGE_SIZE = 20;

/**
 * 統合タイムライン（S-03）。
 *
 * post_audiences だけで並べ替えが完結するよう post_created_at を複製してある
 * （決定 T-19）。ページングはカーソル方式（決定 T-20）。
 */
export async function getTimeline(
  userId: string,
  cursor?: string,
): Promise<{ items: TimelineItem[]; nextCursor: string | null }> {
  const db = await getDb();
  const cursorDate = cursor ? new Date(cursor) : null;

  const result = await db.execute(sql`
    select p.id            as "postId",
           p.group_id      as "groupId",
           g.name          as "groupName",
           g.is_certified  as "isCertified",
           p.body          as "body",
           p.created_at    as "createdAt",
           p.edited_at     as "editedAt",
           p.event_at      as "eventAt",
           coalesce(r.ack_count, 0)     as "ackCount",
           coalesce(r.joining_count, 0) as "joiningCount",
           coalesce(mine.kinds, '{}')   as "myReactions",
           coalesce(j.names, '{}')      as "joiningNames"
      from post_audiences pa
      join posts p on p.id = pa.post_id and p.status = 'published'
      join groups g on g.id = p.group_id
      left join lateral (
        select count(*) filter (where kind = 'ack')     as ack_count,
               count(*) filter (where kind = 'joining') as joining_count
          from reactions where post_id = p.id
      ) r on true
      left join lateral (
        select array_agg(kind) as kinds
          from reactions where post_id = p.id and user_id = ${userId}
      ) mine on true
      left join lateral (
        select array_agg(u.display_name order by rx.created_at) as names
          from reactions rx
          join users u on u.id = rx.user_id
         where rx.post_id = p.id and rx.kind = 'joining'
      ) j on true
     where pa.user_id = ${userId}
       ${cursorDate ? sql`and pa.post_created_at < ${cursorDate}` : sql``}
     order by pa.post_created_at desc
     limit ${TIMELINE_PAGE_SIZE + 1}
  `);

  const raw = rowsOf<TimelineItem & { createdAt: string | Date }>(result);
  const hasMore = raw.length > TIMELINE_PAGE_SIZE;
  const page = raw.slice(0, TIMELINE_PAGE_SIZE).map((row) => ({
    ...row,
    createdAt: new Date(row.createdAt),
    editedAt: row.editedAt ? new Date(row.editedAt) : null,
    eventAt: row.eventAt ? new Date(row.eventAt) : null,
    ackCount: Number(row.ackCount),
    joiningCount: Number(row.joiningCount),
    joiningNames: (row.joiningNames ?? []).filter((name): name is string => Boolean(name)),
    myReactions: (row.myReactions ?? []).filter((kind): kind is ReactionKind => Boolean(kind)),
  }));

  const last = page[page.length - 1];
  return {
    items: page,
    nextCursor: hasMore && last ? last.createdAt.toISOString() : null,
  };
}

export type PostDetail = TimelineItem & {
  authorName: string | null;
  comments: Array<{
    id: string;
    body: string;
    authorName: string | null;
    createdAt: Date;
    isMine: boolean;
  }>;
};

/** 連絡詳細（S-05）。配信対象者でなければ null を返す（存在を漏らさない） */
export async function getPostDetail(postId: string, userId: string): Promise<PostDetail | null> {
  const db = await getDb();

  const audience = await db
    .select({ postId: schema.postAudiences.postId })
    .from(schema.postAudiences)
    .where(
      and(eq(schema.postAudiences.postId, postId), eq(schema.postAudiences.userId, userId)),
    )
    .limit(1);
  if (audience.length === 0) return null;

  const result = await db.execute(sql`
    select p.id           as "postId",
           p.group_id     as "groupId",
           g.name         as "groupName",
           g.is_certified as "isCertified",
           p.body         as "body",
           p.created_at   as "createdAt",
           p.edited_at    as "editedAt",
           p.event_at     as "eventAt",
           au.display_name as "authorName",
           coalesce((select count(*) from reactions where post_id = p.id and kind = 'ack'), 0)     as "ackCount",
           coalesce((select count(*) from reactions where post_id = p.id and kind = 'joining'), 0) as "joiningCount",
           coalesce((select array_agg(kind) from reactions where post_id = p.id and user_id = ${userId}), '{}') as "myReactions",
           coalesce((select array_agg(u.display_name order by rx.created_at)
                       from reactions rx join users u on u.id = rx.user_id
                      where rx.post_id = p.id and rx.kind = 'joining'), '{}') as "joiningNames"
      from posts p
      join groups g on g.id = p.group_id
      join users au on au.id = p.author_user_id
     where p.id = ${postId} and p.status = 'published'
  `);

  const row = rowsOf<PostDetail & { createdAt: string }>(result)[0];
  if (!row) return null;

  const commentRows = await db.execute(sql`
    select c.id, c.body, c.created_at as "createdAt", u.display_name as "authorName",
           (c.author_user_id = ${userId}) as "isMine"
      from comments c
      join users u on u.id = c.author_user_id
     where c.post_id = ${postId} and c.status = 'published'
     order by c.created_at asc
  `);

  return {
    ...row,
    createdAt: new Date(row.createdAt),
    editedAt: row.editedAt ? new Date(row.editedAt) : null,
    eventAt: row.eventAt ? new Date(row.eventAt) : null,
    ackCount: Number(row.ackCount),
    joiningCount: Number(row.joiningCount),
    joiningNames: (row.joiningNames ?? []).filter((name): name is string => Boolean(name)),
    myReactions: (row.myReactions ?? []).filter((kind): kind is ReactionKind => Boolean(kind)),
    comments: rowsOf<{
      id: string;
      body: string;
      authorName: string | null;
      createdAt: string;
      isMine: boolean;
    }>(commentRows).map((comment) => ({ ...comment, createdAt: new Date(comment.createdAt) })),
  };
}

export type GroupSummary = {
  id: string;
  name: string;
  kind: GroupKind;
  status: GroupStatus;
  joinPolicy: JoinPolicy;
  isCertified: boolean;
  parentName: string | null;
  memberCount: number;
};

/** グループ検索（S-07）。認証バッジ付きを上位に表示する */
export async function searchGroups(query: string, database?: Db): Promise<GroupSummary[]> {
  const db = database ?? (await getDb());
  const trimmed = query.trim();
  const pattern = `%${trimmed}%`;

  const result = await db.execute(sql`
    select g.id             as "id",
           g.name           as "name",
           g.kind           as "kind",
           g.status         as "status",
           g.join_policy    as "joinPolicy",
           g.is_certified   as "isCertified",
           p.name           as "parentName",
           coalesce(mc.count, 0) as "memberCount"
      from groups g
      left join groups p on p.id = g.parent_group_id
      left join (
        select m.group_id, count(*)::int as count
          from memberships m
         where m.status = 'active'
         group by m.group_id
      ) mc on mc.group_id = g.id
     ${
       trimmed.length > 0
         ? sql`where g.name ilike ${pattern} or g.description ilike ${pattern}`
         : sql``
     }
     order by g.is_certified desc, g.name asc
     limit 50
  `);

  return rowsOf<GroupSummary>(result).map((row) => ({
    ...row,
    memberCount: Number(row.memberCount),
  }));
}

export type GroupDetail = GroupSummary & {
  description: string | null;
  expiresAt: Date | null;
  myStatus: 'none' | 'invited' | 'requested' | 'active' | 'left';
  myRole: 'admin' | 'member' | null;
  isOwner: boolean;
  isMuted: boolean;
  pendingRequests: Array<{ userId: string; displayName: string | null }>;
  descendants: Array<{ groupId: string; name: string; depth: number; severed: boolean; memberCount: number }>;
};

export async function getGroupDetail(
  groupId: string,
  userId: string,
  database?: Db,
): Promise<GroupDetail | null> {
  const db = database ?? (await getDb());

  const baseResult = await db.execute(sql`
    select g.id           as "id",
           g.name         as "name",
           g.kind         as "kind",
           g.status       as "status",
           g.join_policy  as "joinPolicy",
           g.is_certified as "isCertified",
           g.description  as "description",
           g.expires_at   as "expiresAt",
           g.owner_user_id as "ownerUserId",
           p.name         as "parentName",
           coalesce(mc.count, 0) as "memberCount"
      from groups g
      left join groups p on p.id = g.parent_group_id
      left join (
        select m.group_id, count(*)::int as count
          from memberships m
         where m.status = 'active'
         group by m.group_id
      ) mc on mc.group_id = g.id
     where g.id = ${groupId}
  `);

  const raw = rowsOf<
    Omit<GroupSummary, 'memberCount'> & {
      description: string | null;
      expiresAt: string | null;
      ownerUserId: string;
      memberCount: number | string;
    }
  >(baseResult)[0];
  if (!raw) return null;

  const group = {
    ...raw,
    expiresAt: raw.expiresAt ? new Date(raw.expiresAt) : null,
    memberCount: Number(raw.memberCount),
  };

  const membership = await db
    .select({ status: schema.memberships.status, role: schema.memberships.role })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.groupId, groupId), eq(schema.memberships.userId, userId)))
    .limit(1);

  const muted = await db
    .select({ groupId: schema.groupMutes.groupId })
    .from(schema.groupMutes)
    .where(and(eq(schema.groupMutes.userId, userId), eq(schema.groupMutes.groupId, groupId)))
    .limit(1);

  const isAdmin =
    group.ownerUserId === userId ||
    (membership[0]?.status === 'active' && membership[0]?.role === 'admin');

  const pending = isAdmin
    ? await db
        .select({ userId: schema.memberships.userId, displayName: schema.users.displayName })
        .from(schema.memberships)
        .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
        .where(
          and(eq(schema.memberships.groupId, groupId), eq(schema.memberships.status, 'requested')),
        )
    : [];

  const descendants = isAdmin
    ? rowsOf<{ groupId: string; name: string; depth: number; severed: boolean; memberCount: number }>(
        await db.execute(sql`
          with recursive subtree as (
            select g.id, 0 as depth from groups g where g.id = ${groupId}
            union all
            select c.id, s.depth + 1 from groups c join subtree s on c.parent_group_id = s.id
             where s.depth < 10
          )
          select s.id as "groupId", g.name as "name", s.depth as "depth",
                 exists (select 1 from group_broadcast_exclusions e
                          where e.ancestor_group_id = ${groupId} and e.excluded_group_id = s.id) as "severed",
                 (select count(*)::int from memberships m where m.group_id = s.id and m.status = 'active') as "memberCount"
            from subtree s join groups g on g.id = s.id
           where s.depth > 0
           order by s.depth asc, g.name asc
        `),
      )
    : [];

  const status = membership[0]?.status;
  return {
    ...group,
    myStatus:
      status === 'active' || status === 'invited' || status === 'requested' || status === 'left'
        ? status
        : 'none',
    myRole: membership[0]?.role ?? null,
    isOwner: group.ownerUserId === userId,
    isMuted: muted.length > 0,
    pendingRequests: pending,
    descendants: descendants.map((d) => ({ ...d, depth: Number(d.depth), memberCount: Number(d.memberCount) })),
  };
}

/** 連絡を投稿できるグループ（S-06 の送信元） */
export async function listAdminGroups(userId: string, database?: Db) {
  const db = database ?? (await getDb());
  const result = await db.execute(sql`
    select g.id           as "id",
           g.name         as "name",
           g.is_certified as "isCertified",
           exists (
             select 1 from groups c
              where c.parent_group_id = g.id and c.status = 'active'
           ) as "hasChildren"
      from groups g
      join memberships m on m.group_id = g.id
     where m.user_id = ${userId}
       and m.status = 'active'
       and m.role = 'admin'
       and g.status = 'active'
     order by g.name asc
  `);
  return rowsOf<{ id: string; name: string; isCertified: boolean; hasChildren: boolean }>(result);
}

export async function listMyGroups(userId: string) {
  const db = await getDb();
  return db
    .select({
      id: schema.groups.id,
      name: schema.groups.name,
      kind: schema.groups.kind,
      isCertified: schema.groups.isCertified,
      role: schema.memberships.role,
      status: schema.groups.status,
      isMuted: sql<boolean>`exists (select 1 from group_mutes gm
                                     where gm.user_id = ${userId} and gm.group_id = ${schema.groups.id})`,
    })
    .from(schema.memberships)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.memberships.groupId))
    .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.status, 'active')))
    .orderBy(asc(schema.groups.name));
}

export async function getCollection(userId: string) {
  const db = await getDb();

  const stamps = await db
    .select({
      id: schema.stamps.id,
      name: schema.stamps.name,
      activityDate: schema.stamps.activityDate,
      design: schema.stamps.design,
      groupName: schema.groups.name,
      grantedAt: schema.stampGrants.grantedAt,
    })
    .from(schema.stampGrants)
    .innerJoin(schema.stamps, eq(schema.stamps.id, schema.stampGrants.stampId))
    .innerJoin(schema.groups, eq(schema.groups.id, schema.stamps.groupId))
    .where(and(eq(schema.stampGrants.userId, userId), eq(schema.stampGrants.status, 'valid')))
    .orderBy(desc(schema.stampGrants.grantedAt));

  const cards = rowsOf<{
    userId: string;
    displayName: string;
    bio: string | null;
    affiliation: string | null;
    establishedAt: string;
  }>(
    await db.execute(sql`
      select other.id as "userId",
             pc.display_name as "displayName",
             pc.bio as "bio",
             case when pc.shows_affiliation then (
               select g.name from memberships m join groups g on g.id = m.group_id
                where m.user_id = other.id and m.status = 'active' and g.is_certified
                order by g.name limit 1
             ) end as "affiliation",
             c.established_at as "establishedAt"
        from connections c
        join users other
          on other.id = case when c.user_a_id = ${userId} then c.user_b_id else c.user_a_id end
        join profile_cards pc on pc.user_id = other.id
       where (c.user_a_id = ${userId} or c.user_b_id = ${userId})
         and c.status = 'active'
       order by c.established_at desc
    `),
  );

  return { stamps, cards };
}

export async function listNotifications(userId: string) {
  const db = await getDb();
  return db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(50);
}

export async function countUnreadNotifications(userId: string): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, userId), sql`read_at is null`));
  return Number(rows[0]?.count ?? 0);
}

/** 動作確認用のユーザー切替に使う一覧 */
export async function listAllUsers() {
  const db = await getDb();
  return db
    .select({
      id: schema.users.id,
      displayName: schema.users.displayName,
      status: schema.users.status,
    })
    .from(schema.users)
    .where(eq(schema.users.status, 'active'))
    .orderBy(asc(schema.users.displayName));
}
