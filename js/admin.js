(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const { escapeHtml: esc, formatPrice, ORDER_STATUS } = LFC;

  const view = $("[data-view]");
  let categories = CATEGORIES;
  const categoryName = (id) => categories.find((c) => c.id === id)?.name || id;
  const tone = (id) => categories.find((c) => c.id === id)?.tone;
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString("mn-MN", { dateStyle: "short", timeStyle: "short" }) : "");

  // ---------- API ----------

  async function api(path, { method = "GET", body } = {}) {
    const res = await fetch(`api/admin/${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== "login") {
      showLogin();
      throw new Error(data.error || "Нэвтэрнэ үү");
    }
    if (!res.ok) throw new Error(data.error || `Алдаа (${res.status})`);
    return data;
  }

  let toastTimer;
  function toast(message, isError = false) {
    const el = $("[data-toast]");
    el.textContent = message;
    el.classList.toggle("error", isError);
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  // ---------- Нэвтрэлт ----------

  function showLogin(message) {
    $("[data-shell]").hidden = true;
    $("[data-login]").hidden = false;
    const err = $("[data-login-error]");
    err.textContent = message || "";
    err.hidden = !message;
    $("[data-login-form]").password.focus();
  }

  async function onLogin(e) {
    e.preventDefault();
    const f = e.currentTarget;
    try {
      await api("login", { method: "POST", body: { password: f.password.value } });
      f.reset();
      start();
    } catch (err) {
      showLogin(err.message);
    }
  }

  async function logout() {
    await api("logout", { method: "POST", body: {} }).catch(() => {});
    showLogin();
  }

  // ---------- Router ----------

  const TABS = { dashboard: renderDashboard, orders: renderOrders, products: renderProducts, promos: renderPromos, settings: renderSettings };

  async function route() {
    const tab = TABS[location.hash.slice(1)] ? location.hash.slice(1) : "dashboard";
    $$("[data-tab]").forEach((a) => a.classList.toggle("active", a.dataset.tab === tab));
    view.innerHTML = `<p class="muted">Ачаалж байна…</p>`;
    try {
      await TABS[tab]();
    } catch (err) {
      view.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
    }
  }

  async function start() {
    try {
      await api("me");
    } catch (err) {
      return showLogin(/идэвхгүй/.test(err.message) ? err.message : "");
    }
    $("[data-login]").hidden = true;
    $("[data-shell]").hidden = false;
    route();
  }

  function updatePendingBadge(count) {
    const el = $("[data-pending-count]");
    el.textContent = count;
    el.hidden = !count;
  }

  // ---------- Тойм ----------

  async function renderDashboard() {
    const d = await api("dashboard");
    updatePendingBadge(d.byStatus.pending);
    view.innerHTML = `
      <header class="view-head"><h1>Тойм</h1></header>
      <div class="stats">
        <div class="stat"><span>Өнөөдрийн орлого</span><strong>${formatPrice(d.revenueToday)}</strong></div>
        <div class="stat"><span>Энэ сарын орлого</span><strong>${formatPrice(d.revenueMonth)}</strong></div>
        <div class="stat"><span>Нийт орлого</span><strong>${formatPrice(d.revenueTotal)}</strong></div>
        <div class="stat"><span>Нийт захиалга</span><strong>${d.orderCount}</strong></div>
      </div>
      <p class="muted small">Орлогод төлөгдсөн, хүргэлтэнд гарсан, хүлээлгэн өгсөн захиалгууд орно.</p>
      <div class="panels">
        <section class="panel">
          <h2>Захиалгын төлөв</h2>
          <ul class="kv">${Object.entries(d.byStatus)
            .map(([s, n]) => `<li><a href="#orders" data-goto-status="${s}"><span class="status status-${s}">${ORDER_STATUS[s]}</span></a><strong>${n}</strong></li>`)
            .join("")}</ul>
        </section>
        <section class="panel">
          <h2>Сүүлийн захиалгууд</h2>
          ${d.recent.length
            ? `<ul class="kv">${d.recent
                .map((o) => `<li><span><strong>${esc(o.number)}</strong> <span class="muted">${esc(o.name)} · ${fmtDate(o.createdAt)}</span></span><span>${formatPrice(o.total)} <span class="status status-${o.status}">${ORDER_STATUS[o.status]}</span></span></li>`)
                .join("")}</ul>`
            : `<p class="muted">Захиалга алга.</p>`}
        </section>
        <section class="panel">
          <h2>Их зарагдсан</h2>
          ${d.topProducts.length
            ? `<ul class="kv">${d.topProducts.map((p) => `<li><span>${esc(p.name)}</span><strong>${p.qty} ш</strong></li>`).join("")}</ul>`
            : `<p class="muted">Төлөгдсөн захиалга хараахан алга.</p>`}
        </section>
        <section class="panel">
          <h2>Үлдэгдэл бага</h2>
          ${d.lowStock.length
            ? `<ul class="kv">${d.lowStock.map((p) => `<li><span>${esc(p.name)}</span><strong class="${p.stock === 0 ? "danger" : ""}">${p.stock === 0 ? "Дууссан" : `${p.stock} ш`}</strong></li>`).join("")}</ul>`
            : `<p class="muted">Бүх бараа хангалттай.</p>`}
        </section>
      </div>`;
    $$("[data-goto-status]", view).forEach((a) => a.addEventListener("click", () => (orderFilter.status = a.dataset.gotoStatus)));
  }

  // ---------- Захиалга ----------

  const orderFilter = { status: "all", query: "" };

  async function renderOrders() {
    const { orders, statuses } = await api("orders");
    updatePendingBadge(orders.filter((o) => o.status === "pending").length);
    const counts = Object.fromEntries(statuses.map((s) => [s, orders.filter((o) => o.status === s).length]));

    view.innerHTML = `
      <header class="view-head">
        <h1>Захиалга</h1>
        <input class="input search" type="search" placeholder="Дугаар, нэр, утас…" value="${esc(orderFilter.query)}" data-order-search>
      </header>
      <div class="filter-chips">
        ${["all", ...statuses]
          .map((s) => `<button class="chip" type="button" data-status-filter="${s}" aria-selected="${orderFilter.status === s}">${s === "all" ? `Бүгд (${orders.length})` : `${ORDER_STATUS[s]} (${counts[s]})`}</button>`)
          .join("")}
      </div>
      <div class="order-list" data-order-list></div>`;

    const list = $("[data-order-list]", view);
    const draw = () => {
      const q = orderFilter.query.trim().toLowerCase();
      const shown = orders.filter(
        (o) =>
          (orderFilter.status === "all" || o.status === orderFilter.status) &&
          (!q || [o.number, o.customer.name, o.customer.phone, o.customer.address].join(" ").toLowerCase().includes(q))
      );
      list.innerHTML = shown.length ? shown.map((o) => orderCard(o, statuses)).join("") : `<p class="muted empty">Захиалга олдсонгүй.</p>`;
      bindOrderCards(list, orders);
    };
    draw();

    $$("[data-status-filter]", view).forEach((b) =>
      b.addEventListener("click", () => {
        orderFilter.status = b.dataset.statusFilter;
        $$("[data-status-filter]", view).forEach((x) => x.setAttribute("aria-selected", String(x === b)));
        draw();
      })
    );
    $("[data-order-search]", view).addEventListener("input", (e) => {
      orderFilter.query = e.target.value;
      draw();
    });
  }

  function orderCard(o, statuses) {
    const c = o.customer;
    const canCheck = o.status === "pending" && (o.payment?.provider === "qpay" || o.payment?.provider === "golomt");
    return `<details class="order-card" data-order="${esc(o.number)}">
      <summary>
        <span class="oc-main"><strong>${esc(o.number)}</strong><span class="muted">${fmtDate(o.createdAt)}</span></span>
        <span class="oc-who">${esc(c.name)}<span class="muted">${esc(c.phone)}</span></span>
        <span class="oc-meta">${esc(o.methodName || o.method)}<span class="muted">${o.fulfillment === "pickup" ? "Очиж авна" : "Хүргэлт"} · ${esc(c.date)}</span></span>
        <strong class="oc-total">${formatPrice(o.total)}</strong>
        <span class="status status-${o.status}">${ORDER_STATUS[o.status]}</span>
      </summary>
      <div class="oc-body">
        <div>
          <h3>Бараа</h3>
          <ul class="track-items">${o.items.map((i) => `<li><span>${esc(i.name)} × ${i.qty}</span><span>${formatPrice(i.price * i.qty)}</span></li>`).join("")}</ul>
          <div class="summary-row muted"><span>Дүн</span><span>${formatPrice(o.subtotal)}</span></div>
          ${o.discount ? `<div class="summary-row discount"><span>Хөнгөлөлт (${esc(o.promoCode)})</span><span>−${formatPrice(o.discount)}</span></div>` : ""}
          <div class="summary-row muted"><span>Хүргэлт</span><span>${o.delivery ? formatPrice(o.delivery) : "Үнэгүй"}</span></div>
          <div class="summary-row total"><span>Нийт</span><strong>${formatPrice(o.total)}</strong></div>
        </div>
        <div>
          <h3>Захиалагч</h3>
          <p>${esc(c.name)} · <a href="tel:${esc(c.phone.replace(/[^\d+]/g, ""))}">${esc(c.phone)}</a></p>
          ${o.fulfillment === "pickup" ? `<p>Очиж авна · ${esc(c.date)}</p>` : `<p>${esc(c.address)}<br>Хүргэх огноо: ${esc(c.date)}</p>`}
          ${c.note ? `<p class="note">“${esc(c.note)}”</p>` : ""}
          <p class="muted small">Төлбөр: ${esc(o.methodName || o.method)}${o.payment?.provider ? ` (${esc(o.payment.provider)})` : ""}${o.paidAt ? ` · төлсөн ${fmtDate(o.paidAt)}` : ""}</p>
          <div class="oc-actions">
            <label>Төлөв
              <select class="input" data-order-status>
                ${statuses.map((s) => `<option value="${s}" ${s === o.status ? "selected" : ""}>${ORDER_STATUS[s]}</option>`).join("")}
              </select>
            </label>
            ${canCheck ? `<button class="btn btn-ghost btn-small" type="button" data-order-check>Банкнаас шалгах</button>` : ""}
          </div>
          <label class="block">Дотоод тэмдэглэл
            <textarea class="input" rows="2" data-order-note placeholder="Зөвхөн админд харагдана">${esc(o.adminNote || "")}</textarea>
          </label>
          <button class="btn btn-ghost btn-small" type="button" data-order-save-note>Тэмдэглэл хадгалах</button>
          <ol class="mini-history">${(o.history || []).map((h) => `<li>${fmtDate(h.at)} — ${ORDER_STATUS[h.status]}</li>`).join("")}</ol>
        </div>
      </div>
    </details>`;
  }

  function bindOrderCards(root, orders) {
    $$("[data-order]", root).forEach((card) => {
      const number = card.dataset.order;
      $("[data-order-status]", card).addEventListener("change", async (e) => {
        const status = e.target.value;
        if (status === "cancelled" && !confirm("Захиалгыг цуцлах уу? Үлдэгдэл буцаж нэмэгдэнэ.")) {
          e.target.value = orders.find((o) => o.number === number).status;
          return;
        }
        try {
          await api(`orders/${number}`, { method: "PATCH", body: { status } });
          toast("Төлөв шинэчлэгдлээ");
          await renderOrders();
        } catch (err) {
          toast(err.message, true);
        }
      });
      $("[data-order-save-note]", card).addEventListener("click", async () => {
        try {
          await api(`orders/${number}`, { method: "PATCH", body: { adminNote: $("[data-order-note]", card).value } });
          toast("Тэмдэглэл хадгалагдлаа");
        } catch (err) {
          toast(err.message, true);
        }
      });
      $("[data-order-check]", card)?.addEventListener("click", async () => {
        try {
          const o = await api(`orders/${number}?action=check`, { method: "POST", body: {} });
          toast(o.status === "paid" ? "Төлбөр баталгаажлаа" : "Төлбөр хараахан ороогүй байна");
          if (o.status === "paid") await renderOrders();
        } catch (err) {
          toast(err.message, true);
        }
      });
    });
  }

  // ---------- Бараа ----------

  let productList = [];

  async function renderProducts() {
    const data = await api("products");
    productList = data.products;
    categories = data.categories;
    const filter = { query: "", category: "all" };

    view.innerHTML = `
      <header class="view-head">
        <h1>Бараа <span class="muted">(${productList.length})</span></h1>
        <div class="head-tools">
          <input class="input search" type="search" placeholder="Хайх…" data-product-search>
          <select class="input" data-product-cat>
            <option value="all">Бүх ангилал</option>
            ${categories.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}
          </select>
          <button class="btn btn-primary" type="button" data-new-product>+ Бараа нэмэх</button>
        </div>
      </header>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th></th><th>Нэр</th><th>Ангилал</th><th class="num">Үнэ</th><th class="num">Үлдэгдэл</th><th>Төлөв</th><th class="num">Дараалал</th><th></th></tr></thead>
          <tbody data-product-rows></tbody>
        </table>
      </div>`;

    const draw = () => {
      const q = filter.query.trim().toLowerCase();
      const filtering = q || filter.category !== "all";
      $("[data-product-rows]", view).innerHTML = productList
        .filter((p) => (filter.category === "all" || p.category === filter.category) && (!q || p.name.toLowerCase().includes(q)))
        .map(
          (p) => `<tr data-id="${esc(p.id)}" class="${p.active === false ? "is-hidden" : ""}">
            <td><div class="thumb">${LFC.media(p, tone(p.category))}</div></td>
            <td><button class="link strong" type="button" data-edit>${esc(p.name)}</button>${p.badge ? `<br><span class="muted small">${esc(p.badge)}</span>` : ""}</td>
            <td>${esc(categoryName(p.category))}</td>
            <td class="num">${p.price == null ? `<span class="muted">Тохиролцоно</span>` : formatPrice(p.price)}</td>
            <td class="num">${p.stock == null ? `<span class="muted">∞</span>` : p.stock === 0 ? `<span class="danger">Дууссан</span>` : p.stock}</td>
            <td>${p.active === false ? `<span class="status status-cancelled">Нуусан</span>` : `<span class="status status-paid">Идэвхтэй</span>`}</td>
            <td class="num nowrap">
              <button class="icon-btn" type="button" data-move="-1" aria-label="Дээш" ${filtering ? "disabled" : ""}>↑</button>
              <button class="icon-btn" type="button" data-move="1" aria-label="Доош" ${filtering ? "disabled" : ""}>↓</button>
            </td>
            <td class="num nowrap">
              <button class="btn btn-ghost btn-small" type="button" data-edit>Засах</button>
              <button class="icon-btn danger" type="button" data-delete aria-label="Устгах" title="Устгах">✕</button>
            </td>
          </tr>`
        )
        .join("");

      $$("[data-product-rows] tr", view).forEach((row) => {
        const id = row.dataset.id;
        $$("[data-edit]", row).forEach((b) => b.addEventListener("click", () => openProductEditor(productList.find((p) => p.id === id))));
        $("[data-delete]", row).addEventListener("click", async () => {
          const p = productList.find((x) => x.id === id);
          if (!confirm(`«${p.name}»-ийг устгах уу? Түр нуух бол "Дэлгүүрт харуулах"-ыг унтраагаарай.`)) return;
          try {
            await api(`products/${id}`, { method: "DELETE" });
            toast("Устгалаа");
            renderProducts();
          } catch (err) {
            toast(err.message, true);
          }
        });
        $$("[data-move]", row).forEach((b) =>
          b.addEventListener("click", async () => {
            const i = productList.findIndex((p) => p.id === id);
            const j = i + Number(b.dataset.move);
            if (j < 0 || j >= productList.length) return;
            [productList[i], productList[j]] = [productList[j], productList[i]];
            draw();
            try {
              await api("products/order", { method: "PUT", body: { ids: productList.map((p) => p.id) } });
            } catch (err) {
              toast(err.message, true);
            }
          })
        );
      });
    };
    draw();

    $("[data-product-search]", view).addEventListener("input", (e) => {
      filter.query = e.target.value;
      draw();
    });
    $("[data-product-cat]", view).addEventListener("change", (e) => {
      filter.category = e.target.value;
      draw();
    });
    $("[data-new-product]", view).addEventListener("click", () => openProductEditor(null));
  }

  // ---------- Бараа засах цонх ----------

  const editor = { product: null, image: "" };

  function openProductEditor(product) {
    const dialog = $("[data-product-dialog]");
    const f = $("[data-product-form]");
    editor.product = product;
    editor.image = product?.image || "";
    f.reset();
    $("[data-product-error]").hidden = true;
    $("[data-image-status]").textContent = "";
    $("[data-product-title]").textContent = product ? "Бараа засах" : "Шинэ бараа";
    $("[data-category-select]").innerHTML = categories.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");

    const p = product || { category: categories[0]?.id, active: true, colors: ["#3f6b4f", "#7fa98a"] };
    f.name.value = p.name || "";
    f.category.value = p.category;
    f.badge.value = p.badge || "";
    f.price.value = p.price ?? "";
    f.stock.value = p.stock ?? "";
    f.desc.value = p.desc || "";
    f.care.value = p.care && p.care !== "—" ? p.care : "";
    f.light.value = p.light && p.light !== "—" ? p.light : "";
    f.water.value = p.water && p.water !== "—" ? p.water : "";
    f.active.checked = p.active !== false;
    f.shape.value = p.cactus ? "cactus" : p.flower ? "flower" : "leaf";
    f.color1.value = p.colors?.[0] || "#3f6b4f";
    f.color2.value = p.colors?.[1] || "#7fa98a";
    drawPreview();
    dialog.showModal();
  }

  function formProduct() {
    const f = $("[data-product-form]");
    return {
      name: f.name.value,
      category: f.category.value,
      badge: f.badge.value,
      price: f.price.value === "" ? null : Number(f.price.value),
      stock: f.stock.value === "" ? null : Number(f.stock.value),
      desc: f.desc.value,
      care: f.care.value,
      light: f.light.value,
      water: f.water.value,
      active: f.active.checked,
      shape: f.shape.value,
      colors: [f.color1.value, f.color2.value],
      image: editor.image,
    };
  }

  function drawPreview() {
    const p = formProduct();
    $("[data-image-preview]").innerHTML = LFC.media(
      { ...p, name: p.name || "Бараа", flower: p.shape === "flower", cactus: p.shape === "cactus" },
      tone(p.category)
    );
    $("[data-illustration-fields]").hidden = Boolean(editor.image);
    $("[data-image-remove]").hidden = !editor.image;
  }

  // Зургийг хөтөч дээр 1400px болгож багасгаад JPEG-ээр илгээнэ.
  function resizeImage(file, max = 1400) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(img.src);
        resolve(canvas.toDataURL("image/jpeg", 0.86));
      };
      img.onerror = () => reject(new Error("Зургийг уншиж чадсангүй"));
      img.src = URL.createObjectURL(file);
    });
  }

  async function uploadImage(file) {
    const dataUrl = await resizeImage(file);
    const { path } = await api("uploads", { method: "POST", body: { dataUrl } });
    return path;
  }

  async function onImageSelected(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const status = $("[data-image-status]");
    status.textContent = "Хуулж байна…";
    try {
      editor.image = await uploadImage(file);
      status.textContent = "Зураг нэмэгдлээ";
      drawPreview();
    } catch (err) {
      status.textContent = err.message;
    }
  }

  async function saveProduct(e) {
    e.preventDefault();
    const err = $("[data-product-error]");
    err.hidden = true;
    try {
      const body = formProduct();
      if (editor.product) await api(`products/${editor.product.id}`, { method: "PUT", body });
      else await api("products", { method: "POST", body });
      $("[data-product-dialog]").close();
      toast("Хадгалагдлаа");
      renderProducts();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  }

  // ---------- Промо код ----------

  async function renderPromos() {
    const { promos } = await api("promos");
    const today = new Date().toISOString().slice(0, 10);
    const promoState = (p) =>
      !p.active ? ["cancelled", "Идэвхгүй"]
      : p.expiresAt && p.expiresAt < today ? ["completed", "Хугацаа дууссан"]
      : p.usageLimit && p.used >= p.usageLimit ? ["completed", "Хязгаар дууссан"]
      : ["paid", "Идэвхтэй"];

    view.innerHTML = `
      <header class="view-head"><h1>Промо код</h1></header>
      <form class="panel promo-form" data-promo-form>
        <h2>Шинэ код</h2>
        <div class="promo-grid">
          <label>Код<input class="input upper" name="code" required placeholder="LOTUS10" maxlength="30"></label>
          <label>Төрөл<select class="input" name="type"><option value="percent">Хувь (%)</option><option value="fixed">Тогтмол дүн (₮)</option></select></label>
          <label>Хэмжээ<input class="input" name="value" type="number" min="1" required placeholder="10"></label>
          <label>Доод дүн (₮)<input class="input" name="minAmount" type="number" min="0" placeholder="0"></label>
          <label>Ашиглах хязгаар<input class="input" name="usageLimit" type="number" min="1" placeholder="Хязгааргүй"></label>
          <label>Дуусах огноо<input class="input" name="expiresAt" type="date"></label>
        </div>
        <p class="form-error" data-promo-error hidden></p>
        <button class="btn btn-primary" type="submit">Нэмэх</button>
      </form>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Код</th><th>Хөнгөлөлт</th><th class="num">Доод дүн</th><th class="num">Ашигласан</th><th>Дуусах</th><th>Төлөв</th><th></th></tr></thead>
          <tbody>${
            promos.length
              ? promos
                  .map((p) => {
                    const [cls, label] = promoState(p);
                    return `<tr data-code="${esc(p.code)}">
                      <td><strong>${esc(p.code)}</strong></td>
                      <td>${p.type === "percent" ? `${p.value}%` : formatPrice(p.value)}</td>
                      <td class="num">${p.minAmount ? formatPrice(p.minAmount) : "—"}</td>
                      <td class="num">${p.used}${p.usageLimit ? ` / ${p.usageLimit}` : ""}</td>
                      <td>${p.expiresAt || "—"}</td>
                      <td><span class="status status-${cls}">${label}</span></td>
                      <td class="num nowrap">
                        <button class="btn btn-ghost btn-small" type="button" data-toggle>${p.active ? "Идэвхгүй болгох" : "Идэвхжүүлэх"}</button>
                        <button class="icon-btn danger" type="button" data-delete aria-label="Устгах">✕</button>
                      </td>
                    </tr>`;
                  })
                  .join("")
              : `<tr><td colspan="7" class="muted">Промо код алга.</td></tr>`
          }</tbody>
        </table>
      </div>`;

    $("[data-promo-form]", view).addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.currentTarget));
      const err = $("[data-promo-error]", view);
      try {
        await api("promos", { method: "POST", body });
        toast("Промо код нэмэгдлээ");
        renderPromos();
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
      }
    });
    $$("tr[data-code]", view).forEach((row) => {
      const p = promos.find((x) => x.code === row.dataset.code);
      $("[data-toggle]", row).addEventListener("click", async () => {
        try {
          await api(`promos/${p.code}`, { method: "PUT", body: { ...p, active: !p.active } });
          renderPromos();
        } catch (err) {
          toast(err.message, true);
        }
      });
      $("[data-delete]", row).addEventListener("click", async () => {
        if (!confirm(`${p.code} кодыг устгах уу?`)) return;
        await api(`promos/${p.code}`, { method: "DELETE" }).catch((err) => toast(err.message, true));
        renderPromos();
      });
    });
  }

  // ---------- Тохиргоо ----------

  async function renderSettings() {
    const s = await api("settings");
    const field = (name, label, attrs = "") => `<label>${label}<input class="input" name="${name}" value="${esc(s[name] ?? "")}" ${attrs}></label>`;
    const bankRow = (a = {}) => `<div class="bank-edit">
        <input class="input" data-bank="bank" placeholder="Банк" value="${esc(a.bank || "")}">
        <input class="input" data-bank="account" placeholder="Дансны дугаар" value="${esc(a.account || "")}">
        <input class="input" data-bank="holder" placeholder="Эзэмшигч" value="${esc(a.holder || "")}">
        <button class="icon-btn danger" type="button" data-bank-remove aria-label="Хасах">✕</button>
      </div>`;

    view.innerHTML = `
      <header class="view-head"><h1>Тохиргоо</h1></header>
      <form class="settings" data-settings-form>
        <section class="panel">
          <h2>Дэлгүүр</h2>
          <div class="form-grid">
            ${field("name", "Нэр", "required")}
            ${field("tagline", "Уриа")}
            ${field("phone", "Утас")}
            ${field("email", "И-мэйл", 'type="email"')}
            ${field("address", "Хаяг")}
            ${field("hours", "Цагийн хуваарь")}
            ${field("facebook", "Facebook холбоос", 'type="url"')}
            ${field("instagram", "Instagram холбоос", 'type="url"')}
          </div>
        </section>
        <section class="panel">
          <h2>Хүргэлт</h2>
          <div class="form-grid">
            ${field("deliveryFee", "Хүргэлтийн төлбөр (₮)", 'type="number" min="0" required')}
            ${field("freeDeliveryFrom", "Үнэгүй хүргэлтийн босго (₮)", 'type="number" min="0" required')}
            <label class="span-2">Хүргэлтийн бүс<input class="input" name="deliveryArea" value="${esc(s.deliveryArea || "")}"></label>
            <label class="check span-2"><input type="checkbox" name="pickupEnabled" ${s.pickupEnabled ? "checked" : ""}> Очиж авах боломжтой</label>
            <label class="span-2">Очиж авах хаяг<input class="input" name="pickupAddress" value="${esc(s.pickupAddress || "")}"></label>
          </div>
        </section>
        <section class="panel">
          <h2>Төлбөр</h2>
          <h3 class="small">Дансаар шилжүүлэх данс</h3>
          <div data-banks>${(s.bankAccounts || []).map(bankRow).join("")}</div>
          <button class="btn btn-ghost btn-small" type="button" data-bank-add>+ Данс нэмэх</button>
          <h3 class="small">QPay тогтмол QR (сервер QPay API-гүй үед)</h3>
          <div class="qr-edit">
            <div class="qr-preview" data-qr-preview>${s.qpayStaticQr ? `<img src="${esc(s.qpayStaticQr)}" alt="QR">` : `<span class="muted small">QR алга</span>`}</div>
            <label class="btn btn-ghost btn-small file-btn">QR зураг оруулах<input type="file" accept="image/png,image/jpeg,image/webp" data-qr-input hidden></label>
            <button class="link small muted" type="button" data-qr-remove ${s.qpayStaticQr ? "" : "hidden"}>Устгах</button>
          </div>
          <p class="muted small">QPay, Голомт (карт, SocialPay)-ын API түлхүүрийг серверийн .env файлд тохируулна.</p>
        </section>
        <p class="form-error" data-settings-error hidden></p>
        <div class="sticky-actions"><button class="btn btn-primary" type="submit">Хадгалах</button></div>
      </form>`;

    let qr = s.qpayStaticQr || "";
    const banks = $("[data-banks]", view);
    const bindBankRemove = () =>
      $$("[data-bank-remove]", banks).forEach((b) => (b.onclick = () => b.closest(".bank-edit").remove()));
    bindBankRemove();
    $("[data-bank-add]", view).addEventListener("click", () => {
      banks.insertAdjacentHTML("beforeend", bankRow());
      bindBankRemove();
    });
    $("[data-qr-input]", view).addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        qr = await uploadImage(file);
        $("[data-qr-preview]", view).innerHTML = `<img src="${esc(qr)}" alt="QR">`;
        $("[data-qr-remove]", view).hidden = false;
      } catch (err) {
        toast(err.message, true);
      }
    });
    $("[data-qr-remove]", view).addEventListener("click", (e) => {
      qr = "";
      $("[data-qr-preview]", view).innerHTML = `<span class="muted small">QR алга</span>`;
      e.currentTarget.hidden = true;
    });

    $("[data-settings-form]", view).addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      const body = Object.fromEntries(new FormData(f));
      body.pickupEnabled = f.pickupEnabled.checked;
      body.qpayStaticQr = qr;
      body.bankAccounts = $$(".bank-edit", banks).map((row) =>
        Object.fromEntries($$("[data-bank]", row).map((i) => [i.dataset.bank, i.value]))
      );
      const err = $("[data-settings-error]", view);
      try {
        await api("settings", { method: "PUT", body });
        err.hidden = true;
        toast("Тохиргоо хадгалагдлаа");
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
      }
    });
  }

  // ---------- Эхлэл ----------

  $("[data-login-form]").addEventListener("submit", onLogin);
  $("[data-logout]").addEventListener("click", logout);
  window.addEventListener("hashchange", route);

  const productForm = $("[data-product-form]");
  productForm.addEventListener("submit", saveProduct);
  productForm.addEventListener("input", (e) => {
    if (["shape", "color1", "color2", "category", "name"].includes(e.target.name)) drawPreview();
  });
  $("[data-image-input]").addEventListener("change", onImageSelected);
  $("[data-image-remove]").addEventListener("click", () => {
    editor.image = "";
    drawPreview();
  });
  $$("dialog.modal").forEach((d) => {
    $$("[data-close]", d).forEach((b) => b.addEventListener("click", () => d.close()));
  });

  start();
})();
