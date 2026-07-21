# [P研] 倉庫スケジュール — 引継ぎドキュメント

## 概要

P研の倉庫利用スケジュールを管理する Web アプリ。
ビルド不要・サーバーレスで動作し、GitHub Pages でホスティングしている。

[サイトページ](https://pken-scheduleweb.github.io/soko/)

---

## ファイル構成

```
リポジトリルート/
├── index.html          # エントリーポイント（React・Firebase・Babel を CDN で読み込む）
├── script.js           # アプリ本体（React + JSX、全ロジック）
├── style.css           # スタイルシート
├── icon.png            # ファビコン・PWA アイコン
└── manifest.json       # PWA マニフェスト
```

---

## 使用技術

| 技術 | 用途 | バージョン |
|------|------|-----------|
| React | UI フレームワーク | 18（CDN UMD） |
| Babel Standalone | JSX をブラウザで変換 | CDN |
| Firebase Realtime Database | データ永続化 | 10.12.2 |
| EmailJS | メール通知送信 | @emailjs/browser v4（CDN） |
| GitHub Pages | ホスティング | — |

> **注意：** Babel Standalone はブラウザ上でトランスパイルするため本番環境では推奨されないが、このプロジェクトはビルド環境不要の方針で採用している。

---

## 共通アカウント

| メールアドレス | パスワード |
|------|------|
| pken.hirosaki.scheduleweb@gmail.com | pken.2026 |

---

## Firebase 設定

- **プロジェクト名：** pken-schedule
- **Realtime Database URL：** `https://pken-schedule-default-rtdb.asia-southeast1.firebasedatabase.app`
- **プロジェクト ID：** pken-schedule

### Database のデータ構造

```
/
├── schedules/          # 予定一覧（配列）
│   └── [{id, name, dateKey, dayIndex, startMin, endMin, pin, color}]
├── adminPassword       # 管理者パスワード（文字列。未設定時はデフォルト値）
├── users/              # ユーザーアカウント
│   └── {uid}: {password, email}
├── userNotifPrefs/     # ユーザー通知設定
│   └── {uid}: {notifyOwn, notifyOthers}
└── notifications/      # 予定追加通知キュー（処理後削除）
```

### Database ルール（推奨設定）

```json
{
  "rules": {
    "schedules":      { ".read": true, ".write": true },
    "adminPassword":  { ".read": true, ".write": true },
    "users":          { ".read": true, ".write": true },
    "userNotifPrefs": { ".read": true, ".write": true },
    "notifications":  { ".read": true, ".write": true },
    "sentReminders":  { ".read": false, ".write": true }
  }
}
```

---

## EmailJS 設定

メール通知に EmailJS を使用している。以下の値が `script.js` の冒頭に直書きされている。

```js
const EMAILJS_SERVICE_ID  = "service_1ycm187";
const EMAILJS_TEMPLATE_ID = "template_t13ebb1";
const EMAILJS_PUBLIC_KEY  = "oSDByclYIPt0J03C6";
```

### EmailJS テンプレートの変数

| 変数名 | 内容 |
|--------|------|
| `{{to_email}}` | 送信先メールアドレス |
| `{{subject}}` | 件名 |
| `{{message}}` | 本文 |

> EmailJS の無料プランは月 200 通まで。アカウントは [emailjs.com](https://www.emailjs.com/) で管理。

---

## 管理者モードについて

### 管理者モードに入る

1. 「管理」ボタンを押す
2. 管理者パスワードを入力する

> 管理者モードに入ると画面が黄色系の配色になります。

### 管理者モードでできること

- 過去・未来の週を自由に閲覧できる（前後4週間＋予定がある週まで）
- 予定の時刻を5分刻みで設定できる
- 他の人の予定をPINなしで削除できる
- 重複する予定を強制的に追加できる
- 予定ブロックを移動・編集できる（右クリック／長押しメニュー）

### 管理者パスワードを変更する

1. 管理者モードで「PW変更」ボタンを押す
2. 現在のパスワード・新しいパスワード・確認を入力する
3. 「変更する」を押す

> 変更したパスワードはサーバーに保存されます。
> 初期パスワードに戻したい場合は「初期パスワードに戻す」ボタンを使います。

### 管理者モードを終了する

「通常モード」ボタンを押すと通常モードに戻ります。

### 管理者パスワード

初期パスワードは XOR エンコードされて `script.js` 内に埋め込まれている。
管理者がサイト上の「PW変更」から変更した場合は Firebase の `adminPassword` に保存され、そちらが優先される。
初期パスワード: `pken.admin.1234`

**パスワードをリセットしたい場合：**
Firebase コンソールの Realtime Database で `adminPassword` の値を削除すると初期パスワードに戻る。

---

## カレンダー仕様

| 項目 | 値 |
|------|-----|
| 週の始まり | 火曜日 |
| 表示時間帯 | 10:00〜20:00 |
| 一般ユーザーの分刻み | 10分（0・10・20・30・40・50） |
| 管理者の分刻み | 5分 |
| 一般ユーザーの表示範囲 | 今週のみ |
| 管理者の表示範囲 | 前後 4週間＋予定がある週まで |
| 予定ブロック色 | 名前ハッシュ → 18色パレット（カスタムカラー指定も可） |

---

## 主要機能と対応する関数

| 機能 | 関数名 |
|------|--------|
| データ読み込み | `load()` |
| 予定追加 | `handleAdd()` |
| 予定削除（PIN確認） | `handleDeleteWithPin()` |
| 管理者ログイン | `handleLogin()` |
| 管理者ログアウト | `handleLogout()` |
| 管理者パスワード変更 | `handlePassChange()` |
| ユーザーログイン | `handleUserLogin()` |
| ユーザー新規登録 | `handleRegister()` |
| ユーザー登録解除 | `handleDeleteAccount()` |
| メール送信 | `sendEmail()` |
| 他ユーザー通知 | `notifyOtherUsers()` |
| 画像保存 | `handleCapture()` |

---

## デプロイ手順

1. ファイルを編集する（`script.js` / `style.css` など）
2. GitHub リポジトリにプッシュする
3. GitHub Pages が自動でデプロイする（通常 1〜2 分）

> GitHub Pages の設定は リポジトリ → Settings → Pages で確認できる。

---

## よくある変更箇所

### 管理者パスワードの初期値を変えたい
`script.js` の `_EP` 配列を変更する。各バイトを `0x5A` で XOR した値を入れる。

### 通知メールの文面を変えたい
EmailJS の管理画面でテンプレートを編集する。変数名（`{{subject}}` 等）は変えないこと。

### カレンダーの時間帯を変えたい
`script.js` の `hourRange` 変数（`Array.from({length:11},(_,i)=>i+10)` の部分）を変更する。

### 予定ブロックの色を変えたい
`script.js` の `PALETTE` 配列を編集する（18色定義）。

---

## 注意事項

- `script.js` に Firebase の API キーと EmailJS のキーが平文で含まれている。GitHub のパブリックリポジトリに置く場合はキーの露出を理解した上で運用すること。
- EmailJS の API キーはフロントエンドから使用するため、悪用されると通知枠を消費される可能性がある。EmailJS のダッシュボードで送信数を定期的に確認することを推奨する。
- Firebase Realtime Database のルールが `".write": true` になっているため、URL を知っていれば誰でも書き込める。セキュリティを強化する場合は Firebase Authentication の導入を検討する。
