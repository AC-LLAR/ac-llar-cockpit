// taller-garantias.js  ---  TALLER → Garantías
// Las garantías de clientes entran por TALLER → Casos y pasan aquí al marcarlas como garantía.
// Recorrido: consulta → info pedida (fotos a post-venta@) → análisis (qué cubre) → cliente informado
// → tramitada en la web del fabricante (código de garantía, horas solicitadas, piezas) → respuesta
// (horas aprobadas) → piezas → cita → reparación → entrega → cierre (piezas repuestas).
// Tablas: garantias / garantia_lineas / garantia_fotos; bitácora e historial en crm_eventos (garantia_id).
// Fotos: bucket privado "garantias". Nada se borra: las líneas y fotos se anulan.
// Se carga después de taller-crm.js y usa sus piezas (window.AcllarCRM._ui).
(function () {
  if (!window.React || !window.AcllarCRM || !window.AcllarCRM._ui) return;
  const U = window.AcllarCRM._ui;
  const { h, CH, Chip, btn, inp, Lbl, Box, Field, Seg, Drawer, sb, quien, fFecha, fFechaHora, toLocalInput, fromLocalInput, nombreCli, normMat, vehTxt,
    horas, pad, mismoDia, NuevaConsulta, Bitacora, ClientePanel, ChipCli, BITACORA, telWa, irA, yo, fLarga, enviarABC } = U;
  const { useState, useEffect, useRef } = React;

  const POSVENTA = "post-venta@ac-llar.com";
  const FAB_GARANTIA = [["Benimar", "Benimar"], ["Roller Team", "Roller Team"], ["Otro", "Otro"]];
  const FAB_CHASIS = [["Ford", "Ford"], ["Fiat", "Fiat"], ["Peugeot", "Peugeot"], ["Otro", "Otro"]];
  const MECANICOS = ["Ali", "Carlos", "Hugo", "Agente externo", "Sebastián"];
  const ETIQUETAS = [["cliente", "Enviada por el cliente"], ["antes", "Antes"], ["despues", "Después"], ["pieza", "Pieza cambiada"], ["otra", "Otra"]];
  const COBERTURA = [["cubre", "Cubre garantía"], ["no_cubre", "No cubre"], ["a_valorar", "A valorar"]];
  const COB_C = { cubre: "verde", no_cubre: "rojo", a_valorar: "ambar" };
  const NOW = "__now__";
  // Estados. cli: solo para clientes · flota: solo para vehículos de alquiler · cita: pide fecha · codigo: pide el código de garantía
  const EST = {
    consulta: { l: "Consulta recibida", c: "ambar", f: 0, sig: [{ to: "esperando_info", l: "Información pedida al cliente (sin enviar mensaje)", set: { info_pedida_at: NOW }, cli: true }, { to: "analisis", l: "Ya tengo fotos y explicación: analizar" }] },
    esperando_info: { l: "Esperando información del cliente", c: "ambar", f: 0, sig: [{ to: "analisis", l: "Información recibida: analizar" }] },
    analisis: { l: "Análisis y respuesta al cliente", c: "violeta", f: 1, sig: [
      { to: "tramitada", l: "Tramitada con el fabricante", set: { tramitada_at: NOW }, codigo: true },
      { to: "cerrada", l: "No es garantía: cerrar" }] },
    tramitada: { l: "Tramitada · esperando respuesta", c: "azul", f: 2, sig: [
      { to: "aprobada", l: "Aprobada", set: { resultado: "aprobada", resolucion_at: NOW } },
      { to: "parcial", l: "Aprobada parcial", set: { resultado: "parcial", resolucion_at: NOW } },
      { to: "rechazada", l: "Rechazada", set: { resultado: "rechazada", resolucion_at: NOW } }] },
    aprobada: { l: "Aprobada · dar cita", c: "verde", f: 3, sig: [{ to: "cita_asignada", l: "Dar cita (cuando estén las piezas)", cita: true }] },
    parcial: { l: "Aprobada parcial · dar cita", c: "violeta", f: 3, sig: [{ to: "cita_asignada", l: "Dar cita (cuando estén las piezas)", cita: true }, { to: "cerrada", l: "No se repara: cerrar" }] },
    rechazada: { l: "Rechazada por el fabricante", c: "rojo", f: 2, sig: [{ to: "cerrada", l: "Cerrar expediente" }] },
    cita_asignada: { l: "Cita asignada", c: "verde", f: 3, sig: [{ to: "cerrada", l: "Reparación terminada: cerrar expediente" }, { to: "cita_asignada", l: "Cambiar la cita", cita: true }] },
    abierta: { l: "Abierta", c: "ambar", chasis: true, sig: [{ to: "cita_pedida", l: "Cita pedida en el concesionario" }, { to: "cerrada", l: "Cerrar" }] },
    cita_pedida: { l: "Cita pedida", c: "azul", chasis: true, sig: [{ to: "en_concesionario", l: "Vehículo en el concesionario" }, { to: "cerrada", l: "Cerrar" }] },
    en_concesionario: { l: "En el concesionario", c: "violeta", chasis: true, sig: [{ to: "cerrada", l: "Vuelto · cerrar" }] },
    cerrada: { l: "Cerrada", c: "gris", fin: true, f: 4, sig: [] },
  };
  const est = (k) => EST[k] || { l: k || "—", c: "gris", sig: [] };
  const FASES = ["Consulta", "Análisis y respuesta", "Fabricante", "Cita", "Cerrado"];
  const CAMPOS = { estado: "Estado", fabricante: "Fabricante", descripcion: "Descripción", reclamacion_no: "Nº de gestión del fabricante", resultado: "Resultado", concesionario: "Concesionario", cita_at: "Cita",
    notas: "Notas", vehiculo: "Vehículo", tramitada_at: "Tramitada", resolucion_at: "Resolución", horas: "Horas solicitadas", horas_aprobadas: "Horas aprobadas", mecanico: "Mecánico", fecha: "Fecha",
    referencia: "Referencia", cantidad: "Cantidad", origen_pieza: "Origen", repuesto_recibido_at: "Recibida / repuesta", anulada: "Anulada", fecha_entrada: "Entrada", archivado: "Archivado",
    cobertura: "Cobertura", info_pedida_at: "Información pedida", cliente_informado_at: "Cliente informado", presupuesto_caso_id: "Presupuesto en Casos", tipo: "Tipo", caso_id: "Caso" };
  const num = (v) => (v === "" || v == null ? null : Number(String(v).replace(",", ".")));
  const fmtH = (n) => `${Number(n || 0).toLocaleString("es-ES", { maximumFractionDigits: 2 })} h`;
  const vehLinea = (v) => { const x = v || {}; return [x.ac, x.modelo, x.matricula ? normMat(x.matricula) : null].filter(Boolean).join(" · ") || "—"; };
  const esCli = (g) => g.origen === "cliente";
  const pasoVisible = (g) => (x) => (!x.cli || esCli(g)) && (!x.flota || !esCli(g));

  function totales(lineas) {
    const vivas = lineas.filter((l) => !l.anulada);
    const tr = vivas.filter((l) => l.tipo === "trabajo"), pz = vivas.filter((l) => l.tipo === "pieza");
    const porMec = {}; tr.forEach((l) => { const k = l.mecanico || "—"; porMec[k] = (porMec[k] || 0) + Number(l.horas || 0); });
    const aprob = tr.filter((l) => l.horas_aprobadas != null);
    return { horas: tr.reduce((a, l) => a + Number(l.horas || 0), 0), aprobadas: aprob.reduce((a, l) => a + Number(l.horas_aprobadas || 0), 0), conAprob: aprob.length, trabajos: tr.length,
      piezas: pz.reduce((a, l) => a + Number(l.cantidad || 0), 0), lineasPieza: pz.length,
      pendFab: pz.filter((l) => l.origen_pieza === "fabricante" && !l.repuesto_recibido_at).length,
      pendStock: pz.filter((l) => l.origen_pieza !== "fabricante" && !l.repuesto_recibido_at).length,
      problemas: vivas.filter((l) => l.tipo === "problema").length, porMec };
  }
  function aviso(g, t) {
    const hEst = horas(g.estado_at || g.created_at), d = Math.floor(hEst / 24), e = g.estado;
    if (e === "consulta" && esCli(g) && hEst > 24) return { t: `Sin pedir información ${Math.max(1, d)} d`, c: "rojo" };
    if (e === "esperando_info" && hEst > 120) return { t: `Cliente sin enviar info ${d} d`, c: "rojo" };
    if (e === "analisis" && hEst > 72) return { t: esCli(g) && !g.cliente_informado_at ? `Sin responder al cliente ${d} d` : `Sin tramitar ${d} d`, c: "rojo" };
    if (e === "tramitada" && hEst > 168) return { t: `Fabricante ${d} d sin respuesta`, c: "ambar" };
    if ((e === "aprobada" || e === "parcial") && hEst > 72) return { t: `Sin cita ${d} d`, c: "rojo" };
    if (e === "cita_asignada" && g.cita_at) {
      const hc = (new Date(g.cita_at) - Date.now()) / 36e5;
      if (t && t.pendFab && hc < 72) return { t: `Faltan ${t.pendFab} pieza${t.pendFab > 1 ? "s" : ""} para la cita`, c: "rojo" };
      if (hc < -24) return { t: "Cita pasada: ¿cerrar?", c: "ambar" };
    }
    if (e === "cerrada" && t && t.pendStock) return { t: `${t.pendStock} pieza${t.pendStock > 1 ? "s" : ""} por reponer`, c: "ambar" };
    if (e === "cita_pedida" && g.cita_at && new Date(g.cita_at) < new Date()) return { t: "Cita pasada", c: "ambar" };
    return null;
  }
  function textoEventoG(ev) {
    const d = ev.detalle || {};
    if (ev.tipo === "g_creado") return `Expediente ${d.numero} creado`;
    if (ev.tipo === "g_linea_alta") return d.linea === "problema" ? `Problema añadido: “${d.descripcion || ""}”` : d.linea === "trabajo" ? `Trabajo: “${d.descripcion || ""}” · ${fmtH(d.horas)} solicitadas` : `Pieza: ${d.cantidad || 1} × ${d.referencia ? d.referencia + " " : ""}${d.descripcion || ""}`;
    if (ev.texto) return ev.texto;
    const pref = ev.tipo === "g_linea_cambio" ? `${d.linea === "problema" ? "Problema" : d.linea === "trabajo" ? "Trabajo" : "Pieza"} “${d.descripcion || ""}”: ` : "";
    const partes = Object.keys(d).filter((k) => ev.tipo !== "g_linea_cambio" || !["linea", "descripcion"].includes(k)).map((k) => {
      const v = d[k] || {};
      if (k === "estado") return `Estado: ${est(v.de).l} → ${est(v.a).l}`;
      if (k === "anulada") return v.a ? "anulado" : "reactivado";
      if (k === "repuesto_recibido_at") return v.a ? "pieza recibida / repuesta" : "desmarcada como recibida";
      if (k === "cobertura") return `Cobertura: ${(COBERTURA.find((x) => x[0] === v.de) || ["", "—"])[1]} → ${(COBERTURA.find((x) => x[0] === v.a) || ["", "—"])[1]}`;
      const f = (x) => (x == null || x === "" ? "—" : typeof x === "object" ? vehLinea(x) : /_at$/.test(k) ? fFechaHora(x) : String(x));
      return `${CAMPOS[k] || k}: ${f(v.de)} → ${f(v.a)}`;
    });
    return pref + (partes.join(" · ") || "cambio");
  }
  async function comprimir(file) {
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      return await new Promise((r) => c.toBlob((b) => r(b || file), "image/jpeg", 0.82));
    } catch (e) { return file; }
  }
  // Mensajes al cliente (se abren en WhatsApp o en el correo; quedan anotados en la bitácora)
  const nomPila = (c) => String((c && c.nombre) || "").trim().split(/\s+/)[0] || "";
  const vehCorto = (v) => [(v || {}).modelo, (v || {}).matricula ? normMat(v.matricula) : null].filter(Boolean).join(" · ") || "vehículo";
  const MSG = {
    pedir: (g) => `Hola ${nomPila(g.cliente)}, somos el taller de AC·LLAR. Para poder tramitar la garantía de tu ${vehCorto(g.vehiculo)}, envíanos por favor a ${POSVENTA} fotos de cada problema y una explicación detallada: qué ocurre, desde cuándo y dónde exactamente. Pon en el asunto: Garantía ${g.numero}${g.vehiculo && g.vehiculo.matricula ? " · " + normMat(g.vehiculo.matricula) : ""}. ¡Gracias!`,
    cobertura: (g, ls) => {
      const pr = ls.filter((l) => l.tipo === "problema" && !l.anulada);
      const bloque = (k, t) => { const xs = pr.filter((p) => p.cobertura === k); return xs.length ? `\n\n${t}:\n` + xs.map((p) => "- " + p.descripcion).join("\n") : ""; };
      return `Hola ${nomPila(g.cliente)}, hemos revisado lo que nos enviaste de tu ${vehCorto(g.vehiculo)}.` + bloque("cubre", "Lo tramitamos en garantía") + bloque("no_cubre", "No entra en garantía") + bloque("a_valorar", "Pendiente de valorar con el fabricante") +
        `\n\nTramitamos la garantía con ${g.fabricante || "el fabricante"} y te avisamos para darte cita en cuanto tengamos su respuesta y las piezas.` + (pr.some((p) => p.cobertura === "no_cubre") ? " Si quieres que reparemos también lo que no entra en garantía, te preparamos un presupuesto." : "");
    },
    cita: (g) => { const d = new Date(g.cita_at); return `Hola ${nomPila(g.cliente)}, te confirmamos la cita en el taller de AC·LLAR para tu ${vehCorto(g.vehiculo)}: ${["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"][d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)} a las ${pad(d.getHours())}:${pad(d.getMinutes())}.`; },
    recoger: (g) => `Hola ${nomPila(g.cliente)}, tu ${vehCorto(g.vehiculo)} ya está reparado y listo para recoger en el taller de AC·LLAR.`,
  };

  // =====================================================================
  function GarantiasView({ T, F, flota }) {
    const [lista, setLista] = useState([]); const [lineas, setLineas] = useState([]);
    const [cargando, setCargando] = useState(true); const [error, setError] = useState("");
    const [filtro, setFiltro] = useState("abiertas"); const [txt, setTxt] = useState("");
    const [abierta, setAbierta] = useState(() => { try { const x = localStorage.getItem("acllar_garantia_abrir"); if (x) localStorage.removeItem("acllar_garantia_abrir"); return x || null; } catch (e) { return null; } });
    const [nuevo, setNuevo] = useState(false); const [nueva, setNueva] = useState(false);
    const rol = window.acllarCloud && window.acllarCloud.rol ? window.acllarCloud.rol() : null;
    const sinAcceso = rol && rol !== "admin" && rol !== "comercial";
    const cargar = async () => {
      if (!sb() || sinAcceso) { setCargando(false); return; }
      const [a, b] = await Promise.all([
        sb().from("garantias").select("*, cliente:crm_clientes(id,nombre,apellidos,bc_no,tipo_cliente)").eq("archivado", false).order("created_at", { ascending: false }).limit(2000),
        sb().from("garantia_lineas").select("garantia_id,tipo,horas,horas_aprobadas,cantidad,origen_pieza,repuesto_recibido_at,anulada").limit(20000),
      ]);
      if (a.error) setError("No se pudieron cargar las garantías: " + a.error.message); else { setLista(a.data || []); setLineas(b.data || []); setError(""); }
      setCargando(false);
    };
    useEffect(() => { cargar(); const t = setInterval(cargar, 60000); return () => clearInterval(t); }, []);
    if (sinAcceso) return h("div", { style: { background: T.surface, border: `1px dashed ${T.border}`, borderRadius: "14px", padding: "36px", textAlign: "center", color: T.inkSoft } }, "Tu cuenta no tiene acceso a Garantías.");

    const tot = {}; lista.forEach((g) => { tot[g.id] = totales(lineas.filter((l) => l.garantia_id === g.id)); });
    const q = txt.trim().toLowerCase();
    const visibles = lista.filter((g) => (filtro === "abiertas" ? !est(g.estado).fin : filtro === "cerradas" ? est(g.estado).fin : true))
      .filter((g) => !q || [g.numero, g.fabricante, g.descripcion, g.reclamacion_no, vehLinea(g.vehiculo), g.vehiculo && g.vehiculo.bastidor, g.cliente && nombreCli(g.cliente)].join(" ").toLowerCase().includes(q));
    const cuenta = (xs) => lista.filter((g) => xs.includes(g.estado)).length;
    const kpis = [
      [cuenta(["consulta", "esperando_info", "analisis"]), "Consulta y análisis", "ambar"],
      [cuenta(["tramitada"]), "Esperando al fabricante", "azul"],
      [cuenta(["aprobada", "parcial"]), "Por dar cita", "ambar"],
      [cuenta(["cita_asignada"]), "Con cita", "verde"],
      [lista.filter((g) => g.estado === "cerrada" && tot[g.id].pendStock).length, "Piezas por reponer", "violeta"],
    ];
    const th = { fontSize: "11px", letterSpacing: ".08em", textTransform: "uppercase", color: T.inkSoft, fontWeight: 700, padding: "10px 12px", textAlign: "left", borderBottom: `1.5px solid ${T.border}` };
    const td = { padding: "11px 12px", borderBottom: `1px solid ${T.border}`, verticalAlign: "top", fontSize: "13.5px" };
    return h("div", { "data-garantias": "1", style: { fontFamily: F.body, color: T.ink, display: "flex", flexDirection: "column", gap: "16px" } },
      h("div", { style: { display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center" } },
        h("input", { type: "search", value: txt, onChange: (e) => setTxt(e.target.value), "aria-label": "Buscar garantía", placeholder: "Buscar por nº, nº de gestión del fabricante, matrícula, bastidor, cliente o fabricante", style: { ...inp(T), flex: "1 1 420px", height: "46px", borderRadius: "12px" } }),
        h("button", { "data-g-nueva": "1", onClick: () => setNueva(true), style: { ...btn(T, "p"), height: "46px", padding: "0 20px", fontSize: "15px" } }, "+ Nueva garantía")),
      h("div", { style: { display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap", alignItems: "center", marginTop: "-6px" } },
        h("span", { style: { fontSize: "12.5px", color: T.inkSoft } }, "Garantías de vehículos de clientes, propios o externos. Cada una queda también registrada como caso en Casos."),
        h("button", { "data-g-nuevo": "1", onClick: () => setNuevo(true), style: { border: "none", background: "transparent", color: T.inkSoft, fontSize: "12px", textDecoration: "underline", cursor: "pointer", fontFamily: "inherit" } }, "¿Es un vehículo de nuestra flota de alquiler?")),
      h("div", { style: { display: "flex", flexWrap: "wrap", gap: "10px" } }, kpis.map(([n, l, c]) => h("div", { key: l, style: { background: T.surface, border: `1px solid ${n ? CH[c].bd : T.border}`, borderRadius: "12px", padding: "10px 14px", minWidth: "150px" } },
        h("div", { style: { fontSize: "22px", fontWeight: 800, color: n ? CH[c].fg : T.inkFaint } }, n), h("div", { style: { fontSize: "12px", color: T.inkSoft, fontWeight: 700 } }, l)))),
      h(Seg, { T, opts: [["abiertas", "Abiertas"], ["cerradas", "Cerradas"], ["todas", "Todas"]], value: filtro, onChange: setFiltro }),
      error ? h("div", { style: { color: T.danger, fontSize: "13px" } }, error) : null,
      cargando ? h("div", { style: { color: T.inkFaint, fontSize: "13px" } }, "Cargando…")
        : !visibles.length ? h("div", { style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: "14px", padding: "28px", textAlign: "center", color: T.inkSoft } }, lista.length ? "Ningún expediente con ese filtro." : "Todavía no hay expedientes.")
        : h("div", { style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: "14px", overflowX: "auto" } },
          h("table", { style: { width: "100%", borderCollapse: "collapse", minWidth: "1040px" } },
            h("thead", null, h("tr", null, ["Nº", "Vehículo", "Cliente", "Fabricante · nº gestión", "Estado", "Horas sol. / apr.", "Piezas", "Entrada"].map((x) => h("th", { key: x, style: th }, x)))),
            h("tbody", null, visibles.map((g) => { const t = tot[g.id], s = est(g.estado), av = aviso(g, t);
              return h("tr", { key: g.id, "data-g-fila": g.numero, onClick: () => setAbierta(g.id), style: { cursor: "pointer" } },
                h("td", { style: { ...td, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, whiteSpace: "nowrap" } }, g.numero, g.tipo === "chasis" ? h("div", null, h(Chip, { c: "gris" }, "Chasis")) : null),
                h("td", { style: td }, h("b", null, vehLinea(g.vehiculo)), g.vehiculo && g.vehiculo.bastidor ? h("div", { style: { fontSize: "12px", color: T.inkSoft, fontFamily: "'JetBrains Mono', monospace" } }, g.vehiculo.bastidor) : null),
                h("td", { style: td }, esCli(g) ? h(React.Fragment, null, nombreCli(g.cliente), h(ChipCli, { c: g.cliente })) : h(Chip, { c: "gris" }, "Flota alquiler")),
                h("td", { style: td }, g.fabricante || "—", g.reclamacion_no ? h("div", { style: { fontSize: "12px", fontFamily: "'JetBrains Mono', monospace", color: T.inkSoft } }, g.reclamacion_no) : null),
                h("td", { style: td }, h(Chip, { c: s.c }, s.l), av ? h("div", { style: { marginTop: "4px" } }, h(Chip, { c: av.c }, av.t)) : null),
                h("td", { style: { ...td, fontWeight: 700, whiteSpace: "nowrap" } }, fmtH(t.horas), t.conAprob ? h("span", { style: { color: t.aprobadas < t.horas ? CH.rojo.fg : CH.verde.fg } }, " / " + fmtH(t.aprobadas)) : null),
                h("td", { style: td }, t.lineasPieza ? `${t.piezas} (${t.lineasPieza - t.pendFab - t.pendStock}/${t.lineasPieza} recibidas)` : "—"),
                h("td", { style: td }, fFecha(g.fecha_entrada || g.created_at)));
            })))),
      nueva ? h(NuevaConsulta, { T, F, inicial: { tipo: "garantia" }, onClose: () => setNueva(false), onCreated: (c, gid) => { setNueva(false); cargar(); if (gid) setAbierta(gid); } }) : null,
      nuevo ? h(NuevoExpediente, { T, F, flota, onClose: () => setNuevo(false), onCreated: (g) => { setNuevo(false); cargar(); setAbierta(g.id); } }) : null,
      abierta ? h(Expediente, { T, F, id: abierta, onClose: () => { setAbierta(null); cargar(); }, onChanged: cargar }) : null);
  }

  // ---------- crear expediente (también se usa desde Casos) ----------
  async function crearExpediente({ tipo, origen, cliente, bc, vehiculo, fabricante, descripcion, caso_id }) {
    let clienteId = cliente ? cliente.id : null;
    if (!clienteId && bc) {
      const ex = await sb().from("crm_clientes").select("id").eq("bc_no", bc.no).maybeSingle();
      if (ex.data) clienteId = ex.data.id;
      else { const ins = await sb().from("crm_clientes").insert({ bc_no: bc.no, nombre: bc.nombre || "(sin nombre)", telefono: bc.telefono, email: bc.email, direccion: bc.direccion, cp: bc.cp, ciudad: bc.ciudad, provincia: bc.provincia, nif: bc.nif }).select("id").single(); if (ins.error) throw ins.error; clienteId = ins.data.id; }
    }
    const estado = tipo === "chasis" ? "abierta" : origen === "flota" ? "analisis" : "consulta";
    const ins = await sb().from("garantias").insert({ tipo, origen, cliente_id: origen === "cliente" ? clienteId : null, caso_id: caso_id || null, vehiculo: vehiculo || {}, fabricante: fabricante || null, descripcion: descripcion || null, estado }).select("*").single();
    if (ins.error) throw ins.error;
    return ins.data;
  }
  window.AcllarGarantiasCrear = crearExpediente;

  function NuevoExpediente({ T, F, flota, onClose, onCreated }) {
    const [tipo, setTipo] = useState("garantia");
    const [qf, setQf] = useState(""); const [ac, setAc] = useState(null);
    const [fab, setFab] = useState("Benimar"); const [desc, setDesc] = useState("");
    const [err, setErr] = useState(""); const [guardando, setGuardando] = useState(false);
    const I = inp(T);
    useEffect(() => { setFab(tipo === "chasis" ? "Ford" : "Benimar"); }, [tipo]);
    const flotaF = (flota || []).filter((v) => !qf.trim() || [v.id, v.model, v.plate, v.brand].join(" ").toLowerCase().includes(qf.trim().toLowerCase())).slice(0, 12);
    const guardar = async () => {
      setErr(""); if (!ac) { setErr("Elige el vehículo de la flota."); return; }
      setGuardando(true);
      try { onCreated(await crearExpediente({ tipo, origen: "flota", vehiculo: { ac: ac.id, modelo: [ac.brand, ac.model].filter(Boolean).join(" "), matricula: ac.plate || "", bastidor: ac.vin || "" }, fabricante: fab, descripcion: desc.trim() })); }
      catch (e) { setErr("No se pudo crear: " + (e.message || e)); setGuardando(false); }
    };
    return h("div", { role: "dialog", "aria-label": "Nuevo expediente", style: { position: "fixed", inset: 0, zIndex: 1250, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "30px 12px" } },
      h("div", { onClick: onClose, style: { position: "fixed", inset: 0, background: "rgba(15,27,46,.35)" } }),
      h("div", { style: { position: "relative", width: "min(640px, 100%)", background: T.surface, borderRadius: "16px", border: `1px solid ${T.border}`, padding: "22px", display: "flex", flexDirection: "column", gap: "14px", fontFamily: F.body, color: T.ink } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } }, h("div", { style: { fontFamily: F.display, fontSize: "22px", fontWeight: 800 } }, "Garantía de un vehículo de alquiler"), h("button", { onClick: onClose, "aria-label": "Cerrar", style: { border: "none", background: "transparent", cursor: "pointer", fontSize: "22px", color: T.inkSoft } }, "×")),
        h("div", { style: { fontSize: "12.5px", color: T.inkSoft } }, "Solo para vehículos de nuestra flota. Para un cliente usa “+ Nueva garantía”."),
        h("div", null, h("div", { style: { fontSize: "12px", fontWeight: 800, color: T.inkSoft, marginBottom: "5px" } }, "Tipo"), h(Seg, { T, opts: [["garantia", "Garantía"], ["chasis", "Gestión de chasis"]], value: tipo, onChange: setTipo })),
        ac ? h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", background: T.bg, borderRadius: "10px", padding: "10px 12px" } }, h("b", null, `${ac.id} · ${[ac.brand, ac.model].filter(Boolean).join(" ")} · ${ac.plate || "sin matrícula"}`), h("button", { onClick: () => setAc(null), style: btn(T, "s") }, "Cambiar"))
          : h("div", null, h(Field, { T, label: "Vehículo de la flota" }, h("input", { value: qf, onChange: (e) => setQf(e.target.value), placeholder: (flota || []).length ? "AC-xxx, modelo o matrícula" : "La flota no está disponible en esta cuenta", style: I })),
            h("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "6px" } }, flotaF.map((v) => h("button", { key: v.id, onClick: () => setAc(v), style: btn(T, "s") }, `${v.id} · ${v.model || v.brand || ""} · ${v.plate || "—"}`)))),
        h("div", null, h("div", { style: { fontSize: "12px", fontWeight: 800, color: T.inkSoft, marginBottom: "5px" } }, "Fabricante"), h(Seg, { T, opts: tipo === "chasis" ? FAB_CHASIS : FAB_GARANTIA, value: fab, onChange: setFab })),
        h(Field, { T, label: tipo === "chasis" ? "Qué hay que gestionar" : "Descripción general (opcional)" }, h("textarea", { rows: 2, value: desc, onChange: (e) => setDesc(e.target.value), style: { ...I, resize: "vertical" } })),
        err ? h("div", { style: { color: T.danger, fontSize: "13px" } }, err) : null,
        h("div", { style: { display: "flex", justifyContent: "flex-end", gap: "10px" } }, h("button", { onClick: onClose, style: btn(T) }, "Cancelar"), h("button", { "data-g-crear": "1", onClick: guardar, disabled: guardando, style: btn(T, "p") }, guardando ? "Creando…" : "Crear expediente"))));
  }

  // Ficha del cliente de Casos, abierta desde un expediente
  function FichaCliente({ T, F, id, onClose, onChanged }) {
    const [datos, setDatos] = useState(null);
    useEffect(() => { (async () => {
      const c = await sb().from("crm_clientes").select("bc_no").eq("id", id).maybeSingle();
      const [a, b] = await Promise.all([sb().from("crm_casos").select("*, cliente:crm_clientes(*)").eq("cliente_id", id).limit(200), c.data && c.data.bc_no ? sb().from("bc_servicio").select("*").eq("cliente_no", c.data.bc_no) : Promise.resolve({ data: [] })]);
      setDatos({ casos: a.data || [], bcServ: b.data || [] });
    })(); }, [id]);
    if (!datos) return null;
    return h(ClientePanel, { T, F, id, casos: datos.casos, bcServ: datos.bcServ, onClose: () => { onClose(); onChanged && onChanged(); },
      onCaso: (cid) => irA("clientes", { acllar_crm_abrir_caso: cid }), onNueva: () => irA("clientes", { acllar_crm_abrir_cliente: id }), onChanged });
  }

  // ---------- expediente ----------
  function Expediente({ T, F, id, onClose, onChanged }) {
    const [g, setG] = useState(null); const [ls, setLs] = useState([]); const [fotos, setFotos] = useState([]); const [urls, setUrls] = useState({}); const [ev, setEv] = useState([]);
    const [d, setD] = useState({}); const [msg, setMsg] = useState(""); const [trab, setTrab] = useState(false);
    const [nuevoProb, setNuevoProb] = useState(""); const [verFoto, setVerFoto] = useState(null);
    const [pend, setPend] = useState(null); const [citaTmp, setCitaTmp] = useState(""); const [codTmp, setCodTmp] = useState("");
    const [verFicha, setVerFicha] = useState(false); const [bitKey, setBitKey] = useState(0); const [alta, setAlta] = useState("");
    const I = inp(T);
    const cargar = async () => {
      const [a, b, c, e] = await Promise.all([
        sb().from("garantias").select("*, cliente:crm_clientes(*)").eq("id", id).maybeSingle(),
        sb().from("garantia_lineas").select("*").eq("garantia_id", id).order("orden").order("created_at"),
        sb().from("garantia_fotos").select("*").eq("garantia_id", id).eq("anulada", false).order("created_at"),
        sb().from("crm_eventos").select("*").eq("garantia_id", id).order("at", { ascending: false }).limit(300),
      ]);
      setG(a.data); setLs(b.data || []); setFotos(c.data || []); setEv((e.data || []).filter((x) => !BITACORA.includes(x.tipo)));
      if (a.data) {
        const x = a.data, v = x.vehiculo || {};
        setD({ tipo: x.tipo, fabricante: x.fabricante || "", descripcion: x.descripcion || "", reclamacion_no: x.reclamacion_no || "", concesionario: x.concesionario || "", cita_at: toLocalInput(x.cita_at), notas: x.notas || "", modelo: v.modelo || "", matricula: v.matricula || "", bastidor: v.bastidor || "" });
        setCodTmp(x.reclamacion_no || "");
      }
      const paths = (c.data || []).map((f) => f.path).filter((p) => !urls[p]);
      if (paths.length) { const s = await sb().storage.from("garantias").createSignedUrls(paths, 3600); const m = { ...urls }; (s.data || []).forEach((y) => { if (y.signedUrl) m[y.path] = y.signedUrl; }); setUrls(m); }
    };
    useEffect(() => { cargar(); }, [id]);
    if (!g) return h(Drawer, { T, onClose, width: 900, label: "Expediente de garantía" }, h("div", { style: { padding: "24px", color: T.inkSoft } }, "Cargando…"));
    const s = est(g.estado), t = totales(ls), av = aviso(g, t), chasis = g.tipo === "chasis", cli = g.cliente;
    const anotar = async (clase, texto) => { await sb().from("crm_eventos").insert({ tipo: "bitacora", detalle: { clase }, texto, garantia_id: g.id, caso_id: g.caso_id || null, cliente_id: g.cliente_id || null }); setBitKey((k) => k + 1); };
    const upd = async (patch, texto) => {
      setTrab(true); setMsg("");
      const p = {}; Object.keys(patch).forEach((k) => { p[k] = patch[k] === NOW ? new Date().toISOString() : patch[k]; });
      const { error } = await sb().from("garantias").update(p).eq("id", g.id); setTrab(false);
      if (error) { setMsg("No se pudo guardar: " + error.message); return false; }
      if (texto) setMsg(texto); await cargar(); onChanged && onChanged(); return true;
    };
    const paso = async (x) => {
      if ((x.cita || x.codigo) && (!pend || pend.to !== x.to)) { setPend(x); setCitaTmp(d.cita_at || ""); return; }
      const patch = { estado: x.to, ...(x.set || {}) };
      if (x.cita) { if (!citaTmp) { setMsg("Pon la fecha y hora de la cita."); return; } patch.cita_at = fromLocalInput(citaTmp); }
      if (x.codigo && codTmp.trim()) patch.reclamacion_no = codTmp.trim();
      if (await upd(patch)) setPend(null);
    };
    // Abre WhatsApp o el correo con el mensaje, lo anota en la bitácora y avanza el estado
    const enviar = async (canal, texto, asunto, clase, resumen, patch) => {
      if (canal === "wa") { const tel = telWa(cli && cli.telefono); if (!tel) { setMsg("El cliente no tiene teléfono en su ficha."); return; } window.open(`https://wa.me/${tel}?text=${encodeURIComponent(texto)}`, "_blank", "noopener"); }
      else { if (!cli || !cli.email) { setMsg("El cliente no tiene email en su ficha."); return; } window.open(`mailto:${cli.email}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(texto)}`, "_blank"); }
      await anotar(clase, `${resumen} por ${canal === "wa" ? "WhatsApp" : "email"}:\n${texto}`);
      if (patch) await upd(patch, "Mensaje abierto y anotado en la bitácora.");
      else setMsg("Mensaje abierto y anotado en la bitácora.");
    };
    const problemas = ls.filter((l) => l.tipo === "problema" && !l.anulada);
    const sinCob = problemas.filter((p) => !p.cobertura).length;
    const noCubre = problemas.filter((p) => p.cobertura === "no_cubre");
    const botonesMsg = (tipo) => {
      const pares = [["wa", "💬 WhatsApp"], ["email", "✉ Email"]];
      if (tipo === "pedir") return pares.map(([c, l]) => h("button", { key: c, "data-g-msg": "pedir-" + c, disabled: trab, onClick: () => enviar(c, MSG.pedir(g), `Garantía ${g.numero} · fotos y explicación`, "pedi", "Le pedí fotos y explicación", g.estado === "consulta" ? { estado: "esperando_info", info_pedida_at: NOW } : { info_pedida_at: NOW }), style: btn(T, c === "wa" ? "wa" : undefined) }, `${l}: pedir fotos y explicación`));
      if (tipo === "cobertura") return pares.map(([c, l]) => h("button", { key: c, "data-g-msg": "cob-" + c, disabled: trab || !problemas.length || sinCob > 0, onClick: () => enviar(c, MSG.cobertura(g, ls), `Garantía ${g.numero} · qué cubre`, "respondi", "Le informé de qué cubre la garantía", { cliente_informado_at: NOW }), style: btn(T, c === "wa" ? "wa" : undefined) }, `${l}: informar qué cubre y qué no`));
      if (tipo === "cita") return g.cita_at ? pares.map(([c, l]) => h("button", { key: c, disabled: trab, onClick: () => enviar(c, MSG.cita(g), `Cita en el taller · ${g.numero}`, "respondi", "Le confirmé la cita"), style: btn(T, c === "wa" ? "wa" : undefined) }, `${l}: enviar la cita`)) : null;
      if (tipo === "telefono") return h("button", { key: "tel", disabled: trab, onClick: async () => { await anotar("respondi", "Le informé por teléfono de qué cubre la garantía y qué no."); await upd({ cliente_informado_at: NOW }, "Anotado en la bitácora."); }, style: btn(T, "s") }, "Se lo dije por teléfono");
      if (tipo === "recoger") return pares.map(([c, l]) => h("button", { key: c, disabled: trab, onClick: () => enviar(c, MSG.recoger(g), `Tu vehículo está listo · ${g.numero}`, "respondi", "Le avisé para recoger", { estado: "avisado" }), style: btn(T, c === "wa" ? "wa" : undefined) }, `${l}: avisar para recoger`));
      return null;
    };
    const guardarDatos = () => {
      const v = { ...(g.vehiculo || {}), modelo: d.modelo.trim(), matricula: normMat(d.matricula), bastidor: normMat(d.bastidor) };
      const p = {};
      [["fabricante", d.fabricante], ["descripcion", d.descripcion], ["reclamacion_no", d.reclamacion_no], ["concesionario", d.concesionario], ["notas", d.notas]].forEach(([k, x]) => { const y = String(x || "").trim() || null; if (y !== (g[k] || null)) p[k] = y; });
      const cita = fromLocalInput(d.cita_at); if ((cita ? Math.floor(new Date(cita) / 6e4) : null) !== (g.cita_at ? Math.floor(new Date(g.cita_at) / 6e4) : null)) p.cita_at = cita;
      if (JSON.stringify(v) !== JSON.stringify(g.vehiculo || {})) p.vehiculo = v;
      if (d.tipo !== g.tipo) { p.tipo = d.tipo; p.estado = d.tipo === "chasis" ? "abierta" : esCli(g) ? "consulta" : "analisis"; }
      if (!Object.keys(p).length) { setMsg("No hay cambios."); return; }
      upd(p, "Guardado.");
    };
    const addLinea = async (row) => { const { error } = await sb().from("garantia_lineas").insert({ garantia_id: g.id, orden: ls.length, ...row }); if (error) { setMsg("No se pudo añadir: " + error.message); return false; } await cargar(); onChanged && onChanged(); return true; };
    const updLinea = async (lid, patch) => { const { error } = await sb().from("garantia_lineas").update(patch).eq("id", lid); if (error) setMsg("No se pudo guardar: " + error.message); await cargar(); onChanged && onChanged(); };
    const subirFotos = async (files, lineaId, etiqueta) => {
      if (!files || !files.length) return;
      setTrab(true); setMsg(`Subiendo ${files.length} foto${files.length > 1 ? "s" : ""}…`);
      let ok = 0, fallo = "";
      for (const f of Array.from(files)) {
        const blob = await comprimir(f);
        const path = `${g.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
        const up = await sb().storage.from("garantias").upload(path, blob, { contentType: "image/jpeg", upsert: false });
        if (up.error) { fallo = up.error.message; continue; }
        const ins = await sb().from("garantia_fotos").insert({ garantia_id: g.id, linea_id: lineaId || null, path, etiqueta: etiqueta || "otra", nombre: f.name || null });
        if (!ins.error) ok++; else fallo = ins.error.message;
      }
      if (ok) await sb().from("crm_eventos").insert({ garantia_id: g.id, tipo: "g_foto", texto: `${ok} foto${ok > 1 ? "s" : ""} añadida${ok > 1 ? "s" : ""} (${(ETIQUETAS.find((x) => x[0] === etiqueta) || ["", "otra"])[1].toLowerCase()})` });
      setTrab(false); setMsg(fallo ? "No se pudo subir alguna foto: " + fallo : `${ok} foto${ok > 1 ? "s" : ""} subida${ok > 1 ? "s" : ""}.`); cargar();
    };
    const anularFoto = async (f) => { await sb().from("garantia_fotos").update({ anulada: true }).eq("id", f.id); await sb().from("crm_eventos").insert({ garantia_id: g.id, tipo: "g_foto", texto: "Foto retirada del expediente" }); setVerFoto(null); cargar(); };
    const altaBC = async () => { setAlta("Comprobando y creando en BC…"); const r = await enviarABC(g.cliente_id, false); setAlta(r.duplicados ? "En BC ya hay clientes que coinciden: revísalo en la ficha." : r.ok ? `Dado de alta en BC como ${r.bc_no}.` : "No se pudo: " + (r.error || "error")); cargar(); };
    const crearPresupuesto = async () => {
      setTrab(true); setMsg("");
      const manana = new Date(Date.now() + 864e5); manana.setHours(13, 0, 0, 0);
      const ins = await sb().from("crm_casos").insert({ cliente_id: g.cliente_id, vehiculo: vehTxt(g.vehiculo) || null, canal: "otro", tipo: "reparacion", estado: "presupuesto_por_hacer",
        consulta: `Fuera de garantía (${g.numero}):\n` + (noCubre.length ? noCubre.map((p) => "- " + p.descripcion).join("\n") : g.descripcion || ""), proxima_accion: "Hacer presupuesto de lo no cubierto por la garantía", responsable: yo() || null, fecha_limite: manana.toISOString() }).select("id").single();
      if (ins.error) { setTrab(false); setMsg("No se pudo crear el caso: " + ins.error.message); return; }
      await upd({ presupuesto_caso_id: ins.data.id }, "Caso de presupuesto creado en Casos.");
      await anotar("nota", `Creado caso de presupuesto en Casos por lo que no cubre la garantía.`);
    };
    const resumen = () => abrirResumen(g, ls, fotos, urls, t);
    const sig = s.sig.filter(pasoVisible(g));
    const lblFase = (i) => { const done = s.fin || (s.f != null && i < s.f), cur = i === s.f; return h("div", { key: i, style: { borderRadius: "6px", padding: "6px 2px", background: cur ? T.rust : done ? CH.verde.bg : T.bgAlt, color: cur ? "#fff" : done ? CH.verde.fg : T.inkSoft } }, FASES[i]); };

    return h(Drawer, { T, onClose, width: 900, label: "Expediente de garantía" },
      h("div", { style: { background: T.surface, padding: "18px 22px", borderBottom: `1px solid ${T.border}`, display: "flex", flexDirection: "column", gap: "6px" } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" } },
          h("span", { style: { fontSize: "12px", color: T.inkSoft, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" } }, `${chasis ? "Gestión de chasis" : "Garantía"} · ${g.fabricante || "sin fabricante"} · ${esCli(g) ? (cli && cli.tipo_cliente === "propio" ? "Cliente propio" : cli && cli.tipo_cliente === "externo" ? "Cliente externo" : "Cliente") : "Vehículo de alquiler"}`),
          h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } }, h("button", { "data-g-resumen": "1", onClick: resumen, style: btn(T) }, "Resumen para el fabricante"), h("button", { onClick: onClose, "aria-label": "Cerrar", style: { border: "none", background: "transparent", cursor: "pointer", fontSize: "22px", color: T.inkSoft } }, "×"))),
        h("div", { style: { fontFamily: F.display, fontSize: "24px", fontWeight: 800 } }, h("span", { style: { fontFamily: "'JetBrains Mono', monospace" } }, g.numero), " · ", vehLinea(g.vehiculo)),
        h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", fontSize: "13.5px", color: T.inkSoft } },
          g.reclamacion_no ? h(Chip, { c: "violeta" }, "Nº de gestión ", h("span", { style: { fontFamily: "'JetBrains Mono', monospace" } }, g.reclamacion_no)) : !chasis && s.f >= 2 && !s.fin ? h(Chip, { c: "rojo" }, "Falta el nº de gestión del fabricante") : null,
          g.vehiculo && g.vehiculo.bastidor ? h("span", null, "Bastidor ", h("span", { style: { fontFamily: "'JetBrains Mono', monospace" } }, g.vehiculo.bastidor)) : null,
          h("span", null, `Entrada ${fFecha(g.fecha_entrada || g.created_at)}`), g.cita_at ? h("span", null, `· Cita ${fLarga(g.cita_at)}`) : null),
        g.caso_id ? h("button", { onClick: () => irA("clientes", { acllar_crm_abrir_caso: g.caso_id }), style: { ...btn(T, "s"), alignSelf: "flex-start" } }, "Ver el caso de entrada en Casos →") : null),
      h("div", { style: { padding: "16px 22px 40px", display: "flex", flexDirection: "column", gap: "14px" } },
        // ---- estado y siguiente paso
        h(Box, { T }, h(Lbl, { T }, "Recorrido"),
          !chasis ? h("div", { style: { display: "grid", gridTemplateColumns: "repeat(5, minmax(0,1fr))", gap: "4px", fontSize: "10.5px", fontWeight: 700, textAlign: "center", marginBottom: "12px" } }, FASES.map((_, i) => lblFase(i))) : null,
          h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } }, h("span", { style: { fontSize: "12px", color: T.inkSoft } }, "Estado actual"), h(Chip, { c: s.c, style: { fontSize: "13px" } }, s.l), av ? h(Chip, { c: av.c }, av.t) : null),
          !s.fin ? h("div", { style: { display: "flex", flexDirection: "column", gap: "6px", marginTop: "10px" } },
            h("div", { style: { fontSize: "12px", color: T.inkSoft, fontWeight: 700 } }, "Siguiente paso"),
            esCli(g) && ["consulta", "esperando_info"].includes(g.estado) ? h("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } }, botonesMsg("pedir")) : null,
            esCli(g) && g.estado === "analisis" ? h(React.Fragment, null,
              !problemas.length ? h("div", { style: { fontSize: "12.5px", color: T.warn } }, "Añade abajo los problemas y marca en cada uno si cubre la garantía.")
                : sinCob ? h("div", { style: { fontSize: "12.5px", color: T.warn } }, `Falta marcar la cobertura de ${sinCob} problema${sinCob > 1 ? "s" : ""}.`) : null,
              g.cliente_informado_at ? h("div", { style: { fontSize: "12.5px", color: T.ok } }, `✓ Cliente informado el ${fLarga(g.cliente_informado_at)}`) : null,
              h("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" } }, botonesMsg("cobertura"), botonesMsg("telefono"))) : null,
            esCli(g) && g.estado === "cita_asignada" ? h("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } }, botonesMsg("cita")) : null,
            g.estado === "cita_asignada" && t.pendFab ? h("div", { style: { fontSize: "12.5px", color: T.warn } }, `Antes de la cita marca como recibidas las piezas del fabricante (faltan ${t.pendFab}).`) : null,
            sig.map((x, i) => h("button", { key: i, "data-g-paso": x.to, disabled: trab, onClick: () => paso(x), style: { ...btn(T, i === 0 && !(esCli(g) && ["consulta", "esperando_info"].includes(g.estado)) ? "p" : undefined), textAlign: "left" } }, "→ " + x.l)),
            pend ? h("div", { style: { display: "flex", gap: "8px", alignItems: "flex-end", background: T.bg, borderRadius: "10px", padding: "10px", flexWrap: "wrap" } },
              pend.codigo ? h(Field, { T, label: "Nº de gestión que da el fabricante", style: { flex: 1 } }, h("input", { "data-g-codigo": "1", value: codTmp, onChange: (e) => setCodTmp(e.target.value), placeholder: "p. ej. RT-2026-0554", style: { ...I, fontFamily: "'JetBrains Mono', monospace" } })) : null,
              pend.cita ? h(Field, { T, label: "Fecha y hora de la cita", style: { flex: 1 } }, h("input", { type: "datetime-local", "data-g-cita": "1", value: citaTmp, onChange: (e) => setCitaTmp(e.target.value), style: I })) : null,
              h("button", { "data-g-confirmar": "1", disabled: trab || (pend.cita && !citaTmp), onClick: () => paso(pend), style: btn(T, "p") }, pend.codigo && !codTmp.trim() ? "Confirmar sin nº (lo pongo luego)" : "Confirmar"), h("button", { onClick: () => setPend(null), style: btn(T) }, "Cancelar")) : null,
            pend && pend.codigo ? h("div", { style: { fontSize: "12px", color: T.inkSoft } }, "El seguimiento de la tramitación se lleva en la web del fabricante. Aquí solo queda la fecha y su nº de gestión.") : null,
            pend && pend.cita ? h("div", { style: { fontSize: "12px", color: T.inkSoft } }, "Pon una fecha en la que sepas que las piezas ya habrán llegado.") : null)
            : h("button", { onClick: () => upd({ estado: chasis ? "abierta" : "analisis" }, "Expediente reabierto."), style: { ...btn(T), marginTop: "10px" } }, "Reabrir"),
          msg ? h("div", { style: { marginTop: "8px", fontSize: "12.5px", color: /^No se|no tiene/.test(msg) ? T.danger : T.ok } }, msg) : null),

        // ---- cliente
        esCli(g) && cli ? h(Box, { T }, h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" } }, h(Lbl, { T }, "Cliente"), h("button", { "data-g-ficha": "1", onClick: () => setVerFicha(true), style: { ...btn(T, "s"), marginBottom: "8px" } }, "Ver / editar ficha")),
          h("div", { style: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px" } }, h("b", { style: { fontSize: "16px" } }, nombreCli(cli)), h(ChipCli, { c: cli }),
            cli.bc_no ? h(Chip, { c: "verde" }, "BC ", h("span", { style: { fontFamily: "'JetBrains Mono', monospace" } }, cli.bc_no)) : h(Chip, { c: "ambar" }, "Pendiente de alta en BC")),
          h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px", fontSize: "13px", marginTop: "8px" } },
            [["Teléfono", cli.telefono], ["Email", cli.email], ["Dirección", cli.direccion], ["Población", [cli.cp, cli.ciudad, cli.provincia].filter(Boolean).join(" · ")], ["NIF", cli.nif]].map(([k, v]) => h("div", { key: k }, h("span", { style: { color: T.inkSoft } }, k + ": "), v || "—"))),
          !cli.tipo_cliente ? h("div", { style: { fontSize: "12px", color: T.warn, marginTop: "6px" } }, "Falta marcar si es cliente propio o externo (en la ficha).") : null,
          !cli.bc_no ? h("div", { style: { display: "flex", gap: "8px", alignItems: "center", marginTop: "8px", flexWrap: "wrap" } }, h("button", { onClick: altaBC, style: btn(T, "p") }, "Dar de alta en BC (cliente y vehículo)"), alta ? h("span", { style: { fontSize: "12.5px", color: /No se|coinciden/.test(alta) ? T.danger : T.ok } }, alta) : null) : null) : null,

        // ---- bitácora
        h(Bitacora, { T, caso_id: g.caso_id || null, garantia_id: g.id, cliente_id: g.cliente_id || null, titulo: "Bitácora del expediente", recargar: bitKey }),

        // ---- fotos generales
        h(Box, { T }, h(Lbl, { T }, `Fotos y documentación (${fotos.filter((f) => !f.linea_id).length})`),
          h("div", { style: { fontSize: "12px", color: T.inkSoft, marginTop: "-4px", marginBottom: "6px" } }, `Las fotos que manda el cliente a ${POSVENTA}, fotos del taller, de la placa del bastidor, etc. Las de cada problema, mejor dentro del problema.`),
          h(Fotos, { T, fotos: fotos.filter((f) => !f.linea_id), urls, onVer: setVerFoto }),
          h(SubirFotos, { T, trab, inicial: s.f != null && s.f <= 1 ? "cliente" : "antes", onFiles: (fs, et) => subirFotos(fs, null, et) })),

        // ---- problemas
        !chasis ? h(Box, { T }, h(Lbl, { T }, `Problemas (${problemas.length})`),
          h("div", { style: { fontSize: "12px", color: T.inkSoft, marginTop: "-4px", marginBottom: "8px" } }, "Cada problema: si lo cubre la garantía, los trabajos con las horas que solicitas (y luego las que aprueba el fabricante), las piezas y sus fotos."),
          problemas.map((p, i) => h(Problema, { key: p.id, T, n: i + 1, p, g, ls, fotos: fotos.filter((f) => f.linea_id === p.id), urls, trab, addLinea, updLinea, subirFotos, onVerFoto: setVerFoto })),
          ls.some((l) => l.tipo === "problema" && l.anulada) ? h("div", { style: { fontSize: "12.5px", color: T.inkSoft, display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" } }, "Anulados:",
            ls.filter((l) => l.tipo === "problema" && l.anulada).map((l) => h("button", { key: l.id, onClick: () => updLinea(l.id, { anulada: false }), title: "Reactivar", style: { ...btn(T, "s"), textDecoration: "line-through", color: T.inkSoft } }, l.descripcion || "(sin descripción)"))) : null,
          h("div", { style: { display: "flex", gap: "8px", marginTop: "10px" } },
            h("input", { value: nuevoProb, onChange: (e) => setNuevoProb(e.target.value), onKeyDown: async (e) => { if (e.key === "Enter" && nuevoProb.trim()) { if (await addLinea({ tipo: "problema", descripcion: nuevoProb.trim() })) setNuevoProb(""); } }, placeholder: "Nuevo problema (p. ej. Filtración en claraboya trasera)", "aria-label": "Nuevo problema", style: I }),
            h("button", { "data-g-add-prob": "1", disabled: trab || !nuevoProb.trim(), onClick: async () => { if (await addLinea({ tipo: "problema", descripcion: nuevoProb.trim() })) setNuevoProb(""); }, style: btn(T, "p") }, "Añadir problema"))) : null,

        // ---- totales
        !chasis ? h(Box, { T }, h(Lbl, { T }, "Totales"),
          h("div", { style: { display: "flex", gap: "22px", flexWrap: "wrap", alignItems: "baseline" } },
            h("div", null, h("div", { style: { fontSize: "26px", fontWeight: 800 } }, fmtH(t.horas)), h("div", { style: { fontSize: "12px", color: T.inkSoft } }, "horas solicitadas")),
            h("div", null, h("div", { style: { fontSize: "26px", fontWeight: 800, color: !t.conAprob ? T.inkFaint : t.aprobadas < t.horas ? CH.rojo.fg : CH.verde.fg } }, t.conAprob ? fmtH(t.aprobadas) : "—"), h("div", { style: { fontSize: "12px", color: T.inkSoft } }, t.conAprob ? `aprobadas (${t.conAprob}/${t.trabajos} trabajos)` : "aprobadas")),
            h("div", null, h("div", { style: { fontSize: "26px", fontWeight: 800 } }, t.piezas), h("div", { style: { fontSize: "12px", color: T.inkSoft } }, `piezas (${t.lineasPieza} referencias)`)),
            h("div", null, h("div", { style: { fontSize: "26px", fontWeight: 800, color: t.pendFab + t.pendStock ? CH.ambar.fg : CH.verde.fg } }, t.lineasPieza - t.pendFab - t.pendStock, "/", t.lineasPieza), h("div", { style: { fontSize: "12px", color: T.inkSoft } }, "recibidas / repuestas")),
            h("div", { style: { fontSize: "12.5px", color: T.inkSoft } }, Object.entries(t.porMec).map(([m, n]) => `${m}: ${fmtH(n)}`).join(" · ")))) : null,

        // ---- lo que no cubre
        esCli(g) && !chasis && (noCubre.length || g.estado === "rechazada" || g.presupuesto_caso_id) ? h(Box, { T, tone: "rojo" }, h(Lbl, { T }, "Lo que no cubre la garantía"),
          noCubre.length ? h("ul", { style: { margin: "0 0 8px", paddingLeft: "18px", fontSize: "13.5px" } }, noCubre.map((p) => h("li", { key: p.id }, p.descripcion))) : g.estado === "rechazada" ? h("div", { style: { fontSize: "13px", marginBottom: "8px" } }, "El fabricante ha rechazado la garantía.") : null,
          g.presupuesto_caso_id ? h("button", { onClick: () => irA("clientes", { acllar_crm_abrir_caso: g.presupuesto_caso_id }), style: btn(T) }, "Ver el caso de presupuesto en Casos →")
            : h(React.Fragment, null, h("div", { style: { fontSize: "12.5px", color: T.inkSoft, marginBottom: "6px" } }, "Si el cliente quiere repararlo igualmente, se lleva como un caso normal en Casos (presupuesto, pedido de servicio y señal si hace falta)."),
              h("button", { "data-g-presupuesto": "1", onClick: crearPresupuesto, disabled: trab, style: btn(T, "p") }, "Crear caso de presupuesto en Casos"))) : null,

        // ---- datos
        h(Box, { T }, h(Lbl, { T }, chasis ? "Gestión con el concesionario" : "Datos del expediente"),
          h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" } },
            h("div", { style: { gridColumn: "1 / -1" } }, h("div", { style: { fontSize: "12px", fontWeight: 800, color: T.inkSoft, marginBottom: "5px" } }, "Tipo"), h(Seg, { T, opts: [["garantia", "Garantía (vivienda)"], ["chasis", "Gestión de chasis"]], value: d.tipo, onChange: (v) => setD((x) => ({ ...x, tipo: v, fabricante: v === "chasis" ? "Ford" : "Benimar" })) })),
            h(Field, { T, label: "Fabricante" }, h("select", { value: d.fabricante, onChange: (e) => setD((x) => ({ ...x, fabricante: e.target.value })), style: I }, h("option", { value: "" }, "—"), (d.tipo === "chasis" ? FAB_CHASIS : FAB_GARANTIA).map(([k, l]) => h("option", { key: k, value: k }, l)))),
            h(Field, { T, label: chasis ? "Nº de expediente / referencia" : "Nº de gestión del fabricante" }, h("input", { "data-g-cod-datos": "1", value: d.reclamacion_no, onChange: (e) => setD((x) => ({ ...x, reclamacion_no: e.target.value })), style: { ...I, fontFamily: "'JetBrains Mono', monospace" } })),
            chasis ? h(Field, { T, label: "Concesionario / taller oficial" }, h("input", { value: d.concesionario, onChange: (e) => setD((x) => ({ ...x, concesionario: e.target.value })), style: I })) : null,
            h(Field, { T, label: "Cita" }, h("input", { type: "datetime-local", value: d.cita_at || "", onChange: (e) => setD((x) => ({ ...x, cita_at: e.target.value })), style: I })),
            h(Field, { T, label: "Modelo" }, h("input", { value: d.modelo, onChange: (e) => setD((x) => ({ ...x, modelo: e.target.value })), style: I })),
            h(Field, { T, label: "Matrícula" }, h("input", { value: d.matricula, onChange: (e) => setD((x) => ({ ...x, matricula: e.target.value })), style: I })),
            h(Field, { T, label: "Bastidor", style: { gridColumn: "1 / -1" } }, h("input", { value: d.bastidor, onChange: (e) => setD((x) => ({ ...x, bastidor: e.target.value })), style: { ...I, fontFamily: "'JetBrains Mono', monospace" } })),
            h(Field, { T, label: chasis ? "Qué hay que gestionar" : "Descripción general (lo que cuenta el cliente)", style: { gridColumn: "1 / -1" } }, h("textarea", { rows: 3, value: d.descripcion, onChange: (e) => setD((x) => ({ ...x, descripcion: e.target.value })), style: { ...I, resize: "vertical" } })),
            h(Field, { T, label: "Notas internas", style: { gridColumn: "1 / -1" } }, h("textarea", { rows: 2, value: d.notas, onChange: (e) => setD((x) => ({ ...x, notas: e.target.value })), style: { ...I, resize: "vertical" } }))),
          d.tipo !== g.tipo ? h("div", { style: { fontSize: "12px", color: T.warn, marginTop: "6px" } }, "Al guardar el cambio de tipo, el expediente vuelve al primer paso de su recorrido.") : null,
          h("button", { "data-g-guardar": "1", onClick: guardarDatos, disabled: trab, style: { ...btn(T, "p"), marginTop: "10px" } }, "Guardar datos")),

        h(Box, { T }, h(Lbl, { T }, "Cambios automáticos · estados, horas, piezas y fotos"),
          h("ol", { style: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "9px", fontSize: "13px" } },
            ev.map((e) => h("li", { key: e.id, style: { display: "grid", gridTemplateColumns: "84px 1fr", gap: "8px" } }, h("span", { style: { color: T.inkSoft } }, fFechaHora(e.at)), h("span", null, h("b", null, quien(e.autor)), " · ", textoEventoG(e))))))),
      verFicha && g.cliente_id ? h(FichaCliente, { T, F, id: g.cliente_id, onClose: () => setVerFicha(false), onChanged: cargar }) : null,
      verFoto ? h("div", { role: "dialog", "aria-label": "Foto", onClick: () => setVerFoto(null), style: { position: "fixed", inset: 0, zIndex: 1300, background: "rgba(0,0,0,.85)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", padding: "20px" } },
        h("img", { src: urls[verFoto.path], alt: verFoto.etiqueta || "foto", style: { maxWidth: "100%", maxHeight: "82vh", borderRadius: "8px" } }),
        h("div", { style: { color: "#fff", fontSize: "13px" } }, `${(ETIQUETAS.find((x) => x[0] === verFoto.etiqueta) || ["", "Foto"])[1]} · ${fLarga(verFoto.created_at)} · ${quien(verFoto.created_by)}`),
        h("div", { onClick: (e) => e.stopPropagation(), style: { display: "flex", gap: "8px" } }, h("a", { href: urls[verFoto.path], target: "_blank", rel: "noopener", style: { ...btn(T), textDecoration: "none" } }, "Abrir original"), h("button", { onClick: () => anularFoto(verFoto), style: { ...btn(T), color: T.danger } }, "Quitar del expediente"))) : null);
  }

  const Fotos = ({ T, fotos, urls, onVer }) => fotos.length ? h("div", { style: { display: "flex", flexWrap: "wrap", gap: "8px", margin: "6px 0" } }, fotos.map((f) => h("button", { key: f.id, onClick: () => onVer(f), title: f.etiqueta, style: { border: `1px solid ${T.border}`, borderRadius: "8px", padding: 0, background: T.bg, cursor: "pointer", position: "relative", width: "92px", height: "92px", overflow: "hidden" } },
    urls[f.path] ? h("img", { src: urls[f.path], alt: f.etiqueta || "foto", style: { width: "100%", height: "100%", objectFit: "cover", display: "block" } }) : null,
    h("span", { style: { position: "absolute", left: 3, bottom: 3, fontSize: "10px", fontWeight: 700, background: "rgba(15,27,46,.75)", color: "#fff", borderRadius: "5px", padding: "1px 5px" } }, (ETIQUETAS.find((x) => x[0] === f.etiqueta) || ["", "Foto"])[1])))) : null;
  function SubirFotos({ T, trab, onFiles, inicial }) {
    const [et, setEt] = useState(inicial || "antes"); const ref = useRef(null);
    return h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginTop: "6px" } },
      h("select", { value: et, onChange: (e) => setEt(e.target.value), "aria-label": "Tipo de foto", style: { ...inp(T), width: "auto", padding: "6px 8px", fontSize: "13px" } }, ETIQUETAS.map(([k, l]) => h("option", { key: k, value: k }, l))),
      h("button", { disabled: trab, onClick: () => ref.current && ref.current.click(), style: btn(T, "s") }, "📷 Añadir fotos"),
      h("input", { ref, type: "file", accept: "image/*", multiple: true, style: { display: "none" }, onChange: (e) => { onFiles(e.target.files, et); e.target.value = ""; } }));
  }
  // Horas aprobadas: se escriben cuando responde el fabricante (se guardan al salir del campo)
  function HorasAprob({ T, l, onSave }) {
    const [v, setV] = useState(l.horas_aprobadas == null ? "" : String(l.horas_aprobadas).replace(".", ","));
    useEffect(() => { setV(l.horas_aprobadas == null ? "" : String(l.horas_aprobadas).replace(".", ",")); }, [l.horas_aprobadas]);
    const guardar = () => { const n = num(v); if ((n == null ? null : n) !== (l.horas_aprobadas == null ? null : Number(l.horas_aprobadas))) onSave(n); };
    return h("input", { value: v, onChange: (e) => setV(e.target.value), onBlur: guardar, onKeyDown: (e) => { if (e.key === "Enter") e.target.blur(); }, disabled: l.anulada, inputMode: "decimal", placeholder: "aprob.", "aria-label": "Horas aprobadas", title: "Horas aprobadas por el fabricante",
      style: { ...inp(T), width: "70px", padding: "4px 6px", fontSize: "12.5px", textAlign: "right", borderColor: l.horas_aprobadas != null && Number(l.horas_aprobadas) < Number(l.horas || 0) ? CH.rojo.bd : T.borderHi } });
  }

  function Problema({ T, n, p, g, ls, fotos, urls, trab, addLinea, updLinea, subirFotos, onVerFoto }) {
    const tr = ls.filter((l) => l.problema_id === p.id && l.tipo === "trabajo");
    const pz = ls.filter((l) => l.problema_id === p.id && l.tipo === "pieza");
    const hoy = new Date(); const hoyStr = `${hoy.getFullYear()}-${pad(hoy.getMonth() + 1)}-${pad(hoy.getDate())}`;
    const [nt, setNt] = useState({ descripcion: "", horas: "", mecanico: MECANICOS[0], fecha: hoyStr });
    const [np, setNp] = useState({ referencia: "", descripcion: "", cantidad: "1", origen_pieza: "fabricante" });
    const I = { ...inp(T), padding: "7px 9px", fontSize: "13px" };
    const td = { padding: "6px 6px", borderBottom: `1px solid ${T.border}`, fontSize: "13px", verticalAlign: "middle" };
    const vivos = tr.filter((l) => !l.anulada);
    const hp = vivos.reduce((a, l) => a + Number(l.horas || 0), 0);
    return h("div", { "data-g-problema": n, style: { border: `1px solid ${p.cobertura ? CH[COB_C[p.cobertura]].bd : T.border}`, borderRadius: "12px", padding: "12px", marginBottom: "10px", background: T.bg } },
      h("div", { style: { display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
        h("b", null, `${n}. ${p.descripcion || "(sin descripción)"}`), h("span", { style: { display: "flex", gap: "6px", alignItems: "center" } }, h(Chip, null, fmtH(hp) + " sol."),
          h("button", { onClick: () => { if (window.confirm("¿Anular este problema? Sus trabajos y piezas dejarán de contar en el expediente (se puede reactivar).")) updLinea(p.id, { anulada: true }); }, title: "Anular este problema (queda en el historial)", style: { ...btn(T, "s"), color: T.inkSoft } }, "Anular"))),
      g.tipo !== "chasis" ? h("div", { "data-g-cob": n, style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap", marginTop: "8px" } }, h("span", { style: { fontSize: "12px", fontWeight: 800, color: T.inkSoft } }, "¿Lo cubre la garantía?"),
        COBERTURA.map(([k, l]) => h("button", { key: k, type: "button", "data-cob": k, onClick: () => updLinea(p.id, { cobertura: p.cobertura === k ? null : k }), style: { ...btn(T, "s"), background: p.cobertura === k ? CH[COB_C[k]].bg : T.surface, borderColor: p.cobertura === k ? CH[COB_C[k]].bd : T.borderHi, color: p.cobertura === k ? CH[COB_C[k]].fg : T.ink, fontWeight: p.cobertura === k ? 800 : 600 } }, l))) : null,
      h("div", { style: { fontSize: "12px", fontWeight: 800, color: T.inkSoft, margin: "10px 0 4px" } }, "Trabajos · horas solicitadas / aprobadas"),
      tr.length ? h("table", { style: { width: "100%", borderCollapse: "collapse" } }, h("tbody", null, tr.map((l) => h("tr", { key: l.id, style: { opacity: l.anulada ? 0.45 : 1, textDecoration: l.anulada ? "line-through" : "none" } },
        h("td", { style: td }, l.descripcion), h("td", { style: { ...td, fontWeight: 700, whiteSpace: "nowrap" } }, fmtH(l.horas)),
        h("td", { style: { ...td, whiteSpace: "nowrap" } }, h(HorasAprob, { T, l, onSave: (v) => updLinea(l.id, { horas_aprobadas: v }) })),
        h("td", { style: td }, l.mecanico || "—"), h("td", { style: td }, l.fecha ? fFecha(l.fecha) : "—"),
        h("td", { style: { ...td, textAlign: "right" } }, h("button", { onClick: () => updLinea(l.id, { anulada: !l.anulada }), style: { ...btn(T, "s"), fontSize: "11.5px" } }, l.anulada ? "Reactivar" : "Anular")))))) : null,
      h("div", { style: { display: "grid", gridTemplateColumns: "2fr .8fr 1fr 1fr auto", gap: "6px", marginTop: "6px" } },
        h("input", { value: nt.descripcion, onChange: (e) => setNt((x) => ({ ...x, descripcion: e.target.value })), placeholder: "Trabajo (qué se hace)", "aria-label": "Trabajo realizado", style: I }),
        h("input", { value: nt.horas, onChange: (e) => setNt((x) => ({ ...x, horas: e.target.value })), placeholder: "Horas sol.", inputMode: "decimal", "aria-label": "Horas", style: I }),
        h("select", { value: nt.mecanico, onChange: (e) => setNt((x) => ({ ...x, mecanico: e.target.value })), "aria-label": "Mecánico", style: I }, MECANICOS.map((m) => h("option", { key: m, value: m }, m))),
        h("input", { type: "date", value: nt.fecha, onChange: (e) => setNt((x) => ({ ...x, fecha: e.target.value })), "aria-label": "Fecha", style: I }),
        h("button", { "data-g-add-trab": n, disabled: trab || !nt.descripcion.trim() || !(num(nt.horas) > 0), onClick: async () => { if (await addLinea({ tipo: "trabajo", problema_id: p.id, descripcion: nt.descripcion.trim(), horas: num(nt.horas), mecanico: nt.mecanico, fecha: nt.fecha || null })) setNt((x) => ({ ...x, descripcion: "", horas: "" })); }, style: btn(T, "s") }, "Añadir")),
      h("div", { style: { fontSize: "12px", fontWeight: 800, color: T.inkSoft, margin: "12px 0 4px" } }, "Piezas"),
      pz.length ? h("table", { style: { width: "100%", borderCollapse: "collapse" } }, h("tbody", null, pz.map((l) => h("tr", { key: l.id, style: { opacity: l.anulada ? 0.45 : 1, textDecoration: l.anulada ? "line-through" : "none" } },
        h("td", { style: { ...td, fontFamily: "'JetBrains Mono', monospace", fontSize: "12px" } }, l.referencia || "—"), h("td", { style: td }, l.descripcion), h("td", { style: { ...td, fontWeight: 700 } }, `× ${Number(l.cantidad || 1)}`),
        h("td", { style: td }, l.origen_pieza === "fabricante" ? "Pedida al fabricante" : "De nuestro stock"),
        h("td", { style: td }, h("label", { style: { display: "flex", gap: "5px", alignItems: "center", whiteSpace: "nowrap" } }, h("input", { type: "checkbox", checked: !!l.repuesto_recibido_at, disabled: l.anulada, onChange: (e) => updLinea(l.id, { repuesto_recibido_at: e.target.checked ? new Date().toISOString() : null }) }),
          l.origen_pieza === "fabricante" ? (l.repuesto_recibido_at ? `Recibida ${fFecha(l.repuesto_recibido_at)}` : "Recibida") : (l.repuesto_recibido_at ? `Repuesta ${fFecha(l.repuesto_recibido_at)}` : "Repuesta"))),
        h("td", { style: { ...td, textAlign: "right" } }, h("button", { onClick: () => updLinea(l.id, { anulada: !l.anulada }), style: { ...btn(T, "s"), fontSize: "11.5px" } }, l.anulada ? "Reactivar" : "Anular")))))) : null,
      h("div", { style: { display: "grid", gridTemplateColumns: "1fr 2fr .6fr 1.3fr auto", gap: "6px", marginTop: "6px" } },
        h("input", { value: np.referencia, onChange: (e) => setNp((x) => ({ ...x, referencia: e.target.value })), placeholder: "Referencia", "aria-label": "Referencia", style: I }),
        h("input", { value: np.descripcion, onChange: (e) => setNp((x) => ({ ...x, descripcion: e.target.value })), placeholder: "Descripción de la pieza", "aria-label": "Pieza", style: I }),
        h("input", { value: np.cantidad, onChange: (e) => setNp((x) => ({ ...x, cantidad: e.target.value })), inputMode: "decimal", "aria-label": "Cantidad", style: I }),
        h("select", { value: np.origen_pieza, onChange: (e) => setNp((x) => ({ ...x, origen_pieza: e.target.value })), "aria-label": "Origen", style: I }, h("option", { value: "fabricante" }, "Pedida al fabricante"), h("option", { value: "stock" }, "De nuestro stock")),
        h("button", { "data-g-add-pieza": n, disabled: trab || !np.descripcion.trim(), onClick: async () => { if (await addLinea({ tipo: "pieza", problema_id: p.id, referencia: np.referencia.trim() || null, descripcion: np.descripcion.trim(), cantidad: num(np.cantidad) || 1, origen_pieza: np.origen_pieza })) setNp({ referencia: "", descripcion: "", cantidad: "1", origen_pieza: np.origen_pieza }); }, style: btn(T, "s") }, "Añadir")),
      h("div", { style: { fontSize: "12px", fontWeight: 800, color: T.inkSoft, margin: "12px 0 4px" } }, `Fotos (${fotos.length})`),
      h(Fotos, { T, fotos, urls, onVer: onVerFoto }),
      h(SubirFotos, { T, trab, inicial: ["consulta", "esperando_info", "analisis"].includes(g.estado) ? "cliente" : "antes", onFiles: (fs, et) => subirFotos(fs, p.id, et) }));
  }

  // ---------- resumen imprimible para tramitar en la web del fabricante ----------
  function abrirResumen(g, ls, fotos, urls, t) {
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const v = g.vehiculo || {};
    const probs = ls.filter((l) => l.tipo === "problema" && !l.anulada && l.cobertura !== "no_cubre");
    const nH = (x) => Number(x || 0).toLocaleString("es-ES");
    const bloque = (p, i) => {
      const tr = ls.filter((l) => l.problema_id === p.id && l.tipo === "trabajo" && !l.anulada);
      const pz = ls.filter((l) => l.problema_id === p.id && l.tipo === "pieza" && !l.anulada);
      const fs = fotos.filter((f) => f.linea_id === p.id && urls[f.path]);
      return `<section><h2>${i + 1}. ${esc(p.descripcion)}${p.cobertura === "a_valorar" ? ' <span class="tag">a valorar</span>' : ""}</h2>
        ${tr.length ? `<table><tr><th>Trabajo</th><th>Horas solicitadas</th><th>Aprobadas</th><th>Mecánico</th><th>Fecha</th></tr>${tr.map((l) => `<tr><td>${esc(l.descripcion)}</td><td>${nH(l.horas)}</td><td>${l.horas_aprobadas == null ? "" : nH(l.horas_aprobadas)}</td><td>${esc(l.mecanico || "")}</td><td>${l.fecha ? esc(fFecha(l.fecha)) : ""}</td></tr>`).join("")}</table>` : ""}
        ${pz.length ? `<table><tr><th>Referencia</th><th>Pieza</th><th>Cant.</th><th>Origen</th></tr>${pz.map((l) => `<tr><td class="m">${esc(l.referencia || "")}</td><td>${esc(l.descripcion)}</td><td>${esc(Number(l.cantidad || 1))}</td><td>${l.origen_pieza === "fabricante" ? "Fabricante" : "Stock taller"}</td></tr>`).join("")}</table>` : ""}
        ${fs.length ? `<div class="fotos">${fs.map((f) => `<figure><img src="${urls[f.path]}"><figcaption>${esc((ETIQUETAS.find((x) => x[0] === f.etiqueta) || ["", ""])[1])}</figcaption></figure>`).join("")}</div>` : ""}</section>`;
    };
    const gen = fotos.filter((f) => !f.linea_id && urls[f.path]);
    const hSol = probs.reduce((a, p) => a + ls.filter((l) => l.problema_id === p.id && l.tipo === "trabajo" && !l.anulada).reduce((b, l) => b + Number(l.horas || 0), 0), 0);
    const nPz = probs.reduce((a, p) => a + ls.filter((l) => l.problema_id === p.id && l.tipo === "pieza" && !l.anulada).reduce((b, l) => b + Number(l.cantidad || 0), 0), 0);
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(g.numero)} · Resumen de garantía</title><style>
      body{font-family:system-ui,sans-serif;color:#0F1B2E;margin:24px;font-size:13px}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:18px 0 6px}
      .meta{display:grid;grid-template-columns:repeat(2,1fr);gap:4px 20px;margin:10px 0 14px}.meta b{display:inline-block;min-width:130px;color:#5B6B82}
      table{width:100%;border-collapse:collapse;margin:6px 0}th,td{border-bottom:1px solid #E4E9F1;padding:5px 6px;text-align:left}th{font-size:11px;text-transform:uppercase;color:#5B6B82}
      .m{font-family:monospace}.tag{font-size:11px;background:#FEF1E1;color:#B45309;border-radius:5px;padding:1px 6px}.tot{display:flex;gap:30px;background:#F5F7FB;border-radius:8px;padding:10px 14px;margin:10px 0}.tot div{font-size:20px;font-weight:800}.tot span{display:block;font-size:11px;color:#5B6B82;font-weight:600}
      .fotos{display:flex;flex-wrap:wrap;gap:8px}figure{margin:0;width:31%}figure img{width:100%;border-radius:6px;border:1px solid #E4E9F1}figcaption{font-size:11px;color:#5B6B82}
      section{break-inside:avoid}.bar{margin-bottom:12px}@media print{.bar{display:none}}</style></head><body>
      <div class="bar"><button onclick="print()">Imprimir / guardar PDF</button></div>
      <h1>${esc(g.numero)} · ${g.tipo === "chasis" ? "Gestión de chasis" : "Reclamación de garantía"} · ${esc(g.fabricante || "")}</h1>
      <div class="meta"><div><b>Nº de gestión</b> <span class="m">${esc(g.reclamacion_no || "—")}</span></div><div><b>Entrada</b> ${esc(fFecha(g.fecha_entrada || g.created_at))}</div>
      <div><b>Vehículo</b> ${esc(v.modelo || "")}</div><div><b>Matrícula</b> <span class="m">${esc(v.matricula || "")}</span></div>
      <div><b>Bastidor</b> <span class="m">${esc(v.bastidor || "")}</span></div><div><b>${g.origen === "flota" ? "Flota" : "Cliente"}</b> ${esc(g.origen === "flota" ? v.ac || "" : nombreCli(g.cliente))}</div></div>
      ${g.descripcion ? `<p>${esc(g.descripcion)}</p>` : ""}
      <div class="tot"><div>${esc(nH(hSol))} h<span>horas solicitadas</span></div><div>${esc(nPz)}<span>piezas</span></div><div>${esc(probs.length)}<span>problemas</span></div></div>
      ${probs.map(bloque).join("")}
      ${gen.length ? `<section><h2>Fotos generales</h2><div class="fotos">${gen.map((f) => `<figure><img src="${urls[f.path]}"><figcaption>${esc((ETIQUETAS.find((x) => x[0] === f.etiqueta) || ["", ""])[1])}</figcaption></figure>`).join("")}</div></section>` : ""}
      <p style="color:#8B98AB;font-size:11px;margin-top:20px">AC·LLAR · generado ${esc(fFechaHora(new Date().toISOString()))} · no incluye los problemas que no cubre la garantía</p></body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.open(); w.document.write(html); w.document.close(); }
  }

  window.AcllarGarantias = GarantiasView;
  window.AcllarGarantias._test = { EST, totales, aviso, textoEventoG, MSG };
})();
