// Захиалгын үнэ тооцоолол, үүсгэх, төлбөр шалгах.

const crypto = require("node:crypto");
const store = require("./store");
const qpay = require("./payments/qpay");
const golomt = require("./payments/golomt");
const notify = require("./notify");

const STATUSES = ["pending", "paid", "delivering", "completed", "cancelled"];

const str = (v, max) => String(v ?? "").trim().slice(0, max);

// Сагсны дүн — үнэ, үлдэгдэл, промо, хүргэлтийг серверт л тооцно.
function quote({ items: rawItems, promoCode, fulfillment }) {
  const settings = store.getSettings();
  const byId = Object.fromEntries(store.publicProducts().map((p) => [p.id, p]));

  const items = (Array.isArray(rawItems) ? rawItems : []).slice(0, 50).map((line) => {
    const p = byId[line.id];
    const qty = Math.floor(Number(line.qty));
    if (!p || p.price == null) throw new Error("Сагсан дахь зарим бараа одоо худалдаалагдахгүй байна");
    if (!(qty >= 1 && qty <= 99)) throw new Error("Тоо ширхэг буруу байна");
    if (p.stock != null && qty > p.stock) {
      throw new Error(p.stock === 0 ? `«${p.name}» дууссан байна` : `«${p.name}» ${p.stock} ширхэг л үлдсэн байна`);
    }
    return { id: p.id, name: p.name, price: p.price, qty };
  });
  if (!items.length) throw new Error("Сагс хоосон байна");

  const pickup = fulfillment === "pickup";
  if (pickup && !settings.pickupEnabled) throw new Error("Очиж авах боломжгүй байна");

  const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const promo = store.evaluatePromo(promoCode, subtotal);
  const discount = promo ? promo.discount : 0;
  const delivery = pickup || subtotal - discount >= settings.freeDeliveryFrom ? 0 : settings.deliveryFee;
  return {
    items,
    fulfillment: pickup ? "pickup" : "delivery",
    subtotal,
    discount,
    promo,
    delivery,
    total: subtotal - discount + delivery,
  };
}

// Гүйлгээний утга дээр бичихэд богино, таахад хэцүү дугаар: LFC-7K2M9QX
function newOrderNumber() {
  const existing = store.readOrders();
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let number;
  do {
    number = "LFC-" + Array.from(crypto.randomBytes(7), (b) => alphabet[b % alphabet.length]).join("");
  } while (existing[number]);
  return number;
}

const publicOrder = (o) => ({
  number: o.number,
  createdAt: o.createdAt,
  status: o.status,
  method: o.method,
  methodName: o.methodName,
  fulfillment: o.fulfillment,
  subtotal: o.subtotal,
  discount: o.discount,
  delivery: o.delivery,
  total: o.total,
  items: o.items.map(({ name, qty, price }) => ({ name, qty, price })),
});

