(() => {
  const STORE = "https://tm-sga-prod-rectify-store.graceful-kryptops.workers.dev";
  const INSTALL_SHEETS = ["P1", "P2", "P5", "P9", "P10", "P11", "SA5"];
  const BLOCKING = new Set(INSTALL_SHEETS);
  const data = window.DASHBOARD_DATA;
  if (!data) {
    const err = document.getElementById("err") || document.body;
    err.innerHTML = "<div class='err'>dashboard-data.js failed to load. Hard-refresh this page.</div>";
    return;
  }
  const TM = new Set((data.tmPackages || []).map((p) => p.name));
  const SGA = new Set((data.sgaIssuePackages || []).map((p) => p.name));
  const sgaTripName = {};
  (data.sgaPricing || []).forEach((t) => {
    if (t && t.code) sgaTripName[t.code] = t.name || t.code;
  });

  function tripCode(name) {
    const s = String(name || "").trim();
    return s.toUpperCase().startsWith("SGA ") ? s.slice(4).trim() : s;
  }

  function emptyPkg(name) {
    return { name, yes: 0, open: 0, cards: 0, blocking: {}, sheets: {}, firstInsertReady: true, fullyReady: true };
  }

  function addToPkg(map, name, card, ch) {
    if (!map[name]) return;
    const p = map[name];
    p.cards += 1;
    if (!p.sheets[card.sheet]) p.sheets[card.sheet] = { open: 0, decided: 0 };
    if (ch === "yes") {
      p.yes += 1;
      p.sheets[card.sheet].decided += 1;
    } else if (ch === "open") {
      p.open += 1;
      p.sheets[card.sheet].open += 1;
      p.fullyReady = false;
      if (BLOCKING.has(card.sheet)) {
        p.firstInsertReady = false;
        p.blocking[card.sheet] = (p.blocking[card.sheet] || 0) + 1;
      }
    } else if (ch === "no" || ch === "done") {
      p.sheets[card.sheet].decided += 1;
    } else {
      p.fullyReady = false;
    }
    if (card.sheet === "P6" && ch === "yes") p.fullyReady = false;
  }

  function pkgLabel(p) {
    if (SGA.has(p.name) && sgaTripName[p.name]) return p.name + " · " + sgaTripName[p.name];
    return p.name;
  }

  function installSheetsOf(kind) {
    return kind === "sga" ? INSTALL_SHEETS.filter((id) => id !== "P1") : INSTALL_SHEETS.slice();
  }

  function sheetOpenCount(p, id) {
    if (p.sheets && p.sheets[id]) return Number(p.sheets[id].open) || 0;
    if (p.blocking && p.blocking[id]) return Number(p.blocking[id]) || 0;
    if (p.bySheet && p.bySheet[id]) return Number(p.bySheet[id].open) || 0;
    if (p.openBlocking) return p.openBlocking.filter((x) => x.sheet === id).length;
    return 0;
  }

  function isInstallReady(p, kind) {
    return installSheetsOf(kind).every((id) => sheetOpenCount(p, id) === 0);
  }

  function pillsHtml(ids, openCountFn) {
    return `<span class="pills">${ids.map((id) => {
      const n = Number(openCountFn(id)) || 0;
      const ok = n === 0;
      const label = !ok && n > 1 ? id + " · " + n : id;
      return `<span class="tag ${ok ? "yes" : "no"}" title="${ok ? id + " ready" : id + " not ready (" + n + " open)"}">${esc(label)}</span>`;
    }).join("")}</span>`;
  }

  function pkgRowHtml(p, kind) {
    const ids = installSheetsOf(kind);
    const ready = isInstallReady(p, kind);
    return `<div class="pkg-row">
      <div>${esc(pkgLabel(p))}</div>
      <div>${pillsHtml(ids, (id) => sheetOpenCount(p, id))}</div>
      <div>${ready ? tag("yes", "Ready to install") : tag("no", "Not ready")}</div>
    </div>`;
  }

  function pkgListHtml(rows, kind) {
    return `<div class="pkg-list">${rows.map((p) => pkgRowHtml(p, kind)).join("")}</div>`;
  }

  function pkgTableHtml(rows, kind) {
    const ids = installSheetsOf(kind);
    return `<table>
      <thead><tr><th>Package</th><th>Required tabs</th><th>Install?</th></tr></thead>
      <tbody>${rows.map((p) => {
        const ready = isInstallReady(p, kind);
        return `<tr>
          <td>${esc(pkgLabel(p))}</td>
          <td>${pillsHtml(ids, (id) => sheetOpenCount(p, id))}</td>
          <td>${ready ? tag("yes", "Ready to install") : tag("no", "Not ready")}</td>
        </tr>`;
      }).join("")}</tbody>
    </table>`;
  }

  function svcOpenOn(row, id) {
    if (row.sheets && row.sheets[id]) return Number(row.sheets[id].open) || 0;
    if ((row.openSheets || []).includes(id)) return 1;
    return 0;
  }

  function svcInstallReady(row) {
    if (typeof row.firstInsertReady === "boolean") return row.firstInsertReady;
    return !INSTALL_SHEETS.some((id) => svcOpenOn(row, id) > 0);
  }

  function statusOf(row) {
    if (!row) return "open";
    const st = String(row.status || "").toLowerCase();
    const ch = String(row.choice || "").toLowerCase();
    if (st === "no" || ch === "no") return "no";
    if (st === "yes" || ch === "yes" || ch === "prod" || ch.startsWith("match:")) return "yes";
    if (st === "done" || ch === "done") return "done";
    return "open";
  }

  function fromRemote(raw) {
    const byId = {};
    (raw.items || []).forEach((item) => {
      if (item && item.id) byId[item.id] = item;
    });
    if (raw.byId) Object.assign(byId, raw.byId);
    return { byId, updatedAt: raw.updatedAt || "", people: raw.people || [] };
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function tag(kind, label) {
    return `<span class="tag ${kind}">${esc(label)}</span>`;
  }

  function fmtWhen(v) {
    if (!v) return "—";
    return String(v).replace("T", " ").replace("Z", " UTC");
  }

  function fold(s) {
    return String(s || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function sheetSortKey(id) {
    const s = String(id || "").toUpperCase();
    const m = s.match(/^(P|SA|S)(\d+)$/);
    if (!m) return [2, 999, s];
    return [m[1] === "P" ? 0 : 1, Number(m[2]), s];
  }

  function cmpSheets(a, b) {
    const aa = sheetSortKey(a && a.id);
    const bb = sheetSortKey(b && b.id);
    return aa[0] - bb[0] || aa[1] - bb[1] || String((a && a.id) || "").localeCompare(String((b && b.id) || ""));
  }

  function decidedOf(s) {
    if (!s) return 0;
    if (s.decided != null) return Number(s.decided) || 0;
    return (Number(s.yes) || 0) + (Number(s.no) || 0) + (Number(s.done) || 0);
  }

  function render(live) {
    const byId = (live && live.byId) || {};
    const useLive = Object.keys(byId).length > 0;
    const cards = (data.cards || []).map((c) => ({
      ...c,
      choice: useLive ? statusOf(byId[c.id]) : null,
    }));

    let yes = 0, no = 0, open = 0;
    const sheetStats = {};
    (data.sheets || []).forEach((s) => {
      sheetStats[s.id] = { ...s, yes: 0, no: 0, open: 0, decided: 0 };
    });
    const svcOpen = {};
    const svcState = {};
    const pkg = {};
    const sgaPkg = {};
    TM.forEach((n) => { pkg[n] = emptyPkg(n); });
    SGA.forEach((n) => { sgaPkg[n] = emptyPkg(n); });

    const srcCards = useLive ? cards : null;
    if (srcCards) {
      srcCards.forEach((c) => {
        const ch = c.choice;
        if (ch === "yes") yes += 1;
        else if (ch === "no") no += 1;
        else open += 1;
        if (sheetStats[c.sheet]) {
          const st = sheetStats[c.sheet];
          if (ch === "yes") { st.yes += 1; st.decided += 1; }
          else if (ch === "no") { st.no += 1; st.decided += 1; }
          else if (ch === "done") { st.decided += 1; }
          else st.open += 1;
        }
        const k = fold(c.service);
        if (!svcState[k]) svcState[k] = { service: c.service, anyOpen: false, blockingOpen: false, decided: false, sheets: {} };
        if (!svcState[k].sheets[c.sheet]) svcState[k].sheets[c.sheet] = { open: 0, decided: 0 };
        if (ch === "open") {
          svcState[k].sheets[c.sheet].open += 1;
          if (!svcOpen[k]) svcOpen[k] = { service: c.service, sheets: new Set() };
          svcOpen[k].sheets.add(c.sheet);
          svcState[k].anyOpen = true;
          if (BLOCKING.has(c.sheet)) svcState[k].blockingOpen = true;
        } else if (ch === "yes" || ch === "no" || ch === "done") {
          svcState[k].sheets[c.sheet].decided += 1;
          svcState[k].decided = true;
        }
        const on = (c.tmOn && c.tmOn.length ? c.tmOn : c.packages) || [];
        on.forEach((p) => {
          if (TM.has(p)) addToPkg(pkg, p, c, ch);
        });
        (c.packages || []).forEach((p) => {
          const code = tripCode(p);
          if (SGA.has(code) || SGA.has(p)) addToPkg(sgaPkg, SGA.has(code) ? code : p, c, ch);
        });
      });
    }

    const h = data.headline;
    const firstReady = useLive
      ? Object.values(pkg).filter((p) => p.firstInsertReady).length
      : h.firstInsertReady;
    const fully = useLive ? Object.values(pkg).filter((p) => p.fullyReady).length : h.fullyReady;
    const sgaRowsBaked = data.sgaIssuePackages || [];
    const sgaFirstReady = useLive
      ? Object.values(sgaPkg).filter((p) => p.firstInsertReady).length
      : sgaRowsBaked.filter((p) => p.firstInsertReady).length;
    const sgaFully = useLive
      ? Object.values(sgaPkg).filter((p) => p.fullyReady).length
      : sgaRowsBaked.filter((p) => p.fullyReady).length;
    const sgaCount = useLive ? Object.keys(sgaPkg).length : (h.sgaTrips || sgaRowsBaked.length);
    const prob = useLive ? Object.keys(svcOpen).length : h.problematicServices;
    const uniqueSvc = useLive ? Object.keys(svcState).length : (h.uniqueServices || prob);
    const servicesFinalised = useLive
      ? Object.values(svcState).filter((s) => !s.anyOpen).length
      : (h.servicesFinalised || 0);
    const servicesFirstInsert = useLive
      ? Object.values(svcState).filter((s) => !s.blockingOpen).length
      : (h.servicesFirstInsertDecided || 0);
    const servicesWithDecision = useLive
      ? Object.values(svcState).filter((s) => s.decided).length
      : (h.servicesWithADecision || 0);
    const toolYes = useLive ? yes : h.toolYes;
    const toolOpen = useLive ? open : h.toolOpen;
    const saSupWith = h.sa1SuppliersWithAgreement || 0;
    const saSupNone = h.sa1SuppliersStillNone || 0;
    const saSupAll = h.sa1UniqueSuppliers || (saSupWith + saSupNone);

    document.getElementById("meta").textContent =
      `Tool extract ${data.extract || "—"}. Saved answers ${fmtWhen((live && live.updatedAt) || data.storeUpdatedAt)}. Prod agreements ${fmtWhen(data.prodSaQueriedAt)}.`;

    document.getElementById("answers").innerHTML = `
      <div class="answer wait"><b>${fully}</b><span>FIT packages fully ready to import (of ${h.tmPackages})</span></div>
      <div class="answer wait"><b>${firstReady}</b><span>FIT packages ready for first insert</span></div>
      <div class="answer wait"><b>${sgaFully}</b><span>SGA packages fully ready to import (of ${sgaCount})</span></div>
      <div class="answer wait"><b>${sgaFirstReady}</b><span>SGA packages ready for first insert</span></div>
      <div class="answer wait"><b>${servicesFinalised} / ${uniqueSvc}</b><span>Unique services fully decided (no open cards left)</span></div>
      <div class="answer ok"><b>${servicesFirstInsert} / ${uniqueSvc}</b><span>Unique services first-insert decided (name / supplier / location / type closed)</span></div>
      <div class="answer wait"><b>${prob}</b><span>Unique services still with at least one open card</span></div>
      <div class="answer ok"><b>${saSupWith} / ${saSupAll}</b><span>Unique SA1 suppliers now with a live Prod agreement</span></div>
      <div class="answer ok"><b>${h.prodMoroccoAccounts}</b><span>Intrepid Morocco accounts with an account-level SA — this is the OK / expected model (${h.prodMoroccoAgreements} agreements)</span></div>
      <div class="answer"><b>${h.sgaTrips}</b><span>SGA trips · ${h.sgaUniqueServices} unique services · Group Tour 2027 on most; TM/FIT is rare</span></div>
    `;

    document.getElementById("defs").innerHTML =
      `<b>How to read this.</b> ${esc(data.definitions.firstInsertReady)} ${esc(data.definitions.fullyReady)}
      ${esc(data.definitions.servicesFinalised || "")} ${esc(data.definitions.servicesFirstInsert || "")}
      ${esc(data.definitions.suppliersFinalised || "")}
      ${esc(data.definitions.tmPricing)} ${esc(data.definitions.groupTourPricing)} ${esc(data.definitions.saLive)}
      Decision tool: <a href="${esc(data.rectifyUrl)}">${esc(data.rectifyUrl)}</a>. Yes in the tool: ${toolYes} across ${servicesWithDecision} unique services. Still open: ${toolOpen}.`;

    const pkgRows = (useLive ? Object.values(pkg) : data.tmPackages).sort((a, b) => a.name.localeCompare(b.name));
    document.getElementById("pkgTable").innerHTML = pkgTableHtml(pkgRows, "tm");
    const sgaPkgRows = (useLive ? Object.values(sgaPkg) : sgaRowsBaked).sort((a, b) => a.name.localeCompare(b.name));
    const sgaPkgBox = document.getElementById("sgaPkgTable");
    if (sgaPkgBox) sgaPkgBox.innerHTML = pkgTableHtml(sgaPkgRows, "sga");

    const svcList = useLive
      ? Object.values(svcState).map((row) => ({
          service: row.service,
          sheets: row.sheets,
          openCount: Object.values(row.sheets).reduce((n, s) => n + (s.open ? 1 : 0), 0),
          firstInsertReady: !row.blockingOpen,
        }))
      : (data.problematicServices || []).map((r) => ({
          service: r.service,
          openSheets: r.openSheets || [],
          openCount: r.openCount || (r.openSheets || []).length,
          firstInsertReady: !(r.openSheets || []).some((id) => BLOCKING.has(id)),
        }));
    svcList.sort((a, b) => Number(!!a.firstInsertReady) - Number(!!b.firstInsertReady) || b.openCount - a.openCount || a.service.localeCompare(b.service));
    window._svcList = svcList;
    drawSvc();

    document.getElementById("saSummary").innerHTML = `<table>
      <tbody>
        <tr><td>Intrepid Morocco agreements on Prod today</td><td><b>${h.prodMoroccoAgreements}</b> on ${h.prodMoroccoAccounts} accounts</td></tr>
        <tr><td>How they are stored</td><td>${tag("yes", "Account-level is OK")} — service assignments are not required. ${h.prodMoroccoAssignments || 0} service-level rows (expected to be none).</td></tr>
        <tr><td>SA1 open in the tool (old extract)</td><td><b>${h.sa1OpenInTool}</b></td></tr>
        <tr><td>Unique SA1 suppliers</td><td><b>${saSupAll}</b></td></tr>
        <tr><td>Of those, already have a live account SA</td><td><b>${saSupWith}</b> — do not create another</td></tr>
        <tr><td>Unique SA1 suppliers still with no account SA</td><td><b>${saSupNone}</b></td></tr>
        <tr><td>SA1 services now matching a Prod account SA</td><td><b>${h.sa1CoveredByLiveProd}</b> services</td></tr>
        <tr><td>SA1 services still with no account SA</td><td><b>${h.sa1StillNoAgreement}</b> services</td></tr>
        <tr><td>SA3 template title vs Prod name</td><td><b>${h.sa3Open}</b> — naming only (Prod is still like Jan 2026 - Dec 2027), not a missing agreement</td></tr>
        <tr><td>SA5 which supplier account still open</td><td><b>${h.sa5Open}</b></td></tr>
      </tbody>
    </table>`;
    window._saStill = data.sa1StillNoAgreement;
    window._saCovered = data.sa1CoveredByLiveProd;
    window._supWith = data.sa1SuppliersWithAgreement || [];
    window._supNone = data.sa1SuppliersStillNone || [];
    drawSa();
    drawSup();

    const sheets = (useLive ? Object.values(sheetStats) : data.sheets).slice().sort(cmpSheets);
    document.getElementById("sheetTable").innerHTML = `<table>
      <thead><tr><th>Tab</th><th>Decided</th><th>Not decided</th><th>Total</th></tr></thead>
      <tbody>${sheets.map((s) => `<tr>
        <td>${esc(s.id)} ${esc(s.title || "")}</td>
        <td>${decidedOf(s)}</td><td>${s.open}</td><td>${s.total}</td>
      </tr>`).join("")}</tbody>
    </table>`;

    document.getElementById("sgaTable").innerHTML = `<table>
      <thead><tr><th>Trip</th><th>Name</th><th>Unique services</th><th>Group Tour 2027</th><th>TM (FIT) 2027</th><th>Both</th><th>Gaps</th></tr></thead>
      <tbody>${data.sgaPricing.map((t) => {
        const gt = (t.counts["Group Tour only"] || 0) + (t.counts["TM + Group Tour"] || 0);
        const tm = (t.counts["TM (FIT) only"] || 0) + (t.counts["TM + Group Tour"] || 0);
        const both = t.counts["TM + Group Tour"] || 0;
        return `<tr>
          <td>${esc(t.code)}</td>
          <td>${esc(t.name)}<div class="detail">${esc(t.start)} → ${esc(t.end)}</div></td>
          <td>${t.unique}</td>
          <td>${gt === t.unique ? tag("yes", gt + " / " + t.unique) : tag("open", gt + " / " + t.unique)}</td>
          <td>${tm ? tag("yes", String(tm)) : tag("open", "0")}</td>
          <td>${both || "0"}</td>
          <td>${t.gaps.length ? tag("open", String(t.gaps.length)) : tag("yes", "0")}</td>
        </tr>`;
      }).join("")}</tbody>
    </table>`;

    const gaps = [];
    data.sgaPricing.forEach((t) => t.gaps.forEach((g) => gaps.push({ trip: t.code, ...g })));
    document.getElementById("sgaGaps").innerHTML = gaps.length
      ? `<table><thead><tr><th>Trip</th><th>Service</th><th>TM (FIT)</th><th>Group Tour</th><th>Note</th></tr></thead>
        <tbody>${gaps.map((g) => `<tr>
          <td>${esc(g.trip)}</td><td>${esc(g.service)}</td>
          <td>${g.tmFit ? "Yes" : "No"}</td><td>${g.groupTour ? "Yes" : "No"}</td>
          <td>${esc(g.bucket)}</td>
        </tr>`).join("")}</tbody></table>`
      : "<p>Every SGA service has a 2027 Group Tour price.</p>";

    document.getElementById("foot").textContent =
      "People in the tool: " + (data.people || []).join(", ") +
      ". Hosted with the decision app. Prod queries are read-only.";

    drawCharts({
      toolYes,
      toolNo: useLive ? no : h.toolNo,
      toolOpen,
      sheets,
      pkgRows,
      sgaPkgRows,
      firstReady,
      sgaFirstReady,
      h,
      uniqueSvc,
      servicesFinalised,
      servicesFirstInsert,
      saSupWith,
      saSupNone,
    });
  }

  function doughnut(slices) {
    const total = slices.reduce((a, s) => a + (Number(s.value) || 0), 0) || 1;
    const r = 52;
    const c = 2 * Math.PI * r;
    let off = 0;
    const rings = slices.map((s) => {
      const v = Number(s.value) || 0;
      const len = (v / total) * c;
      const dash = `<circle cx="70" cy="70" r="${r}" fill="none" stroke="${s.color}" stroke-width="18" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"></circle>`;
      off += len;
      return dash;
    }).join("");
    const legend = `<ul class="legend">${slices.map((s) =>
      `<li><span class="swatch" style="background:${s.color}"></span>${esc(s.label)} — <b>${s.value}</b></li>`
    ).join("")}</ul>`;
    return `<div class="donut-wrap">
      <svg width="140" height="140" viewBox="0 0 140 140" aria-hidden="true">${rings}</svg>
      ${legend}
    </div>`;
  }

  function stackedBars(rows, kind) {
    const max = Math.max(1, ...rows.map((r) => (r.yes || 0) + (r.open || 0) + (r.a || 0) + (r.b || 0)));
    const cls = kind === "pkg" ? "hbar pkg" : "hbar";
    if (kind === "ready") {
      return rows.map((r) => {
        const ready = !!r.ready;
        return `<div class="hbar">
          <div>${esc(r.label)}</div>
          <div class="track"><div class="seg" style="width:100%;background:${ready ? "#1f6b4a" : "#d97706"}"></div></div>
          <div>${ready ? "Ready" : "Not yet"}</div>
        </div>`;
      }).join("");
    }
    if (kind === "pct") {
      return rows.map((r) => `<div class="pct">
        <div>${esc(r.label)}</div>
        <div class="pair">
          <div class="track"><div class="seg" style="width:${r.a}%;background:#1F4E79"></div></div>
          <div class="track"><div class="seg" style="width:${r.b}%;background:#7c3aed"></div></div>
        </div>
        <div>${r.a}% GT<br>${r.b}% TM</div>
      </div>`).join("");
    }
    return rows.map((r) => {
      const yes = r.yes || 0;
      const open = r.open || 0;
      const sum = yes + open;
      return `<div class="${cls}">
        <div>${esc(r.label)}</div>
        <div class="track">
          <div class="seg" style="width:${(100 * yes) / max}%;background:#1f6b4a"></div>
          <div class="seg" style="width:${(100 * open) / max}%;background:#d97706"></div>
        </div>
        <div>${yes} / ${sum}</div>
      </div>`;
    }).join("");
  }

  function drawCharts(s) {
    const mix = s.h.sgaPriceSummary || {};
    document.getElementById("chartTool").innerHTML = doughnut([
      { label: "Yes", value: s.toolYes, color: "#1f6b4a" },
      { label: "No", value: s.toolNo, color: "#9b1c1c" },
      { label: "Open", value: s.toolOpen, color: "#d97706" },
    ]);
    const stillBlocking = Math.max(0, (s.uniqueSvc || 0) - (s.servicesFirstInsert || 0));
    const firstOnly = Math.max(0, (s.servicesFirstInsert || 0) - (s.servicesFinalised || 0));
    const svcMixEl = document.getElementById("chartSvcMix");
    if (svcMixEl) {
      svcMixEl.innerHTML = doughnut([
        { label: "Fully decided (no open cards)", value: s.servicesFinalised || 0, color: "#1f6b4a" },
        { label: "First-insert decided, other cards still open", value: firstOnly, color: "#1F4E79" },
        { label: "Still blocking first insert", value: stillBlocking, color: "#d97706" },
      ]);
    }
    document.getElementById("chartSa").innerHTML = doughnut([
      { label: "Unique suppliers with an account-level Prod SA (OK)", value: s.saSupWith || 0, color: "#1f6b4a" },
      { label: "Unique suppliers still with no account SA", value: s.saSupNone || 0, color: "#d97706" },
    ]);
    document.getElementById("chartSgaMix").innerHTML = doughnut([
      { label: "Group Tour only", value: mix["Group Tour only"] || 0, color: "#1F4E79" },
      { label: "TM (FIT) + Group Tour", value: mix["Both FIT + Group Tour"] || 0, color: "#1f6b4a" },
      { label: "TM (FIT) only", value: mix["FIT only"] || 0, color: "#7c3aed" },
      { label: "On Prod, no 2027", value: mix["On Prod, no 2027"] || 0, color: "#d97706" },
      { label: "Not on Prod", value: mix["Not on Prod"] || 0, color: "#9b1c1c" },
    ]);
    function fillPkgPie(elId, capId, rows, label) {
      const el = document.getElementById(elId);
      if (!el) return;
      const n = rows.length;
      const ready = rows.filter((p) => p.firstInsertReady).length;
      const slices = [
        { label: "First-insert ready", value: ready, color: "#1f6b4a" },
        { label: "Not yet", value: Math.max(0, n - ready), color: "#d97706" },
      ];
      el.innerHTML = doughnut(slices);
      const cap = document.getElementById(capId);
      if (cap) {
        cap.textContent = `${ready} of ${n} ${label} first-insert ready. Each slice is a package, not a service.`;
      }
    }
    fillPkgPie("chartFitPie", "fitPieCaption", s.pkgRows || [], "FIT packages");
    fillPkgPie("chartSgaPie", "sgaPieCaption", s.sgaPkgRows || [], "SGA packages");
    const sheetRows = (s.sheets || []).slice().sort(cmpSheets);
    document.getElementById("chartSheets").innerHTML =
      `<div style="margin-bottom:6px;font-size:12px;color:#5c564c">Green = Decided · Amber = Not decided</div>` +
      stackedBars(sheetRows.map((x) => ({
        label: x.id + " " + (x.title || ""),
        yes: decidedOf(x),
        open: x.open || 0,
      })));
    const pkgs = (s.pkgRows || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    document.getElementById("chartPkgs").innerHTML =
      `<div style="margin-bottom:6px;font-size:12px;color:#5c564c">Green = ready · Red = not ready · Ready to install only when every pill is green</div>` +
      pkgListHtml(pkgs, "tm");
    const sgaPkgs = (s.sgaPkgRows || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    const sgaChart = document.getElementById("chartSgaPkgs");
    if (sgaChart) {
      sgaChart.innerHTML =
        `<div style="margin-bottom:6px;font-size:12px;color:#5c564c">Green = ready · Red = not ready · Ready to install only when every pill is green</div>` +
        pkgListHtml(sgaPkgs, "sga");
    }
    const trips = data.sgaPricing || [];
    document.getElementById("chartSgaTrips").innerHTML =
      `<div style="margin-bottom:6px;font-size:12px;color:#5c564c">Navy = Group Tour · Purple = TM (FIT)</div>` +
      stackedBars(trips.map((t) => {
        const gt = (t.counts["Group Tour only"] || 0) + (t.counts["TM + Group Tour"] || 0);
        const tm = (t.counts["TM (FIT) only"] || 0) + (t.counts["TM + Group Tour"] || 0);
        return {
          label: t.code,
          a: t.unique ? Math.round((100 * gt) / t.unique) : 0,
          b: t.unique ? Math.round((100 * tm) / t.unique) : 0,
        };
      }), "pct");
  }

  function drawSvc() {
    const q = (document.getElementById("svcQ").value || "").trim().toLowerCase();
    const rows = (window._svcList || []).filter((r) => !q || r.service.toLowerCase().includes(q));
    document.getElementById("svcTable").innerHTML = `<table>
      <thead><tr><th>Service</th><th>Tabs</th><th>Install?</th></tr></thead>
      <tbody>${rows.slice(0, 200).map((r) => {
        const ready = svcInstallReady(r);
        return `<tr>
          <td>${esc(r.service)}</td>
          <td>${pillsHtml(INSTALL_SHEETS, (id) => svcOpenOn(r, id))}</td>
          <td>${ready ? tag("yes", "Ready to install") : tag("no", "Not ready")}</td>
        </tr>`;
      }).join("")}${rows.length > 200 ? `<tr><td colspan="3" class="muted">Showing 200 of ${rows.length}. Search to narrow.</td></tr>` : ""}</tbody>
    </table>`;
  }

  function drawSup() {
    const modeEl = document.getElementById("supFilter");
    const qEl = document.getElementById("supQ");
    const box = document.getElementById("supplierTable");
    if (!modeEl || !qEl || !box) return;
    const mode = modeEl.value;
    const q = (qEl.value || "").trim().toLowerCase();
    const rows = (mode === "with" ? window._supWith : window._supNone) || [];
    const filtered = rows.filter((r) => {
      const blob = ((r.supplier || "") + " " + (r.account || "") + " " + (r.agreement || "")).toLowerCase();
      return !q || blob.includes(q);
    });
    box.innerHTML = `<table>
      <thead><tr><th>Supplier</th><th>Prod account</th><th>Agreement</th><th>Services</th></tr></thead>
      <tbody>${filtered.map((r) => `<tr>
        <td>${esc(r.supplier)}</td>
        <td>${esc(r.account || "")}</td>
        <td>${esc(r.agreement || "None")}</td>
        <td>${r.serviceCount || 0}${r.services && r.services.length ? `<div class="detail">${esc(r.services.join(", "))}</div>` : ""}</td>
      </tr>`).join("") || `<tr><td colspan="4" class="muted">None.</td></tr>`}</tbody>
    </table>`;
  }

  function drawSa() {
    const mode = document.getElementById("saFilter").value;
    const q = (document.getElementById("saQ").value || "").trim().toLowerCase();
    const rows = (mode === "covered" ? window._saCovered : window._saStill) || [];
    const filtered = rows.filter((r) => {
      const blob = (r.service + " " + (r.prodSupplier || "") + " " + (r.account || "")).toLowerCase();
      return !q || blob.includes(q);
    });
    document.getElementById("saTable").innerHTML = `<table>
      <thead><tr><th>Service</th><th>Prod supplier / account</th><th>${mode === "covered" ? "Prod agreement" : "In tool"}</th></tr></thead>
      <tbody>${filtered.slice(0, 150).map((r) => `<tr>
        <td>${esc(r.service)}</td>
        <td>${esc(r.prodSupplier || r.account || "")}</td>
        <td>${esc(r.agreement || "SA1 still open")}</td>
      </tr>`).join("")}${filtered.length > 150 ? `<tr><td colspan="3" class="muted">Showing 150 of ${filtered.length}.</td></tr>` : ""}</tbody>
    </table>`;
  }

  document.getElementById("svcQ").addEventListener("input", drawSvc);
  document.getElementById("saQ").addEventListener("input", drawSa);
  document.getElementById("saFilter").addEventListener("change", drawSa);
  const supFilter = document.getElementById("supFilter");
  const supQ = document.getElementById("supQ");
  if (supFilter) supFilter.addEventListener("change", drawSup);
  if (supQ) supQ.addEventListener("input", drawSup);

  try {
    render(null);
  } catch (e) {
    const box = document.getElementById("err");
    if (box) box.innerHTML = "<div class='err'>Dashboard failed to draw: " + esc(e.message || e) + "</div>";
  }
  fetch(STORE + "?t=" + Date.now(), { cache: "no-store" })
    .then((r) => r.json())
    .then((raw) => {
      try { render(fromRemote(raw)); } catch (e) { console.error(e); }
    })
    .catch(() => {});
})();
