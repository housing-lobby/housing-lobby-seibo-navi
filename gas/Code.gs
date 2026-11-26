/**
 * お歳暮訪問ナビ — GAS（画面と Asana の間に立つ小さなサーバー）
 *
 * 構成：GitHub Pages（docs/）──POST──▶ この GAS ──▶ Asana API
 *   - 画面は会社の Microsoft アカウントでログインし、そのトークンを本文に入れて送る
 *   - GAS は Microsoft Graph /me で本人を確かめ、自社ドメインの社員（ゲスト以外）だけを通す
 *   - Asana へは「各担当者本人」の権限で読み書きする（コメントの投稿者が本人の名前になる）
 *     最初に1回、画面の「Asanaと連携する」→ Asana の許可画面 → このGASに戻る、で本人の鍵（リフレッシュトークン）を預かる
 *   - 預かった鍵・アプリのシークレットはスクリプトプロパティにだけ置く（画面・リポジトリには置かない）
 *   - 読み書きできるのは「お歳暮訪問（2026年12月）」プロジェクトのタスクだけ
 *
 * スクリプトプロパティ
 *   ASANA_CLIENT_ID      Asana の開発者コンソールで登録したアプリのクライアントID（必須）
 *   ASANA_CLIENT_SECRET  同じアプリのクライアントシークレット（必須・他人に見せない）
 *   GAS_URL              このGASのウェブアプリURL（…/exec）。Asanaアプリの「リダイレクトURL」にも同じものを登録する（必須）
 *   ALLOWED_DOMAINS      ログインを許可するメールのドメイン（カンマ区切り。既定：hmao034998.onmicrosoft.com,h-lobby.jp）
 *   TENANT_ID            会社の Entra ID のテナントID（必須。トークンが自社テナント発行かを確認する）
 *   ENTRA_CLIENT_ID      お歳暮訪問ナビ用のアプリ登録のクライアントID（必須。このアプリで取ったトークンだけを通す）
 *   EMAIL_MAP            Microsoftのアカウント→Asanaのメールの対応表（JSON。例：{"a.honda@hmao034998.onmicrosoft.com":"honda@h-lobby.jp"}）。
 *                        表にある人は表のとおりでないと連携できない。表にない人は「@より前が同じ」ことを確認する
 *   U_xxxx               各担当者の預かり鍵（自動で作られる。消すとその人は連携し直し）
 */

// Asana に求める権限（アプリ登録で選んだスコープと同じにする。本人の確認用の openid email profile を含む）
const ASANA_SCOPE = 'openid email profile projects:read tasks:read tasks:write stories:write';

const CFG = {
  project: '1220513535996204',            // お歳暮訪問（2026年12月）
  sections: {
    plan: '1220513679683403',             // 訪問予定
    done: '1220513687722729',             // 訪問完了
    out:  '1220513747916156',             // 対象外・郵送へ変更
    test: '1220513686788740'              // テストデモ
  },
  completedSince: '2026-11-01T00:00:00Z',
  listFields: 'name,notes,completed,due_on,permalink_url,assignee.name,assignee.gid,memberships.section.name,memberships.section.gid,memberships.project.gid'
};

// Asana のメールが、ログイン中の社員のものかを確かめる
function asanaEmailOk_(userEmail, asanaEmail) {
  const u = String(userEmail || '').toLowerCase(), a = String(asanaEmail || '').toLowerCase();
  if (!u || !a) return false;
  let map = {};
  try { map = JSON.parse(prop_('EMAIL_MAP') || '{}'); } catch (e) { map = {}; }
  const mapped = String(map[u] || '').toLowerCase();
  if (mapped) return a === mapped;               // 対応表にある人は、表のとおりでなければ通さない
  return a.split('@')[0] === u.split('@')[0];    // 表にない人は、@より前が同じなら通す
}

// トークンの中身（Graph が 200 を返した＝本物と確認済みなので、署名の再確認はしない）
function claims_(t) {
  try {
    const p = String(t).split('.')[1];
    return JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(p + '='.repeat((4 - p.length % 4) % 4))).getDataAsString());
  } catch (e) { return null; }
}
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function fail_(code, message) { const e = new Error(message || code); e.code = code; return e; }

