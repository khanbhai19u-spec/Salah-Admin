// Salah Time — "ইন্টারনেট থেকে আনুন" (import from the internet) worker for Cloudflare.
//
// The admin panel calls it with the admin's Firebase login token. Nothing is
// written by AI: it only finds pages and reads their own title, picture and
// text, so what goes into the app is the original.
//
//   POST {idToken, action: "search", q, type: "web" | "news" | "video"}
//   POST {idToken, action: "preview", url}
//   POST {idToken, action: "run"}          -> runs the hourly job now
//   cron (every hour)                       -> today's ayah + hadith go live,
//                                              news from the feeds waits in "inbox"
//
// Secrets (Cloudflare → Worker → Settings → Variables and Secrets), none of them in code:
//   GOOGLE_API_KEY   free Google API key (YouTube Data API v3 and, if you have it, Custom Search)
//   GOOGLE_CX        optional: Programmable Search Engine id, for web search
//   FIREBASE_SA      the Firebase service account JSON (for the hourly job to write to Firestore)
// Plain variables:
//   PROJECT_ID = salah-time-fe99b      ADMIN_UID = <admin uid>

const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36";

export default {
  async fetch(req, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
    if (req.method !== "POST") return json({ error: "POST only" }, 405);
    let body;
    try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
    try {
      await verifyAdmin(body.idToken, env);
    } catch (e) {
      return json({ error: "not allowed: " + e.message }, 401);
    }
    try {
      if (body.action === "search") return json({ items: await search(String(body.q || "").trim(), body.type || "web", env) });
      if (body.action === "preview") return json(await preview(String(body.url || "").trim()));
      if (body.action === "run") return json(await hourly(env));
      return json({ error: "unknown action" }, 400);
    } catch (e) {
      return json({ error: e.message || String(e) }, 500);
    }
  },
  async scheduled(_ev, env, ctx) {
    ctx.waitUntil(hourly(env).catch(() => {}));
  },
};

// ---------------------------------------------------------------- admin check
// Verifies the Firebase ID token (RS256) with Google's public keys.
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
  if (env.ADMIN_UID && pay.sub !== env.ADMIN_UID) throw new Error("not the admin");
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

// ---------------------------------------------------------------- search
async function search(q, type, env) {
  if (!q) return [];
  if (type === "video") {
    if (!env.GOOGLE_API_KEY) throw new Error("GOOGLE_API_KEY is not set in the worker");
    const u = "https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=15&safeSearch=strict&relevanceLanguage=bn&q=" + encodeURIComponent(q) + "&key=" + env.GOOGLE_API_KEY;
    const d = await (await fetch(u)).json();
    if (d.error) throw new Error(d.error.message);
    return (d.items || []).map(i => ({
      title: decode(i.snippet.title), link: "https://www.youtube.com/watch?v=" + i.id.videoId, snippet: decode(i.snippet.description),
      image: i.snippet.thumbnails?.high?.url || i.snippet.thumbnails?.default?.url || "", source: i.snippet.channelTitle, kind: "video",
      date: i.snippet.publishedAt,
    }));
  }
  if (type === "news" || (type === "web" && !(env.GOOGLE_API_KEY && env.GOOGLE_CX))) {
    // Google News search feed: free, no key
    const items = await rss("https://news.google.com/rss/search?q=" + encodeURIComponent(q) + "&hl=bn&gl=BD&ceid=BD:bn");
    if (type === "news") return items.slice(0, 20);
    // web without Custom Search: Bangla Wikipedia + news
    const w = await wiki(q);
    return [...w, ...items.slice(0, 12)];
  }
  const u = "https://www.googleapis.com/customsearch/v1?num=10&safe=active&q=" + encodeURIComponent(q) + "&key=" + env.GOOGLE_API_KEY + "&cx=" + env.GOOGLE_CX;
  const d = await (await fetch(u)).json();
  if (d.error) throw new Error(d.error.message);
  return (d.items || []).map(i => ({
    title: i.title, link: i.link, snippet: i.snippet || "", source: i.displayLink || host(i.link), kind: "web",
    image: i.pagemap?.cse_image?.[0]?.src || i.pagemap?.metatags?.[0]?.["og:image"] || "",
  }));
}

async function wiki(q) {
  try {
    const u = "https://bn.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=6&origin=*&srsearch=" + encodeURIComponent(q);
    const d = await (await fetch(u, { headers: { "User-Agent": "SalahTimeAdmin/1.0" } })).json();
    return (d.query?.search || []).map(i => ({
      title: i.title, link: "https://bn.wikipedia.org/wiki/" + encodeURIComponent(i.title.replace(/ /g, "_")),
      snippet: decode(i.snippet.replace(/<[^>]+>/g, "")), source: "bn.wikipedia.org", image: "", kind: "web",
    }));
  } catch { return []; }
}

