// Бараа, тохиргоо, промо код, захиалгын хадгалалт.
// data/ хавтас git-д орохгүй — серверийн диск дээр хадгалагдана (нөөцлөлтөө хийгээрэй).

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, "data");
const FILES = {
  products: path.join(DATA_DIR, "products.json"),
  orders: path.join(DATA_DIR, "orders.json"),
  settings: path.join(DATA_DIR, "settings.json"),
  promos: path.join(DATA_DIR, "promos.json"),
};
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

// Түр файлд бичээд rename хийнэ — бичих явцад унтарвал файл эвдрэхгүй.
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

const str = (v, max) => String(v ?? "").trim().slice(0, max);
const HEX = /^#[0-9a-f]{6}$/i;

function int(v, { min = 0, max = 1e9, label }) {
  const n = Math.round(Number(v));
  if (v === "" || v === null || v === undefined || !Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${label} буруу байна`);
  }
  return n;
}

// js/data.js — анхны тохиргоо, ангилал, төлбөр, бараа, мэдээллийн хуудас.
function loadSiteData() {
  const code = fs.readFileSync(path.join(ROOT, "js", "data.js"), "utf8");
  return vm.runInNewContext(`${code};({ SHOP, CATEGORIES, PRODUCTS, PAYMENT_METHODS, PAGES })`);
}

// ---------- Тохиргоо ----------

const getSettings = () => ({ ...loadSiteData().SHOP, ...readJson(FILES.settings, {}) });

function saveSettings(input) {
  const url = (v) => {
    const s = str(v, 300);
    if (s && !/^https?:\/\//.test(s)) throw new Error("Холбоос http(s)://-ээр эхлэх ёстой");
    return s;
  };
  const bankAccounts = (Array.isArray(input.bankAccounts) ? input.bankAccounts : [])
    .map((a) => ({ bank: str(a.bank, 60), account: str(a.account, 40), holder: str(a.holder, 80) }))
    .filter((a) => a.bank && a.account)
    .slice(0, 6);
  const qr = str(input.qpayStaticQr, 300);
  if (qr && !/^(uploads|assets)\/[\w./-]+$/.test(qr)) throw new Error("QR зургийн зам буруу байна");

  const settings = {
    name: str(input.name, 80) || "Lotus Flower Craft",
    tagline: str(input.tagline, 200),
    phone: str(input.phone, 40),
    email: str(input.email, 120),
    address: str(input.address, 300),
    hours: str(input.hours, 120),
    facebook: url(input.facebook),
    instagram: url(input.instagram),
    deliveryFee: int(input.deliveryFee, { max: 1e7, label: "Хүргэлтийн төлбөр" }),
    freeDeliveryFrom: int(input.freeDeliveryFrom, { max: 1e9, label: "Үнэгүй хүргэлтийн босго" }),
    deliveryArea: str(input.deliveryArea, 200),
    pickupEnabled: Boolean(input.pickupEnabled),
    pickupAddress: str(input.pickupAddress, 300),
    bankAccounts,
    qpayStaticQr: qr,
  };
  writeJson(FILES.settings, settings);
  return getSettings();
}

// ---------- Бараа ----------

function allProducts() {
  const saved = readJson(FILES.products, null);
  if (Array.isArray(saved)) return saved;
  // Анх удаа: js/data.js-ийн жагсаалтаар эхлүүлнэ.
  const seed = loadSiteData().PRODUCTS.map((p) => ({ active: true, stock: null, ...p }));
  writeJson(FILES.products, seed);
  return seed;
}

const saveProducts = (list) => writeJson(FILES.products, list);

// Дэлгүүрт харагдах бараа — нуусан барааг хасна.
const publicProducts = () => allProducts().filter((p) => p.active !== false);

// Админаас ирсэн өгөгдлийг шалгаж, зөвшөөрөгдсөн талбаруудыг л үлдээнэ.
function cleanProduct(input, existing = {}) {
  const { CATEGORIES } = loadSiteData();
  const name = str(input.name, 120);
  if (!name) throw new Error("Барааны нэр оруулна уу");
  if (!CATEGORIES.some((c) => c.id === input.category)) throw new Error("Ангилал буруу байна");

  const price = input.price === null || input.price === "" || input.price === undefined
    ? null
    : int(input.price, { max: 1e8, label: "Үнэ" });
  const stock = input.stock === null || input.stock === "" || input.stock === undefined
    ? null
    : int(input.stock, { max: 1e6, label: "Үлдэгдэл" });

  const image = str(input.image, 300);
  if (image && !/^(uploads|assets)\/[\w./-]+$/.test(image)) throw new Error("Зургийн зам буруу байна");

  const colors = Array.isArray(input.colors) && input.colors.length === 2 && input.colors.every((c) => HEX.test(c))
    ? input.colors
    : existing.colors || ["#3f6b4f", "#7fa98a"];
  const shape = ["leaf", "flower", "cactus"].includes(input.shape) ? input.shape : "leaf";

  const product = {
    id: existing.id || `p-${crypto.randomBytes(4).toString("hex")}`,
    name,
    category: input.category,
    price,
    stock,
    care: str(input.care, 60) || "—",
    light: str(input.light, 60) || "—",
    water: str(input.water, 60) || "—",
    badge: str(input.badge, 40),
    desc: str(input.desc, 2000),
    image,
    colors,
    flower: shape === "flower",
    cactus: shape === "cactus",
    active: input.active !== false,
  };
  // Хоосон талбаруудыг хадгалахгүй.
  for (const key of ["badge", "image", "flower", "cactus"]) if (!product[key]) delete product[key];
  return product;
}

// ---------- Промо код ----------

const allPromos = () => readJson(FILES.promos, []);
const savePromos = (list) => writeJson(FILES.promos, list);

function cleanPromo(input, existing = {}) {
  const code = str(input.code, 30).toUpperCase();
  if (!/^[A-Z0-9_-]{3,30}$/.test(code)) throw new Error("Код 3–30 тэмдэгт, латин үсэг/тоо байна");
  const type = input.type === "fixed" ? "fixed" : "percent";
  const value = int(input.value, { min: 1, max: type === "percent" ? 90 : 1e8, label: "Хөнгөлөлтийн хэмжээ" });
  const expiresAt = str(input.expiresAt, 10);
  if (expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) throw new Error("Дуусах огноо буруу байна");
  return {
    code,
    type,
    value,
    minAmount: input.minAmount ? int(input.minAmount, { max: 1e9, label: "Доод дүн" }) : 0,
    usageLimit: input.usageLimit ? int(input.usageLimit, { min: 1, max: 1e6, label: "Ашиглах хязгаар" }) : null,
    expiresAt: expiresAt || null,
    active: input.active !== false,
    used: existing.used || 0,
    createdAt: existing.createdAt || new Date().toISOString(),
  };
}

// Захиалгын дүнд промо кодыг шалгаж, хөнгөлөлтийн дүнг буцаана.
function evaluatePromo(rawCode, subtotal) {
  const code = str(rawCode, 30).toUpperCase();
  if (!code) return null;
  const promo = allPromos().find((p) => p.code === code);
  const today = new Date().toISOString().slice(0, 10);
  if (!promo || !promo.active) throw new Error("Промо код буруу байна");
  if (promo.expiresAt && promo.expiresAt < today) throw new Error("Промо кодын хугацаа дууссан");
  if (promo.usageLimit && promo.used >= promo.usageLimit) throw new Error("Промо кодын хязгаар дууссан");
  if (subtotal < promo.minAmount) throw new Error(`Промо код ${promo.minAmount.toLocaleString("en-US")}₮-с дээш захиалгад хүчинтэй`);
  const discount = promo.type === "percent" ? Math.round((subtotal * promo.value) / 100) : Math.min(promo.value, subtotal);
  return {
    code: promo.code,
    label: promo.type === "percent" ? `${promo.value}%` : `${promo.value.toLocaleString("en-US")}₮`,
    discount,
  };
}

function usePromo(code, delta = 1) {
  if (!code) return;
  const list = allPromos();
  const promo = list.find((p) => p.code === code);
  if (!promo) return;
  promo.used = Math.max(0, (promo.used || 0) + delta);
  savePromos(list);
}

// ---------- Зураг ----------

const IMAGE_TYPES = {
  "image/jpeg": { ext: ".jpg", magic: [0xff, 0xd8, 0xff] },
  "image/png": { ext: ".png", magic: [0x89, 0x50, 0x4e, 0x47] },
  "image/webp": { ext: ".webp", magic: [0x52, 0x49, 0x46, 0x46] },
};

// dataUrl: "data:image/jpeg;base64,...". Төрлийг файлын эхний байтаар шалгана.
function saveUpload(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) throw new Error("Зөвхөн JPG, PNG, WEBP зураг оруулна уу");
  const type = IMAGE_TYPES[m[1]];
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 4 * 1024 * 1024) throw new Error("Зураг 4MB-аас бага байх ёстой");
  if (!type.magic.every((b, i) => buf[i] === b)) throw new Error("Зургийн файл эвдэрсэн байна");
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}${type.ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, name), buf);
  return `uploads/${name}`;
}

// ---------- Захиалга ----------

const readOrders = () => readJson(FILES.orders, {});

function saveOrder(order) {
  const orders = readOrders();
  orders[order.number] = order;
  writeJson(FILES.orders, orders);
  return order;
}

// Үлдэгдлийг өөрчилнө (delta < 0 — захиалга, > 0 — цуцлалт). stock === null бол тоолохгүй.
function adjustStock(items, sign) {
  const list = allProducts();
  for (const item of items) {
    const p = list.find((x) => x.id === item.id);
    if (p && p.stock !== null && p.stock !== undefined) p.stock = Math.max(0, p.stock + sign * item.qty);
  }
  saveProducts(list);
}

module.exports = {
  ROOT,
  UPLOADS_DIR,
  loadSiteData,
  getSettings,
  saveSettings,
  allProducts,
  saveProducts,
  publicProducts,
  cleanProduct,
  allPromos,
  savePromos,
  cleanPromo,
  evaluatePromo,
  usePromo,
  saveUpload,
  readOrders,
  saveOrder,
  adjustStock,
};
