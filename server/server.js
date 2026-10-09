// Lotus Flower Craft — дэлгүүр, админ панел, захиалга, төлбөрийн сервер.
// Ажиллуулах: npm start   (Node 18+, нэмэлт сан шаардлагагүй)

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const ROOT = path.resolve(__dirname, "..");
loadEnv(path.join(ROOT, ".env"));

const store = require("./store");
const orders = require("./orders");
const admin = require("./admin");
const qpay = require("./payments/qpay");
const golomt = require("./payments/golomt");
const notify = require("./notify");

const PORT = Number(process.env.PORT || 8000);
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const SECURE = PUBLIC_URL.startsWith("https://");
const STATIC_DIRS = ["css", "js", "assets"];
const STATIC_FILES = ["index.html", "admin.html"];
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// ---------- Туслах ----------

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN",
};

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== "string" && !Buffer.isBuffer(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": isJson ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function readBody(req, limit = 2e5) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("Хүсэлт хэт том байна"), { status: 413 }));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error("JSON буруу байна"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function serveFile(res, file, cache = "public, max-age=300") {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, "Олдсонгүй");
  res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": cache });
  fs.createReadStream(file).pipe(res);
}

function serveStatic(res, pathname) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, "");
  if (rel.startsWith("uploads/")) {
    const file = path.join(store.UPLOADS_DIR, rel.slice("uploads/".length));
    if (!file.startsWith(store.UPLOADS_DIR + path.sep)) return send(res, 404, "Олдсонгүй");
    return serveFile(res, file, "public, max-age=31536000, immutable");
  }
  const allowed = STATIC_FILES.includes(rel) || STATIC_DIRS.some((d) => rel.startsWith(d + "/"));
  const file = path.join(ROOT, rel);
  if (!allowed || !file.startsWith(ROOT + path.sep)) return send(res, 404, "Олдсонгүй");
  return serveFile(res, file, rel.endsWith(".html") ? "no-cache" : "public, max-age=300");
}

