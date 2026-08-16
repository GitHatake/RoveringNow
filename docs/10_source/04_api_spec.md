# 詳細設計書 04 — API仕様

| 項目 | 内容 |
|---|---|
| 文書名 | API仕様 |
| バージョン | 1.0 |
| 作成日 | 2026-08-17 |
| ステータス | レビュー中 |
| 対象工程 | 工程1（詳細設計） |
| 上位文書 | [基本設計書](01_basic_design.md) / [アーキテクチャ](02_architecture.md) / [DB物理設計](03_db_schema.md) |

### 本書の位置づけ

クライアントとサーバの間で交わされる操作を定義する。本アプリは Next.js（App Router）による単一のアプリケーションであるため、公開APIではなく**内部インターフェース**の仕様として記述する。

**すべての操作は認可モジュールを通る。** これが本書における唯一絶対の規約である（アーキテクチャ 第4.1節）。

---

## 目次

1. [方式](#1-方式)
2. [共通規約](#2-共通規約)
3. [エラーコード](#3-エラーコード)
4. [操作一覧](#4-操作一覧)
5. [主要操作の詳細](#5-主要操作の詳細)
6. [Route Handlers](#6-route-handlers)
7. [意思決定履歴](#7-意思決定履歴)

---

## 1. 方式

### 1.1 Server Actions を基本とする

| 方式 | 用途 |
|---|---|
| **Server Components** | 画面表示に必要なデータの取得 |
| **Server Actions** | 利用者の操作による状態変更（作成・更新・削除） |
| **Route Handlers** | 外部から呼ばれるもの（Cron、Push関連）に限る |

REST や GraphQL のエンドポイントを別途設けない。**構成要素を増やさない**という方針（アーキテクチャ 第1.3節）に従う。Server Actions は型定義がクライアントとサーバで共有されるため、境界での型の食い違いが起きない。

### 1.2 命名規則

| 種別 | 規則 | 例 |
|---|---|---|
| 取得 | `get<対象>` / `list<対象>` | `getGroup`, `listNotifications` |
| 作成 | `create<対象>` | `createPost` |
| 更新 | `update<対象>` | `updateProfileCard` |
| 状態変更 | 動詞で表す | `leaveGroup`, `approveJoinRequest` |

**削除は `delete` を使わない場面が多い。** 物理削除を行わないため（決定 T-16）、`leaveGroup`・`releaseConnection` のように「何が起きるか」を動詞で表す。

---

## 2. 共通規約

### 2.1 認可

**すべての Server Action は、最初に認可モジュールを呼ぶ。**

```
1. セッションから actor（操作者）を得る。なければ UNAUTHENTICATED
2. 対象資源を取得する
3. can(actor, action, resource) を評価する。false なら FORBIDDEN
4. 業務処理を実行する
```

| 規律 | 内容 |
|---|---|
| 例外を作らない | 「明らかに誰でもできる操作」でも認可モジュールを通す。例外を認めると、どれが例外だったか分からなくなる |
| 資源を先に取る | 資源が存在しない場合と権限がない場合を区別して扱うが、**利用者への応答では区別しない場合がある**（第3.2節） |
| クライアントの判定は表示のみ | クライアント側の権限判定はボタンの出し分けにのみ用い、サーバはそれを一切信頼しない |

### 2.2 入力検証

**すべての入力をサーバ側で検証する。** クライアント側の検証は利用者への即時フィードバックのためだけに行う。

| 項目 | 規則 |
|---|---|
| 検証の位置 | 認可の前。不正な入力で資源を取得しに行かない |
| 定義の共有 | 検証スキーマをクライアントとサーバで共有し、二重に書かない |
| 文字列 | 前後の空白を除去する。長さの上限を必ず設ける |
| 識別子 | UUID の形式を検証する |
| 日時 | ISO 8601 として解釈できることを検証する |

### 2.3 戻り値

**例外を投げず、成功と失敗を型で表す。**

```
Result<T> = { ok: true, data: T }
          | { ok: false, code: ErrorCode, message: string, details?: unknown }
```

呼び出し側は `ok` を確認しなければ `data` に到達できないため、失敗の処理漏れが型検査で見つかる。想定外の異常（データベースの接続断など）のみ例外として扱い、共通のハンドラで `INTERNAL` に変換する。

### 2.4 冪等性

再送や二度押しで結果が変わってはならない操作を明示する（アーキテクチャ 第4.6節）。

| 操作 | 冪等性の実現 |
|---|---|
| `claimStamp` | `stamp_grants` の主キー制約。既に獲得済みなら成功として扱い、獲得日時を返す |
| `exchangeCard` | `connections` の主キー制約。既につながっていれば成功として扱う |
| `setReaction` | 主キー制約。同じ種別を再度付けても1行 |
| `blockUser` | 主キー制約 |
| `markNotificationRead` | 既読日時が設定済みなら何もしない |

**「既に完了している」を失敗として返さない。** 利用者にとっては目的が達成されているためである。

### 2.5 レート制限

| 対象 | 制限 |
|---|---|
| グループ名の重複判定 | 1利用者あたり毎分60回 |
| グループ作成 | 1利用者あたり1日10件 |
| 連絡の投稿 | 1グループあたり毎分10件 |
| 通報 | 1利用者あたり1日20件 |
| QRスキャン | 1利用者あたり毎分30回 |
| 認証申請 | 1グループあたり1日1件 |

超過時は `RATE_LIMITED` を返す。**制限値は運用開始後に見直す**前提とし、設定として外に出す。

### 2.6 監査ログ

次の操作は `audit_logs` に記録する（基本設計書 第12.2節）。

| 分類 | 対象 |
|---|---|
| 投稿系 | 連絡・コメントの作成・編集・削除、（Phase 2以降）掲示板の書き込み |
| 権限系 | 管理者の任命・剥奪・辞任、オーナー移譲、メンバーの除名 |
| 運営系 | 認証の付与・剥奪、名称移管、通報の処理、アカウント停止、**発信者情報の照合** |
| 関係系 | ブロック、つながりの解除 |

**発信者情報の照合そのものを記録する。** 恣意的な閲覧を防ぐため（基本設計書 第12.2節）。

---

## 3. エラーコード

### 3.1 一覧

| コード | 意味 | 利用者への提示 |
|---|---|---|
| `UNAUTHENTICATED` | 未ログイン | ログイン画面へ誘導 |
| `FORBIDDEN` | 権限がない | 操作できない旨と、誰に依頼すればよいか |
| `NOT_FOUND` | 対象が存在しない | 対象が見つからない旨 |
| `VALIDATION_FAILED` | 入力が不正 | 項目ごとの理由 |
| `GROUP_NAME_TAKEN` | グループ名が使用済み | 事実の提示と代替名の提案（**赤いエラーにしない**） |
| `GROUP_NOT_ACTIVE` | アーカイブ／休眠のグループ | 状態と、投稿できない理由 |
| `STAMP_NOT_IN_PERIOD` | 取得有効期間外 | 期限の日時。管理者への問い合わせ導線 |
| `STAMP_ALREADY_GRANTED` | 獲得済み | 獲得日時。コレクションへ遷移 |
| `LAST_ADMIN` | 唯一の管理者は離脱できない | 後任の指名を促す |
| `PARENT_CYCLE` | 親子関係が循環する | 指定できない旨 |
| `PARENT_REQUEST_PENDING` | 既に申請中の親がある | 申請中の相手を示す |
| `EXCHANGE_UNAVAILABLE` | カード交換できない | **理由を示さない**（第3.2節） |
| `RATE_LIMITED` | 実行回数の上限 | しばらく待つよう案内 |
| `CONFLICT` | 同時更新の競合 | 再読み込みを促す |
| `INTERNAL` | サーバ側の異常 | 一般的な文言。詳細はログのみ |

### 3.2 情報を漏らさないための規則

エラーの内容から内部状態が推測できてはならない（基本設計書 第7.8節）。

| 状況 | 返すコード | 理由 |
|---|---|---|
| ブロックされている相手のカードQRをスキャン | `EXCHANGE_UNAVAILABLE` | **ブロックされている事実を伝えない**（決定29の方針：ブロックを相手に通知しない） |
| 存在しない相手のカードQR | `EXCHANGE_UNAVAILABLE` | 上と同じコードにすることで、両者を区別できなくする |
| 自分が所属していない非公開の資源を参照 | `NOT_FOUND` | `FORBIDDEN` を返すと「存在すること」が分かってしまう |
| 存在しないメールアドレスでのログイン | 認証基盤の一般的な失敗 | アカウントの存在を推測させない |

**「ブロック」と「存在しない」を同一のコードにするのが要である。** 別々のコードを返すと、スキャンを繰り返すことでブロックの有無を判定できてしまう。

---

## 4. 操作一覧

凡例：認可欄は必要な権限。`—` は認証のみ。

### 4.1 アカウント

| 操作 | 機能 | 認可 | 主なエラー |
|---|---|---|---|
| `signUp` / `signIn` / `signOut` | F-01 | — | 認証基盤に委譲 |
| `withdrawAccount` | F-01 | 本人 | `LAST_ADMIN`（後述） |

### 4.2 グループ

| 操作 | 機能 | 認可 | 主なエラー |
|---|---|---|---|
| `checkGroupName` | F-02 | — | `RATE_LIMITED` |
| `createGroup` | F-02 | — | `GROUP_NAME_TAKEN`, `RATE_LIMITED` |
| `searchGroups` | F-03 | — | |
| `getGroup` | F-03 | — | `NOT_FOUND` |
| `updateGroup` | F-04 | 管理者 | `FORBIDDEN`, `GROUP_NAME_TAKEN` |
| `requestJoin` | F-03 | — | `GROUP_NOT_ACTIVE` |
| `joinOpenGroup` | F-03 | — | `GROUP_NOT_ACTIVE` |
| `acceptInvitation` | F-03 | 被招待者 | |
| `leaveGroup` | F-16 | メンバー | `LAST_ADMIN` |
| `inviteMember` | F-04 | 管理者 | `FORBIDDEN` |
| `approveJoinRequest` / `rejectJoinRequest` | F-04 | 管理者 | `FORBIDDEN` |
| `removeMember` | F-04 | 管理者 | `FORBIDDEN`（オーナーは対象外） |
| `grantAdmin` | F-17 | 管理者 | `FORBIDDEN` |
| `revokeAdmin` | F-17 | **オーナーのみ** | `FORBIDDEN` |
| `resignAdmin` | F-17 | 管理者本人 | `LAST_ADMIN` |
| `transferOwnership` | F-17 | オーナー | `FORBIDDEN` |
| `requestParentGroup` | F-05 | 管理者 | `PARENT_CYCLE`, `PARENT_REQUEST_PENDING` |
| `approveParentRequest` / `rejectParentRequest` | F-05 | 親側の管理者 | `PARENT_CYCLE` |
| `listDescendants` | F-05 | 管理者 | `FORBIDDEN` |
| `severBroadcastPath` | F-05 | 管理者 | `FORBIDDEN` |
| `requestCertification` | F-06 | 管理者 | `RATE_LIMITED` |

### 4.3 連絡

| 操作 | 機能 | 認可 | 主なエラー |
|---|---|---|---|
| `createPost` | F-07 | 管理者 | `GROUP_NOT_ACTIVE`, `RATE_LIMITED` |
| `updatePost` / `deletePost` | F-07 | 投稿者本人 | `FORBIDDEN` |
| `getTimeline` | F-08 | — | |
| `getPost` | F-08 | 配信対象者 | `NOT_FOUND` |
| `createComment` | F-09 | メンバー | `GROUP_NOT_ACTIVE` |
| `updateComment` / `deleteComment` | F-09 | 投稿者本人 | `FORBIDDEN` |
| `setReaction` / `removeReaction` | F-10 | 配信対象者 | |
| `listJoiningUsers` | F-10 | 配信対象者 | |

### 4.4 スタンプ

| 操作 | 機能 | 認可 | 主なエラー |
|---|---|---|---|
| `createStamp` | F-11 | 管理者 | `FORBIDDEN` |
| `getStampQr` | F-11 | 管理者 | `FORBIDDEN` |
| `claimStampByQr` | F-12 | — | `STAMP_NOT_IN_PERIOD`, `STAMP_ALREADY_GRANTED` |
| `grantStampByRollCall` | F-12 | 管理者 | `FORBIDDEN` |
| `revokeStampGrant` | F-12 | 管理者 | `FORBIDDEN` |

### 4.5 カードとつながり

| 操作 | 機能 | 認可 | 主なエラー |
|---|---|---|---|
| `updateProfileCard` | F-13 | 本人 | `VALIDATION_FAILED` |
| `rotateCardQrToken` | F-13 | 本人 | |
| `exchangeCard` | F-14 | — | `EXCHANGE_UNAVAILABLE` |
| `releaseConnection` | F-16 | 当事者 | |
| `blockUser` / `unblockUser` | F-16 | 本人 | |
| `getStampCollection` / `getCardCollection` | F-15 | 本人 | |

### 4.6 通知

| 操作 | 機能 | 認可 | 主なエラー |
|---|---|---|---|
| `listNotifications` | F-18 | 本人 | |
| `markNotificationRead` | F-18 | 本人 | |
| `updateNotificationSetting` | F-18 | 本人 | `VALIDATION_FAILED`（N8はOFF不可） |
| `muteGroup` / `unmuteGroup` | F-18 | 本人 | |
| `registerPushSubscription` / `removePushSubscription` | F-18 | 本人 | |

### 4.7 通報と運営

| 操作 | 機能 | 認可 | 主なエラー |
|---|---|---|---|
| `createReport` | F-19 | — | `RATE_LIMITED` |
| `listReports` / `resolveReport` | F-19 | システム管理者 | `FORBIDDEN` |
| `certifyGroup` / `revokeCertification` | F-06 | システム管理者 | `FORBIDDEN` |
| `transferGroupName` | — | システム管理者 | `FORBIDDEN` |
| `restoreDormantGroup` | — | システム管理者 | `FORBIDDEN` |
| `suspendUser` | — | システム管理者 | `FORBIDDEN` |
| `lookupSenderInfo` | — | システム管理者 | `FORBIDDEN` |

---

## 5. 主要操作の詳細

### 5.1 createPost

本アプリで最も重要な操作。**投稿と配信対象の確定を同一トランザクションに収める**（アーキテクチャ 第4.3節）。

**入力**

| 項目 | 型 | 検証 |
|---|---|---|
| `groupId` | UUID | 必須 |
| `body` | string | 必須、1〜2000文字 |
| `scope` | `'self' \| 'descendants'` | 必須。`descendants` は配下を持つグループのみ |
| `eventAt` | ISO 8601 | 任意 |

**処理**

```
1. 入力を検証
2. 認可： can(actor, 'post.create', group) —— 管理者のみ
3. グループの状態を確認。active でなければ GROUP_NOT_ACTIVE
4. scope='descendants' かつ配下が存在しなければ VALIDATION_FAILED
5. トランザクション開始
   5-1. posts に INSERT
   5-2. 配信対象を再帰CTEで決定（DB設計 第5.1節）
   5-3. post_audiences に一括 INSERT
   5-4. 通知（notifications）を配信対象ぶん INSERT
6. コミット
7. トランザクション外でプッシュ送信を起動（第6.1節）
8. 監査ログを記録
```

**出力**：`{ postId, audienceCount }`

`audienceCount` を返すことで、投稿者は「何人に届いたか」を即座に確認できる。これは既読管理を持たない本アプリで、伝達状況を推し量る数少ない手がかりになる。

> **注意：** 手順5-4で通知行を作るため、プッシュが失敗してもアプリ内の通知一覧には残る（基本設計書 第10.1節 原則4）。

### 5.2 claimStampByQr

**入力**：`{ qrToken }`

```
1. qr_token からスタンプを特定。なければ NOT_FOUND
2. 認可： can(actor, 'stamp.claim', stamp) —— 全ユーザー可（決定3）
3. 取得有効期間を確認。範囲外なら STAMP_NOT_IN_PERIOD（期限を含めて返す）
4. stamp_grants に INSERT
   → 主キー制約違反なら STAMP_ALREADY_GRANTED（獲得日時を含めて返す）
5. 通知を作成（N-3）
```

**出力**：`{ stampId, grantedAt, alreadyOwned: boolean }`

**`alreadyOwned` を返して成功扱いにする。** 二度スキャンした利用者にとって、目的（スタンプを持っている状態）は達成されている。失敗として扱うと、不安にさせるだけである。画面では「すでに獲得しています」と獲得日を示す。

### 5.3 exchangeCard

**入力**：`{ qrToken }`

```
1. qr_token からカードの持ち主を特定
2. 次のいずれかに該当する場合、すべて EXCHANGE_UNAVAILABLE を返す
   - 持ち主が存在しない／退会済み／停止中
   - 自分自身のQRである
   - どちらか一方が相手をブロックしている
   - qr_token が失効している
3. connections に INSERT
   - user_a_id < user_b_id となるよう並べ替えてから INSERT（DB設計 第4.14節）
   - 主キー制約違反かつ status='released' なら status='active' に戻す
   - 主キー制約違反かつ status='active' ならそのまま成功
4. 双方に通知を作成（N-4）
```

**出力**：`{ connectionId, counterpartCardId, alreadyConnected: boolean }`

**手順2で理由を区別しない。** ブロックされている場合と相手が存在しない場合を同じ応答にすることで、スキャンの繰り返しによるブロック判定を防ぐ（第3.2節）。

### 5.4 leaveGroup / resignAdmin

**唯一の管理者の離脱を、同時実行に対して正しく防ぐ**（アーキテクチャ 第4.5節）。

```
1. 認可
2. トランザクション開始
   2-1. 対象グループの管理者行を FOR UPDATE でロックして数える
   2-2. 自分が管理者かつ管理者数が1なら → ロールバックし LAST_ADMIN
   2-3. memberships を更新（status='left' または role='member'）
3. コミット
```

**`LAST_ADMIN` を返すとき、画面では後任の指名を促す。** 単に「できません」と伝えるのではなく、次に何をすればよいかを示す。

**オーナーの場合は追加の分岐がある。** オーナーは辞任ではなくオーナー移譲を行う必要があるため、`resignAdmin` は `FORBIDDEN` を返し、`transferOwnership` へ誘導する。

### 5.5 requestParentGroup / approveParentRequest

循環参照を二段構えで防ぐ（アーキテクチャ 第4.2節）。

**requestParentGroup**

```
1. 認可（子側の管理者）
2. parentGroupId が自分自身なら PARENT_CYCLE
3. parentGroupId が自グループの子孫であれば PARENT_CYCLE
   （再帰CTEで自グループの子孫集合を求め、含まれるかを確認）
4. 既に pending の申請があれば PARENT_REQUEST_PENDING
5. group_parent_requests に INSERT（status='pending'）
6. 親側の管理者へ通知（N-6）
```

**approveParentRequest**

```
1. 認可（親側の管理者）
2. 循環の再検査 —— 申請から承認までの間に構造が変わっている可能性がある
   循環するなら PARENT_CYCLE を返し、申請を rejected にする
3. トランザクション
   3-1. group_parent_requests を approved に
   3-2. groups.parent_group_id を設定
4. 祖先グループの管理者へ「配下ツリーに新規追加があった」旨を通知（N-6・決定31）
```

**手順2の再検査が要である。** `A→B` と `B→C` の申請が同時に出ている場合、承認の順序によっては申請時点で循環がなくても承認時点で成立する。

### 5.6 withdrawAccount

退会処理（アーキテクチャ 第5章）。

```
1. 認可（本人）
2. 唯一の管理者であるグループを列挙
   → 退会は妨げない。それらは休眠へ移行させる（決定44）
3. トランザクション
   3-1. users を更新：status='withdrawn'、display_name/email/auth_user_id を NULL
   3-2. profile_cards を物理削除
   3-3. connections をすべて released に
   3-4. memberships をすべて left に
   3-5. 管理者不在となるグループを dormant に
   3-6. push_subscriptions を削除
4. コミット
5. トランザクション外で認証基盤のアカウントを削除（失敗時は再試行キューへ）
```

**`LAST_ADMIN` で退会を拒まない。** 脱退（`leaveGroup`）とは扱いが異なる。退会は利用者の権利であり、グループの都合で妨げてはならない。代わりにグループを休眠へ移し、運営が復旧できる状態にする。

> `users` の `CHECK` 制約により、手順3-1で個人特定情報の消し漏れがあればトランザクションが失敗する（DB設計 第4.1節）。制約が処理の正しさを検査する形になっている。

---

## 6. Route Handlers

外部から呼ばれるため、Server Actions ではなく HTTP エンドポイントとして公開する。

| パス | メソッド | 用途 | 認証 |
|---|---|---|---|
| `/api/push/dispatch` | POST | プッシュ送信の実行 | 内部トークン |
| `/api/cron/archive-groups` | GET | 期限切れグループのアーカイブ | Cron シークレット |
| `/api/cron/detect-dormant` | GET | 管理者不在グループの休眠判定 | Cron シークレット |
| `/api/cron/cleanup-subscriptions` | GET | 失効した購読情報の削除 | Cron シークレット |
| `/sw.js` | GET | Service Worker | なし |
| `/manifest.webmanifest` | GET | PWA マニフェスト | なし |

### 6.1 /api/push/dispatch

連絡の投稿後、トランザクションの外から呼ばれる。

```
1. 内部トークンを検証
2. 送信対象を決定（DB設計 第5.4節の3段階絞り込み）
3. 各購読へ VAPID 署名付きで送信
4. 応答が 404 / 410 の購読は削除
5. その他の失敗は failure_count を加算し、再試行の対象とする
```

**この処理の失敗は、連絡の成立に影響しない**（アーキテクチャ 第6.3節）。

### 6.2 Cron エンドポイント

| 規律 | 内容 |
|---|---|
| 認証 | Vercel Cron が付与するシークレットを検証する。**検証なしで公開しない** |
| 冪等性 | 同じ日に二度実行されても結果が変わらないこと |
| 部分失敗 | 1件の失敗で全体を止めない。処理できたものはコミットし、失敗を記録する |
| 実行記録 | 開始・終了・処理件数・失敗件数をログに残す |

---

## 7. 意思決定履歴

| # | 項目 | 決定 | 日付 | 理由 |
|---|---|---|---|---|
| T-38 | インターフェースの方式 | Server Actions を基本とし、REST／GraphQL を別途設けない | 2026-08-17 | 構成要素を増やさない。型がクライアントとサーバで共有され、境界での食い違いが起きない |
| T-39 | 戻り値 | 例外ではなく `Result` 型で成功と失敗を表す | 2026-08-17 | 失敗の処理漏れが型検査で見つかる |
| T-40 | 認可の徹底 | すべての Server Action が認可モジュールを通る。例外を作らない | 2026-08-17 | 例外を認めると、どれが例外だったか分からなくなる |
| T-41 | 冪等な操作の応答 | 「既に完了している」を失敗ではなく成功として返す | 2026-08-17 | 利用者にとって目的は達成されている。失敗扱いは不安にさせるだけ |
| T-42 | 情報を漏らさないエラー | ブロックと不存在を同一のコード（`EXCHANGE_UNAVAILABLE`）にする | 2026-08-17 | 別のコードを返すと、スキャンの繰り返しでブロックの有無を判定できてしまう |
| T-43 | 存在を隠す | 権限のない非公開資源には `FORBIDDEN` ではなく `NOT_FOUND` を返す | 2026-08-17 | `FORBIDDEN` は「存在すること」を漏らす |
| T-44 | 退会と最後の管理者 | 退会は `LAST_ADMIN` で拒まず、対象グループを休眠へ移す | 2026-08-17 | 退会は利用者の権利であり、グループの都合で妨げてはならない |
| T-45 | 投稿の応答 | 配信対象の人数（`audienceCount`）を返す | 2026-08-17 | 既読管理を持たない本アプリで、伝達状況を推し量る手がかりになる |
| T-46 | レート制限 | 主要な操作に上限を設け、値は設定として外に出す | 2026-08-17 | 運用開始後に見直す前提。コードの変更なしに調整できるようにする |

### 実装時に検証する事項

| # | 項目 | 判断の基準 |
|---|---|---|
| 1 | 認可の網羅 | すべての Server Action が認可モジュールを通っていること（静的検査で担保できるか検討する） |
| 2 | 権限マトリクスの総当たり | 26行×5ロール＝130通りを機械的に検証すること |
| 3 | 同時実行 | 最後の管理者の同時辞任、グループ名の同時作成を並行実行して確認すること |
| 4 | エラーの情報漏洩 | ブロック相手と不存在相手で応答が区別できないこと |
