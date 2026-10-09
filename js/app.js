(() => {
  "use strict";

  const CART_KEY = "lfc-cart";
  const WISH_KEY = "lfc-wishlist";
  const ORDERS_KEY = "lfc-orders";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const { escapeHtml, formatPrice, ORDER_STATUS } = LFC;

  const storage = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* хадгалах боломжгүй орчин — санах ойд л үлдэнэ */
      }
    },
  };

  // ---------- Каталог ----------
  // Сервер ажиллаж байвал /api/catalog-оос (админ панелаар засагдсан) өгөгдөл авна,
  // үгүй бол (статик байршуулалт) js/data.js-ийн өгөгдлийг ашиглана.

  let config = { server: false, qpay: false, golomt: false };
  let shop = SHOP;
  let categories = CATEGORIES;
  let products = PRODUCTS;
  let pages = PAGES;
  let productById = {};
  let categoryById = {};

  function setCatalog(data) {
    if (data) ({ config, shop, categories, products, pages } = data);
    productById = Object.fromEntries(products.map((p) => [p.id, p]));
    categoryById = Object.fromEntries(categories.map((c) => [c.id, c]));
  }

  async function loadCatalog() {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch("api/catalog", { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok && res.headers.get("content-type")?.includes("json")) return setCatalog(await res.json());
    } catch {
      /* статик горим */
    }
    setCatalog();
  }

  const media = (p) => LFC.media(p, categoryById[p.category]?.tone);
  const priceLabel = (p) => (p.price == null ? "Үнэ тохиролцоно" : formatPrice(p.price));
  const soldOut = (p) => p.stock === 0;
  const maxQty = (p) => (p.stock == null ? 99 : Math.min(99, p.stock));

  // ---------- Ангилал ба шүүлтүүр ----------

  const state = { category: "all", query: "", sort: "default" };

  function renderCategories() {
    $("[data-categories]").innerHTML = categories
      .map((c) => {
        const inCat = products.filter((p) => p.category === c.id);
        const sample = inCat.find((p) => p.image) || inCat[0];
        return `<button class="category-card" type="button" data-category="${c.id}" style="--tone:${escapeHtml(c.tone)}">
          <span class="category-art">${sample ? media(sample) : ""}</span>
          <span class="category-text">
            <strong>${escapeHtml(c.name)}</strong>
            <span>${escapeHtml(c.blurb)}</span>
            ${c.tags ? `<em>${escapeHtml(c.tags.join(" "))}</em>` : ""}
            <small>${inCat.length} бүтээгдэхүүн</small>
          </span>
        </button>`;
      })
      .join("");

    $$("[data-category]").forEach((btn) =>
      btn.addEventListener("click", () => {
        setCategory(btn.dataset.category);
        $("#shop").scrollIntoView({ behavior: "smooth" });
      })
    );
  }

  function renderFilters() {
    const chips = [{ id: "all", name: "Бүгд" }, ...categories, { id: "wishlist", name: `♥ Хадгалсан (${wishlist.length})` }];
    $("[data-filters]").innerHTML = chips
      .map(
        (c) =>
          `<button class="chip" type="button" role="tab" data-filter="${c.id}" aria-selected="${c.id === state.category}">${escapeHtml(c.name)}</button>`
      )
      .join("");
    $$("[data-filter]").forEach((btn) => btn.addEventListener("click", () => setCategory(btn.dataset.filter)));
  }

  function setCategory(id) {
    state.category = id;
    $$("[data-filter]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.filter === id)));
    renderProducts();
  }

  function visibleProducts() {
    const q = state.query.trim().toLowerCase();
    let list = products.filter((p) =>
      state.category === "all" ? true : state.category === "wishlist" ? wishlist.includes(p.id) : p.category === state.category
    );
    if (q) {
      list = list.filter((p) =>
        [p.name, p.desc, p.badge, categoryById[p.category]?.name].join(" ").toLowerCase().includes(q)
      );
    }
    const priceOf = (p, missing) => (p.price == null ? missing : p.price);
    if (state.sort === "price-asc") list = [...list].sort((a, b) => priceOf(a, Infinity) - priceOf(b, Infinity));
    if (state.sort === "price-desc") list = [...list].sort((a, b) => priceOf(b, -1) - priceOf(a, -1));
    if (state.sort === "name") list = [...list].sort((a, b) => a.name.localeCompare(b.name, "mn"));
    // Дууссан барааг сүүлд нь харуулна.
    return list.sort((a, b) => Number(soldOut(a)) - Number(soldOut(b)));
  }

  function stockNote(p) {
    if (soldOut(p)) return `<span class="stock-note out">Дууссан</span>`;
    if (p.stock != null && p.stock <= 3) return `<span class="stock-note">Сүүлийн ${p.stock} ширхэг</span>`;
    return "";
  }

  function heartButton(p) {
    const on = wishlist.includes(p.id);
    return `<button class="heart${on ? " on" : ""}" type="button" data-wish="${p.id}" aria-pressed="${on}" aria-label="Хадгалах">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/></svg>
    </button>`;
  }

  function renderProducts() {
    const list = visibleProducts();
    const empty = $("[data-empty]");
    empty.hidden = list.length > 0;
    empty.textContent = state.category === "wishlist" ? "Хадгалсан бараа алга. Барааны ♥ дээр дарж хадгална уу." : "Илэрц олдсонгүй.";
    $("[data-products]").innerHTML = list
      .map(
        (p) => `<article class="product-card${soldOut(p) ? " is-soldout" : ""}">
          <div class="product-media-wrap">
            <a class="product-media" href="?product=${encodeURIComponent(p.id)}" data-view="${p.id}" aria-label="${escapeHtml(p.name)} дэлгэрэнгүй">
              ${media(p)}
              ${p.badge ? `<span class="badge">${escapeHtml(p.badge)}</span>` : ""}
            </a>
            ${heartButton(p)}
          </div>
          <div class="product-body">
            <span class="product-cat">${escapeHtml(categoryById[p.category]?.name)}</span>
            <h3><a class="link" href="?product=${encodeURIComponent(p.id)}" data-view="${p.id}">${escapeHtml(p.name)}</a></h3>
            ${stockNote(p)}
            <div class="product-foot">
              <span class="price">${priceLabel(p)}</span>
              ${actionButton(p, "btn-small")}
            </div>
          </div>
        </article>`
      )
      .join("");
    bindProductActions($("[data-products]"));
  }

  function actionButton(p, extra = "") {
    if (p.price == null) return `<a class="btn btn-ghost ${extra}" href="#contact" data-inquire>Асуух</a>`;
    if (soldOut(p)) return `<button class="btn btn-ghost ${extra}" type="button" disabled>Дууссан</button>`;
    return `<button class="btn btn-primary ${extra}" type="button" data-add="${p.id}">Сагслах</button>`;
  }

  function bindProductActions(root) {
    $$("[data-view]", root).forEach((el) =>
      el.addEventListener("click", (e) => {
        e.preventDefault();
        openProduct(el.dataset.view);
      })
    );
    $$("[data-add]", root).forEach((el) =>
      el.addEventListener("click", () => {
        const qtyInput = $("[data-qty]", root);
        addToCart(el.dataset.add, qtyInput ? Math.max(1, parseInt(qtyInput.value, 10) || 1) : 1);
      })
    );
    $$("[data-wish]", root).forEach((el) => el.addEventListener("click", () => toggleWish(el.dataset.wish)));
    $$("[data-inquire]", root).forEach((el) => el.addEventListener("click", () => closeDialog($("[data-product-modal]"))));
  }

  // ---------- Хадгалсан бараа ----------

  let wishlist = storage.get(WISH_KEY, []);

  function toggleWish(id) {
    const on = !wishlist.includes(id);
    wishlist = on ? [...wishlist, id] : wishlist.filter((x) => x !== id);
    storage.set(WISH_KEY, wishlist);
    renderWishCount();
    renderFilters();
    if (state.category === "wishlist") renderProducts();
    $$(`[data-wish="${CSS.escape(id)}"]`).forEach((b) => {
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    });
    toast(on ? "Хадгаллаа ♥" : "Хадгалснаас хаслаа");
  }

  function renderWishCount() {
    const el = $("[data-wish-count]");
    el.textContent = wishlist.length;
    el.hidden = wishlist.length === 0;
  }

  // ---------- Бүтээгдэхүүний дэлгэрэнгүй (?product=<id>) ----------

  function openProduct(id, { push = true } = {}) {
    const p = productById[id];
    if (!p) return;
    const modal = $("[data-product-modal]");
    $("[data-product-detail]", modal).innerHTML = `
      <div class="detail-media">${media(p)}</div>
      <div class="detail-info">
        <span class="product-cat">${escapeHtml(categoryById[p.category]?.name)}</span>
        <h2>${escapeHtml(p.name)}</h2>
        <p class="price price-lg">${priceLabel(p)}</p>
        ${stockNote(p)}
        <p class="detail-desc">${escapeHtml(p.desc)}</p>
        <dl class="care">
          <div><dt>Арчилгаа</dt><dd>${escapeHtml(p.care)}</dd></div>
          <div><dt>Гэрэл</dt><dd>${escapeHtml(p.light)}</dd></div>
          <div><dt>Усалгаа</dt><dd>${escapeHtml(p.water)}</dd></div>
        </dl>
        <div class="detail-actions">
          ${p.price == null || soldOut(p) ? "" : `<input class="input qty" type="number" min="1" max="${maxQty(p)}" value="1" data-qty aria-label="Тоо ширхэг">`}
          ${actionButton(p)}
          ${heartButton(p)}
          <button class="btn btn-ghost btn-icon" type="button" data-share aria-label="Хуваалцах" title="Хуваалцах">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 15V4m0 0L8 8m4-4 4 4M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>`;
    bindProductActions(modal);
    $("[data-share]", modal).addEventListener("click", () => shareProduct(p));
    if (push && new URLSearchParams(location.search).get("product") !== id) {
      history.pushState({ product: id }, "", `?product=${encodeURIComponent(id)}`);
    }
    document.title = `${p.name} — ${shop.name}`;
    if (!modal.open) modal.showModal();
  }

  async function shareProduct(p) {
    const url = `${location.origin}${location.pathname}?product=${encodeURIComponent(p.id)}`;
    try {
      if (navigator.share) return await navigator.share({ title: p.name, url });
      await navigator.clipboard.writeText(url);
      toast("Холбоос хуулагдлаа");
    } catch {
      /* хэрэглэгч цуцалсан */
    }
  }

  function onProductClosed() {
    document.title = `${shop.name} — Ургамал, цэцгийн дэлгүүр`;
    if (new URLSearchParams(location.search).has("product")) history.pushState(null, "", location.pathname);
  }

  function syncFromUrl() {
    const id = new URLSearchParams(location.search).get("product");
    const modal = $("[data-product-modal]");
    if (id && productById[id]) openProduct(id, { push: false });
    else if (modal.open) modal.close();
  }

  // ---------- Сагс ----------

  let cart = [];

  function loadCart() {
    cart = storage
      .get(CART_KEY, [])
      .filter((l) => productById[l.id] && productById[l.id].price != null && !soldOut(productById[l.id]))
      .map((l) => ({ id: l.id, qty: Math.min(l.qty, maxQty(productById[l.id])) }));
  }

  function saveCart() {
    storage.set(CART_KEY, cart);
    renderCart();
  }

  function addToCart(id, qty = 1) {
    const p = productById[id];
    const line = cart.find((l) => l.id === id);
    const wanted = (line ? line.qty : 0) + qty;
    const allowed = Math.min(wanted, maxQty(p));
    if (line) line.qty = allowed;
    else cart.push({ id, qty: allowed });
    saveCart();
    closeDialog($("[data-product-modal]"));
    toast(allowed < wanted ? `«${p.name}» ${maxQty(p)} ширхэг л үлдсэн байна` : `«${p.name}» сагсанд нэмэгдлээ`);
  }

  function setQty(id, qty) {
    if (qty <= 0) cart = cart.filter((l) => l.id !== id);
    else cart.find((l) => l.id === id).qty = Math.min(maxQty(productById[id]), qty);
    saveCart();
  }

  // Дүнгийн урьдчилсан тооцоо. Эцсийн дүнг сервер (эсвэл статик горимд энэ функц) тогтооно.
  function totals({ fulfillment = "delivery", discount = 0 } = {}) {
    const subtotal = cart.reduce((sum, l) => sum + productById[l.id].price * l.qty, 0);
    const delivery =
      subtotal === 0 || fulfillment === "pickup" || subtotal - discount >= shop.freeDeliveryFrom ? 0 : shop.deliveryFee;
    return {
      subtotal,
      discount,
      delivery,
      total: subtotal - discount + delivery,
      count: cart.reduce((n, l) => n + l.qty, 0),
    };
  }

  function renderCart() {
    const t = totals();
    $$("[data-cart-count]").forEach((el) => {
      el.textContent = t.count;
      el.hidden = t.count === 0;
    });

    $("[data-cart-items]").innerHTML = cart.length
      ? cart
          .map((l) => {
            const p = productById[l.id];
            return `<div class="cart-line">
              <div class="cart-thumb">${media(p)}</div>
              <div class="cart-info">
                <strong>${escapeHtml(p.name)}</strong>
                <span class="muted">${formatPrice(p.price)}</span>
                <div class="stepper">
                  <button type="button" data-step="-1" data-id="${p.id}" aria-label="Хасах">−</button>
                  <span>${l.qty}</span>
                  <button type="button" data-step="1" data-id="${p.id}" aria-label="Нэмэх" ${l.qty >= maxQty(p) ? "disabled" : ""}>+</button>
                </div>
              </div>
              <div class="cart-line-end">
                <strong>${formatPrice(p.price * l.qty)}</strong>
                <button type="button" class="link muted" data-remove="${p.id}">Устгах</button>
              </div>
            </div>`;
          })
          .join("")
      : `<p class="empty">Таны сагс хоосон байна.</p>`;

    $("[data-cart-subtotal]").textContent = formatPrice(t.subtotal);
    $("[data-cart-delivery]").textContent = t.subtotal === 0 ? "—" : t.delivery === 0 ? "Үнэгүй" : formatPrice(t.delivery);
    $("[data-cart-total]").textContent = formatPrice(t.total);
    $("[data-delivery-hint]").textContent =
      t.subtotal > 0 && t.subtotal < shop.freeDeliveryFrom
        ? `${formatPrice(shop.freeDeliveryFrom - t.subtotal)}-ийн бараа нэмбэл хүргэлт үнэгүй.`
        : "";
    $("[data-checkout]").disabled = cart.length === 0;

    $$("[data-step]").forEach((b) =>
      b.addEventListener("click", () => {
        const line = cart.find((l) => l.id === b.dataset.id);
        setQty(b.dataset.id, line.qty + Number(b.dataset.step));
      })
    );
    $$("[data-remove]").forEach((b) => b.addEventListener("click", () => setQty(b.dataset.remove, 0)));
  }

  function openCart() {
    $("[data-cart]").classList.add("open");
    $("[data-cart]").setAttribute("aria-hidden", "false");
    $("[data-cart-backdrop]").hidden = false;
    document.body.classList.add("no-scroll");
  }

  function closeCart() {
    $("[data-cart]").classList.remove("open");
    $("[data-cart]").setAttribute("aria-hidden", "true");
    $("[data-cart-backdrop]").hidden = true;
    document.body.classList.remove("no-scroll");
  }

  // ---------- Захиалга: хүргэлт, промо, дүн ----------

  const methodById = Object.fromEntries(PAYMENT_METHODS.map((m) => [m.id, m]));
  const checkout = { promo: null, quote: null };

  const form = () => $("[data-checkout-form]");
  const fulfillment = () => (form().fulfillment.value === "pickup" ? "pickup" : "delivery");

  // "invoice" — QPay нэхэмжлэх, "redirect" — Голомт хуудас, "static-qr" — тогтмол QR, "manual" — гар баталгаажуулалт
  function methodMode(m) {
    if (m.requires === "qpay") return config.qpay ? "invoice" : shop.qpayStaticQr ? "static-qr" : null;
    if (m.requires === "golomt") return config.golomt ? "redirect" : null;
    return m.manual ? "manual" : null;
  }

  function payLogo(id) {
    const text = { qpay: "QPay", socialpay: "Social", card: "VISA", transfer: "₮", storepay: "Store", cash: "Бэлэн" }[id];
    return `<span>${text}</span>`;
  }

  function renderPaymentMethods(total) {
    const box = $("[data-payment-methods]");
    const current = box.querySelector("input:checked")?.value;
    const available = PAYMENT_METHODS.filter(methodMode);
    const usable = (m) => !m.minAmount || total >= m.minAmount;
    const selected = available.find((m) => m.id === current && usable(m)) || available.find(usable);

    box.innerHTML = available
      .map((m) => {
        const disabled = !usable(m);
        return `<label class="pay-option${disabled ? " is-disabled" : ""}">
          <input type="radio" name="method" value="${m.id}" ${m === selected ? "checked" : ""} ${disabled ? "disabled" : ""} required>
          <span class="pay-logo pay-${m.id}" aria-hidden="true">${payLogo(m.id)}</span>
          <span class="pay-text">
            <strong>${escapeHtml(m.name)}</strong>
            <small>${escapeHtml(disabled ? `${formatPrice(m.minAmount)}-с дээш захиалгад боломжтой.` : m.note)}</small>
          </span>
        </label>`;
      })
      .join("");
  }

  function currentTotals() {
    if (checkout.quote) return checkout.quote;
    return totals({ fulfillment: fulfillment(), discount: checkout.promo?.discount || 0 });
  }

  function renderCheckoutSummary() {
    const t = currentTotals();
    $("[data-checkout-summary]").innerHTML = `
      <ul>${cart.map((l) => `<li><span>${escapeHtml(productById[l.id].name)} × ${l.qty}</span><span>${formatPrice(productById[l.id].price * l.qty)}</span></li>`).join("")}</ul>
      ${t.discount ? `<div class="summary-row discount"><span>Хөнгөлөлт (${escapeHtml(checkout.promo.code)})</span><span>−${formatPrice(t.discount)}</span></div>` : ""}
      <div class="summary-row muted"><span>${fulfillment() === "pickup" ? "Очиж авах" : "Хүргэлт"}</span><span>${t.delivery === 0 ? "Үнэгүй" : formatPrice(t.delivery)}</span></div>
      <div class="summary-row total"><span>Нийт</span><strong>${formatPrice(t.total)}</strong></div>`;
    renderPaymentMethods(t.total);
  }

  // Сервертэй үед дүнг серверээр баталгаажуулна (промо, үлдэгдэл).
  async function refreshQuote() {
    checkout.quote = null;
    if (config.server) {
      try {
        const res = await fetch("api/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: cart, fulfillment: fulfillment(), promoCode: checkout.promo?.code || "" }),
        });
        const body = await res.json();
        if (res.ok) checkout.quote = body;
        else showFormError(body.error);
      } catch {
        /* урьдчилсан тооцоогоор үргэлжилнэ */
      }
    }
    renderCheckoutSummary();
  }

  async function applyPromo() {
    const input = $("[data-promo-input]");
    const msg = $("[data-promo-msg]");
    const code = input.value.trim().toUpperCase();
    if (checkout.promo) {
      checkout.promo = null;
      input.value = "";
      input.disabled = false;
      $("[data-promo-apply]").textContent = "Хэрэглэх";
      msg.textContent = "";
      return refreshQuote();
    }
    if (!code) return;
    try {
      const res = await fetch("api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: cart, fulfillment: fulfillment(), promoCode: code }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      checkout.promo = body.promo;
      checkout.quote = body;
      input.disabled = true;
      $("[data-promo-apply]").textContent = "Цуцлах";
      msg.className = "promo-msg ok";
      msg.textContent = `${body.promo.label} хөнгөлөлт: −${formatPrice(body.discount)}`;
      renderCheckoutSummary();
    } catch (err) {
      msg.className = "promo-msg error";
      msg.textContent = err.message || "Промо код шалгахад алдаа гарлаа";
    }
  }

  function updateFulfillmentUI() {
    const pickup = fulfillment() === "pickup";
    const address = $("[data-address-field]");
    address.hidden = pickup;
    address.querySelector("input").required = !pickup;
    $("[data-date-label]").textContent = pickup ? "Очиж авах огноо" : "Хүргэх огноо";
  }

  function openCheckout() {
    closeCart();
    const modal = $("[data-checkout-modal]");
    const f = form();
    f.hidden = false;
    $("[data-confirmation]").hidden = true;
    $("[data-form-error]").hidden = true;

    const tomorrow = new Date(Date.now() + 864e5);
    f.date.min = new Date().toISOString().slice(0, 10);
    if (!f.date.value) f.date.value = tomorrow.toISOString().slice(0, 10);

    $("[data-fulfillment-group]").hidden = !shop.pickupEnabled;
    if (!shop.pickupEnabled) f.fulfillment.value = "delivery";
    $("[data-delivery-info]").textContent =
      `${shop.deliveryArea || ""} · ${formatPrice(shop.deliveryFee)}, ${formatPrice(shop.freeDeliveryFrom)}-с дээш үнэгүй`.replace(/^ · /, "");
    $("[data-pickup-info]").textContent = shop.pickupAddress || "";
    $("[data-promo]").hidden = !config.server;
    updateFulfillmentUI();

    renderCheckoutSummary();
    modal.showModal();
    refreshQuote();
  }

  function showFormError(message) {
    const error = $("[data-form-error]");
    error.textContent = message;
    error.hidden = !message;
  }

  async function submitOrder(e) {
    e.preventDefault();
    const f = e.currentTarget;
    showFormError("");
    if (!f.checkValidity()) {
      showFormError("Нэр, утас, хаяг, огноо, төлбөрийн хэлбэрээ зөв бөглөнө үү.");
      f.querySelector(":invalid")?.focus();
      return;
    }

    const data = Object.fromEntries(new FormData(f));
    const method = methodById[data.method];
    const mode = methodMode(method);
    const items = cart.map((l) => ({ id: l.id, qty: l.qty }));
    const submit = f.querySelector("[type=submit]");
    let order;
    let qpayInvoice = null;

    if (config.server) {
      submit.disabled = true;
      submit.textContent = "Илгээж байна…";
      try {
        const res = await fetch("api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items, customer: data, method: method.id, fulfillment: fulfillment(), promoCode: checkout.promo?.code || "" }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Захиалга илгээхэд алдаа гарлаа");
        order = body.order;
        qpayInvoice = body.qpay || null;
        rememberOrder(order, data.phone);
        if (body.redirectUrl) {
          clearCart(f);
          location.href = body.redirectUrl;
          return;
        }
      } catch (err) {
        showFormError(err.message || "Сүлжээний алдаа. Дахин оролдоно уу.");
        return;
      } finally {
        submit.disabled = false;
        submit.textContent = "Захиалга баталгаажуулах";
      }
    } else {
      const t = currentTotals();
      order = {
        number: "LFC-" + Array.from(crypto.getRandomValues(new Uint8Array(7)), (b) => "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"[b % 32]).join(""),
        status: "pending",
        method: method.id,
        methodName: method.name,
        fulfillment: fulfillment(),
        ...t,
        items: cart.map((l) => ({ name: productById[l.id].name, qty: l.qty, price: productById[l.id].price })),
      };
      rememberOrder(order, data.phone);
    }

    const summaryText = [
      `Захиалга ${order.number}`,
      ...order.items.map((i) => `- ${i.name} × ${i.qty} = ${formatPrice(i.price * i.qty)}`),
      order.discount ? `Хөнгөлөлт: −${formatPrice(order.discount)}` : "",
      order.fulfillment === "pickup" ? "Очиж авна" : `Хүргэлт: ${order.delivery === 0 ? "Үнэгүй" : formatPrice(order.delivery)}`,
      `Нийт: ${formatPrice(order.total)}`,
      `Нэр: ${data.name}, Утас: ${data.phone}`,
      order.fulfillment === "pickup" ? "" : `Хаяг: ${data.address}`,
      `Огноо: ${data.date}, Төлбөр: ${method.name}`,
      data.note ? `Тайлбар: ${data.note}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    clearCart(f);
    if (qpayInvoice) showQPayStep(order, qpayInvoice);
    else showConfirmation(order, mode, summaryText, data.phone);
  }

  function rememberOrder(order, phone) {
    const list = storage.get(ORDERS_KEY, []).filter((o) => o.number !== order.number);
    storage.set(ORDERS_KEY, [{ number: order.number, phone, total: order.total, createdAt: new Date().toISOString() }, ...list].slice(0, 20));
  }

  function clearCart(f) {
    cart = [];
    saveCart();
    f.reset();
    f.hidden = true;
    checkout.promo = null;
    checkout.quote = null;
    $("[data-promo-input]").disabled = false;
    $("[data-promo-apply]").textContent = "Хэрэглэх";
    $("[data-promo-msg]").textContent = "";
  }

  // ---------- Төлбөрийн алхам ----------

  function showPanel(html) {
    const panel = $("[data-confirmation]");
    panel.innerHTML = html;
    panel.hidden = false;
    form().hidden = true;
    const modal = $("[data-checkout-modal]");
    if (!modal.open) modal.showModal();
    $$("[data-close]", panel).forEach((b) => b.addEventListener("click", () => closeDialog(modal)));
    $$("[data-copy-text]", panel).forEach((b) =>
      b.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(b.dataset.copyText);
          toast("Хуулагдлаа");
        } catch {
          toast(b.dataset.copyText);
        }
      })
    );
    return panel;
  }

  const copyButton = (text, label = "Хуулах") =>
    `<button class="btn btn-ghost btn-small" type="button" data-copy-text="${escapeHtml(text)}">${label}</button>`;

  function paymentInstructions(order, mode) {
    const amount = formatPrice(order.total);
    if (order.method === "transfer") {
      return `<div class="pay-box">
        <p>Доорх дансны аль нэг рүү <strong>${amount}</strong> шилжүүлж, гүйлгээний утга дээр <strong>${order.number}</strong> гэж бичнэ үү.</p>
        ${(shop.bankAccounts || [])
          .map(
            (a) => `<div class="bank-row">
              <span>${escapeHtml(a.bank)} · ${escapeHtml(a.holder)}<br><span class="bank-acc">${escapeHtml(a.account)}</span></span>
              ${copyButton(a.account)}
            </div>`
          )
          .join("")}
        <div class="bank-row"><span>Гүйлгээний утга<br><span class="bank-acc">${order.number}</span></span>${copyButton(order.number)}</div>
      </div>`;
    }
    if (order.method === "qpay" && mode === "static-qr") {
      return `<div class="pay-box center">
        <img class="qr" src="${escapeHtml(shop.qpayStaticQr)}" alt="QPay QR код">
        <p>Банкны апп-аараа QR уншуулж <strong>${amount}</strong> төлнө үү. Гүйлгээний утга: <strong>${order.number}</strong></p>
      </div>`;
    }
    if (order.method === "storepay") {
      return `<div class="pay-box"><p>Бид таны Storepay-д бүртгэлтэй утасны дугаар руу <strong>${amount}</strong>-ийн нэхэмжлэх илгээнэ. Storepay апп-аа нээж зөвшөөрснөөр захиалга баталгаажна.</p></div>`;
    }
    if (order.method === "cash") {
      return `<div class="pay-box"><p>Бараагаа хүлээн авахдаа <strong>${amount}</strong>-ийг бэлнээр эсвэл картаар төлнө.</p></div>`;
    }
    return "";
  }

  function showConfirmation(order, mode, summaryText, phone) {
    showPanel(`
      <div class="confirm-icon" aria-hidden="true">✓</div>
      <h2>Захиалга хүлээн авлаа</h2>
      <p>Захиалгын дугаар: <strong>${order.number}</strong></p>
      ${paymentInstructions(order, mode)}
      ${order.fulfillment === "pickup" && shop.pickupAddress ? `<p>Очиж авах хаяг: <strong>${escapeHtml(shop.pickupAddress)}</strong></p>` : ""}
      <p class="muted">Бид удахгүй ${escapeHtml(phone)} дугаарт холбогдож захиалгыг баталгаажуулна. Яаралтай бол ${escapeHtml(shop.phone)} руу залгаарай.</p>
      <details class="order-details">
        <summary>Захиалгын дэлгэрэнгүй</summary>
        <textarea class="input order-text" rows="8" readonly>${escapeHtml(summaryText)}</textarea>
      </details>
      <div class="detail-actions">
        ${copyButton(summaryText, "Захиалга хуулах")}
        <button class="btn btn-primary" type="button" data-close>Дуусгах</button>
      </div>`);
  }

  function showQPayStep(order, invoice) {
    const panel = showPanel(`
      <h2>QPay-ээр төлөх</h2>
      <p>Захиалга <strong>${order.number}</strong> · Нийт <strong>${formatPrice(order.total)}</strong></p>
      <div class="pay-box center">
        <img class="qr" src="data:image/png;base64,${escapeHtml(invoice.qrImage)}" alt="QPay QR код">
        <p class="muted">Банкны апп-аараа QR кодыг уншуулна уу. Утсаар үзэж байгаа бол доороос банкаа сонгоно уу.</p>
      </div>
      <div class="bank-apps">
        ${invoice.urls
          .map(
            (u) => `<a class="bank-app" href="${escapeHtml(u.link)}" rel="noopener">
              <img src="${escapeHtml(u.logo)}" alt="" loading="lazy"><span>${escapeHtml(u.description || u.name)}</span>
            </a>`
          )
          .join("")}
      </div>
      <p class="form-error" data-pay-status hidden></p>
      <div class="detail-actions">
        <button class="btn btn-primary" type="button" data-check-payment>Төлбөр шалгах</button>
        <button class="btn btn-ghost" type="button" data-close>Дараа төлөх</button>
      </div>`);

    $("[data-check-payment]", panel).addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const status = $("[data-pay-status]", panel);
      btn.disabled = true;
      btn.textContent = "Шалгаж байна…";
      try {
        const res = await fetch(`api/orders/${order.number}?check=1`);
        const latest = await res.json();
        if (latest.status === "paid") return showPaid(latest);
        status.textContent = "Төлбөр хараахан орж ирээгүй байна. Төлсний дараа дахин шалгана уу.";
      } catch {
        status.textContent = "Шалгах үед алдаа гарлаа. Дахин оролдоно уу.";
      }
      status.hidden = false;
      btn.disabled = false;
      btn.textContent = "Төлбөр шалгах";
    });
  }

  function showPaid(order) {
    showPanel(`
      <div class="confirm-icon" aria-hidden="true">✓</div>
      <h2>Төлбөр амжилттай</h2>
      <p>Захиалга <strong>${escapeHtml(order.number)}</strong> · ${formatPrice(order.total)}</p>
      <p class="muted">Баярлалаа! Бид удахгүй холбогдож хүргэлтийг тохиролцоно.</p>
      <div class="detail-actions"><button class="btn btn-primary" type="button" data-close>Дуусгах</button></div>`);
  }

  // Голомт банкны хуудаснаас буцаж ирэх үед (?order=...&payment=paid|failed)
  async function handlePaymentReturn() {
    const params = new URLSearchParams(location.search);
    const number = params.get("order");
    if (!number || !params.get("payment")) return;
    history.replaceState(null, "", location.pathname + location.hash);
    try {
      const res = await fetch(`api/orders/${encodeURIComponent(number)}`);
      const order = await res.json();
      if (order.status === "paid") return showPaid(order);
    } catch {
      /* доорх мессежийг харуулна */
    }
    showPanel(`
      <h2>Төлбөр амжилтгүй</h2>
      <p>Захиалга <strong>${escapeHtml(number)}</strong>-ийн төлбөр баталгаажсангүй.</p>
      <p class="muted">Дахин оролдох эсвэл ${escapeHtml(shop.phone)} дугаарт холбогдоно уу.</p>
      <div class="detail-actions"><button class="btn btn-primary" type="button" data-close>Хаах</button></div>`);
  }

  // ---------- Захиалга хянах ----------

  function openTrack(prefill = {}) {
    const modal = $("[data-track-modal]");
    const f = $("[data-track-form]", modal);
    if (prefill.number) f.number.value = prefill.number;
    if (prefill.phone) f.phone.value = prefill.phone;
    $("[data-track-result]", modal).innerHTML = config.server
      ? ""
      : `<p class="muted">Захиалгын төлвийг ${escapeHtml(shop.phone)} дугаарт залгаж лавлана уу.</p>`;
    f.hidden = !config.server;

    const mine = storage.get(ORDERS_KEY, []).filter((o) => o.number && o.phone);
    $("[data-my-orders]", modal).innerHTML = mine.length && config.server
      ? `<h3 class="sub-title">Энэ төхөөрөмжөөс өгсөн захиалга</h3>
         <ul class="my-orders">${mine
           .map(
             (o) => `<li><button class="link" type="button" data-track-number="${escapeHtml(o.number)}" data-track-phone="${escapeHtml(o.phone)}">
               <strong>${escapeHtml(o.number)}</strong> <span class="muted">${new Date(o.createdAt).toLocaleDateString("mn-MN")} · ${formatPrice(o.total)}</span></button></li>`
           )
           .join("")}</ul>`
      : "";
    $$("[data-track-number]", modal).forEach((b) =>
      b.addEventListener("click", () => {
        f.number.value = b.dataset.trackNumber;
        f.phone.value = b.dataset.trackPhone;
        f.requestSubmit();
      })
    );
    if (!modal.open) modal.showModal();
    if (prefill.number && prefill.phone) f.requestSubmit();
  }

  async function submitTrack(e) {
    e.preventDefault();
    const f = e.currentTarget;
    const result = $("[data-track-result]");
    const params = new URLSearchParams({ number: f.number.value.trim().toUpperCase(), phone: f.phone.value.trim() });
    result.innerHTML = `<p class="muted">Хайж байна…</p>`;
    try {
      const res = await fetch(`api/orders/track?${params}`);
      const order = await res.json();
      if (!res.ok) throw new Error(order.error);
      const steps = order.status === "cancelled" ? ["pending", "cancelled"] : ["pending", "paid", "delivering", "completed"];
      const reached = new Set((order.history || []).map((h) => h.status).concat(order.status));
      result.innerHTML = `
        <div class="track-card">
          <div class="track-head">
            <strong>${escapeHtml(order.number)}</strong>
            <span class="status status-${order.status}">${ORDER_STATUS[order.status]}</span>
          </div>
          <ol class="timeline">${steps
            .map((s) => {
              const h = (order.history || []).find((x) => x.status === s);
              return `<li class="${reached.has(s) ? "done" : ""}"><span>${ORDER_STATUS[s]}</span>${h ? `<small>${new Date(h.at).toLocaleString("mn-MN")}</small>` : ""}</li>`;
            })
            .join("")}</ol>
          <ul class="track-items">${order.items.map((i) => `<li><span>${escapeHtml(i.name)} × ${i.qty}</span><span>${formatPrice(i.price * i.qty)}</span></li>`).join("")}</ul>
          ${order.discount ? `<div class="summary-row discount"><span>Хөнгөлөлт</span><span>−${formatPrice(order.discount)}</span></div>` : ""}
          <div class="summary-row muted"><span>${order.fulfillment === "pickup" ? "Очиж авах" : "Хүргэлт"}</span><span>${order.delivery ? formatPrice(order.delivery) : "Үнэгүй"}</span></div>
          <div class="summary-row total"><span>Нийт · ${escapeHtml(order.methodName || "")}</span><strong>${formatPrice(order.total)}</strong></div>
        </div>`;
    } catch (err) {
      result.innerHTML = `<p class="form-error">${escapeHtml(err.message || "Алдаа гарлаа")}</p>`;
    }
  }

  // ---------- Мэдээллийн хуудас ----------

  function renderPageLinks() {
    const ul = $("[data-page-links]");
    ul.insertAdjacentHTML(
      "beforeend",
      pages.map((p) => `<li><button class="link" type="button" data-page="${escapeHtml(p.id)}">${escapeHtml(p.title)}</button></li>`).join("")
    );
    $$("[data-page]", ul).forEach((b) => b.addEventListener("click", () => openPage(b.dataset.page)));
  }

  function openPage(id) {
    const page = pages.find((p) => p.id === id);
    if (!page) return;
    const modal = $("[data-page-modal]");
    $("[data-page-body]", modal).innerHTML = `<h2>${escapeHtml(page.title)}</h2>${page.body.map((t) => `<p>${escapeHtml(t)}</p>`).join("")}`;
    modal.showModal();
  }

  // ---------- Туслах ----------

  function closeDialog(dialog) {
    if (dialog?.open) dialog.close();
  }

  let toastTimer;
  function toast(message) {
    const el = $("[data-toast]");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
  }

  function fillShopInfo() {
    $$("[data-shop]").forEach((el) => (el.textContent = shop[el.dataset.shop] || ""));
    $$("[data-shop-link]").forEach((el) => {
      const key = el.dataset.shopLink;
      el.textContent = shop[key] || "";
      el.href = key === "phone" ? "tel:" + String(shop.phone).replace(/[^\d+]/g, "") : "mailto:" + shop.email;
    });
    $$("[data-shop-href]").forEach((el) => {
      el.href = shop[el.dataset.shopHref] || "#";
      el.closest("li").hidden = !shop[el.dataset.shopHref];
    });
    $$(".brand-name").forEach((el) => (el.textContent = shop.name));
    $("[data-year]").textContent = new Date().getFullYear();
  }

  async function init() {
    await loadCatalog();
    loadCart();
    fillShopInfo();
    renderCategories();
    renderFilters();
    renderProducts();
    renderCart();
    renderWishCount();
    renderPageLinks();

    $("[data-search]").addEventListener("input", (e) => {
      state.query = e.target.value;
      renderProducts();
    });
    $("[data-sort]").addEventListener("change", (e) => {
      state.sort = e.target.value;
      renderProducts();
    });

    $$("[data-open-cart]").forEach((b) => b.addEventListener("click", openCart));
    $("[data-close-cart]").addEventListener("click", closeCart);
    $("[data-cart-backdrop]").addEventListener("click", closeCart);
    $("[data-checkout]").addEventListener("click", openCheckout);
    form().addEventListener("submit", submitOrder);
    $$("[name=fulfillment]").forEach((r) =>
      r.addEventListener("change", () => {
        updateFulfillmentUI();
        refreshQuote();
      })
    );
    $("[data-promo-apply]").addEventListener("click", applyPromo);
    $("[data-promo-input]").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        applyPromo();
      }
    });
    $$("[data-open-track]").forEach((b) => b.addEventListener("click", () => openTrack()));
    $("[data-track-form]").addEventListener("submit", submitTrack);
    $("[data-show-wishlist]").addEventListener("click", () => {
      setCategory("wishlist");
      $("#shop").scrollIntoView({ behavior: "smooth" });
    });

    $$("dialog.modal").forEach((d) => {
      $("[data-close]", d).addEventListener("click", () => d.close());
      d.addEventListener("click", (e) => {
        if (e.target === d) d.close();
      });
    });
    $("[data-product-modal]").addEventListener("close", onProductClosed);
    window.addEventListener("popstate", syncFromUrl);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeCart();
    });

    syncFromUrl();
    handlePaymentReturn();
  }

  init();
})();
