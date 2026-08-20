/* ============================================================
   CONFIGURAÇÃO — o essencial para conectar com a SUA planilha
   ============================================================ */
const CONFIG = {
  CLIENT_ID: "277005164447-fpqg2sof9r9q3k68u7vgjds9fbicqd9q.apps.googleusercontent.com",
  SPREADSHEET_ID: "1X4cJ7dnQPVUtZI1enkbrKqm3_4M27ef5ZNSglQVIUyg",
  SHEET_NAME: "Lançamentos",
  SCOPE: "https://www.googleapis.com/auth/spreadsheets",
  CARD_CUTOFF_DAYS: 7,
  CARDS: {
    "Carrefour": 12,
    "MLivre Lud": 10,
    "Amazon": 10,
    "Inter Rafa": 12,
    "Inter JR": 4,
    "Inter Lud": 15,
    "Nubank JR": 12,
  },
};

const CATEGORY_COLORS = ["#8b7cf6", "#f59e0b", "#3b82f6", "#14b8a6", "#f43f5e", "#22c55e", "#ec4899", "#06b6d4"];
const REDIRECT_URI = (window.location.origin + window.location.pathname).replace(/index\.html$/, "");

let accessToken = null;
let rows = [];
let valuesHidden = localStorage.getItem("valuesHidden") === "1";

function startGoogleAuth() {
  setGateStatus("Abrindo login do Google...");
  const params = new URLSearchParams({
    client_id: CONFIG.CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "token",
    scope: CONFIG.SCOPE,
    include_granted_scopes: "true",
  });
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function tryConsumeHashToken() {
  if (!window.location.hash) return false;
  const params = new URLSearchParams(window.location.hash.substring(1));
  const token = params.get("access_token");
  const expiresIn = params.get("expires_in");
  history.replaceState(null, "", window.location.pathname + window.location.search);
  if (token) {
    accessToken = token;
    localStorage.setItem("gt_token", token);
    localStorage.setItem("gt_token_exp", String(Date.now() + Number(expiresIn) * 1000));
    localStorage.setItem("gt_connected", "1");
    return true;
  }
  if (params.get("error")) {
    setGateStatus("Não foi possível conectar. Toque para tentar de novo.", true);
  }
  return false;
}

window.addEventListener("load", () => {
  initTheme();
  bindUI();
  bindVoice();

  document.getElementById("signInBtn").addEventListener("click", startGoogleAuth);

  if (tryConsumeHashToken()) { onSignedIn(); return; }

  const saved = localStorage.getItem("gt_token");
  const exp = Number(localStorage.getItem("gt_token_exp") || 0);
  if (saved && Date.now() < exp - 60000) {
    accessToken = saved;
    onSignedIn();
    return;
  }

  document.getElementById("signInBtn").disabled = false;
});

function setGateStatus(msg, isError) {
  const el = document.getElementById("gateStatus");
  el.textContent = msg || "";
  el.style.color = isError ? "var(--red)" : "var(--text-muted)";
}

function ensureFreshToken(cb) {
  const exp = Number(localStorage.getItem("gt_token_exp") || 0);
  if (accessToken && Date.now() < exp - 60000) return cb();
  showToast("Sessão expirada, reconectando...", true);
  setTimeout(startGoogleAuth, 900);
}

function onSignedIn() {
  document.getElementById("gate").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  loadData();
}

async function sheetsFetch(path, options = {}) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}${path}`;
  const resp = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(`Erro Sheets API (${resp.status}): ${errBody}`);
  }
  return resp.json();
}

async function loadData() {
  showToast("Sincronizando com a planilha...", false, true);
  try {
    const range = `${encodeURIComponent(CONFIG.SHEET_NAME)}!A2:H2000`;
    const data = await sheetsFetch(`/values/${range}`);
    const values = data.values || [];
    rows = values
      .map((r, i) => ({
        rowNumber: i + 2,
        data: r[0] || "",
        tipo: (r[1] || "").trim(),
        categoria: (r[2] || "").trim() || "Outros",
        descricao: (r[3] || "").trim(),
        vencimento: r[4] || "",
        valor: parseValor(r[5]),
        id: r[6] || "",
        status: (r[7] || "").trim(),
      }))
      .filter((r) => r.data || r.descricao || r.valor);
    renderAll();
    showToast("Dados atualizados", false);
  } catch (e) {
    console.error(e);
    showToast("Erro: " + e.message.slice(0, 140), true);
  }
}

function parseValor(v) {
  if (!v) return 0;
  const n = String(v).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3},)/g, "").replace(",", ".");
  const f = parseFloat(n);
  return isNaN(f) ? 0 : f;
}

async function appendRow(entry) {
  const range = `${encodeURIComponent(CONFIG.SHEET_NAME)}!A2:H2`;
  const body = {
    values: [[entry.data, entry.tipo, entry.categoria, entry.descricao, entry.vencimento, entry.valor, "", entry.vencimento ? "Pendente" : ""]],
  };
  await sheetsFetch(`/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function updateStatus(rowNumber, newStatus) {
  const range = `${encodeURIComponent(CONFIG.SHEET_NAME)}!H${rowNumber}`;
  await sheetsFetch(`/values/${range}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ values: [[newStatus]] }),
  });
}

async function updateStatusMultiple(rowNumbers, newStatus) {
  await sheetsFetch(`/values:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      valueInputOption: "USER_ENTERED",
      data: rowNumbers.map((rn) => ({
        range: `${CONFIG.SHEET_NAME}!H${rn}`,
        values: [[newStatus]],
      })),
    }),
  });
}

