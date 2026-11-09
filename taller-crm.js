// taller-crm.js  ---  CRM de taller (grupo TALLER → Casos). Toda consulta entra aquí; las de garantía pasan a la pestaña Garantías.
// Se carga antes que motor.js y expone window.AcllarCRM (un componente React).
// motor.js lo monta dentro de TallerView pasándole la paleta T y las fuentes F.
// Datos: tablas crm_clientes / crm_casos / crm_eventos (historial automático por trigger)
// y el espejo de Business Central bc_clientes / bc_servicio (lo rellena bc-sync cada 10 min).
// Alta en BC: Edge Function crm-alta-bc (solo crea clientes, nunca modifica ni borra).
// Diseño completo: doc del proyecto claude/taller_crm_clientes_diseno.md
(function () {
  if (!window.React) return;
  const h = React.createElement;
  const { useState, useEffect, useRef } = React;

  const ANA_TEL = "34654775591";
  const RESPONSABLES = ["Sebastián", "Gonzalo", "Pablo"];
  const CANALES = [["telefono", "Teléfono"], ["email", "Email"], ["whatsapp", "WhatsApp"], ["presencial", "En persona"], ["otro", "Otro"]];
  const TIPOS = [["reparacion", "Reparación"], ["piezas", "Solo piezas"], ["gas", "Revisión de gas"], ["estanqueidad", "Estanqueidad"], ["garantia", "Garantía"], ["otro", "Otro"]];
  const TIPOS_CLI = [["propio", "Cliente propio"], ["externo", "Cliente externo"]];
  // Bitácora: lo que se va haciendo con el cliente o el fabricante. Fecha, hora y autor los pone el servidor.
  const CLASES = [["respondi", "Le respondí"], ["pedi", "Le pedí"], ["respondio", "Me respondió"], ["fabricante", "Fabricante"], ["llamada", "Llamada"], ["nota", "Nota"]];
  const BITACORA = ["bitacora", "nota", "llamada", "mensaje"];
  const lbl = (arr, k) => (arr.find((x) => x[0] === k) || [k, k || "—"])[1];

  const CH = {
    gris: { bg: "#EDEFF3", bd: "#D5DAE3", fg: "#556274" }, azul: { bg: "#E9EEFC", bd: "#C9D4FB", fg: "#2A44D6" },
    ambar: { bg: "#FEF1E1", bd: "#F2C48D", fg: "#B45309" }, violeta: { bg: "#F2E9FB", bd: "#D8C3F5", fg: "#6D28D9" },
    verde: { bg: "#D7EFDA", bd: "#AED8B5", fg: "#1F5E2A" }, rojo: { bg: "#FDECEC", bd: "#F5B5B5", fg: "#B42318" },
  };
  const NOW = "__now__";
  // Máquina de estados: cada estado sabe su fase, su color y qué pasos siguientes ofrece.
  const E = {
    pendiente_respuesta: { l: "Pendiente de respuesta", f: "consulta", c: "ambar", sig: [{ to: "respondida", l: "Respondida" }, { to: "en_garantias", l: "Es garantía: pasar a Garantías" }] },
    respondida: { l: "Respondida", f: "consulta", c: "azul", sig: [
      { to: "presupuesto_por_hacer", l: "Hay que hacer presupuesto" },
      { to: "en_garantias", l: "Es garantía: pasar a Garantías" },
      { to: "cita_asignada", l: "Sin presupuesto: dar cita", set: { rama: "C" } }] },
    presupuesto_por_hacer: { l: "Presupuesto por hacer", f: "presupuesto", c: "ambar", sig: [{ to: "presupuesto_hecho", l: "Presupuesto hecho en BC" }] },
    presupuesto_hecho: { l: "Presupuesto hecho", f: "presupuesto", c: "azul", sig: [{ to: "presupuesto_enviado", l: "Enviado al cliente" }] },
    presupuesto_enviado: { l: "Presupuesto enviado", f: "presupuesto", c: "azul", sig: [
      { to: "aceptado", l: "Aceptado" }, { to: "rechazado", l: "Rechazado" }, { to: "sin_respuesta", l: "Sin respuesta" }] },
    aceptado: { l: "Aceptado", f: "presupuesto", c: "verde", sig: [
      { to: "senal_solicitada", l: "A · Piezas sin stock: pedir señal 50 %", set: { rama: "A" } },
      { to: "cita_asignada", l: "B · Piezas en stock: dar cita", set: { rama: "B" } },
      { to: "cita_asignada", l: "C · Sin piezas: dar cita", set: { rama: "C" } },
      { to: "avisado_retirar", l: "Solo piezas en stock: avisar para retirar", set: { rama: "B" } }] },
    senal_solicitada: { l: "Señal solicitada", f: "piezas", c: "ambar", sig: [{ to: "comprobante_recibido", l: "Comprobante recibido", set: { senal_comprobante_at: NOW } }] },
    comprobante_recibido: { l: "Comprobante recibido", f: "piezas", c: "ambar", sig: [{ to: "contabilidad_avisada", l: "Contabilidad avisada (sin WhatsApp)", set: { senal_aviso_at: NOW } }] },
    contabilidad_avisada: { l: "Contabilidad avisada", f: "piezas", c: "azul", sig: [{ to: "piezas_pedidas", l: "Piezas pedidas" }] },
    piezas_pedidas: { l: "Piezas pedidas", f: "piezas", c: "azul", sig: [{ to: "cliente_avisado_piezas", l: "Cliente avisado: piezas pedidas" }] },
    cliente_avisado_piezas: { l: "Cliente avisado (piezas pedidas)", f: "piezas", c: "azul", sig: [{ to: "piezas_recibidas", l: "Piezas recibidas" }] },
    piezas_recibidas: { l: "Piezas recibidas", f: "piezas", c: "verde", sig: [{ to: "cita_asignada", l: "Dar cita" }, { to: "avisado_retirar", l: "Solo piezas: avisar para retirar" }] },
    garantia_analisis: { l: "Garantía · en análisis", f: "piezas", c: "violeta", sig: [
      { to: "garantia_solicitada", l: "Viable: solicitada al fabricante", set: { garantia_ultimo_contacto: NOW } },
      { to: "presupuesto_por_hacer", l: "No viable: pasar a presupuesto" }, { to: "cerrado", l: "No viable: cerrar" }] },
    garantia_solicitada: { l: "Garantía · solicitada", f: "piezas", c: "violeta", sig: [{ to: "garantia_seguimiento", l: "En seguimiento con el fabricante" }] },
    garantia_seguimiento: { l: "Garantía · seguimiento fabricante", f: "piezas", c: "violeta", sig: [
      { to: "piezas_pedidas", l: "Aprobada total → piezas pedidas", set: { garantia_resultado: "total", garantia_100: true } },
      { to: "garantia_parcial", l: "Aprobada parcial", set: { garantia_resultado: "parcial" } },
      { to: "presupuesto_por_hacer", l: "Rechazada → presupuesto", set: { garantia_resultado: "rechazada" } },
      { to: "cerrado", l: "Rechazada → cerrar", set: { garantia_resultado: "rechazada" } }] },
    garantia_parcial: { l: "Garantía parcial · avisar al cliente", f: "piezas", c: "violeta", sig: [{ to: "cliente_avisado_cobertura", l: "Cliente avisado de qué cubre y qué no" }] },
    cliente_avisado_cobertura: { l: "Cliente avisado de la cobertura", f: "piezas", c: "violeta", sig: [
      { to: "piezas_pedidas", l: "Piezas pedidas" },
      { to: "senal_solicitada", l: "Lo no cubierto lleva piezas sin stock → pedir señal 50 %" }] },
    cita_asignada: { l: "Cita asignada", f: "cita", c: "verde", sig: [{ to: "vehiculo_recibido", l: "Vehículo recibido" }] },
    vehiculo_recibido: { l: "Vehículo recibido", f: "taller", c: "violeta", sig: [{ to: "trabajo_terminado", l: "Trabajo terminado" }] },
    trabajo_terminado: { l: "Trabajo terminado", f: "taller", c: "ambar", sig: [{ to: "avisado_retirar", l: "Cliente avisado para retirar" }] },
    avisado_retirar: { l: "Avisado para retirar", f: "retirar", c: "azul", sig: [{ to: "retirado", l: "Retirado" }] },
    retirado: { l: "Retirado", f: "cerrado", c: "gris", fin: true },
    rechazado: { l: "Rechazado", f: "cerrado", c: "gris", fin: true },
    sin_respuesta: { l: "Sin respuesta", f: "cerrado", c: "gris", fin: true },
    cerrado: { l: "Cerrado", f: "cerrado", c: "gris", fin: true },
    en_garantias: { l: "En Garantías", f: "cerrado", c: "violeta", fin: true, gar: true },
  };
  const est = (k) => E[k] || { l: k || "—", f: "consulta", c: "gris", sig: [] };
  const FASES = [["consulta", "Consulta"], ["presupuesto", "Presupuesto"], ["piezas", "Piezas · Garantía"], ["cita", "Cita"], ["taller", "En taller"], ["retirar", "Para retirar"]];
  const RECORRIDO = ["consulta", "presupuesto", "piezas", "cita", "taller", "retirar"];
  const CAMPOS = { estado: "Estado", proxima_accion: "Próxima acción", responsable: "Responsable", fecha_limite: "Fecha límite", oferta_bc: "Oferta BC", pedido_bc: "Pedido BC",
    garantia_100: "100 % garantía", senal_importe: "Importe señal", senal_comprobante_at: "Comprobante", senal_aviso_at: "Aviso a contabilidad", garantia_fabricante: "Fabricante",
    garantia_reclamacion: "Nº reclamación", garantia_ultimo_contacto: "Último contacto fabricante", garantia_resultado: "Resultado garantía", garantia_cubre: "Cubre", garantia_no_cubre: "No cubre",
    piezas_previstas: "Llegada de piezas", cita_at: "Cita", cerrado_at: "Cerrado", motivo_cierre: "Motivo de cierre", archivado: "Archivado", rama: "Rama", vehiculo: "Vehículo",
    consulta: "Consulta", tipo: "Tipo", canal: "Canal", nombre: "Nombre", apellidos: "Apellidos", telefono: "Teléfono", email: "Email", nif: "NIF", direccion: "Dirección", cp: "CP",
    ciudad: "Población", provincia: "Provincia", vehiculos: "Vehículos", notas: "Notas", bc_no: "Nº cliente BC", tipo_cliente: "Tipo de cliente" };

  // ---------- utilidades ----------
  const sb = () => window.acllarCloud && window.acllarCloud.sb;
  const yo = () => {
    const e = ((window.acllarCloud && window.acllarCloud.usuario && window.acllarCloud.usuario()) || "").toLowerCase();
    return RESPONSABLES.find((r) => e.startsWith(r.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""))) || "";
  };
  const pad = (n) => String(n).padStart(2, "0");
  const fFecha = (iso) => { if (!iso) return "—"; const d = new Date(iso); return isNaN(d) ? "—" : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
  const fFechaHora = (iso) => { if (!iso) return "—"; const d = new Date(iso); return isNaN(d) ? "—" : `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const toLocalInput = (iso) => { if (!iso) return ""; const d = new Date(iso); return isNaN(d) ? "" : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fLarga = (iso) => { if (!iso) return "—"; const d = new Date(iso); return isNaN(d) ? "—" : `${["dom", "lun", "mar", "mié", "jue", "vie", "sáb"][d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);
  const eur = (n) => (n == null || n === "" ? "—" : Number(n).toLocaleString("es-ES", { style: "currency", currency: "EUR" }));
  const nombreCli = (c) => (c ? [c.nombre, c.apellidos].filter(Boolean).join(" ") : "—");
  const horas = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 36e5 : 0);
  const mismoDia = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const norm = (s) => String(s || "").trim().toUpperCase();
  const sinAcentos = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
  const qSafe = (s) => String(s || "").replace(/[,()%*]/g, " ").trim();
  // Vehículos del cliente = productos de servicio en BC (Descripción = modelo, Nº serie = matrícula, Descripción alias = bastidor).
  const normMat = (v) => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const asVeh = (v) => (typeof v === "string" ? { modelo: v } : { ...(v || {}) });
  const vehTxt = (v) => { const x = asVeh(v); return [x.modelo, x.matricula ? normMat(x.matricula) : null].filter(Boolean).join(" · "); };
  const vehDeBC = (p) => ({ modelo: p.descripcion || "(sin descripción)", matricula: p.serie || "", bastidor: p.alias && normMat(p.alias) !== normMat(p.descripcion) ? p.alias : "", bc_ps: p.no });
  const mismoVeh = (a, b) => { const x = asVeh(a), y = asVeh(b); if (x.bc_ps && y.bc_ps) return x.bc_ps === y.bc_ps; const mx = normMat(x.matricula), my = normMat(y.matricula); if (mx || my) return mx === my; return String(x.modelo || "").trim().toLowerCase() === String(y.modelo || "").trim().toLowerCase(); };
  async function enviarABC(clienteId, forzar, accion) {
    const { data, error } = await sb().functions.invoke("crm-alta-bc", { body: { cliente_id: clienteId, forzar: !!forzar, accion } });
    let res = data;
    if (error) { try { res = error.context && (await error.context.json()); } catch (e) {} if (!res) res = { error: error.message }; }
    return res || { error: "Sin respuesta" };
  }

  // Avisos por tiempo (umbrales validados el 07/11/2026).
  function aviso(c) {
    const e = c.estado, hEst = horas(c.estado_at || c.created_at);
    if (e === "pendiente_respuesta" && horas(c.created_at) > 24) return { t: `Sin responder ${Math.floor(horas(c.created_at))} h`, c: "rojo" };
    if (e === "presupuesto_por_hacer" && hEst > 72) return { t: `Presupuesto sin hacer ${Math.floor(hEst / 24)} d`, c: "rojo" };
    if (e === "presupuesto_enviado" && hEst > 168) return { t: `Enviado · ${Math.floor(hEst / 24)} d sin respuesta`, c: "rojo" };
    if (e === "senal_solicitada" && hEst > 120) return { t: `Señal pedida hace ${Math.floor(hEst / 24)} d`, c: "rojo" };
    if (e && e.startsWith("garantia_") && horas(c.garantia_ultimo_contacto || c.estado_at) > 168) return { t: "Fabricante: +7 d sin contacto", c: "rojo" };
    if (e === "trabajo_terminado") return mismoDia(new Date(c.estado_at || c.created_at), new Date()) ? { t: "Avisar hoy al cliente", c: "ambar" } : { t: "Terminado · sin avisar", c: "rojo" };
    return null;
  }
  function vence(c) {
    if (!c.fecha_limite || est(c.estado).fin) return null;
    const d = new Date(c.fecha_limite), now = new Date();
    if (d < now && !mismoDia(d, now)) return { t: `VENCIDO ${Math.max(1, Math.floor((now - d) / 864e5))} d`, c: "rojo", ord: 0 };
    if (mismoDia(d, now)) return { t: d < now ? `Hoy ${pad(d.getHours())}:${pad(d.getMinutes())} · vencido` : `Hoy ${pad(d.getHours())}:${pad(d.getMinutes())}`, c: d < now ? "rojo" : "ambar", ord: 1 };
    const dias = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
    return { t: `${dias[d.getDay()]} ${fFecha(d.toISOString())}`, c: "gris", ord: 2 };
  }

  // ---------- piezas visuales ----------
  const Chip = ({ c = "gris", children, title, style }) => { const k = CH[c] || CH.gris; return h("span", { title, style: { display: "inline-block", fontWeight: 700, fontSize: "11.5px", borderRadius: "7px", padding: "2px 8px", border: `1px solid ${k.bd}`, background: k.bg, color: k.fg, whiteSpace: "nowrap", lineHeight: 1.45, ...style } }, children); };
  const btn = (T, kind) => {
    const base = { cursor: "pointer", borderRadius: "10px", fontFamily: "inherit", fontWeight: 700, fontSize: "13px", padding: "8px 14px", border: `1px solid ${T.border}`, background: T.surface, color: T.ink, lineHeight: 1.3 };
    if (kind === "p") return { ...base, background: T.rust, borderColor: T.rust, color: "#fff", fontWeight: 800 };
    if (kind === "wa") return { ...base, background: "#15803D", borderColor: "#15803D", color: "#fff", fontWeight: 800 };
    if (kind === "s") return { ...base, padding: "5px 10px", fontSize: "12.5px" };
    return base;
  };
  const inp = (T) => ({ width: "100%", boxSizing: "border-box", border: `1px solid ${T.borderHi}`, borderRadius: "10px", padding: "9px 11px", fontFamily: "inherit", fontSize: "14px", color: T.ink, background: T.surface });
  const Lbl = ({ T, children }) => h("div", { style: { fontSize: "11px", letterSpacing: ".08em", textTransform: "uppercase", color: T.inkSoft, fontWeight: 800, marginBottom: "8px" } }, children);
  const Box = ({ T, children, tone }) => h("div", { style: { border: `1px solid ${tone ? CH[tone].bd : T.border}`, borderRadius: "12px", padding: "14px", background: T.surface } }, children);
  const Row = ({ T, k, children }) => h("div", { style: { display: "flex", justifyContent: "space-between", gap: "12px", fontSize: "13.5px", padding: "3px 0", alignItems: "center" } }, h("span", { style: { color: T.inkSoft } }, k), h("span", { style: { textAlign: "right" } }, children));
  const Field = ({ T, label, children, style }) => h("label", { style: { display: "block", ...style } }, h("span", { style: { display: "block", fontSize: "12px", fontWeight: 800, color: T.inkSoft, marginBottom: "5px" } }, label), children);
  const Seg = ({ T, opts, value, onChange }) => h("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px" } }, opts.map(([k, l]) => h("button", { key: k, type: "button", onClick: () => onChange(k),
    style: { cursor: "pointer", borderRadius: "9px", fontFamily: "inherit", fontWeight: 700, fontSize: "13px", padding: "7px 12px", border: `1px solid ${value === k ? T.ink : T.borderHi}`, background: value === k ? T.ink : T.surface, color: value === k ? T.bg : T.ink } }, l)));
  const Drawer = ({ T, onClose, width = 580, children, label }) => h("div", { role: "dialog", "aria-label": label, style: { position: "fixed", inset: 0, zIndex: 1200, display: "flex", justifyContent: "flex-end" } },
    h("div", { onClick: onClose, style: { position: "absolute", inset: 0, background: "rgba(15,27,46,.35)" } }),
    h("div", { style: { position: "relative", width: `min(${width}px, 100vw)`, height: "100%", overflowY: "auto", background: T.bg, borderLeft: `1px solid ${T.border}`, boxShadow: "-10px 0 30px rgba(0,0,0,.15)" } }, children));

  // ---------- historial ----------
  function textoEvento(ev) {
    const d = ev.detalle || {};
    if (/^g_/.test(ev.tipo) && window.AcllarGarantias) return "Expediente de garantía · " + window.AcllarGarantias._test.textoEventoG(ev);
    if (ev.tipo === "creado") return ev.caso_id ? `Caso creado · ${lbl(CANALES, d.canal)} · ${lbl(TIPOS, d.tipo)}` : "Cliente creado en el CRM";
    if (ev.tipo === "bitacora") return `${lbl(CLASES, (ev.detalle || {}).clase)}: “${ev.texto}”`;
    if (ev.tipo === "nota") return `Nota: “${ev.texto}”`;
    if (ev.tipo === "llamada") return `Llamada: “${ev.texto}”`;
    if (ev.tipo === "mensaje") return `Mensaje: “${ev.texto}”`;
    if (ev.texto) return ev.texto;
    const partes = Object.keys(d).map((k) => {
      const v = d[k] || {};
      if (k === "estado") return `Estado: ${est(v.de).l} → ${est(v.a).l}`;
      if (k === "tipo_cliente") return `Tipo de cliente: ${v.de ? lbl(TIPOS_CLI, v.de) : "—"} → ${v.a ? lbl(TIPOS_CLI, v.a) : "—"}`;
      if (k === "vehiculos") {
        const de = (Array.isArray(v.de) ? v.de : []).map(asVeh), a = (Array.isArray(v.a) ? v.a : []).map(asVeh);
        const add = a.filter((x) => !de.some((y) => mismoVeh(x, y))), del = de.filter((x) => !a.some((y) => mismoVeh(x, y)));
        const bc = a.filter((x) => x.bc_ps && de.some((y) => mismoVeh(x, y) && !y.bc_ps));
        return [add.length ? "Vehículo añadido: " + add.map(vehTxt).join(", ") : "", del.length ? "Vehículo quitado de la ficha: " + del.map(vehTxt).join(", ") : "", bc.length ? "Vehículo en BC: " + bc.map((x) => `${vehTxt(x)} (${x.bc_ps})`).join(", ") : ""].filter(Boolean).join(" · ") || "Vehículos actualizados";
      }
      const f = (x) => (x == null || x === "" ? "—" : k === "tipo" ? lbl(TIPOS, x) : k === "canal" ? lbl(CANALES, x) : typeof x === "boolean" ? (x ? "sí" : "no") : /_at$|fecha_limite/.test(k) ? fFechaHora(x) : Array.isArray(x) ? x.join(", ") : String(x));
      return `${CAMPOS[k] || k}: ${f(v.de)} → ${f(v.a)}`;
    });
    return partes.join(" · ") || ev.tipo;
  }
  const quien = (email) => { const e = String(email || ""); if (!e || e === "sistema") return "Sistema"; const r = RESPONSABLES.find((x) => e.startsWith(sinAcentos(x).toLowerCase())); return r || e.split("@")[0]; };
  const Historial = ({ T, eventos }) => h("ol", { style: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "9px", fontSize: "13px" } },
    eventos.length ? eventos.map((ev) => h("li", { key: ev.id, style: { display: "grid", gridTemplateColumns: "84px 1fr", gap: "8px" } },
      h("span", { style: { color: T.inkSoft } }, fFechaHora(ev.at)), h("span", null, h("b", null, quien(ev.autor)), " · ", textoEvento(ev))))
      : h("li", { style: { color: T.inkFaint } }, "Sin movimientos todavía."));

  // ---------- bitácora (Casos y Garantías) ----------
  // Se guarda en crm_eventos (tipo "bitacora"), que no se puede editar ni borrar.
  // Un expediente de garantía ligado a un caso comparte la bitácora con él.
  function Bitacora({ T, caso_id, garantia_id, cliente_id, titulo, recargar }) {
    const [lista, setLista] = useState(null); const [txt, setTxt] = useState(""); const [clase, setClase] = useState("respondi");
    const [msg, setMsg] = useState(""); const [guardando, setGuardando] = useState(false);
    const cargar = async () => {
      const f = [caso_id && `caso_id.eq.${caso_id}`, garantia_id && `garantia_id.eq.${garantia_id}`].filter(Boolean).join(",");
      if (!f) { setLista([]); return; }
      const { data } = await sb().from("crm_eventos").select("*").or(f).in("tipo", BITACORA).order("at", { ascending: true }).limit(1000);
      setLista(data || []);
    };
    useEffect(() => { cargar(); }, [caso_id, garantia_id, recargar]);
    const add = async () => {
      if (!txt.trim()) return;
      setGuardando(true); setMsg("");
      const { error } = await sb().from("crm_eventos").insert({ tipo: "bitacora", detalle: { clase }, texto: txt.trim(), caso_id: caso_id || null, garantia_id: garantia_id || null, cliente_id: cliente_id || null });
      setGuardando(false);
      if (error) { setMsg("No se pudo guardar: " + error.message); return; }
      setTxt(""); cargar();
    };
    const I = inp(T);
    return h(Box, { T, tone: "azul" }, h(Lbl, { T }, titulo || "Bitácora del caso"),
      h("div", { style: { fontSize: "12px", color: T.inkSoft, marginTop: "-4px", marginBottom: "10px" } }, "Lo que vas haciendo con el cliente o el fabricante. Se guarda con fecha, hora y autor y no se puede modificar."),
      lista == null ? h("div", { style: { fontSize: "13px", color: T.inkFaint } }, "Cargando…")
        : lista.length ? h("ol", { "data-bitacora": "1", style: { listStyle: "none", margin: "0 0 12px", padding: 0, display: "flex", flexDirection: "column", gap: "8px" } },
          lista.map((e) => { const cl = e.tipo === "bitacora" ? (e.detalle || {}).clase : e.tipo === "mensaje" ? "respondi" : e.tipo;
            return h("li", { key: e.id, style: { borderLeft: `3px solid ${CH.azul.bd}`, paddingLeft: "10px" } },
              h("div", { style: { fontSize: "11.5px", color: T.inkSoft } }, fLarga(e.at), " · ", h("b", null, quien(e.autor)), e.garantia_id && caso_id && !garantia_id ? " · desde Garantías" : ""),
              h("div", { style: { fontSize: "13.5px", whiteSpace: "pre-wrap" } }, h(Chip, { c: cl === "respondio" ? "verde" : cl === "fabricante" ? "violeta" : cl === "pedi" ? "ambar" : "azul", style: { marginRight: "6px" } }, lbl(CLASES, cl) || "Nota"), e.texto)); }))
        : h("div", { style: { fontSize: "13px", color: T.inkFaint, marginBottom: "10px" } }, "Todavía no hay anotaciones."),
      h("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "6px" } }, CLASES.map(([k, l]) => h("button", { key: k, type: "button", "data-bit-clase": k, onClick: () => setClase(k), style: { ...btn(T, "s"), background: clase === k ? T.ink : T.surface, color: clase === k ? T.bg : T.ink } }, l))),
      h("textarea", { rows: 2, "data-bit-texto": "1", value: txt, onChange: (e) => setTxt(e.target.value), onKeyDown: (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) add(); }, placeholder: clase === "respondi" ? "Qué le respondiste…" : clase === "pedi" ? "Qué le pediste…" : clase === "respondio" ? "Qué te respondió…" : clase === "fabricante" ? "Qué hablaste o te respondió el fabricante…" : "Escribe aquí…", style: { ...I, resize: "vertical" } }),
      h("div", { style: { display: "flex", gap: "8px", alignItems: "center", marginTop: "6px" } }, h("button", { "data-bit-add": "1", onClick: add, disabled: guardando || !txt.trim(), style: btn(T, "p") }, guardando ? "Guardando…" : "Anotar"), h("span", { style: { fontSize: "11.5px", color: T.inkFaint } }, "Ctrl + Intro también anota"),
        msg ? h("span", { style: { fontSize: "12.5px", color: T.danger } }, msg) : null));
  }
  // Teléfono para wa.me (añade 34 a los móviles españoles de 9 cifras)
  const telWa = (t) => { const d = String(t || "").replace(/\D/g, ""); if (!d) return ""; return d.length === 9 && /^[6789]/.test(d) ? "34" + d : d.replace(/^00/, ""); };
  // Saltar entre pestañas de TALLER
  const irA = (tab, claves) => { try { Object.keys(claves || {}).forEach((k) => localStorage.setItem(k, claves[k])); } catch (e) {} window.dispatchEvent(new CustomEvent("acllar-taller-tab", { detail: tab })); };
  const abrirExpediente = (id) => irA("garantias", { acllar_garantia_abrir: id });
  // Fabricante probable a partir del modelo (se puede cambiar en el expediente)
  const fabDeModelo = (m) => { const x = String(m || "").toLowerCase(); if (/benimar|tessoro|mileo|amphitryon|benivan|sport \d/.test(x)) return "Benimar"; if (/roller|kronos|zefiro|pegaso|livingstone|granduca/.test(x)) return "Roller Team"; return null; };
  // Un caso de garantía pasa a la pestaña Garantías: se crea su expediente y el caso queda "En Garantías".
  async function pasarAGarantias(caso) {
    if (!window.AcllarGarantiasCrear) throw new Error("La pestaña Garantías no está cargada. Recarga la página.");
    const ya = await sb().from("garantias").select("id").eq("caso_id", caso.id).limit(1);
    let gid = ya.data && ya.data[0] && ya.data[0].id;
    if (!gid) {
      const vs = ((caso.cliente && caso.cliente.vehiculos) || []).map(asVeh);
      const v = vs.find((x) => vehTxt(x) === caso.vehiculo) || { modelo: caso.vehiculo || "" };
      const g = await window.AcllarGarantiasCrear({ tipo: "garantia", origen: "cliente", cliente: caso.cliente, vehiculo: { modelo: v.modelo || "", matricula: v.matricula || "", bastidor: v.bastidor || "", bc_ps: v.bc_ps || null },
        fabricante: fabDeModelo(v.modelo), descripcion: caso.consulta || "", caso_id: caso.id });
      gid = g.id;
    }
    const up = await sb().from("crm_casos").update({ estado: "en_garantias", tipo: "garantia", rama: "garantia" }).eq("id", caso.id).select("*, cliente:crm_clientes(*)").single();
    if (up.error) throw up.error;
    return { gid, caso: up.data };
  }
  const ChipCli = ({ c }) => (c && c.tipo_cliente ? h(Chip, { c: c.tipo_cliente === "propio" ? "verde" : "gris", style: { marginLeft: "6px" } }, c.tipo_cliente === "propio" ? "Propio" : "Externo") : null);

  // =====================================================================
  // Vista principal
  // =====================================================================
  function CRMView({ T, F }) {
    const [vista, setVista] = useState(() => { try { return localStorage.getItem("acllar_crm_vista") || "metoca"; } catch (e) { return "metoca"; } });
    const [casos, setCasos] = useState([]);
    const [bcServ, setBcServ] = useState([]);
    const [sync, setSync] = useState(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState("");
    const [casoId, setCasoId] = useState(() => { try { const x = localStorage.getItem("acllar_crm_abrir_caso"); if (x) localStorage.removeItem("acllar_crm_abrir_caso"); return x || null; } catch (e) { return null; } });
    const [clienteId, setClienteId] = useState(() => { try { const x = localStorage.getItem("acllar_crm_abrir_cliente"); if (x) localStorage.removeItem("acllar_crm_abrir_cliente"); return x || null; } catch (e) { return null; } });
    const [nueva, setNueva] = useState(null); // null | {} | { bc } | { cliente }
    const [filtroTodos, setFiltroTodos] = useState("abiertos");
    const rol = window.acllarCloud && window.acllarCloud.rol ? window.acllarCloud.rol() : null;
    const sinAcceso = rol && rol !== "admin" && rol !== "comercial";

    const cambiarVista = (v) => { setVista(v); try { localStorage.setItem("acllar_crm_vista", v); } catch (e) {} };
    const cargar = async () => {
      if (!sb() || sinAcceso) { setCargando(false); return; }
      try {
        const [a, b, s] = await Promise.all([
          sb().from("crm_casos").select("*, cliente:crm_clientes(*)").eq("archivado", false).order("created_at", { ascending: false }).limit(2000),
          sb().from("bc_servicio").select("*").limit(5000),
          sb().from("bc_sync_estado").select("clave,ultimo_ok,ultimo_error"),
        ]);
        if (a.error) throw a.error;
        setCasos(a.data || []); setBcServ(b.data || []); setSync(s.data || []); setError("");
      } catch (e) { setError("No se pudieron cargar los casos: " + (e.message || e)); }
      setCargando(false);
    };
    useEffect(() => { cargar(); const t = setInterval(cargar, 60000); return () => clearInterval(t); }, []);
    const [sincronizando, setSincronizando] = useState(false);
    const syncAhora = async () => { setSincronizando(true); try { await enviarABC(null, false, "sync"); } catch (e) {} await cargar(); setSincronizando(false); };
    const actualizarCaso = (c) => setCasos((xs) => { const i = xs.findIndex((x) => x.id === c.id); if (i < 0) return [c, ...xs]; const n = xs.slice(); n[i] = c; return n; });

    if (sinAcceso) return h("div", { style: { background: T.surface, border: `1px dashed ${T.border}`, borderRadius: "14px", padding: "36px", textAlign: "center", color: T.inkSoft, fontSize: "14px" } },
      h("div", { style: { fontWeight: 800, fontSize: "18px", color: T.ink, marginBottom: "6px" } }, "Casos de taller"), "Tu cuenta no tiene acceso a los casos de taller. Pídeselo a Sebastián.");

    const abiertos = casos.filter((c) => !est(c.estado).fin);
    const me = yo();
    const ordVence = (a, b) => { const x = a.fecha_limite ? new Date(a.fecha_limite).getTime() : Infinity, y = b.fecha_limite ? new Date(b.fecha_limite).getTime() : Infinity; return x - y; };
    const listas = {
      bandeja: casos.filter((c) => c.estado === "pendiente_respuesta").sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
      metoca: abiertos.filter((c) => !me || c.responsable === me || !c.responsable).sort(ordVence),
      todos: (filtroTodos === "abiertos" ? abiertos : filtroTodos === "garantias" ? casos.filter((c) => c.estado === "en_garantias") : filtroTodos === "cerrados" ? casos.filter((c) => est(c.estado).fin && !est(c.estado).gar) : casos).slice().sort(ordVence),
    };
    const nVencidos = abiertos.filter((c) => { const v = vence(c); return v && v.c === "rojo"; }).length;
    const nAvisos = abiertos.filter((c) => aviso(c)).length;
    const ultSync = (sync || []).map((s) => s.ultimo_ok).filter(Boolean).sort().pop();
    const errSync = (sync || []).find((s) => s.ultimo_error);
    const casoAbierto = casoId && casos.find((c) => c.id === casoId);
    // Documentos de BC ya vinculados a algún caso, y propuesta automática de oferta/pedido para cada caso.
    const vinculados = new Set(casos.flatMap((c) => [c.oferta_bc && "oferta:" + norm(c.oferta_bc), c.pedido_bc && "pedido:" + norm(c.pedido_bc)].filter(Boolean)));
    const sugerencia = (c) => {
      const bcNo = c.cliente && c.cliente.bc_no; if (!bcNo || est(c.estado).fin) return null;
      const desde = String(c.created_at || "").slice(0, 10);
      const libres = (tipo) => bcServ.filter((x) => x.tipo === tipo && x.activo && x.cliente_no === bcNo && !vinculados.has(tipo + ":" + norm(x.no)) && (!x.fecha_pedido || x.fecha_pedido >= desde));
      if (!c.oferta_bc && !c.pedido_bc && c.estado === "presupuesto_por_hacer") { const o = libres("oferta"); if (o.length) return { tipo: "oferta", doc: o[0] }; }
      if (!c.pedido_bc && (c.oferta_bc || c.garantia_resultado === "parcial")) { const pe = libres("pedido"); if (pe.length) return { tipo: "pedido", doc: pe[0] }; }
      return null;
    };

    const tabBtn = (id, label, n, tone) => h("button", { key: id, onClick: () => cambiarVista(id), style: { cursor: "pointer", border: "none", background: "transparent", fontFamily: "inherit", color: vista === id ? T.ink : T.inkSoft, fontWeight: vista === id ? 800 : 700, fontSize: "14px", padding: "10px 14px", borderBottom: `3px solid ${vista === id ? T.rust : "transparent"}`, marginBottom: "-2px", display: "flex", alignItems: "center", gap: "6px" } },
      label, n != null ? h(Chip, { c: tone || "gris" }, n) : null);

    return h("div", { "data-crm": "1", style: { fontFamily: F.body, color: T.ink, display: "flex", flexDirection: "column", gap: "16px" } },
      h("div", { style: { display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center" } },
        h(Buscador, { T, onCliente: (id) => setClienteId(id), onBC: (bc) => setNueva({ bc }) }),
        h("button", { "data-crm-nueva": "1", onClick: () => setNueva({}), style: { ...btn(T, "p"), height: "46px", padding: "0 20px", fontSize: "15px" } }, "+ Nueva consulta")),
      h("div", { style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px", borderBottom: `2px solid ${T.border}` } },
        tabBtn("bandeja", "Bandeja", listas.bandeja.length, listas.bandeja.length ? "ambar" : "gris"),
        tabBtn("metoca", me ? "Mis tareas" : "Pendientes", listas.metoca.length, "azul"),
        tabBtn("tablero", "Tablero", null),
        tabBtn("todos", "Todos", null),
        h("div", { style: { marginLeft: "auto", display: "flex", gap: "8px", alignItems: "center", paddingBottom: "8px", flexWrap: "wrap" } },
          nVencidos ? h(Chip, { c: "rojo" }, `${nVencidos} vencido${nVencidos > 1 ? "s" : ""}`) : null,
          nAvisos ? h(Chip, { c: "ambar" }, `${nAvisos} aviso${nAvisos > 1 ? "s" : ""}`) : null,
          h("span", { title: errSync ? errSync.ultimo_error : "", style: { fontSize: "12px", color: errSync ? T.danger : T.inkFaint } }, errSync ? "⚠ Error al sincronizar con BC" : ultSync ? `BC sincronizado ${fFechaHora(ultSync)}` : ""),
          h("button", { "data-crm-sync": "1", onClick: syncAhora, disabled: sincronizando, title: "Traer ya los cambios de BC sin esperar a los 10 minutos", style: btn(T, "s") }, sincronizando ? "Actualizando…" : "↻ Actualizar desde BC"))),
      error ? h("div", { style: { color: T.danger, fontSize: "13px" } }, error) : null,
      cargando ? h("div", { style: { color: T.inkFaint, fontSize: "13px" } }, "Cargando…")
        : vista === "tablero" ? h(Tablero, { T, casos: abiertos, onOpen: setCasoId })
        : h(React.Fragment, null,
          vista === "todos" ? h("div", null, h(Seg, { T, opts: [["abiertos", "Abiertos"], ["garantias", "En Garantías"], ["cerrados", "Cerrados"], ["todos", "Todos"]], value: filtroTodos, onChange: setFiltroTodos })) : null,
          h(Lista, { T, F, casos: listas[vista] || [], bcServ, sugerencia, onOpen: setCasoId, vacio: vista === "bandeja" ? "No hay consultas sin responder." : "Nada pendiente. Todo al día." })),
      casoAbierto ? h(CasoPanel, { T, F, caso: casoAbierto, bcServ, vinculados, sugerencia: sugerencia(casoAbierto), syncAhora, sincronizando, onRefresh: cargar, onClose: () => setCasoId(null), onSaved: actualizarCaso, onCliente: (id) => { setCasoId(null); setClienteId(id); } }) : null,
      clienteId ? h(ClientePanel, { T, F, id: clienteId, casos, bcServ, onClose: () => setClienteId(null), onCaso: (id) => { setClienteId(null); setCasoId(id); }, onNueva: (cliente) => { setClienteId(null); setNueva({ cliente }); }, onChanged: cargar }) : null,
      nueva ? h(NuevaConsulta, { T, F, inicial: nueva, onClose: () => setNueva(null), onCreated: (c, gid) => { setNueva(null); actualizarCaso(c); if (gid) abrirExpediente(gid); else setCasoId(c.id); } }) : null);
  }

  // ---------- buscador único (CRM + BC) ----------
  async function buscarClientes(q) {
    const s = qSafe(q); if (s.length < 2) return [];
    const dig = s.replace(/\D/g, "");
    const pat = `%${s}%`;
    const orCrm = [`nombre.ilike.${pat}`, `apellidos.ilike.${pat}`, `email.ilike.${pat}`, `nif.ilike.${pat}`, `bc_no.ilike.${pat}`];
    const orBc = [`nombre.ilike.${pat}`, `email.ilike.${pat}`, `nif.ilike.${pat}`, `no.ilike.${pat}`];
    if (dig.length >= 3) { orCrm.push(`telefono.ilike.%${dig}%`); orBc.push(`telefono.ilike.%${dig}%`); }
    const [a, b] = await Promise.all([
      sb().from("crm_clientes").select("*").or(orCrm.join(",")).limit(10),
      sb().from("bc_clientes").select("no,nombre,telefono,email,direccion,cp,ciudad,provincia,nif").or(orBc.join(",")).limit(12),
    ]);
    let crmRows = a.data || [], bcRows = b.data || [];
    const vehDe = {};
    const mat = normMat(s);
    if (mat.length >= 4 && /\d/.test(mat) && /[A-Z]/.test(mat)) {
      const ps = await sb().from("bc_productos_servicio").select("no,descripcion,serie,cliente_no").ilike("serie_norm", `%${mat}%`).eq("activo", true).limit(8);
      const nos = [...new Set((ps.data || []).map((x) => x.cliente_no).filter(Boolean))];
      (ps.data || []).forEach((x) => { if (x.cliente_no) vehDe[x.cliente_no] = `${x.descripcion || ""} · ${x.serie || ""}`; });
      if (nos.length) {
        const [c2, b2] = await Promise.all([sb().from("crm_clientes").select("*").in("bc_no", nos), sb().from("bc_clientes").select("no,nombre,telefono,email,direccion,cp,ciudad,provincia,nif").in("no", nos)]);
        crmRows = [...crmRows, ...(c2.data || []).filter((x) => !crmRows.some((y) => y.id === x.id))];
        bcRows = [...bcRows, ...(b2.data || []).filter((x) => !bcRows.some((y) => y.no === x.no))];
      }
    }
    const crm = crmRows.map((c) => ({ k: "crm:" + c.id, tipo: "crm", c, veh: c.bc_no && vehDe[c.bc_no] }));
    const ya = new Set(crmRows.map((c) => c.bc_no).filter(Boolean));
    const bc = bcRows.filter((x) => !ya.has(x.no)).map((x) => ({ k: "bc:" + x.no, tipo: "bc", bc: x, veh: vehDe[x.no] }));
    return [...crm, ...bc];
  }
  const ResultadoCliente = ({ T, r, onPick, cta }) => {
    const nom = r.tipo === "crm" ? nombreCli(r.c) : r.bc.nombre;
    const tel = r.tipo === "crm" ? r.c.telefono : r.bc.telefono;
    const ciu = r.tipo === "crm" ? r.c.ciudad : r.bc.ciudad;
    const no = r.tipo === "crm" ? r.c.bc_no : r.bc.no;
    return h("button", { type: "button", onClick: () => onPick(r), style: { display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", gap: "10px", padding: "9px 12px", border: "none", borderTop: `1px solid ${T.border}`, background: T.surface, cursor: "pointer", textAlign: "left", fontFamily: "inherit", color: T.ink } },
      h("span", null, h("b", null, nom || "(sin nombre)"), " ", no ? h("span", { style: { fontFamily: "'JetBrains Mono', monospace", fontSize: "12px", color: T.inkSoft } }, no) : h(Chip, { c: "ambar" }, "sin alta en BC"),
        h("div", { style: { fontSize: "12px", color: T.inkSoft } }, [tel, ciu].filter(Boolean).join(" · ") || "—"),
        r.veh ? h("div", { style: { fontSize: "12px", color: T.rust, fontWeight: 700 } }, "Vehículo: " + r.veh) : null),
      h("span", { style: { fontSize: "12px", fontWeight: 800, color: T.rust, whiteSpace: "nowrap" } }, cta));
  };
  function Buscador({ T, onCliente, onBC }) {
    const [q, setQ] = useState(""); const [res, setRes] = useState([]); const [abierto, setAbierto] = useState(false);
    const t = useRef(null);
    useEffect(() => { clearTimeout(t.current); if (qSafe(q).length < 2) { setRes([]); return; } t.current = setTimeout(async () => { try { setRes(await buscarClientes(q)); setAbierto(true); } catch (e) {} }, 300); }, [q]);
    return h("div", { style: { position: "relative", flex: "1 1 420px" } },
      h("input", { type: "search", "data-crm-buscar": "1", "aria-label": "Buscar cliente", value: q, onChange: (e) => setQ(e.target.value), onFocus: () => setAbierto(true), onBlur: () => setTimeout(() => setAbierto(false), 200),
        placeholder: "Buscar cliente por nombre, teléfono, email, NIF, matrícula o nº de BC", style: { ...inp(T), height: "46px", borderRadius: "12px", paddingLeft: "14px" } }),
      abierto && res.length ? h("div", { style: { position: "absolute", top: "50px", left: 0, right: 0, zIndex: 60, background: T.surface, border: `1px solid ${T.border}`, borderRadius: "12px", boxShadow: "0 12px 30px rgba(0,0,0,.14)", overflow: "hidden", maxHeight: "420px", overflowY: "auto" } },
        res.map((r) => h(ResultadoCliente, { key: r.k, T, r, cta: r.tipo === "crm" ? "Abrir ficha" : "Nueva consulta", onPick: (x) => { setAbierto(false); setQ(""); x.tipo === "crm" ? onCliente(x.c.id) : onBC(x.bc); } })))
        : abierto && qSafe(q).length >= 2 ? h("div", { style: { position: "absolute", top: "50px", left: 0, right: 0, zIndex: 60, background: T.surface, border: `1px solid ${T.border}`, borderRadius: "12px", padding: "12px", fontSize: "13px", color: T.inkSoft } }, "Sin coincidencias. Usa “+ Nueva consulta” para darlo de alta.") : null);
  }

  // ---------- lista ----------
  function Lista({ T, casos, bcServ, sugerencia, onOpen, vacio }) {
    if (!casos.length) return h("div", { style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: "14px", padding: "28px", textAlign: "center", color: T.inkSoft, fontSize: "14px" } }, vacio);
    const th = { fontSize: "11px", letterSpacing: ".08em", textTransform: "uppercase", color: T.inkSoft, fontWeight: 700, padding: "10px 12px", textAlign: "left", borderBottom: `1.5px solid ${T.border}` };
    const td = { padding: "11px 12px", borderBottom: `1px solid ${T.border}`, verticalAlign: "top", fontSize: "13.5px" };
    return h("div", { style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: "14px", overflowX: "auto" } },
      h("table", { style: { width: "100%", borderCollapse: "collapse", minWidth: "940px" } },
        h("thead", null, h("tr", null, ["Vence", "Cliente · vehículo", "Tipo", "Estado", "Próxima acción", "Business Central"].map((x) => h("th", { key: x, style: th }, x)))),
        h("tbody", null, casos.map((c) => {
          const v = vence(c), av = aviso(c), s = est(c.estado);
          const doc = docBC(bcServ, c);
          return h("tr", { key: c.id, "data-crm-caso": c.id, onClick: () => onOpen(c.id), style: { cursor: "pointer", background: v && v.c === "rojo" ? "rgba(220,38,38,.04)" : "transparent" } },
            h("td", { style: td }, v ? h(Chip, { c: v.c }, v.t) : h("span", { style: { color: T.inkFaint } }, "—")),
            h("td", { style: td }, h("b", null, nombreCli(c.cliente)), h(ChipCli, { c: c.cliente }), h("div", { style: { color: T.inkSoft, fontSize: "12.5px" } }, c.vehiculo || "—")),
            h("td", { style: td }, lbl(TIPOS, c.tipo)),
            h("td", { style: td }, h(Chip, { c: s.c }, s.l), av ? h("div", { style: { marginTop: "4px" } }, h(Chip, { c: av.c }, av.t)) : null),
            h("td", { style: td }, c.proxima_accion || h("span", { style: { color: T.inkFaint } }, "—"), h("div", { style: { color: T.inkSoft, fontSize: "12px" } }, c.responsable || "")),
            h("td", { style: td }, doc ? h(React.Fragment, null, h("span", { style: { fontFamily: "'JetBrains Mono', monospace", fontSize: "12px" } }, doc.no), h("div", { style: { color: T.inkSoft, fontSize: "12px" } }, `${doc.tipo === "oferta" ? "Oferta" : "Pedido"} · ${eur(doc.importe_iva)}`))
              : c.garantia_100 ? h("span", { style: { color: T.inkSoft, fontSize: "12.5px" } }, "100 % garantía") : h("span", { style: { color: T.inkFaint } }, "—"),
              sugerencia && sugerencia(c) ? h("div", { style: { marginTop: "4px" } }, h(Chip, { c: "azul" }, `${sugerencia(c).tipo === "oferta" ? "Oferta" : "Pedido"} en BC para vincular`)) : null));
        }))));
  }
  const docBC = (bcServ, c) => {
    const p = c.pedido_bc && bcServ.find((x) => x.tipo === "pedido" && norm(x.no) === norm(c.pedido_bc));
    const o = c.oferta_bc && bcServ.find((x) => x.tipo === "oferta" && norm(x.no) === norm(c.oferta_bc));
    return p || o || (c.pedido_bc ? { tipo: "pedido", no: c.pedido_bc } : c.oferta_bc ? { tipo: "oferta", no: c.oferta_bc } : null);
  };

  // ---------- tablero ----------
  function Tablero({ T, casos, onOpen }) {
    return h("div", { style: { overflowX: "auto" } }, h("div", { style: { display: "grid", gridTemplateColumns: "repeat(6, minmax(180px, 1fr))", gap: "12px", minWidth: "1100px" } },
      FASES.map(([f, nombre]) => {
        const xs = casos.filter((c) => est(c.estado).f === f);
        return h("section", { key: f, style: { background: T.bgAlt, borderRadius: "14px", padding: "10px", display: "flex", flexDirection: "column", gap: "8px", minHeight: "200px" } },
          h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12px", letterSpacing: ".08em", textTransform: "uppercase", fontWeight: 800, color: T.inkSoft, padding: "4px 2px" } }, h("span", null, nombre), h(Chip, null, xs.length)),
          xs.map((c) => { const av = aviso(c), v = vence(c), s = est(c.estado); return h("button", { key: c.id, onClick: () => onOpen(c.id), style: { textAlign: "left", cursor: "pointer", fontFamily: "inherit", color: T.ink, background: T.surface, border: `1px solid ${T.border}`, borderRadius: "12px", padding: "11px", display: "flex", flexDirection: "column", gap: "6px" } },
            h("b", null, nombreCli(c.cliente)), h("span", { style: { fontSize: "12px", color: T.inkSoft } }, [c.vehiculo, lbl(TIPOS, c.tipo)].filter(Boolean).join(" · ")),
            h("span", null, h(Chip, { c: s.c }, s.l)), av ? h("span", null, h(Chip, { c: av.c }, av.t)) : v && v.c !== "gris" ? h("span", null, h(Chip, { c: v.c }, v.t)) : null); }));
      })));
  }

  // ---------- ficha del caso ----------
  // Expediente(s) de la pestaña Garantías ligados a este caso
  function ExpedientesCaso({ T, caso, onPasar, pasando }) {
    const [lista, setLista] = useState(null);
    useEffect(() => { let vivo = true; sb().from("garantias").select("id,numero,estado,fabricante,reclamacion_no").eq("caso_id", caso.id).order("created_at").then((r) => { if (vivo) setLista(r.data || []); }); return () => { vivo = false; }; }, [caso.id, caso.updated_at]);
    if (lista == null) return null;
    if (!lista.length && caso.tipo !== "garantia" && caso.estado !== "en_garantias") return null;
    return h(Box, { T, tone: "violeta" }, h(Lbl, { T }, "Garantía"),
      h("div", { "data-crm-expedientes": "1" },
        lista.length ? h(React.Fragment, null,
          h("div", { style: { fontSize: "13px", marginBottom: "8px" } }, "Este caso se gestiona en la pestaña Garantías: análisis, tramitación con el fabricante, piezas, cita y reparación."),
          lista.map((g) => h("button", { key: g.id, onClick: () => abrirExpediente(g.id), style: { ...btn(T, "p"), marginRight: "6px", marginBottom: "6px" } }, `Abrir expediente ${g.numero}${g.fabricante ? " · " + g.fabricante : ""}${g.reclamacion_no ? " · " + g.reclamacion_no : ""} →`)))
          : h(React.Fragment, null, h("div", { style: { fontSize: "13px", marginBottom: "8px" } }, "Es un caso de garantía. Pásalo a Garantías para llevar allí su expediente."),
            h("button", { "data-crm-crear-exp": "1", onClick: onPasar, disabled: pasando, style: { ...btn(T, "p"), width: "100%" } }, pasando ? "Pasando…" : "Pasar a Garantías →"))));
  }
  function CasoPanel({ T, F, caso, bcServ, vinculados, sugerencia, syncAhora, sincronizando, onRefresh, onClose, onSaved, onCliente }) {
    const [altaMsg, setAltaMsg] = useState(null); // null | "trabajando" | { txt, dup }
    const [ev, setEv] = useState([]);
    const [guardando, setGuardando] = useState(false);
    const [msg, setMsg] = useState("");
    const [pend, setPend] = useState(null); // paso que necesita un dato (cita)
    const [citaTmp, setCitaTmp] = useState("");
    const [pasando, setPasando] = useState(false);
    const [cerrando, setCerrando] = useState(false); const [motivo, setMotivo] = useState("");
    const [d, setD] = useState({});
    useEffect(() => { setD({ proxima_accion: caso.proxima_accion || "", responsable: caso.responsable || "", fecha_limite: toLocalInput(caso.fecha_limite), oferta_bc: caso.oferta_bc || "", pedido_bc: caso.pedido_bc || "", senal_importe: caso.senal_importe ?? "",
      garantia_fabricante: caso.garantia_fabricante || "", garantia_reclamacion: caso.garantia_reclamacion || "", garantia_cubre: caso.garantia_cubre || "", garantia_no_cubre: caso.garantia_no_cubre || "", piezas_previstas: caso.piezas_previstas || "", cita_at: toLocalInput(caso.cita_at), vehiculo: caso.vehiculo || "", tipo: caso.tipo || "", canal: caso.canal || "", consulta: caso.consulta || "" }); }, [caso.id, caso.updated_at]);
    const cargarEv = async () => { const { data } = await sb().from("crm_eventos").select("*").eq("caso_id", caso.id).order("at", { ascending: false }).limit(300); setEv((data || []).filter((e) => !BITACORA.includes(e.tipo))); };
    useEffect(() => { cargarEv(); }, [caso.id, caso.updated_at]);

    const guardar = async (patch, texto) => {
      setGuardando(true); setMsg("");
      const p = {}; Object.keys(patch).forEach((k) => { p[k] = patch[k] === NOW ? new Date().toISOString() : patch[k]; });
      const { data, error } = await sb().from("crm_casos").update(p).eq("id", caso.id).select("*, cliente:crm_clientes(*)").single();
      setGuardando(false);
      if (error) { setMsg("No se pudo guardar: " + error.message); return false; }
      onSaved(data); if (texto) setMsg(texto); return true;
    };
    const pasar = async () => {
      setPasando(true); setMsg("");
      try { const r = await pasarAGarantias(caso); onSaved(r.caso); abrirExpediente(r.gid); }
      catch (e) { setMsg("No se pudo pasar a Garantías: " + (e.message || e)); }
      setPasando(false);
    };
    const paso = async (s) => {
      if (s.to === "en_garantias") return pasar();
      if (s.to === "cita_asignada" && !pend) { setPend(s); setCitaTmp(d.cita_at || ""); return; }
      const patch = { estado: s.to, ...(s.set || {}) };
      if (est(s.to).fin) patch.cerrado_at = NOW;
      if (s.to === "cita_asignada") patch.cita_at = fromLocalInput(citaTmp);
      if (await guardar(patch)) setPend(null);
    };
    const guardarDatos = () => {
      const p = {};
      const map = { proxima_accion: (v) => v || null, responsable: (v) => v || null, fecha_limite: fromLocalInput, oferta_bc: (v) => norm(v) || null, pedido_bc: (v) => norm(v) || null, senal_importe: (v) => (v === "" ? null : Number(String(v).replace(",", "."))),
        garantia_fabricante: (v) => v || null, garantia_reclamacion: (v) => v || null, garantia_cubre: (v) => v || null, garantia_no_cubre: (v) => v || null, piezas_previstas: (v) => v || null, cita_at: fromLocalInput, vehiculo: (v) => v || null, tipo: (v) => v || null, canal: (v) => v || null, consulta: (v) => (String(v || "").trim() || null) };
      Object.keys(map).forEach((k) => { const v = map[k](d[k]); const old = caso[k] == null ? null : caso[k]; const same = /_at$|fecha_limite/.test(k) ? (v ? Math.floor(new Date(v).getTime() / 6e4) : null) === (old ? Math.floor(new Date(old).getTime() / 6e4) : null) : String(v ?? "") === String(old ?? ""); if (!same) p[k] = v; });
      if (!Object.keys(p).length) { setMsg("No hay cambios."); return; }
      const aGar = p.tipo === "garantia" && !est(caso.estado).fin;
      guardar(p, aGar ? "Guardado. Pasa el caso a Garantías con el botón de la caja Garantía." : "Guardado.");
    };
    const avisarAna = async () => {
      const cli = nombreCli(caso.cliente), docNo = caso.pedido_bc || caso.oferta_bc || "sin nº BC";
      const txt = `Hola Ana, ha llegado el comprobante de la señal de ${cli} (${docNo})` + (caso.senal_importe ? `: ${eur(caso.senal_importe)}` : "") + (caso.senal_comprobante_at ? `, recibido el ${fFecha(caso.senal_comprobante_at)}` : "") + ".";
      window.open(`https://wa.me/${ANA_TEL}?text=${encodeURIComponent(txt)}`, "_blank", "noopener");
      await guardar({ senal_aviso_at: NOW, ...(caso.estado === "comprobante_recibido" ? { estado: "contabilidad_avisada" } : {}) }, "WhatsApp a Ana abierto y aviso registrado.");
    };
    const cerrar = async () => { if (await guardar({ estado: "cerrado", cerrado_at: NOW, motivo_cierre: motivo.trim() || null })) { setCerrando(false); setMotivo(""); } };
    const reabrir = () => guardar({ estado: "respondida", cerrado_at: null }, "Caso reabierto.");

    const s = est(caso.estado), fi = RECORRIDO.indexOf(s.f);
    const oferta = caso.oferta_bc && bcServ.find((x) => x.tipo === "oferta" && norm(x.no) === norm(caso.oferta_bc));
    const pedido = caso.pedido_bc && bcServ.find((x) => x.tipo === "pedido" && norm(x.no) === norm(caso.pedido_bc));
    const enBC = !!(caso.cliente && caso.cliente.bc_no);
    const propios = new Set([caso.oferta_bc && "oferta:" + norm(caso.oferta_bc), caso.pedido_bc && "pedido:" + norm(caso.pedido_bc)].filter(Boolean));
    const docsCli = enBC ? bcServ.filter((x) => x.cliente_no === caso.cliente.bc_no && x.activo && !propios.has(x.tipo + ":" + norm(x.no)) && !(vinculados && vinculados.has(x.tipo + ":" + norm(x.no)))) : [];
    const docsOtros = docsCli.filter((x) => !(sugerencia && sugerencia.doc.no === x.no && sugerencia.tipo === x.tipo));
    const vincular = (x) => {
      const p = x.tipo === "oferta" ? { oferta_bc: x.no } : { pedido_bc: x.no };
      if (x.tipo === "oferta" && caso.estado === "presupuesto_por_hacer") p.estado = "presupuesto_hecho";
      guardar(p, `${x.tipo === "oferta" ? "Oferta" : "Pedido"} ${x.no} vinculado.` + (p.estado ? " Estado: Presupuesto hecho." : ""));
    };
    const altaDesdeCaso = async () => {
      setAltaMsg("trabajando");
      const res = await enviarABC(caso.cliente_id, false);
      if (res.duplicados) { setAltaMsg({ txt: "En BC ya hay clientes que coinciden. Revísalo en la ficha antes de crear otro.", dup: true }); return; }
      if (res.ok) { setAltaMsg({ txt: `Dado de alta en BC como ${res.bc_no}.` + (res.vehiculos && res.vehiculos.length ? " " + res.vehiculos.join(" · ") : "") }); onRefresh && onRefresh(); return; }
      setAltaMsg({ txt: "No se pudo: " + (res.error || "error"), err: true });
    };
    const verSenal = caso.rama === "A" || /senal|comprobante|contabilidad/.test(caso.estado) || caso.senal_importe != null || caso.senal_comprobante_at;
    const verGar = /^garantia_|cobertura/.test(caso.estado) || !!caso.garantia_resultado; // casos antiguos con el flujo de garantía dentro de Casos
    const set = (k) => (e) => setD((x) => ({ ...x, [k]: e.target.value }));
    const I = inp(T);
    const docBox = (titulo, campo, doc) => h("div", { style: { padding: "6px 0", borderTop: `1px solid ${T.border}` } },
      h(Row, { T, k: titulo }, h("input", { value: d[campo] || "", onChange: set(campo), placeholder: "nº en BC", style: { ...I, width: "150px", padding: "5px 8px", fontFamily: "'JetBrains Mono', monospace", fontSize: "13px", textAlign: "right" } })),
      doc ? h(React.Fragment, null, h(Row, { T, k: "Estado en BC" }, doc.activo ? (doc.estado_lanzamiento && doc.tipo === "pedido" ? `${doc.estado || "—"} · ${doc.estado_lanzamiento}` : doc.estado || "—") : h(Chip, null, "Ya no está en BC (convertido o registrado)")),
        h(Row, { T, k: "Importe" }, `${eur(doc.importe)} · `, h("b", null, `${eur(doc.importe_iva)} IVA incl.`)))
        : caso[campo] ? h("div", { style: { fontSize: "12px", color: T.warn, textAlign: "right" } }, "No encontrado en BC (se sincroniza cada 10 min)") : null);

    return h(Drawer, { T, onClose, label: "Ficha del caso" },
      h("div", { style: { background: T.surface, padding: "18px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", flexDirection: "column", gap: "6px" } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
          h("span", { style: { fontSize: "12px", color: T.inkSoft, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" } }, `Caso · ${lbl(TIPOS, caso.tipo)}${caso.rama && caso.rama !== "garantia" ? " · rama " + caso.rama : ""}`),
          h("button", { onClick: onClose, "aria-label": "Cerrar", style: { border: "none", background: "transparent", cursor: "pointer", fontSize: "22px", color: T.inkSoft, lineHeight: 1 } }, "×")),
        h("div", { style: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "4px" } }, h("button", { onClick: () => onCliente(caso.cliente_id), style: { border: "none", background: "transparent", padding: 0, textAlign: "left", cursor: "pointer", fontFamily: F.display, fontSize: "24px", fontWeight: 800, color: T.ink } }, nombreCli(caso.cliente), " ", h("span", { style: { fontSize: "13px", color: T.rust, fontWeight: 700 } }, "ficha →")), h(ChipCli, { c: caso.cliente })),
        h("div", { style: { fontSize: "13.5px", color: T.inkSoft } }, `${caso.vehiculo || "Sin vehículo"} · entró por ${lbl(CANALES, caso.canal).toLowerCase()} el ${fFecha(caso.created_at)}`),
        caso.consulta ? h("div", { style: { fontSize: "13.5px", background: T.bg, borderRadius: "8px", padding: "8px 10px", marginTop: "4px", whiteSpace: "pre-wrap" } }, caso.consulta) : null),
      h("div", { style: { padding: "16px 20px 40px", display: "flex", flexDirection: "column", gap: "14px" } },
        h(Box, { T }, h(Lbl, { T }, "Recorrido"),
          s.gar ? null : h("div", { style: { display: "grid", gridTemplateColumns: "repeat(6, minmax(0,1fr))", gap: "4px", fontSize: "10.5px", fontWeight: 700, textAlign: "center" } },
            RECORRIDO.map((f, i) => { const done = s.f === "cerrado" || i < fi, cur = i === fi; return h("div", { key: f, style: { borderRadius: "6px", padding: "6px 2px", background: cur ? T.rust : done ? CH.verde.bg : T.bgAlt, color: cur ? "#fff" : done ? CH.verde.fg : T.inkSoft } }, ["Consulta", "Presup.", "Piezas", "Cita", "Taller", "Retirar"][i]); })),
          h("div", { style: { marginTop: "12px", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } }, h("span", { style: { fontSize: "12px", color: T.inkSoft } }, "Estado actual"), h(Chip, { c: s.c, style: { fontSize: "13px" } }, s.l), aviso(caso) ? h(Chip, { c: aviso(caso).c }, aviso(caso).t) : null),
          s.gar ? null : s.fin ? h("div", { style: { marginTop: "10px", display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } }, caso.motivo_cierre ? h("span", { style: { fontSize: "13px", color: T.inkSoft } }, "Motivo: " + caso.motivo_cierre) : null, h("button", { onClick: reabrir, disabled: guardando, style: btn(T) }, "Reabrir caso"))
            : h("div", { style: { marginTop: "10px", display: "flex", flexDirection: "column", gap: "6px" } },
              h("div", { style: { fontSize: "12px", color: T.inkSoft, fontWeight: 700 } }, "Siguiente paso"),
              caso.estado === "comprobante_recibido" ? h("button", { onClick: avisarAna, disabled: guardando, style: btn(T, "wa") }, "💬 Avisar a Ana por WhatsApp") : null,
              s.sig.map((x, i) => h("button", { key: i, "data-crm-paso": x.to, disabled: guardando, onClick: () => paso(x), style: { ...btn(T, i === 0 && caso.estado !== "comprobante_recibido" ? "p" : undefined), textAlign: "left" } }, "→ " + x.l)),
              pend ? h("div", { style: { display: "flex", gap: "8px", alignItems: "flex-end", background: T.bg, borderRadius: "10px", padding: "10px" } },
                h(Field, { T, label: "Fecha y hora de la cita", style: { flex: 1 } }, h("input", { type: "datetime-local", value: citaTmp, onChange: (e) => setCitaTmp(e.target.value), style: I })),
                h("button", { disabled: !citaTmp || guardando, onClick: () => paso(pend), style: btn(T, "p") }, "Confirmar cita"), h("button", { onClick: () => setPend(null), style: btn(T) }, "Cancelar")) : null,
              cerrando ? h("div", { style: { display: "flex", gap: "8px", alignItems: "flex-end", background: T.bg, borderRadius: "10px", padding: "10px" } },
                h(Field, { T, label: "Motivo del cierre", style: { flex: 1 } }, h("input", { value: motivo, onChange: (e) => setMotivo(e.target.value), placeholder: "p. ej. lo arregló en otro taller", style: I })),
                h("button", { onClick: cerrar, disabled: guardando, style: btn(T) }, "Cerrar caso"), h("button", { onClick: () => setCerrando(false), style: btn(T) }, "Cancelar"))
                : h("button", { onClick: () => setCerrando(true), style: { ...btn(T, "s"), alignSelf: "flex-start", color: T.inkSoft } }, "Cerrar caso…")),
          msg ? h("div", { style: { marginTop: "8px", fontSize: "12.5px", color: /^No se|no lo aceptó/.test(msg) ? T.danger : T.ok } }, msg) : null),

        h(ExpedientesCaso, { T, caso, onPasar: pasar, pasando }),
        h(Bitacora, { T, caso_id: caso.id, cliente_id: caso.cliente_id, recargar: caso.updated_at }),

        s.gar ? null : h(Box, { T, tone: "ambar" }, h(Lbl, { T }, "Próxima acción"),
          h("div", { style: { display: "grid", gridTemplateColumns: "1fr", gap: "8px" } },
            h("input", { value: d.proxima_accion || "", onChange: set("proxima_accion"), placeholder: "¿Qué hay que hacer ahora?", style: I }),
            h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" } },
              h("select", { value: d.responsable || "", onChange: set("responsable"), style: I, "aria-label": "Responsable" }, h("option", { value: "" }, "Sin responsable"), RESPONSABLES.map((r) => h("option", { key: r, value: r }, r))),
              h("input", { type: "datetime-local", value: d.fecha_limite || "", onChange: set("fecha_limite"), style: I, "aria-label": "Fecha límite" })))),

        h(Box, { T }, h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } }, h(Lbl, { T }, "Business Central"),
            enBC ? h("button", { onClick: syncAhora, disabled: sincronizando, style: { ...btn(T, "s"), marginBottom: "8px" } }, sincronizando ? "Actualizando…" : "↻ Actualizar desde BC") : null),
          !enBC ? h("div", { "data-crm-sin-bc": "1", style: { background: CH.ambar.bg, border: `1px solid ${CH.ambar.bd}`, borderRadius: "10px", padding: "10px 12px", fontSize: "13px" } },
              h("div", { style: { marginBottom: "8px" } }, "Este cliente aún no está en BC. Dalo de alta para poder hacerle la oferta o el pedido de servicio (se crean también sus vehículos)."),
              altaMsg === "trabajando" ? h("span", { style: { color: T.inkSoft } }, "Creando en BC…")
                : h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
                  altaMsg && altaMsg.dup ? h("button", { onClick: () => onCliente(caso.cliente_id), style: btn(T, "p") }, "Revisar en la ficha del cliente") : h("button", { "data-crm-alta-caso": "1", onClick: altaDesdeCaso, style: btn(T, "p") }, "Dar de alta en BC"),
                  altaMsg && altaMsg.txt ? h("span", { style: { fontSize: "12.5px", color: altaMsg.err || altaMsg.dup ? T.danger : T.ok } }, altaMsg.txt) : null))
            : h(React.Fragment, null,
              sugerencia ? h("div", { "data-crm-sugerencia": "1", style: { background: CH.azul.bg, border: `1px solid ${CH.azul.bd}`, borderRadius: "10px", padding: "10px 12px", fontSize: "13px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
                h("span", null, `Hay ${sugerencia.tipo === "oferta" ? "una oferta nueva" : "un pedido nuevo"} en BC de este cliente: `, h("b", { style: { fontFamily: "'JetBrains Mono', monospace" } }, sugerencia.doc.no), ` · ${eur(sugerencia.doc.importe_iva)}. ¿Es de este caso?`),
                h("button", { onClick: () => vincular(sugerencia.doc), disabled: guardando, style: btn(T, "p") }, "Sí, vincular")) : null,
              docBox("Oferta de servicio", "oferta_bc", oferta), docBox("Pedido de servicio", "pedido_bc", pedido),
              docsOtros.length ? h("div", { style: { marginTop: "8px" } }, h("div", { style: { fontSize: "12px", color: T.inkSoft, marginBottom: "4px" } }, "Otros documentos abiertos de este cliente en BC · clic para vincular"),
                h("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px" } }, docsOtros.map((x) => h("button", { key: x.tipo + x.no, "data-crm-vincular": x.no, disabled: guardando, onClick: () => vincular(x), style: btn(T, "s") }, `${x.tipo === "oferta" ? "Oferta" : "Pedido"} ${x.no} · ${eur(x.importe_iva)}`))))
                : !caso.oferta_bc && !caso.pedido_bc && !sugerencia ? h("div", { style: { fontSize: "12.5px", color: T.inkFaint, marginTop: "6px" } }, "Aún no hay ofertas ni pedidos abiertos de este cliente en BC. Cuando la crees en BC aparecerá aquí (o pulsa “Actualizar desde BC”).") : null),
          verGar ? h("label", { style: { display: "flex", gap: "8px", alignItems: "center", fontSize: "13px", marginTop: "6px" } }, h("input", { type: "checkbox", checked: !!caso.garantia_100, onChange: (e) => guardar({ garantia_100: e.target.checked }) }), "100 % garantía (sin pedido de servicio)") : null),

        verSenal ? h(Box, { T }, h(Lbl, { T }, "Señal 50 %"),
          h(Row, { T, k: "Importe" }, h("input", { value: d.senal_importe ?? "", onChange: set("senal_importe"), placeholder: "€", inputMode: "decimal", style: { ...I, width: "120px", padding: "5px 8px", textAlign: "right" } })),
          h(Row, { T, k: "Comprobante recibido" }, fFechaHora(caso.senal_comprobante_at)),
          h(Row, { T, k: "Aviso a contabilidad" }, caso.senal_aviso_at ? fFechaHora(caso.senal_aviso_at) : h("span", { style: { color: T.warn, fontWeight: 700 } }, "Pendiente")),
          caso.senal_comprobante_at ? h("button", { onClick: avisarAna, disabled: guardando, style: { ...btn(T, "wa"), width: "100%", marginTop: "8px" } }, caso.senal_aviso_at ? "💬 Volver a avisar a Ana" : "💬 Avisar a Ana por WhatsApp") : null) : null,

        verGar ? h(Box, { T }, h(Lbl, { T }, "Garantía"),
          h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" } },
            h(Field, { T, label: "Fabricante" }, h("input", { value: d.garantia_fabricante, onChange: set("garantia_fabricante"), placeholder: "Benimar, Roller Team…", style: I })),
            h(Field, { T, label: "Nº reclamación" }, h("input", { value: d.garantia_reclamacion, onChange: set("garantia_reclamacion"), style: I }))),
          h(Row, { T, k: "Último contacto con el fabricante" }, fFechaHora(caso.garantia_ultimo_contacto), " ", h("button", { onClick: () => guardar({ garantia_ultimo_contacto: NOW }, "Contacto con el fabricante registrado."), style: btn(T, "s") }, "Hablé hoy")),
          h(Row, { T, k: "Resultado" }, caso.garantia_resultado || "—"),
          (caso.garantia_resultado === "parcial" || d.garantia_cubre || d.garantia_no_cubre) ? h("div", { style: { display: "grid", gap: "8px", marginTop: "6px" } },
            h(Field, { T, label: "Qué cubre el fabricante" }, h("textarea", { rows: 2, value: d.garantia_cubre, onChange: set("garantia_cubre"), style: { ...I, resize: "vertical" } })),
            h(Field, { T, label: "Qué NO cubre (se cobra)" }, h("textarea", { rows: 2, value: d.garantia_no_cubre, onChange: set("garantia_no_cubre"), style: { ...I, resize: "vertical" } }))) : null) : null,

        h(Box, { T }, h(Lbl, { T }, "Datos del caso"),
          h("div", { "data-crm-datos-caso": "1", style: { display: "grid", gap: "10px" } },
            h("div", null, h("div", { style: { fontSize: "12px", fontWeight: 800, color: T.inkSoft, marginBottom: "5px" } }, "Tipo"), h(Seg, { T, opts: TIPOS, value: d.tipo, onChange: (v) => setD((x) => ({ ...x, tipo: v })) })),
            h("div", null, h("div", { style: { fontSize: "12px", fontWeight: 800, color: T.inkSoft, marginBottom: "5px" } }, "Canal de entrada"), h(Seg, { T, opts: CANALES, value: d.canal, onChange: (v) => setD((x) => ({ ...x, canal: v })) })),
            h(Field, { T, label: "Consulta" }, h("textarea", { rows: 3, value: d.consulta || "", onChange: set("consulta"), style: { ...I, resize: "vertical" } })),
            h(Field, { T, label: "Vehículo" }, h("input", { value: d.vehiculo, onChange: set("vehiculo"), style: I })),
            (d.tipo || caso.tipo) !== caso.tipo ? h("div", { style: { fontSize: "12px", color: T.warn } }, "Pulsa “Guardar cambios” para aplicar el cambio de tipo. Queda registrado en el historial.") : null)),
        s.gar ? null : h(Box, { T }, h(Lbl, { T }, "Piezas y cita"),
          h("div", { style: { display: "grid", gridTemplateColumns: "1fr", gap: "8px" } },
            h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" } },
              h(Field, { T, label: "Llegada prevista de piezas" }, h("input", { type: "date", value: d.piezas_previstas || "", onChange: set("piezas_previstas"), style: I })),
              h(Field, { T, label: "Cita" }, h("input", { type: "datetime-local", value: d.cita_at || "", onChange: set("cita_at"), style: I }))))),

        h("div", { style: { display: "flex", gap: "8px", alignItems: "center", position: "sticky", bottom: 0, background: T.bg, padding: "8px 0" } },
          h("button", { "data-crm-guardar": "1", onClick: guardarDatos, disabled: guardando, style: btn(T, "p") }, guardando ? "Guardando…" : "Guardar cambios"),
          h("span", { style: { fontSize: "12px", color: T.inkFaint } }, "Los pasos de estado se guardan solos al pulsarlos.")),

        h(Box, { T }, h(Lbl, { T }, "Cambios automáticos · estados y datos"),
          h(Historial, { T, eventos: ev }))));
  }

  // ---------- ficha del cliente ----------
  function ClientePanel({ T, F, id, casos, bcServ, onClose, onCaso, onNueva, onChanged }) {
    const [c, setC] = useState(null); const [d, setD] = useState({}); const [msg, setMsg] = useState(""); const [ev, setEv] = useState([]);
    const [alta, setAlta] = useState(null); // null | "trabajando" | { duplicados } | { error }
    const [nv, setNv] = useState({ modelo: "", matricula: "", bastidor: "" });
    const [vMsg, setVMsg] = useState(""); const [vTrab, setVTrab] = useState(false);
    const [psBC, setPsBC] = useState([]); const [gars, setGars] = useState([]);
    const cargar = async () => {
      const { data } = await sb().from("crm_clientes").select("*").eq("id", id).maybeSingle(); setC(data);
      sb().from("garantias").select("id,numero,estado,fabricante,reclamacion_no,vehiculo,created_at").eq("cliente_id", id).order("created_at", { ascending: false }).then((r) => setGars(r.data || []));
      if (data) setD({ nombre: data.nombre || "", apellidos: data.apellidos || "", telefono: data.telefono || "", email: data.email || "", nif: data.nif || "", direccion: data.direccion || "", cp: data.cp || "", ciudad: data.ciudad || "", provincia: data.provincia || "", notas: data.notas || "" });
      const e = await sb().from("crm_eventos").select("*").eq("cliente_id", id).order("at", { ascending: false }).limit(30); setEv(e.data || []);
      if (data && data.bc_no) { const ps = await sb().from("bc_productos_servicio").select("*").eq("cliente_no", data.bc_no).eq("activo", true); setPsBC(ps.data || []); } else setPsBC([]);
    };
    useEffect(() => { cargar(); }, [id]);
    if (!c) return h(Drawer, { T, onClose, width: 760, label: "Ficha del cliente" }, h("div", { style: { padding: "24px", color: T.inkSoft } }, "Cargando…"));
    const set = (k) => (e) => setD((x) => ({ ...x, [k]: e.target.value }));
    const guardar = async () => {
      const p = {}; Object.keys(d).forEach((k) => { const v = String(d[k] || "").trim() || null; if (v !== (c[k] || null)) p[k] = v; });
      if (!p.nombre && p.hasOwnProperty("nombre")) { setMsg("El nombre no puede quedar vacío."); return; }
      if (!Object.keys(p).length) { setMsg("No hay cambios."); return; }
      const { error } = await sb().from("crm_clientes").update(p).eq("id", c.id); if (error) { setMsg("No se pudo guardar: " + error.message); return; }
      if (c.bc_no && Object.keys(p).some((k) => k !== "notas")) {
        setMsg("Guardado en el CRM. Actualizando la ficha en BC…");
        const res = await enviarABC(c.id, false, "actualizar_cliente");
        setMsg(res.ok ? (res.sinCambios ? "Guardado. BC ya tenía esos datos." : `Guardado en el CRM y en BC (${(res.cambiados || []).join(", ")}).`) : "Guardado en el CRM, pero BC no lo aceptó: " + (res.error || "error"));
      } else setMsg("Guardado.");
      cargar(); onChanged && onChanged();
    };
    const setTipoCli = async (v) => { const { error } = await sb().from("crm_clientes").update({ tipo_cliente: v }).eq("id", c.id); setMsg(error ? "No se pudo guardar: " + error.message : `Marcado como ${lbl(TIPOS_CLI, v).toLowerCase()}.`); cargar(); onChanged && onChanged(); };
    const vehiculos = (Array.isArray(c.vehiculos) ? c.vehiculos : []).map(asVeh);
    const setVehiculos = async (lista) => { const { error } = await sb().from("crm_clientes").update({ vehiculos: lista }).eq("id", c.id); if (error) setVMsg("No se pudo guardar: " + error.message); await cargar(); return !error; };
    const sincVehiculos = async () => {
      if (!c.bc_no) return;
      setVTrab(true); setVMsg("Enviando a BC…");
      const res = await enviarABC(c.id, false);
      setVTrab(false); setVMsg(res.ok ? (res.vehiculos && res.vehiculos.length ? res.vehiculos.join(" · ") : "Nada pendiente de enviar.") : "No se pudo: " + (res.error || "error"));
      cargar(); onChanged && onChanged();
    };
    const addVeh = async () => {
      const v = { modelo: nv.modelo.trim(), matricula: normMat(nv.matricula), bastidor: normMat(nv.bastidor) };
      if (!v.modelo) { setVMsg("Pon al menos el modelo."); return; }
      if (vehiculos.some((x) => mismoVeh(x, v))) { setVMsg("Ese vehículo ya está en la ficha."); return; }
      Object.keys(v).forEach((k) => { if (!v[k]) delete v[k]; });
      if (await setVehiculos([...vehiculos, v])) { setNv({ modelo: "", matricula: "", bastidor: "" }); if (c.bc_no) await sincVehiculos(); else setVMsg("Guardado. Se creará en BC al dar de alta al cliente."); }
    };
    const forzarVeh = async (i) => { const l = vehiculos.slice(); l[i] = { ...l[i], forzar: true }; delete l[i].bc_error; if (await setVehiculos(l)) await sincVehiculos(); };
    const importarVeh = async (p) => { if (await setVehiculos([...vehiculos, vehDeBC(p)])) setVMsg(`Añadido ${p.descripcion || p.no} a la ficha.`); };
    const psSinFicha = psBC.filter((p) => !vehiculos.some((v) => v.bc_ps === p.no || (normMat(v.matricula) && normMat(v.matricula) === p.serie_norm)));
    const darAlta = async (forzar) => {
      setAlta("trabajando");
      try {
        const { data, error } = await sb().functions.invoke("crm-alta-bc", { body: { cliente_id: c.id, forzar: !!forzar } });
        let res = data;
        if (error) { try { res = error.context && (await error.context.json()); } catch (e) {} if (!res) res = { error: error.message }; }
        if (res && res.duplicados) { setAlta({ duplicados: res.duplicados }); return; }
        if (res && res.ok) { setAlta(null); setMsg(`Dado de alta en BC como ${res.bc_no}.` + (res.vehiculos && res.vehiculos.length ? " Vehículos: " + res.vehiculos.join(" · ") : "")); cargar(); onChanged && onChanged(); return; }
        setAlta({ error: (res && res.error) || "Error desconocido" });
      } catch (e) { setAlta({ error: String(e.message || e) }); }
    };
    const vincular = async (no) => { const { error } = await sb().from("crm_clientes").update({ bc_no: no }).eq("id", c.id); if (error) { setAlta({ error: error.message.includes("duplicate") ? "Ese cliente de BC ya está vinculado a otra ficha del CRM." : error.message }); return; } setAlta(null); setMsg(`Vinculado al cliente de BC ${no}.`); cargar(); onChanged && onChanged(); };
    const susCasos = casos.filter((x) => x.cliente_id === c.id);
    const docs = c.bc_no ? bcServ.filter((x) => x.cliente_no === c.bc_no).sort((a, b) => String(b.fecha_pedido || "").localeCompare(String(a.fecha_pedido || ""))) : [];
    const I = inp(T);
    const th = { fontSize: "11px", letterSpacing: ".08em", textTransform: "uppercase", color: T.inkSoft, fontWeight: 700, padding: "8px", textAlign: "left", borderBottom: `1.5px solid ${T.border}` };
    const td = { padding: "9px 8px", borderBottom: `1px solid ${T.border}`, fontSize: "13.5px", whiteSpace: "nowrap" };
    return h(Drawer, { T, onClose, width: 760, label: "Ficha del cliente" },
      h("div", { style: { background: T.surface, padding: "18px 22px", borderBottom: `1px solid ${T.border}`, display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center" } },
        h("div", { style: { fontFamily: F.display, fontSize: "26px", fontWeight: 800 } }, nombreCli(c)),
        c.bc_no ? h(Chip, { c: "verde" }, "Cliente BC ", h("span", { style: { fontFamily: "'JetBrains Mono', monospace" } }, c.bc_no)) : h(Chip, { c: "ambar" }, "Pendiente de alta en BC"),
        h("div", { style: { marginLeft: "auto", display: "flex", gap: "8px" } }, h("button", { onClick: () => onNueva(c), style: btn(T, "p") }, "+ Nueva consulta"), h("button", { onClick: onClose, "aria-label": "Cerrar", style: { border: "none", background: "transparent", cursor: "pointer", fontSize: "22px", color: T.inkSoft } }, "×"))),
      h("div", { style: { padding: "16px 22px 40px", display: "flex", flexDirection: "column", gap: "14px" } },
        !c.bc_no ? h(Box, { T, tone: "ambar" }, h(Lbl, { T }, "Alta en Business Central"),
          h("div", { style: { fontSize: "13px", marginBottom: "8px" } }, "Se crea en BC con la configuración habitual (GENERICO · NAC · CLIENTES, 30D, precios IVA incluido). Antes se comprueba que no exista ya."),
          alta === "trabajando" ? h("div", { style: { fontSize: "13px", color: T.inkSoft } }, "Comprobando y creando en BC…")
            : alta && alta.duplicados ? h("div", null, h("div", { style: { fontSize: "13px", fontWeight: 700, marginBottom: "6px", color: T.warn } }, "Ya hay clientes en BC que coinciden. ¿Es alguno de estos?"),
              alta.duplicados.map((x) => h("div", { key: x.no, style: { display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center", padding: "6px 0", borderTop: `1px solid ${T.border}`, fontSize: "13px" } },
                h("span", null, h("b", null, x.nombre), " ", h("span", { style: { fontFamily: "'JetBrains Mono', monospace", fontSize: "12px", color: T.inkSoft } }, x.no), h("div", { style: { fontSize: "12px", color: T.inkSoft } }, [x.telefono, x.email, x.ciudad].filter(Boolean).join(" · "))),
                h("button", { onClick: () => vincular(x.no), style: btn(T, "s") }, "Es este: vincular"))),
              h("div", { style: { display: "flex", gap: "8px", marginTop: "8px" } }, h("button", { onClick: () => darAlta(true), style: btn(T) }, "No es ninguno: crear cliente nuevo"), h("button", { onClick: () => setAlta(null), style: btn(T) }, "Cancelar")))
            : h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } }, h("button", { "data-crm-alta": "1", onClick: () => darAlta(false), style: btn(T, "p") }, "Dar de alta en BC"),
              alta && alta.error ? h("span", { style: { fontSize: "12.5px", color: T.danger } }, alta.error) : null)) : null,
        h("div", { style: { display: "flex", flexWrap: "wrap", gap: "14px", alignItems: "flex-start" } },
          h("div", { style: { flex: "1 1 300px", display: "flex", flexDirection: "column", gap: "14px" } },
            h(Box, { T }, h(Lbl, { T }, "Datos"),
              h("div", { "data-crm-tipo-cli": "1", style: { marginBottom: "10px" } }, h("div", { style: { fontSize: "12px", fontWeight: 800, color: T.inkSoft, marginBottom: "5px" } }, "Tipo de cliente"),
                h(Seg, { T, opts: TIPOS_CLI, value: c.tipo_cliente || "", onChange: setTipoCli }), !c.tipo_cliente ? h("div", { style: { fontSize: "12px", color: T.warn, marginTop: "4px" } }, "Sin marcar: ¿nos compró el vehículo?") : null),
              h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" } },
                [["nombre", "Nombre"], ["apellidos", "Apellidos"], ["telefono", "Teléfono"], ["email", "Email"], ["direccion", "Dirección"], ["ciudad", "Población"], ["provincia", "Provincia"], ["cp", "Código postal"], ["nif", "NIF (opcional)"]].map(([k, l]) =>
                  h(Field, { key: k, T, label: l, style: k === "direccion" ? { gridColumn: "1 / -1" } : null }, h("input", { value: d[k] || "", onChange: set(k), style: I }))),
                h(Field, { T, label: "Notas", style: { gridColumn: "1 / -1" } }, h("textarea", { rows: 2, value: d.notas || "", onChange: set("notas"), style: { ...I, resize: "vertical" } }))),
              h("div", { style: { display: "flex", gap: "8px", alignItems: "center", marginTop: "10px", flexWrap: "wrap" } }, h("button", { "data-crm-guardar-cli": "1", onClick: guardar, style: btn(T, "p") }, c.bc_no ? "Guardar datos (también en BC)" : "Guardar datos"), msg ? h("span", { style: { fontSize: "12.5px", color: /^No se|no lo aceptó/.test(msg) ? T.danger : T.ok } }, msg) : null)),
            h(Box, { T }, h(Lbl, { T }, "Vehículos"),
              vehiculos.length ? vehiculos.map((v, i) => h("div", { key: i, "data-crm-veh": i, style: { padding: "7px 0", borderTop: i ? `1px solid ${T.border}` : "none", fontSize: "13.5px" } },
                h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" } },
                  h("span", null, h("b", null, v.modelo || "(sin modelo)"), v.matricula ? h("span", { style: { fontFamily: "'JetBrains Mono', monospace", fontSize: "12.5px", marginLeft: "8px" } }, normMat(v.matricula)) : null),
                  h("button", { onClick: () => setVehiculos(vehiculos.filter((_, j) => j !== i)), title: "Solo lo quita del CRM; en BC no se toca", style: { ...btn(T, "s"), color: T.inkSoft } }, "Quitar de la ficha")),
                v.bastidor ? h("div", { style: { fontSize: "12px", color: T.inkSoft } }, "Bastidor: ", h("span", { style: { fontFamily: "'JetBrains Mono', monospace" } }, v.bastidor)) : null,
                h("div", { style: { marginTop: "3px", display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" } },
                  v.bc_ps ? h(Chip, { c: "verde" }, "BC ", h("span", { style: { fontFamily: "'JetBrains Mono', monospace" } }, v.bc_ps))
                    : v.bc_error ? h(React.Fragment, null, h("span", { style: { fontSize: "12px", color: T.danger } }, v.bc_error), h("button", { onClick: () => forzarVeh(i), disabled: vTrab, style: btn(T, "s") }, "Crear igualmente"))
                    : c.bc_no ? h(React.Fragment, null, h(Chip, { c: "ambar" }, "Pendiente de BC"), h("button", { onClick: sincVehiculos, disabled: vTrab, style: btn(T, "s") }, "Enviar a BC"))
                    : h(Chip, { c: "ambar" }, "Se creará en BC al dar de alta al cliente"))))
                : h("div", { style: { fontSize: "13px", color: T.inkFaint } }, "Sin vehículos."),
              h("div", { style: { display: "grid", gridTemplateColumns: "1fr", gap: "6px", marginTop: "10px", background: T.bg, borderRadius: "10px", padding: "10px" } },
                h("input", { value: nv.modelo, onChange: (e) => setNv((x) => ({ ...x, modelo: e.target.value })), placeholder: "Modelo (p. ej. TESSORO 444)", "aria-label": "Modelo", style: I }),
                h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: "6px" } },
                  h("input", { value: nv.matricula, onChange: (e) => setNv((x) => ({ ...x, matricula: e.target.value })), placeholder: "Matrícula", "aria-label": "Matrícula", style: I }),
                  h("input", { value: nv.bastidor, onChange: (e) => setNv((x) => ({ ...x, bastidor: e.target.value })), placeholder: "Bastidor (opcional)", "aria-label": "Bastidor", style: I })),
                h("button", { "data-crm-add-veh": "1", onClick: addVeh, disabled: vTrab, style: btn(T, "p") }, c.bc_no ? "Añadir vehículo (se crea también en BC)" : "Añadir vehículo")),
              vMsg ? h("div", { style: { fontSize: "12.5px", marginTop: "6px", color: /No se|No se pudo|ya está/.test(vMsg) ? T.danger : T.ok } }, vMsg) : null,
              psSinFicha.length ? h("div", { style: { marginTop: "10px" } }, h("div", { style: { fontSize: "12px", color: T.inkSoft, marginBottom: "4px" } }, "En BC tiene también estos vehículos:"),
                psSinFicha.map((p) => h("div", { key: p.no, style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", fontSize: "13px", padding: "4px 0" } },
                  h("span", null, h("b", null, p.descripcion || "—"), " ", h("span", { style: { fontFamily: "'JetBrains Mono', monospace", fontSize: "12px", color: T.inkSoft } }, [p.serie, p.no].filter(Boolean).join(" · "))),
                  h("button", { onClick: () => importarVeh(p), style: btn(T, "s") }, "Añadir a la ficha")))) : null)),
          h("div", { style: { flex: "999 1 360px", minWidth: 0, display: "flex", flexDirection: "column", gap: "14px" } },
            h(Box, { T }, h(Lbl, { T }, `Casos (${susCasos.length})`),
              susCasos.length ? susCasos.map((x) => h("button", { key: x.id, onClick: () => onCaso(x.id), style: { display: "flex", width: "100%", justifyContent: "space-between", gap: "8px", alignItems: "center", padding: "8px 0", border: "none", borderTop: `1px solid ${T.border}`, background: "transparent", cursor: "pointer", fontFamily: "inherit", color: T.ink, textAlign: "left" } },
                h("span", null, h("b", null, lbl(TIPOS, x.tipo)), h("div", { style: { fontSize: "12px", color: T.inkSoft } }, `${fFecha(x.created_at)} · ${x.vehiculo || "—"}`)), h(Chip, { c: est(x.estado).c }, est(x.estado).l)))
                : h("div", { style: { fontSize: "13px", color: T.inkFaint } }, "Sin casos abiertos.")),
            gars.length ? h(Box, { T, tone: "violeta" }, h(Lbl, { T }, `Garantías (${gars.length})`),
              gars.map((g) => h("button", { key: g.id, onClick: () => abrirExpediente(g.id), style: { display: "flex", width: "100%", justifyContent: "space-between", gap: "8px", alignItems: "center", padding: "8px 0", border: "none", borderTop: `1px solid ${T.border}`, background: "transparent", cursor: "pointer", fontFamily: "inherit", color: T.ink, textAlign: "left" } },
                h("span", null, h("b", { style: { fontFamily: "'JetBrains Mono', monospace" } }, g.numero), " ", g.fabricante || "", h("div", { style: { fontSize: "12px", color: T.inkSoft } }, `${fFecha(g.created_at)} · ${vehTxt(g.vehiculo) || "—"}${g.reclamacion_no ? " · código " + g.reclamacion_no : ""}`)),
                h("span", { style: { fontSize: "12px", fontWeight: 800, color: T.rust } }, "abrir →")))) : null,
            h(Box, { T }, h(Lbl, { T }, "En Business Central"),
              !c.bc_no ? h("div", { style: { fontSize: "13px", color: T.inkFaint } }, "Aún no está en BC.")
                : docs.length ? h("div", { style: { overflowX: "auto" } }, h("table", { style: { width: "100%", borderCollapse: "collapse", minWidth: "460px" } },
                  h("thead", null, h("tr", null, ["Documento", "Nº", "Fecha", "Estado", "IVA incl."].map((x) => h("th", { key: x, style: th }, x)))),
                  h("tbody", null, docs.map((x) => h("tr", { key: x.tipo + x.no, style: { color: x.activo ? T.ink : T.inkSoft } },
                    h("td", { style: td }, x.tipo === "oferta" ? "Oferta" : "Pedido"), h("td", { style: { ...td, fontFamily: "'JetBrains Mono', monospace", fontSize: "12.5px" } }, x.no),
                    h("td", { style: td }, x.fecha_pedido ? fFecha(x.fecha_pedido) : "—"), h("td", { style: td }, x.activo ? x.estado || "—" : h(Chip, null, "Ya no está en BC")), h("td", { style: { ...td, textAlign: "right", fontWeight: 700 } }, eur(x.importe_iva)))))))
                : h("div", { style: { fontSize: "13px", color: T.inkFaint } }, "Sin ofertas ni pedidos de servicio abiertos.")),
            h(Box, { T }, h(Lbl, { T }, "Últimos movimientos"), h(Historial, { T, eventos: ev }))))));
  }

  // ---------- nueva consulta ----------
  function NuevaConsulta({ T, F, inicial, onClose, onCreated }) {
    const me = yo();
    const manana = new Date(Date.now() + 864e5); manana.setHours(13, 0, 0, 0);
    const [q, setQ] = useState(""); const [res, setRes] = useState([]);
    const [sel, setSel] = useState(inicial.cliente ? { tipo: "crm", c: inicial.cliente } : inicial.bc ? { tipo: "bc", bc: inicial.bc } : null);
    const [cli, setCli] = useState({ nombre: "", apellidos: "", telefono: "", email: "", nif: "", direccion: "", ciudad: "", provincia: "", cp: "" });
    const [veh, setVeh] = useState({ modelo: "", matricula: "", bastidor: "" });
    const [vehSel, setVehSel] = useState(null); // índice de un vehículo ya existente
    const [vehBC, setVehBC] = useState([]);
    const [k, setK] = useState({ canal: "telefono", tipo: "reparacion", consulta: "", proxima_accion: "Responder al cliente", responsable: me, fecha_limite: toLocalInput(manana.toISOString()) });
    const [err, setErr] = useState(""); const [guardando, setGuardando] = useState(false);
    const [tipoCli, setTipoCli] = useState(inicial.cliente && inicial.cliente.tipo_cliente ? inicial.cliente.tipo_cliente : "");
    useEffect(() => { if (sel && sel.tipo === "crm" && sel.c.tipo_cliente) setTipoCli(sel.c.tipo_cliente); }, [sel]);
    const t = useRef(null);
    useEffect(() => { clearTimeout(t.current); if (sel || qSafe(q).length < 2) { setRes([]); return; } t.current = setTimeout(async () => { try { setRes(await buscarClientes(q)); } catch (e) {} }, 300); }, [q, sel]);
    useEffect(() => {
      setVehSel(null); setVehBC([]);
      const no = sel ? (sel.tipo === "crm" ? sel.c.bc_no : sel.bc.no) : null;
      if (no) sb().from("bc_productos_servicio").select("*").eq("cliente_no", no).eq("activo", true).then((r) => setVehBC(r.data || []));
    }, [sel]);
    const vehExistentes = (() => { const own = sel && sel.tipo === "crm" ? (sel.c.vehiculos || []).map(asVeh) : []; const extra = vehBC.filter((p) => !own.some((v) => v.bc_ps === p.no)).map(vehDeBC); return [...own, ...extra]; })();
    const setC = (f) => (e) => setCli((x) => ({ ...x, [f]: e.target.value }));
    const setKk = (f) => (e) => setK((x) => ({ ...x, [f]: e.target.value }));
    const I = inp(T);
    const guardar = async () => {
      setErr("");
      if (!sel && !cli.nombre.trim()) { setErr("Falta el nombre del cliente."); return; }
      if (!sel && !cli.telefono.trim() && !cli.email.trim()) { setErr("Pon al menos teléfono o email."); return; }
      if (!k.consulta.trim()) { setErr("Escribe la consulta."); return; }
      if (!tipoCli) { setErr("Indica si es cliente propio (nos compró el vehículo) o externo."); return; }
      setGuardando(true);
      try {
        let cliente;
        if (sel && sel.tipo === "crm") cliente = sel.c;
        else if (sel && sel.tipo === "bc") {
          const ex = await sb().from("crm_clientes").select("*").eq("bc_no", sel.bc.no).maybeSingle();
          if (ex.data) cliente = ex.data;
          else { const b = sel.bc; const ins = await sb().from("crm_clientes").insert({ bc_no: b.no, nombre: b.nombre || "(sin nombre)", telefono: b.telefono, email: b.email, direccion: b.direccion, cp: b.cp, ciudad: b.ciudad, provincia: b.provincia, nif: b.nif }).select("*").single(); if (ins.error) throw ins.error; cliente = ins.data; }
        } else {
          const row = {}; Object.keys(cli).forEach((f) => { row[f] = cli[f].trim() || null; });
          const ins = await sb().from("crm_clientes").insert(row).select("*").single(); if (ins.error) throw ins.error; cliente = ins.data;
        }
        if (cliente.tipo_cliente !== tipoCli) { const up = await sb().from("crm_clientes").update({ tipo_cliente: tipoCli }).eq("id", cliente.id).select("*").single(); if (!up.error) cliente = up.data; }
        let elegido = vehSel != null ? vehExistentes[vehSel] : null;
        if (!elegido && veh.modelo.trim()) { elegido = { modelo: veh.modelo.trim(), matricula: normMat(veh.matricula), bastidor: normMat(veh.bastidor) }; Object.keys(elegido).forEach((f) => { if (!elegido[f]) delete elegido[f]; }); }
        let nuevoVeh = false;
        if (elegido) {
          const vs = (Array.isArray(cliente.vehiculos) ? cliente.vehiculos : []).map(asVeh);
          if (!vs.some((x) => mismoVeh(x, elegido))) { const up = await sb().from("crm_clientes").update({ vehiculos: [...vs, elegido] }).eq("id", cliente.id); if (up.error) throw up.error; nuevoVeh = !elegido.bc_ps; }
        }
        if (nuevoVeh && cliente.bc_no) enviarABC(cliente.id, false).catch(() => {}); // crea el producto de servicio en BC en segundo plano
        const ins = await sb().from("crm_casos").insert({ cliente_id: cliente.id, vehiculo: elegido ? vehTxt(elegido) : null, canal: k.canal, tipo: k.tipo, consulta: k.consulta.trim(), estado: "pendiente_respuesta", rama: k.tipo === "garantia" ? "garantia" : null,
          proxima_accion: k.proxima_accion.trim() || null, responsable: k.responsable || null, fecha_limite: fromLocalInput(k.fecha_limite) }).select("*, cliente:crm_clientes(*)").single();
        if (ins.error) throw ins.error;
        if (k.tipo === "garantia") { const r = await pasarAGarantias(ins.data); onCreated(r.caso, r.gid); return; }
        onCreated(ins.data);
      } catch (e) { setErr("No se pudo guardar: " + (e.message || e)); setGuardando(false); }
    };
    return h("div", { role: "dialog", "aria-label": "Nueva consulta", style: { position: "fixed", inset: 0, zIndex: 1250, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "30px 12px" } },
      h("div", { onClick: onClose, style: { position: "fixed", inset: 0, background: "rgba(15,27,46,.35)" } }),
      h("div", { style: { position: "relative", width: "min(680px, 100%)", background: T.surface, borderRadius: "16px", border: `1px solid ${T.border}`, boxShadow: "0 20px 50px rgba(15,27,46,.2)", padding: "22px", display: "flex", flexDirection: "column", gap: "14px", fontFamily: F.body, color: T.ink } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } }, h("div", { style: { fontFamily: F.display, fontSize: "22px", fontWeight: 800 } }, "Nueva consulta"), h("button", { onClick: onClose, "aria-label": "Cerrar", style: { border: "none", background: "transparent", cursor: "pointer", fontSize: "22px", color: T.inkSoft } }, "×")),
        sel ? h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", background: T.bg, borderRadius: "10px", padding: "10px 12px" } },
          h("span", null, h("span", { style: { fontSize: "12px", color: T.inkSoft } }, "Cliente: "), h("b", null, sel.tipo === "crm" ? nombreCli(sel.c) : sel.bc.nombre), " ", (sel.tipo === "crm" ? sel.c.bc_no : sel.bc.no) ? h("span", { style: { fontFamily: "'JetBrains Mono', monospace", fontSize: "12px", color: T.inkSoft } }, sel.tipo === "crm" ? sel.c.bc_no : sel.bc.no) : h(Chip, { c: "ambar" }, "sin alta en BC")),
          h("button", { onClick: () => setSel(null), style: btn(T, "s") }, "Cambiar"))
          : h(React.Fragment, null,
            h(Field, { T, label: "1 · Escribe el teléfono o el nombre: si ya es cliente, aparece aquí" }, h("input", { type: "search", value: q, onChange: (e) => setQ(e.target.value), autoFocus: true, style: { ...I, borderColor: T.rust } })),
            res.length ? h("div", { style: { border: `1px solid ${T.border}`, borderRadius: "10px", overflow: "hidden", marginTop: "-6px" } },
              h("div", { style: { fontSize: "11px", fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: T.inkSoft, background: T.bg, padding: "6px 12px" } }, `Clientes que coinciden · ${res.length}`),
              res.map((r) => h(ResultadoCliente, { key: r.k, T, r, cta: "Usar", onPick: (x) => setSel(x) }))) : null,
            h("div", { style: { fontSize: "12px", color: T.inkSoft, marginTop: "-6px" } }, "¿No aparece? Rellena sus datos y se crea como cliente nuevo. El alta en BC se hace después desde su ficha, con un botón."),
            h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" } },
              [["nombre", "Nombre"], ["apellidos", "Apellidos"], ["telefono", "Teléfono"], ["email", "Email"]].map(([f, l]) => h(Field, { key: f, T, label: l }, h("input", { value: cli[f], onChange: setC(f), style: I }))),
              h(Field, { T, label: "Dirección" }, h("input", { value: cli.direccion, onChange: setC("direccion"), style: I })),
              h(Field, { T, label: "NIF (opcional)" }, h("input", { value: cli.nif, onChange: setC("nif"), style: I })),
              h(Field, { T, label: "Población" }, h("input", { value: cli.ciudad, onChange: setC("ciudad"), style: I })),
              h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" } },
                h(Field, { T, label: "Provincia" }, h("input", { value: cli.provincia, onChange: setC("provincia"), style: I })),
                h(Field, { T, label: "C.P." }, h("input", { value: cli.cp, onChange: setC("cp"), style: I }))))),
        h("div", { "data-crm-nueva-tipocli": "1" }, h("div", { style: { fontSize: "12px", fontWeight: 800, color: T.inkSoft, marginBottom: "5px" } }, "Tipo de cliente"), h(Seg, { T, opts: TIPOS_CLI, value: tipoCli, onChange: setTipoCli })),
        h("div", null, h("div", { style: { fontSize: "12px", fontWeight: 800, color: T.inkSoft, marginBottom: "5px" } }, "Vehículo"),
          vehExistentes.length ? h("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "8px" } },
            vehExistentes.map((v, i) => h("button", { key: i, type: "button", onClick: () => setVehSel(vehSel === i ? null : i), style: { ...btn(T, "s"), background: vehSel === i ? T.ink : T.surface, color: vehSel === i ? T.bg : T.ink } }, vehTxt(v) || v.modelo)),
            h("button", { type: "button", onClick: () => setVehSel(null), style: { ...btn(T, "s"), borderStyle: "dashed", background: vehSel == null ? T.bgAlt : T.surface } }, "Otro vehículo")) : null,
          vehSel == null ? h("div", { style: { display: "grid", gridTemplateColumns: "1.3fr 1fr 1.3fr", gap: "8px" } },
            h("input", { value: veh.modelo, onChange: (e) => setVeh((x) => ({ ...x, modelo: e.target.value })), placeholder: "Modelo", "aria-label": "Modelo", style: I }),
            h("input", { value: veh.matricula, onChange: (e) => setVeh((x) => ({ ...x, matricula: e.target.value })), placeholder: "Matrícula", "aria-label": "Matrícula", style: I }),
            h("input", { value: veh.bastidor, onChange: (e) => setVeh((x) => ({ ...x, bastidor: e.target.value })), placeholder: "Bastidor (opcional)", "aria-label": "Bastidor", style: I })) : null),
        h("div", null, h("div", { style: { fontSize: "12px", fontWeight: 800, color: T.inkSoft, marginBottom: "5px" } }, "Canal"), h(Seg, { T, opts: CANALES, value: k.canal, onChange: (v) => setK((x) => ({ ...x, canal: v })) })),
        h("div", null, h("div", { style: { fontSize: "12px", fontWeight: 800, color: T.inkSoft, marginBottom: "5px" } }, "Tipo"), h(Seg, { T, opts: TIPOS, value: k.tipo, onChange: (v) => setK((x) => ({ ...x, tipo: v })) })),
        h(Field, { T, label: "Consulta" }, h("textarea", { rows: 3, value: k.consulta, onChange: setKk("consulta"), placeholder: "¿Qué necesita?", style: { ...I, resize: "vertical" } })),
        k.tipo === "garantia" ? h("div", { style: { background: CH.violeta.bg, border: `1px solid ${CH.violeta.bd}`, borderRadius: "12px", padding: "10px 12px", fontSize: "13px" } }, "Al guardar se abre su expediente en la pestaña Garantías, donde se pide la información al cliente, se analiza, se tramita y se da cita.")
        : h("div", { style: { background: T.bg, borderRadius: "12px", padding: "12px", display: "grid", gridTemplateColumns: "2fr 1fr 1.3fr", gap: "10px" } },
          h(Field, { T, label: "Próxima acción" }, h("input", { value: k.proxima_accion, onChange: setKk("proxima_accion"), style: I })),
          h(Field, { T, label: "Responsable" }, h("select", { value: k.responsable, onChange: setKk("responsable"), style: I }, h("option", { value: "" }, "—"), RESPONSABLES.map((r) => h("option", { key: r, value: r }, r)))),
          h(Field, { T, label: "Para" }, h("input", { type: "datetime-local", value: k.fecha_limite, onChange: setKk("fecha_limite"), style: I }))),
        err ? h("div", { style: { color: T.danger, fontSize: "13px" } }, err) : null,
        h("div", { style: { display: "flex", justifyContent: "flex-end", gap: "10px" } }, h("button", { onClick: onClose, style: btn(T) }, "Cancelar"), h("button", { "data-crm-guardar-consulta": "1", onClick: guardar, disabled: guardando, style: btn(T, "p") }, guardando ? "Guardando…" : k.tipo === "garantia" ? "Guardar y pasar a Garantías" : "Guardar consulta"))));
  }

  window.AcllarCRM = CRMView;
  window.AcllarCRM._test = { E, aviso, vence, textoEvento };
  // Piezas compartidas con taller-garantias.js
  window.AcllarCRM._ui = { Bitacora, ClientePanel, ChipCli, TIPOS_CLI, BITACORA, CLASES, telWa, irA, yo, fLarga, enviarABC, h, CH, Chip, btn, inp, Lbl, Box, Row, Field, Seg, Drawer, sb, quien, fFecha, fFechaHora, toLocalInput, fromLocalInput, eur, nombreCli, normMat, asVeh, vehTxt, vehDeBC, mismoVeh, buscarClientes, ResultadoCliente, qSafe, horas, mismoDia, pad, TIPOS, lbl };
})();
