// Lotus Flower Craft — статик сайт + захиалга, төлбөрийн API.
// Ажиллуулах: node server/server.js   (Node 18+, нэмэлт сан шаардлагагүй)

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const vm = require("node:vm");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
loadEnv(path.join(ROOT, ".env"));

const qpay = require("./payments/qpay");
const golomt = require("./payments/golomt");

const PORT = Number(process.env.PORT || 8000);
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const ORDERS_FILE = path.join(ROOT, "data", "orders.json");
const STATIC_DIRS = ["css", "js", "assets"];
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// Үнийг хэрэглэгчээс биш, js/data.js-ээс тооцно — нэг эх сурвалж.
function loadCatalog() {
  const code = fs.readFileSync(path.join(ROOT, "js", "data.js"), "utf8");
  return vm.runInNewContext(`${code};({ SHOP, PRODUCTS, PAYMENT_METHODS })`);
}

// ---------- Захиалгын сан (JSON файл) ----------

function readOrders() {
  try {
    return JSON.parse(fs.readFileSync(ORDERS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveOrder(order) {
  const orders = readOrders();
  orders[order.number] = order;
  fs.mkdirSync(path.dirname(ORDERS_FILE), { recursive: true });
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
  return order;
}

function markPaid(order, details) {
  if (order.status === "paid") return order;
  return saveOrder({ ...order, status: "paid", paidAt: new Date().toISOString(), payment: { ...order.payment, ...details } });
}

const publicOrder = (o) => ({
  number: o.number,
  status: o.status,
  method: o.method,
  total: o.total,
  items: o.items.map(({ name, qty }) => ({ name, qty })),
});

// ---------- Туслах ----------

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== "string" && !Buffer.isBuffer(body);
  res.writeHead(status, { "Content-Type": isJson ? "application/json; charset=utf-8" : "text/plain; charset=utf-8", ...headers });
  res.end(isJson ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1e5) reject(new Error("Хүсэлт хэт том байна"));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("JSON буруу байна"));
      }
    });
  });
}

function serveStatic(req, res, pathname) {
  const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const allowed = rel === "index.html" || STATIC_DIRS.some((d) => rel.startsWith(d + "/"));
  const file = path.join(ROOT, rel);
  if (!allowed || !file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return send(res, 404, "Олдсонгүй");
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

// ---------- Захиалга үүсгэх ----------

// Гүйлгээний утга дээр бичихэд богино, таахад хэцүү дугаар: LFC-7K2M9QX
function newOrderNumber() {
  const existing = readOrders();
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let number;
  do {
    number = "LFC-" + Array.from(crypto.randomBytes(7), (b) => alphabet[b % alphabet.length]).join("");
  } while (existing[number]);
  return number;
}

function buildOrder(body) {
  const { SHOP, PRODUCTS, PAYMENT_METHODS } = loadCatalog();
  const byId = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));

  const items = (Array.isArray(body.items) ? body.items : []).map((line) => {
    const p = byId[line.id];
    const qty = Math.floor(Number(line.qty));
    if (!p || p.price == null || !(qty >= 1 && qty <= 99)) throw new Error("Сагсан дахь бараа буруу байна");
    return { id: p.id, name: p.name, price: p.price, qty };
  });
  if (!items.length) throw new Error("Сагс хоосон байна");

  const c = body.customer || {};
  const customer = {
    name: String(c.name || "").trim().slice(0, 100),
    phone: String(c.phone || "").trim().slice(0, 30),
    address: String(c.address || "").trim().slice(0, 300),
    date: String(c.date || "").slice(0, 10),
    note: String(c.note || "").trim().slice(0, 1000),
  };
  if (!customer.name || !/^[0-9+\s-]{8,}$/.test(customer.phone) || !customer.address || !customer.date) {
    throw new Error("Захиалагчийн мэдээлэл дутуу байна");
  }

  const method = PAYMENT_METHODS.find((m) => m.id === body.method);
  if (!method) throw new Error("Төлбөрийн хэлбэр буруу байна");

  const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const delivery = subtotal >= SHOP.freeDeliveryFrom ? 0 : SHOP.deliveryFee;
  const total = subtotal + delivery;
  if (method.minAmount && total < method.minAmount) throw new Error(`${method.name}: ${method.minAmount.toLocaleString("en-US")}₮-с дээш захиалгад боломжтой`);

  return {
    number: newOrderNumber(),
    createdAt: new Date().toISOString(),
    status: "pending",
    method: method.id,
    customer,
    items,
    subtotal,
    delivery,
    total,
    payment: {},
  };
}

