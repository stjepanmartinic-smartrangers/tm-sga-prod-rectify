(() => {
  const OWNER = "stjepanmartinic-smartrangers";
  const REPO = "tm-sga-prod-rectify";
  const PATH = "decisions.json";
  const LS_DECISIONS = "tm-sga-prod-rectify-decisions";
  const LS_PAT = "tm-sga-prod-rectify-pat";
  const RAW = `https://raw.githubusercontent.com/${OWNER}/${REPO}/main/${PATH}`;

  const data = window.ISSUE_DATA;
  if (!data) {
    document.getElementById("list").innerHTML =
      "<p class='empty'>data.js failed to load. Open this folder over http or GitHub Pages, not as a blocked local file.</p>";
    return;
  }

  let sheetId = data.sheets[0].id;
  let decisions = loadLocal();
  let saveTimer = null;

  const $ = (id) => document.getElementById(id);
  $("q").addEventListener("input", render);
  $("statusFilter").addEventListener("change", render);
  $("btnExport").addEventListener("click", exportJson);
  $("fileImport").addEventListener("change", importJson);
  $("btnSettings").addEventListener("click", () => $("settings").showModal());
  $("btnCloseSettings").addEventListener("click", () => $("settings").close());
  $("btnSavePat").addEventListener("click", () => {
    localStorage.setItem(LS_PAT, $("pat").value.trim());
    $("settings").close();
    setState("Token stored in this browser.");
  });
  $("btnSave").addEventListener("click", saveOnline);
  $("btnLoad").addEventListener("click", loadOnline);
  $("pat").value = localStorage.getItem(LS_PAT) || "";

  function loadLocal() {
    try {
      return JSON.parse(localStorage.getItem(LS_DECISIONS) || "{}");
    } catch {
      return {};
    }
  }
  function persistLocal() {
    decisions.updatedAt = new Date().toISOString();
    localStorage.setItem(LS_DECISIONS, JSON.stringify(decisions));
    setState("Saved in this browser · " + new Date().toLocaleTimeString());
  }
  function scheduleSave() {
    persistLocal();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (localStorage.getItem(LS_PAT)) saveOnline(true);
    }, 4000);
  }
  function setState(t) {
    $("saveState").textContent = t;
  }
  function dec(id) {
    if (!decisions.byId) decisions.byId = {};
    if (!decisions.byId[id]) decisions.byId[id] = { status: "open", choice: "", selected: "", notes: "" };
    return decisions.byId[id];
  }
  function isDecided(d) {
    return d && d.status && d.status !== "open";
  }

  function optionsFor(sheet, issue) {
    const kind = sheet.choice;
    if (kind === "fuzzy-service") {
      const opts = (issue.fuzzyService || []).map((f, i) => ({
        value: "match:" + i,
        label: "Yes — use Prod name: " + ((f.from ? f.from + " → " : "") + f.value),
        extra: f.score != null ? f.score + "%" : "",
      }));
      if (!opts.length) {
        opts.push({ value: "yes", label: "Yes — add to ST using this service name", extra: "" });
      }
      opts.push({ value: "no", label: "No — brand new / not a match", extra: "" });
      return opts;
    }
    if (kind === "pc-map") {
      return [
        { value: "yes", label: "Yes — accept the suggested PC map", extra: "" },
        { value: "no", label: "No — do not apply this map", extra: "" },
      ];
    }
    if (kind === "supplier") {
      const opts = [];
      if (issue.prodSupplier) opts.push({ value: "prod", label: "Use Prod supplier: " + issue.prodSupplier, extra: "" });
      if (issue.stSupplier) opts.push({ value: "st", label: "Keep ST supplier: " + issue.stSupplier, extra: "" });
      opts.push({ value: "no", label: "No — needs a different / new account", extra: "" });
      return opts;
    }
    if (kind === "location") {
      const opts = [];
      if (issue.prodLocation) opts.push({ value: "prod", label: "Use Prod location: " + issue.prodLocation, extra: "" });
      if (issue.stLocation) opts.push({ value: "st", label: "Keep ST location: " + issue.stLocation, extra: "" });
      opts.push({ value: "no", label: "No — neither is right", extra: "" });
      return opts;
    }
    if (kind === "type") {
      const opts = [];
      if (issue.prodType) opts.push({ value: "prod", label: "Use Prod type: " + issue.prodType, extra: "" });
      if (issue.stType) opts.push({ value: "st", label: "Keep ST type: " + issue.stType, extra: "" });
      opts.push({ value: "no", label: "No — neither is right (picklist noise)", extra: "" });
      return opts;
    }
    if (kind === "sa-name") {
      const opts = [];
      if (issue.prodAgreement) opts.push({ value: "prod", label: "Use Prod agreement: " + issue.prodAgreement, extra: "" });
      if (issue.saTemplateName) opts.push({ value: "st", label: "Use template name: " + issue.saTemplateName, extra: "" });
      opts.push({ value: "no", label: "No — needs a different agreement", extra: "" });
      return opts;
    }
    if (kind === "yesno") {
      return [
        { value: "yes", label: "Yes — FIT pricing is required", extra: "" },
        { value: "no", label: "No — Group Tour only is fine", extra: "" },
      ];
    }
    return [
      { value: "done", label: "Done — this is handled", extra: "" },
      { value: "skip", label: "Skip for now", extra: "" },
    ];
  }

  function reopen(id) {
    const d = dec(id);
    d.status = "open";
    d.choice = "";
    d.selected = "";
    d.updatedAt = new Date().toISOString();
    scheduleSave();
    render();
  }

  function applyChoice(id, value, issue, sheet) {
    const d = dec(id);
    d.choice = value;
    d.updatedAt = new Date().toISOString();
    if (value === "no" || value === "skip") d.status = "no";
    else if (value === "done") d.status = "done";
    else d.status = "yes";
    if (value.startsWith("match:")) {
      const i = Number(value.slice(6));
      const f = (issue.fuzzyService || [])[i];
      d.selected = f ? f.value : "";
      d.status = "yes";
    } else if (value === "prod") {
      d.selected =
        sheet.choice === "supplier"
          ? issue.prodSupplier
          : sheet.choice === "location"
            ? issue.prodLocation
            : sheet.choice === "type"
              ? issue.prodType
              : issue.prodAgreement;
    } else if (value === "st") {
      d.selected =
        sheet.choice === "supplier"
          ? issue.stSupplier
          : sheet.choice === "location"
            ? issue.stLocation
            : sheet.choice === "type"
              ? issue.stType
              : issue.saTemplateName;
    } else if (value === "yes" && sheet.choice === "pc-map") {
      d.selected = (issue.pcMap || []).map((x) => (x.from ? x.from + " → " : "") + x.value).join("; ");
    } else if (value === "no") {
      d.selected = "";
    }
    scheduleSave();
    render();
  }

  function counts() {
    let open = 0, decided = 0, total = 0;
    for (const s of data.sheets) {
      for (const issue of s.issues) {
        total++;
        if (isDecided(dec(issue.id))) decided++;
        else open++;
      }
    }
    return { open, decided, total };
  }

  function renderStats() {
    const c = counts();
    $("stats").innerHTML = `
      <div class="stat"><b>${c.total}</b><span>Unique issues</span></div>
      <div class="stat clickable ${sheetId !== "__decided__" && $("statusFilter").value === "open" ? "on" : ""}" id="statOpen"><b>${c.open}</b><span>Open — click to work these</span></div>
      <div class="stat clickable ${sheetId === "__decided__" ? "on" : ""}" id="statDecided"><b>${c.decided}</b><span>Decided — click to review / change</span></div>
      <div class="stat"><b>${data.generated}</b><span>Data extract</span></div>`;
    $("statOpen").onclick = () => {
      sheetId = data.sheets[0].id;
      $("statusFilter").value = "open";
      render();
    };
    $("statDecided").onclick = () => {
      sheetId = "__decided__";
      $("statusFilter").value = "decided";
      render();
    };
  }

  function renderTabs() {
    const decidedN = counts().decided;
    const decidedBtn = `<button type="button" data-id="__decided__" class="${sheetId === "__decided__" ? "on" : ""}">All decided <span class="n">${decidedN}</span></button>`;
    $("tabs").innerHTML =
      decidedBtn +
      data.sheets
        .map((s) => {
          const left = s.issues.filter((i) => !isDecided(dec(i.id))).length;
          return `<button type="button" data-id="${s.id}" class="${s.id === sheetId ? "on" : ""}">${s.id} ${s.title} <span class="n">${left}/${s.count}</span></button>`;
        })
        .join("");
    $("tabs").querySelectorAll("button").forEach((b) => {
      b.onclick = () => {
        const next = b.dataset.id;
        if (next === "__decided__") $("statusFilter").value = "decided";
        else if (sheetId === "__decided__") $("statusFilter").value = "open";
        sheetId = next;
        render();
      };
    });
  }

  function matchesQuery(issue, q) {
    if (!q) return true;
    const d = dec(issue.id);
    const blob = [
      issue.service,
      (issue.packages || []).join(" "),
      JSON.stringify(issue.fields),
      d.notes || "",
      d.selected || "",
      JSON.stringify(d.form || {}),
    ]
      .join(" ")
      .toLowerCase();
    return blob.includes(q);
  }

  function bindList(pairs) {
    $("list").querySelectorAll("[data-choice]").forEach((el) => {
      el.addEventListener("change", () => {
        const pair = pairs.find((p) => p.issue.id === el.dataset.id);
        applyChoice(el.dataset.id, el.value, pair.issue, pair.sheet);
      });
    });
    $("list").querySelectorAll("textarea[data-notes]").forEach((el) => {
      el.addEventListener("change", () => {
        dec(el.dataset.id).notes = el.value;
        scheduleSave();
      });
    });
    $("list").querySelectorAll("[data-form]").forEach((el) => {
      const saveForm = () => {
        const d = dec(el.dataset.id);
        if (!d.form) d.form = {};
        d.form[el.dataset.form] = el.value;
        scheduleSave();
      };
      el.addEventListener("input", saveForm);
      el.addEventListener("change", saveForm);
    });
    $("list").querySelectorAll("[data-reopen]").forEach((el) => {
      el.addEventListener("click", () => reopen(el.dataset.id));
    });
  }

  function render() {
    renderStats();
    renderTabs();
    const q = $("q").value.trim().toLowerCase();
    const sf = $("statusFilter").value;
    let pairs = [];
    if (sheetId === "__decided__") {
      $("help").textContent =
        "Every decision so far, across all problem types. Change Yes/No here, edit the create form, or Reopen to put it back in the open queue.";
      for (const s of data.sheets) {
        for (const issue of s.issues) {
          if (isDecided(dec(issue.id)) && matchesQuery(issue, q)) pairs.push({ sheet: s, issue });
        }
      }
    } else {
      const sheet = data.sheets.find((s) => s.id === sheetId);
      $("help").textContent = sheet.help;
      pairs = sheet.issues
        .filter((issue) => {
          const decided = isDecided(dec(issue.id));
          if (sf === "open" && decided) return false;
          if (sf === "decided" && !decided) return false;
          return matchesQuery(issue, q);
        })
        .map((issue) => ({ sheet, issue }));
    }
    if (!pairs.length) {
      $("list").innerHTML =
        sheetId === "__decided__"
          ? "<p class='empty'>No decisions yet. They will collect here as you work through the tabs.</p>"
          : "<p class='empty'>Nothing to show in this filter.</p>";
      return;
    }
    $("list").innerHTML = pairs.map((p) => cardHtml(p.sheet, p.issue)).join("");
    bindList(pairs);
  }

  function findIssue(id) {
    for (const s of data.sheets) {
      const hit = s.issues.find((i) => i.id === id);
      if (hit) return hit;
    }
    return {};
  }

  const ST_FORM = [
    { key: "name", label: "Name" },
    { key: "location", label: "Location" },
    { key: "businessUnit", label: "Business Unit" },
    { key: "serviceType", label: "Service Type (Record Type)" },
    { key: "allowDayUse", label: "Allow Day Use (true, false)" },
    { key: "costType", label: "Cost Type" },
    { key: "pricingType", label: "Pricing Type (Standard, Booking)" },
    { key: "taxGroup", label: "TaxGroup" },
    { key: "allocationType", label: "Allocation Type (day, night, booking)" },
    { key: "checkInTime", label: "CheckIn Time" },
    { key: "checkOutTime", label: "CheckOut Time" },
    { key: "timeSetup", label: "Time Setup" },
    { key: "preferredComm", label: "Preferred communication" },
    { key: "priceCategory", label: "Price Category" },
    { key: "maxAdults", label: "Price Category MaxAdults" },
    { key: "maxChildren", label: "Price Category MaxChildren" },
    { key: "priceSeason", label: "Price Season" },
    { key: "priceSeasonDates", label: "Price Season Dates" },
    { key: "priceSeasonDays", label: "Price Season Days" },
    { key: "pricelist", label: "Pricelist (FIT / Group Series / GIT)" },
    { key: "qtyMin", label: "Quantity Minimum" },
    { key: "priceType", label: "Price Type (Cost/Sell)" },
    { key: "priceGroup", label: "Price Group" },
    { key: "price", label: "Price" },
    { key: "priceCurrency", label: "Price Currency" },
    { key: "inventoryType", label: "Inventory Type" },
    { key: "supplierName", label: "Supplier Name" },
    { key: "supplierBu", label: "Supplier Business Unit" },
    { key: "supplierConfirm", label: "Supplier Confirmation Method" },
    { key: "comment", label: "Comment", wide: true, area: true },
  ];

  function showCreateForm(issue, d) {
    if (!issue.fullyMissing) return false;
    if (d.choice && String(d.choice).startsWith("match:")) return false;
    return true;
  }

  function formHtml(issue, d) {
    if (!showCreateForm(issue, d)) return "";
    const form = d.form || {};
    const defs = issue.formDefaults || {};
    const fields = ST_FORM.map((f) => {
      const val = form[f.key] != null && form[f.key] !== "" ? form[f.key] : defs[f.key] || "";
      const cls = f.wide ? "wide" : "";
      const control = f.area
        ? `<textarea data-form="${f.key}" data-id="${issue.id}">${esc(val)}</textarea>`
        : `<input type="text" data-form="${f.key}" data-id="${issue.id}" value="${esc(val)}" />`;
      return `<label class="${cls}">${esc(f.label)}${control}</label>`;
    }).join("");
    return `<div class="create-form">
      <h4>New service — Service Template fields</h4>
      <p class="meta">Not on ST and not on Prod. Update these so we can create it. Saved with your Yes/No.</p>
      <div class="form-grid">${fields}</div>
    </div>`;
  }

  function cardHtml(sheet, issue) {
    const d = dec(issue.id);
    const opts = optionsFor(sheet, issue);
    const cls = d.status || "open";
    const pkgs = (issue.packages || []).map((p) => `<span class="pkg">${esc(p)}</span>`).join("");
    const fieldRows = Object.entries(issue.fields || {})
      .filter(([k]) => !["TM package", "TM packages"].includes(k))
      .slice(0, 12)
      .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
      .join("");
    const choice = opts
      .map((o) => {
        const checked = d.choice === o.value ? "checked" : "";
        return `<label><input type="radio" name="${issue.id}" data-choice data-id="${issue.id}" value="${esc(o.value)}" ${checked} /><span>${esc(o.label)}${o.extra ? ` <span class="score">${esc(o.extra)}</span>` : ""}</span></label>`;
      })
      .join("");
    const tag = isDecided(d)
      ? `<span class="tag ${cls}">${d.status === "yes" ? "Yes" : d.status === "no" ? "No" : "Done"}</span>`
      : `<span class="tag open">Open</span>`;
    const reopenBtn = isDecided(d)
      ? `<div class="row-actions"><button type="button" class="reopen" data-reopen data-id="${issue.id}">Reopen — change this decision</button></div>`
      : "";
    const pc = (issue.pcMap || [])
      .map((x) => esc((x.from ? x.from + " → " : "") + x.value))
      .join("<br>");
    return `<article class="card ${cls}">
      <h3>${esc(issue.service)} ${tag}</h3>
      <div class="meta">${esc(sheet.id)} · ${esc(issue.action || "")}</div>
      <div class="pkgs">${pkgs}</div>
      ${pc && sheet.choice === "pc-map" ? `<p><b>Suggested PC map</b><br>${pc}</p>` : ""}
      <dl class="fields">${fieldRows}</dl>
      <div class="choices">${choice}</div>
      ${formHtml(issue, d)}
      <textarea data-notes data-id="${issue.id}" placeholder="Decision notes">${esc(d.notes || "")}</textarea>
      ${reopenBtn}
    </article>`;
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function exportJson() {
    persistLocal();
    const blob = new Blob([JSON.stringify(decisions, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "tm-sga-prod-rectify-decisions.json";
    a.click();
  }

  function importJson(ev) {
    const file = ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed.byId) throw new Error("Missing byId");
        decisions = parsed;
        persistLocal();
        render();
      } catch (e) {
        alert("Could not import: " + e.message);
      }
    };
    reader.readAsText(file);
    ev.target.value = "";
  }

  async function saveOnline(quiet) {
    const token = localStorage.getItem(LS_PAT);
    if (!token) {
      if (!quiet) $("settings").showModal();
      return;
    }
    persistLocal();
    try {
      const get = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`, {
        headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json" },
      });
      let sha;
      if (get.ok) {
        const body = await get.json();
        sha = body.sha;
      }
      const content = btoa(unescape(encodeURIComponent(JSON.stringify(decisions, null, 2))));
      const put = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`, {
        method: "PUT",
        headers: {
          Authorization: "Bearer " + token,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "chore: save rectify decisions",
          content,
          sha,
          branch: "main",
        }),
      });
      if (!put.ok) throw new Error(await put.text());
      setState("Saved online to GitHub · " + new Date().toLocaleTimeString());
    } catch (e) {
      setState("Online save failed: " + e.message);
      if (!quiet) alert("Online save failed. Token needs Contents write on " + REPO + ".\n" + e.message);
    }
  }

  async function loadOnline() {
    try {
      const res = await fetch(RAW + "?t=" + Date.now());
      if (!res.ok) throw new Error("HTTP " + res.status);
      const parsed = await res.json();
      if (!parsed.byId) throw new Error("Remote file has no decisions yet");
      decisions = parsed;
      persistLocal();
      render();
      setState("Loaded from GitHub · " + new Date().toLocaleTimeString());
    } catch (e) {
      alert("Could not load GitHub decisions yet: " + e.message);
    }
  }

  loadOnline().catch(() => {});
  render();
})();
