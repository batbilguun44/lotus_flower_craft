// Админ панелийн нэвтрэлт ба API (/api/admin/*).
// ADMIN_PASSWORD тохируулаагүй бол админ хэсэг идэвхгүй.

const crypto = require("node:crypto");
const store = require("./store");
const orders = require("./orders");

const PASSWORD = process.env.ADMIN_PASSWORD || "";
const SESSION_HOURS = 12;
const COOKIE = "lfc_admin";

const enabled = PASSWORD.length >= 8;
const sessions = new Map(); // token -> expiresAt
const failures = new Map(); // ip -> { count, until }

function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function tokenFrom(req) {
  const m = (req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
  return m && m[1];
}

function isAuthed(req) {
  const token = tokenFrom(req);
  const exp = token && sessions.get(token);
  if (!exp) return false;
  if (exp < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function cookie(value, maxAge, secure) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function login(req, password, secure) {
  const ip = req.socket.remoteAddress || "";
  const f = failures.get(ip);
  if (f && f.until > Date.now()) throw Object.assign(new Error("Олон удаа буруу оролдлоо. 15 минутын дараа дахин оролдоно уу."), { status: 429 });
  if (!enabled || !safeEqual(password, PASSWORD)) {
    const count = (f?.count || 0) + 1;
    failures.set(ip, { count, until: count >= 5 ? Date.now() + 15 * 60_000 : 0 });
    throw Object.assign(new Error("Нууц үг буруу байна"), { status: 401 });
  }
  failures.delete(ip);
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, Date.now() + SESSION_HOURS * 3600_000);
  return cookie(token, SESSION_HOURS * 3600, secure);
}

// ---------- Тойм ----------

function dashboard() {
  const list = Object.values(store.readOrders());
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7);
  const counted = list.filter((o) => ["paid", "delivering", "completed"].includes(o.status));
  const sum = (arr) => arr.reduce((s, o) => s + o.total, 0);
  const byStatus = Object.fromEntries(orders.STATUSES.map((s) => [s, list.filter((o) => o.status === s).length]));

  const productSales = {};
  for (const o of counted) for (const i of o.items) productSales[i.name] = (productSales[i.name] || 0) + i.qty;

  return {
    revenueToday: sum(counted.filter((o) => (o.paidAt || o.createdAt).startsWith(today))),
    revenueMonth: sum(counted.filter((o) => (o.paidAt || o.createdAt).startsWith(monthStart))),
    revenueTotal: sum(counted),
    orderCount: list.length,
    byStatus,
    topProducts: Object.entries(productSales)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, qty]) => ({ name, qty })),
    lowStock: store
      .allProducts()
      .filter((p) => p.stock != null && p.stock <= 3)
      .map((p) => ({ id: p.id, name: p.name, stock: p.stock })),
    recent: list
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 5)
      .map((o) => ({ number: o.number, name: o.customer.name, total: o.total, status: o.status, createdAt: o.createdAt })),
  };
}

// ---------- Router ----------

// handle(req, res, url, helpers) → true бол хүсэлтийг боловсруулсан.
async function handle(req, res, url, helpers) {
  if (!url.pathname.startsWith("/api/admin/")) return false;
  try {
    await route(req, res, url, helpers);
  } catch (err) {
    // Шалгалтын алдаа (буруу үнэ, нэр гэх мэт) → 400, мессежийг нь админд харуулна.
    if (err.status && err.status >= 500) throw err;
    helpers.send(res, err.status || 400, { error: err.message });
  }
  return true;
}

