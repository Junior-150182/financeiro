/* ============================================================
   CONFIGURAÇÃO — o essencial para conectar com a SUA planilha
   ============================================================ */
const CONFIG = {
  CLIENT_ID: "277005164447-fpqg2sof9r9q3k68u7vgjds9fbicqd9q.apps.googleusercontent.com",
  SPREADSHEET_ID: "1X4cJ7dnQPVUtZI1enkbrKqm3_4M27ef5ZNSglQVIUyg",
  SHEET_NAME: "Lançamentos", // nome da aba onde estão os lançamentos (ajuste se o nome real for outro)
  SCOPE: "https://www.googleapis.com/auth/spreadsheets",
};

/* Colunas esperadas na aba, na ordem:
   A: Data | B: Tipo | C: Categoria | D: Descrição | E: Data de Vencimento | F: Valor | G: ID | H: Status
   (a coluna H "Status" é criada/usada por este app para marcar Pago/Pendente) */

const CATEGORY_COLORS = ["#8b7cf6", "#f59e0b", "#3b82f6", "#14b8a6", "#f43f5e", "#22c55e", "#ec4899", "#06b6d4"];

let accessToken = null;
let tokenClient = null;
let pendingAfterAuth = null;
let rows = []; // { rowNumber, data, tipo, categoria, descricao, vencimento, valor, id, status }

/* ============================================================
   AUTENTICAÇÃO GOOGLE
   ============================================================ */
window.addEventListener("load", () => {
  waitForGSI(() => {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.CLIENT_ID,
      scope: CONFIG.SCOPE,
      callback: (resp) => {
        if (resp.error) {
          setGateStatus("Não foi possível conectar: " + resp.error, true);
          return;
        }
        accessToken = resp.access_token;
        sessionStorage.setItem("gt_token", accessToken);
        sessionStorage.setItem("gt_token_exp", String(Date.now() + resp.expires_in * 1000));
        onSignedIn();
        if (pendingAfterAuth) { const fn = pendingAfterAuth; pendingAfterAuth = null; fn(); }
      },
    });
    document.getElementById("signInBtn").disabled = false;
  });

  document.getElementById("signInBtn").addEventListener("click", () => {
    setGateStatus("Abrindo login do Google...");
    tokenClient.requestAccessToken({ prompt: "consent" });
  });

  initTheme();
  bindUI();

  // tenta retomar sessão sem pedir login de novo
  const saved = sessionStorage.getItem("gt_token");
  const exp = Number(sessionStorage.getItem("gt_token_exp") || 0);
  if (saved && Date.now() < exp - 60000) {
    accessToken = saved;
    onSignedIn();
  }
});

function waitForGSI(cb) {
  if (window.google && google.accounts && google.accounts.oauth2) return cb();
  setTimeout(() => waitForGSI(cb), 150);
}

function setGateStatus(msg, isError) {
  const el = document.getElementById("gateStatus");
  el.textContent = msg || "";
  el.style.color = isError ? "var(--red)" : "var(--text-muted)";
}

function ensureFreshToken(cb) {
  const exp = Number(sessionStorage.getItem("gt_token_exp") || 0);
  if (accessToken && Date.now() < exp - 60000) return cb();
  pendingAfterAuth = cb;
  tokenClient.requestAccessToken({ prompt: "" });
}

function onSignedIn() {
  document.getElementById("gate").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  loadData();
}

/* ============================================================
   LEITURA / ESCRITA NO GOOGLE SHEETS
   ============================================================ */
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

/* ============================================================
   FORMATAÇÃO E DATAS
   ============================================================ */