async function rss(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error("feed " + r.status);
  const x = await r.text();
  const out = [];
  for (const m of x.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/g)) {
    const it = m[0];
    const tag = t => { const mm = it.match(new RegExp("<" + t + "[^>]*>([\\s\\S]*?)</" + t + ">")); return mm ? decode(decode(cdata(mm[1])).replace(/<[^>]+>/g, " ")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : ""; };
    let link = tag("link");
    if (!link) { const lm = it.match(/<link[^>]*href="([^"]+)"/); link = lm ? lm[1] : ""; }
    const img = (it.match(/<media:content[^>]*url="([^"]+)"/) || it.match(/<enclosure[^>]*url="([^"]+)"/) || it.match(/<img[^>]*src="([^"]+)"/) || [])[1] || "";
    const src = tag("source") || host(link);
    let title = tag("title");
    if (src && title.endsWith(" - " + src)) title = title.slice(0, -(src.length + 3));
    out.push({ title, link, snippet: tag("description").slice(0, 300), image: img, source: src, date: tag("pubDate") || tag("updated") || tag("published"), kind: "news" });
  }
  return out;
}

// ---------------------------------------------------------------- link preview
// Reads the page's own og tags and its first paragraphs (nothing rewritten).
async function preview(url) {
  if (!/^https?:\/\//.test(url)) url = "https://" + url;
  const u = new URL(url);
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(u.hostname)) throw new Error("not allowed");
  const r = await fetch(u.toString(), { headers: { "User-Agent": UA, "Accept-Language": "bn,en;q=0.8" }, redirect: "follow" });
  const html = (await r.text()).slice(0, 1_500_000);
  const meta = (k) => {
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=["']([^"']*)["']`, "i");
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${k}["']`, "i");
    const m = html.match(re1) || html.match(re2);
    return m ? decode(m[1]).trim() : "";
  };
  const title = meta("og:title") || meta("twitter:title") || decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").trim();
  const desc = meta("og:description") || meta("description") || meta("twitter:description");
  let image = meta("og:image") || meta("twitter:image");
  if (image && !/^https?:/.test(image)) { try { image = new URL(image, r.url || u.toString()).toString(); } catch { image = ""; } }
  // first real paragraphs of the article body
  const scope = (html.match(/<article[\s\S]*?<\/article>/i) || [html])[0];
  const paras = [];
  for (const m of scope.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const t = decode(m[1].replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (t.length > 40 && !/cookie|subscribe|javascript|©/i.test(t)) paras.push(t);
    if (paras.join("\n\n").length > 4000 || paras.length >= 14) break;
  }
  const yt = u.hostname.includes("youtube.com") || u.hostname === "youtu.be";
  return {
    url: r.url || u.toString(), title, desc, image,
    site: meta("og:site_name") || host(r.url || u.toString()),
    text: paras.join("\n\n"), kind: yt ? "video" : "web",
    published: meta("article:published_time") || "",
  };
}

// ---------------------------------------------------------------- hourly job
// - today's hadith (Bangla, from the public hadith-api on jsDelivr) -> daily_hadith/<date>, live
// - today's ayah (Bangla, from api.alquran.cloud) -> cards/auto_ayah on the home page, live
// - news from config/import.feeds (RSS links) -> inbox (waits for the admin)
async function hourly(env) {
  if (!env.FIREBASE_SA) throw new Error("FIREBASE_SA is not set in the worker");
  const fs = await firestore(env);
  const cfg = (await fs.get("config/import")) || {};
  const today = dhaka();
  const done = [];

  if (cfg.autoHadith !== false) {
    const have = await fs.get("daily_hadith/" + today.key);
    if (!have) {
      const h = await pickHadith(today.n);
      if (h) {
        await fs.set("daily_hadith/" + today.key, { date: today.key, text: h.text, source: h.source, no: h.no, active: true, auto: true, link: h.link });
        done.push("hadith");
      }
    }
  }
  if (cfg.autoAyah !== false) {
    const card = await fs.get("cards/auto_ayah");
    if (!card || card.day !== today.key) {
      const a = await pickAyah(today.n);
      if (a) {
        await fs.set("cards/auto_ayah", {
          title: "আজকের আয়াত", body: a.text + "\n— " + a.ref, buttonText: "পুরো সূরা পড়ুন", route: "quran:" + a.surah,
          places: cfg.ayahPlaces || ["home_top"], order: 0, active: true, auto: true, day: today.key,
          startAt: { t: today.start }, endAt: { t: today.end },
        });
        done.push("ayah");
      }
    }
  }
  let added = 0;
  for (const f of (cfg.feeds || []).slice(0, 12)) {
    let items = [];
    try { items = await rss(f); } catch { continue; }
    for (const it of items.slice(0, 8)) {
      if (!it.link || !it.title) continue;
      const id = "n_" + (await sha1(it.link)).slice(0, 20);
      if (await fs.get("inbox/" + id)) continue;
      await fs.set("inbox/" + id, { ...it, status: "pending", kind: "news", feed: f, foundAt: { t: Date.now() } });
      added++;
    }
  }
  if (added) done.push(added + " news");
  await fs.set("config/import_status", { lastRun: { t: Date.now() }, done: done.join(", ") || "nothing new" });
  return { ok: true, done };
}