const fmtBRL = (n) => (valuesHidden ? "R$ ••••••" : (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

function parseDateBR(str) {
  if (!str) return null;
  const parts = String(str).split(/[\/\-]/);
  if (parts.length !== 3) return null;
  let [d, m, y] = parts;
  if (y.length === 4) return new Date(Number(y), Number(m) - 1, Number(d));
  return new Date(Number(d), Number(m) - 1, Number(y));
}

function isSameMonth(dateStr, ref) {
  const d = parseDateBR(dateStr);
  if (!d) return false;
  return d.getMonth() === ref.getMonth() && d.getFullYear() === ref.getFullYear();
}

const MONTHS_PT = ["JANEIRO","FEVEREIRO","MARÇO","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"];

function renderAll() {
  const now = new Date();
  document.getElementById("monthBadge").textContent = MONTHS_PT[now.getMonth()];

  const monthRows = rows.filter((r) => isSameMonth(r.data, now) || (r.vencimento && isSameMonth(r.vencimento, now)));

  const entradas = monthRows.filter((r) => r.tipo.toLowerCase() === "entradas");
  const saidas = monthRows.filter((r) => r.tipo.toLowerCase() === "saídas" || r.tipo.toLowerCase() === "saidas");
  const gastoCartao = monthRows.filter((r) => r.tipo.toLowerCase() === "gasto cartão" || r.tipo.toLowerCase() === "gasto cartao");
  const despesasAll = [...saidas, ...gastoCartao];
  const bills = monthRows.filter((r) => !!r.vencimento);

  const totalEntradas = entradas.reduce((s, r) => s + r.valor, 0);
  const totalSaidas = saidas.reduce((s, r) => s + r.valor, 0);
  const saldo = totalEntradas - totalSaidas;
  const pendentes = bills.filter((r) => r.status.toLowerCase() !== "pago");
  const totalPendente = pendentes.reduce((s, r) => s + r.valor, 0);

  document.getElementById("statEntradas").textContent = fmtBRL(totalEntradas);
  document.getElementById("statEntradasSub").textContent = valuesHidden ? "••••••" : `${entradas.length} fonte${entradas.length === 1 ? "" : "s"} de receita`;
  document.getElementById("barEntradas").style.width = "100%";

  document.getElementById("statSaidas").textContent = fmtBRL(totalSaidas);
  document.getElementById("statSaidasSub").textContent = valuesHidden ? "••••••" : `${totalEntradas ? ((totalSaidas / totalEntradas) * 100).toFixed(1) : "0.0"}% das receitas`;
  document.getElementById("barSaidas").style.width = `${Math.min(100, totalEntradas ? (totalSaidas / totalEntradas) * 100 : 0)}%`;

  document.getElementById("statSaldo").textContent = fmtBRL(saldo);
  document.getElementById("statSaldoSub").textContent = valuesHidden ? "••••••" : (saldo >= 0 ? "Balanço Positivo" : "Balanço Negativo");
  document.getElementById("barSaldo").style.width = `${saldo >= 0 ? 100 : 15}%`;

  document.getElementById("statPendentes").textContent = fmtBRL(totalPendente);
  document.getElementById("statPendentesSub").textContent = valuesHidden ? "••••••" : `${pendentes.length} conta${pendentes.length === 1 ? "" : "s"} a pagar`;
  document.getElementById("barPendentes").style.width = `${bills.length ? (pendentes.length / bills.length) * 100 : 0}%`;

  document.getElementById("countEntradas").textContent = `(${entradas.length})`;
  document.getElementById("countDespesas").textContent = `(${despesasAll.length})`;
  document.getElementById("countContas").textContent = `(${bills.length})`;

  renderDonut(saidas, totalSaidas);
  renderOrigens(entradas, totalEntradas);
  renderBills(bills);
  renderCashSummary(totalEntradas, totalSaidas, saldo, totalPendente);
  renderList("entradasList", entradas, "green");
  renderList("despesasList", despesasAll, "red", true);
}

function renderDonut(saidas, total) {
  const byCat = {};
  saidas.forEach((r) => { byCat[r.categoria] = (byCat[r.categoria] || 0) + r.valor; });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

  const donut = document.getElementById("donut");
  const legend = document.getElementById("legend");
  document.getElementById("donutTotal").textContent = fmtBRL(total);

  if (!cats.length || !total) {
    donut.style.background = "var(--border)";
    legend.innerHTML = `<div class="empty-state" style="padding:8px 0;">Sem despesas neste mês</div>`;
    return;
  }

  let acc = 0;
  const stops = cats.map(([name, val], i) => {
    const pct = (val / total) * 100;
    const from = acc; acc += pct;
    const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
    return `${color} ${from}% ${acc}%`;
  });
  donut.style.background = `conic-gradient(${stops.join(",")})`;

  legend.innerHTML = cats.map(([name, val], i) => {
    const pct = ((val / total) * 100).toFixed(1);
    const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
    return `<div class="legend-row">
      <span class="dot" style="background:${color}"></span>
      <span class="lname">${escapeHTML(name)}</span>
      <span class="lpct">${pct}%</span>
      <span class="lval">${fmtBRL(val)}</span>
    </div>`;
  }).join("");
}

function renderOrigens(entradas, total) {
  const byDesc = {};
  entradas.forEach((r) => { byDesc[r.descricao || "Outros"] = (byDesc[r.descricao || "Outros"] || 0) + r.valor; });
  const list = Object.entries(byDesc).sort((a, b) => b[1] - a[1]);
  const el = document.getElementById("origensList");

  if (!list.length) { el.innerHTML = `<div class="empty-state">Nenhuma entrada neste mês</div>`; return; }

  el.innerHTML = list.map(([name, val]) => {
    const pct = total ? (val / total) * 100 : 0;
    return `<div class="list-item">
      <div class="list-icon" style="background:var(--green-soft); color:var(--green);">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M23 6l-9.5 9.5-5-5L1 18"/></svg>
      </div>
      <div class="list-body">
        <div class="list-title">${escapeHTML(name)}</div>
        <div class="list-bar"><div style="width:${pct}%; background:var(--green);"></div></div>
      </div>
      <div class="list-right">
        <div class="list-value">${fmtBRL(val)}</div>
        <div class="list-pct">${pct.toFixed(1)}%</div>
      </div>
    </div>`;
  }).join("");
}

function renderList(elId, list, tone, group) {
  const el = document.getElementById(elId);
  if (!list.length) { el.innerHTML = `<div class="empty-state">Nada por aqui ainda</div>`; return; }

  if (group) {
    const groups = {};
    list.forEach((r) => {
      const key = (r.descricao || r.categoria).trim().toLowerCase();
      if (!groups[key]) groups[key] = { nome: r.descricao || r.categoria, categoria: r.categoria, valor: 0, count: 0, latestData: r.data, isCartao: false };
      groups[key].valor += r.valor;
      groups[key].count += 1;
      if (r.tipo.toLowerCase().startsWith("gasto cart")) groups[key].isCartao = true;
      if ((parseDateBR(r.data) || 0) > (parseDateBR(groups[key].latestData) || 0)) groups[key].latestData = r.data;
    });
    const sorted = Object.values(groups).sort((a, b) => (parseDateBR(b.latestData) || 0) - (parseDateBR(a.latestData) || 0));
    el.innerHTML = sorted.map((g) => `
      <div class="list-item">
        <div class="list-icon" style="background:var(--${tone}-soft); color:var(--${tone});">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="3"/></svg>
        </div>
        <div class="list-body">
          <div class="list-title">${escapeHTML(g.nome)} ${g.count > 1 ? `<span class="badge" style="margin-left:4px;">${g.count}x</span>` : ""} ${g.isCartao ? '<span class="badge" style="margin-left:4px;">Cartão</span>' : ""}</div>
          <div class="list-date">${escapeHTML(g.categoria)} • último em ${escapeHTML(g.latestData)}${g.isCartao ? " • não somado no total" : ""}</div>
        </div>
        <div class="list-right">
          <div class="list-value">${fmtBRL(g.valor)}</div>
        </div>
      </div>`).join("");
    return;
  }

  const sorted = [...list].sort((a, b) => (parseDateBR(b.data) || 0) - (parseDateBR(a.data) || 0));
  el.innerHTML = sorted.map((r) => {
    const isCartao = r.tipo.toLowerCase().startsWith("gasto cart");
    return `
    <div class="list-item">
      <div class="list-icon" style="background:var(--${tone}-soft); color:var(--${tone});">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="3"/></svg>
      </div>
      <div class="list-body">
        <div class="list-title">${escapeHTML(r.descricao || r.categoria)} ${isCartao ? '<span class="badge" style="margin-left:4px;">Cartão</span>' : ""}</div>
        <div class="list-date">${escapeHTML(r.categoria)} • ${escapeHTML(r.data)}${isCartao ? " • não somado no total" : ""}</div>
      </div>
      <div class="list-right">
        <div class="list-value">${fmtBRL(r.valor)}</div>
      </div>
    </div>`;
  }).join("");
}

function renderBills(bills) {
  const paid = bills.filter((r) => r.status.toLowerCase() === "pago");
  const pending = bills.filter((r) => r.status.toLowerCase() !== "pago");
  const totalPaid = paid.reduce((s, r) => s + r.valor, 0);
  const totalPending = pending.reduce((s, r) => s + r.valor, 0);

  document.getElementById("billsSummaryText").textContent = `${paid.length} de ${bills.length} pagas neste mês`;
  document.getElementById("paidLabel").textContent = `Pago: ${fmtBRL(totalPaid)}`;
  document.getElementById("pendingLabel").textContent = `Pendente: ${fmtBRL(totalPending)}`;
  document.getElementById("statusBarFill").style.width = `${bills.length ? (paid.length / bills.length) * 100 : 0}%`;

  const groups = {};
  bills.forEach((r) => {
    const key = (r.descricao || r.categoria).trim().toLowerCase();
    if (!groups[key]) groups[key] = { nome: r.descricao || r.categoria, valor: 0, rowNumbers: [], allPaid: true };
    groups[key].valor += r.valor;
    groups[key].rowNumbers.push(r.rowNumber);
    if (r.status.toLowerCase() !== "pago") groups[key].allPaid = false;
  });
  const groupList = Object.values(groups).sort((a, b) => b.valor - a.valor);

  const cardHTML = (g) => `
    <div class="bill-item">
      <div class="bill-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </div>
      <div class="bill-body">
        <div class="bill-name">${escapeHTML(g.nome)}${g.rowNumbers.length > 1 ? ` <span class="badge" style="margin-left:4px;">${g.rowNumbers.length}x</span>` : ""}</div>
        <div class="bill-value">${fmtBRL(g.valor)}</div>
      </div>
      <button class="status-pill ${g.allPaid ? "paid" : "pending"}" data-rows="${g.rowNumbers.join(",")}">
        ${g.allPaid ? "Pago" : "Pendente"}
      </button>
    </div>`;

  if (!bills.length) {
    document.getElementById("billsGridPreview").innerHTML = `<div class="empty-state">Nenhuma conta com vencimento neste mês</div>`;
    document.getElementById("billsGridFull").innerHTML = "";
    return;
  }

  document.getElementById("billsGridPreview").innerHTML = groupList.slice(0, 4).map(cardHTML).join("");
  document.getElementById("billsGridFull").innerHTML = groupList.map(cardHTML).join("");

  document.querySelectorAll(".status-pill").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const rowNumbers = btn.dataset.rows.split(",").map(Number);
      const isPaidNow = btn.classList.contains("paid");
      const newStatus = isPaidNow ? "Pendente" : "Pago";
      btn.disabled = true;
      try {
        if (rowNumbers.length === 1) await updateStatus(rowNumbers[0], newStatus);
        else await updateStatusMultiple(rowNumbers, newStatus);
        rowNumbers.forEach((rn) => { const row = rows.find((r) => r.rowNumber === rn); if (row) row.status = newStatus; });
        renderAll();
        showToast(`Marcado como ${newStatus}`, false);
      } catch (e) {
        console.error(e);
        showToast("Erro ao atualizar status", true);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function renderCashSummary(totalEntradas, totalSaidas, saldo, totalPendente) {
  const pct = totalEntradas ? (totalSaidas / totalEntradas) * 100 : 0;
  document.getElementById("cashHeadline").textContent = saldo >= 0 ? "Economia Positiva" : "Atenção ao Orçamento";
  document.getElementById("cashText").innerHTML = valuesHidden ? "••••••" : `Você utilizou <b>${pct.toFixed(1)}%</b> da sua receita total neste mês.`;
  document.getElementById("cashSaldo").textContent = fmtBRL(saldo);
  document.getElementById("cashSaldo").className = saldo >= 0 ? "green" : "red";
  document.getElementById("cashPendente").textContent = fmtBRL(totalPendente);
}

function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

document.addEventListener("input", (e) => {
  if (e.target.id !== "searchInput") return;
  const term = e.target.value.trim().toLowerCase();
  document.querySelectorAll(".panel .list-item, .panel .bill-item").forEach((item) => {
    item.style.display = !term || item.textContent.toLowerCase().includes(term) ? "" : "none";
  });
});

function bindUI() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`panel-${btn.dataset.tab}`).classList.add("active");
    });
  });

  document.getElementById("refreshBtn").addEventListener("click", () => ensureFreshToken(loadData));

  document.getElementById("themeToggle").addEventListener("click", () => {
    const body = document.body;
    const next = body.dataset.theme === "dark" ? "light" : "dark";
    body.dataset.theme = next;
    localStorage.setItem("theme", next);
  });

  const hideBtn = document.getElementById("hideValuesBtn");
  const eyeOpen = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const eyeClosed = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a20.6 20.6 0 0 1 5.06-6.06M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 11 8 11 8a20.6 20.6 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>`;
  function updateHideValuesIcon() {
    hideBtn.innerHTML = valuesHidden ? eyeClosed : eyeOpen;
    hideBtn.title = valuesHidden ? "Mostrar valores" : "Ocultar valores";
    hideBtn.classList.toggle("value-hidden-active", valuesHidden);
  }
  updateHideValuesIcon();
  hideBtn.addEventListener("click", () => {
    valuesHidden = !valuesHidden;
    localStorage.setItem("valuesHidden", valuesHidden ? "1" : "0");
    updateHideValuesIcon();
    if (rows.length) renderAll();
  });

  document.querySelectorAll("[data-tilt]").forEach((card) => {
    card.addEventListener("pointermove", (e) => {
      const rect = card.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      card.style.transform = `perspective(700px) rotateX(${(-y * 10).toFixed(2)}deg) rotateY(${(x * 10).toFixed(2)}deg) translateZ(0)`;
    });
    card.addEventListener("pointerleave", () => { card.style.transform = ""; });
    card.addEventListener("pointerup", () => { card.style.transform = ""; });
  });

  const backdrop = document.getElementById("modalBackdrop");
  const openModal = () => {
    document.getElementById("fData").value = new Date().toISOString().slice(0, 10);
    vencimentoTouched = false;
    document.querySelectorAll(".type-toggle button").forEach((b) => b.classList.remove("active"));
    document.querySelector('.type-toggle button[data-type="Entradas"]').classList.add("active");
    selectedType = "Entradas";
    document.getElementById("descricaoFieldCartao").classList.add("hidden");
    document.getElementById("descricaoFieldNormal").classList.remove("hidden");
    document.getElementById("fCartaoSelect").value = "";
    backdrop.classList.add("open");
  };
  const closeModal = () => { backdrop.classList.remove("open"); document.getElementById("entryForm").reset(); vencimentoTouched = false; };

  document.getElementById("newEntryBtn").addEventListener("click", openModal);
  document.getElementById("closeModal").addEventListener("click", closeModal);
  document.getElementById("cancelBtn").addEventListener("click", closeModal);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeModal(); });

  let selectedType = "Entradas";
  let vencimentoTouched = false;

  document.getElementById("fVencimento").addEventListener("input", () => { vencimentoTouched = true; });

  function toISO(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function suggestVencimento() {
    if (vencimentoTouched) return;
    const dataVal = document.getElementById("fData").value;
    if (!dataVal) return;
    const baseDate = new Date(dataVal + "T00:00:00");
    const fVenc = document.getElementById("fVencimento");

    if (selectedType.toLowerCase().startsWith("gasto cart")) {
      const desc = document.getElementById("fDescricao").value.trim();
      const dueDay = CONFIG.CARDS[desc];
      if (!dueDay) return;
      let candidate = new Date(baseDate.getFullYear(), baseDate.getMonth(), dueDay);
      const diffDays = Math.round((candidate - baseDate) / 86400000);
      if (diffDays < 0 || diffDays <= CONFIG.CARD_CUTOFF_DAYS) {
        candidate = new Date(candidate.getFullYear(), candidate.getMonth() + 1, dueDay);
      }
      fVenc.value = toISO(candidate);
      fVenc.dispatchEvent(new Event("change"));
      return;
    }

    const desc = document.getElementById("fDescricao").value.trim().toLowerCase();
    if (!desc) { fVenc.value = ""; return; }
    const matches = rows.filter((r) => r.descricao.trim().toLowerCase() === desc && r.vencimento);
    if (!matches.length) return;
    matches.sort((a, b) => (parseDateBR(b.vencimento) || 0) - (parseDateBR(a.vencimento) || 0));
    const last = parseDateBR(matches[0].vencimento);
    if (!last) return;
    const next = new Date(last.getFullYear(), last.getMonth() + 1, last.getDate());
    fVenc.value = toISO(next);
  }

  document.getElementById("fDescricao").addEventListener("input", suggestVencimento);
  document.getElementById("fData").addEventListener("change", suggestVencimento);

  const descNormal = document.getElementById("descricaoFieldNormal");
  const descCartao = document.getElementById("descricaoFieldCartao");
  const cartaoSelect = document.getElementById("fCartaoSelect");

  cartaoSelect.addEventListener("change", () => {
    if (cartaoSelect.value === "__outro__") {
      descNormal.classList.remove("hidden");
      document.getElementById("fDescricao").value = "";
      document.getElementById("fDescricao").focus();
    } else {
      descNormal.classList.add("hidden");
      document.getElementById("fDescricao").value = cartaoSelect.value;
      vencimentoTouched = false;
      suggestVencimento();
    }
  });

  document.querySelectorAll(".type-toggle button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".type-toggle button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedType = btn.dataset.type;
      if (selectedType.toLowerCase().startsWith("gasto cart")) {
        descCartao.classList.remove("hidden");
        descNormal.classList.add("hidden");
        cartaoSelect.value = "";
        document.getElementById("fDescricao").value = "";
      } else {
        descCartao.classList.add("hidden");
        descNormal.classList.remove("hidden");
      }
      suggestVencimento();
    });
  });

  document.getElementById("entryForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!document.getElementById("fDescricao").value.trim()) {
      showToast(selectedType.toLowerCase().startsWith("gasto cart") ? "Selecione o cartão" : "Preencha a descrição", true);
      return;
    }

    const submitBtn = document.getElementById("submitBtn");
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span class="spinner"></span>`;

    const dataISO = document.getElementById("fData").value;
    const [y, m, d] = dataISO.split("-");
    const entry = {
      data: `${d}/${m}/${y}`,
      tipo: selectedType,
      categoria: document.getElementById("fCategoria").value.trim(),
      descricao: document.getElementById("fDescricao").value.trim(),
      valor: parseFloat(document.getElementById("fValor").value || "0"),
      vencimento: (() => {
        const v = document.getElementById("fVencimento").value;
        if (!v) return "";
        const [vy, vm, vd] = v.split("-");
        return `${vd}/${vm}/${vy}`;
      })(),
    };

    try {
      await new Promise((resolve, reject) => {
        ensureFreshToken(async () => {
          try { await appendRow(entry); resolve(); } catch (err) { reject(err); }
        });
      });
      closeModal();
      showToast("Lançamento salvo!", false);
      await loadData();
    } catch (err) {
      console.error(err);
      showToast("Erro ao salvar. Tente novamente.", true);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Salvar lançamento";
    }
  });
}