const fmtBRL = (n) => (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function parseDateBR(str) {
  if (!str) return null;
  const parts = String(str).split(/[\/\-]/);
  if (parts.length !== 3) return null;
  let [d, m, y] = parts;
  if (y.length === 4) return new Date(Number(y), Number(m) - 1, Number(d));
  return new Date(Number(d), Number(m) - 1, Number(y)); // ISO yyyy-mm-dd from <input type=date>
}

function isSameMonth(dateStr, ref) {
  const d = parseDateBR(dateStr);
  if (!d) return false;
  return d.getMonth() === ref.getMonth() && d.getFullYear() === ref.getFullYear();
}

const MONTHS_PT = ["JANEIRO","FEVEREIRO","MARÇO","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"];

/* ============================================================
   RENDERIZAÇÃO
   ============================================================ */
function renderAll() {
  const now = new Date();
  document.getElementById("monthBadge").textContent = MONTHS_PT[now.getMonth()];

  const monthRows = rows.filter((r) => isSameMonth(r.data, now) || (r.vencimento && isSameMonth(r.vencimento, now)));

  const entradas = monthRows.filter((r) => r.tipo.toLowerCase() === "entradas");
  // "Saídas" = despesas que contam no total. "Gasto Cartão" é só para conferência com a fatura
  // e NÃO entra na soma (o valor da fatura do cartão já vem como "Saídas" categoria "Cartão Crédito"),
  // senão o valor seria contado duas vezes.
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
  document.getElementById("statEntradasSub").textContent = `${entradas.length} fonte${entradas.length === 1 ? "" : "s"} de receita`;
  document.getElementById("barEntradas").style.width = "100%";

  document.getElementById("statSaidas").textContent = fmtBRL(totalSaidas);
  document.getElementById("statSaidasSub").textContent = `${totalEntradas ? ((totalSaidas / totalEntradas) * 100).toFixed(1) : "0.0"}% das receitas`;
  document.getElementById("barSaidas").style.width = `${Math.min(100, totalEntradas ? (totalSaidas / totalEntradas) * 100 : 0)}%`;

  document.getElementById("statSaldo").textContent = fmtBRL(saldo);
  document.getElementById("statSaldoSub").textContent = saldo >= 0 ? "Balanço Positivo" : "Balanço Negativo";
  document.getElementById("barSaldo").style.width = `${saldo >= 0 ? 100 : 15}%`;

  document.getElementById("statPendentes").textContent = fmtBRL(totalPendente);
  document.getElementById("statPendentesSub").textContent = `${pendentes.length} conta${pendentes.length === 1 ? "" : "s"} a pagar`;
  document.getElementById("barPendentes").style.width = `${bills.length ? (pendentes.length / bills.length) * 100 : 0}%`;

  document.getElementById("countEntradas").textContent = `(${entradas.length})`;
  document.getElementById("countDespesas").textContent = `(${despesasAll.length})`;
  document.getElementById("countContas").textContent = `(${bills.length})`;

  renderDonut(saidas, totalSaidas);
  renderOrigens(entradas, totalEntradas);
  renderBills(bills);
  renderCashSummary(totalEntradas, totalSaidas, saldo, totalPendente);
  renderList("entradasList", entradas, "green");
  renderList("despesasList", despesasAll, "red");
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

function renderList(elId, list, tone) {
  const el = document.getElementById(elId);
  if (!list.length) { el.innerHTML = `<div class="empty-state">Nada por aqui ainda</div>`; return; }
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

  const cardHTML = (r) => `
    <div class="bill-item">
      <div class="bill-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </div>
      <div class="bill-body">
        <div class="bill-name">${escapeHTML(r.descricao || r.categoria)}</div>
        <div class="bill-value">${fmtBRL(r.valor)}</div>
      </div>
      <button class="status-pill ${r.status.toLowerCase() === "pago" ? "paid" : "pending"}" data-row="${r.rowNumber}">
        ${r.status.toLowerCase() === "pago" ? "Pago" : "Pendente"}
      </button>
    </div>`;

  if (!bills.length) {
    document.getElementById("billsGridPreview").innerHTML = `<div class="empty-state">Nenhuma conta com vencimento neste mês</div>`;
    document.getElementById("billsGridFull").innerHTML = "";
    return;
  }

  document.getElementById("billsGridPreview").innerHTML = bills.slice(0, 4).map(cardHTML).join("");
  document.getElementById("billsGridFull").innerHTML = bills.map(cardHTML).join("");

  document.querySelectorAll(".status-pill").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const rowNumber = Number(btn.dataset.row);
      const row = rows.find((r) => r.rowNumber === rowNumber);
      const newStatus = row.status.toLowerCase() === "pago" ? "Pendente" : "Pago";
      btn.disabled = true;
      try {
        await updateStatus(rowNumber, newStatus);
        row.status = newStatus;
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
  document.getElementById("cashText").innerHTML = `Você utilizou <b>${pct.toFixed(1)}%</b> da sua receita total neste mês.`;
  document.getElementById("cashSaldo").textContent = fmtBRL(saldo);
  document.getElementById("cashSaldo").className = saldo >= 0 ? "green" : "red";
  document.getElementById("cashPendente").textContent = fmtBRL(totalPendente);
}

function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ============================================================
   BUSCA
   ============================================================ */
document.addEventListener("input", (e) => {
  if (e.target.id !== "searchInput") return;
  const term = e.target.value.trim().toLowerCase();
  document.querySelectorAll(".panel .list-item, .panel .bill-item").forEach((item) => {
    item.style.display = !term || item.textContent.toLowerCase().includes(term) ? "" : "none";
  });
});

/* ============================================================
   UI: TABS, TEMA, TILT 3D, MODAL
   ============================================================ */
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

  // Tema
  document.getElementById("themeToggle").addEventListener("click", () => {
    const body = document.body;
    const next = body.dataset.theme === "dark" ? "light" : "dark";
    body.dataset.theme = next;
    localStorage.setItem("theme", next);
  });

  // Tilt 3D nos cards de resumo
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

  // Modal
  const backdrop = document.getElementById("modalBackdrop");
  const openModal = () => {
    document.getElementById("fData").value = new Date().toISOString().slice(0, 10);
    backdrop.classList.add("open");
  };
  const closeModal = () => { backdrop.classList.remove("open"); document.getElementById("entryForm").reset(); };

  document.getElementById("newEntryBtn").addEventListener("click", openModal);
  document.getElementById("closeModal").addEventListener("click", closeModal);
  document.getElementById("cancelBtn").addEventListener("click", closeModal);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeModal(); });

  let selectedType = "Entradas";
  document.querySelectorAll(".type-toggle button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".type-toggle button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedType = btn.dataset.type;
    });
  });

  document.getElementById("entryForm").addEventListener("submit", async (e) => {
    e.preventDefault();
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

let toastTimer = null;
function showToast(msg, isError, isLoading) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast show" + (isError ? " error" : isLoading ? "" : " success");
  clearTimeout(toastTimer);
  if (!isLoading) toastTimer = setTimeout(() => el.classList.remove("show"), isError ? 8000 : 2600);
}

/* Registra o service worker (funciona offline após o primeiro carregamento) */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
