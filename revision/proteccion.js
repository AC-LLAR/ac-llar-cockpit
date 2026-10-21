// proteccion.js — Barreras para no perder una revisión a medias (App de revisiones AC·LLAR)
// ---------------------------------------------------------------------------
// A · Borrador automático: la revisión en curso (con sus fotos y la ventana de
//     daño abierta) se guarda en el móvil a cada cambio. Si Chrome se cierra
//     (falta de memoria al abrir la cámara, botón ATRÁS, batería...), al volver
//     a abrir la app se ofrece "Continuar" donde se quedó.
// B · Botón ATRÁS del móvil: dentro de una revisión ya no saca de la app;
//     cierra la ventana abierta o pregunta antes de salir.
// C · Fotos más ligeras: se comprimen sin cargar en memoria la foto original
//     entera (menos riesgo de que Android cierre Chrome).
// D · Pide a Chrome que no borre los datos de la app aunque falte espacio.
// E · Diagnóstico de arranque (modelo, memoria, si Chrome cerró la pestaña).
// Se carga ANTES de nube-rev.js; nube-rev.js llama a Borrador.ofrecer() al
// arrancar y a Borrador.limpiar() al guardar la inspección.
// ---------------------------------------------------------------------------
(function () {
  const KEY = "borrador";
  const PREF = "borrador/"; // fotos del borrador en el almacén local de fotos
  const nube = () => window.Nube || {};
  const usuario = () => String(nube().user || "").trim().toLowerCase();
  const enRevision = () => state.view === "inspect" && !!state.currentInsp;
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // ================= A · BORRADOR =================
  const hashDe = new Map(); // foto (data URL) -> hash, para no recalcular
  const fotosGuardadas = new Set(); // hashes ya escritos en el móvil
  let ultimoJson = null; // último borrador escrito (sin fecha ni scroll)
  let inspRef = null; // revisión a la que corresponde ultimoJson / base
  let baseJson = null; // estado de una OT al abrirla para editar (para saber si hay cambios)
  let ocupado = false, pendiente = false, temporizador = null, ofreciendo = false;
  let gen = 0; // cambia al limpiar: una escritura que ya estaba en marcha no resucita el borrador

  async function hashFoto(dataUrl) {
    let h = hashDe.get(dataUrl);
    if (h) return h;
    const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(dataUrl));
    h = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    hashDe.set(dataUrl, h);
    return h;
  }
  // Foto -> referencia "bd:<hash>" (la foto se escribe una sola vez en el móvil).
  async function aRef(p) {
    if (typeof p !== "string" || !p.startsWith("data:")) return p;
    const h = await hashFoto(p);
    if (!fotosGuardadas.has(h)) {
      await dbPut("photos", { path: PREF + h, data: p, up: false, at: Date.now() });
      fotosGuardadas.add(h);
    }
    return "bd:" + h;
  }
  // Referencia "bd:<hash>" -> foto (null si se perdió).
  async function deRef(p) {
    if (typeof p !== "string" || !p.startsWith("bd:")) return p;
    const h = p.slice(3);
    try {
      const r = await dbGet("photos", PREF + h);
      if (r && r.data) { hashDe.set(r.data, h); fotosGuardadas.add(h); return r.data; }
    } catch (e) {}
    return null;
  }
  const mapArr = async (a, fn) => (Array.isArray(a) ? (await Promise.all(a.slice().map(fn))).filter((x) => x != null) : a);
  async function mapInsp(c, fn) {
    const o = { ...c, genPhotos: await mapArr(c.genPhotos, fn), items: {} };
    for (const [k, v] of Object.entries(c.items || {})) {
      o.items[k] = v && v.d && Array.isArray(v.d.photos) ? { ...v, d: { ...v.d, photos: await mapArr(v.d.photos, fn) } } : v;
    }
    return o;
  }

  async function construir() {
    const insp = await mapInsp(state.currentInsp, aRef);
    const dmg = state.dmgModal && dmgFormState
      ? { itemCode: state.dmgModal.itemCode, form: { ...dmgFormState, photos: await mapArr(dmgFormState.photos, aRef) } }
      : null;
    return { v: 1, user: usuario(), insp, editingId: state.editingId || null, itab: state.itab || "info", dmg };
  }

  async function guardarAhora() {
    if (ofreciendo || !enRevision()) return;
    if (ocupado) { pendiente = true; return; }
    ocupado = true;
    const g = gen;
    try {
      do {
        pendiente = false;
        if (!enRevision()) break;
        const ref = state.currentInsp;
        const d = await construir();
        const json = JSON.stringify(d);
        if (ref !== inspRef) { // revisión recién abierta
          inspRef = ref;
          baseJson = state.editingId && !ref.__recuperada ? json : null;
          ultimoJson = null;
        }
        // Una OT abierta para editar sin ningún cambio no necesita borrador.
        if (baseJson !== null && json === baseJson) continue;
        if (g !== gen) break;
        if (json !== ultimoJson) {
          await dbPut("meta", { key: KEY, value: { ...d, savedAt: new Date().toISOString(), scroll: window.scrollY || 0 } });
          ultimoJson = json;
        }
      } while (pendiente);
    } catch (e) {
      console.warn("[borrador] no se pudo guardar", e);
    } finally {
      ocupado = false;
    }
  }
  function programar(ms) {
    clearTimeout(temporizador);
    temporizador = setTimeout(guardarAhora, ms);
  }
  const haySinGuardar = () => (baseJson === null ? true : ultimoJson !== null && ultimoJson !== baseJson);

  async function limpiar() {
    gen++;
    clearTimeout(temporizador);
    while (ocupado) await new Promise((r) => setTimeout(r, 30));
    try { await dbDelete("meta", KEY); } catch (e) {}
    try {
      const todas = await dbGetAll("photos");
      for (const p of todas) if (String(p.path).startsWith(PREF)) await dbDelete("photos", p.path);
    } catch (e) {}
    hashDe.clear(); fotosGuardadas.clear();
    ultimoJson = null; baseJson = null; inspRef = null;
  }

  // Diálogo propio: no se cierra tocando fuera (para no perder el borrador por error).
  function dialogoRecuperar(html) {
    return new Promise((res) => {
      const ov = document.createElement("div");
      ov.className = "dlg-ov";
      ov.innerHTML = `<div class="dlg" role="dialog" aria-modal="true">${html}<div class="dlg-btns"><button class="dlg-cancel" data-r="descartar">Descartar</button><button class="dlg-ok" data-r="continuar" style="background:var(--P)!important">Continuar</button></div></div>`;
      ov.querySelectorAll("[data-r]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); ov.remove(); res(b.dataset.r); }));
      document.body.appendChild(ov);
    });
  }

  async function ofrecer() {
    arranque();
    let m;
    try { m = await dbGet("meta", KEY); } catch (e) { return; }
    const d = m && m.value;
    if (!d || !d.insp || !d.insp.veh) return;
    if (d.user && usuario() && d.user !== usuario()) return; // borrador de otra persona en este móvil
    ofreciendo = true;
    try {
      const c = d.insp, it = Object.values(c.items || {});
      const marcados = it.filter(Boolean).length, danos = it.filter((x) => x && x.s === "dmg").length;
      let fotos = (c.genPhotos || []).length;
      it.forEach((x) => { if (x && x.d && x.d.photos) fotos += x.d.photos.length; });
      if (d.dmg && d.dmg.form && Array.isArray(d.dmg.form.photos)) fotos += d.dmg.form.photos.length;
      const h = (iso) => (iso ? new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "—");
      const dia = (iso) => (iso ? new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" }) : "");
      const html = `<h3>${d.editingId ? "Cambios sin guardar" : "Revisión sin terminar"}</h3>
        <p><b style="color:var(--INK)">${esc(c.veh.id)} · ${esc(c.veh.plate || "")}</b> · ${esc((c.veh.brand || "") + " " + (c.veh.model || ""))}
${d.editingId ? "Editando una OT ya guardada" : "Empezada el " + dia(c.startedAt || c.date) + " a las " + h(c.startedAt || c.date)} · último cambio a las ${h(d.savedAt)}
${marcados} de ${ALL.length} puntos marcados · ${danos} daño${danos === 1 ? "" : "s"} · ${fotos} foto${fotos === 1 ? "" : "s"}${d.dmg ? "\nTenías abierta la ventana de un daño: se vuelve a abrir." : ""}</p>`;
      for (;;) {
        const r = await dialogoRecuperar(html);
        if (r === "continuar") break;
        if (await uiConfirm(`¿Descartar la revisión de ${c.veh.id}?\n\nSe perderá todo lo marcado y sus fotos. No se puede deshacer.`, { ok: "Descartar", danger: true })) {
          await limpiar();
          diag({ paso: "borrador-descartado", veh: c.veh.id });
          return;
        }
      }
      // Continuar
      const insp = await mapInsp(c, deRef);
      Object.defineProperty(insp, "__recuperada", { value: true, enumerable: false });
      state.currentInsp = insp;
      state.editingId = d.editingId || null;
      state.itab = d.itab || "info";
      state.dmgModal = null; state.showCopyDmg = false; state.copySel = {};
      if (d.dmg && d.dmg.itemCode && ALL.find((i) => i.code === d.dmg.itemCode)) {
        state.dmgModal = { itemCode: d.dmg.itemCode };
        dmgFormState = { ty: null, gr: null, rep: null, pt: "P0", ...d.dmg.form, photos: await mapArr(d.dmg.form && d.dmg.form.photos, deRef) };
      }
      state.view = "inspect";
      ultimoJson = null; inspRef = null;
      render();
      const y = d.scroll || 0;
      requestAnimationFrame(() => setTimeout(() => window.scrollTo(0, y), 50));
      toast("Revisión recuperada: sigue donde lo dejaste", "ok");
      diag({ paso: "borrador-recuperado", veh: c.veh.id, marcados, danos, fotos, edadMin: Math.round((Date.now() - Date.parse(d.savedAt)) / 60000) });
    } finally {
      ofreciendo = false;
      programar(100);
    }
  }

  // Salir de la revisión: siempre pregunta si hay algo sin guardar, y borra el borrador al salir.
  window.backToHome = async function () {
    if (state.currentInsp) {
      if (!state.editingId) {
        if (!(await uiConfirm("¿Descartar esta inspección sin guardar?", { ok: "Descartar", danger: true }))) return;
      } else {
        await guardarAhora();
        if (haySinGuardar() && !(await uiConfirm("¿Salir sin guardar los cambios de esta OT?", { ok: "Salir sin guardar", danger: true }))) return;
      }
    }
    state.currentInsp = null; state.editingId = null; state.dmgModal = null; state.showCopyDmg = false;
    state.view = "home";
    render();
    await limpiar();
  };

  // Cuándo se guarda el borrador
  document.addEventListener("input", () => { if (enRevision()) programar(700); }, true);
  // Antes de abrir la cámara o la galería: guardar YA (Chrome pasa a segundo plano).
  document.addEventListener("click", (e) => {
    const t = e.target.closest && e.target.closest("#dmg-cam-btn,#gen-cam-btn,.photo-input-btn");
    if (t && enRevision()) { clearTimeout(temporizador); guardarAhora(); }
  }, true);
  document.addEventListener("visibilitychange", () => { if (document.hidden && enRevision()) { clearTimeout(temporizador); guardarAhora(); } });
  window.addEventListener("pagehide", () => { if (enRevision()) guardarAhora(); });

  // ================= B · BOTÓN ATRÁS =================
  let ignorarPop = false;
  const conGuarda = () => state.view === "inspect" || state.view === "settings";
  function vigilarHistorial() {
    const marcado = history.state && history.state.acRev;
    if (conGuarda() && !marcado) history.pushState({ acRev: 1 }, "");
    else if (!conGuarda() && marcado) { ignorarPop = true; history.back(); }
  }
  window.addEventListener("popstate", () => {
    if (ignorarPop) { ignorarPop = false; return; }
    if (!conGuarda()) return;
    history.pushState({ acRev: 1 }, ""); // seguimos dentro de la app
    const dlg = document.querySelector(".dlg-ov");
    if (dlg) { const c = dlg.querySelector(".dlg-cancel"); if (c && !dlg.querySelector("[data-r]")) c.click(); return; }
    if (state.view === "settings") { state.view = "home"; render(); return; }
    if (state.dmgModal) { state.dmgModal = null; render(); return; }
    if (state.showCopyDmg) { state.showCopyDmg = false; state.copySel = {}; render(); return; }
    backToHome();
  });
  // Aviso del navegador al cerrar la pestaña con una revisión abierta (ordenador).
  window.addEventListener("beforeunload", (e) => { if (enRevision()) { guardarAhora(); e.preventDefault(); e.returnValue = ""; } });

  // Enganche a cada pintado de pantalla
  const renderOriginal = window.render;
  window.render = function () {
    renderOriginal.apply(this, arguments);
    try { vigilarHistorial(); } catch (e) {}
    if (enRevision()) programar(300);
  };

  // ================= C · FOTOS MÁS LIGERAS =================
  // Igual resultado (máx. 1200 px / 1600 px, misma calidad), pero sin pasar la foto
  // original entera a texto ni decodificarla a tamaño completo cuando se puede evitar.
  const compressOriginal = window.compressImage;
  window.compressImage = async function (file, maxPx, quality) {
    const MAX = maxPx || 1200, Q = quality || 0.75;
    let url = null, bmp = null, cv = null;
    try {
      url = URL.createObjectURL(file);
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const W = img.naturalWidth, H = img.naturalHeight;
      if (!W || !H) throw new Error("sin tamaño");
      const sc = Math.min(MAX / W, MAX / H, 1);
      const w = Math.round(W * sc), h = Math.round(H * sc);
      let src = img;
      if (window.createImageBitmap && sc < 1) {
        try { bmp = await createImageBitmap(file, { resizeWidth: w, resizeHeight: h, resizeQuality: "high", imageOrientation: "from-image" }); src = bmp; } catch (e) { bmp = null; }
      }
      cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(src, 0, 0, w, h);
      img.src = "";
      return cv.toDataURL("image/jpeg", Q);
    } catch (e) {
      return compressOriginal(file, maxPx, quality); // por si acaso, el método de siempre
    } finally {
      if (bmp && bmp.close) bmp.close();
      if (cv) { cv.width = 0; cv.height = 0; }
      if (url) URL.revokeObjectURL(url);
    }
  };

  // ================= D · DATOS PERSISTENTES =================
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) {}

  // ================= E · DIAGNÓSTICO DE ARRANQUE =================
  function diag(info) { try { if (typeof nube().diag === "function") nube().diag(info); } catch (e) {} }
  async function arranque() {
    const info = { paso: "arranque", cerradaPorChrome: !!document.wasDiscarded, ramGB: navigator.deviceMemory || null, standalone: matchMedia("(display-mode: standalone)").matches };
    try {
      const ua = navigator.userAgentData;
      if (ua && ua.getHighEntropyValues) {
        const v = await ua.getHighEntropyValues(["model", "platformVersion"]);
        info.modelo = v.model || ""; info.android = v.platformVersion || "";
      }
    } catch (e) {}
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        info.usoMB = Math.round((est.usage || 0) / 1048576);
        info.persistente = navigator.storage.persisted ? await navigator.storage.persisted() : null;
      }
    } catch (e) {}
    try { const m = await dbGet("meta", KEY); info.borrador = !!(m && m.value); } catch (e) {}
    diag(info);
  }

  window.Borrador = { ofrecer, limpiar, guardarAhora };
})();
