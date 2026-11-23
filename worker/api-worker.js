// Salah Time Public API — Cloudflare Worker.
//
// Other developers get a key from us (request form on the website, the admin
// approves it in Salah Console) and use the same data the Salah Time app uses:
// prayer times, Ramadan sehri/iftar, Hijri date, Qibla and the app's content.
//
// Public:
//   GET  /v1/status                      no key
//   POST /v1/request                     key request from the website form (no key)
//   GET  /v1/me                          your key: name, scopes, today's use
//   GET  /v1/prayer-times                scope: prayer
//   GET  /v1/prayer-times/month          scope: prayer
//   GET  /v1/hijri                       scope: calendar
//   GET  /v1/qibla                       scope: qibla
//   GET  /v1/districts                   scope: ramadan
//   GET  /v1/ramadan                     scope: ramadan
//   GET  /v1/duas | /v1/names99 | /v1/hadith | /v1/articles    scope: content
// Admin (Salah Console, with the admin's Firebase login):
//   POST /admin  {idToken, action: list | approve | reject | create | update | revoke | delete | usage, ...}
//
// Bindings (Cloudflare → Worker → Settings):
//   DB          a D1 database (tables are created by the worker itself)
//   PROJECT_ID  = salah-time-fe99b         ADMIN_UID = <admin uid>
// No secrets are needed: keys are stored only as SHA-256 hashes.