/* ---------- 本人確認（空室業務ダッシュボードと同じ方法） ---------- */
function verifyUser_(token) {
  if (!token || typeof token !== 'string' || token.length < 100) return null;
  const cache = CacheService.getScriptCache();
  const key = 'auth_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)).slice(0, 40);
  const hit = cache.get(key);
  if (hit) return hit === 'NG' ? null : JSON.parse(hit);
  let res;
  try {
    res = UrlFetchApp.fetch('https://graph.microsoft.com/v1.0/me?$select=displayName,userPrincipalName,mail,userType',
      {headers: {Authorization: 'Bearer ' + token}, muteHttpExceptions: true});
  } catch (e) { throw fail_('server', '本人確認に失敗しました（通信エラー）'); }
  const code = res.getResponseCode();
  if (code === 401) { cache.put(key, 'NG', 60); return null; }
  if (code !== 200) throw fail_('server', '本人確認が一時的に失敗しました（Microsoft ' + code + '）');
  const c = claims_(token);
  if (!c || !prop_('TENANT_ID') || !prop_('ENTRA_CLIENT_ID') ||
      c.tid !== prop_('TENANT_ID') || (c.appid || c.azp) !== prop_('ENTRA_CLIENT_ID')) { cache.put(key, 'NG', 300); return null; }
  const me = JSON.parse(res.getContentText());
  const upn = String(me.userPrincipalName || '').toLowerCase();
  const domains = String(prop_('ALLOWED_DOMAINS') || 'hmao034998.onmicrosoft.com,h-lobby.jp')
    .split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
  const ok = me.userType !== 'Guest' && upn.indexOf('#ext#') < 0 && domains.some(d => upn.endsWith('@' + d));
  if (!ok) { cache.put(key, 'NG', 300); return null; }
  const user = {name: me.displayName || upn, email: upn};
  cache.put(key, JSON.stringify(user), 600);
  return user;
}

/* ---------- Asana の連携（本人の鍵を預かる） ---------- */
function userKey_(email) {
  return 'U_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(email).toLowerCase())).slice(0, 32);
}
function oauthToken_(params) {
  const id = prop_('ASANA_CLIENT_ID'), secret = prop_('ASANA_CLIENT_SECRET'), url = prop_('GAS_URL');
  if (!id || !secret || !url) throw fail_('not_configured', 'Asana連携の設定（ASANA_CLIENT_ID / ASANA_CLIENT_SECRET / GAS_URL）が未設定です');
  params.client_id = id; params.client_secret = secret; params.redirect_uri = url;
  let res;
  try { res = UrlFetchApp.fetch('https://app.asana.com/-/oauth_token', {method: 'post', payload: params, muteHttpExceptions: true}); }
  catch (e) { throw fail_('server', 'Asana に接続できません'); }
  const code = res.getResponseCode();
  if (code >= 500 || code === 429) throw fail_('server', 'Asana が一時的に応答しません（' + code + '）');
  if (code !== 200) return null;   // 鍵が無効（取り消された等）
  return JSON.parse(res.getContentText());
}
// その人の Asana 用アクセストークン（1時間有効）。切れていれば預かった鍵で取り直す
function userToken_(user) {
  const key = userKey_(user.email);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const raw = prop_(key);
    if (!raw) throw fail_('link_required', 'Asanaとの連携が必要です');
    const t = JSON.parse(raw);
    if (t.access && t.exp > Date.now() + 60000) return t.access;
    const r = oauthToken_({grant_type: 'refresh_token', refresh_token: t.refresh});
    if (!r || !r.access_token) {
      PropertiesService.getScriptProperties().deleteProperty(key);
      throw fail_('link_required', 'Asanaとの連携が切れました。もう一度連携してください');
    }
    t.access = r.access_token; t.exp = Date.now() + (r.expires_in || 3600) * 1000;
    if (r.refresh_token) t.refresh = r.refresh_token;
    PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(t));
    return t.access;
  } finally { lock.releaseLock(); }
}
// 連携の開始：画面（ログイン済み）から呼ぶ。Asana の許可画面のURLを返す
function linkStart_(user) {
  const id = prop_('ASANA_CLIENT_ID'), url = prop_('GAS_URL');
  if (!id || !url) throw fail_('not_configured', 'Asana連携の設定が未設定です');
  const nonce = Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('link_' + nonce, JSON.stringify(user), 900);   // 15分以内に許可してもらう
  return 'https://app.asana.com/-/oauth_authorize?response_type=code' +
    '&client_id=' + encodeURIComponent(id) + '&redirect_uri=' + encodeURIComponent(url) + '&state=' + nonce +
    '&scope=' + encodeURIComponent(ASANA_SCOPE);
}
// Asana の許可画面から戻ってきたとき（doGet）
function linkFinish_(code, state) {
  const cache = CacheService.getScriptCache();
  const raw = cache.get('link_' + String(state || '').replace(/[^\w]/g, ''));
  if (!raw) return '連携の受付時間が過ぎました。アプリに戻って、もう一度「Asanaと連携する」を押してください。';
  const user = JSON.parse(raw);
  const r = oauthToken_({grant_type: 'authorization_code', code: code});
  if (!r || !r.refresh_token) return 'Asanaとの連携に失敗しました。アプリに戻って、もう一度お試しください。';
  // 連携URLを他人に開かせて、その人の Asana を自分に紐づけるのを防ぐ（対応表 EMAIL_MAP、なければ @ より前で照合）
  const asanaEmail = String((r.data && r.data.email) || '').toLowerCase();
  if (!asanaEmailOk_(user.email, asanaEmail)) {
    cache.remove('link_' + state);
    return 'Asanaのアカウント（' + asanaEmail + '）が、ログイン中の社員と一致しません。ご自分のAsanaで連携してください。それでも通らないときは、IT担当にお知らせください。';
  }
  const asanaName = (r.data && r.data.name) || '';
  PropertiesService.getScriptProperties().setProperty(userKey_(user.email), JSON.stringify({
    refresh: r.refresh_token, access: r.access_token, exp: Date.now() + (r.expires_in || 3600) * 1000,
    name: user.name, asana: asanaName, at: new Date().toISOString()
  }));
  cache.remove('link_' + state);
  return 'Asanaとの連携が終わりました（Asana：' + asanaName + '）。この画面を閉じて、お歳暮訪問ナビに戻ってください。';
}

