(() => {
  const STORE = "https://tm-sga-prod-rectify-store.graceful-kryptops.workers.dev";
  const BLOCKING = new Set(["P1", "P2", "P5", "P9", "P10", "P11", "SA5"]);
  const TM = new Set((window.DASHBOARD_DATA.tmPackages || []).map((p) => p.name));
  const data = window.DASHBOARD_DATA;
  if (!data) {
    document.body.innerHTML = "<p style='padding:24px'>dashboard-data.js failed to load.</p>";
    return;
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
      sheetStats[s.id] = { ...s, yes: 0, no: 0, open: 0 };
    });
    const svcOpen = {};
    const pkg = {};
    TM.forEach((n) => {
      pkg[n] = { name: n, yes: 0, open: 0, cards: 0, blocking: {}, firstInsertReady: true, fullyReady: true };
    });

    function addPkg(name, card, ch) {
      if (!pkg[name]) return;
      const p = pkg[name];
      p.cards += 1;
      if (ch === "yes") p.yes += 1;
      else if (ch === "open") {
        p.open += 1;
        p.fullyReady = false;
        if (BLOCKING.has(card.sheet)) {
          p.firstInsertReady = false;
          p.blocking[card.sheet] = (p.blocking[card.sheet] || 0) + 1;
        }
      } else if (ch !== "no" && ch !== "done") {
        p.fullyReady = false;
      }
      if (card.sheet === "P6" && ch === "yes") p.fullyReady = false;
    }

    const srcCards = useLive ? cards : null;
    if (srcCards) {
      srcCards.forEach((c) => {
        const ch = c.choice;
        if (ch === "yes") yes += 1;
        else if (ch === "no") no += 1;
        else open += 1;
        if (sheetStats[c.sheet]) sheetStats[c.sheet][ch === "yes" || ch === "no" ? ch : "open"] += 1;
        if (ch === "open") {
          const k = c.service;
          if (!svcOpen[k]) svcOpen[k] = new Set();
          svcOpen[k].add(c.sheet);
        }
        const on = (c.tmOn && c.tmOn.length ? c.tmOn : c.packages) || [];
        on.forEach((p) => {
          if (TM.has(p)) addPkg(p, c, ch);
        });
      });
    }

    const h = data.headline;
    const firstReady = useLive
      ? Object.values(pkg).filter((p) => p.firstInsertReady).length
      : h.firstInsertReady;
    const fully = useLive ? Object.values(pkg).filter((p) => p.fullyReady).length : h.fullyReady;
    const prob = useLive ? Object.keys(svcOpen).length : h.problematicServices;
    const toolYes = useLive ? yes : h.toolYes;
    const toolOpen = useLive ? open : h.toolOpen;

    document.getElementById("meta").textContent =
      `Tool extract ${data.extract}. Saved answers ${live && live.updatedAt ? live.updatedAt.replace("T", " ").replace("Z", " UTC") : h.storeUpdatedAt}. Prod agreements ${h.prodSaQueriedAt.replace("T", " ").replace("Z", " UTC")}.`;

    document.getElementById("answers").innerHTML = `
      <div class="answer wait"><b>${fully}</b><span>TM packages fully ready to import (of ${h.tmPackages})</span></div>
      <div class="answer wait"><b>${firstReady}</b><span>Ready for first insert (names / supplier / location / type decided)</span></div>
      <div class="answer wait"><b>${prob}</b><span>Unique services still with an open problem card</span></div>
      <div class="answer"><b>${h.sa1StillNoAgreement}</b><span>SA1 services still with no live Prod agreement (${h.sa1CoveredByLiveProd} now have an account SA in Prod)</span></div>
      <div class="answer"><b>${h.sgaTrips}</b><span>SGA trips · ${h.sgaUniqueServices} unique services · Group Tour 2027 on most; TM/FIT is rare</span></div>
    `;

    document.getElementById("defs").innerHTML =
      `<b>How to read this.</b> ${esc(data.definitions.firstInsertReady)} ${esc(data.definitions.fullyReady)}
      ${esc(data.definitions.tmPricing)} ${esc(data.definitions.groupTourPricing)} ${esc(data.definitions.saLive)}
      Decision tool: <a href="${esc(data.rectifyUrl)}">${esc(data.rectifyUrl)}</a>. Yes in the tool: ${toolYes}. Still open: ${toolOpen}.`;

    const pkgRows = (useLive ? Object.values(pkg) : data.tmPackages).sort((a, b) => a.name.localeCompare(b.name));
    document.getElementById("pkgTable").innerHTML = `<table>
      <thead><tr><th>Package</th><th>Ready?</th><th>Yes</th><th>Open</th><th>Still blocking first insert</th></tr></thead>
      <tbody>${pkgRows.map((p) => {
        const ready = p.firstInsertReady;
        const block = p.blocking
          ? Object.entries(p.blocking).map(([k, v]) => `${k} ${v}`).join(", ")
          : (p.openBlocking || []).reduce((acc, x) => {
              acc[x.sheet] = (acc[x.sheet] || 0) + 1;
              return acc;
            }, {});
        const blockTxt = typeof block === "string" ? block : Object.entries(block).map(([k, v]) => `${k} ${v}`).join(", ");
        return `<tr>
          <td>${esc(p.name)}</td>
          <td>${ready ? tag("yes", "First-insert ready") : tag("open", "Not yet")}</td>
          <td>${p.yes}</td>
          <td>${p.open}</td>
          <td class="detail">${esc(blockTxt || "—")}</td>
        </tr>`;
      }).join("")}</tbody></table>`;

    const svcList = useLive
      ? Object.entries(svcOpen).map(([service, sheets]) => ({ service, openSheets: [...sheets].sort(), openCount: sheets.size }))
      : data.problematicServices;
    svcList.sort((a, b) => b.openCount - a.openCount || a.service.localeCompare(b.service));
    window._svcList = svcList;
    drawSvc();

    document.getElementById("saSummary").innerHTML = `<table>
      <tbody>
        <tr><td>Intrepid Morocco agreements on Prod today</td><td><b>${h.prodMoroccoAgreements}</b> on ${h.prodMoroccoAccounts} accounts</td></tr>
        <tr><td>Service-level assignments (Morocco)</td><td><b>${h.prodMoroccoAssignments}</b> — still none; these are account-level</td></tr>
        <tr><td>SA1 open in the tool</td><td><b>${h.sa1OpenInTool}</b></td></tr>
        <tr><td>Of those, now have a matching Prod account agreement</td><td><b>${h.sa1CoveredByLiveProd}</b> — do not create another</td></tr>
        <tr><td>Still no usable Prod agreement</td><td><b>${h.sa1StillNoAgreement}</b></td></tr>
        <tr><td>SA3 template name still does not match Prod</td><td><b>${h.sa3Open}</b> (names are still like Jan 2026 - Dec 2027)</td></tr>
        <tr><td>SA5 which supplier account still open</td><td><b>${h.sa5Open}</b></td></tr>
      </tbody>
    </table>`;
    window._saStill = data.sa1StillNoAgreement;
    window._saCovered = data.sa1CoveredByLiveProd;
    drawSa();

    const sheets = useLive ? Object.values(sheetStats) : data.sheets;
    document.getElementById("sheetTable").innerHTML = `<table>
      <thead><tr><th>Tab</th><th>Yes</th><th>No</th><th>Open</th><th>Total</th></tr></thead>
      <tbody>${sheets.map((s) => `<tr>
        <td>${esc(s.id)} ${esc(s.title || "")}</td>
        <td>${s.yes}</td><td>${s.no}</td><td>${s.open}</td><td>${s.total}</td>
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
      h,
    });
  }

  const charts = {};
  function upsertChart(id, config) {
    if (charts[id]) charts[id].destroy();
    const el = document.getElementById(id);
    if (!el || typeof Chart === "undefined") return;
    charts[id] = new Chart(el, config);
  }

  function drawCharts(s) {
    const legend = { labels: { boxWidth: 12, color: "#1c1915" } };
    const ticks = { color: "#5c564c", font: { size: 11 } };
    const grid = { color: "#e4ddd0" };

    upsertChart("chartTool", {
      type: "doughnut",
      data: {
        labels: ["Yes", "No", "Open"],
        datasets: [{
          data: [s.toolYes, s.toolNo, s.toolOpen],
          backgroundColor: ["#1f6b4a", "#9b1c1c", "#d97706"],
          borderWidth: 0,
        }],
      },
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend,
          title: { display: false },
        },
      },
    });

    upsertChart("chartSa", {
      type: "doughnut",
      data: {
        labels: [
          "Live Prod account SA — do not recreate",
          "Still no usable Prod agreement",
        ],
        datasets: [{
          data: [s.h.sa1CoveredByLiveProd, s.h.sa1StillNoAgreement],
          backgroundColor: ["#1f6b4a", "#d97706"],
          borderWidth: 0,
        }],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend },
      },
    });

    const mix = s.h.sgaPriceSummary || {};
    upsertChart("chartSgaMix", {
      type: "doughnut",
      data: {
        labels: [
          "Group Tour only",
          "TM (FIT) + Group Tour",
          "TM (FIT) only",
          "On Prod, no 2027",
          "Not on Prod",
        ],
        datasets: [{
          data: [
            mix["Group Tour only"] || 0,
            mix["Both FIT + Group Tour"] || 0,
            mix["FIT only"] || 0,
            mix["On Prod, no 2027"] || 0,
            mix["Not on Prod"] || 0,
          ],
          backgroundColor: ["#1F4E79", "#1f6b4a", "#7c3aed", "#d97706", "#9b1c1c"],
          borderWidth: 0,
        }],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend },
      },
    });

    const sheetRows = (s.sheets || []).slice().sort((a, b) => b.open - a.open);
    upsertChart("chartSheets", {
      type: "bar",
      data: {
        labels: sheetRows.map((x) => x.id),
        datasets: [
          { label: "Yes", data: sheetRows.map((x) => x.yes), backgroundColor: "#1f6b4a" },
          { label: "Open", data: sheetRows.map((x) => x.open), backgroundColor: "#d97706" },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend },
        scales: {
          x: { stacked: true, ticks, grid: { display: false } },
          y: { stacked: true, ticks, grid, title: { display: true, text: "Cards", color: "#5c564c" } },
        },
      },
    });

    const pkgs = (s.pkgRows || []).slice().sort((a, b) => b.open - a.open);
    upsertChart("chartPkgs", {
      type: "bar",
      data: {
        labels: pkgs.map((p) => p.name),
        datasets: [
          { label: "Yes", data: pkgs.map((p) => p.yes), backgroundColor: "#1f6b4a" },
          { label: "Open", data: pkgs.map((p) => p.open), backgroundColor: "#d97706" },
        ],
      },
      options: {
        indexAxis: "y",
        maintainAspectRatio: false,
        plugins: { legend },
        scales: {
          x: { stacked: true, ticks, grid, title: { display: true, text: "Problem-sheet cards", color: "#5c564c" } },
          y: { stacked: true, ticks: { ...ticks, font: { size: 10 } }, grid: { display: false } },
        },
      },
    });

    const trips = data.sgaPricing || [];
    upsertChart("chartSgaTrips", {
      type: "bar",
      data: {
        labels: trips.map((t) => t.code),
        datasets: [
          {
            label: "Group Tour 2027 %",
            data: trips.map((t) => {
              const gt = (t.counts["Group Tour only"] || 0) + (t.counts["TM + Group Tour"] || 0);
              return t.unique ? Math.round((100 * gt) / t.unique) : 0;
            }),
            backgroundColor: "#1F4E79",
          },
          {
            label: "TM (FIT) 2027 %",
            data: trips.map((t) => {
              const tm = (t.counts["TM (FIT) only"] || 0) + (t.counts["TM + Group Tour"] || 0);
              return t.unique ? Math.round((100 * tm) / t.unique) : 0;
            }),
            backgroundColor: "#7c3aed",
          },
        ],
      },
      options: {
        indexAxis: "y",
        maintainAspectRatio: false,
        plugins: { legend },
        scales: {
          x: {
            min: 0,
            max: 100,
            ticks,
            grid,
            title: { display: true, text: "% of unique services on the trip", color: "#5c564c" },
          },
          y: { ticks: { ...ticks, font: { size: 11 } }, grid: { display: false } },
        },
      },
    });
  }

  function drawSvc() {
    const q = (document.getElementById("svcQ").value || "").trim().toLowerCase();
    const rows = (window._svcList || []).filter((r) => !q || r.service.toLowerCase().includes(q));
    document.getElementById("svcTable").innerHTML = `<table>
      <thead><tr><th>Service</th><th>Open tabs</th></tr></thead>
      <tbody>${rows.slice(0, 200).map((r) => `<tr>
        <td>${esc(r.service)}</td>
        <td>${esc((r.openSheets || []).join(", "))}</td>
      </tr>`).join("")}${rows.length > 200 ? `<tr><td colspan="2" class="muted">Showing 200 of ${rows.length}. Search to narrow.</td></tr>` : ""}</tbody>
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

  render(null);
  fetch(STORE + "?t=" + Date.now(), { cache: "no-store" })
    .then((r) => r.json())
    .then((raw) => render(fromRemote(raw)))
    .catch(() => {});
})();
