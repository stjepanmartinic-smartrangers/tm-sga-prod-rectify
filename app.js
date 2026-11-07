(() => {
  const OWNER = "stjepanmartinic-smartrangers";
  const REPO = "tm-sga-prod-rectify";
  const PATH = "decisions.json";
  const LS_DECISIONS = "tm-sga-prod-rectify-decisions";
  const LS_PAT = "tm-sga-prod-rectify-pat";
  const LS_WHO = "tm-sga-prod-rectify-who";
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
  let lastFocusId = null;
  let pendingAction = null;
  let askedWho = false;

  const $ = (id) => document.getElementById(id);
  $("q").addEventListener("input", render);
  $("statusFilter").addEventListener("change", render);
  $("decisionFilter").addEventListener("change", render);
  $("historyWho").addEventListener("change", render);
  $("btnExport").addEventListener("click", exportJson);
  $("fileImport").addEventListener("change", importJson);
  $("btnSettings").addEventListener("click", () => $("settings").showModal());
  $("btnCloseSettings").addEventListener("click", () => $("settings").close());
  $("btnSavePat").addEventListener("click", () => {
    localStorage.setItem(LS_PAT, $("pat").value.trim());
    $("settings").close();
    setState("Token stored in this browser.");
  });
  $("btnSave").addEventListener("click", () => saveOnline(false));
  $("btnLoad").addEventListener("click", () => loadOnline(false));
  $("pat").value = localStorage.getItem(LS_PAT) || "";
  $("who").addEventListener("change", () => {
    if ($("who").value === "__add__") {
      $("whoName").value = "";
      $("whoDialog").showModal();
      $("whoName").focus();
      fillWhoSelect();
      return;
    }
    if ($("who").value) setWho($("who").value);
  });
  $("btnWhoOk").addEventListener("click", confirmWho);
  $("btnWhoCancel").addEventListener("click", () => {
    pendingAction = null;
    $("whoDialog").close();
    render();
  });
  $("whoName").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") confirmWho();
  });

  function loadLocal() {
    try {
      return ensureShape(JSON.parse(localStorage.getItem(LS_DECISIONS) || "{}"));
    } catch {
      return ensureShape({});
    }
  }
  function persistLocal() {
    ensureShape();
    decisions.updatedAt = new Date().toISOString();
    localStorage.setItem(LS_DECISIONS, JSON.stringify(decisions));
    setState("Saved in this browser · " + new Date().toLocaleTimeString());
  }

  function ensureShape(obj) {
    const d = obj || decisions;
    if (!d.byId) d.byId = {};
    if (!Array.isArray(d.history)) d.history = [];
    if (!Array.isArray(d.people)) d.people = [];
    return d;
  }

  function currentWho() {
    return (localStorage.getItem(LS_WHO) || "").trim();
  }

  function peopleList() {
    ensureShape();
    const names = new Set(decisions.people || []);
    (decisions.history || []).forEach((h) => {
      if (h.by) names.add(h.by);
    });
    const me = currentWho();
    if (me) names.add(me);
    return [...names].sort((a, b) => a.localeCompare(b));
  }

  function setWho(name) {
    const who = String(name || "").trim();
    if (!who) return;
    localStorage.setItem(LS_WHO, who);
    ensureShape();
    if (!decisions.people.includes(who)) {
      decisions.people.push(who);
      decisions.people.sort((a, b) => a.localeCompare(b));
      persistLocal();
    }
    fillWhoSelect();
  }

  function fillWhoSelect() {
    const me = currentWho();
    const names = peopleList();
    $("who").innerHTML =
      `<option value="">Select…</option>` +
      names.map((n) => `<option value="${esc(n)}" ${n === me ? "selected" : ""}>${esc(n)}</option>`).join("") +
      `<option value="__add__">Add a name…</option>`;
    const hw = $("historyWho").value || "all";
    $("historyWho").innerHTML =
      `<option value="all">Everyone</option>` +
      names.map((n) => `<option value="${esc(n)}" ${n === hw ? "selected" : ""}>${esc(n)}</option>`).join("");
  }

  function confirmWho() {
    const name = $("whoName").value.trim();
    if (!name) {
      $("whoName").focus();
      return;
    }
    setWho(name);
    $("whoDialog").close();
    const fn = pendingAction;
    pendingAction = null;
    if (fn) fn();
    else render();
  }

  function requireWho(fn) {
    if (currentWho()) {
      fn();
      return;
    }
    pendingAction = fn;
    $("whoName").value = "";
    $("whoDialog").showModal();
    $("whoName").focus();
  }

  function maybeAskWho() {
    if (askedWho || currentWho()) return;
    askedWho = true;
    $("whoName").value = "";
    $("whoDialog").showModal();
    $("whoName").focus();
  }

  function logHistory(entry) {
    ensureShape();
    decisions.history.push({
      at: new Date().toISOString(),
      by: currentWho() || "Unknown",
      ...entry,
    });
    if (decisions.history.length > 3000) {
      decisions.history = decisions.history.slice(-3000);
    }
  }

  function mergeHist(a, b) {
    const seen = new Set();
    const out = [];
    for (const h of [...(a || []), ...(b || [])]) {
      const k = [h.at, h.by, h.issueId, h.kind, h.to, h.field].join("|");
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(h);
    }
    out.sort((x, y) => String(x.at).localeCompare(String(y.at)));
    return out.slice(-3000);
  }

  function newerDec(a, b) {
    if (!a) return b;
    if (!b) return a;
    const at = Date.parse(a.updatedAt || 0) || 0;
    const bt = Date.parse(b.updatedAt || 0) || 0;
    if (bt !== at) return bt > at ? b : a;
    if (isDecided(a) && !isDecided(b)) return a;
    if (isDecided(b) && !isDecided(a)) return b;
    return a;
  }

  function mergeById(local, remote) {
    const out = {};
    const ids = new Set([...Object.keys(local || {}), ...Object.keys(remote || {})]);
    ids.forEach((id) => {
      out[id] = newerDec((local || {})[id], (remote || {})[id]);
    });
    return out;
  }

  function statusFromChoice(value) {
    if (!value) return "open";
    if (value === "no" || value === "skip") return "no";
    if (value === "done") return "done";
    return "yes";
  }

  function choiceFromHistory(h, sheet, issue) {
    if (h.kind === "reopen") return "";
    if (h.choice) return h.choice;
    if (!sheet || !issue || !h.to) return "";
    const o = optionsFor(sheet, issue).find((x) => x.label === h.to);
    return o ? o.value : "";
  }

  function hydrateFromHistory() {
    ensureShape();
    const latest = {};
    for (const h of decisions.history || []) {
      if (!h.issueId) continue;
      if (h.kind === "choice" || h.kind === "reopen") latest[h.issueId] = h;
    }
    let changed = false;
    for (const [id, h] of Object.entries(latest)) {
      const d = dec(id);
      const histAt = Date.parse(h.at || 0) || 0;
      const decAt = Date.parse(d.updatedAt || 0) || 0;
      if (isDecided(d) && decAt >= histAt) continue;
      const sheet = findSheet(String(id).split("::")[0]);
      const issue = findIssue(id);
      if (h.kind === "reopen") {
        if (histAt >= decAt && d.status !== "open") {
          d.status = "open";
          d.choice = "";
          d.selected = "";
          d.updatedAt = h.at;
          changed = true;
        }
        continue;
      }
      const value = choiceFromHistory(h, sheet, issue);
      if (!value) continue;
      if (d.choice === value && isDecided(d) && decAt >= histAt) continue;
      d.choice = value;
      d.status = h.status || statusFromChoice(value);
      if (h.selected) d.selected = h.selected;
      d.updatedAt = h.at || d.updatedAt;
      changed = true;
    }
    return changed;
  }

  function adopt(parsed) {
    ensureShape();
    ensureShape(parsed);
    const local = decisions;
    decisions = {
      byId: mergeById(local.byId, parsed.byId),
      history: mergeHist(local.history, parsed.history),
      people: [...new Set([...(local.people || []), ...(parsed.people || [])])].sort((a, b) =>
        a.localeCompare(b)
      ),
      updatedAt: (parsed.updatedAt || "") > (local.updatedAt || "") ? parsed.updatedAt : local.updatedAt,
    };
    hydrateFromHistory();
  }

  function findSheet(id) {
    return data.sheets.find((s) => s.id === id);
  }

  function choiceLabel(sheet, issue, value) {
    if (!value) return "Open";
    if (!sheet || !issue) return value;
    const o = optionsFor(sheet, issue).find((x) => x.value === value);
    return o ? o.label : value;
  }

  function fmtWhen(iso) {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso || "";
    }
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
    const kind = sheet.id === "SA1" ? "sa-create" : sheet.choice;
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
    if (sheet.id === "SA1" || kind === "sa-create") {
      return [
        { value: "yes", label: "Yes — create a new supplier agreement", extra: "" },
        { value: "no", label: "No — not needed for this service", extra: "" },
      ];
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
    requireWho(() => {
      const issue = findIssue(id);
      const sheet = findSheet(String(id).split("::")[0]);
      const d = dec(id);
      logHistory({
        kind: "reopen",
        issueId: id,
        sheetId: sheet ? sheet.id : "",
        service: issue.service || "",
        from: choiceLabel(sheet, issue, d.choice),
        to: "Open",
        choice: "",
        status: "open",
      });
      d.status = "open";
      d.choice = "";
      d.selected = "";
      d.updatedAt = new Date().toISOString();
      scheduleSave();
      render();
    });
  }

  function applyChoice(id, value, issue, sheet) {
    requireWho(() => applyChoiceNow(id, value, issue, sheet));
  }

  function applyChoiceNow(id, value, issue, sheet) {
    const d = dec(id);
    const prevChoice = d.choice;
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
    logHistory({
      kind: "choice",
      issueId: id,
      sheetId: sheet.id,
      service: issue.service,
      from: choiceLabel(sheet, issue, prevChoice),
      to: choiceLabel(sheet, issue, value),
      selected: d.selected || "",
      choice: value,
      status: d.status,
    });
    lastFocusId = id;
    if ($("statusFilter").value === "open") $("statusFilter").value = "all";
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
      <div class="stat clickable ${sheetId === "__history__" ? "on" : ""}" id="statHistory"><b>${(decisions.history || []).length}</b><span>History — who changed what</span></div>
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
    $("statHistory").onclick = () => {
      sheetId = "__history__";
      render();
    };
  }

  function renderTabs() {
    const decidedN = counts().decided;
    const decidedBtn = `<button type="button" data-id="__decided__" class="${sheetId === "__decided__" ? "on" : ""}">All decided <span class="n">${decidedN}</span></button>`;
    const histN = (decisions.history || []).length;
    const histBtn = `<button type="button" data-id="__history__" class="${sheetId === "__history__" ? "on" : ""}">History <span class="n">${histN}</span></button>`;
    $("tabs").innerHTML =
      decidedBtn +
      histBtn +
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
        else if (next !== "__history__" && (sheetId === "__decided__" || sheetId === "__history__")) {
          $("statusFilter").value = "all";
        }
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
        const pair = pairs.find((p) => p.issue.id === el.dataset.id);
        requireWho(() => {
          const prev = dec(el.dataset.id).notes || "";
          dec(el.dataset.id).notes = el.value;
          logHistory({
            kind: "notes",
            issueId: el.dataset.id,
            sheetId: pair.sheet.id,
            service: pair.issue.service,
            from: prev,
            to: el.value,
          });
          scheduleSave();
        });
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
      el.addEventListener("change", () => {
        const pair = pairs.find((p) => p.issue.id === el.dataset.id);
        requireWho(() => {
          saveForm();
          const field = ALL_FORM_FIELDS.find((f) => f.key === el.dataset.form);
          logHistory({
            kind: "form",
            issueId: el.dataset.id,
            sheetId: pair.sheet.id,
            service: pair.issue.service,
            field: field ? field.label : el.dataset.form,
            to: el.value,
          });
          scheduleSave();
        });
      });
    });
    $("list").querySelectorAll("[data-reopen]").forEach((el) => {
      el.addEventListener("click", () => reopen(el.dataset.id));
    });
  }

  function historyHtml(h) {
    const title =
      h.kind === "form"
        ? `Updated ${h.field || "ST field"}`
        : h.kind === "notes"
          ? "Updated notes"
          : h.kind === "reopen"
            ? "Reopened"
            : h.to || "Changed";
    const detail =
      h.kind === "form"
        ? esc(h.to || "")
        : h.kind === "notes"
          ? esc(h.to || "")
          : h.from && h.from !== h.to
            ? `${esc(h.from)} → ${esc(h.to)}`
            : esc(h.to || "");
    const selected = h.selected ? `<div class="meta">${esc(h.selected)}</div>` : "";
    return `<article class="card history-row" data-goto="${esc(h.issueId || "")}">
      <div class="when">${esc(fmtWhen(h.at))} · ${esc(h.by || "Unknown")}</div>
      <h3>${esc(h.service || h.issueId || "")}</h3>
      <div class="meta">${esc(h.sheetId || "")} · ${esc(title)}</div>
      <p>${detail}</p>
      ${selected}
    </article>`;
  }

  function renderHistory() {
    $("help").textContent =
      "Newest first. Click a row to open that service. Filter by person, or search. Names come from Who are you — yours is remembered in this browser.";
    $("statusFilter").style.display = "none";
    $("decisionFilter").style.display = "none";
    $("historyWho").style.display = "";
    const q = $("q").value.trim().toLowerCase();
    const who = $("historyWho").value || "all";
    const rows = (decisions.history || [])
      .slice()
      .reverse()
      .filter((h) => {
        if (who !== "all" && h.by !== who) return false;
        if (!q) return true;
        return [h.service, h.by, h.sheetId, h.to, h.from, h.field, h.selected].join(" ").toLowerCase().includes(q);
      });
    if (!rows.length) {
      $("list").innerHTML = "<p class='empty'>No history yet. Decisions and form edits will appear here with the person’s name.</p>";
      return;
    }
    $("list").innerHTML = rows.map(historyHtml).join("");
    $("list").querySelectorAll("[data-goto]").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.dataset.goto;
        if (!id || !id.includes("::")) return;
        sheetId = id.split("::")[0];
        $("statusFilter").value = "all";
        lastFocusId = id;
        render();
      });
    });
  }

  function render() {
    ensureShape();
    fillWhoSelect();
    renderStats();
    renderTabs();
    const q = $("q").value.trim().toLowerCase();
    const sf = $("statusFilter").value;
    const df = $("decisionFilter").value;
    $("statusFilter").style.display = sheetId === "__history__" ? "none" : "";
    $("decisionFilter").style.display = sheetId === "__decided__" ? "" : "none";
    $("historyWho").style.display = sheetId === "__history__" ? "" : "none";
    if (sheetId === "__history__") {
      renderHistory();
      maybeAskWho();
      return;
    }
    let pairs = [];
    if (sheetId === "__decided__") {
      $("help").textContent =
        "Every decision so far, across all problem types. Filter by Yes / No, change a choice, or Reopen. The create form appears only on No for services that are not on ST or Prod.";
      for (const s of data.sheets) {
        for (const issue of s.issues) {
          const d = dec(issue.id);
          if (!isDecided(d) || !matchesQuery(issue, q)) continue;
          if (df !== "all" && d.status !== df) continue;
          pairs.push({ sheet: s, issue });
        }
      }
    } else {
      const sheet = data.sheets.find((s) => s.id === sheetId);
      $("help").textContent =
        sheet.id === "SA1"
          ? "No Prod agreement. Yes opens the Supplier Agreement Template fields to create one. No = not needed."
          : sheet.id === "SA3"
            ? "Template name does not match Prod. No opens the agreement fields for a different / new agreement."
            : sheet.id === "SA5"
              ? "ST supplier does not match Prod. No opens Supplier Name and the other supplier fields from the Service Template, plus the TM package."
              : sheet.help;
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
          ? "<p class='empty'>Nothing in this Yes/No filter yet. Decisions collect here as you work through the tabs.</p>"
          : "<p class='empty'>Nothing to show in this filter.</p>";
      maybeAskWho();
      return;
    }
    $("list").innerHTML = pairs.map((p) => cardHtml(p.sheet, p.issue)).join("");
    bindList(pairs);
    if (lastFocusId) {
      const form = $("list").querySelector(`.create-form textarea[data-id="${lastFocusId}"], .create-form input[data-id="${lastFocusId}"]`);
      const card = $("list").querySelector(`input[data-choice][data-id="${lastFocusId}"]`);
      const el = form ? form.closest(".create-form") : card ? card.closest(".card") : null;
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      lastFocusId = null;
    }
    maybeAskWho();
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

  const SA_FORM = [
    { key: "agreementName", label: "Agreement Name" },
    { key: "dateFrom", label: "Date from" },
    { key: "dateTo", label: "Date To" },
    { key: "businessUnit", label: "Business Unit" },
    { key: "channel", label: "Channel" },
    { key: "invoiceBasis", label: "Supplier Invoice Basis" },
    { key: "cancellationPolicy", label: "Cancellation Policy" },
    { key: "agreementType", label: "Agreement Type (Net Rate, Commission)" },
    { key: "paymentType", label: "Type (Billback, Deposit %, Balance, …)" },
    { key: "paymentMethod", label: "Payment Method (Credit Card, Cash, Bank Payment)" },
    { key: "costBearer", label: "Cost Bearer (Office, Tour Leader)" },
    { key: "days", label: "Days" },
    { key: "when", label: "When (After Booking Date, Before Travel Date, …)" },
    { key: "service", label: "Service" },
    { key: "priceCategory", label: "Price Category" },
    { key: "addOns", label: "Add ons" },
    { key: "fees", label: "Fees" },
    { key: "supplierName", label: "Supplier Name" },
    { key: "comment", label: "Comment", wide: true, area: true },
  ];

  const SUPPLIER_FORM = [
    { key: "supplierName", label: "Supplier Name" },
    { key: "supplierBu", label: "Supplier Business Unit" },
    { key: "supplierConfirm", label: "Supplier Confirmation Method (Manual, Confirmation Not Needed)" },
    { key: "preferredComm", label: "Preferred communication (Email, Phone, Fax, Print, SMS)" },
    { key: "packages", label: "TM package" },
    { key: "location", label: "Location" },
    { key: "comment", label: "Comment", wide: true, area: true },
  ];

  const ALL_FORM_FIELDS = ST_FORM.concat(SA_FORM, SUPPLIER_FORM);

  function saDefaults(issue) {
    const fields = issue.fields || {};
    return {
      agreementName: issue.saTemplateName || (issue.service ? issue.service + " 2026-2027" : ""),
      dateFrom: "2026-01-01",
      dateTo: "2027-12-31",
      businessUnit: "Intrepid Morocco",
      channel: "Tailor-made (Morocco)",
      invoiceBasis: "",
      cancellationPolicy: "",
      agreementType: "Net Rate",
      paymentType: "",
      paymentMethod: "Bank Payment",
      costBearer: "Office",
      days: "",
      when: "",
      service: issue.service || "",
      priceCategory: fields["Package PCs"] || fields["ST PCs"] || "",
      addOns: "",
      fees: "",
      supplierName: issue.stSupplier || issue.prodSupplier || "",
      comment: "",
    };
  }

  function supplierDefaults(issue) {
    const fields = issue.fields || {};
    return {
      supplierName: issue.stSupplier || issue.prodSupplier || "",
      supplierBu: "Intrepid Morocco",
      supplierConfirm: "",
      preferredComm: "",
      packages: (issue.packages || []).join("; "),
      location: issue.stLocation || fields["Template location"] || "",
      comment: "",
    };
  }

  function formKind(sheet, issue, d) {
    const c = d && d.choice;
    if (sheet.id === "SA1" && c === "yes") return "sa";
    if (sheet.id === "SA3" && c === "no") return "sa";
    if (sheet.id === "SA5" && c === "no") return "supplier";
    if (issue.fullyMissing && c === "no") return "st";
    return "";
  }

  function formHtml(sheet, issue, d) {
    const kind = formKind(sheet, issue, d);
    if (!kind) return "";
    const form = d.form || {};
    let spec;
    if (kind === "sa") {
      spec = {
        fields: SA_FORM,
        defs: saDefaults(issue),
        title: "New supplier agreement — template fields",
        hint: "Fill these so we can create the agreement.",
      };
    } else if (kind === "supplier") {
      spec = {
        fields: SUPPLIER_FORM,
        defs: supplierDefaults(issue),
        title: "New / different supplier — service fields",
        hint: "Supplier Name plus the supplier fields from the Service Template, and the TM package.",
      };
    } else {
      spec = {
        fields: ST_FORM,
        defs: issue.formDefaults || {},
        title: "New service — Service Template fields",
        hint: "No — brand new, and not on ST or Prod. Fill these so we can create it.",
      };
    }
    const fields = spec.fields
      .map((f) => {
        const val = form[f.key] != null && form[f.key] !== "" ? form[f.key] : spec.defs[f.key] || "";
        const cls = f.wide ? "wide" : "";
        const control = f.area
          ? `<textarea data-form="${f.key}" data-id="${issue.id}">${esc(val)}</textarea>`
          : `<input type="text" data-form="${f.key}" data-id="${issue.id}" value="${esc(val)}" />`;
        return `<label class="${cls}">${esc(f.label)}${control}</label>`;
      })
      .join("");
    return `<div class="create-form">
      <h4>${esc(spec.title)}</h4>
      <p class="meta">${esc(spec.hint)}</p>
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
      ${formHtml(sheet, issue, d)}
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
        adopt(parsed);
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

  async function loadOnline(quiet) {
    try {
      const res = await fetch(RAW + "?t=" + Date.now());
      if (!res.ok) throw new Error("HTTP " + res.status);
      const parsed = await res.json();
      if (!parsed.byId) throw new Error("Remote file has no decisions yet");
      adopt(parsed);
      persistLocal();
      render();
      setState("Loaded from GitHub · " + new Date().toLocaleTimeString());
    } catch (e) {
      if (!quiet) alert("Could not load GitHub decisions yet: " + e.message);
    }
  }

  if (hydrateFromHistory()) persistLocal();
  loadOnline(true).catch(() => {});
  render();
})();
