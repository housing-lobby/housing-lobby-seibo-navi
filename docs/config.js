// お歳暮訪問ナビの設定（秘密情報は書かない。Asanaのトークンは GAS のスクリプトプロパティにだけ置く）
window.APP_CONFIG = {
  // GAS をウェブアプリとしてデプロイしたときの URL（…/exec）を入れる
  apiUrl: 'https://script.google.com/macros/s/AKfycbyx165P14BsEvEPwCG7GMA8LG0YrfdLHKtqpAPKxVZob3sGASl1e8QmynfaOaW4P4WN/exec',
  auth: {
    // 会社の Microsoft ログイン（Entra ID）。お歳暮訪問ナビ専用のアプリ登録（許可は User.Read のみ）
    clientId: 'c5d4a97e-e6b5-4750-9981-276cc39762f8',
    tenantId: 'f813919f-03b0-413d-a7c1-c2ff70d09433'
  }
};