async function createOrder(body) {
  const order = buildOrder(body);
  const response = { order: null };

  if (order.method === "qpay" && qpay.enabled) {
    const invoice = await qpay.createInvoice({
      orderNumber: order.number,
      amount: order.total,
      description: `Lotus Flower Craft ${order.number}`,
      callbackUrl: `${PUBLIC_URL}/api/payments/qpay/callback?order=${order.number}`,
    });
    order.payment = { provider: "qpay", invoiceId: invoice.invoiceId };
    response.qpay = { qrImage: invoice.qrImage, qrText: invoice.qrText, shortUrl: invoice.shortUrl, urls: invoice.urls };
  } else if ((order.method === "card" || order.method === "socialpay") && golomt.enabled) {
    const transactionId = order.number.replace(/-/g, "");
    const invoice = await golomt.createInvoice({
      transactionId,
      amount: order.total,
      via: order.method,
      callbackUrl: `${PUBLIC_URL}/api/payments/golomt/return?order=${order.number}`,
    });
    order.payment = { provider: "golomt", transactionId, invoice: invoice.invoice };
    response.redirectUrl = invoice.redirectUrl;
  } else if (order.method === "card" || order.method === "socialpay") {
    throw new Error("Энэ төлбөрийн хэлбэр одоогоор идэвхгүй байна");
  }
  // Бусад (данс, тогтмол QPay QR, Storepay, хүргэлтээр) — дэлгүүр гараар баталгаажуулна.

  saveOrder(order);
  response.order = publicOrder(order);
  return response;
}

async function refreshPayment(order) {
  if (order.status !== "pending") return order;
  if (order.payment.provider === "qpay") {
    const { paidAmount, paymentIds } = await qpay.checkPayment(order.payment.invoiceId);
    if (paidAmount >= order.total) return markPaid(order, { paymentIds });
  }
  if (order.payment.provider === "golomt") {
    const result = await golomt.inquiry(order.payment.transactionId);
    if (result.paid && result.amount >= order.total) return markPaid(order, { bankResponse: result.raw });
  }
  return order;
}

// ---------- Router ----------

async function handle(req, res) {
  const url = new URL(req.url, PUBLIC_URL);
  const { pathname } = url;

  if (pathname === "/api/config" && req.method === "GET") {
    return send(res, 200, { server: true, qpay: qpay.enabled, golomt: golomt.enabled });
  }

  if (pathname === "/api/orders" && req.method === "POST") {
    try {
      return send(res, 201, await createOrder(await readBody(req)));
    } catch (err) {
      console.error(err);
      return send(res, 400, { error: err.message });
    }
  }

  const orderMatch = pathname.match(/^\/api\/orders\/(LFC-[A-Z0-9-]+)$/);
  if (orderMatch && req.method === "GET") {
    let order = readOrders()[orderMatch[1]];
    if (!order) return send(res, 404, { error: "Захиалга олдсонгүй" });
    // Төлөвийг зөвхөн хэрэглэгч "шалгах" дарсан үед банкнаас асууна (QPay давтан poll хийхийг хориглодог).
    if (url.searchParams.get("check") === "1") {
      try {
        order = await refreshPayment(order);
      } catch (err) {
        console.error(err);
      }
    }
    return send(res, 200, publicOrder(order));
  }

  if (pathname === "/api/payments/qpay/callback") {
    const order = readOrders()[url.searchParams.get("order")];
    if (order) await refreshPayment(order).catch(console.error);
    return send(res, 200, "SUCCESS");
  }

  if (pathname === "/api/payments/golomt/return") {
    const number = url.searchParams.get("order");
    let order = readOrders()[number];
    if (order) order = await refreshPayment(order).catch((err) => (console.error(err), order));
    const status = order?.status === "paid" ? "paid" : "failed";
    res.writeHead(302, { Location: `/?order=${encodeURIComponent(number || "")}&payment=${status}` });
    return res.end();
  }

  if (pathname.startsWith("/api/")) return send(res, 404, { error: "Олдсонгүй" });
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
  return serveStatic(req, res, pathname);
}

http
  .createServer((req, res) => handle(req, res).catch((err) => (console.error(err), send(res, 500, { error: "Серверийн алдаа" }))))
  .listen(PORT, () => {
    console.log(`Lotus Flower Craft: ${PUBLIC_URL}`);
    console.log(`QPay: ${qpay.enabled ? "идэвхтэй" : "тохируулаагүй"}, Голомт (карт/SocialPay): ${golomt.enabled ? "идэвхтэй" : "тохируулаагүй"}`);
  });
