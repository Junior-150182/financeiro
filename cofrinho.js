/* ============================================================
   COFRINHO — desafios de guardar dinheiro + rendimento da caixinha
   Planilha separada do casal (abas "CASAL 20k" e "10K")
   ============================================================ */
(() => {
  const CF = {
    ID: "1We94-bHl6kSC3mjd2icF3fjOza-TUtceh62Ll4EqlhY",
    FIRST: 10,            // primeira linha de depósitos nas abas
    COUNT: 200,           // quantidade de depósitos do desafio
    CDI_AA: 13.90,        // % a.a. — Caixinha Nubank rende 100% do CDI (ajuste aqui se o CDI mudar)
    REND: "Rendimentos",  // aba criada automaticamente para guardar os rendimentos
    GOALS: [
      { key: "20k", sheet: "CASAL 20k", label: "Casal 20K", nubank: true },
      { key: "10k", sheet: "10K", label: "Desafio 10K" },
    ],
  };
  const MONTHLY = (Math.pow(1 + CF.CDI_AA / 100, 1 / 12) - 1) * 100; // ≈ 1,09% a.m.

  let data = {}, rend = [], ids = {}, loaded = false, busy = false;
  let show10k = localStorage.getItem("cfShow10k") === "1"; // 10K começa oculta

  const pt = (n) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const iso = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const br = (i) => i.split("-").reverse().join("/");
  const toIso = (s) => { const p = String(s || "").split("/"); return p.length === 3 ? `${p[2]}-${p[1].padStart(2, "0")}-${p[0].padStart(2, "0")}` : ""; };
  const serial = (i) => { const [y, m, d] = i.split("-").map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 864e5); };
  const q = encodeURIComponent;
  const fresh = () => new Promise((r) => ensureFreshToken(r));

  async function api(path, opt = {}) {
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${CF.ID}${path}`, {
      ...opt,
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    });
    if (!r.ok) throw new Error((await r.text()).slice(0, 200));
    return r.json();
  }

  /* ---------- Interface (aba + painel + estilos) ---------- */
  const style = document.createElement("style");
  style.textContent = `
    .cf-chips{display:grid;grid-template-columns:repeat(auto-fill,minmax(46px,1fr));gap:6px;max-height:300px;overflow-y:auto;padding:4px 2px}
    .cf-chip{padding:9px 0;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--text-muted);font-weight:600;font-size:.78rem;cursor:pointer}
    .cf-chip.done{background:var(--green-soft);color:var(--green);border-color:var(--green)}
    .cf-bar{height:8px;border-radius:99px;background:var(--border);overflow:hidden;margin:14px 0}
    .cf-bar>div{height:100%;background:var(--green);border-radius:99px}
    .cf-date{background:transparent;color:inherit;border:1px solid var(--border);border-radius:8px;padding:6px 8px;font:inherit}
    .cf-top{display:flex;justify-content:flex-end;gap:8px;margin-bottom:14px;flex-wrap:wrap}
    .cf-card{margin-bottom:14px}
    .cf-sub{font-size:.8rem;color:var(--text-muted);margin:14px 0 6px}`;
  document.head.appendChild(style);

  const tab = document.createElement("button");
  tab.className = "tab-btn";
  tab.dataset.tab = "cofrinho";
  tab.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4"/></svg> Cofrinho`;
  document.querySelector(".tabs").appendChild(tab);

  const panel = document.createElement("div");
  panel.className = "panel";
  panel.id = "panel-cofrinho";
  panel.innerHTML = `<div id="cfRoot"><div class="empty-state">Carregando cofrinho...</div></div>`;
  document.getElementById("panel-contas").insertAdjacentElement("afterend", panel);
  const root = panel.querySelector("#cfRoot");

  tab.addEventListener("click", () => { if (!loaded) run(load, "Cofrinho atualizado"); });
  document.getElementById("hideValuesBtn").addEventListener("click", () => loaded && render());

  /* ---------- Dados ---------- */
  async function load() {
    const meta = await api("?fields=sheets.properties(sheetId,title)");
    ids = {};
    meta.sheets.forEach((s) => (ids[s.properties.title] = s.properties.sheetId));

    if (!(CF.REND in ids)) { // cria a aba de rendimentos na 1ª vez
      const r = await api(":batchUpdate", { method: "POST", body: JSON.stringify({ requests: [{ addSheet: { properties: { title: CF.REND } } }] }) });
      ids[CF.REND] = r.replies[0].addSheet.properties.sheetId;
      await api(`/values/${q(CF.REND + "!A1:D1")}?valueInputOption=RAW`, {
        method: "PUT",
        body: JSON.stringify({ values: [["Data", "Saldo informado", "Depositado até então", "Rendimento"]] }),
      });
    }

    const last = CF.FIRST + CF.COUNT - 1;
    const ranges = CF.GOALS.map((g) => `ranges=${q(`'${g.sheet}'!B${CF.FIRST}:E${last}`)}`).join("&");
    const [res, rr] = await Promise.all([
      api(`/values:batchGet?${ranges}`),
      api(`/values/${q(CF.REND + "!A2:D1000")}`),
    ]);
    CF.GOALS.forEach((g, i) => {
      const v = res.valueRanges[i].values || [];
      data[g.key] = Array.from({ length: CF.COUNT }, (_, k) => {
        const r = v[k] || [];
        return { n: k + 1, row: CF.FIRST + k, done: String(r[0]).toUpperCase() === "TRUE", valor: parseValor(r[2]) || k + 1, date: r[3] || "" };
      });
    });
    rend = (rr.values || []).filter((r) => r[0]).map((r) => ({ data: r[0], saldo: parseValor(r[1]), dep: parseValor(r[2]), valor: parseValor(r[3]) }));
    loaded = true;
  }

  // Marca/desmarca um depósito (Status na coluna B) e grava a data (coluna E)
  async function setDep(g, d, done, dateIso) {
    const sheetId = ids[g.sheet];
    const cell = (col, uv, fmt) => ({
      updateCells: {
        range: { sheetId, startRowIndex: d.row - 1, endRowIndex: d.row, startColumnIndex: col, endColumnIndex: col + 1 },
        rows: [{ values: [fmt ? { userEnteredValue: uv, userEnteredFormat: { numberFormat: fmt } } : { userEnteredValue: uv }] }],
        fields: fmt ? "userEnteredValue,userEnteredFormat.numberFormat" : "userEnteredValue",
      },
    });
    await api(":batchUpdate", {
      method: "POST",
      body: JSON.stringify({
        requests: [
          cell(1, { boolValue: done }),
          cell(4, done ? { numberValue: serial(dateIso) } : {}, { type: "DATE", pattern: "dd/MM/yyyy" }),
        ],
      }),
    });
    d.done = done;
    d.date = done ? br(dateIso) : "";
  }

  const sumDone = (key) => data[key].filter((d) => d.done).reduce((s, d) => s + d.valor, 0);
  const sumRend = () => rend.reduce((s, r) => s + r.valor, 0);

  /* ---------- Tela ---------- */
  const stat = (l, v, s) => `<div class="tilt-card"><div class="stat-top"><span class="stat-label">${l}</span></div><div class="stat-value">${v}</div><div class="stat-sub">${s}</div></div>`;

  function goalHTML(g) {
    const ds = data[g.key];
    const done = ds.filter((d) => d.done);
    const tot = sumDone(g.key), meta = ds.reduce((s, d) => s + d.valor, 0);
    const pct = meta ? (tot / meta) * 100 : 0;
    const chips = ds.map((d) => `<button class="cf-chip ${d.done ? "done" : ""}" data-act="toggle" data-g="${g.key}" data-n="${d.n}">${d.n}</button>`).join("");
    const feitos = [...done].sort((a, b) => toIso(b.date).localeCompare(toIso(a.date)) || b.n - a.n).map((d) => `
      <div class="list-item">
        <div class="list-body"><div class="list-title">Depósito #${d.n}</div><div class="list-date">${fmtBRL(d.valor)}</div></div>
        <div class="list-right"><input type="date" class="cf-date" data-act="date" data-g="${g.key}" data-n="${d.n}" value="${toIso(d.date)}" /></div>
      </div>`).join("");
    return `
    <div class="card cf-card">
      <div class="card-head"><div><h2>${g.label}</h2><p>Desafio dos ${CF.COUNT} depósitos • objetivo 07/07/2027</p></div></div>
      <div class="summary-grid">
        ${stat("Acumulado", fmtBRL(tot), `${pct.toFixed(1)}% da meta`)}
        ${stat("Depósitos", `${done.length} / ${ds.length}`, `${((done.length / ds.length) * 100).toFixed(1)}% concluído`)}
        ${stat("Faltam", fmtBRL(meta - tot), `Meta ${fmtBRL(meta)}`)}
      </div>
      <div class="cf-bar"><div style="width:${pct}%"></div></div>
      <div class="cf-sub">Toque no número do depósito feito (a data de hoje é marcada automaticamente)</div>
      <div class="cf-chips">${chips}</div>
      ${done.length ? `<div class="cf-sub">Depósitos feitos — toque na data para corrigir</div><div class="list">${feitos}</div>` : ""}
    </div>`;
  }

  function rendHTML() {
    const dep = sumDone("20k"), y = sumRend();
    const last = rend.length ? rend[rend.length - 1] : null;
    const saldo = last ? last.saldo : dep + y;
    const hist = [...rend].reverse().slice(0, 6).map((r) => `
      <div class="list-item">
        <div class="list-body"><div class="list-title">${r.data}</div><div class="list-date">Saldo informado ${fmtBRL(r.saldo)}</div></div>
        <div class="list-right"><div class="list-value">${r.valor >= 0 ? "+" : ""}${fmtBRL(r.valor)}</div></div>
      </div>`).join("");
    return `
    <div class="card cf-card">
      <div class="card-head"><div><h2>Caixinha do Nubank</h2><p>Rende 100% do CDI • ≈ ${pt(CF.CDI_AA)}% a.a. • ≈ ${pt(MONTHLY)}% ao mês (Casal 20K)</p></div></div>
      <div class="summary-grid">
        ${stat("Rendimento acumulado", fmtBRL(y), `${rend.length} registro${rend.length === 1 ? "" : "s"}`)}
        ${stat("Saldo na caixinha", fmtBRL(saldo), last ? `informado em ${last.data}` : "estimado (depósitos)")}
        ${stat("Rende por mês", `≈ ${fmtBRL((saldo * MONTHLY) / 100)}`, `${pt(MONTHLY)}% sobre o saldo`)}
      </div>
      <div class="field" style="margin-top:14px;">
        <label>Saldo atual da caixinha (R$)</label>
        <input type="number" id="cfSaldo" step="0.01" min="0" placeholder="Ex: 1250,00" />
        <small class="hint" id="cfPrev">Digite o saldo que aparece no Nubank e o app calcula o rendimento.</small>
      </div>
      <button class="btn-primary" data-act="rend">Registrar rendimento</button>
      ${hist ? `<div class="cf-sub">Últimos registros</div><div class="list">${hist}</div>` : ""}
    </div>`;
  }

  function render() {
    root.innerHTML = `
      <div class="cf-top">
        <button class="btn-secondary" data-act="show10k">${show10k ? "Ocultar 10K" : "Mostrar 10K"}</button>
        <button class="btn-secondary" data-act="refresh">Atualizar</button>
      </div>
      ${CF.GOALS.filter((g) => g.key !== "10k" || show10k).map(goalHTML).join("")}
      ${rendHTML()}`;
  }

  /* ---------- Ações ---------- */
  async function run(fn, ok = "Salvo na planilha") {
    if (busy) return;
    busy = true;
    try {
      await fresh();
      await fn();
      render();
      showToast(ok, false);
    } catch (err) {
      console.error(err);
      showToast("Erro: " + String(err.message).slice(0, 120), true);
    } finally { busy = false; }
  }

  const find = (el) => {
    const g = CF.GOALS.find((x) => x.key === el.dataset.g);
    return [g, g && data[g.key][Number(el.dataset.n) - 1]];
  };

  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || b.dataset.act === "date") return;
    const act = b.dataset.act;
    if (act === "refresh") return run(load, "Cofrinho atualizado");
    if (act === "show10k") { show10k = !show10k; localStorage.setItem("cfShow10k", show10k ? "1" : "0"); return render(); }
    if (act === "toggle") {
      const [g, d] = find(b);
      const msg = d.done ? `Desmarcar o depósito #${d.n}?` : `Marcar o depósito #${d.n} (R$ ${pt(d.valor)}) como feito hoje?`;
      if (!confirm(msg)) return;
      return run(() => setDep(g, d, !d.done, iso()));
    }
    if (act === "rend") {
      const saldo = parseFloat(document.getElementById("cfSaldo").value);
      if (isNaN(saldo) || saldo < 0) return showToast("Digite o saldo atual da caixinha", true);
      const dep = sumDone("20k"), valor = saldo - dep - sumRend();
      if (valor < 0 && !confirm(`O rendimento ficou negativo (R$ ${pt(valor)}). Isso costuma indicar um depósito marcado que ainda não entrou na caixinha. Registrar mesmo assim?`)) return;
      return run(async () => {
        await api(`/values/${q(CF.REND + "!A:D")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
          method: "POST",
          body: JSON.stringify({ values: [[br(iso()), saldo, dep, Math.round(valor * 100) / 100]] }),
        });
        await load();
      }, "Rendimento registrado");
    }
  });

  root.addEventListener("change", (e) => {
    if (e.target.dataset.act !== "date") return;
    const [g, d] = find(e.target);
    if (!e.target.value) return render();
    run(() => setDep(g, d, true, e.target.value), "Data atualizada");
  });

  root.addEventListener("input", (e) => {
    if (e.target.id !== "cfSaldo") return;
    const s = parseFloat(e.target.value), prev = document.getElementById("cfPrev");
    if (isNaN(s)) { prev.textContent = "Digite o saldo que aparece no Nubank e o app calcula o rendimento."; return; }
    const v = s - sumDone("20k") - sumRend();
    prev.textContent = valuesHidden ? "Rendimento calculado: ••••••" : `Rendimento desde o último registro: ${v >= 0 ? "+" : ""}R$ ${pt(v)}`;
  });
})();
