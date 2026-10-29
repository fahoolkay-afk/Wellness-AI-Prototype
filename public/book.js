// Website booking page (contract 12.1). Sends first name, mobile number, a service code, up to three preferred times and the
// text-consent tick. Nothing else: no last name, birth date or reason. The clinic confirms the time.
(() => {
  const clinicId = location.pathname.split("/").filter(Boolean)[1] ?? "";
  const $ = (id) => document.getElementById(id);
  const msg = (text) => { $("msg").innerHTML = text ? `<div class="note err">${text.replace(/[<>&]/g, "")}</div>` : ""; };
  let meta;

  const today = new Date();
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const hours = Array.from({ length: 23 }, (_, i) => `${String(7 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
  const opts = (sel) => hours.map((h) => `<option ${h === sel ? "selected" : ""}>${h}</option>`).join("");
  function addTime(day, from = "09:00", to = "12:00") {
    const rows = $("times").children.length;
    if (rows >= 3) return;
    const max = new Date(today.getTime() + 60 * 864e5);
    const row = document.createElement("div");
    row.className = "row3";
    row.innerHTML = `<label class="f">Day<input type="date" class="t-day" min="${ymd(today)}" max="${ymd(max)}" value="${day ?? ymd(new Date(today.getTime() + (rows + 1) * 864e5))}"></label>
      <label class="f">From<select class="t-from">${opts(from)}</select></label><label class="f">Until<select class="t-to">${opts(to)}</select></label>`;
    $("times").append(row);
    $("add-time").hidden = $("times").children.length >= 3;
  }

  fetch(`/public/book/${encodeURIComponent(clinicId)}`).then((r) => (r.ok ? r.json() : Promise.reject(r))).then((m) => {
    meta = m;
    document.title = `Book a visit · ${m.clinicName}`;
    $("clinic-name").textContent = m.clinicName;
    $("clinic-meta").textContent = [m.address, m.phone].filter(Boolean).join(" · ");
    $("services").innerHTML = m.services.map((s, i) => `<label class="choice"><input type="radio" name="service" value="${s.code}" ${i === 0 ? "checked" : ""}><span><b>${s.label}</b></span></label>`).join("");
    $("consent-text").textContent = m.consentText;
    $("foot").textContent = m.phone ? `Prefer to talk? Call ${m.phone}.` : "";
    addTime();
    $("book").hidden = false;
  }).catch(() => { $("clinic-name").textContent = "Online booking is not available for this clinic."; });

  $("add-time").addEventListener("click", () => addTime());
  $("book").addEventListener("submit", async (e) => {
    e.preventDefault();
    msg("");
    const times = [...$("times").children].map((r) => ({ day: r.querySelector(".t-day").value, from: r.querySelector(".t-from").value, to: r.querySelector(".t-to").value }));
    const body = {
      firstName: $("first").value.trim(), phone: $("phone").value.trim(), service: document.querySelector("input[name=service]:checked")?.value,
      returning: document.querySelector("input[name=returning]:checked")?.value === "yes", times, textConsent: $("consent").checked, website: $("website").value,
    };
    $("send").disabled = true;
    try {
      const r = await fetch(`/public/book/${encodeURIComponent(clinicId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) { msg(out.error || "Your request could not be sent. Please try again or call the clinic."); return; }
      $("book").hidden = true;
      $("done-text").textContent = body.textConsent
        ? `Thanks, ${body.firstName}. ${meta.clinicName} will text you at ${body.phone} to confirm a time, with a secure link to finish your details.`
        : `Thanks, ${body.firstName}. ${meta.clinicName} will call you at ${body.phone} to confirm a time.`;
      $("done").hidden = false;
    } catch {
      msg("Your request could not be sent. Please check your connection and try again.");
    } finally {
      $("send").disabled = false;
    }
  });
})();