function initTheme() {
  const saved = localStorage.getItem("theme") || "dark";
  document.body.dataset.theme = saved;
}

const VOICE_CATEGORY_HINTS = {
  "Moradia": ["energia", "água", "agua", "aluguel", "internet", "condomínio", "condominio", "luz", "gás", "gas"],
  "Transporte": ["uber", "gasolina", "combustível", "combustivel", "estacionamento", "ônibus", "onibus", "99", "táxi", "taxi"],
  "Alimentação": ["mercado", "supermercado", "restaurante", "ifood", "lanche", "padaria", "feira"],
  "Telefonia": ["celular", "claro", "vivo", "tim", "oi"],
  "Lazer": ["cinema", "netflix", "spotify", "youtube", "show", "passeio"],
  "Saúde": ["farmácia", "farmacia", "remédio", "remedio", "consulta", "médico", "medico"],
};

function bindVoice() {
  const btn = document.getElementById("voiceBtn");
  if (!btn) return;
  const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognitionAPI) {
    btn.addEventListener("click", () =>
      showToast("Reconhecimento de voz não é suportado aqui. Use o Chrome no Android.", true)
    );
    return;
  }

  const recognition = new SpeechRecognitionAPI();
  recognition.lang = "pt-BR";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  let listening = false;

  btn.addEventListener("click", () => {
    if (listening) return;
    try {
      recognition.start();
      listening = true;
      btn.classList.add("listening");
      showToast("Ouvindo... fale o lançamento", false, true);
    } catch (e) { }
  });

  recognition.addEventListener("result", (e) => {
    const text = e.results[0][0].transcript;
    showToast(`Entendi: "${text}" — confira e salve`, false);
    fillFormFromVoice(text);
  });
  recognition.addEventListener("end", () => { listening = false; btn.classList.remove("listening"); });
  recognition.addEventListener("error", () => {
    listening = false;
    btn.classList.remove("listening");
    showToast("Não entendi. Tente falar mais perto do microfone.", true);
  });
}

