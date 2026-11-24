// Salah Time — push notification worker for Cloudflare (Firebase Cloud Messaging, HTTP v1).
//
// Salah Console calls it with the admin's Firebase login token:
//   POST {idToken, title, body, imageUrl?, data?: {route}, token?}
//     token given -> sends only to that one phone (test)
//     no token    -> sends to every phone (topic "all", which the app joins on start)
//   POST {idToken, action: "check"}  -> tests the service account and FCM, sends nothing
// Answer: {ok: true, id} or {error: "<what went wrong, in plain words>"}
//
// Secret (Cloudflare → Worker → Settings → Variables and Secrets, type Secret):
//   FIREBASE_SERVICE_ACCOUNT (or FIREBASE_SA)   the Firebase service account JSON
//   (the old worker's secret works as it is, nothing new to add)
// Optional plain variables: PROJECT_ID (default salah-time-fe99b), ADMIN_UID (default: the admin)

export default {
  async fetch(req, env) {
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "POST") return json({ error: "POST only" }, 405);
    let b;
    try { b = await req.json(); } catch { return json({ error: "bad json" }, 400); }
    try { await verifyAdmin(b.idToken, env); } catch (e) { return json({ error: "Admin login check failed: " + e.message }, 401); }
    let sa;
    try { sa = JSON.parse(env.FIREBASE_SA || env.FIREBASE_SERVICE_ACCOUNT || ""); } catch { return json({ error: "The service account secret (FIREBASE_SERVICE_ACCOUNT or FIREBASE_SA) is missing or is not valid JSON" }, 500); }
    if (!sa.client_email || !sa.private_key) return json({ error: "FIREBASE_SA has no client_email / private_key" }, 500);
    const pid = sa.project_id || env.PROJECT_ID || "salah-time-fe99b";
    let token;
    try { token = await saToken(sa); } catch (e) { return json({ error: "Service account login failed: " + e.message }, 500); }
    if (b.action === "check") {
      // validate_only: FCM checks everything but sends nothing
      const r = await send(pid, token, { topic: "all", notification: { title: "check", body: "check" } }, true);
      return r.ok ? json({ ok: true, project: pid, account: sa.client_email }) : json({ error: r.error }, 502);
    }
    const title = String(b.title || "").slice(0, 200), body = String(b.body || "").slice(0, 1000);
    if (!title || !body) return json({ error: "title and body are required" }, 400);
    const data = {};
    for (const [k, v] of Object.entries(b.data || {})) data[k] = String(v);
    const image = /^https:\/\//.test(b.imageUrl || "") ? b.imageUrl : undefined;
    const msg = {
      notification: { title, body, ...(image ? { image } : {}) },
      data,
      android: { priority: "HIGH", notification: { channel_id: "general", sound: "default", ...(image ? { image } : {}) } },
      ...(b.token ? { token: String(b.token).trim() } : { topic: "all" }),
    };
    const r = await send(pid, token, msg, false);
    return r.ok ? json({ ok: true, id: r.id, to: b.token ? "one phone" : "all" }) : json({ error: r.error }, 502);
  },
};

async function send(pid, token, message, validateOnly) {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${pid}/messages:send`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ message, validate_only: validateOnly }),
  });
  const d = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, id: d.name };
  const m = d.error?.message || ("HTTP " + res.status);
  let hint = "";
  if (res.status === 403 || /PERMISSION_DENIED/.test(d.error?.status || "")) hint = " (turn on 'Firebase Cloud Messaging API' in Google Cloud for this project, and use this project's service account)";
  if (/UNREGISTERED|not a valid FCM registration token/i.test(m)) hint = " (this phone's token is old: open the app again and copy the new token)";
  return { ok: false, error: m + hint };
}

let saCache = null;
async function saToken(sa) {
  if (saCache && saCache.email === sa.client_email && saCache.exp > Date.now() + 60e3) return saCache.token;
  const now = Math.floor(Date.now() / 1000);
  const enc = o => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const unsigned = enc({ alg: "RS256", typ: "JWT" }) + "." + enc({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  });
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), c => c.charCodeAt(0)), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
  const jwt = unsigned + "." + btoa(String.fromCharCode(...sig)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + jwt,
  });
  const d = await r.json();
  if (!d.access_token) throw new Error(d.error_description || d.error || "no access token");
  saCache = { email: sa.client_email, token: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 };
  return saCache.token;
}

let jwks = null, jwksAt = 0;
async function verifyAdmin(token, env) {
  if (!token) throw new Error("no token");
  const [h, p, s] = token.split(".");
  if (!s) throw new Error("bad token");
  const head = JSON.parse(b64urlText(h)), pay = JSON.parse(b64urlText(p));
  const pid = env.PROJECT_ID || "salah-time-fe99b";
  const now = Math.floor(Date.now() / 1000);
  if (pay.aud !== pid || pay.iss !== "https://securetoken.google.com/" + pid) throw new Error("wrong project");
  if (pay.exp < now || pay.iat > now + 300) throw new Error("expired, log in again");
  if (pay.sub !== (env.ADMIN_UID || "MztAYiBJTFSATatZKbbrOAtwncy1")) throw new Error("not the admin (check ADMIN_UID in the worker)");
  if (!jwks || Date.now() - jwksAt > 3600e3) {
    const r = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
    jwks = (await r.json()).keys; jwksAt = Date.now();
  }
  const jwk = jwks.find(k => k.kid === head.kid);
  if (!jwk) throw new Error("unknown key");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  if (!await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(s), new TextEncoder().encode(h + "." + p))) throw new Error("bad signature");
}
function b64urlBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
function b64urlText(s) { return new TextDecoder().decode(b64urlBytes(s)); }
