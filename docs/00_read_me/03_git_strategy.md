# Git 運用ルール

**最終更新日：2026-08-16**

## 基本方針

- **トランクベース + 短命フィーチャーブランチ**。`main` は常にビルド可能な状態を保つ
- **1フェーズ = 1ブランチ = 1 PR**。小さく刻んで履歴を追いやすくする
- 個人開発でも PR 経由でマージし、変更単位を明確にする

## ブランチ

`main` に直接コミットしない。作業前に必ずブランチを切る。

| プレフィックス | 用途 |
|---|---|
| `feat/<topic>` | 機能追加 |
| `fix/<topic>` | バグ修正 |
| `docs/<topic>` | ドキュメントのみの変更 |
| `chore/<topic>` | 設定・雑務 |
| `refactor/<topic>` | 挙動を変えない整理 |

実装フェーズでは、[実装計画](10_implementation_plan.md)のフェーズとブランチを1対1で対応させる。

## コミット

Conventional Commits 形式、subject は日本語で記述する。

```
<type>(<scope>): <結果がわかる粒度で簡潔に>
```

```
docs(design): 基本設計書を作成
feat(timeline): 統合タイムラインの表示を実装
fix(qr): スタンプQRの有効期限判定を修正
```

type は `feat` / `fix` / `docs` / `chore` / `refactor` / `test` / `style` を使う。

- **1コミット = 1論理変更**。無関係な変更を混ぜない
- `git add -A` の前に `git status` と `git diff` で内容を確認する
- コミット前に、lint・型チェックが通ること、デバッグ残骸がないこと、`.env` 系・鍵・トークンが含まれないことを確認する

## PR とマージ

```bash
git push -u origin <branch>
gh pr create --base main --title "<type>(<scope>): <要約>" --body "<変更内容・検証結果・影響範囲>"
gh pr merge --squash --delete-branch
```

- PR 本文には「**何を・なぜ・どう検証したか**」を書く
- squash マージを基本とする
- マージ後はローカルの `main` を `git pull` で最新化し、次のブランチはそこから切る

## 禁止事項

- 共有ブランチへの `git push --force`（自分だけのブランチでどうしても必要な場合は `--force-with-lease`）
- `git reset --hard`（代替：`git restore <file>` / `git reset --keep`）
- push 済みブランチの履歴書き換え（rebase 含む）
- `.env` 系・鍵・認証情報のコミット

## マイルストーン

フェーズ完了などの節目には注釈付きタグを打つ。

```bash
git tag -a v0.1.0-design -m "基本設計フェーズ完了"
```
