/**
 * 配下配信の対象決定
 *
 * 詳細設計 03_db_schema.md 第5.1節の実装。基本設計書 第9.3節の規則を満たす。
 *
 * 1. 同一ユーザーが複数の対象グループに所属していても、連絡は 1 件としてのみ届く
 * 2. 親子関係が「承認済」のもののみ経路として扱う
 *    （groups.parent_group_id には承認済みのみが入るため、ここで状態を見る必要はない）
 * 3. アーカイブ・休眠状態のグループは対象から除外し、その配下もたどらない
 * 4. 配信対象は投稿時点で確定し、以後変化しない（呼び出し側で post_audiences に保存する）
 * 5. 各対象者について「どのグループ経由で届いたか」を記録する
 */
import { sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { PostScope } from '@/db/schema';

/**
 * 配下をたどる深さの上限。
 *
 * 日本のスカウト組織階層は 日本連盟→県連盟→地区→団→隊 の 5 層であり、
 * プロジェクトやイベントの入れ子を見込んでも 10 で十分に足りる。
 * 同時に、万一グループ間に循環が生じた場合の最後の防御でもある
 * （02_architecture.md 第4.2節：作成時の検査と探索時の防御の二段構え）。
 */
export const MAX_TREE_DEPTH = 10;

export type AudienceRow = {
  /** 配信対象者 */
  userId: string;
  /**
   * 配信元グループ。ミュート判定に用いる（決定32）。
   *
   * これは「連絡を投稿したグループ」であり、対象者が所属するグループではない。
   * 所属グループを基準にすると、県連盟の配下配信を静かにするために自分の団を
   * ミュートすることになり、団自身の連絡まで消えてしまう。基本設計書 第10.3節が
   * 避けようとしている失敗はまさにこれである。
   *
   * 構造上つねに posts.group_id と一致するが、プッシュ送信の対象決定
   * （03_db_schema.md 第5.4節）を posts との結合なしに行えるよう複製する。
   */
  sourceGroupId: string;
};

/** db.execute の戻り値がドライバによって異なるため、行の配列に揃える */
function toRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result !== null && typeof result === 'object' && 'rows' in result) {
    return (result as { rows: T[] }).rows;
  }
  throw new Error('データベースの応答を解釈できませんでした');
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyPgDatabase = PgDatabase<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * 連絡の配信対象を求める。
 *
 * @param db トランザクション内で呼ぶこと。投稿と配信対象の確定は同一トランザクションに
 *           収める必要がある（02_architecture.md 第4.3節）
 */
export async function resolveAudience(
  db: AnyPgDatabase,
  params: { originGroupId: string; scope: PostScope; maxDepth?: number },
): Promise<AudienceRow[]> {
  const { originGroupId, scope } = params;
  const maxDepth = params.maxDepth ?? MAX_TREE_DEPTH;

  if (scope === 'self') {
    const result = await db.execute(sql`
      select m.user_id as "userId", ${originGroupId}::uuid as "sourceGroupId"
        from memberships m
        join groups g on g.id = m.group_id
        join users u on u.id = m.user_id
       where m.group_id = ${originGroupId}
         and m.status = 'active'
         and g.status = 'active'
         and u.status = 'active'
    `);
    return toRows<AudienceRow>(result);
  }

  const result = await db.execute(sql`
    with recursive subtree as (
      -- 起点：投稿元のグループ
      select g.id, 0 as depth
        from groups g
       where g.id = ${originGroupId}
         and g.status = 'active'

      union all

      -- 再帰：子をたどる
      select c.id, s.depth + 1
        from groups c
        join subtree s on c.parent_group_id = s.id
       where c.status = 'active'          -- アーカイブ・休眠はその配下ごと除外される
         and s.depth < ${maxDepth}
         and not exists (                 -- 起点グループが切断した経路はたどらない
           select 1
             from group_broadcast_exclusions e
            where e.ancestor_group_id = ${originGroupId}
              and e.excluded_group_id = c.id
         )
    )
    -- 複数のグループに所属していても連絡は1件としてのみ届く（基本設計書 第9.3節 規則1）
    select distinct
           m.user_id as "userId",
           ${originGroupId}::uuid as "sourceGroupId"
      from memberships m
      join subtree s on s.id = m.group_id
      join users u on u.id = m.user_id
     where m.status = 'active'
       and u.status = 'active'
  `);
  return toRows<AudienceRow>(result);
}

/**
 * あるグループの子孫すべてを求める（配下ツリーの閲覧・S-11）。
 *
 * 切断済みの経路も「切断中」として示す必要があるため、除外を適用しない点が
 * resolveAudience との違いである。
 */
export async function listDescendants(
  db: AnyPgDatabase,
  params: { originGroupId: string; maxDepth?: number },
): Promise<Array<{ groupId: string; depth: number; severed: boolean }>> {
  const { originGroupId } = params;
  const maxDepth = params.maxDepth ?? MAX_TREE_DEPTH;

  const result = await db.execute(sql`
    with recursive subtree as (
      select g.id, 0 as depth
        from groups g
       where g.id = ${originGroupId}

      union all

      select c.id, s.depth + 1
        from groups c
        join subtree s on c.parent_group_id = s.id
       where s.depth < ${maxDepth}
    )
    select s.id as "groupId",
           s.depth as "depth",
           exists (
             select 1
               from group_broadcast_exclusions e
              where e.ancestor_group_id = ${originGroupId}
                and e.excluded_group_id = s.id
           ) as "severed"
      from subtree s
     where s.depth > 0
     order by s.depth asc, s.id asc
  `);
  return toRows<{ groupId: string; depth: number; severed: boolean }>(result);
}

/**
 * 指定したグループが、起点グループの子孫であるかを判定する。
 *
 * 親グループの設定申請・承認における循環参照の検査に用いる
 * （02_architecture.md 第4.2節）。申請時点で循環がなくても、承認の順序によっては
 * 承認時点で成立しうるため、申請時と承認時の両方で呼ぶ。
 */
export async function isDescendantOf(
  db: AnyPgDatabase,
  params: { ancestorGroupId: string; candidateGroupId: string; maxDepth?: number },
): Promise<boolean> {
  const { ancestorGroupId, candidateGroupId } = params;
  if (ancestorGroupId === candidateGroupId) return true;

  const maxDepth = params.maxDepth ?? MAX_TREE_DEPTH;
  const result = await db.execute(sql`
    with recursive subtree as (
      select g.id, 0 as depth
        from groups g
       where g.id = ${ancestorGroupId}

      union all

      select c.id, s.depth + 1
        from groups c
        join subtree s on c.parent_group_id = s.id
       where s.depth < ${maxDepth}
    )
    select 1 as "hit" from subtree where id = ${candidateGroupId} limit 1
  `);
  return toRows<{ hit: number }>(result).length > 0;
}
