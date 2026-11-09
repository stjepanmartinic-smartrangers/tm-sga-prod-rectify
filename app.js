(() => {
  const LS_DECISIONS = "tm-sga-prod-rectify-decisions";
  const LS_WHO = "tm-sga-prod-rectify-who";
  const STORE = "https://tm-sga-prod-rectify-store.graceful-kryptops.workers.dev";
  const SNAPSHOT = "decisions.json";

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
  $("sourceFilter").addEventListener("change", () => {
    $("pkgFilter").value = "all";
    render();
  });
  $("pkgFilter").addEventListener("change", render);
  $("decisionFilter").addEventListener("change", render);
  $("historyWho").addEventListener("change", render);
  $("btnSave").addEventListener("click", () => saveOnline(false));
  $("btnLoad").addEventListener("click", () => {
    const ok = window.confirm(
      "Reload saved work will overwrite everything in this browser.\n\nAny decisions that were not Saved online will be lost. Continue?"
    );
    if (!ok) return;
    loadOnline(false, true);
  });
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

  function maybeAskWho() {
    if (askedWho || currentWho()) return;
    askedWho = true;
    $("whoName").value = "";
    $("whoDialog").showModal();
    $("whoName").focus();
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
  }

  function findSheet(id) {
    return data.sheets.find((s) => s.id === id);
  }

  function scheduleSave() {
    persistLocal();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveOnline(true), 4000);
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
        { value: "no", label: "No — do not apply this map (new price categories will be created)", extra: "" },
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
    if (kind === "price-st") {
      const hasSt = (issue.priceCompare || []).some((r) => r.st && r.st !== "—");
      return [
        {
          value: "yes",
          label: hasSt ? "Yes — insert the ST price" : "Yes — add ST prices (none on ST yet)",
          extra: "",
        },
        { value: "no", label: "No — keep the Prod price", extra: "" },
      ];
    }
    if (kind === "st-create") {
      return [
        { value: "yes", label: "Yes — create this service", extra: "" },
        { value: "no", label: "No — do not create", extra: "" },
      ];
    }
    if (sheet.id === "P11") {
      return [
        { value: "yes", label: "Yes — replace N/A with a real PC", extra: "" },
        { value: "no", label: "No — not this service", extra: "" },
      ];
    }
    return [
      { value: "yes", label: "Yes — this is handled", extra: "" },
      { value: "no", label: "No — not needed", extra: "" },
    ];
  }

  function tabHelp(sheet) {
    const texts = {
      P1: "On a TM package, not on the Service Template. SGA itinerary services are not listed here — they already exist on Prod and will be carried onto a package. Yes = add it using the selected Prod name. No = brand new — fill the Service Template fields.",
      P2: "On package and ST, no exact Prod Item, but a close name exists. Yes = rename ST to the selected Prod name. No = treat as brand new; create from ST.",
      P4: "On a package and on Prod, but pricing is missing, inactive, or missing 2027. Yes = insert the ST price (or fill prices if ST has none). No = keep the Prod price.",
      P5: "ST supplier does not match Prod. Pick the Prod account, keep ST, or No if a different / new account is needed.",
      P6: "Package PC names do not match ST/Prod. Yes = map to the existing ST/Prod names. No = do not apply the map; new price categories will be created from the package names.",
      P8: "Prod has Group Tour pricing only. Yes = FIT is required (FIT prices will be added). No = Group Tour only is fine; no FIT will be added.",
      P9: "ST/template location does not overlap Prod. Pick Prod, keep ST, or No if neither is right.",
      P10: "Package/ST type has no overlap with the Prod record type. Pick Prod, keep ST, or No if both are wrong.",
      P11: "Package price category is the N/A placeholder. Yes = replace N/A with a real PC. No = not this service.",
      SA1: "No Prod agreement. Yes = create a new supplier agreement (fill the fields). No = not needed for this service.",
      SA3: "SA template name does not match Prod. Use the Prod agreement, use the template name, or No to create a different / new agreement.",
      SA5: "ST supplier does not match Prod. Pick the Prod account, keep ST, or No if a different / new supplier is needed.",
    };
    return texts[sheet.id] || sheet.help;
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
    } else if (value === "no" && sheet.choice === "pc-map") {
      d.selected = "New price categories will be created";
    } else if (sheet.choice === "price-st") {
      d.selected = value === "yes" ? "Insert ST price" : "Keep Prod price";
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
    const pct = c.total ? Math.round((100 * c.decided) / c.total) : 0;
    $("progress").innerHTML = `
      <div class="progress-label"><b>${pct}%</b> decided in total <span>(${c.decided} of ${c.total})</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>`;
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

  function isSgaPkg(p) {
    return /^SGA\s/i.test(p || "");
  }

  function tabIssues() {
    if (sheetId === "__decided__") {
      const out = [];
      for (const s of data.sheets) {
        for (const issue of s.issues) {
          if (isDecided(dec(issue.id))) out.push(issue);
        }
      }
      return out;
    }
    const sheet = data.sheets.find((s) => s.id === sheetId);
    return sheet ? sheet.issues : [];
  }

  function fillPkgFilter() {
    const src = $("sourceFilter").value;
    const sel = $("pkgFilter");
    const hist = sheetId === "__history__";
    $("sourceFilter").style.display = hist ? "none" : "";
    if (hist || src === "all") {
      sel.style.display = "none";
      return;
    }
    sel.style.display = "";
    const prev = sel.value;
    const names = new Set();
    tabIssues().forEach((issue) => {
      (issue.packages || []).forEach((p) => {
        if (src === "sga" && isSgaPkg(p)) names.add(p);
        if (src === "tm" && !isSgaPkg(p)) names.add(p);
      });
    });
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    const allLabel = src === "sga" ? "All SGA itineraries" : "All TM packages";
    sel.innerHTML =
      `<option value="all">${allLabel}</option>` +
      sorted.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
    sel.value = sorted.includes(prev) ? prev : "all";
  }

  function matchesSource(issue) {
    const src = $("sourceFilter").value;
    const pkg = $("pkgFilter").value;
    const pkgs = issue.packages || [];
    if (src === "tm") {
      if (!pkgs.some((p) => !isSgaPkg(p))) return false;
      if (pkg !== "all" && !pkgs.includes(pkg)) return false;
    }
    if (src === "sga") {
      if (!pkgs.some(isSgaPkg)) return false;
      if (pkg !== "all" && !pkgs.includes(pkg)) return false;
    }
    return true;
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
        if (el.dataset.pcline != null && el.dataset.pcline !== "") {
          const i = Number(el.dataset.pcline);
          if (!Array.isArray(d.form.priceLines)) d.form.priceLines = [];
          if (!d.form.priceLines[i]) d.form.priceLines[i] = {};
          d.form.priceLines[i][el.dataset.form] = el.value;
        } else {
          d.form[el.dataset.form] = el.value;
        }
        scheduleSave();
      };
      el.addEventListener("input", saveForm);
      el.addEventListener("change", () => {
        const pair = pairs.find((p) => p.issue.id === el.dataset.id);
        requireWho(() => {
          saveForm();
          const field = ALL_FORM_FIELDS.find((f) => f.key === el.dataset.form);
          const line = el.dataset.pcline != null && el.dataset.pcline !== "" ? Number(el.dataset.pcline) + 1 : 0;
          logHistory({
            kind: "form",
            issueId: el.dataset.id,
            sheetId: pair.sheet.id,
            service: pair.issue.service,
            field: line ? "Price category " + line + " · " + (field ? field.label : el.dataset.form) : field ? field.label : el.dataset.form,
            to: el.value,
          });
          scheduleSave();
        });
      });
    });
    $("list").querySelectorAll("[data-add-pc]").forEach((el) => {
      el.addEventListener("click", () => {
        const pair = pairs.find((p) => p.issue.id === el.dataset.id);
        requireWho(() => {
          const d = dec(el.dataset.id);
          const lines = ensurePriceLines(d, pair.issue);
          lines.push(emptyPcLine(pair.issue));
          lastFocusId = el.dataset.id;
          logHistory({
            kind: "form",
            issueId: el.dataset.id,
            sheetId: pair.sheet.id,
            service: pair.issue.service,
            field: "Price categories",
            to: "Added price category " + lines.length,
          });
          scheduleSave();
          render();
        });
      });
    });
    $("list").querySelectorAll("[data-remove-pc]").forEach((el) => {
      el.addEventListener("click", () => {
        const pair = pairs.find((p) => p.issue.id === el.dataset.id);
        requireWho(() => {
          const d = dec(el.dataset.id);
          const lines = ensurePriceLines(d, pair.issue);
          const i = Number(el.dataset.pcline);
          if (lines.length < 2) return;
          const name = (lines[i] && lines[i].priceCategory) || "Price category " + (i + 1);
          lines.splice(i, 1);
          lastFocusId = el.dataset.id;
          logHistory({
            kind: "form",
            issueId: el.dataset.id,
            sheetId: pair.sheet.id,
            service: pair.issue.service,
            field: "Price categories",
            to: "Removed " + name,
          });
          scheduleSave();
          render();
        });
      });
    });
    $("list").querySelectorAll("[data-reopen]").forEach((el) => {
      el.addEventListener("click", () => reopen(el.dataset.id));
    });
  }

  function histKind(text, status) {
    const t = String(text || "").toLowerCase();
    if (status === "yes" || t.startsWith("yes")) return "yes";
    if (status === "no" || status === "skip" || t.startsWith("no") || t.startsWith("skip")) return "no";
    if (status === "done" || t.startsWith("done")) return "done";
    return "open";
  }

  function histTag(text, status) {
    if (!text) return "";
    return `<span class="tag ${histKind(text, status)}">${esc(text)}</span>`;
  }

  function historyHtml(h) {
    const title =
      h.kind === "form"
        ? `Updated ${h.field || "field"}`
        : h.kind === "notes"
          ? "Updated notes"
          : h.kind === "reopen"
            ? "Reopened"
            : h.to || "Changed";
    let detail;
    if (h.kind === "form" || h.kind === "notes") {
      detail = `<p>${esc(h.to || "")}</p>`;
    } else {
      const fromTag = histTag(h.from);
      const toTag = histTag(h.to, h.kind === "reopen" ? "open" : h.status);
      detail =
        h.from && h.from !== h.to
          ? `<p class="hist-change">${fromTag}<span class="hist-arrow">→</span>${toTag}</p>`
          : `<p class="hist-change">${toTag}</p>`;
    }
    const selected = h.selected ? `<div class="meta">${esc(h.selected)}</div>` : "";
    const cardCls = h.kind === "reopen" ? "open" : histKind(h.to, h.status);
    return `<article class="card history-row ${cardCls}" data-goto="${esc(h.issueId || "")}">
      <div class="when">${esc(fmtWhen(h.at))} · ${esc(h.by || "Unknown")}</div>
      <h3>${esc(h.service || h.issueId || "")}</h3>
      <div class="meta">${esc(h.sheetId || "")} · ${esc(title)}</div>
      ${detail}
      ${selected}
    </article>`;
  }

  function renderHistory() {
    $("help").textContent =
      "Newest first. Click a row to open that service. Filter by person. This is the audit of who changed what — it is saved with Save online and used when we merge back to Excel.";
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
      $("list").innerHTML = "<p class='empty'>No history yet. Decisions and form edits appear here with the person’s name after Save online.</p>";
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
    fillPkgFilter();
    if (sheetId === "__history__") {
      renderHistory();
      maybeAskWho();
      return;
    }
    let pairs = [];
    if (sheetId === "__decided__") {
      $("help").textContent =
        "Every decision so far, across all problem types. Filter by Yes / No, change a choice, or Reopen. The create form appears on No for services not on ST or Prod, and on P4 Yes when there is no ST price.";
      for (const s of data.sheets) {
        for (const issue of s.issues) {
          const d = dec(issue.id);
          if (!isDecided(d) || !matchesQuery(issue, q) || !matchesSource(issue)) continue;
          if (df !== "all" && d.status !== df) continue;
          pairs.push({ sheet: s, issue });
        }
      }
    } else {
      const sheet = data.sheets.find((s) => s.id === sheetId);
      $("help").textContent = tabHelp(sheet);
      pairs = sheet.issues
        .filter((issue) => {
          const decided = isDecided(dec(issue.id));
          if (sf === "open" && decided) return false;
          if (sf === "decided" && !decided) return false;
          return matchesQuery(issue, q) && matchesSource(issue);
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
      const form = $("list").querySelector(`.create-form textarea[data-id="${lastFocusId}"], .create-form input[data-id="${lastFocusId}"], .create-form select[data-id="${lastFocusId}"]`);
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

  const RT_SERVICE = [
    "Accommodation",
    "Activity",
    "Airport Transfer",
    "Crew Services",
    "Cruise",
    "Equipment & Supplies",
    "Flight",
    "Gifts & Miscellaneous Items",
    "Leader Service",
    "Local Guide",
    "Meal",
    "Multi-Day Service",
    "Operational",
    "Tolls & Charges",
    "Transfer",
    "Transport",
    "Vehicle Fleet",
  ];
  const OPT_TRUE_FALSE = ["true", "false"];
  const OPT_COST = ["Direct Cost", "Indirect Cost"];
  const OPT_PRICING = ["Standard", "Booking"];
  const OPT_ALLOC = ["booking", "day", "night"];
  const OPT_TIME_SETUP = ["Time Required", "Time From Only", "Time Not Required"];
  const OPT_COMM = ["Email", "Phone", "Fax", "Print", "SMS"];
  const OPT_DAYS = ["Mon;Tue;Wed;Thu;Fri;Sat;Sun", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const OPT_PRICELIST = ["FIT", "All Group Series", "GIT", "Pre/Post", "FIT/Group Series"];
  const OPT_PRICE_TYPE = ["Cost", "Selling"];
  const OPT_CURRENCY = ["MAD", "EUR", "USD", "GBP", "Moroccan Dirham", "Euro", "U.S. Dollar", "British Pound"];
  const OPT_INVENTORY = ["First Day Only", "Each Day", "N/A"];
  const OPT_CONFIRM = ["Manual", "Email", "Confirmation Not Needed"];
  const OPT_INVOICE = ["Itinerary Item", "Itinerary Service", "Prepayment"];
  const OPT_AGREEMENT_TYPE = ["Net Rate", "Commission", "DMC", "DMC Global"];
  const OPT_PAY_TYPE = ["Deposit", "Final Balance", "Billback", "Billback Self-Bill", "Deposit %", "Deposit (Amount)", "Balance"];
  const OPT_PAY_METHOD = ["Credit Card", "Cash", "Bank Transfer", "Bank Payment"];
  const OPT_BEARER = ["Office", "Tour Leader"];
  const OPT_WHEN = [
    "After Booking",
    "Before Travel",
    "After Travel",
    "Fixed Date",
    "Before Package Departure",
    "After Package Departure",
    "After Booking Date",
    "Before Travel Date",
  ];
  const OPT_CHANNEL = ["Tailor-made (Morocco)"];

  const ST_SERVICE_FIELDS = [
    { key: "name", label: "Name", section: "Service" },
    { key: "location", label: "Location", section: "Service" },
    { key: "businessUnit", label: "Business Unit", section: "Service" },
    { key: "serviceType", label: "Service Type (Record Type)", options: RT_SERVICE, section: "Service" },
    { key: "allowDayUse", label: "Allow Day Use", options: OPT_TRUE_FALSE, section: "Service" },
    { key: "costType", label: "Cost Type", options: OPT_COST, section: "Service" },
    { key: "pricingType", label: "Pricing Type", options: OPT_PRICING, section: "Service" },
    { key: "taxGroup", label: "TaxGroup", section: "Service" },
    { key: "allocationType", label: "Allocation Type", options: OPT_ALLOC, section: "Service" },
    { key: "checkInTime", label: "CheckIn Time", section: "Service" },
    { key: "checkOutTime", label: "CheckOut Time", section: "Service" },
    { key: "timeSetup", label: "Time Setup", options: OPT_TIME_SETUP, section: "Service" },
    { key: "preferredComm", label: "Preferred communication", options: OPT_COMM, section: "Service" },
  ];
  const ST_PC_LINE_FIELDS = [
    { key: "priceCategory", label: "Price Category", section: "Price Category" },
    { key: "maxAdults", label: "Price Category MaxAdults", section: "Price Category" },
    { key: "maxChildren", label: "Price Category MaxChildren", section: "Price Category" },
    { key: "priceSeason", label: "Price Season", section: "Price Season" },
    { key: "priceSeasonDates", label: "Price Season Dates", section: "Price Season" },
    { key: "priceSeasonDays", label: "Price Season Days", options: OPT_DAYS, section: "Price Season" },
    { key: "pricelist", label: "Pricelist", options: OPT_PRICELIST, section: "Pricing" },
    { key: "qtyMin", label: "Quantity Minimum", section: "Pricing" },
    { key: "priceType", label: "Price Type", options: OPT_PRICE_TYPE, section: "Pricing" },
    { key: "priceGroup", label: "Price Group", section: "Pricing" },
    { key: "price", label: "Price", section: "Pricing" },
    { key: "priceCurrency", label: "Price Currency", options: OPT_CURRENCY, section: "Pricing" },
    { key: "inventoryType", label: "Inventory Type", options: OPT_INVENTORY, section: "Pricing" },
  ];
  const ST_SUPPLIER_FIELDS = [
    { key: "supplierName", label: "Supplier Name", section: "Supplier" },
    { key: "supplierBu", label: "Supplier Business Unit", section: "Supplier" },
    { key: "supplierConfirm", label: "Supplier Confirmation Method", options: OPT_CONFIRM, section: "Supplier" },
  ];
  const ST_COMMENT_FIELD = { key: "comment", label: "Comment", wide: true, area: true };
  const ST_FORM = ST_SERVICE_FIELDS.concat(ST_PC_LINE_FIELDS, ST_SUPPLIER_FIELDS, [ST_COMMENT_FIELD]);

  const SA_FORM = [
    { key: "agreementName", label: "Agreement Name", section: "Agreement", wide: true, help: "Please include Account name in the name." },
    { key: "dateFrom", label: "Date from", section: "Agreement" },
    { key: "dateTo", label: "Date To", section: "Agreement" },
    { key: "businessUnit", label: "Business Unit", section: "Agreement" },
    { key: "supplierName", label: "Supplier Name", section: "Agreement" },
    { key: "channel", label: "Channel", options: OPT_CHANNEL, section: "Payment Rule" },
    { key: "invoiceBasis", label: "Supplier Invoice Basis", options: OPT_INVOICE, section: "Payment Rule" },
    { key: "cancellationPolicy", label: "Cancellation Policy", section: "Payment Rule" },
    { key: "agreementType", label: "Agreement Type", options: OPT_AGREEMENT_TYPE, section: "Payment Rule" },
    { key: "paymentType", label: "Type", options: OPT_PAY_TYPE, section: "Payment Rule" },
    { key: "paymentMethod", label: "Payment Method", options: OPT_PAY_METHOD, section: "Payment Rule" },
    { key: "costBearer", label: "Cost Bearer", options: OPT_BEARER, section: "Payment Rule" },
    { key: "days", label: "Days", section: "Payment Rule" },
    { key: "when", label: "When", options: OPT_WHEN, section: "Payment Rule" },
    { key: "service", label: "Service", section: "Supplier Agreement Assignment" },
    { key: "priceCategory", label: "Price Category", section: "Supplier Agreement Assignment" },
    { key: "addOns", label: "Add ons", section: "Supplier Agreement Assignment" },
    { key: "fees", label: "Fees", section: "Supplier Agreement Assignment" },
    { key: "comment", label: "Comment", wide: true, area: true },
  ];

  const SUPPLIER_FORM = [
    { key: "supplierName", label: "Supplier Name" },
    { key: "supplierBu", label: "Supplier Business Unit" },
    { key: "supplierConfirm", label: "Supplier Confirmation Method", options: OPT_CONFIRM },
    { key: "preferredComm", label: "Preferred communication", options: OPT_COMM },
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

  function hasStPrice(issue) {
    const rows = issue.priceCompare || [];
    if (rows.some((r) => r.st && r.st !== "—")) return true;
    const raw = ((issue.fields || {})["ST prices"] || "").trim();
    return !!(raw && raw !== "—" && raw !== "-");
  }

  function formKind(sheet, issue, d) {
    const c = d && d.choice;
    if (sheet.id === "SA1" && c === "yes") return "sa";
    if (sheet.id === "SA3" && c === "no") return "sa";
    if (sheet.id === "SA5" && c === "no") return "supplier";
    if (sheet.id === "P4" && c === "yes" && !hasStPrice(issue)) return "st";
    if (issue.fullyMissing && c === "no") return "st";
    return "";
  }

  function emptyPcLine(issue) {
    const extra = issue.formDefaults || {};
    return {
      priceCategory: "",
      maxAdults: extra.maxAdults || "",
      maxChildren: extra.maxChildren || "",
      priceSeason: extra.priceSeason || "",
      priceSeasonDates: extra.priceSeasonDates || issue.stPriceDates || "",
      priceSeasonDays: extra.priceSeasonDays || "",
      pricelist: extra.pricelist || "",
      qtyMin: extra.qtyMin || "",
      priceType: extra.priceType || "",
      priceGroup: extra.priceGroup || "",
      price: "",
      priceCurrency: extra.priceCurrency || "MAD",
      inventoryType: extra.inventoryType || "",
    };
  }

  function pcNamesFromIssue(issue) {
    const extra = issue.formDefaults || {};
    const fields = issue.fields || {};
    const blob = [extra.priceCategory, fields["Package PCs"], fields["ST PCs"], fields["Prod PCs priced"]]
      .filter(Boolean)
      .join(";");
    const names = blob
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    (issue.priceCompare || []).forEach((r) => {
      if (r.pc && r.pc !== "(ST)" && r.pc !== "(Prod)") names.push(r.pc);
    });
    const out = [];
    const seen = new Set();
    names.forEach((n) => {
      const k = n.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(n);
      }
    });
    return out;
  }

  function defaultPriceLines(issue) {
    const extra = issue.formDefaults || {};
    const names = pcNamesFromIssue(issue);
    if (!names.length) {
      const line = emptyPcLine(issue);
      line.price = extra.price || "";
      line.priceCategory = extra.priceCategory || "";
      return [line];
    }
    return names.map((pc) => {
      const line = emptyPcLine(issue);
      line.priceCategory = pc;
      if (names.length === 1) line.price = extra.price || "";
      return line;
    });
  }

  function lineFromFlatForm(form, issue) {
    const line = emptyPcLine(issue);
    ST_PC_LINE_FIELDS.forEach((f) => {
      if (form[f.key] != null && form[f.key] !== "") line[f.key] = form[f.key];
    });
    return line;
  }

  function ensurePriceLines(d, issue) {
    if (!d.form) d.form = {};
    if (Array.isArray(d.form.priceLines) && d.form.priceLines.length) return d.form.priceLines;
    const form = d.form;
    if (form.priceCategory || form.price || form.pricelist || form.priceSeason) {
      d.form.priceLines = [lineFromFlatForm(form, issue)];
    } else {
      d.form.priceLines = defaultPriceLines(issue);
    }
    return d.form.priceLines;
  }

  function fieldControl(f, val, issueId, extraAttr) {
    const cls = f.wide ? "wide" : "";
    const extra = extraAttr || "";
    let control;
    if (f.area) {
      control = `<textarea data-form="${f.key}" data-id="${issueId}" ${extra}>${esc(val)}</textarea>`;
    } else if (f.options) {
      const opts = f.options.slice();
      if (val && !opts.includes(val)) opts.unshift(val);
      const body = [`<option value="">Select…</option>`]
        .concat(
          opts.map(
            (o) => `<option value="${esc(o)}" ${o === val ? "selected" : ""}>${esc(o)}</option>`
          )
        )
        .join("");
      control = `<select data-form="${f.key}" data-id="${issueId}" ${extra}>${body}</select>`;
    } else {
      control = `<input type="text" data-form="${f.key}" data-id="${issueId}" ${extra} value="${esc(val)}" />`;
    }
    const help = f.help ? `<span class="field-help">${esc(f.help)}</span>` : "";
    return `<label class="${cls}">${esc(f.label)}${help}${control}</label>`;
  }

  function groupedSections(fields, values, defs, issueId, extraAttr) {
    const groups = [];
    fields.forEach((f) => {
      const name = f.section || "";
      const last = groups[groups.length - 1];
      if (!last || last.section !== name) groups.push({ section: name, fields: [f] });
      else last.fields.push(f);
    });
    return groups
      .map((g) => {
        const heading = g.section ? `<h5 class="form-section-title">${esc(g.section)}</h5>` : "";
        const body = g.fields
          .map((f) => {
            const val = values[f.key] != null && values[f.key] !== "" ? values[f.key] : defs[f.key] || "";
            return fieldControl(f, val, issueId, extraAttr);
          })
          .join("");
        return `<section class="form-section">${heading}<div class="form-grid">${body}</div></section>`;
      })
      .join("");
  }

  function stFormHtml(sheet, issue, d) {
    const extra = issue.formDefaults || {};
    const form = d.form || {};
    const lines = ensurePriceLines(d, issue);
    const title =
      sheet.id === "P4"
        ? "Add ST pricing — Service Template fields"
        : "New service — Service Template fields";
    const hint =
      sheet.id === "P4"
        ? "No ST price on file. Pre-filled from the service / package. Add a price category for each PC you need."
        : "No — brand new, and not on ST or Prod. Fill these so we can create it. Add a price category for each PC.";
    const service = groupedSections(ST_SERVICE_FIELDS, form, extra, issue.id, "");
    const pcBlocks = lines
      .map((line, i) => {
        const remove =
          lines.length > 1
            ? `<button type="button" class="pc-remove" data-remove-pc data-pcline="${i}" data-id="${issue.id}">Remove</button>`
            : "";
        return `<div class="pc-line">
          <div class="pc-line-head">
            <h5 class="form-section-title">Price category ${i + 1}</h5>
            ${remove}
          </div>
          ${groupedSections(ST_PC_LINE_FIELDS, line, {}, issue.id, `data-pcline="${i}"`)}
        </div>`;
      })
      .join("");
    const add = `<p class="pc-add"><button type="button" data-add-pc data-id="${issue.id}">Add another price category</button></p>`;
    const supplier = groupedSections(ST_SUPPLIER_FIELDS, form, extra, issue.id, "");
    const comment = groupedSections([ST_COMMENT_FIELD], form, extra, issue.id, "");
    return `<div class="create-form">
      <h4>${esc(title)}</h4>
      <p class="meta">${esc(hint)}</p>
      ${service}
      ${pcBlocks}
      ${add}
      ${supplier}
      ${comment}
    </div>`;
  }

  function choiceNote(sheet, issue, d) {
    const c = d && d.choice;
    if (!c) return null;
    const id = sheet.id;
    const fuzzy =
      String(c).startsWith("match:") && issue.fuzzyService
        ? issue.fuzzyService[Number(String(c).slice(6))]
        : null;
    const prodName = fuzzy ? fuzzy.value : "";
    if (id === "P1") {
      if (c === "no")
        return {
          title: "Brand new — not a Prod match",
          body: "A new service will be created. Fill the Service Template fields below.",
        };
      if (c === "yes")
        return {
          title: "Add this name to ST",
          body: "The service will be added to the Service Template using this name.",
        };
      return {
        title: "Use this Prod name",
        body: prodName
          ? "When adding the service to the Service Template, use Prod name: " + prodName + "."
          : "When adding the service to the Service Template, use the selected Prod name.",
      };
    }
    if (id === "P2") {
      if (c === "no")
        return {
          title: "Treat as brand new",
          body: "Keep the ST name. The service will be created on Prod from ST.",
        };
      return {
        title: "Rename to this Prod name",
        body: prodName
          ? "The ST service will be renamed to: " + prodName + "."
          : "The ST service will be renamed to the selected Prod name.",
      };
    }
    if (id === "P4") {
      if (c === "no")
        return {
          title: "Keep the Prod price",
          body: "Leave the existing Prod prices. Do not insert ST.",
        };
      if (!hasStPrice(issue))
        return {
          title: "Add ST prices",
          body: "No ST price on file. Fill the Service Template fields below to add price categories.",
        };
      return {
        title: "Insert the ST price",
        body: "ST amounts will be inserted on Prod for the price categories in the table.",
      };
    }
    if (id === "P5" || id === "SA5") {
      if (c === "prod")
        return {
          title: "Use the Prod supplier",
          body: issue.prodSupplier
            ? "The service will use the Prod account: " + issue.prodSupplier + "."
            : "The service will use the Prod supplier account.",
        };
      if (c === "st")
        return {
          title: "Keep the ST supplier",
          body: issue.stSupplier
            ? "The service will use the ST account: " + issue.stSupplier + "."
            : "The service will keep the ST supplier account.",
        };
      return {
        title: "Different / new account",
        body: "A different supplier will be used. Fill the supplier fields below.",
      };
    }
    if (id === "P6") {
      if (c === "no")
        return {
          title: "New price categories will be created",
          body: "The package PC names will be added as new price categories instead of mapping them to the ST/Prod names above.",
        };
      return {
        title: "Apply the suggested PC map",
        body: "Package PC names will be mapped to the existing ST/Prod names. No new price categories.",
      };
    }
    if (id === "P8") {
      if (c === "yes")
        return {
          title: "FIT pricing is required",
          body: "FIT prices will be added on Prod. Group Tour pricing already exists.",
        };
      return {
        title: "Group Tour only is fine",
        body: "No FIT prices will be added. Prod stays Group Tour only.",
      };
    }
    if (id === "P9") {
      if (c === "prod")
        return {
          title: "Use the Prod location",
          body: issue.prodLocation
            ? "The service will use the Prod location: " + issue.prodLocation + "."
            : "The service will use the Prod location.",
        };
      if (c === "st")
        return {
          title: "Keep the ST location",
          body: issue.stLocation
            ? "The service will keep the ST/template location: " + issue.stLocation + "."
            : "The service will keep the ST/template location.",
        };
      return {
        title: "Neither location is right",
        body: "Set the correct location in the notes (or later on insert).",
      };
    }
    if (id === "P10") {
      if (c === "prod")
        return {
          title: "Use the Prod type",
          body: issue.prodType
            ? "The service will use the Prod record type: " + issue.prodType + "."
            : "The service will use the Prod record type.",
        };
      if (c === "st")
        return {
          title: "Keep the ST type",
          body: issue.stType
            ? "The service will keep the ST/package type: " + issue.stType + "."
            : "The service will keep the ST/package type.",
        };
      return {
        title: "Neither type is right",
        body: "Treat as picklist noise. Set the correct type in the notes (or later on insert).",
      };
    }
    if (id === "P11") {
      if (c === "yes")
        return {
          title: "Replace N/A",
          body: "The placeholder N/A price category will be replaced with a real PC before import.",
        };
      return {
        title: "Not this service",
        body: "Leave this row. Do not replace N/A here.",
      };
    }
    if (id === "SA1") {
      if (c === "yes")
        return {
          title: "Create a new supplier agreement",
          body: "Fill the agreement fields below so we can create it.",
        };
      return {
        title: "Not needed",
        body: "No supplier agreement will be created for this service.",
      };
    }
    if (id === "SA3") {
      if (c === "prod")
        return {
          title: "Use the Prod agreement",
          body: issue.prodAgreement
            ? "Keep the Prod agreement: " + issue.prodAgreement + "."
            : "Keep the Prod agreement name.",
        };
      if (c === "st")
        return {
          title: "Use the template name",
          body: issue.saTemplateName
            ? "The agreement will use the template name: " + issue.saTemplateName + "."
            : "The agreement will be named from the Supplier Agreement Template.",
        };
      return {
        title: "Different / new agreement",
        body: "Fill the agreement fields below so we can create a different agreement.",
      };
    }
    return null;
  }

  function choiceNoteHtml(sheet, issue, d) {
    const note = choiceNote(sheet, issue, d);
    if (!note) return "";
    return `<div class="create-form">
      <h4>${esc(note.title)}</h4>
      <p class="meta">${esc(note.body)}</p>
    </div>`;
  }

  function formHtml(sheet, issue, d) {
    const kind = formKind(sheet, issue, d);
    if (!kind) return "";
    if (kind === "st") return stFormHtml(sheet, issue, d);
    const form = d.form || {};
    const extra = issue.formDefaults || {};
    let spec;
    if (kind === "sa") {
      spec = {
        fields: SA_FORM,
        defs: Object.assign({}, saDefaults(issue), extra),
        title: "New supplier agreement — template fields",
        hint: "Fill these so we can create the agreement.",
      };
    } else {
      spec = {
        fields: SUPPLIER_FORM,
        defs: Object.assign({}, supplierDefaults(issue), extra),
        title: "New / different supplier — service fields",
        hint: "Supplier Name plus the supplier fields from the Service Template, and the TM package.",
      };
    }
    return `<div class="create-form">
      <h4>${esc(spec.title)}</h4>
      <p class="meta">${esc(spec.hint)}</p>
      ${groupedSections(spec.fields, form, spec.defs, issue.id, "")}
    </div>`;
  }

  function priceCompareHtml(issue) {
    const rows = issue.priceCompare || [];
    const dates = issue.stPriceDates || "";
    if (!rows.length && !dates) return "";
    const body = rows.length
      ? rows
          .map((r) => {
            const st = r.st && r.st !== "—" ? esc(r.st) : `<span class="none">no ST price</span>`;
            const prod = r.prod && r.prod !== "—" ? esc(r.prod) : `<span class="none">no Prod price</span>`;
            return `<tr><td>${esc(r.pc)}</td><td>${st}</td><td>${prod}</td></tr>`;
          })
          .join("")
      : `<tr><td colspan="3"><span class="none">No ST price on file — keep or add Prod only.</span></td></tr>`;
    const note = dates ? `<p class="price-note">ST dates: ${esc(dates)}</p>` : "";
    return `${note}<table class="price-compare">
      <thead><tr><th>Price category</th><th>ST</th><th>Prod</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  }

  function cardHtml(sheet, issue) {
    const d = dec(issue.id);
    const opts = optionsFor(sheet, issue);
    const cls = d.status || "open";
    const pkgs = (issue.packages || [])
      .map((p) => {
        const sga = /^SGA\s/i.test(p);
        return `<span class="pkg${sga ? " sga" : ""}">${esc(p)}</span>`;
      })
      .join("");
    const hideFields = new Set([
      "TM package",
      "TM packages",
      "ST prices",
      "ST price dates",
      "Prod PCs priced",
    ]);
    const fieldRows = Object.entries(issue.fields || {})
      .filter(([k]) => !hideFields.has(k))
      .slice(0, 12)
      .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
      .join("");
    const choice = opts
      .map((o) => {
        const checked = d.choice === o.value ? "checked" : "";
        const tone = o.value === "no" || o.value === "skip" ? "no" : o.value === "done" ? "done" : "yes";
        return `<label class="opt ${tone}"><input type="radio" name="${issue.id}" data-choice data-id="${issue.id}" value="${esc(o.value)}" ${checked} /><span>${esc(o.label)}${o.extra ? ` <span class="score">${esc(o.extra)}</span>` : ""}</span></label>`;
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
      ${priceCompareHtml(issue)}
      <dl class="fields">${fieldRows}</dl>
      <div class="choices">${choice}</div>
      ${choiceNoteHtml(sheet, issue, d)}
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

  function fromRemote(raw) {
    const byId = {};
    (raw.items || []).forEach((item) => {
      const row = Object.assign({}, item);
      const id = row.id;
      delete row.id;
      delete row._id;
      if (id) byId[id] = row;
    });
    return {
      byId,
      people: raw.people || [],
      history: raw.history || [],
      updatedAt: raw.updatedAt || "",
    };
  }

  function toRemote() {
    return {
      updatedAt: decisions.updatedAt || new Date().toISOString(),
      people: decisions.people || [],
      history: decisions.history || [],
      items: Object.keys(decisions.byId || {}).map((id) => {
        const row = Object.assign({}, decisions.byId[id], { id });
        delete row._id;
        return row;
      }),
    };
  }

  function netMsg(e) {
    const m = String((e && e.message) || e || "unknown error");
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) {
      return "the shared store did not respond. Firefox often reports this when the store has expired.";
    }
    return m;
  }

  async function fetchJson(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      let extra = "";
      try {
        extra = (await res.text()).slice(0, 160);
      } catch {
        extra = "";
      }
      throw new Error("HTTP " + res.status + (extra ? " — " + extra : ""));
    }
    return res.json();
  }

  function parseStore(raw) {
    if (!raw) return ensureShape({});
    if (Array.isArray(raw.items)) return fromRemote(raw);
    return ensureShape(raw);
  }

  async function saveOnline(quiet) {
    persistLocal();
    try {
      const put = await fetch(STORE, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toRemote()),
      });
      if (!put.ok) throw new Error("HTTP " + put.status);
      setState("Saved online · " + new Date().toLocaleTimeString());
    } catch (e) {
      const msg = netMsg(e);
      setState("Online save failed: " + msg);
      if (!quiet) alert("Online save failed.\n" + msg);
    }
  }

  function replaceFromRemote(parsed) {
    ensureShape(parsed);
    decisions = {
      byId: parsed.byId || {},
      history: parsed.history || [],
      people: parsed.people || [],
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    };
  }

  async function loadOnline(quiet, replace) {
    try {
      let parsed;
      let source = "online";
      try {
        parsed = parseStore(await fetchJson(STORE + "?t=" + Date.now()));
      } catch (liveErr) {
        try {
          parsed = parseStore(await fetchJson(SNAPSHOT + "?t=" + Date.now()));
          source = "snapshot";
        } catch {
          throw liveErr;
        }
      }
      if (replace) replaceFromRemote(parsed);
      else adopt(parsed);
      persistLocal();
      render();
      const label = source === "snapshot"
        ? (replace ? "Replaced from GitHub snapshot" : "Loaded GitHub snapshot")
        : (replace ? "Replaced from online" : "Loaded from online");
      setState(label + " · " + new Date().toLocaleTimeString());
      if (!quiet && source === "snapshot") {
        alert("Live store did not respond. Loaded the last published snapshot from GitHub instead.");
      }
    } catch (e) {
      if (!quiet) alert("Could not load saved work yet: " + netMsg(e));
    }
  }

  loadOnline(true).catch(() => {});
  render();
})();