async function route(req, res, url, { send, readBody, secure }) {
  const { pathname } = url;
  const method = req.method;

  if (!enabled) return send(res, 503, { error: "Админ хэсэг идэвхгүй. .env файлд ADMIN_PASSWORD (8+ тэмдэгт) тохируулна уу." });

  if (pathname === "/api/admin/login" && method === "POST") {
    const body = await readBody(req);
    return send(res, 200, { ok: true }, { "Set-Cookie": login(req, body.password, secure) });
  }
  if (pathname === "/api/admin/logout" && method === "POST") {
    sessions.delete(tokenFrom(req));
    return send(res, 200, { ok: true }, { "Set-Cookie": cookie("", 0, secure) });
  }
  if (!isAuthed(req)) return send(res, 401, { error: "Нэвтэрнэ үү" });
  // CSRF: өөрчлөх хүсэлт зөвхөн JSON байх ёстой (cookie нь SameSite=Strict).
  if (method !== "GET" && !String(req.headers["content-type"]).startsWith("application/json")) {
    return send(res, 415, { error: "JSON хүсэлт шаардлагатай" });
  }

  const ok = (data, status = 200) => send(res, status, data);

  if (pathname === "/api/admin/me" && method === "GET") return ok({ ok: true });
  if (pathname === "/api/admin/dashboard" && method === "GET") return ok(dashboard());

  // Бараа
  if (pathname === "/api/admin/products") {
    if (method === "GET") return ok({ products: store.allProducts(), categories: store.loadSiteData().CATEGORIES });
    if (method === "POST") {
      const product = store.cleanProduct(await readBody(req));
      store.saveProducts([product, ...store.allProducts()]);
      return ok(product, 201);
    }
  }
  if (pathname === "/api/admin/products/order" && method === "PUT") {
    const ids = (await readBody(req)).ids || [];
    const list = store.allProducts();
    const rank = new Map(ids.map((id, i) => [id, i]));
    list.sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
    store.saveProducts(list);
    return ok({ ok: true });
  }
  const pm = pathname.match(/^\/api\/admin\/products\/([\w-]+)$/);
  if (pm) {
    const list = store.allProducts();
    const index = list.findIndex((p) => p.id === pm[1]);
    if (index < 0) return ok({ error: "Бараа олдсонгүй" }, 404);
    if (method === "PUT") {
      list[index] = store.cleanProduct(await readBody(req), list[index]);
      store.saveProducts(list);
      return ok(list[index]);
    }
    if (method === "DELETE") {
      list.splice(index, 1);
      store.saveProducts(list);
      return ok({ ok: true });
    }
  }

  // Зураг
  if (pathname === "/api/admin/uploads" && method === "POST") {
    return ok({ path: store.saveUpload((await readBody(req, 6e6)).dataUrl) }, 201);
  }

  // Захиалга
  if (pathname === "/api/admin/orders" && method === "GET") {
    const list = Object.values(store.readOrders()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return ok({ orders: list, statuses: orders.STATUSES });
  }
  const om = pathname.match(/^\/api\/admin\/orders\/(LFC-[A-Z0-9]+)$/);
  if (om && method === "PATCH") {
    const order = store.readOrders()[om[1]];
    if (!order) return ok({ error: "Захиалга олдсонгүй" }, 404);
    const body = await readBody(req);
    let updated = order;
    if (typeof body.adminNote === "string") {
      updated = store.saveOrder({ ...updated, adminNote: body.adminNote.slice(0, 2000) });
    }
    if (body.status) updated = orders.setStatus(updated, body.status);
    return ok(updated);
  }
  if (om && method === "POST" && url.searchParams.get("action") === "check") {
    const order = store.readOrders()[om[1]];
    if (!order) return ok({ error: "Захиалга олдсонгүй" }, 404);
    return ok(await orders.refreshPayment(order));
  }

  // Промо код
  if (pathname === "/api/admin/promos") {
    if (method === "GET") return ok({ promos: store.allPromos() });
    if (method === "POST") {
      const promo = store.cleanPromo(await readBody(req));
      const list = store.allPromos();
      if (list.some((p) => p.code === promo.code)) return ok({ error: "Ийм код аль хэдийн байна" }, 409);
      store.savePromos([promo, ...list]);
      return ok(promo, 201);
    }
  }
  const prm = pathname.match(/^\/api\/admin\/promos\/([A-Z0-9_-]+)$/);
  if (prm) {
    const list = store.allPromos();
    const index = list.findIndex((p) => p.code === prm[1]);
    if (index < 0) return ok({ error: "Код олдсонгүй" }, 404);
    if (method === "PUT") {
      const promo = store.cleanPromo({ ...(await readBody(req)), code: prm[1] }, list[index]);
      list[index] = promo;
      store.savePromos(list);
      return ok(promo);
    }
    if (method === "DELETE") {
      list.splice(index, 1);
      store.savePromos(list);
      return ok({ ok: true });
    }
  }

  // Тохиргоо
  if (pathname === "/api/admin/settings") {
    if (method === "GET") return ok(store.getSettings());
    if (method === "PUT") return ok(store.saveSettings(await readBody(req)));
  }

  return ok({ error: "Олдсонгүй" }, 404);
}

module.exports = { enabled, handle };
