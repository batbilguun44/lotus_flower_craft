// Дэлгүүр болон админ панелд хамтран ашиглах туслах функцууд.
const LFC = (() => {
  "use strict";

  const escapeHtml = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

  const formatPrice = (n) => Number(n).toLocaleString("en-US") + "₮";

  const HEX = /^#[0-9a-f]{6}$/i;

  // Бодит фото байхгүй үед ургамлын дүрслэл (SVG).
  function illustration(p, tone = "#eee") {
    const [dark, light] = (p.colors || []).every((c) => HEX.test(c)) && p.colors?.length === 2 ? p.colors : ["#3f6b4f", "#7fa98a"];
    const pot = `<path d="M62 128h76l-8 52a8 8 0 0 1-8 7H78a8 8 0 0 1-8-7Z" fill="#c9875f"/><rect x="56" y="120" width="88" height="14" rx="4" fill="#b37350"/>`;
    let plant;
    if (p.cactus) {
      plant = `<rect x="88" y="52" width="24" height="72" rx="12" fill="${dark}"/>
        <path d="M88 92H72a10 10 0 0 1-10-10V70" stroke="${dark}" stroke-width="14" fill="none" stroke-linecap="round"/>
        <path d="M112 80h14a10 10 0 0 0 10-10V60" stroke="${light}" stroke-width="12" fill="none" stroke-linecap="round"/>
        <circle cx="100" cy="50" r="6" fill="#e86f8f"/>`;
    } else if (p.flower) {
      const petals = [0, 72, 144, 216, 288]
        .map((a) => `<ellipse cx="0" cy="-13" rx="9" ry="14" fill="${light}" transform="rotate(${a})"/>`)
        .join("");
      const bloom = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})">${petals}<circle r="6" fill="${dark}"/></g>`;
      plant = `<path d="M100 122C100 90 92 70 80 52M100 122c0-30 8-50 22-64M100 122V40" stroke="#4f7a52" stroke-width="3" fill="none"/>
        <path d="M100 120c-20-4-30-14-34-28 16 2 28 10 34 28Zm0 0c20-4 30-14 34-28-16 2-28 10-34 28Z" fill="#5f8f5f"/>
        ${bloom(80, 52, 1)}${bloom(122, 58, 0.9)}${bloom(100, 38, 1.05)}`;
    } else {
      plant = `<path d="M100 124C80 104 60 92 46 64c26 2 46 20 54 60Z" fill="${dark}"/>
        <path d="M100 124c20-20 40-32 54-60-26 2-46 20-54 60Z" fill="${dark}"/>
        <path d="M100 124c-10-26-8-56 0-82 8 26 10 56 0 82Z" fill="${light}"/>
        <path d="M100 124C86 112 74 96 70 78c16 6 26 22 30 46Zm0 0c14-12 26-28 30-46-16 6-26 22-30 46Z" fill="${light}" opacity=".85"/>`;
    }
    return `<svg viewBox="0 0 200 200" role="img" aria-label="${escapeHtml(p.name)}" preserveAspectRatio="xMidYMid slice">
      <rect width="200" height="200" fill="${HEX.test(tone) ? tone : "#eee"}"/>${plant}${pot}</svg>`;
  }

  const media = (p, tone) =>
    p.image ? `<img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" loading="lazy">` : illustration(p, tone);

  const ORDER_STATUS = {
    pending: "Хүлээгдэж буй",
    paid: "Төлөгдсөн",
    delivering: "Хүргэлтэнд гарсан",
    completed: "Хүлээлгэн өгсөн",
    cancelled: "Цуцлагдсан",
  };

  return { escapeHtml, formatPrice, illustration, media, ORDER_STATUS };
})();
