// taller-oferta-bc.js  ---  Crear o editar desde el cockpit la oferta de servicio de BC de un caso.
// Pegas la lista de piezas (del email o de un Excel), el cockpit la separa en líneas (cantidad, referencia, descripción, coste),
// aplica el margen y crea en BC la oferta con una línea por pieza (producto COM0003, COM0004…; los que falten se crean).
// Editar: lee las líneas de la oferta en BC y deja cambiar descripción, cantidad y precio, o añadir líneas. Nunca borra en BC
// (para quitar una pieza: cantidad 0, o borrarla en BC).
// El trabajo con BC lo hace la función crm-alta-bc (acciones oferta_crear, oferta_leer, oferta_guardar).
(function () {
  if (!window.React || !window.AcllarCRM || !window.AcllarCRM._ui) return;
  const U = window.AcllarCRM._ui;
  const { h, btn, inp, Lbl, sb } = U;
  const { useState, useEffect, useMemo } = React;
  const eur = (n) => (n == null || isNaN(n) ? "—" : Number(n).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €");
  const r2 = (n) => Math.round(Number(n) * 100) / 100;

  // ---------- leer números en formato europeo o inglés ----------
  function num(s) {
    let t = String(s == null ? "" : s).trim().replace(/[€\s]/g, ""); if (!t) return null;
    if (!/^-?[\d.,]+$/.test(t)) return null;
    if (t.includes(",") && t.includes(".")) { if (t.lastIndexOf(",") > t.lastIndexOf(".")) t = t.replace(/\./g, "").replace(",", "."); else t = t.replace(/,/g, ""); }
    else if (t.includes(",")) t = t.replace(",", ".");
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
    const n = Number(t); return isNaN(n) ? null : n;
  }
  const esRef = (s) => { const t = String(s || "").trim(); return t.length >= 6 && t.length <= 30 && !/\s/.test(t) && /\d/.test(t) && /[A-Za-z]/.test(t); };
  const esCant = (s) => /^\d{1,3}([.,]\d+)?$/.test(String(s || "").trim()) && num(s) > 0 && num(s) < 1000;
  const esPrecio = (s) => /^\d[\d.,]*$/.test(String(s || "").trim()) && num(s) != null;
  const CABECERA = /^(quantit|cant|qty|cod|ref|descri|denomin|spare|coste|cost|precio|price|importe|uds|unidades)/i;

  // ---------- separar la lista pegada en piezas ----------
  // Admite: filas con tabuladores (copiar de Excel o de una tabla de Outlook) o una celda por línea (como llega a veces del email).
  function leerPiezas(texto) {
    const out = []; if (!texto) return out;
    const lineas = String(texto).replace(/\r/g, "").replace(/ /g, " ").split("\n");
    const conTab = lineas.filter((l) => l.includes("\t")).length >= 2;
    const nueva = (cant, ref, desc, coste) => ({ cantidad: cant, ref: ref || "", descripcion: String(desc || "").replace(/\s+/g, " ").trim(), coste });
    if (conTab) {
      lineas.forEach((l) => { const c = l.split("\t").map((x) => x.trim()); if (c.every((x) => !x)) return; if (c.some((x) => CABECERA.test(x)) && !c.some(esPrecio)) return;
        let cant = null, ref = "", desc = "", coste = null; const resto = [];
        c.forEach((x, i) => { if (!x) return; if (cant == null && esCant(x) && i < 2) cant = num(x); else if (!ref && esRef(x)) ref = x; else resto.push(x); });
        const pi = resto.length && esPrecio(resto[resto.length - 1]) ? resto.length - 1 : -1; if (pi >= 0) coste = num(resto.splice(pi, 1)[0]);
        desc = resto.join(" ");
        if (desc || ref) out.push(nueva(cant, ref, desc, coste)); });
      return out;
    }
    // Una celda por línea: [cantidad] referencia descripción precio
    const celdas = lineas.map((l) => l.trim()).filter(Boolean).filter((l) => !CABECERA.test(l) || esPrecio(l));
    let cur = null, cantPend = null;
    const cerrar = () => { if (cur && (cur.descripcion || cur.ref)) out.push(cur); cur = null; };
    celdas.forEach((x) => {
      if (esRef(x)) { cerrar(); cur = nueva(cantPend, x, "", null); cantPend = null; return; }
      if (!cur) { if (esCant(x)) cantPend = num(x); return; }
      if (!cur.descripcion) { cur.descripcion = x.replace(/\s+/g, " ").trim(); return; }
      if (cur.coste == null && esPrecio(x)) { cur.coste = num(x); cerrar(); return; }
      if (esCant(x) && !cur.descripcion) return;
      cur.descripcion += " " + x.trim();
    });
    cerrar();
    return out;
  }

  // ---------- ventana ----------
  // modo "crear": caso sin oferta. modo "editar": lee las líneas de la oferta caso.oferta_bc.
  function OfertaBC({ T, F, caso, onClose, onHecho }) {
    const editar = !!caso.oferta_bc;
    const [texto, setTexto] = useState("");
    const [margen, setMargen] = useState(50);
    const [filas, setFilas] = useState([]);           // { key, line_no?, cantidad, ref, descripcion, coste, precio, manual, quitar }
    const [cab, setCab] = useState(null);             // datos de la oferta en BC (editar)
    const [estado, setEstado] = useState(editar ? "leyendo" : ""); const [msg, setMsg] = useState("");
    const I = { ...inp(T), padding: "4px 7px", fontSize: "12.5px" };
    const llamar = async (body) => { const { data, error } = await sb().functions.invoke("crm-alta-bc", { body });
      let res = data; if (error) { try { res = error.context && (await error.context.json()); } catch (e) {} if (!res) res = { error: error.message }; } return res || { error: "Sin respuesta" }; };
    useEffect(() => { if (!editar) return; (async () => { const r = await llamar({ accion: "oferta_leer", caso_id: caso.id });
      if (r.error) { setEstado("error"); setMsg(r.error); return; }
      setCab(r.oferta || null); setFilas((r.lineas || []).map((l, i) => ({ key: "b" + (l.line_no || i), line_no: l.line_no, item: l.no, cantidad: l.cantidad, ref: l.descripcion2 || "", descripcion: l.descripcion || "", coste: l.coste ?? null, precio: l.precio ?? null, manual: true, orig: l })));
      setEstado(""); })(); }, []);
    const precioDe = (f) => (f.manual && f.precio != null ? f.precio : f.coste != null ? r2(f.coste * (1 + margen / 100)) : null);
    const pegar = (t) => { setTexto(t); const ps = leerPiezas(t); setFilas((xs) => [...xs.filter((x) => x.line_no), ...ps.map((p, i) => ({ key: "n" + Date.now() + i, ...p, precio: null, manual: false }))]); };
    const setF = (key, k, v) => setFilas((xs) => xs.map((x) => (x.key === key ? { ...x, [k]: v, ...(k === "precio" ? { manual: true } : {}) } : x)));
    const nuevas = filas.filter((f) => !f.line_no && !f.quitar);
    // avisos
    const refs = {}; filas.forEach((f) => { if (f.ref && !f.quitar) refs[f.ref] = (refs[f.ref] || 0) + 1; });
    const aviso = (f) => [f.cantidad == null ? "Sin cantidad (se pondrá 1)" : null, f.ref && refs[f.ref] > 1 ? "Referencia repetida" : null, precioDe(f) == null ? "Sin precio" : null, String(f.descripcion || "").length > 100 ? "Descripción larga: BC corta a 100 caracteres" : null].filter(Boolean);
    const vivas = filas.filter((f) => !f.quitar);
    const totCoste = vivas.reduce((s, f) => s + (f.coste || 0) * (f.cantidad ?? 1), 0);
    const totVenta = vivas.reduce((s, f) => s + (precioDe(f) || 0) * (f.cantidad ?? 1), 0);
    const cambiadas = filas.filter((f) => f.line_no && f.orig && (Number(f.cantidad) !== Number(f.orig.cantidad) || f.descripcion !== (f.orig.descripcion || "") || Number(precioDe(f)) !== Number(f.orig.precio)));
    const enviar = async () => {
      setMsg(""); if (!vivas.length) { setMsg("No hay ninguna pieza."); return; }
      if (vivas.some((f) => precioDe(f) == null)) { setMsg("Hay piezas sin precio: ponlo antes de seguir."); return; }
      const lin = (f) => ({ line_no: f.line_no || null, cantidad: f.cantidad ?? 1, descripcion: String(f.descripcion || "").slice(0, 100), ref: f.ref || "", coste: f.coste, precio_sin_iva: precioDe(f) });
      setEstado("enviando");
      const r = editar ? await llamar({ accion: "oferta_guardar", caso_id: caso.id, cambios: cambiadas.map(lin), nuevas: nuevas.map(lin) })
        : await llamar({ accion: "oferta_crear", caso_id: caso.id, lineas: nuevas.map(lin) });
      if (r.error) { setEstado(""); setMsg("BC no lo ha aceptado: " + r.error); return; }
      setEstado("hecho"); setMsg(editar ? `Oferta ${caso.oferta_bc} actualizada en BC.` : `Oferta ${r.oferta} creada en BC y vinculada al caso.`);
      onHecho && onHecho(r);
    };
    const th = { textAlign: "left", fontSize: "11px", fontWeight: 800, color: T.inkSoft, textTransform: "uppercase", padding: "6px 4px", borderBottom: `1px solid ${T.border}` };
    const td = { padding: "4px", borderBottom: `1px solid ${T.border}`, verticalAlign: "top" };
    return h("div", { role: "dialog", "aria-label": editar ? "Editar oferta en BC" : "Crear oferta en BC", style: { position: "fixed", inset: 0, zIndex: 1270, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "24px 12px" } },
      h("div", { onClick: estado === "enviando" ? undefined : onClose, style: { position: "fixed", inset: 0, background: "rgba(15,27,46,.35)" } }),
      h("div", { style: { position: "relative", width: "min(1100px, 100%)", background: T.surface, borderRadius: "16px", border: `1px solid ${T.border}`, padding: "22px", display: "flex", flexDirection: "column", gap: "12px", fontFamily: F.body, color: T.ink } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
          h("div", { style: { fontFamily: F.display, fontSize: "22px", fontWeight: 800 } }, editar ? `Oferta ${caso.oferta_bc} en BC` : "Crear oferta de servicio en BC"),
          h("button", { onClick: onClose, disabled: estado === "enviando", "aria-label": "Cerrar", style: { border: "none", background: "transparent", cursor: "pointer", fontSize: "22px", color: T.inkSoft } }, "×")),
        estado === "leyendo" ? h("div", { style: { color: T.inkSoft } }, "Leyendo la oferta en BC…") : null,
        h("div", { style: { display: "grid", gridTemplateColumns: "1fr 200px", gap: "12px", alignItems: "start" } },
          h("div", null, h(Lbl, { T }, editar ? "Añadir piezas: pega aquí la lista" : "Pega aquí la lista de piezas (del email o de un Excel)"),
            h("textarea", { "data-ob-pegar": "1", rows: 4, value: texto, onChange: (e) => pegar(e.target.value), placeholder: "Selecciona la tabla en el email, cópiala y pégala aquí. Cada pieza: cantidad · referencia · descripción · coste", style: { ...inp(T), resize: "vertical", fontFamily: "'JetBrains Mono', monospace", fontSize: "12px" } })),
          h("div", null, h(Lbl, { T }, "Margen sobre el coste"),
            h("div", { style: { display: "flex", alignItems: "center", gap: "6px" } }, h("input", { type: "number", "data-ob-margen": "1", value: margen, onChange: (e) => setMargen(Number(e.target.value) || 0), style: { ...inp(T), width: "80px" } }), "%"),
            h("div", { style: { fontSize: "11.5px", color: T.inkSoft, marginTop: "4px" } }, "Precio = coste × (1 + margen). Sin IVA: BC le suma el IVA."))),
        filas.length ? h("div", { style: { overflowX: "auto" } }, h("table", { "data-ob-tabla": "1", style: { width: "100%", borderCollapse: "collapse", fontSize: "12.5px" } },
          h("thead", null, h("tr", null, ["", "Cant.", "Referencia", "Descripción (en BC)", "Coste", "Precio sin IVA", "Total", ""].map((x, i) => h("th", { key: i, style: { ...th, textAlign: i >= 4 && i <= 6 ? "right" : "left" } }, x)))),
          h("tbody", null, filas.map((f, i) => { const av = aviso(f); const p = precioDe(f);
            return h("tr", { key: f.key, "data-ob-fila": i, style: { opacity: f.quitar ? 0.4 : 1, background: f.line_no ? "transparent" : "#F0FDF4" } },
              h("td", { style: { ...td, color: T.inkSoft, width: "26px" } }, f.line_no ? (f.item || "") : "nueva"),
              h("td", { style: { ...td, width: "64px" } }, h("input", { "aria-label": "Cantidad", value: f.cantidad ?? "", onChange: (e) => setF(f.key, "cantidad", e.target.value === "" ? null : num(e.target.value)), style: { ...I, width: "54px", textAlign: "right", borderColor: f.cantidad == null ? T.warn : undefined } })),
              h("td", { style: { ...td, width: "140px", fontFamily: "'JetBrains Mono', monospace", fontSize: "11.5px" } }, f.line_no ? f.ref : h("input", { "aria-label": "Referencia", value: f.ref, onChange: (e) => setF(f.key, "ref", e.target.value), style: { ...I, width: "130px", fontFamily: "inherit" } })),
              h("td", { style: td }, h("input", { "aria-label": "Descripción", value: f.descripcion, maxLength: 100, onChange: (e) => setF(f.key, "descripcion", e.target.value), style: { ...I, width: "100%" } }),
                av.length ? h("div", { style: { fontSize: "11px", color: T.warn, marginTop: "2px" } }, av.join(" · ")) : null),
              h("td", { style: { ...td, width: "90px", textAlign: "right" } }, f.line_no && f.coste == null ? "—" : h("input", { "aria-label": "Coste", value: f.coste ?? "", onChange: (e) => setF(f.key, "coste", num(e.target.value)), style: { ...I, width: "80px", textAlign: "right" } })),
              h("td", { style: { ...td, width: "100px", textAlign: "right" } }, h("input", { "aria-label": "Precio", value: p ?? "", onChange: (e) => setF(f.key, "precio", num(e.target.value)), style: { ...I, width: "90px", textAlign: "right", fontWeight: 700 } })),
              h("td", { style: { ...td, width: "90px", textAlign: "right", fontWeight: 700 } }, p == null ? "—" : eur(p * (f.cantidad ?? 1))),
              h("td", { style: { ...td, width: "30px" } }, f.line_no ? null : h("button", { title: f.quitar ? "Volver a incluir" : "No incluir esta pieza", "data-ob-quitar": i, onClick: () => setF(f.key, "quitar", !f.quitar), style: { border: "none", background: "transparent", cursor: "pointer", color: T.danger, fontWeight: 800 } }, f.quitar ? "↺" : "×"))); })),
          h("tfoot", null, h("tr", null, h("td", { colSpan: 4, style: { ...td, fontWeight: 800 } }, `${vivas.length} pieza${vivas.length === 1 ? "" : "s"}`),
            h("td", { style: { ...td, textAlign: "right", color: T.inkSoft } }, eur(totCoste)), h("td"), h("td", { "data-ob-total": "1", style: { ...td, textAlign: "right", fontWeight: 800 } }, eur(totVenta)), h("td"))))) : null,
        filas.length ? h("div", { style: { fontSize: "12.5px", color: T.inkSoft } }, `Total sin IVA ${eur(totVenta)} · con IVA (21 %) ≈ ${eur(totVenta * 1.21)}. `,
          editar ? "Las líneas que ya están en BC se pueden cambiar; para quitar una pieza pon cantidad 0 (el cockpit nunca borra en BC)." : "Cada pieza va como producto COM (COM0003, COM0004…; si faltan, se crean) con la descripción de la lista.") : null,
        msg ? h("div", { "data-ob-msg": "1", style: { fontSize: "13px", color: estado === "hecho" ? "#15803D" : T.danger } }, msg) : null,
        h("div", { style: { display: "flex", justifyContent: "flex-end", gap: "10px" } },
          h("button", { onClick: onClose, disabled: estado === "enviando", style: btn(T) }, estado === "hecho" ? "Cerrar" : "Cancelar"),
          estado === "hecho" ? null : h("button", { "data-ob-enviar": "1", onClick: enviar, disabled: estado === "enviando" || estado === "leyendo" || (editar ? !nuevas.length && !cambiadas.length : !nuevas.length), style: btn(T, "p") },
            estado === "enviando" ? "Enviando a BC…" : editar ? `Guardar en BC (${cambiadas.length} cambio${cambiadas.length === 1 ? "" : "s"}, ${nuevas.length} nueva${nuevas.length === 1 ? "" : "s"})` : `Crear oferta en BC con ${nuevas.length} pieza${nuevas.length === 1 ? "" : "s"}`))));
  }

  window.AcllarOfertaBC = OfertaBC;
  window.AcllarOfertaBC._test = { leerPiezas, num };
})();
