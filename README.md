# お歳暮訪問ナビ（社内共有版）

管理オーナーへのお歳暮手渡し訪問（2026年12月）の予定・ルート案内・訪問記録を、iPhoneのSafariで行う社内ツール。
空室業務ダッシュボード（housing-lobby-vacancy-dashboard）と同じ仕組み。Claudeは不要。

**使う人に必要なもの**
- 会社のMicrosoftアカウント（ログインに使う）
- Asanaのアカウント（最初に1回「Asanaと連携する」で本人のAsanaとつなぐ。記録は本人の名前でAsanaに残る）
- Asanaプロジェクト「お歳暮訪問（2026年12月）」のメンバーであること

公開URL：https://housing-lobby.github.io/housing-lobby-seibo-navi/

## 構成

```
GitHub Pages（docs/）  ──POST──▶  Google Apps Script（gas/Code.gs）  ──▶  Asana API
 画面・ルート・記録入力            社内ログインの確認・Asanaトークン保管     「お歳暮訪問（2026年12月）」
```

- 画面は会社のMicrosoftアカウント（Entra ID）でログインし、そのトークンをGASに送る。GASはMicrosoft Graph `/me` で本人を確かめ、自社ドメインの社員（ゲスト以外）だけを通す。
- Asanaへは**各担当者本人の権限**で読み書きする（コメントの投稿者＝本人）。最初に1回、画面の「Asanaと連携する」→ Asanaの許可画面 → GASに戻る、で本人の鍵（リフレッシュトークン）をGASが預かる。
- 預かった鍵とAsanaアプリのシークレットは GAS のスクリプトプロパティにだけ置く。画面・リポジトリには置かない。
- 読み書きできるのは「お歳暮訪問（2026年12月）」プロジェクトのタスクだけ（書き込み前に毎回確認）。
- オーナー情報はAsanaにだけあり、このリポジトリ（公開）には含まない。

## Asanaに書き込む内容

| 操作 | Asanaへの反映 |
|---|---|
| 訪問を記録 | コメント「【お歳暮訪問 YYYY/MM/DD】結果／話題／面談内容」（投稿者＝記録した本人）、説明欄に「訪問記録：…｜担当：（本人）」を1行追記、手渡し・置き配はタスク完了＋「訪問完了」へ移動、持ち帰りは次回予定日を期日に |
| 予定に追加・外す | 期日を変更 |
| 完了を取り消す | 未完了に戻して「訪問予定」へ移動、コメント |
| 郵送に切り替える | コメント、「対象外・郵送へ変更」へ移動 |

各担当者がAsanaのアカウントを持っていること、プロジェクトのメンバーであることが前提。

## 運用上の注意

- このリポジトリは公開。オーナーの氏名・住所などの実データは置かない（テストデモも架空の名前と公共施設の住所のみ）。
- Asanaのクライアントシークレットは、チャットやメールに貼らず、GASのスクリプトプロパティに直接入力する。
- 社用iPhoneを交代で使う場合は、使い終わりに右上の名前（ログアウト）を押す。
- お歳暮の時期が終わったら、GASに預かった各自のAsanaの鍵（`U_` で始まるスクリプトプロパティ）を削除する。
- 押してはいけないボタン：GitHub の Settings にある「Delete this repository」「Change visibility」（非公開にすると無料プランではPagesが止まる）。

## セットアップ（初回のみ）

1. **リポジトリ**（済）：会社のGitHub組織 `housing-lobby` に `housing-lobby-seibo-navi` を作成し、Pages（main / `/docs`）を有効化。
   公開URL：`https://housing-lobby.github.io/housing-lobby-seibo-navi/`
   ファイルの更新：リポジトリを開く →「Add file」→「Upload files」→ `docs` と `gas` のフォルダをドラッグ →「Commit changes」（main に直接）。元に戻すときは、更新前のファイルを同じ手順でもう一度アップロードする。
2. **Microsoftログイン**（済）：お歳暮訪問ナビ専用のアプリ登録（クライアントID `c5d4a97e-e6b5-4750-9981-276cc39762f8`、許可は User.Read のみ）。リダイレクトURIは上の公開URL（末尾の「/」まで）。
3. **GAS**（済・会社の管理用Googleアカウント）：`gas/Code.gs` と `gas/appsscript.json` を貼り付け。
4. **デプロイ**：デプロイ → 新しいデプロイ → 種類「ウェブアプリ」、実行ユーザー「自分」、アクセス「全員」。発行URL（…/exec）を控える。
5. **Asanaアプリ登録**：Asana の開発者コンソール（https://app.asana.com/0/my-apps）→「新しいアプリを作成」（名前：お歳暮訪問ナビ）→ OAuth の「リダイレクトURL」に4のURLを追加 → 「クライアントID」と「クライアントシークレット」を控える（シークレットは他人に見せない）。
6. **スクリプトプロパティ**：`ASANA_CLIENT_ID`、`ASANA_CLIENT_SECRET`、`GAS_URL`（4のURL）を設定（任意で `ALLOWED_DOMAINS`）。
7. `docs/config.js` の `apiUrl` に4のURLを書いてGitHubへ反映。
8. **確認**：`<GASのURL>?action=ping` が `{"ok":true}`。公開URLをiPhoneのSafariで開き、会社のMicrosoftアカウントでログイン →「Asanaと連携する」→ Asanaで許可 → アプリを開き直して訪問先が表示されること。テストデモの4件で記録を1回試し、Asanaのコメントの投稿者が本人になっていること。

コードを直したときは GAS の「デプロイを管理」→ 既存デプロイを編集 → 新バージョン（URLを変えない）。

## ファイル

| ファイル | 役割 |
|---|---|
| `docs/index.html` | 画面（見た目） |
| `docs/app.js` | 画面の動き（予定・エリア・検索・訪問記録） |
| `docs/auth.js` | 会社のMicrosoftアカウントでのログイン |
| `docs/config.js` | GASのURL・ログイン設定（秘密情報は書かない） |
| `gas/Code.gs` | 本人確認とAsanaの読み書き |
| `gas/appsscript.json` | GASの設定 |
