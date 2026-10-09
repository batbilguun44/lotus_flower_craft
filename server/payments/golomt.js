// Голомт банкны e-commerce gateway: Visa / Mastercard / UnionPay карт болон SocialPay.
// Баримт бичиг: https://dev.golomtbank.com:7443/docs/ecommerce_api_invoice_en
// Гэрээ байгуулахдаа merchant@golomtbank.com-оос токен, HMAC түлхүүр авна.

const crypto = require("node:crypto");

const BASE_URL = process.env.GOLOMT_BASE_URL || "https://ecommerce.golomtbank.com";
const TOKEN = process.env.GOLOMT_TOKEN;
const SECRET = process.env.GOLOMT_SECRET;

const enabled = Boolean(TOKEN && SECRET);

const hmac = (message) => crypto.createHmac("sha256", SECRET).update(message).digest("hex");

async function request(path, body) {
  const res = await fetch(BASE_URL + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Golomt ${path} ${res.status}: ${data.message || JSON.stringify(data)}`);
  return data;
}

// via: "card" → картын хуудас, "socialpay" → SocialPay апп руу deeplink
async function createInvoice({ transactionId, amount, callbackUrl, via, lang = "MN" }) {
  const returnType = "GET";
  const amountText = String(amount);
  const data = await request("/api/invoice", {
    amount: amountText,
    callback: callbackUrl,
    checksum: hmac(transactionId + amountText + returnType + callbackUrl),
    genToken: "N",
    returnType,
    transactionId,
    socialDeeplink: via === "socialpay" ? "Y" : "N",
  });
  if (data.checksum && data.checksum !== hmac(data.invoice + data.transactionId)) {
    throw new Error("Golomt invoice checksum таарахгүй байна");
  }
  const page = via === "socialpay" ? "socialpay" : "payment";
  return {
    invoice: data.invoice,
    redirectUrl: via === "socialpay" && data.socialDeeplink ? data.socialDeeplink : `${BASE_URL}/${page}/${lang.toLowerCase()}/${data.invoice}`,
  };
}

// Гүйлгээний төлөвийг банкнаас шалгана. errorCode "000" бол амжилттай.
async function inquiry(transactionId) {
  const data = await request("/api/inquiry", {
    checksum: hmac(transactionId + transactionId),
    transactionId,
  });
  return { paid: data.errorCode === "000", amount: Number(data.amount || 0), raw: data };
}

module.exports = { enabled, createInvoice, inquiry };
