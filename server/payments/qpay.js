// QPay Merchant API v2 — https://developer.qpay.mn
// Sandbox: https://merchant-sandbox.qpay.mn, Production: https://merchant.qpay.mn

const BASE_URL = process.env.QPAY_BASE_URL || "https://merchant-sandbox.qpay.mn";
const CLIENT_ID = process.env.QPAY_CLIENT_ID;
const CLIENT_SECRET = process.env.QPAY_CLIENT_SECRET;
const INVOICE_CODE = process.env.QPAY_INVOICE_CODE;

const enabled = Boolean(CLIENT_ID && CLIENT_SECRET && INVOICE_CODE);

// QPay токеныг дахин дахин авахгүй байхыг шаарддаг тул хүчинтэй хугацаанд нь кэшлэнэ.
let token = null;

// expires_in нь epoch секунд байдаг; харьцангуй секунд ирвэл хөрвүүлнэ.
function normalizeToken(t) {
  const now = Math.floor(Date.now() / 1000);
  const abs = (v) => (Number(v) < 1e9 ? now + Number(v) : Number(v));
  return { ...t, expires_in: abs(t.expires_in), refresh_expires_in: abs(t.refresh_expires_in || 0) };
}

async function request(path, { method = "POST", body, auth } = {}) {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`QPay ${path} ${res.status}: ${data.message || text}`);
  return data;
}

async function accessToken() {
  const now = Date.now() / 1000;
  if (token && token.expires_in - 60 > now) return token.access_token;

  if (token && token.refresh_expires_in - 60 > now) {
    try {
      token = normalizeToken(await request("/v2/auth/refresh", { auth: `Bearer ${token.refresh_token}` }));
      return token.access_token;
    } catch {
      /* refresh амжилтгүй бол шинээр авна */
    }
  }
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  token = normalizeToken(await request("/v2/auth/token", { auth: `Basic ${basic}` }));
  return token.access_token;
}

async function createInvoice({ orderNumber, amount, description, callbackUrl }) {
  const data = await request("/v2/invoice", {
    auth: `Bearer ${await accessToken()}`,
    body: {
      invoice_code: INVOICE_CODE,
      sender_invoice_no: orderNumber,
      invoice_receiver_code: "terminal",
      invoice_description: description,
      amount,
      callback_url: callbackUrl,
    },
  });
  return {
    invoiceId: data.invoice_id,
    qrImage: data.qr_image,
    qrText: data.qr_text,
    shortUrl: data.qPay_shortUrl,
    urls: (data.urls || []).map((u) => ({ name: u.name, description: u.description, logo: u.logo, link: u.link })),
  };
}

// Төлөгдсөн дүнг буцаана. Callback ирсний дараа эсвэл хэрэглэгч "шалгах" дарсан үед л дуудна.
async function checkPayment(invoiceId) {
  const data = await request("/v2/payment/check", {
    auth: `Bearer ${await accessToken()}`,
    body: { object_type: "INVOICE", object_id: invoiceId, offset: { page_number: 1, page_limit: 100 } },
  });
  const paid = (data.rows || []).filter((r) => r.payment_status === "PAID");
  return {
    paidAmount: paid.reduce((sum, r) => sum + Number(r.payment_amount || 0), 0),
    paymentIds: paid.map((r) => r.payment_id),
  };
}

module.exports = { enabled, createInvoice, checkPayment };
