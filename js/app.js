(() => {
  "use strict";

  const CART_KEY = "lfc-cart";
  const ORDERS_KEY = "lfc-orders";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const productById = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));
  const categoryById = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

  const formatPrice = (n) => n.toLocaleString("en-US") + SHOP.currency;
  const priceLabel = (p) => (p.price == null ? "Үнэ тохиролцоно" : formatPrice(p.price));

  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

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
        /* хадгалах боломжгүй орчин — сагс зөвхөн санах ойд үлдэнэ */
      }
    },
  };

  // ---------- Зураг (бодит фото байхгүй үед ургамлын дүрслэл) ----------

  function illustration(p) {
    const [dark, light] = p.colors;
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
    const tone = categoryById[p.category]?.tone || "#eee";
    return `<svg viewBox="0 0 200 200" role="img" aria-label="${escapeHtml(p.name)}" preserveAspectRatio="xMidYMid slice">
      <rect width="200" height="200" fill="${tone}"/>${plant}${pot}</svg>`;
  }

  const media = (p) =>
    p.image ? `<img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" loading="lazy">` : illustration(p);

  // ---------- Ангилал ба шүүлтүүр ----------

  const state = { category: "all", query: "", sort: "default" };

  function renderCategories() {
    $("[data-categories]").innerHTML = CATEGORIES.map((c) => {
      const sample = PRODUCTS.find((p) => p.category === c.id);
      const count = PRODUCTS.filter((p) => p.category === c.id).length;
      return `<button class="category-card" type="button" data-category="${c.id}" style="--tone:${c.tone}">
        <span class="category-art">${sample ? media(sample) : ""}</span>
        <span class="category-text">
          <strong>${escapeHtml(c.name)}</strong>
          <span>${escapeHtml(c.blurb)}</span>
          ${c.tags ? `<em>${c.tags.join(" ")}</em>` : ""}
          <small>${count} бүтээгдэхүүн</small>
        </span>
      </button>`;
    }).join("");

    $$("[data-category]").forEach((btn) =>
      btn.addEventListener("click", () => {
        setCategory(btn.dataset.category);
        $("#shop").scrollIntoView({ behavior: "smooth" });
      })
    );
  }

  function renderFilters() {
    const chips = [{ id: "all", name: "Бүгд" }, ...CATEGORIES];
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
    let list = PRODUCTS.filter((p) => state.category === "all" || p.category === state.category);
    if (q) {
      list = list.filter((p) =>
        [p.name, p.desc, p.badge, categoryById[p.category].name].join(" ").toLowerCase().includes(q)
      );
    }
    const priceOf = (p, missing) => (p.price == null ? missing : p.price);
    if (state.sort === "price-asc") list = [...list].sort((a, b) => priceOf(a, Infinity) - priceOf(b, Infinity));
    if (state.sort === "price-desc") list = [...list].sort((a, b) => priceOf(b, -1) - priceOf(a, -1));
    if (state.sort === "name") list = [...list].sort((a, b) => a.name.localeCompare(b.name, "mn"));
    return list;
  }

  function renderProducts() {
    const list = visibleProducts();
    $("[data-empty]").hidden = list.length > 0;
    $("[data-products]").innerHTML = list
      .map(
        (p) => `<article class="product-card">
          <button class="product-media" type="button" data-view="${p.id}" aria-label="${escapeHtml(p.name)} дэлгэрэнгүй">
            ${media(p)}
            ${p.badge ? `<span class="badge">${escapeHtml(p.badge)}</span>` : ""}
          </button>
          <div class="product-body">
            <span class="product-cat">${escapeHtml(categoryById[p.category].name)}</span>
            <h3><button type="button" class="link" data-view="${p.id}">${escapeHtml(p.name)}</button></h3>
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
    return p.price == null
      ? `<a class="btn btn-ghost ${extra}" href="#contact" data-inquire>Асуух</a>`
      : `<button class="btn btn-primary ${extra}" type="button" data-add="${p.id}">Сагслах</button>`;
  }

  function bindProductActions(root) {
    $$("[data-view]", root).forEach((el) => el.addEventListener("click", () => openProduct(el.dataset.view)));
    $$("[data-add]", root).forEach((el) =>
      el.addEventListener("click", () => {
        const qtyInput = $("[data-qty]", root);
        addToCart(el.dataset.add, qtyInput ? Math.max(1, parseInt(qtyInput.value, 10) || 1) : 1);
      })
    );
    $$("[data-inquire]", root).forEach((el) => el.addEventListener("click", () => closeDialog($("[data-product-modal]"))));
  }

  // ---------- Бүтээгдэхүүний дэлгэрэнгүй ----------

  function openProduct(id) {
    const p = productById[id];
    const modal = $("[data-product-modal]");
    $("[data-product-detail]", modal).innerHTML = `
      <div class="detail-media">${media(p)}</div>
      <div class="detail-info">
        <span class="product-cat">${escapeHtml(categoryById[p.category].name)}</span>
        <h2>${escapeHtml(p.name)}</h2>
        <p class="price price-lg">${priceLabel(p)}</p>
        <p>${escapeHtml(p.desc)}</p>
        <dl class="care">
          <div><dt>Арчилгаа</dt><dd>${escapeHtml(p.care)}</dd></div>
          <div><dt>Гэрэл</dt><dd>${escapeHtml(p.light)}</dd></div>
          <div><dt>Усалгаа</dt><dd>${escapeHtml(p.water)}</dd></div>
        </dl>
        <div class="detail-actions">
          ${p.price == null ? "" : `<input class="input qty" type="number" min="1" max="99" value="1" data-qty aria-label="Тоо ширхэг">`}
          ${actionButton(p)}
        </div>
      </div>`;
    bindProductActions(modal);
    modal.showModal();
  }

  // ---------- Сагс ----------

  let cart = storage.get(CART_KEY, []).filter((line) => productById[line.id]);

  function saveCart() {
    storage.set(CART_KEY, cart);
    renderCart();
  }

  function addToCart(id, qty = 1) {
    const line = cart.find((l) => l.id === id);
    if (line) line.qty = Math.min(99, line.qty + qty);
    else cart.push({ id, qty });
    saveCart();
    closeDialog($("[data-product-modal]"));
    toast(`«${productById[id].name}» сагсанд нэмэгдлээ`);
  }

  function setQty(id, qty) {
    if (qty <= 0) cart = cart.filter((l) => l.id !== id);
    else cart.find((l) => l.id === id).qty = Math.min(99, qty);
    saveCart();
  }

  function totals() {
    const subtotal = cart.reduce((sum, l) => sum + productById[l.id].price * l.qty, 0);
    const delivery = subtotal === 0 || subtotal >= SHOP.freeDeliveryFrom ? 0 : SHOP.deliveryFee;
    return { subtotal, delivery, total: subtotal + delivery, count: cart.reduce((n, l) => n + l.qty, 0) };
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
                  <button type="button" data-step="1" data-id="${p.id}" aria-label="Нэмэх">+</button>
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
      t.subtotal > 0 && t.subtotal < SHOP.freeDeliveryFrom
        ? `${formatPrice(SHOP.freeDeliveryFrom - t.subtotal)}-ийн бараа нэмбэл хүргэлт үнэгүй.`
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

  // ---------- Захиалга ----------

  function openCheckout() {
    closeCart();
    const t = totals();
    const modal = $("[data-checkout-modal]");
    const form = $("[data-checkout-form]");
    form.hidden = false;
    $("[data-confirmation]").hidden = true;
    $("[data-form-error]").hidden = true;

    const tomorrow = new Date(Date.now() + 864e5);
    form.date.min = new Date().toISOString().slice(0, 10);
    if (!form.date.value) form.date.value = tomorrow.toISOString().slice(0, 10);

    $("[data-checkout-summary]").innerHTML = `
      <ul>${cart.map((l) => `<li><span>${escapeHtml(productById[l.id].name)} × ${l.qty}</span><span>${formatPrice(productById[l.id].price * l.qty)}</span></li>`).join("")}</ul>
      <div class="summary-row muted"><span>Хүргэлт</span><span>${t.delivery === 0 ? "Үнэгүй" : formatPrice(t.delivery)}</span></div>
      <div class="summary-row total"><span>Нийт</span><strong>${formatPrice(t.total)}</strong></div>`;
    modal.showModal();
  }

  function submitOrder(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const error = $("[data-form-error]");
    if (!form.checkValidity()) {
      error.textContent = "Нэр, утас, хаяг, хүргэх огноогоо зөв бөглөнө үү.";
      error.hidden = false;
      form.querySelector(":invalid")?.focus();
      return;
    }

    const data = Object.fromEntries(new FormData(form));
    const t = totals();
    const order = {
      number: "LFC-" + Date.now().toString(36).toUpperCase(),
      createdAt: new Date().toISOString(),
      customer: data,
      items: cart.map((l) => ({ id: l.id, name: productById[l.id].name, qty: l.qty, price: productById[l.id].price })),
      ...t,
    };
    storage.set(ORDERS_KEY, [...storage.get(ORDERS_KEY, []), order]);

    const summaryText = [
      `Захиалга ${order.number}`,
      ...order.items.map((i) => `- ${i.name} × ${i.qty} = ${formatPrice(i.price * i.qty)}`),
      `Хүргэлт: ${t.delivery === 0 ? "Үнэгүй" : formatPrice(t.delivery)}`,
      `Нийт: ${formatPrice(t.total)}`,
      `Нэр: ${data.name}, Утас: ${data.phone}`,
      `Хаяг: ${data.address}`,
      `Огноо: ${data.date}, Төлбөр: ${data.payment}`,
      data.note ? `Тайлбар: ${data.note}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    cart = [];
    saveCart();
    form.reset();
    form.hidden = true;

    const confirmation = $("[data-confirmation]");
    confirmation.innerHTML = `
      <div class="confirm-icon" aria-hidden="true">✓</div>
      <h2>Захиалга хүлээн авлаа</h2>
      <p>Захиалгын дугаар: <strong>${order.number}</strong></p>
      <p class="muted">Бид удахгүй ${escapeHtml(data.phone)} дугаарт холбогдож захиалгыг баталгаажуулна. Яаралтай бол ${escapeHtml(SHOP.phone)} руу залгаарай.</p>
      <textarea class="input order-text" rows="8" readonly>${escapeHtml(summaryText)}</textarea>
      <div class="detail-actions">
        <button class="btn btn-ghost" type="button" data-copy>Хуулах</button>
        <button class="btn btn-primary" type="button" data-close>Дуусгах</button>
      </div>`;
    confirmation.hidden = false;
    $("[data-copy]", confirmation).addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(summaryText);
        toast("Захиалгын мэдээлэл хуулагдлаа");
      } catch {
        $(".order-text", confirmation).select();
      }
    });
    $("[data-close]", confirmation).addEventListener("click", () => closeDialog($("[data-checkout-modal]")));
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
    $$("[data-shop]").forEach((el) => (el.textContent = SHOP[el.dataset.shop]));
    $$("[data-shop-link]").forEach((el) => {
      const key = el.dataset.shopLink;
      el.textContent = SHOP[key];
      el.href = (key === "phone" ? "tel:" + SHOP.phone.replace(/[^\d+]/g, "") : "mailto:" + SHOP.email);
    });
    $$("[data-shop-href]").forEach((el) => (el.href = SHOP[el.dataset.shopHref]));
    $("[data-year]").textContent = new Date().getFullYear();
  }

  function init() {
    fillShopInfo();
    renderCategories();
    renderFilters();
    renderProducts();
    renderCart();

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
    $("[data-checkout-form]").addEventListener("submit", submitOrder);

    $$("dialog.modal").forEach((d) => {
      $("[data-close]", d).addEventListener("click", () => d.close());
      d.addEventListener("click", (e) => {
        if (e.target === d) d.close();
      });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeCart();
    });
  }

  init();
})();
