(() => {
  'use strict';
  // 社内アカウント（Microsoft Entra ID）でのログイン。空室業務ダッシュボードの auth.js と同じ考え方。
  // 画面は公開だが、GAS がログインしていない相手を断るので、データは社員にしか見えない。
  // クライアントID・テナントIDは秘密情報ではない（ブラウザで動くアプリでは画面に書く前提）。
  const cfg = (window.APP_CONFIG || {}).auth;
  if (!cfg || !window.msal) { window.Auth = null; return; }
  const base = new URL('./', location.href).href;   // このページのフォルダ（Entra に登録するリダイレクトURI）
  const client = new window.msal.PublicClientApplication({
    auth: {
      clientId: cfg.clientId,
      authority: `https://login.microsoftonline.com/${cfg.tenantId}`,
      redirectUri: base,
      navigateToLoginRequestUrl: true
    },
    cache: {cacheLocation: 'localStorage'}            // iPhoneのホーム画面から開き直してもログインを保つ
  });
  const request = {scopes: ['User.Read']};
  const fail = (code, message) => { const e = new Error(message); e.code = code; return e; };
  let account = null;

  const ready = (async () => {
    await client.initialize();
    const result = await client.handleRedirectPromise().catch(err => { console.warn(err); return null; });
    account = result?.account || client.getActiveAccount() || client.getAllAccounts()[0] || null;
    if (!account) {
      await client.loginRedirect({...request, redirectStartPage: location.href});
      return new Promise(() => {}); // ログイン画面へ移動する
    }
    client.setActiveAccount(account);
    return account;
  })();

  // GAS を呼ぶたびに新しいトークンを取る
  const token = async () => {
    await ready;
    try {
      return (await client.acquireTokenSilent({...request, account})).accessToken;
    } catch (err) {
      const code = String(err?.errorCode || err?.message || '');
      if (/network|post_request_failed|no_network|timed_out/i.test(code)) throw fail('network', '通信できません');
      await client.acquireTokenRedirect({...request, account, redirectStartPage: location.href});
      return new Promise(() => {});
    }
  };
  const signOut = () => client.logoutRedirect({account, postLogoutRedirectUri: base});

  window.Auth = {ready, token, signOut, get account() { return account; }};
})();