const DISTRICTS = [{"id":"dhaka","bn":"ঢাকা","en":"Dhaka","division":"ঢাকা","lat":23.8103,"lng":90.4125},{"id":"gazipur","bn":"গাজীপুর","en":"Gazipur","division":"ঢাকা","lat":23.9999,"lng":90.4203},{"id":"narayanganj","bn":"নারায়ণগঞ্জ","en":"Narayanganj","division":"ঢাকা","lat":23.6238,"lng":90.5},{"id":"narsingdi","bn":"নরসিংদী","en":"Narsingdi","division":"ঢাকা","lat":23.9322,"lng":90.7151},{"id":"manikganj","bn":"মানিকগঞ্জ","en":"Manikganj","division":"ঢাকা","lat":23.8617,"lng":90.0003},{"id":"munshiganj","bn":"মুন্সীগঞ্জ","en":"Munshiganj","division":"ঢাকা","lat":23.5422,"lng":90.5305},{"id":"tangail","bn":"টাঙ্গাইল","en":"Tangail","division":"ঢাকা","lat":24.2513,"lng":89.9167},{"id":"kishoreganj","bn":"কিশোরগঞ্জ","en":"Kishoreganj","division":"ঢাকা","lat":24.4449,"lng":90.7766},{"id":"faridpur","bn":"ফরিদপুর","en":"Faridpur","division":"ঢাকা","lat":23.607,"lng":89.8429},{"id":"gopalganj","bn":"গোপালগঞ্জ","en":"Gopalganj","division":"ঢাকা","lat":23.005,"lng":89.8266},{"id":"madaripur","bn":"মাদারীপুর","en":"Madaripur","division":"ঢাকা","lat":23.1641,"lng":90.1897},{"id":"rajbari","bn":"রাজবাড়ী","en":"Rajbari","division":"ঢাকা","lat":23.7574,"lng":89.6445},{"id":"shariatpur","bn":"শরীয়তপুর","en":"Shariatpur","division":"ঢাকা","lat":23.2423,"lng":90.4348},{"id":"chattogram","bn":"চট্টগ্রাম","en":"Chattogram","division":"চট্টগ্রাম","lat":22.3569,"lng":91.7832},{"id":"coxs-bazar","bn":"কক্সবাজার","en":"Cox's Bazar","division":"চট্টগ্রাম","lat":21.4272,"lng":92.0058},{"id":"cumilla","bn":"কুমিল্লা","en":"Cumilla","division":"চট্টগ্রাম","lat":23.4607,"lng":91.1809},{"id":"feni","bn":"ফেনী","en":"Feni","division":"চট্টগ্রাম","lat":23.0159,"lng":91.3976},{"id":"noakhali","bn":"নোয়াখালী","en":"Noakhali","division":"চট্টগ্রাম","lat":22.8696,"lng":91.0995},{"id":"lakshmipur","bn":"লক্ষ্মীপুর","en":"Lakshmipur","division":"চট্টগ্রাম","lat":22.9425,"lng":90.8412},{"id":"chandpur","bn":"চাঁদপুর","en":"Chandpur","division":"চট্টগ্রাম","lat":23.2333,"lng":90.6713},{"id":"brahmanbaria","bn":"ব্রাহ্মণবাড়িয়া","en":"Brahmanbaria","division":"চট্টগ্রাম","lat":23.9571,"lng":91.1119},{"id":"rangamati","bn":"রাঙ্গামাটি","en":"Rangamati","division":"চট্টগ্রাম","lat":22.6574,"lng":92.1739},{"id":"khagrachhari","bn":"খাগড়াছড়ি","en":"Khagrachhari","division":"চট্টগ্রাম","lat":23.1193,"lng":91.9847},{"id":"bandarban","bn":"বান্দরবান","en":"Bandarban","division":"চট্টগ্রাম","lat":22.1953,"lng":92.2184},{"id":"rajshahi","bn":"রাজশাহী","en":"Rajshahi","division":"রাজশাহী","lat":24.3745,"lng":88.6042},{"id":"natore","bn":"নাটোর","en":"Natore","division":"রাজশাহী","lat":24.4206,"lng":89.0003},{"id":"naogaon","bn":"নওগাঁ","en":"Naogaon","division":"রাজশাহী","lat":24.7936,"lng":88.9318},{"id":"chapainawabganj","bn":"চাঁপাইনবাবগঞ্জ","en":"Chapainawabganj","division":"রাজশাহী","lat":24.5965,"lng":88.2776},{"id":"bogura","bn":"বগুড়া","en":"Bogura","division":"রাজশাহী","lat":24.8466,"lng":89.3773},{"id":"joypurhat","bn":"জয়পুরহাট","en":"Joypurhat","division":"রাজশাহী","lat":25.0968,"lng":89.0227},{"id":"pabna","bn":"পাবনা","en":"Pabna","division":"রাজশাহী","lat":24.0064,"lng":89.2372},{"id":"sirajganj","bn":"সিরাজগঞ্জ","en":"Sirajganj","division":"রাজশাহী","lat":24.4534,"lng":89.7007},{"id":"khulna","bn":"খুলনা","en":"Khulna","division":"খুলনা","lat":22.8456,"lng":89.5403},{"id":"jashore","bn":"যশোর","en":"Jashore","division":"খুলনা","lat":23.1664,"lng":89.2081},{"id":"satkhira","bn":"সাতক্ষীরা","en":"Satkhira","division":"খুলনা","lat":22.7185,"lng":89.0705},{"id":"bagerhat","bn":"বাগেরহাট","en":"Bagerhat","division":"খুলনা","lat":22.6516,"lng":89.7859},{"id":"narail","bn":"নড়াইল","en":"Narail","division":"খুলনা","lat":23.1725,"lng":89.5127},{"id":"magura","bn":"মাগুরা","en":"Magura","division":"খুলনা","lat":23.4855,"lng":89.4198},{"id":"jhenaidah","bn":"ঝিনাইদহ","en":"Jhenaidah","division":"খুলনা","lat":23.545,"lng":89.1726},{"id":"kushtia","bn":"কুষ্টিয়া","en":"Kushtia","division":"খুলনা","lat":23.9013,"lng":89.1205},{"id":"chuadanga","bn":"চুয়াডাঙ্গা","en":"Chuadanga","division":"খুলনা","lat":23.6402,"lng":88.8418},{"id":"meherpur","bn":"মেহেরপুর","en":"Meherpur","division":"খুলনা","lat":23.7622,"lng":88.6318},{"id":"barishal","bn":"বরিশাল","en":"Barishal","division":"বরিশাল","lat":22.701,"lng":90.3535},{"id":"patuakhali","bn":"পটুয়াখালী","en":"Patuakhali","division":"বরিশাল","lat":22.3596,"lng":90.3299},{"id":"bhola","bn":"ভোলা","en":"Bhola","division":"বরিশাল","lat":22.6859,"lng":90.6482},{"id":"pirojpur","bn":"পিরোজপুর","en":"Pirojpur","division":"বরিশাল","lat":22.5791,"lng":89.9759},{"id":"barguna","bn":"বরগুনা","en":"Barguna","division":"বরিশাল","lat":22.15,"lng":90.126},{"id":"jhalokati","bn":"ঝালকাঠি","en":"Jhalokati","division":"বরিশাল","lat":22.6406,"lng":90.1987},{"id":"sylhet","bn":"সিলেট","en":"Sylhet","division":"সিলেট","lat":24.8949,"lng":91.8687},{"id":"moulvibazar","bn":"মৌলভীবাজার","en":"Moulvibazar","division":"সিলেট","lat":24.4829,"lng":91.7774},{"id":"habiganj","bn":"হবিগঞ্জ","en":"Habiganj","division":"সিলেট","lat":24.3745,"lng":91.4155},{"id":"sunamganj","bn":"সুনামগঞ্জ","en":"Sunamganj","division":"সিলেট","lat":25.0658,"lng":91.395},{"id":"rangpur","bn":"রংপুর","en":"Rangpur","division":"রংপুর","lat":25.7439,"lng":89.2752},{"id":"dinajpur","bn":"দিনাজপুর","en":"Dinajpur","division":"রংপুর","lat":25.6217,"lng":88.6355},{"id":"thakurgaon","bn":"ঠাকুরগাঁও","en":"Thakurgaon","division":"রংপুর","lat":26.0337,"lng":88.4617},{"id":"panchagarh","bn":"পঞ্চগড়","en":"Panchagarh","division":"রংপুর","lat":26.3411,"lng":88.5542},{"id":"nilphamari","bn":"নীলফামারী","en":"Nilphamari","division":"রংপুর","lat":25.931,"lng":88.856},{"id":"lalmonirhat","bn":"লালমনিরহাট","en":"Lalmonirhat","division":"রংপুর","lat":25.9923,"lng":89.2847},{"id":"kurigram","bn":"কুড়িগ্রাম","en":"Kurigram","division":"রংপুর","lat":25.8072,"lng":89.6295},{"id":"gaibandha","bn":"গাইবান্ধা","en":"Gaibandha","division":"রংপুর","lat":25.3288,"lng":89.5281},{"id":"mymensingh","bn":"ময়মনসিংহ","en":"Mymensingh","division":"ময়মনসিংহ","lat":24.7471,"lng":90.4203},{"id":"jamalpur","bn":"জামালপুর","en":"Jamalpur","division":"ময়মনসিংহ","lat":24.9375,"lng":89.9378},{"id":"sherpur","bn":"শেরপুর","en":"Sherpur","division":"ময়মনসিংহ","lat":25.0205,"lng":90.0153},{"id":"netrokona","bn":"নেত্রকোনা","en":"Netrokona","division":"ময়মনসিংহ","lat":24.8709,"lng":90.7279}];