function dhaka() {
  const ms = Date.now() + 6 * 3600e3; // Bangladesh time
  const d = new Date(ms);
  const key = d.toISOString().slice(0, 10);
  const start = Date.parse(key + "T00:00:00+06:00");
  return { key, n: Math.floor(ms / 86400e3), start, end: start + 86400e3 - 1 };
}

const HADITH_BOOKS = [["bukhari", "সহীহ বুখারী", 7563], ["muslim", "সহীহ মুসলিম", 7470], ["tirmidhi", "জামে আত-তিরমিযী", 3956], ["abudawud", "সুনানে আবু দাউদ", 5274]];
async function pickHadith(n) {
  for (let tries = 0; tries < 6; tries++) {
    const [key, name, max] = HADITH_BOOKS[(n + tries) % HADITH_BOOKS.length];
    const no = 1 + ((n * 7919 + tries * 104729) % max);
    try {
      const r = await fetch(`https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/ben-${key}/${no}.json`);
      if (!r.ok) continue;
      const d = await r.json();
      const h = d.hadiths?.[0];
      const text = (h?.text || "").trim();
      const grades = (h?.grades || []).map(g => String(g.grade || "").toLowerCase());
      if (text.length < 40 || text.length > 900) continue;
      if (key !== "bukhari" && key !== "muslim" && !grades.some(g => g.includes("sahih"))) continue;
      return { text, source: name, no, link: `https://sunnah.com/${key}:${no}` };
    } catch {}
  }
  return null;
}

async function pickAyah(n) {
  const num = 1 + ((n * 2654435761) >>> 0) % 6236;
  try {
    const d = await (await fetch(`https://api.alquran.cloud/v1/ayah/${num}/bn.bengali`)).json();
    const a = d.data;
    if (!a?.text) return null;
    return { text: a.text.trim(), ref: `সূরা ${a.surah.englishName} ${a.surah.number}:${a.numberInSurah}`, surah: a.surah.number };
  } catch { return null; }
}

// ---------------------------------------------------------------- Firestore (REST + service account)
async function firestore(env) {
  const sa = JSON.parse(env.FIREBASE_SA);
  const pid = env.PROJECT_ID || sa.project_id;
  const token = await saToken(sa);
  const base = `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/`;
  const hdr = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  return {
    async get(path) {
      const r = await fetch(base + path, { headers: hdr });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("firestore get " + r.status);
      return fromFs((await r.json()).fields || {});
    },
    async set(path, obj) {
      const r = await fetch(base + path, { method: "PATCH", headers: hdr, body: JSON.stringify({ fields: toFs(obj) }) });
      if (!r.ok) throw new Error("firestore set " + r.status + " " + (await r.text()).slice(0, 200));
    },
  };
}
// {t: ms} becomes a Timestamp
function toVal(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toVal) } };
  if (typeof v === "object" && Object.keys(v).length === 1 && typeof v.t === "number") return { timestampValue: new Date(v.t).toISOString() };
  return { mapValue: { fields: toFs(v) } };
}
function toFs(o) { const f = {}; for (const [k, v] of Object.entries(o)) f[k] = toVal(v); return f; }
function fromVal(v) {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromVal);
  if ("mapValue" in v) return fromFs(v.mapValue.fields || {});
  return null;
}
function fromFs(f) { const o = {}; for (const [k, v] of Object.entries(f)) o[k] = fromVal(v); return o; }

let saCache = null;
async function saToken(sa) {
  if (saCache && saCache.exp > Date.now() + 60e3) return saCache.token;
  const now = Math.floor(Date.now() / 1000);
  const enc = o => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const unsigned = enc({ alg: "RS256", typ: "JWT" }) + "." + enc({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/datastore",
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
  if (!d.access_token) throw new Error("service account login failed");
  saCache = { token: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 };
  return saCache.token;
}

// ---------------------------------------------------------------- helpers
function host(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } }
function cdata(s) { return s.replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, ""); }
function decode(s) {
  return String(s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}
async function sha1(s) {
  const b = new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s)));
  return [...b].map(x => x.toString(16).padStart(2, "0")).join("");
}
