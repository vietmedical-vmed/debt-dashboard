// Supabase Edge Function: debt-login
// Pattern chuẩn org (giống ccdc-login, contract-login):
//   - Đọc shared.users, xác thực SHA-256(salt:pw) hoặc SHA-256(pw) nếu không salt.
//     password_hash là nguồn gốc; password_bcrypt / password_hash_v2 chỉ là cache của app khác.
//   - Phát token = base64url(payloadJSON) + "." + base64url(HMAC-SHA256), hạn 8h, ký bằng TOKEN_SECRET.
//   - Đổi mật khẩu: ghi salt mới + password_hash mới, xoá cache của app khác để chúng không nhận mật khẩu cũ.
//
// Deploy:
//   supabase functions deploy debt-login --no-verify-jwt --project-ref nrfxymnfmjhbsgpipvkb

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const enc = new TextEncoder();

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64url(bytes: Uint8Array) {
  const s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}

async function signToken(payload: Record<string, unknown>, secret: string) {
  const p = b64url(enc.encode(JSON.stringify(payload)));
  return `${p}.${b64url(await hmac(secret, p))}`;
}

function randomSalt() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

  const secret = Deno.env.get("TOKEN_SECRET");
  if (!secret) return json({ ok: false, error: "TOKEN_SECRET chua duoc set" }, 500);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad_body" }, 400); }

  const username = String(body?.username ?? "").trim();
  const password = String(body?.password ?? "");
  const newPassword = body?.newPassword;
  if (!username || !password) return json({ ok: false, error: "missing_credentials" }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

  const { data: user, error } = await admin
    .schema("shared").from("users")
    .select("username, password_hash, salt, role, scope, bu, mien, ho_va_ten, active")
    .eq("username", username)
    .maybeSingle();

  if (error || !user || user.active === false) return json({ ok: false, error: "invalid" }, 401);

  const inputHash = await sha256Hex(user.salt ? `${user.salt}:${password}` : password);
  if (!timingSafeEqual(inputHash.toLowerCase(), String(user.password_hash || "").toLowerCase())) {
    return json({ ok: false, error: "invalid" }, 401);
  }

  if (newPassword !== undefined && newPassword !== null && newPassword !== "") {
    const np = String(newPassword);
    if (np.length < 6) return json({ ok: false, error: "weak_password" }, 400);
    if (np === password) return json({ ok: false, error: "same_password" }, 400);
    const salt = randomSalt();
    const { error: upErr } = await admin
      .schema("shared").from("users")
      .update({
        salt,
        password_hash: await sha256Hex(`${salt}:${np}`),
        password_bcrypt: null,      // cache của sale_target-login
        password_hash_v2: null,     // cache của order-login
        updated_at: new Date().toISOString(),
        updated_by: user.username,
      })
      .eq("username", user.username);
    if (upErr) return json({ ok: false, error: "update_failed" }, 500);
    return json({ ok: true, changed: true });
  }

  const session = {
    username: user.username,
    ho_ten: user.ho_va_ten || user.username,
    role: String(user.role || "").toLowerCase(),
    bu: user.bu ?? "",
    mien: user.mien ?? "",
    scope: user.scope ?? "",
    exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60,
  };
  return json({ ok: true, token: await signToken(session, secret), ...session });
});