const SCOPES = ["prayer", "ramadan", "calendar", "qibla", "content"];
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key, Authorization",
  "Access-Control-Expose-Headers": "X-RateLimit-Limit, X-RateLimit-Remaining",
};

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export default {
  async fetch(req, env, ctx) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    let extra = {};
    try {
      await schema(env);
      if (path === "/" || path === "/v1" || path === "/v1/status") {
        return json({ ok: true, name: "Salah Time API", version: "1", docs: "https://salahtime-rho.vercel.app/api.html", time: new Date().toISOString() });
      }
      if (path === "/v1/request" && req.method === "POST") return json(await keyRequest(req, env));
      if (path === "/admin" && req.method === "POST") return json(await admin(req, env));
      if (req.method !== "GET") throw new ApiError(405, "method_not_allowed", "Use GET");

      const route = ROUTES[path];
      if (!route && path !== "/v1/me") throw new ApiError(404, "not_found", "Unknown endpoint. See the docs.");
      const k = await checkKey(req, env, url, route ? route.scope : null);
      extra = { "X-RateLimit-Limit": String(k.daily_limit), "X-RateLimit-Remaining": String(Math.max(0, k.daily_limit - k.used - 1)) };
      ctx.waitUntil(count(env, k.id));
      if (path === "/v1/me") {
        return json({ name: k.name, app: k.app, scopes: k.scopes.split(","), daily_limit: k.daily_limit, used_today: k.used + 1, created: k.created }, 200, extra);
      }
      return json(await route.fn(url.searchParams, env, ctx), 200, extra);
    } catch (e) {
      const st = e instanceof ApiError ? e.status : 500;
      return json({ error: { code: e.code || "server_error", message: e.message || String(e) } }, st, extra);
    }
  },
};

function json(o, status = 200, h = {}) {
  return new Response(JSON.stringify(o), { status, headers: { ...CORS, ...h, "Content-Type": "application/json; charset=utf-8" } });
}

