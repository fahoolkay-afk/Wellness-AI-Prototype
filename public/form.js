// Secure patient form (contract 12.2). The answers are encrypted here, in the browser, with the clinic laptop's public key:
// ephemeral ECDH P-256, HKDF-SHA-256 (salt = form ref, info "frontdesk-form-v1"), AES-256-GCM with AAD "formRef|keyId".
// The front desk receives only { v, keyId, epk, iv, ct } and cannot open it.
(() => {
  const token = location.pathname.split("/").filter(Boolean)[1] ?? "";
  const $ = (id) => document.getElementById(id);
  const enc = new TextEncoder();
  const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
  const show = (id, text, cls = "err") => { $(id).innerHTML = text ? `<div class="note ${cls}"></div>` : ""; if (text) $(id).firstChild.textContent = text; };
  // The clinic's safety questions. Their wording is the clinic owner's to write; these placeholders match the records system's ids.
  const FLAGS = [
    ["rf1", "Safety question 1 (the clinic's own wording goes here)"],
    ["rf2", "Safety question 2 (the clinic's own wording goes here)"],
    ["rf3", "Safety question 3 (the clinic's own wording goes here)"],
  ];
  let meta;

  fetch(`/f/${encodeURIComponent(token)}/meta`).then(async (r) => {
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(out.error || "This link is not valid.");
    return out;
  }).then((m) => {
    meta = m;
    $("clinic-name").textContent = m.clinicName;
    $("hello").textContent = `Hi ${m.firstName}, a few details for ${m.clinicName}`;
    $("sec-details").hidden = !m.sections.includes("details");
    $("sec-intake").hidden = !m.sections.includes("intake");
    $("flags").insertAdjacentHTML("beforeend", FLAGS.map(([id]) => `<div class="yn"><span data-q="${id}"></span><span class="opts"><label><input type="radio" name="${id}" value="yes">Yes</label><label><input type="radio" name="${id}" value="no">No</label></span></div>`).join(""));
    for (const [id, q] of FLAGS) document.querySelector(`[data-q=${id}]`).textContent = q;
    $("form").hidden = false;
    if (!window.crypto?.subtle) show("err", "This browser cannot encrypt the form. Please open the link in an up-to-date browser, or fill it in at the clinic.");
  }).catch((e) => { $("clinic-name").textContent = "Secure form"; show("err", e.message); });

  const val = (id) => $(id).value.trim();
  function answers() {
    const out = { v: 1 };
    if (meta.sections.includes("details")) {
      const d = {};
      const put = (k, v) => { if (v) d[k] = v; };
      put("family_name", val("d-family")); put("dob", val("d-dob")); put("email", val("d-email")); put("address", val("d-address"));
      const em = [val("d-em-name"), val("d-em-phone")].filter(Boolean).join(" · "); put("emergency", em);
      put("insurer", val("d-insurer")); put("policy_no", val("d-policy")); put("member_id", val("d-member")); put("plan_relationship", val("d-rel"));
      if (Object.keys(d).length) out.details = d;
    }
    if (meta.sections.includes("intake")) {
      const flags = {};
      for (const [id] of FLAGS) { const c = document.querySelector(`input[name=${id}]:checked`); if (c) flags[id] = c.value === "yes"; }
      const i = { reason: val("i-reason"), onset: val("i-onset"), conditions: val("i-conditions"), medications: val("i-meds"), red_flags: flags,
        consent_assessment: $("i-c1").checked, consent_cancellation: $("i-c2").checked, signature_name: val("i-sign") };
      const any = i.reason || i.onset || i.conditions || i.medications || Object.keys(flags).length || i.signature_name;
      if (any) {
        if (!i.reason) throw new Error("Please tell us what brings you in, or leave the whole visit section blank.");
        if (!i.consent_assessment || !i.consent_cancellation || !i.signature_name) throw new Error("To send the visit section, tick both boxes and type your full name.");
        for (const k of ["onset", "conditions", "medications"]) if (!i[k]) delete i[k];
        out.intake = i;
      }
    }
    if (!out.details && !out.intake) throw new Error("Nothing filled in yet.");
    return out;
  }

  async function seal(payload) {
    const curve = { name: "ECDH", namedCurve: "P-256" };
    const clinicKey = await crypto.subtle.importKey("raw", unb64u(meta.publicKey), curve, false, []);
    const eph = await crypto.subtle.generateKey(curve, true, ["deriveBits"]);
    const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: clinicKey }, eph.privateKey, 256);
    const hk = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: enc.encode(meta.formRef), info: enc.encode("frontdesk-form-v1") }, hk, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(`${meta.formRef}|${meta.keyId}`) }, key, enc.encode(JSON.stringify(payload)));
    return { v: 1, keyId: meta.keyId, epk: b64u(await crypto.subtle.exportKey("raw", eph.publicKey)), iv: b64u(iv), ct: b64u(ct) };
  }

  $("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    show("msg", "");
    let payload;
    try { payload = answers(); } catch (err) { show("msg", err.message); return; }
    $("send").disabled = true;
    try {
      const body = await seal(payload);
      const r = await fetch(`/f/${encodeURIComponent(token)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) { show("msg", out.error || "It could not be sent. Please try again."); return; }
      $("form").hidden = true;
      $("done-text").textContent = `Thank you, ${meta.firstName}. Your answers went to ${meta.clinicName} encrypted, and this link now no longer works. You can close this page.`;
      $("done").hidden = false;
    } catch {
      show("msg", "It could not be sent. Please check your connection and try again.");
    } finally {
      $("send").disabled = false;
    }
  });
})();