/* ---------- Asana ---------- */
let TOKEN = null;   // このリクエストで使う本人のトークン
function asana_(method, path, data) {
  const token = TOKEN;
  if (!token) throw fail_('link_required', 'Asanaとの連携が必要です');
  const opt = {method: method, headers: {Authorization: 'Bearer ' + token}, muteHttpExceptions: true};
  if (data !== undefined) { opt.contentType = 'application/json'; opt.payload = JSON.stringify({data: data}); }
  let res;
  try { res = UrlFetchApp.fetch('https://app.asana.com/api/1.0' + path, opt); }
  catch (e) { throw fail_('server', 'Asana に接続できません'); }
  const code = res.getResponseCode();
  const body = res.getContentText() ? JSON.parse(res.getContentText()) : {};
  if (code === 401) throw fail_('link_required', 'Asanaとの連携が切れました。もう一度連携してください');
  if (code === 429 || code >= 500) throw fail_('server', 'Asana が一時的に応答しません（' + code + '）');
  if (code >= 400) {
    const msg = (body.errors || []).map(x => x.message).join(' / ') || ('Asana エラー ' + code);
    throw fail_('asana', msg);
  }
  return body;
}

function listTasks_() {
  const out = [];
  let offset = null, guard = 0;
  do {
    let path = '/projects/' + CFG.project + '/tasks?limit=100&completed_since=' + encodeURIComponent(CFG.completedSince) +
      '&opt_fields=' + encodeURIComponent(CFG.listFields);
    if (offset) path += '&offset=' + encodeURIComponent(offset);
    const r = asana_('get', path);
    (r.data || []).forEach(t => out.push(t));
    offset = r.next_page && r.next_page.offset ? r.next_page.offset : null;
  } while (offset && ++guard < 20);
  return out;
}

// 書き込み前に、そのタスクが本当にお歳暮訪問プロジェクトのものか確かめる（最新の説明欄も受け取る）
function getOwnTask_(gid) {
  if (!/^\d{6,20}$/.test(String(gid || ''))) throw fail_('bad_request', 'タスクの指定が正しくありません');
  const t = asana_('get', '/tasks/' + gid + '?opt_fields=notes,completed,memberships.project.gid').data;
  const own = (t.memberships || []).some(m => m.project && m.project.gid === CFG.project);
  if (!own) throw fail_('forbidden', 'このタスクは対象外です');
  return t;
}
function comment_(gid, text) { asana_('post', '/tasks/' + gid + '/stories', {text: String(text).slice(0, 8000)}); }
function moveTo_(gid, section) { asana_('post', '/tasks/' + gid + '/addProject', {project: CFG.project, section: section}); }
function isDate_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }

