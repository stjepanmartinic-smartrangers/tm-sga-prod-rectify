(() => {
  const STORE = "https://tm-sga-prod-rectify-store.graceful-kryptops.workers.dev";
  const INSTALL_SHEETS = ["P1", "P2", "P5", "P9", "P10", "P11", "SA5"];
  const BLOCKING = new Set(INSTALL_SHEETS);
  const SHEET_NAMES = {
    P1: "Missing in template",
    P2: "Fuzzy name",
    P4: "Price missing",
    P5: "Supplier mismatch",
    P6: "Occupancy name",
    P8: "FIT price missing",
    P9: "Location mismatch",
    P10: "Type mismatch",
    P11: "Occupancy N/A",
    SA1: "No agreement",
    SA3: "Agreement name",
    SA5: "Which supplier",
  };
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

  function sheetName(id) {
    if (SHEET_NAMES[id]) return SHEET_NAMES[id];
    const row = (data.sheets || []).find((s) => s.id === id);
    return (row && row.title) || String(id || "");
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
      const name = sheetName(id);
      const label = !ok && n > 1 ? name + " · " + n : name;
      return `<span class="tag ${ok ? "yes" : "no"}" title="${ok ? name + " — ready" : name + " — not ready (" + n + " open)"}">${esc(label)}</span>`;
    }).join("")}</span>`;
  }

  function pkgRowHtml(p, kind) {
    const ids = installSheetsOf(kind);
    const ready = isInstallReady(p, kind);
    return `<div class="pkg-row">
      <div>${esc(pkgLabel(p))}</div>
      <div>${pillsHtml(ids, (id) => sheetOpenCount(p, id))}</div>
      <div>${ready ? tag("yes", "Ready") : tag("no", "Not ready")}</div>
    </div>`;
  }

  function pkgListHtml(rows, kind) {
    return `<div class="pkg-list">${rows.map((p) => pkgRowHtml(p, kind)).join("")}</div>`;
  }

  function pkgTableHtml(rows, kind) {
    const ids = installSheetsOf(kind);
    return `<table>
      <thead><tr><th>Package</th><th>Problems</th><th>Ready?</th></tr></thead>
      <tbody>${rows.map((p) => {
        const ready = isInstallReady(p, kind);
        return `<tr>
          <td>${esc(pkgLabel(p))}</td>
          <td>${pillsHtml(ids, (id) => sheetOpenCount(p, id))}</td>
          <td>${ready ? tag("yes", "Ready") : tag("no", "Not ready")}</td>
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
      <div class="answer wait"><b>${fully}</b><span>FIT packages fully ready (of ${h.tmPackages})</span></div>
      <div class="answer wait"><b>${firstReady}</b><span>FIT packages ready</span></div>
      <div class="answer wait"><b>${sgaFully}</b><span>SGA packages fully ready (of ${sgaCount})</span></div>
      <div class="answer wait"><b>${sgaFirstReady}</b><span>SGA packages ready</span></div>
      <div class="answer wait"><b>${servicesFinalised} / ${uniqueSvc}</b><span>Unique services fully decided (no open cards left)</span></div>
      <div class="answer ok"><b>${servicesFirstInsert} / ${uniqueSvc}</b><span>Unique services ready</span></div>
      <div class="answer wait"><b>${prob}</b><span>Unique services still with at least one open card</span></div>
      <div class="answer ok"><b>${h.saNewWithAgreement || 0} / ${h.saNewServices || 0}</b><span>New template services whose supplier already has a Prod SA</span></div>
      <div class="answer wait"><b>${h.saExistingWithAgreement || 0} / ${h.saExistingServices || 0}</b><span>Existing Prod services whose supplier has a Morocco SA</span></div>
      <div class="answer ok"><b>${saSupWith} / ${saSupAll}</b><span>Unique SA1 suppliers now with a live Prod agreement</span></div>
      <div class="answer ok"><b>${h.prodMoroccoAccounts}</b><span>Intrepid Morocco accounts with an account-level SA — this is the OK / expected model (${h.prodMoroccoAgreements} agreements)</span></div>
      <div class="answer"><b>${h.sgaTrips}</b><span>SGA trips · ${h.sgaUniqueServices} unique services · Group Tour 2027 on most; TM/FIT is rare</span></div>
    `;

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

    const saNew = data.saNewInTemplate || { summary: {}, noAgreement: [], suppliersNoAgreement: [] };
    const saEx = data.saExistingOnProd || { summary: {}, noAgreement: [], suppliersNoAgreement: [] };
    window._saNewNone = saNew.noAgreement || [];
    window._saExNone = saEx.noAgreement || [];
    window._saAccounts = data.agreementsByAccount || [];
    const splitBox = document.getElementById("saSplitSummary");
    if (splitBox) {
      const ns = saNew.summary || {};
      const es = saEx.summary || {};
      splitBox.innerHTML = `<table>
        <tbody>
          <tr><td>New in Service Template (not on Prod)</td><td><b>${ns.services || 0}</b> unique services · ${ns.uniqueSuppliers || 0} suppliers</td></tr>
          <tr><td>Those already covered by a Prod account SA</td><td><b>${ns.servicesWithAgreement || 0}</b> services / ${ns.suppliersWithAgreement || 0} suppliers — do not create another SA</td></tr>
          <tr><td>New in template, no account SA yet</td><td><b>${ns.servicesNoAgreement || 0}</b> services / ${ns.suppliersNoAgreement || 0} suppliers</td></tr>
          <tr><td>Existing on Prod (live Item query)</td><td><b>${es.services || 0}</b> unique services · ${es.uniqueSuppliers || 0} suppliers</td></tr>
          <tr><td>Existing, supplier has a Morocco SA</td><td><b>${es.servicesWithAgreement || 0}</b> services / ${es.suppliersWithAgreement || 0} suppliers</td></tr>
          <tr><td>Existing, commercial supplier, no SA</td><td><b>${es.servicesCommercialNoAgreement || 0}</b> services / ${es.suppliersCommercialNoAgreement || 0} suppliers</td></tr>
          <tr><td>Existing, DMC Morocco internal, no SA</td><td><b>${es.servicesInternalNoAgreement || 0}</b> services — Cash Paid / Crew / Placeholder, not a missing hotel agreement</td></tr>
        </tbody>
      </table>`;
    }
    drawSaNew();
    drawSaExisting();
    drawAcc();

    document.getElementById("saSummary").innerHTML = `<table>
      <tbody>
        <tr><td>Intrepid Morocco agreements on Prod today</td><td><b>${h.prodMoroccoAgreements}</b> on ${h.prodMoroccoAccounts} accounts</td></tr>
        <tr><td>How they are stored</td><td>${tag("yes", "Account-level is OK")} — service assignments are not required. ${h.prodMoroccoAssignments || 0} service-level rows (expected to be none).</td></tr>
        <tr><td>SA1 open in the tool</td><td><b>${h.sa1OpenInTool}</b></td></tr>
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
        <td>${esc(sheetName(s.id))}</td>
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
        { label: "Fully decided", value: s.servicesFinalised || 0, color: "#1f6b4a" },
        { label: "Ready (prices/agreements still open)", value: firstOnly, color: "#1F4E79" },
        { label: "Not ready", value: stillBlocking, color: "#9b1c1c" },
      ]);
    }
    const saNewEl = document.getElementById("chartSaNew");
    if (saNewEl) {
      saNewEl.innerHTML = doughnut([
        { label: "Supplier already has an SA", value: s.h.saNewWithAgreement || 0, color: "#1f6b4a" },
        { label: "No account SA yet", value: s.h.saNewNoAgreement || 0, color: "#9b1c1c" },
      ]);
      const cap = document.getElementById("saNewCaption");
      if (cap) cap.textContent = `${s.h.saNewWithAgreement || 0} of ${s.h.saNewServices || 0} new template services already sit on a supplier with a Prod SA. ${s.h.saNewNoAgreement || 0} still need one.`;
    }
    const saExEl = document.getElementById("chartSaExisting");
    if (saExEl) {
      saExEl.innerHTML = doughnut([
        { label: "Have an account agreement", value: s.h.saExistingWithAgreement || 0, color: "#1f6b4a" },
        { label: "Commercial, no SA", value: s.h.saExistingCommercialNoAgreement || 0, color: "#9b1c1c" },
        { label: "DMC internal, no SA", value: s.h.saExistingInternalNoAgreement || 0, color: "#8a8478" },
      ]);
      const cap = document.getElementById("saExistingCaption");
      if (cap) cap.textContent = `${s.h.saExistingWithAgreement || 0} of ${s.h.saExistingServices || 0} existing Prod services have a Morocco account SA. ${s.h.saExistingCommercialNoAgreement || 0} commercial still have none. ${s.h.saExistingInternalNoAgreement || 0} are DMC Morocco internal.`;
    }
    document.getElementById("chartSgaMix").innerHTML = doughnut([
      { label: "Group Tour only", value: mix["Group Tour only"] || 0, color: "#1F4E79" },
      { label: "TM (FIT) + Group Tour", value: mix["Both FIT + Group Tour"] || 0, color: "#1f6b4a" },
      { label: "TM (FIT) only", value: mix["FIT only"] || 0, color: "#7c3aed" },
      { label: "On Prod, no 2027", value: mix["On Prod, no 2027"] || 0, color: "#d97706" },
      { label: "Not on Prod", value: mix["Not on Prod"] || 0, color: "#9b1c1c" },
    ]);
    function fillReadyPie(elId, capId, ready, total, noun) {
      const el = document.getElementById(elId);
      if (!el) return;
      const n = Number(total) || 0;
      const ok = Number(ready) || 0;
      el.innerHTML = doughnut([
        { label: "Ready", value: ok, color: "#1f6b4a" },
        { label: "Not ready", value: Math.max(0, n - ok), color: "#9b1c1c" },
      ]);
      const cap = document.getElementById(capId);
      if (cap) cap.textContent = `${ok} of ${n} ${noun} ready.`;
    }
    fillReadyPie("chartFitPie", "fitPieCaption", (s.pkgRows || []).filter((p) => p.firstInsertReady).length, (s.pkgRows || []).length, "FIT packages");
    fillReadyPie("chartSgaPie", "sgaPieCaption", (s.sgaPkgRows || []).filter((p) => p.firstInsertReady).length, (s.sgaPkgRows || []).length, "SGA packages");
    fillReadyPie("chartSvcPie", "svcPieCaption", s.servicesFirstInsert || 0, s.uniqueSvc || 0, "unique services");
    const sheetRows = (s.sheets || []).slice().sort(cmpSheets);
    document.getElementById("chartSheets").innerHTML =
      `<div style="margin-bottom:6px;font-size:12px;color:#5c564c">Green = Decided · Amber = Not decided</div>` +
      stackedBars(sheetRows.map((x) => ({
        label: sheetName(x.id),
        yes: decidedOf(x),
        open: x.open || 0,
      })));
    const pkgs = (s.pkgRows || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    document.getElementById("chartPkgs").innerHTML =
      `<div style="margin-bottom:6px;font-size:12px;color:#5c564c">Green = ready · Red = not ready · Ready only when every pill is green</div>` +
      pkgListHtml(pkgs, "tm");
    const sgaPkgs = (s.sgaPkgRows || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    const sgaChart = document.getElementById("chartSgaPkgs");
    if (sgaChart) {
      sgaChart.innerHTML =
        `<div style="margin-bottom:6px;font-size:12px;color:#5c564c">Green = ready · Red = not ready · Ready only when every pill is green</div>` +
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
      <thead><tr><th>Service</th><th>Problems</th><th>Ready?</th></tr></thead>
      <tbody>${rows.slice(0, 200).map((r) => {
        const ready = svcInstallReady(r);
        return `<tr>
          <td>${esc(r.service)}</td>
          <td>${pillsHtml(INSTALL_SHEETS, (id) => svcOpenOn(r, id))}</td>
          <td>${ready ? tag("yes", "Ready") : tag("no", "Not ready")}</td>
        </tr>`;
      }).join("")}${rows.length > 200 ? `<tr><td colspan="3" class="muted">Showing 200 of ${rows.length}. Search to narrow.</td></tr>` : ""}</tbody>
    </table>`;
  }

  function matchKind(row, kind) {
    if (!kind || kind === "all") return true;
    if (kind === "existing") return (Number(row.existingCount) || 0) > 0 || row.kind === "existing";
    if (kind === "new") return (Number(row.newCount) || 0) > 0 || row.kind === "new";
    return true;
  }

  function kindBits(r) {
    const bits = [];
    if (r.existingCount) bits.push(tag("yes", "Exists " + r.existingCount));
    if (r.newCount) bits.push(tag("open", "New " + r.newCount));
    if (r.otherCount) bits.push(tag("open", "Other " + r.otherCount));
    if (r.kind === "existing") bits.push(tag("yes", "Exists"));
    if (r.kind === "new") bits.push(tag("open", "New"));
    if (r.kind === "other") bits.push(tag("open", "Other"));
    return bits.join(" ");
  }

  function drawAcc() {
    const saEl = document.getElementById("accSaFilter");
    const kindEl = document.getElementById("accKindFilter");
    const qEl = document.getElementById("accQ");
    const box = document.getElementById("accountTable");
    if (!box) return;
    const saMode = (saEl && saEl.value) || "all";
    const kind = (kindEl && kindEl.value) || "all";
    const q = ((qEl && qEl.value) || "").trim().toLowerCase();
    const filtered = (window._saAccounts || []).filter((r) => {
      if (saMode === "with" && !r.hasAgreement) return false;
      if (saMode === "none" && r.hasAgreement) return false;
      if (!matchKind(r, kind)) return false;
      const blob = ((r.supplier || "") + " " + (r.account || "") + " " + (r.agreement || "")).toLowerCase();
      return !q || blob.includes(q);
    });
    box.innerHTML = `<table>
      <thead><tr><th>Account / supplier</th><th>Agreement</th><th>Services</th><th>Kind</th></tr></thead>
      <tbody>${filtered.map((r) => {
        const names = kind === "new" ? (r.newServices || r.services) : kind === "existing" ? (r.existingServices || r.services) : r.services;
        return `<tr>
        <td>${esc(r.account || r.supplier)}${r.internal ? `<div class="detail">DMC internal</div>` : ""}</td>
        <td>${r.hasAgreement ? tag("yes", r.agreement || "Yes") : tag("no", "None")}</td>
        <td>${r.serviceCount || 0}${names && names.length ? `<div class="detail">${esc(names.join(", "))}</div>` : ""}</td>
        <td>${kindBits(r)}</td>
      </tr>`;
      }).join("") || `<tr><td colspan="4" class="muted">None.</td></tr>`}</tbody>
    </table>`;
  }

  function drawSup() {
    const modeEl = document.getElementById("supFilter");
    const kindEl = document.getElementById("supKind");
    const qEl = document.getElementById("supQ");
    const box = document.getElementById("supplierTable");
    if (!modeEl || !qEl || !box) return;
    const mode = modeEl.value;
    const kind = (kindEl && kindEl.value) || "all";
    const q = (qEl.value || "").trim().toLowerCase();
    const rows = (mode === "with" ? window._supWith : window._supNone) || [];
    const filtered = rows.filter((r) => {
      if (!matchKind(r, kind)) return false;
      const blob = ((r.supplier || "") + " " + (r.account || "") + " " + (r.agreement || "")).toLowerCase();
      return !q || blob.includes(q);
    });
    box.innerHTML = `<table>
      <thead><tr><th>Supplier</th><th>Prod account</th><th>Agreement</th><th>Services</th><th>Kind</th></tr></thead>
      <tbody>${filtered.map((r) => `<tr>
        <td>${esc(r.supplier)}</td>
        <td>${esc(r.account || "")}</td>
        <td>${esc(r.agreement || "None")}</td>
        <td>${r.serviceCount || 0}${r.services && r.services.length ? `<div class="detail">${esc(r.services.join(", "))}</div>` : ""}</td>
        <td>${kindBits(r)}</td>
      </tr>`).join("") || `<tr><td colspan="5" class="muted">None.</td></tr>`}</tbody>
    </table>`;
  }

  function drawSaList(qId, tableId, rows, emptyLabel) {
    const qEl = document.getElementById(qId);
    const box = document.getElementById(tableId);
    if (!box) return;
    const q = ((qEl && qEl.value) || "").trim().toLowerCase();
    const filtered = (rows || []).filter((r) => {
      const blob = ((r.service || "") + " " + (r.supplier || "") + " " + (r.account || "")).toLowerCase();
      return !q || blob.includes(q);
    });
    box.innerHTML = `<table>
      <thead><tr><th>Service</th><th>Supplier</th><th>Prod agreement</th></tr></thead>
      <tbody>${filtered.slice(0, 150).map((r) => `<tr>
        <td>${esc(r.service)}</td>
        <td>${esc(r.supplier || "—")}</td>
        <td>${esc(r.agreement || emptyLabel)}</td>
      </tr>`).join("") || `<tr><td colspan="3" class="muted">None.</td></tr>`}${filtered.length > 150 ? `<tr><td colspan="3" class="muted">Showing 150 of ${filtered.length}.</td></tr>` : ""}</tbody>
    </table>`;
  }

  function drawSaNew() {
    drawSaList("saNewQ", "saNewTable", window._saNewNone, "None yet");
  }

  function drawSaExisting() {
    drawSaList("saExQ", "saExistingTable", window._saExNone, "None");
  }

  function drawSa() {
    const mode = document.getElementById("saFilter").value;
    const kindEl = document.getElementById("saKind");
    const kind = (kindEl && kindEl.value) || "all";
    const q = (document.getElementById("saQ").value || "").trim().toLowerCase();
    const rows = (mode === "covered" ? window._saCovered : window._saStill) || [];
    const filtered = rows.filter((r) => {
      if (!matchKind(r, kind)) return false;
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
  const saKind = document.getElementById("saKind");
  if (saKind) saKind.addEventListener("change", drawSa);
  const saNewQ = document.getElementById("saNewQ");
  const saExQ = document.getElementById("saExQ");
  if (saNewQ) saNewQ.addEventListener("input", drawSaNew);
  if (saExQ) saExQ.addEventListener("input", drawSaExisting);
  const supFilter = document.getElementById("supFilter");
  const supKind = document.getElementById("supKind");
  const supQ = document.getElementById("supQ");
  if (supFilter) supFilter.addEventListener("change", drawSup);
  if (supKind) supKind.addEventListener("change", drawSup);
  if (supQ) supQ.addEventListener("input", drawSup);
  const accSaFilter = document.getElementById("accSaFilter");
  const accKindFilter = document.getElementById("accKindFilter");
  const accQ = document.getElementById("accQ");
  if (accSaFilter) accSaFilter.addEventListener("change", drawAcc);
  if (accKindFilter) accKindFilter.addEventListener("change", drawAcc);
  if (accQ) accQ.addEventListener("input", drawAcc);

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
