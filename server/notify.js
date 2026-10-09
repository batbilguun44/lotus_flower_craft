// Шинэ захиалга, төлбөрийн мэдэгдлийг Telegram-аар дэлгүүрийн эзэнд илгээнэ.
// Тохиргоо: @BotFather-аас бот үүсгэж TELEGRAM_BOT_TOKEN, өөрийн chat id-г TELEGRAM_CHAT_ID-д оруулна.

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const enabled = Boolean(TOKEN && CHAT_ID);
const money = (n) => `${Number(n).toLocaleString("en-US")}₮`;

async function send(text) {
  if (!enabled) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text, disable_web_page_preview: true }),
    });
    if (!res.ok) console.error("Telegram:", res.status, await res.text());
  } catch (err) {
    console.error("Telegram:", err.message);
  }
}

function newOrder(order) {
  const c = order.customer;
  return send(
    [
      `🌿 Шинэ захиалга ${order.number}`,
      ...order.items.map((i) => `• ${i.name} × ${i.qty} — ${money(i.price * i.qty)}`),
      order.discount ? `Хөнгөлөлт (${order.promoCode}): −${money(order.discount)}` : "",
      `Нийт: ${money(order.total)} · ${order.methodName}`,
      `${c.name}, ${c.phone}`,
      order.fulfillment === "pickup" ? "Очиж авна" : `Хаяг: ${c.address}`,
      `Огноо: ${c.date}`,
      c.note ? `Тайлбар: ${c.note}` : "",
    ]
      .filter(Boolean)
      .join("\n")
  );
}

const paid = (order) => send(`✅ Төлбөр орлоо: ${order.number} — ${money(order.total)} (${order.methodName})`);

module.exports = { enabled, newOrder, paid };
