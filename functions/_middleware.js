const PASSWORD_HASH = 'ad4941386c090ac54142d38b390d313075deff4d873a1c82e3a25540cf611127';
const COOKIE_NAME = 'poriezki_session';

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function unhex(value) {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function sha256(value) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
}

async function sessionToken() {
  const key = await crypto.subtle.importKey(
    'raw',
    unhex(PASSWORD_HASH),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('poriezki-session-v1')));
}

function cookieValue(request) {
  return request.headers.get('Cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);
}

function loginPage(wrongPassword = false) {
  const error = wrongPassword ? '<p class="error">Неверный пароль</p>' : '';
  return new Response(`<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Вход — Порезки металла</title>
<style>body{font-family:Arial,sans-serif;background:#f3f6f8;margin:0;display:grid;place-items:center;min-height:100vh;color:#102a43}.box{background:#fff;padding:32px;border-radius:14px;box-shadow:0 8px 30px #102a4320;width:min(360px,calc(100% - 48px))}h1{font-size:22px;margin:0 0 8px}p{color:#607d98;margin:0 0 22px}input,button{box-sizing:border-box;width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:8px;font-size:16px}button{margin-top:14px;background:#128574;color:#fff;border:0;font-weight:700;cursor:pointer}.error{color:#b42318;margin:10px 0 0;font-size:14px}</style></head>
<body><form class="box" method="post"><h1>Порезки металла</h1><p>Введите пароль для доступа</p><input type="password" name="password" autocomplete="current-password" autofocus required>${error}<button>Войти</button></form></body></html>`, {
    headers: { 'content-type': 'text/html; charset=UTF-8', 'cache-control': 'no-store' },
  });
}

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  if (request.method === 'POST') {
    const form = await request.formData();
    const submittedHash = hex(await sha256(String(form.get('password') || '')));
    if (submittedHash !== PASSWORD_HASH) return loginPage(true);

    return new Response(null, {
      status: 303,
      headers: {
        Location: url.pathname || '/',
        'Set-Cookie': `${COOKIE_NAME}=${await sessionToken()}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`,
      },
    });
  }

  if (cookieValue(request) !== await sessionToken()) return loginPage();
  return next();
}
