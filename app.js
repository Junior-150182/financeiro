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
    const range = `${encodeURIComponent(CONFIG.SHEET_NAME)}!A2:J2000`;
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
        km: parseValor(r[8]),
        litros: parseValor(r[9]),
      }))
      .filter((r) => r.data || r.descricao || r.valor);
    renderAll();
    showToast("Dados atualizados", false);
  } catch (e) {
    console.error(e);
    showToast("Erro: " + e.message.slice(0, 140), true);
  }
}

function parseValor(v)
