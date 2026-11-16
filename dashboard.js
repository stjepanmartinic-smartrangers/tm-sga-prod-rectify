(() => {
  const STORE = "https://tm-sga-prod-rectify-store.graceful-kryptops.workers.dev";
  const BLOCKING = new Set(["P1", "P2", "P5", "P9", "P10", "P11", "SA5"]);
  const data = window.DASHBOARD_DATA;
  if (!data) {
    const err = document.getElementById("err") || document.body;
    err.innerHTML = "<div class='err'>dashboard-data.js failed to load. Hard-refresh this page.</div>";
    return;
  }
  const TM = new Set((data.tmPackages || []).map((p) => p.name));

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
    document.getElementById("chartSa").innerHTML = doughnut([
      { label: "Live Prod account SA — do not recreate", value: s.h.sa1CoveredByLiveProd, color: "#1f6b4a" },
      { label: "Still no usable Prod agreement", value: s.h.sa1StillNoAgreement, color: "#d97706" },
    ]);
    document.getElementById("chartSgaMix").innerHTML = doughnut([
      { label: "Group Tour only", value: mix["Group Tour only"] || 0, color: "#1F4E79" },
      { label: "TM (FIT) + Group Tour", value: mix["Both FIT + Group Tour"] || 0, color: "#1f6b4a" },
      { label: "TM (FIT) only", value: mix["FIT only"] || 0, color: "#7c3aed" },
      { label: "On Prod, no 2027", value: mix["On Prod, no 2027"] || 0, color: "#d97706" },
      { label: "Not on Prod", value: mix["Not on Prod"] || 0, color: "#9b1c1c" },
    ]);
    const sheetRows = (s.sheets || []).slice().sort((a, b) => b.open - a.open);
    document.getElementById("chartSheets").innerHTML =
      `<div style="margin-bottom:6px;font-size:12px;color:#5c564c">Green = Yes · Amber = Open</div>` +
      stackedBars(sheetRows.map((x) => ({ label: x.id + " " + (x.title || ""), yes: x.yes, open: x.open })));
    const pkgs = (s.pkgRows || []).slice().sort((a, b) => b.open - a.open);
    document.getElementById("chartPkgs").innerHTML =
      `<div style="margin-bottom:6px;font-size:12px;color:#5c564c">Green = Yes · Amber = Open</div>` +
      stackedBars(pkgs.map((p) => ({ label: p.name, yes: p.yes, open: p.open })), "pkg");
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