const escapeAttr = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const absolute = (p) => (/^https?:\/\//.test(p) ? p : `${PUBLIC_URL}/${p.replace(/^\/+/, "")}`);

// Нүүр хуудас — ?product=<id> бол Facebook, Google-д тухайн барааны гарчиг, зураг харагдана.
function serveIndex(res, url) {
  const settings = store.getSettings();
  const product = store.publicProducts().find((p) => p.id === url.searchParams.get("product"));
  const title = product ? `${product.name} — ${settings.name}` : `${settings.name} — Ургамал, цэцгийн дэлгүүр`;
  const description = product ? product.desc : settings.tagline;
  const image = absolute(product?.image || "assets/Lotus_flow_craft_logo_new.svg");
  const pageUrl = product ? `${PUBLIC_URL}/?product=${encodeURIComponent(product.id)}` : `${PUBLIC_URL}/`;
  const meta = [
    `<title>${escapeAttr(title)}</title>`,
    `<meta name="description" content="${escapeAttr(description)}">`,
    `<link rel="canonical" href="${escapeAttr(pageUrl)}">`,
    `<meta property="og:type" content="${product ? "product" : "website"}">`,
    `<meta property="og:site_name" content="${escapeAttr(settings.name)}">`,
    `<meta property="og:title" content="${escapeAttr(title)}">`,
    `<meta property="og:description" content="${escapeAttr(description)}">`,
    `<meta property="og:image" content="${escapeAttr(image)}">`,
    `<meta property="og:url" content="${escapeAttr(pageUrl)}">`,
    product?.price != null ? `<meta property="product:price:amount" content="${product.price}"><meta property="product:price:currency" content="MNT">` : "",
  ].join("\n  ");
  const html = fs
    .readFileSync(path.join(ROOT, "index.html"), "utf8")
    .replace(/<!-- meta:start -->[\s\S]*?<!-- meta:end -->/, meta);
  send(res, 200, html, { "Content-Type": MIME[".html"], "Cache-Control": "no-cache" });
}

function sitemap() {
  const urls = [`${PUBLIC_URL}/`, ...store.publicProducts().map((p) => `${PUBLIC_URL}/?product=${encodeURIComponent(p.id)}`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${escapeAttr(u)}</loc></url>`)
    .join("\n")}\n</urlset>\n`;
}

// ---------- Router ----------

async function handle(req, res) {
  const url = new URL(req.url, PUBLIC_URL);
  const { pathname } = url;
  const method = req.method;

  if (await admin.handle(req, res, url, { send, readBody, secure: SECURE })) return;

  if (pathname === "/api/catalog" && method === "GET") {
    const { CATEGORIES, PAGES } = store.loadSiteData();
    return send(res, 200, {
      config: { server: true, qpay: qpay.enabled, golomt: golomt.enabled },
      shop: store.getSettings(),
      categories: CATEGORIES,
      pages: PAGES,
      products: store.publicProducts(),
    });
  }

  if (pathname === "/api/quote" && method === "POST") {
    try {
      return send(res, 200, orders.quote(await readBody(req)));
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }

  if (pathname === "/api/orders" && method === "POST") {
    try {
      return send(res, 201, await orders.createOrder(await readBody(req), PUBLIC_URL));
    } catch (err) {
      return send(res, err.status || 400, { error: err.message });
    }
  }

  if (pathname === "/api/orders/track" && method === "GET") {
    const order = orders.track(url.searchParams.get("number"), url.searchParams.get("phone"));
    return order ? send(res, 200, order) : send(res, 404, { error: "Захиалга олдсонгүй. Дугаар, утсаа шалгана уу." });
  }

  const orderMatch = pathname.match(/^\/api\/orders\/(LFC-[A-Z0-9]+)$/);
  if (orderMatch && method === "GET") {
    let order = store.readOrders()[orderMatch[1]];
    if (!order) return send(res, 404, { error: "Захиалга олдсонгүй" });
    // Төлөвийг зөвхөн хэрэглэгч "шалгах" дарсан үед банкнаас асууна (QPay давтан poll хийхийг хориглодог).
    if (url.searchParams.get("check") === "1") order = await orders.refreshPayment(order).catch((err) => (console.error(err), order));
    return send(res, 200, orders.publicOrder(order));
  }

  if (pathname === "/api/payments/qpay/callback") {
    const order = store.readOrders()[url.searchParams.get("order")];
    if (order) await orders.refreshPayment(order).catch(console.error);
    return send(res, 200, "SUCCESS");
  }

  if (pathname === "/api/payments/golomt/return") {
    const number = url.searchParams.get("order") || "";
    let order = store.readOrders()[number];
    if (order) order = await orders.refreshPayment(order).catch((err) => (console.error(err), order));
    const status = order?.status === "paid" ? "paid" : "failed";
    res.writeHead(302, { Location: `/?order=${encodeURIComponent(number)}&payment=${status}` });
    return res.end();
  }

  if (pathname.startsWith("/api/")) return send(res, 404, { error: "Олдсонгүй" });
  if (method !== "GET" && method !== "HEAD") return send(res, 405, "Method not allowed");

  if (pathname === "/" || pathname === "/index.html") return serveIndex(res, url);
  if (pathname === "/admin") return res.writeHead(301, { Location: "/admin.html" }), res.end();
  if (pathname === "/robots.txt") {
    return send(res, 200, `User-agent: *\nDisallow: /admin.html\nDisallow: /api/\nSitemap: ${PUBLIC_URL}/sitemap.xml\n`);
  }
  if (pathname === "/sitemap.xml") return send(res, 200, sitemap(), { "Content-Type": MIME[".xml"] });
  return serveStatic(res, pathname);
}

http
  .createServer((req, res) =>
    handle(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : "Серверийн алдаа" });
    })
  )
  .listen(PORT, () => {
    const on = (v) => (v ? "идэвхтэй" : "тохируулаагүй");
    console.log(`Lotus Flower Craft: ${PUBLIC_URL}   Админ: ${PUBLIC_URL}/admin.html`);
    console.log(`Админ: ${on(admin.enabled)} · QPay: ${on(qpay.enabled)} · Голомт: ${on(golomt.enabled)} · Telegram: ${on(notify.enabled)}`);
  });