async function createOrder(body, publicUrl) {
  const { PAYMENT_METHODS } = store.loadSiteData();
  const q = quote(body);

  const c = body.customer || {};
  const customer = {
    name: str(c.name, 100),
    phone: str(c.phone, 30),
    address: q.fulfillment === "pickup" ? "" : str(c.address, 300),
    date: str(c.date, 10),
    note: str(c.note, 1000),
  };
  if (!customer.name || !/^[0-9+\s-]{8,}$/.test(customer.phone) || !customer.date) {
    throw new Error("Захиалагчийн мэдээлэл дутуу байна");
  }
  if (q.fulfillment === "delivery" && !customer.address) throw new Error("Хүргэлтийн хаяг оруулна уу");

  const method = PAYMENT_METHODS.find((m) => m.id === body.method);
  if (!method) throw new Error("Төлбөрийн хэлбэр буруу байна");
  if (method.minAmount && q.total < method.minAmount) {
    throw new Error(`${method.name}: ${method.minAmount.toLocaleString("en-US")}₮-с дээш захиалгад боломжтой`);
  }
  if ((method.id === "card" || method.id === "socialpay") && !golomt.enabled) throw new Error("Энэ төлбөрийн хэлбэр одоогоор идэвхгүй байна");

  const order = {
    number: newOrderNumber(),
    createdAt: new Date().toISOString(),
    status: "pending",
    method: method.id,
    methodName: method.name,
    fulfillment: q.fulfillment,
    customer,
    items: q.items,
    subtotal: q.subtotal,
    discount: q.discount,
    promoCode: q.promo?.code || null,
    delivery: q.delivery,
    total: q.total,
    payment: {},
    history: [{ at: new Date().toISOString(), status: "pending" }],
  };

  // Банктай харилцахаас өмнө үлдэгдлийг нөөцөлнө — алдаа гарвал буцаана.
  store.adjustStock(order.items, -1);
  const response = {};
  try {
    if (order.method === "qpay" && qpay.enabled) {
      const invoice = await qpay.createInvoice({
        orderNumber: order.number,
        amount: order.total,
        description: `Lotus Flower Craft ${order.number}`,
        callbackUrl: `${publicUrl}/api/payments/qpay/callback?order=${order.number}`,
      });
      order.payment = { provider: "qpay", invoiceId: invoice.invoiceId };
      response.qpay = { qrImage: invoice.qrImage, qrText: invoice.qrText, shortUrl: invoice.shortUrl, urls: invoice.urls };
    } else if (order.method === "card" || order.method === "socialpay") {
      const transactionId = order.number.replace(/-/g, "");
      const invoice = await golomt.createInvoice({
        transactionId,
        amount: order.total,
        via: order.method,
        callbackUrl: `${publicUrl}/api/payments/golomt/return?order=${order.number}`,
      });
      order.payment = { provider: "golomt", transactionId, invoice: invoice.invoice };
      response.redirectUrl = invoice.redirectUrl;
    }
    // Бусад (данс, тогтмол QPay QR, Storepay, хүргэлтээр) — дэлгүүр гараар баталгаажуулна.
  } catch (err) {
    store.adjustStock(order.items, +1);
    console.error(err);
    throw new Error("Төлбөрийн системд холбогдож чадсангүй. Түр хүлээгээд дахин оролдоно уу.");
  }

  store.saveOrder(order);
  store.usePromo(order.promoCode, +1);
  notify.newOrder(order);
  return { ...response, order: publicOrder(order) };
}

// Төлөв солих (админ). Цуцлахад үлдэгдэл, промо хэрэглээг буцаана.
function setStatus(order, status, extra = {}) {
  if (!STATUSES.includes(status)) throw new Error("Төлөв буруу байна");
  if (order.status === status) return order;
  if (status === "cancelled") {
    store.adjustStock(order.items, +1);
    store.usePromo(order.promoCode, -1);
  } else if (order.status === "cancelled") {
    store.adjustStock(order.items, -1);
    store.usePromo(order.promoCode, +1);
  }
  const updated = {
    ...order,
    ...extra,
    status,
    history: [...(order.history || []), { at: new Date().toISOString(), status }],
  };
  if (status === "paid" && !order.paidAt) updated.paidAt = new Date().toISOString();
  store.saveOrder(updated);
  if (status === "paid") notify.paid(updated);
  return updated;
}

// Төлбөрийн төлвийг банкнаас шалгана.
async function refreshPayment(order) {
  if (order.status !== "pending") return order;
  if (order.payment.provider === "qpay") {
    const { paidAmount, paymentIds } = await qpay.checkPayment(order.payment.invoiceId);
    if (paidAmount >= order.total) return setStatus(order, "paid", { payment: { ...order.payment, paymentIds } });
  }
  if (order.payment.provider === "golomt") {
    const result = await golomt.inquiry(order.payment.transactionId);
    if (result.paid && result.amount >= order.total) {
      return setStatus(order, "paid", { payment: { ...order.payment, bankResponse: result.raw } });
    }
  }
  return order;
}

const digits = (s) => String(s || "").replace(/\D/g, "").slice(-8);

// Захиалга хянах: дугаар + утасны сүүлийн 8 орон таарах ёстой.
function track(number, phone) {
  const order = store.readOrders()[str(number, 20).toUpperCase()];
  if (!order || !digits(phone) || digits(order.customer.phone) !== digits(phone)) return null;
  return { ...publicOrder(order), history: order.history || [] };
}

module.exports = { STATUSES, quote, createOrder, setStatus, refreshPayment, publicOrder, track };