// ---------------------------------------------------------------- storage (D1)
let ready = false;
async function schema(env) {
  if (ready) return;
  if (!env.DB) throw new ApiError(500, "no_database", "The D1 database is not bound to the worker (binding name: DB)");
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS keys (id TEXT PRIMARY KEY, hash TEXT UNIQUE, prefix TEXT, name TEXT, email TEXT, app TEXT,
      scopes TEXT, daily_limit INTEGER, origins TEXT, active INTEGER DEFAULT 1, note TEXT, created TEXT, last_used TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS usage (key_id TEXT, day TEXT, n INTEGER, PRIMARY KEY (key_id, day))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, name TEXT, email TEXT, org TEXT, app TEXT, platform TEXT,
      purpose TEXT, website TEXT, users TEXT, scopes TEXT, status TEXT, ip TEXT, created TEXT, key_id TEXT)`),
  ]);
  ready = true;
}

const today = () => new Date().toISOString().slice(0, 10);
const rid = (n = 16) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, "0")).join("");
async function sha(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function checkKey(req, env, url, scope) {
  const key = (req.headers.get("X-API-Key") || url.searchParams.get("key") || (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")).trim();
  if (!key) throw new ApiError(401, "missing_key", "Send your API key in the X-API-Key header");
  const k = await env.DB.prepare("SELECT k.*, COALESCE(u.n, 0) AS used FROM keys k LEFT JOIN usage u ON u.key_id = k.id AND u.day = ? WHERE k.hash = ?")
    .bind(today(), await sha(key)).first();
  if (!k) throw new ApiError(401, "invalid_key", "This API key is not valid");
  if (!k.active) throw new ApiError(403, "key_disabled", "This API key has been turned off. Contact us.");
  if (scope && !k.scopes.split(",").includes(scope)) throw new ApiError(403, "scope_denied", `This key has no access to "${scope}". Ask us to add it.`);
  if (k.used >= k.daily_limit) throw new ApiError(429, "rate_limited", `Daily limit of ${k.daily_limit} requests reached. It resets at 00:00 UTC.`);
  if (k.origins) {
    const o = req.headers.get("Origin");
    if (o && !k.origins.split(",").map(s => s.trim()).includes(o)) throw new ApiError(403, "origin_denied", "This key is not allowed from this website");
  }
  return k;
}

async function count(env, id) {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO usage (key_id, day, n) VALUES (?, ?, 1) ON CONFLICT(key_id, day) DO UPDATE SET n = n + 1").bind(id, today()),
    env.DB.prepare("UPDATE keys SET last_used = ? WHERE id = ?").bind(new Date().toISOString(), id),
  ]);
}

// ---------------------------------------------------------------- key requests from the website
async function keyRequest(req, env) {
  let b;
  try { b = await req.json(); } catch { throw new ApiError(400, "bad_json", "Bad request"); }
  if (b.hp) return { ok: true }; // bot trap
  const s = (v, n) => String(v || "").trim().slice(0, n);
  const r = { name: s(b.name, 80), email: s(b.email, 120), org: s(b.org, 100), app: s(b.app, 100), platform: s(b.platform, 40), purpose: s(b.purpose, 1500), website: s(b.website, 200), users: s(b.users, 40) };
  if (!r.name || !r.app || r.purpose.length < 20 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)) throw new ApiError(400, "invalid", "Name, a valid email, app name and a purpose (at least 20 letters) are required");
  if (!b.agree) throw new ApiError(400, "terms", "Please accept the terms");
  const scopes = (Array.isArray(b.scopes) ? b.scopes : []).filter(x => SCOPES.includes(x));
  const ip = req.headers.get("CF-Connecting-IP") || "";
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM requests WHERE (ip = ? OR email = ?) AND created > ?")
    .bind(ip, r.email, new Date(Date.now() - 864e5).toISOString()).first();
  if (recent && recent.n >= 3) throw new ApiError(429, "too_many", "Too many requests today. Please wait for our reply.");
  await env.DB.prepare("INSERT INTO requests (id, name, email, org, app, platform, purpose, website, users, scopes, status, ip, created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(rid(8), r.name, r.email, r.org, r.app, r.platform, r.purpose, r.website, r.users, scopes.join(","), "new", ip, new Date().toISOString()).run();
  return { ok: true, message: "Request received. We will email you after review." };
}

// ---------------------------------------------------------------- admin
async function admin(req, env) {
  let b;
  try { b = await req.json(); } catch { throw new ApiError(400, "bad_json", "Bad request"); }
  try { await verifyAdmin(b.idToken, env); } catch (e) { throw new ApiError(401, "not_admin", "not allowed: " + e.message); }
  const now = new Date().toISOString();
  const cleanScopes = v => (Array.isArray(v) ? v : String(v || "").split(",")).map(x => String(x).trim()).filter(x => SCOPES.includes(x)).join(",");
  const newKey = async (o) => {
    const key = "st_live_" + rid(16);
    const id = rid(6);
    await env.DB.prepare("INSERT INTO keys (id, hash, prefix, name, email, app, scopes, daily_limit, origins, active, note, created) VALUES (?,?,?,?,?,?,?,?,?,1,?,?)")
      .bind(id, await sha(key), key.slice(0, 14), o.name || "", o.email || "", o.app || "", cleanScopes(o.scopes) || "prayer", Math.max(1, parseInt(o.daily_limit) || 5000), String(o.origins || "").trim(), o.note || "", now).run();
    return { id, key };
  };
  switch (b.action) {
    case "list": {
      const keys = (await env.DB.prepare("SELECT k.id, k.prefix, k.name, k.email, k.app, k.scopes, k.daily_limit, k.origins, k.active, k.note, k.created, k.last_used, COALESCE(u.n,0) AS today FROM keys k LEFT JOIN usage u ON u.key_id = k.id AND u.day = ? ORDER BY k.created DESC").bind(today()).all()).results;
      const requests = (await env.DB.prepare("SELECT * FROM requests ORDER BY created DESC LIMIT 200").all()).results;
      return { keys, requests, scopes: SCOPES };
    }
    case "create": return await newKey(b);
    case "approve": {
      const r = await env.DB.prepare("SELECT * FROM requests WHERE id = ?").bind(b.id).first();
      if (!r) throw new ApiError(404, "not_found", "Request not found");
      const out = await newKey({ name: r.name, email: r.email, app: r.app, scopes: b.scopes || r.scopes, daily_limit: b.daily_limit, origins: b.origins, note: b.note });
      await env.DB.prepare("UPDATE requests SET status = 'approved', key_id = ? WHERE id = ?").bind(out.id, r.id).run();
      return { ...out, email: r.email, name: r.name };
    }
    case "reject":
      await env.DB.prepare("UPDATE requests SET status = 'rejected' WHERE id = ?").bind(b.id).run();
      return { ok: true };
    case "delete_request":
      await env.DB.prepare("DELETE FROM requests WHERE id = ?").bind(b.id).run();
      return { ok: true };
    case "update":
      await env.DB.prepare("UPDATE keys SET scopes = ?, daily_limit = ?, origins = ?, active = ?, note = ? WHERE id = ?")
        .bind(cleanScopes(b.scopes), Math.max(1, parseInt(b.daily_limit) || 5000), String(b.origins || "").trim(), b.active ? 1 : 0, String(b.note || ""), b.id).run();
      return { ok: true };
    case "revoke":
      await env.DB.prepare("DELETE FROM keys WHERE id = ?").bind(b.id).run();
      await env.DB.prepare("DELETE FROM usage WHERE key_id = ?").bind(b.id).run();
      return { ok: true };
    case "usage": {
      const rows = (await env.DB.prepare("SELECT day, n FROM usage WHERE key_id = ? ORDER BY day DESC LIMIT 30").bind(b.id).all()).results;
      return { usage: rows };
    }
    default: throw new ApiError(400, "unknown_action", "unknown action");
  }
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
  if (pay.exp < now || pay.iat > now + 300) throw new Error("expired");
  if (!env.ADMIN_UID || pay.sub !== env.ADMIN_UID) throw new Error("not the admin");
  if (!jwks || Date.now() - jwksAt > 3600e3) {
    const r = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
    jwks = (await r.json()).keys; jwksAt = Date.now();
  }
  const jwk = jwks.find(k => k.kid === head.kid);
  if (!jwk) throw new Error("unknown key");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(s), new TextEncoder().encode(h + "." + p));
  if (!ok) throw new Error("bad signature");
}
function b64urlBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
function b64urlText(s) { return new TextDecoder().decode(b64urlBytes(s)); }

// ---------------------------------------------------------------- parameters
function num(q, k, lo, hi, def) {
  const v = q.get(k);
  if (v === null || v === "") {
    if (def !== undefined) return def;
    throw new ApiError(400, "missing_param", `"${k}" is required`);
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) throw new ApiError(400, "bad_param", `"${k}" must be a number from ${lo} to ${hi}`);
  return n;
}
function tzOf(q) {
  const tz = q.get("tz") || "Asia/Dhaka";
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); } catch { throw new ApiError(400, "bad_param", `Unknown time zone "${tz}"`); }
  return tz;
}
function ymdIn(tz, d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d).map(x => [x.type, x.value]));
  return [+p.year, +p.month, +p.day];
}
function dateParam(q, tz) {
  const v = q.get("date");
  if (!v) return ymdIn(tz);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) throw new ApiError(400, "bad_param", `"date" must look like 2027-02-18`);
  return [+m[1], +m[2], +m[3]];
}
function placeParam(q) {
  const d = q.get("district");
  if (d) {
    const x = DISTRICTS.find(z => z.id === d.toLowerCase() || z.en.toLowerCase() === d.toLowerCase() || z.bn === d);
    if (!x) throw new ApiError(400, "bad_param", `Unknown district "${d}". See /v1/districts`);
    return { lat: x.lat, lng: x.lng, district: x };
  }
  return { lat: num(q, "lat", -90, 90), lng: num(q, "lng", -180, 180) };
}

// ---------------------------------------------------------------- prayer times
// Standard astronomical method (the same one the app uses: University of Islamic
// Sciences, Karachi + Hanafi Asr by default).
const METHODS = {
  karachi: { name: "University of Islamic Sciences, Karachi", fajr: 18, isha: 18 },
  mwl: { name: "Muslim World League", fajr: 18, isha: 17 },
  isna: { name: "Islamic Society of North America", fajr: 15, isha: 15 },
  egypt: { name: "Egyptian General Authority of Survey", fajr: 19.5, isha: 17.5 },
  makkah: { name: "Umm al-Qura, Makkah", fajr: 18.5, ishaMin: 90 },
};
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
const fix = (a, b) => { a = a - b * Math.floor(a / b); return a < 0 ? a + b : a; };
function julian(y, m, d) {
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100), B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
}
function sun(jd) {
  const D = jd - 2451545.0;
  const g = fix(357.529 + 0.98560028 * D, 360), q = fix(280.459 + 0.98564736 * D, 360);
  const L = fix(q + 1.915 * Math.sin(rad(g)) + 0.020 * Math.sin(rad(2 * g)), 360);
  const e = 23.439 - 0.00000036 * D;
  const RA = deg(Math.atan2(Math.cos(rad(e)) * Math.sin(rad(L)), Math.cos(rad(L)))) / 15;
  return { decl: deg(Math.asin(Math.sin(rad(e)) * Math.sin(rad(L)))), eqt: q / 15 - fix(RA, 24) };
}
function calcDay(y, m, d, lat, lng, method, madhab) {
  const M = METHODS[method];
  const jd = julian(y, m, d) - lng / (15 * 24);
  const mid = t => fix(12 - sun(jd + t).eqt, 24);
  const angleTime = (a, t, ccw) => {
    const s = sun(jd + t);
    const x = (-Math.sin(rad(a)) - Math.sin(rad(s.decl)) * Math.sin(rad(lat))) / (Math.cos(rad(s.decl)) * Math.cos(rad(lat)));
    if (x < -1 || x > 1) return NaN;
    const tt = deg(Math.acos(x)) / 15;
    return mid(t) + (ccw ? -tt : tt);
  };
  const asr = (f, t) => {
    const s = sun(jd + t);
    const a = -deg(Math.atan(1 / (f + Math.tan(rad(Math.abs(lat - s.decl))))));
    return angleTime(a, t);
  };
  let t = { fajr: 5, sunrise: 6, dhuhr: 12, asr: 13, sunset: 18, isha: 18 };
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v / 24]));
    t = {
      fajr: angleTime(M.fajr, p.fajr, true),
      sunrise: angleTime(0.833, p.sunrise, true),
      dhuhr: mid(p.dhuhr),
      asr: asr(madhab === "hanafi" ? 2 : 1, p.asr),
      sunset: angleTime(0.833, p.sunset),
      isha: M.ishaMin ? NaN : angleTime(M.isha, p.isha),
    };
  }
  if (M.ishaMin) t.isha = t.sunset + M.ishaMin / 60;
  const base = Date.UTC(y, m - 1, d);
  const at = h => Number.isFinite(h) ? new Date(base + Math.round((h - lng / 15) * 60) * 60000) : null;
  return { fajr: at(t.fajr), sunrise: at(t.sunrise), dhuhr: at(t.dhuhr + 1 / 60), asr: at(t.asr), maghrib: at(t.sunset), isha: at(t.isha) };
}
function fmt(d, tz) {
  if (!d) return null;
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return { time: hm, iso: d.toISOString() };
}
function methodParams(q) {
  const method = (q.get("method") || "karachi").toLowerCase();
  if (!METHODS[method]) throw new ApiError(400, "bad_param", `"method" must be one of ${Object.keys(METHODS).join(", ")}`);
  const madhab = (q.get("madhab") || "hanafi").toLowerCase();
  if (!["hanafi", "shafi"].includes(madhab)) throw new ApiError(400, "bad_param", `"madhab" must be hanafi or shafi`);
  return { method, madhab };
}
function dayOut(y, m, d, pl, tz, mp) {
  const r = calcDay(y, m, d, pl.lat, pl.lng, mp.method, mp.madhab);
  const out = { date: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, hijri: hijri(new Date(Date.UTC(y, m - 1, d, 12)), 0) };
  for (const k of ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"]) out[k] = fmt(r[k], tz);
  return out;
}

async function prayerTimes(q) {
  const tz = tzOf(q), pl = placeParam(q), mp = methodParams(q);
  const [y, m, d] = dateParam(q, tz);
  return { location: { lat: pl.lat, lng: pl.lng, district: pl.district ? pl.district.en : undefined, timezone: tz }, method: METHODS[mp.method].name, madhab: mp.madhab, ...dayOut(y, m, d, pl, tz, mp) };
}
async function prayerMonth(q) {
  const tz = tzOf(q), pl = placeParam(q), mp = methodParams(q);
  const [cy, cm] = ymdIn(tz);
  const y = num(q, "year", 1900, 2200, cy), m = num(q, "month", 1, 12, cm);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { location: { lat: pl.lat, lng: pl.lng, district: pl.district ? pl.district.en : undefined, timezone: tz }, method: METHODS[mp.method].name, madhab: mp.madhab, year: y, month: m, days: Array.from({ length: n }, (_, i) => dayOut(y, m, i + 1, pl, tz, mp)) };
}

// ---------------------------------------------------------------- Hijri, Qibla, Ramadan
const HM_BN = ["মুহাররম", "সফর", "রবিউল আউয়াল", "রবিউস সানি", "জমাদিউল আউয়াল", "জমাদিউস সানি", "রজব", "শাবান", "রমজান", "শাওয়াল", "জিলকদ", "জিলহজ"];
const HM_EN = ["Muharram", "Safar", "Rabi al-Awwal", "Rabi al-Thani", "Jumada al-Ula", "Jumada al-Akhirah", "Rajab", "Shaban", "Ramadan", "Shawwal", "Dhu al-Qadah", "Dhu al-Hijjah"];
function hijri(date, adjust) {
  const d = new Date(date.getTime() + adjust * 864e5);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", { timeZone: "UTC", day: "numeric", month: "numeric", year: "numeric" }).formatToParts(d).map(x => [x.type, x.value]));
  const y = parseInt(p.year), m = parseInt(p.month), dd = parseInt(p.day);
  return { day: dd, month: m, year: y, month_bn: HM_BN[m - 1], month_en: HM_EN[m - 1] };
}
async function hijriRoute(q) {
  const tz = tzOf(q);
  const [y, m, d] = dateParam(q, tz);
  const adjust = num(q, "adjust", -2, 2, 0);
  return { date: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, adjust, calendar: "Umm al-Qura", ...hijri(new Date(Date.UTC(y, m - 1, d, 12)), adjust),
    note: "Bangladesh often starts months one day after Saudi Arabia. Use adjust=-1 for the Bangladesh moon sighting." };
}
async function qibla(q) {
  const lat = num(q, "lat", -90, 90), lng = num(q, "lng", -180, 180);
  const kLat = rad(21.4225), kLng = rad(39.8262), la = rad(lat), dl = kLng - rad(lng);
  const b = fix(deg(Math.atan2(Math.sin(dl), Math.cos(la) * Math.tan(kLat) - Math.sin(la) * Math.cos(dl))), 360);
  const dist = 6371 * Math.acos(Math.min(1, Math.sin(la) * Math.sin(kLat) + Math.cos(la) * Math.cos(kLat) * Math.cos(dl)));
  return { lat, lng, bearing: Math.round(b * 100) / 100, distance_km: Math.round(dist), kaaba: { lat: 21.4225, lng: 39.8262 } };
}
async function districts() {
  return { count: DISTRICTS.length, districts: DISTRICTS };
}
async function ramadan(q) {
  const tz = q.get("tz") ? tzOf(q) : "Asia/Dhaka";
  const pl = placeParam(q), mp = methodParams(q);
  const year = num(q, "year", 2000, 2100, ymdIn(tz)[0]);
  const adjust = num(q, "adjust", -2, 2, -1);
  const days = [];
  for (let t = Date.UTC(year, 0, 1, 12); t < Date.UTC(year + 1, 0, 1); t += 864e5) {
    const h = hijri(new Date(t), adjust);
    if (h.month !== 9) continue;
    const dt = new Date(t);
    const r = calcDay(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), pl.lat, pl.lng, mp.method, mp.madhab);
    days.push({ roza: h.day, date: dt.toISOString().slice(0, 10), sehri_ends: fmt(r.fajr, tz), iftar: fmt(r.maghrib, tz) });
  }
  return { location: { lat: pl.lat, lng: pl.lng, district: pl.district ? pl.district.en : undefined, timezone: tz }, year, hijri_adjust: adjust, method: METHODS[mp.method].name,
    note: "Sehri ends at Fajr and iftar is at Maghrib. Many people stop eating a few minutes earlier as a precaution. Final dates depend on the moon sighting.", days };
}

// ---------------------------------------------------------------- app content (Firestore, public collections)
function fsVal(v) {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fsVal);
  if ("mapValue" in v) return fsObj(v.mapValue.fields || {});
  return null;
}
function fsObj(f) { return Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fsVal(v)])); }
const HIDE = new Set(["active", "createdBy", "uid", "updatedBy", "order"]);
async function collection(env, ctx, name) {
  const pid = env.PROJECT_ID || "salah-time-fe99b";
  const u = `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/${name}?pageSize=300`;
  const cache = caches.default, ck = new Request(u);
  let r = await cache.match(ck);
  if (!r) {
    const f = await fetch(u);
    if (!f.ok) throw new ApiError(502, "upstream", "Content is not available right now");
    r = new Response(await f.text(), { headers: { "Content-Type": "application/json", "Cache-Control": "max-age=1800" } });
    ctx.waitUntil(cache.put(ck, r.clone()));
  }
  const d = await r.json();
  return (d.documents || []).map(doc => ({ id: doc.name.split("/").pop(), ...fsObj(doc.fields || {}) }))
    .filter(x => x.active !== false)
    .map(x => Object.fromEntries(Object.entries(x).filter(([k]) => !HIDE.has(k))));
}
const content = name => async (q, env, ctx) => {
  let items = await collection(env, ctx, name);
  const s = (q.get("q") || "").trim().toLowerCase();
  if (s) items = items.filter(x => JSON.stringify(x).toLowerCase().includes(s));
  const limit = num(q, "limit", 1, 300, 100), offset = num(q, "offset", 0, 100000, 0);
  return { total: items.length, offset, limit, items: items.slice(offset, offset + limit), source: "Salah Time", attribution: "Content from the Salah Time app. Please credit Salah Time." };
};

const ROUTES = {
  "/v1/prayer-times": { scope: "prayer", fn: prayerTimes },
  "/v1/prayer-times/month": { scope: "prayer", fn: prayerMonth },
  "/v1/hijri": { scope: "calendar", fn: hijriRoute },
  "/v1/qibla": { scope: "qibla", fn: qibla },
  "/v1/districts": { scope: "ramadan", fn: districts },
  "/v1/ramadan": { scope: "ramadan", fn: ramadan },
  "/v1/duas": { scope: "content", fn: content("duas") },
  "/v1/names99": { scope: "content", fn: content("names99") },
  "/v1/hadith": { scope: "content", fn: content("daily_hadith") },
  "/v1/articles": { scope: "content", fn: content("articles") },
};

// exported for the local test only
export const _test = { calcDay, hijri, qibla, ramadan, prayerTimes, fmt };