/* ---------- 画面からの依頼 ---------- */
function handle_(req, user) {
  // 連携の確認・開始は、本人のAsana鍵がなくても受け付ける
  if (req.action === 'ping') return {user: user, linked: !!prop_(userKey_(user.email))};
  if (req.action === 'linkStart') return {url: linkStart_(user)};
  TOKEN = userToken_(user);   // ここから先は本人の権限でAsanaを読み書きする（コメントの投稿者＝本人）
  switch (req.action) {

    case 'list':
      return {user: user, tasks: listTasks_(), at: Date.now()};

    case 'record': {   // 訪問の記録：コメント → 説明欄に1行追記 → （完了・期日）
      const t = getOwnTask_(req.gid);
      const rid = String(req.rid || '').replace(/[^\w-]/g, '').slice(0, 24);
      const cache = CacheService.getScriptCache();
      if (rid && cache.get('rid_' + rid)) return {notes: t.notes, duplicate: true};   // 二重送信
      const line = String(req.line || '').replace(/[\r\n]+/g, ' ').slice(0, 500);
      if (!/^訪問記録：\d{4}-\d{2}-\d{2} /.test(line)) throw fail_('bad_request', '記録の形式が正しくありません');
      comment_(t.gid, String(req.comment || ''));
      const notes = String(t.notes || '').replace(/\s+$/, '') + '\n' + line;
      const upd = {notes: notes};
      if (req.due && isDate_(req.due)) upd.due_on = req.due;
      if (req.complete) upd.completed = true;
      asana_('put', '/tasks/' + t.gid, upd);
      if (req.complete) moveTo_(t.gid, CFG.sections.done);
      if (rid) cache.put('rid_' + rid, '1', 21600);
      return {notes: notes};
    }

    case 'plan': {     // 予定日の変更（null で予定から外す）
      const t = getOwnTask_(req.gid);
      if (req.due !== null && !isDate_(req.due)) throw fail_('bad_request', '日付が正しくありません');
      asana_('put', '/tasks/' + t.gid, {due_on: req.due});
      return {};
    }

    case 'reopen': {   // 完了の取り消し
      const t = getOwnTask_(req.gid);
      asana_('put', '/tasks/' + t.gid, {completed: false});
      moveTo_(t.gid, req.test ? CFG.sections.test : CFG.sections.plan);
      comment_(t.gid, '【お歳暮】完了を取り消しました');
      return {};
    }

    case 'mail': {     // 郵送に切り替え（訪問の対象から外す）
      const t = getOwnTask_(req.gid);
      comment_(t.gid, String(req.comment || '【お歳暮】郵送に切り替え'));
      moveTo_(t.gid, CFG.sections.out);
      return {};
    }

    default:
      throw fail_('bad_request', '不明な操作です');
  }
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const user = verifyUser_(req.token);
    if (!user) return json_({ok: false, code: 'auth', error: '社内アカウントでログインしてください'});
    const out = handle_(req, user);
    return json_(Object.assign({ok: true}, out));
  } catch (err) {
    return json_({ok: false, code: err.code || 'unknown', error: String(err.message || err)});
  }
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === 'ping') return json_({ok: true});
  // Asana の許可画面から戻ってきたところ
  if (p.code || p.error) {
    let msg;
    try { msg = p.error ? 'Asanaでの許可が取り消されました。アプリに戻って、もう一度お試しください。' : linkFinish_(p.code, p.state); }
    catch (err) { msg = '連携中にエラーが起きました：' + (err.message || err); }
    const html = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<div style="font:16px/1.7 -apple-system,sans-serif;max-width:520px;margin:48px auto;padding:0 20px">' +
      '<h1 style="font-size:20px">お歳暮訪問ナビ</h1><p></p></div>';
    const out = HtmlService.createHtmlOutput(html.replace('<p></p>', '<p>' + String(msg).replace(/[<>&]/g, '') + '</p>'));
    return out.setTitle('お歳暮訪問ナビ').addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  return json_({ok: false, code: 'bad_request', error: 'POST で呼び出してください'});
}