function fillFormFromVoice(text) {
  const lower = text.toLowerCase();

  let valor = null;
  const moneyMatch = lower.match(/(\d+(?:[.,]\d{1,2})?)/);
  if (moneyMatch) valor = parseFloat(moneyMatch[1].replace(",", "."));

  let tipo = "Saídas";
  if (/\b(recebi|ganhei|entrada|caiu|pagamento recebido)\b/.test(lower)) tipo = "Entradas";
  else if (/\bcart[ãa]o\b/.test(lower)) tipo = "Gasto Cartão";

  let categoria = "Outros";
  for (const [cat, words] of Object.entries(VOICE_CATEGORY_HINTS)) {
    if (words.some((w) => lower.includes(w))) { categoria = cat; break; }
  }

  let desc = text
    .replace(/\d+(?:[.,]\d{1,2})?/g, "")
    .replace(/\b(recebi|ganhei|entrada|paguei|gastei|comprei|de|do|da|no|na|em|com|reais|real|r\$)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (desc) desc = desc.charAt(0).toUpperCase() + desc.slice(1);

  document.getElementById("newEntryBtn").click();

  const typeBtn = document.querySelector(`.type-toggle button[data-type="${tipo}"]`);
  if (typeBtn) typeBtn.click();

  if (tipo.toLowerCase().startsWith("gasto cart")) {
    document.getElementById("fCartaoSelect").value = "__outro__";
    document.getElementById("descricaoFieldCartao").classList.add("hidden");
    document.getElementById("descricaoFieldNormal").classList.remove("hidden");
  }

  document.getElementById("fCategoria").value = categoria;
  document.getElementById("fDescricao").value = desc;
  if (valor !== null) document.getElementById("fValor").value = valor;

  document.getElementById("fDescricao").dispatchEvent(new Event("input"));
}

let toastTimer = null;
function showToast(msg, isError, isLoading) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast show" + (isError ? " error" : isLoading ? "" : " success");
  clearTimeout(toastTimer);
  if (!isLoading) toastTimer = setTimeout(() => el.classList.remove("show"), isError ? 8000 : 2600);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
