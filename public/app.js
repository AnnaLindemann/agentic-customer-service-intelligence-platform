/* AI Decision Engine — Prototype Workbench
   Vanilla JS. Submits an email to the backend pipeline and renders the reasoning trace. */

(() => {
  "use strict";

  // ---- Demo scenarios (synthetic; identifiers map to local business data) ----
  const SCENARIOS = [
    {
      label: "Product availability → auto-reply + order link",
      email:
        "Guten Tag,\n\nich interessiere mich für den Vista 45L Backpack. Ist dieser Rucksack " +
        "derzeit auf Lager und sofort lieferbar?\n\nVielen Dank für Ihre Hilfe.\nViele Grüße",
    },
    {
      label: "Product ambiguous (\"Vista\") → ask which one",
      email:
        "Hallo,\n\nhaben Sie den Vista vorrätig? Ich finde die genaue Bezeichnung gerade " +
        "nicht.\n\nViele Grüße",
    },
    {
      label: "Product not in catalogue (\"Banane\") → auto not-found",
      email:
        "Hallo,\n\nich möchte eine Banane kaufen. Haben Sie die auf Lager?\n\nViele Grüße",
    },
    {
      label: "Generic category (\"Rucksack\") → ask for the exact product",
      email:
        "Guten Tag,\n\nich möchte einen Rucksack kaufen. Ist so etwas verfügbar?\n\nViele Grüße",
    },
    {
      label: "English product question → English auto-reply",
      email:
        "Hello,\n\nis the StormShield Rain Jacket currently in stock and ready to ship? " +
        "I would like to order one.\n\nThank you,\nAlex",
    },
    {
      label: "Invoice (paid) → auto-reply",
      email:
        "Sehr geehrtes Serviceteam,\n\nkönnen Sie mir bitte den Status meiner Rechnung " +
        "INV-2026-0002 mitteilen? Ich möchte wissen, ob die Zahlung bereits eingegangen ist.\n\n" +
        "Mit freundlichen Grüßen",
    },
    {
      label: "Invoice (refunded) → auto-reply",
      email:
        "Hallo,\n\nzu meiner Rechnung INV-2026-0011: Mir ist nicht klar, was mit dieser Rechnung " +
        "passiert ist. Können Sie mir den aktuellen Stand erläutern?\n\nViele Grüße",
    },
    {
      label: "Cancellation (eligible) → simulated policy decision",
      email:
        "Hallo,\n\nbitte stornieren Sie meine Bestellung 10004. Ich habe sie versehentlich " +
        "aufgegeben.\n\nVielen Dank",
    },
    {
      label: "Cancellation (shipped) → auto-reply + return path",
      email:
        "Guten Tag,\n\nich möchte meine Bestellung 10002 stornieren. Geht das noch?\n\n" +
        "Viele Grüße",
    },
    {
      label: "Damaged item (within 30 days) → simulated intake + evidence request",
      email:
        "Hallo,\n\nmeine Bestellung 10003 ist angekommen, aber die Granite Hiking Boots sind " +
        "beschädigt – die Sohle ist eingerissen. Was kann ich tun?\n\nDanke und viele Grüße",
    },
    {
      label: "Don't know order number → ask for alternatives",
      email:
        "Guten Tag,\n\nich möchte eine kürzlich aufgegebene Bestellung stornieren, kenne aber " +
        "meine Bestellnummer nicht. Wie können wir das lösen?\n\nViele Grüße",
    },
    {
      label: "Order number not found → acknowledge + alternatives",
      email:
        "Hallo,\n\nbitte stornieren Sie meine Bestellung 99999. Vielen Dank.\n\nViele Grüße",
    },
    {
      label: "Goodwill / dispute → human escalation",
      email:
        "Guten Tag,\n\nmeine Bestellung 10002 ist bereits unterwegs, aber ich bestehe auf einer " +
        "Stornierung aus Kulanz. Andernfalls schalte ich meinen Anwalt ein.\n\nMit freundlichen Grüßen",
    },
    {
      label: "Job application → out of scope (careers)",
      email:
        "Guten Tag,\n\nich möchte mich gerne auf eine Stelle bei Ihnen bewerben. An wen kann " +
        "ich mich wenden?\n\nMit freundlichen Grüßen",
    },
    {
      label: "Supplier / partnership → out of scope (business contact)",
      email:
        "Guten Tag,\n\nwir sind ein Lieferant für Outdoor-Ausrüstung und würden gerne eine " +
        "Partnerschaft bzw. Zusammenarbeit mit Ihnen besprechen. An wen können wir uns wenden?\n\n" +
        "Mit freundlichen Grüßen",
    },
    {
      label: "Unrelated service (dance lesson) → out of scope (no redirect)",
      email:
        "Hallo,\n\nbieten Sie eigentlich auch Tanzkurse oder Tanzunterricht an? Ich suche etwas " +
        "für den Sommer.\n\nViele Grüße",
    },
  ];

  // ---- DOM refs ----
  const $ = (id) => document.getElementById(id);
  const els = {
    scenario: $("scenario"),
    email: $("email"),
    process: $("process"),
    clear: $("clear"),
    spinner: $("process").querySelector(".spinner"),
    btnLabel: $("process").querySelector(".btn-label"),
    formError: $("form-error"),
    responseBadge: $("response-badge"),
    responseEmpty: $("response-empty"),
    responseContent: $("response-content"),
    responseDecision: $("response-decision"),
    responseDraft: $("response-draft"),
    responseGuidance: $("response-guidance"),
    responseMeta: $("response-meta"),
    pipelineEmpty: $("pipeline-empty"),
    pipeline: $("pipeline"),
  };

  // ---- Small helpers ----
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const titleCase = (s) =>
    String(s ?? "")
      .replace(/[_\-]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

  const badge = (text, tone) => `<span class="badge badge-${tone}">${esc(text)}</span>`;

  const DECISION_TONE = {
    AUTO_REPLY: "green",
    ASK_FOR_MORE_INFORMATION: "yellow",
    HUMAN_ESCALATION: "red",
    OUT_OF_SCOPE: "blue",
  };
  const decisionTone = (d) => DECISION_TONE[d] || "gray";
  const decisionLabel = (d) => titleCase(d);

  // Deterministic, non-LLM message shown in the Workbench when no customer reply was delivered.
  // OUT_OF_SCOPE cases get an explicit redirect so the outcome doesn't read as a system failure.
  const OUT_OF_SCOPE_REDIRECT = {
    de: "Diese Anfrage liegt außerhalb der unterstützten Customer-Service-Prozesse. Bitte nutzen Sie den für Ihr Anliegen vorgesehenen Kontakt oder besuchen Sie die entsprechende Seite auf unserer Website.",
    en: "This request is outside the supported customer-service workflows. Please use the appropriate contact channel or visit the relevant section of our website.",
  };
  const undeliveredMessage = (decision, language) => {
    if (decision === "OUT_OF_SCOPE") {
      return OUT_OF_SCOPE_REDIRECT[language] || OUT_OF_SCOPE_REDIRECT.en;
    }
    return "No customer response was delivered for this case.";
  };

  const RISK_TONE = { low: "green", medium: "yellow", high: "red" };
  const PASS_TONE = { pass: "green", fail: "red", not_checked: "gray" };
  const SAFETY_TONE = { safe: "green", review: "yellow", unsafe: "red" };
  const GROUNDING_TONE = {
    grounded: "green",
    partial: "yellow",
    ungrounded: "red",
    not_applicable: "gray",
  };
  const RISK3_TONE = { low: "green", medium: "yellow", high: "red" };

  const fmtUsd = (v) => (v == null ? "n/a" : "$" + Number(v).toFixed(6));
  const fmtMs = (v) => (v == null ? "n/a" : Math.round(v) + " ms");
  const fmtNum = (v) => (v == null ? "n/a" : Number(v).toLocaleString());

  // ---- Scenario selector ----
  function initScenarios() {
    const opts = ['<option value="">— Select a demo scenario —</option>'];
    SCENARIOS.forEach((s, i) => opts.push(`<option value="${i}">${esc(s.label)}</option>`));
    els.scenario.innerHTML = opts.join("");
    els.scenario.addEventListener("change", () => {
      const idx = els.scenario.value;
      if (idx !== "") els.email.value = SCENARIOS[Number(idx)].email;
    });
    // Start with an empty textarea; the user types an email or picks a scenario.
    els.scenario.value = "";
    els.email.value = "";
  }

  // ---- Loading state ----
  function setLoading(on) {
    els.process.disabled = on;
    els.spinner.hidden = !on;
    els.btnLabel.textContent = on ? "Processing…" : "Process Email";
  }

  function showError(msg) {
    els.formError.textContent = msg;
    els.formError.hidden = false;
  }
  function clearError() {
    els.formError.hidden = true;
  }

  // ---- Submit ----
  async function process() {
    const email = els.email.value.trim();
    clearError();
    if (!email) {
      showError("Please enter or select an email to process.");
      return;
    }
    // Flag built-in demo scenarios so the backend evaluates time-relative rules (the 24h
    // cancellation window) against a fixed demo clock — keeping the demo reproducible over time.
    // Custom, edited emails are not flagged and use the real current time.
    const demoMode = SCENARIOS.some((s) => s.email.trim() === email);
    setLoading(true);
    try {
      const res = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, demoMode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      render(data);
    } catch (err) {
      showError(err.message || "Something went wrong while processing the email.");
    } finally {
      setLoading(false);
    }
  }

  // ---- Rendering ----
  function render(r) {
    renderResponse(r);
    renderPipeline(r);
    els.pipelineEmpty.hidden = true;
    els.pipeline.hidden = false;
    els.responseEmpty.hidden = true;
    els.responseContent.hidden = false;
    els.pipeline.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderResponse(r) {
    const decision = r.decision.decision;
    const tone = decisionTone(decision);
    els.responseBadge.className = `badge badge-${tone}`;
    els.responseBadge.textContent = decisionLabel(decision);

    const colorVar = { green: "--green", yellow: "--yellow", red: "--red", gray: "--gray" }[tone];
    els.responseDecision.style.background = `var(${colorVar}-soft)`;
    els.responseDecision.innerHTML =
      `<span class="dot" style="background:var(${colorVar})"></span>` +
      `<span>${esc(decisionLabel(decision))}</span>` +
      `<span class="muted" style="font-weight:500"> · ${esc(titleCase(r.workflow))}</span>`;

    // The canonical response object is the only source of customer-visible text.
    const delivered = Boolean(r.response.delivered && r.response.draft);
    els.responseDraft.className = delivered ? "draft" : "draft escalation";
    els.responseDraft.textContent = delivered
      ? r.response.draft
      : undeliveredMessage(decision, r.response.language);

    // Deterministic "why this decision / what happens next" guidance.
    const g = r.guidance || {};
    const caseRow = r.caseReference
      ? `<dt>Simulated reference</dt><dd>${badge(esc(r.caseReference), "blue")}</dd>`
      : "";
    els.responseGuidance.innerHTML =
      `<p class="subhead">Why this outcome</p>` +
      `<dl class="kv">` +
      (g.whatHappened ? `<dt>What happened</dt><dd>${esc(g.whatHappened)}</dd>` : "") +
      (g.why ? `<dt>Why</dt><dd>${esc(g.why)}</dd>` : "") +
      (g.whatNext ? `<dt>What happens next</dt><dd>${esc(g.whatNext)}</dd>` : "") +
      (g.whatToDo ? `<dt>What the customer should do</dt><dd>${esc(g.whatToDo)}</dd>` : "") +
      caseRow +
      `</dl>`;

    const meta = [];
    meta.push(
      r.response.generationMode === "LLM"
        ? badge("AI-generated reply", "green")
        : r.response.generationMode === "DETERMINISTIC_FALLBACK"
          ? badge("Deterministic fallback", "blue")
          : badge("No response delivered", "gray"),
    );
    meta.push(badge(`Language: ${r.response.language}`, "gray"));
    if (r.escalation && r.escalation.triggered) {
      meta.push(badge(`Escalation trigger: ${titleCase(r.escalation.category)}`, "red"));
    }
    meta.push(
      r.response.compliance.passed
        ? badge("Compliance passed", "green")
        : badge("Compliance failed", "red"),
    );
    meta.push(badge(`${r.response.citedEvidence.length} cited`, "blue"));
    els.responseMeta.innerHTML = meta.join("");
  }

  function stageCard(index, title, badgeHtml, bodyHtml) {
    return (
      `<article class="stage">` +
      `<div class="stage-head">` +
      `<span class="stage-index">${index}</span>` +
      `<h3 class="stage-title">${esc(title)}</h3>` +
      (badgeHtml || "") +
      `</div>` +
      `<div class="stage-body">${bodyHtml}</div>` +
      `</article>`
    );
  }

  function renderPipeline(r) {
    const cards = [];
    cards.push(cardIntent(r));
    cards.push(cardRanked(r));
    cards.push(cardSlots(r));
    cards.push(cardStructured(r));
    cards.push(cardPolicy(r));
    cards.push(cardSufficiency(r));
    cards.push(cardRules(r));
    cards.push(cardDecision(r));
    cards.push(cardAudit(r));
    els.pipeline.innerHTML = cards.join("");
  }

  // 1. Intent Classification
  function cardIntent(r) {
    const conf = Math.round(r.intent.confidence * 100);
    const tone = r.intent.fallback ? "yellow" : r.scope.status === "SUPPORTED" ? "green" : "yellow";
    const b = badge(r.intent.fallback ? "Fallback" : `${conf}% confident`, tone);
    const body =
      `<dl class="kv">` +
      `<dt>Intent</dt><dd>${badge(titleCase(r.intent.intent), "blue")}</dd>` +
      `<dt>Confidence</dt><dd>${conf}%</dd>` +
      `<dt>Scope</dt><dd>${esc(titleCase(r.scope.status))} <span class="muted">· ${esc(r.scope.reasonCode)}</span></dd>` +
      (r.intent.fallback
        ? `<dt>Note</dt><dd class="muted">Safe fallback used (LLM unavailable or invalid output).</dd>`
        : "") +
      `</dl>`;
    return stageCard(1, "Intent Classification", b, body);
  }

  // 2. Ranked Intents
  function cardRanked(r) {
    const ranked = r.intent.ranked || [];
    const rows = ranked
      .map((c, i) => {
        const pct = Math.round(c.confidence * 100);
        return (
          `<div class="rank-row">` +
          `<span class="rank-name ${i === 0 ? "is-top" : ""}">${esc(titleCase(c.intent))}</span>` +
          `<span class="rank-bar"><span class="rank-bar-fill ${i === 0 ? "" : "dim"}" style="width:${pct}%"></span></span>` +
          `<span class="rank-val">${pct}%</span>` +
          `</div>`
        );
      })
      .join("");
    const b = badge(`${ranked.length} candidate${ranked.length === 1 ? "" : "s"}`, "gray");
    return stageCard(2, "Ranked Intents", b, rows || `<p class="muted">No candidates.</p>`);
  }

  // 3. Slot Extraction
  function cardSlots(r) {
    const present = r.slots.present || [];
    const missing = r.slots.missing || [];
    const presentChips = present.length
      ? present.map((k) => `<span class="chip chip-present">${esc(k)}</span>`).join("")
      : `<span class="muted">None extracted</span>`;
    const missingChips = missing.length
      ? missing.map((k) => `<span class="chip chip-missing">${esc(k)}</span>`).join("")
      : `<span class="muted">None — all required fields present</span>`;
    const b = present.length
      ? badge(`${present.length} extracted`, "green")
      : badge("None extracted", "gray");
    const body =
      `<p class="subhead">Extracted fields</p><div class="chips">${presentChips}</div>` +
      `<p class="subhead">Required but missing</p><div class="chips">${missingChips}</div>` +
      rawBlock("Resolved slot values", r.slots.values);
    return stageCard(3, "Slot Extraction", b, body);
  }

  // 4. Structured Business Data
  function cardStructured(r) {
    const facts = r.retrieval.structuredFacts || [];
    const b = badge(`${facts.length} record${facts.length === 1 ? "" : "s"}`, facts.length ? "green" : "gray");
    let body;
    if (!facts.length) {
      body = `<p class="muted">No structured business records matched the extracted identifiers.</p>`;
    } else {
      body = facts.map(renderFact).join("");
    }
    return stageCard(4, "Structured Business Data", b, body);
  }

  // Curated, human-readable fields per record kind.
  const FACT_FIELDS = {
    order: ["orderId", "customerName", "status", "placedAt", "shippingMethod", "total"],
    invoice: ["invoiceId", "orderId", "status", "issueDate", "dueDate", "amountDue", "total"],
    product: ["name", "sku", "availability", "quantityOnHand", "price", "restockDate"],
    customer: ["customerName", "orderIds", "invoiceIds"],
  };

  function renderFact(f) {
    const fields = FACT_FIELDS[f.kind] || Object.keys(f.data).slice(0, 6);
    const cells = fields
      .filter((k) => f.data[k] !== undefined && f.data[k] !== null)
      .map((k) => {
        let v = f.data[k];
        if (Array.isArray(v)) v = v.join(", ");
        return `<div><span class="k">${esc(titleCase(k))}</span><br /><span class="v">${esc(v)}</span></div>`;
      })
      .join("");
    let badgeHtml = badge(titleCase(f.kind), "blue");
    if (f.kind === "product" && typeof f.data.availability === "string") {
      const av = f.data.availability;
      const tone = av === "in_stock" ? "green" : av === "out_of_stock" || av === "discontinued" ? "red" : "yellow";
      badgeHtml = badge(titleCase(av), tone);
    }
    return (
      `<div class="fact">` +
      `<div class="fact-head">${badgeHtml}<span class="fact-ref">${esc(f.ref)}</span></div>` +
      `<div class="fact-grid">${cells}</div>` +
      `</div>`
    );
  }

  // 5. Retrieved Policy Evidence
  function cardPolicy(r) {
    const ev = r.retrieval.policyEvidence || [];
    const b = badge(`${ev.length} passage${ev.length === 1 ? "" : "s"}`, ev.length ? "green" : "gray");
    let body;
    if (!ev.length) {
      body = `<p class="muted">No policy passage cleared the similarity threshold for this query.</p>`;
    } else {
      body = ev
        .map((p) => {
          const pct = Math.round(p.score * 100);
          return (
            `<div class="policy">` +
            `<p class="policy-snippet">${esc(p.snippet)}</p>` +
            `<div class="policy-foot"><span class="fact-ref">${esc(p.ref)}</span>` +
            `${badge(`similarity ${pct}%`, "blue")}</div>` +
            `</div>`
          );
        })
        .join("");
    }
    return stageCard(5, "Retrieved Policy Evidence", b, body);
  }

  // 6. Data Sufficiency
  function cardSufficiency(r) {
    const s = r.sufficiency;
    const b = s.sufficient ? badge("Sufficient", "green") : badge("Insufficient", "yellow");
    const body =
      `<dl class="kv">` +
      `<dt>Verdict</dt><dd>${s.sufficient ? badge("Sufficient", "green") : badge("Insufficient", "yellow")}</dd>` +
      `<dt>Reason</dt><dd><span class="badge badge-mono badge-gray">${esc(s.reasonCode)}</span></dd>` +
      `<dt>Structured data</dt><dd>${s.hasStructuredData ? badge("Present", "green") : badge("Missing", "red")}</dd>` +
      `<dt>Policy evidence</dt><dd>${s.hasPolicyEvidence ? badge("Present", "green") : badge("Missing", "yellow")}</dd>` +
      (s.missingInformation && s.missingInformation.length
        ? `<dt>Missing</dt><dd>${s.missingInformation.map((m) => `<span class="chip chip-missing">${esc(m)}</span>`).join(" ")}</dd>`
        : "") +
      `</dl>`;
    return stageCard(6, "Data Sufficiency", b, body);
  }

  // 7. Business Rule Evaluation
  function cardRules(r) {
    const rules = r.businessRules || [];
    const passed = rules.filter((x) => x.passed).length;
    let b;
    if (!rules.length) b = badge("No rules", "gray");
    else if (passed === rules.length) b = badge(`${passed}/${rules.length} passed`, "green");
    else b = badge(`${passed}/${rules.length} passed`, "red");
    let body;
    if (!rules.length) {
      body = `<p class="muted">No business rules apply to this workflow.</p>`;
    } else {
      body = rules
        .map((rule) => {
          const tone = rule.passed ? "pass" : "fail";
          return (
            `<div class="rule">` +
            `<span class="rule-icon ${tone}">${rule.passed ? "✓" : "✕"}</span>` +
            `<div><span class="rule-id">${esc(rule.ruleId)}</span> ` +
            `${badge(titleCase(rule.riskLevel) + " risk", RISK_TONE[rule.riskLevel] || "gray")}` +
            `<div class="rule-detail">${esc(rule.details || "")}</div></div>` +
            `</div>`
          );
        })
        .join("");
    }
    return stageCard(7, "Business Rule Evaluation", b, body);
  }

  // 8. Final Decision
  function cardDecision(r) {
    const d = r.decision;
    const tone = decisionTone(d.decision);
    const colorVar = { green: "--green", yellow: "--yellow", red: "--red", gray: "--gray" }[tone];
    const b = badge(decisionLabel(d.decision), tone);
    const body =
      `<div class="decision-final" style="background:var(${colorVar}-soft)">` +
      `<span class="dot" style="width:12px;height:12px;border-radius:50%;background:var(${colorVar})"></span>` +
      `<span class="big" style="color:var(${colorVar})">${esc(decisionLabel(d.decision))}</span>` +
      `${badge(titleCase(d.riskLevel) + " risk", RISK_TONE[d.riskLevel] || "gray")}` +
      `</div>` +
      `<dl class="kv">` +
      `<dt>Reason code</dt><dd><span class="badge badge-mono badge-gray">${esc(d.reasonCode)}</span></dd>` +
      (d.rationale ? `<dt>Rationale</dt><dd>${esc(d.rationale)}</dd>` : "") +
      `<dt>Final outcome</dt><dd>${esc(titleCase(r.audit.decision.finalOutcome))}</dd>` +
      `</dl>`;
    return stageCard(8, "Final Decision", b, body);
  }

  // 9. Audit & Evaluation
  function cardAudit(r) {
    const a = r.audit;
    const t = a.llmTotals;
    const calls = a.llm || [];
    const provider = calls.length ? calls[0].provider : "—";
    const models = [...new Set(calls.map((c) => c.actualModelReturned || c.configuredModel))].filter(Boolean);
    const promptVersions = [...new Set(calls.map((c) => c.promptVersion).filter(Boolean))];
    const jsonResults = [...new Set(calls.map((c) => c.jsonValidationResult))];
    const jsonOk = jsonResults.length === 1 && jsonResults[0] === "valid";
    const jsonTone = jsonOk ? "green" : jsonResults.includes("transport_error") ? "red" : "yellow";

    const metrics =
      `<div class="audit-grid">` +
      metric("Provider", provider) +
      metric("Model", models.join(", ") || "—", true) +
      metric("LLM calls", fmtNum(t.callCount)) +
      metric("Total tokens", fmtNum(t.totalTokens)) +
      metric("Input / Output", `${fmtNum(t.inputTokens)} / ${fmtNum(t.outputTokens)}`) +
      metric("Est. cost", fmtUsd(t.estimatedCostUsd), true) +
      metric("Latency", fmtMs(t.latencyMs)) +
      metric("Retries", fmtNum(t.retryCount)) +
      `</div>`;

    const kv =
      `<dl class="kv">` +
      `<dt>Prompt versions</dt><dd>${
        promptVersions.length
          ? promptVersions.map((v) => `<span class="badge badge-mono badge-gray">${esc(v)}</span>`).join(" ")
          : '<span class="muted">none</span>'
      }</dd>` +
      `<dt>JSON validation</dt><dd>${badge(jsonOk ? "All valid" : jsonResults.join(", "), jsonTone)}</dd>` +
      `<dt>Pipeline</dt><dd><span class="badge badge-mono badge-gray">${esc(a.execution.pipelineVersion)}</span></dd>` +
      `</dl>`;

    const ev = a.evaluation;
    const evalRow =
      `<p class="subhead">Evaluation summary <span class="muted" style="text-transform:none;font-weight:500">· heuristic signals, not ground truth</span></p>` +
      `<div class="eval-row">` +
      badge("Safety: " + titleCase(ev.overallSafetyStatus), SAFETY_TONE[ev.overallSafetyStatus] || "gray") +
      badge("Grounding: " + titleCase(ev.groundingStatus), GROUNDING_TONE[ev.groundingStatus] || "gray") +
      badge("Hallucination: " + titleCase(ev.hallucinationRisk), RISK3_TONE[ev.hallucinationRisk] || "gray") +
      badge("PII leak: " + titleCase(ev.piiLeakageRisk), RISK3_TONE[ev.piiLeakageRisk] || "gray") +
      badge("Completeness: " + titleCase(ev.completenessStatus), ev.completenessStatus === "complete" ? "green" : ev.completenessStatus === "incomplete" ? "yellow" : "gray") +
      `</div>`;

    const compliance = a.compliance;
    const compRow =
      `<p class="subhead">Compliance checks</p>` +
      `<div class="eval-row">` +
      badge("PII leak: " + titleCase(compliance.piiLeakCheckResult), PASS_TONE[compliance.piiLeakCheckResult] || "gray") +
      badge("Language: " + titleCase(compliance.languageCheckResult), PASS_TONE[compliance.languageCheckResult] || "gray") +
      badge("Promises: " + titleCase(compliance.unsupportedPromiseCheckResult), PASS_TONE[compliance.unsupportedPromiseCheckResult] || "gray") +
      `</div>`;

    const raw = rawBlock("Full audit record (JSON)", a) + rawBlock("Canonical output (FinalApiResponse)", r.final);
    const b = badge("Trace ready", "green");
    return stageCard(9, "Audit & Evaluation", b, metrics + kv + evalRow + compRow + raw);
  }

  function metric(label, value, mono) {
    return (
      `<div class="metric"><div class="metric-label">${esc(label)}</div>` +
      `<div class="metric-value ${mono ? "mono" : ""}">${esc(value)}</div></div>`
    );
  }

  function rawBlock(label, obj) {
    return (
      `<details class="raw"><summary>${esc(label)}</summary>` +
      `<pre class="json">${esc(JSON.stringify(obj, null, 2))}</pre></details>`
    );
  }

  // ---- Wire up ----
  els.process.addEventListener("click", process);
  els.clear.addEventListener("click", () => {
    els.email.value = "";
    els.scenario.value = "";
    clearError();
  });
  els.email.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") process();
  });

  initScenarios();
})();
