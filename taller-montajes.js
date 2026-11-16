// taller-montajes.js  ---  TALLER → Expedientes vehículos nuevos
// Un expediente por vehículo vendido: cliente, vehículo (modelo, bastidor), lista de extras a montar,
// quién monta cada extra (colaboración), comprobaciones (mecánico, jefe de taller, comercial) con fecha y
// hora del servidor, limpieza y entrega. Todo cambio queda en la bitácora; nada se borra.
// Tablas: montajes / montaje_extras / montaje_comprobaciones; historial en crm_eventos (montaje_id).
// Se carga después de taller-crm.js y usa sus piezas (window.AcllarCRM._ui).
(function () {
  if (!window.React || !window.AcllarCRM || !window.AcllarCRM._ui) return;
  const U = window.AcllarCRM._ui;
  const { h, CH, Chip, btn, inp, Lbl, Box, Field, Seg, Drawer, sb, quien, fFecha, fFechaHora, nombreCli, normMat,
    buscarClientes, ResultadoCliente, qSafe, pad, Bitacora, ChipCli, ChipNueva, NombreLink, esNueva, irA, yo, fLarga } = U;
  const { useState, useEffect, useRef } = React;

  const MECANICOS = ["Ali", "Carlos", "Hugo", "Sebastián", "Agente externo"];
  const COMERCIALES = ["Pablo", "Gonzalo", "Sebastián"];
  const EST = {
    senado: { l: "Señado · pendiente de pago", c: "ambar", f: 0 },
    pagado: { l: "Pagado · por montar", c: "azul", f: 1 },
    en_montaje: { l: "En montaje", c: "violeta", f: 1 },
    comp_mecanico: { l: "Comprobación del mecánico", c: "violeta", f: 2 },
    comp_jefe: { l: "Comprobación del jefe de taller", c: "violeta", f: 2 },
    comp_comercial: { l: "Comprobación del comercial", c: "violeta", f: 2 },
    limpieza: { l: "Limpieza interior y exterior", c: "azul", f: 3 },
    listo: { l: "Listo para entregar", c: "verde", f: 4 },
    entregado: { l: "Entregado", c: "gris", f: 5, fin: true },
    cancelado: { l: "Venta cancelada", c: "gris", fin: true },
  };
  const est = (k) => EST[k] || { l: k || "—", c: "gris" };
  const FASES = ["Señado", "Montaje", "Comprobaciones", "Limpieza", "Listo", "Entregado"];
  const COLUMNAS = [["senado", "Señados"], ["pagado", "Pagados · por montar"], ["en_montaje", "En montaje"], ["comp", "Comprobaciones"], ["limpieza", "Limpieza"], ["listo", "Listos para entregar"]];
  const COMP_TIPO = { mecanico: "Mecánico", jefe: "Jefe de taller", comercial: "Comercial" };
  const PIEZA = [["no_necesita", "Sin pieza"], ["por_pedir", "Pieza por pedir"], ["pedida", "Pieza pedida"], ["recibida", "Pieza recibida"]];
  const CHECKLIST = [
    "Agua: bomba, depósitos y grifos sin fugas", "Boiler / agua caliente", "Gas: estanqueidad, cocina y horno", "Calefacción",
    "Nevera (12 V / 230 V / gas)", "Batería de servicio y cargador", "Instalación 12 V: luces y panel de control", "Instalación 230 V: enchufes y toma exterior",
    "Placa solar y regulador (si lleva)", "Ventanas, claraboyas y oscurecedores", "Puertas, cofres y cerraduras", "WC químico y aguas grises",
    "Toldo y accesorios exteriores (si lleva)", "Todos los extras montados funcionan"];
  const VUELVE_A_MONTAJE = ["comp_mecanico", "comp_jefe", "comp_comercial", "limpieza", "listo"];
  const CAMPOS = { estado: "Estado", comercial: "Comercial", mecanico: "Mecánico asignado", fecha_entrega: "Entrega comprometida", fecha_senal: "Señal", pagado_at: "Pagado", vehiculo: "Vehículo",
    notas: "Notas", limpieza_interior_at: "Limpieza interior", limpieza_exterior_at: "Limpieza exterior", limpieza_interior_por: "Limpieza interior por", limpieza_exterior_por: "Limpieza exterior por",
    entregado_at: "Entregado", motivo_cierre: "Motivo", montaje_sin_pagar: "Montaje sin pagar", cliente_id: "Cliente", descripcion: "Descripción", cantidad: "Cantidad", pieza: "Pieza", montado_at: "Montado",
    mecanicos: "Montado por", desmontado_at: "Desmontado", desmontado_por: "Desmontado por" };
  const vehTxt = (v) => { const x = v || {}; return [x.modelo, x.bastidor ? "Bastidor " + normMat(x.bastidor) : null, x.matricula ? normMat(x.matricula) : null].filter(Boolean).join(" · ") || "—"; };
  const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const diasHasta = (f) => { if (!f) return null; const a = new Date(f + "T00:00:00"), b = new Date(hoyISO() + "T00:00:00"); return Math.round((a - b) / 864e5); };

  function progreso(xs) {
    const act = xs.filter((x) => x.estado === "activo"), mont = act.filter((x) => x.montado_at);
    const desm = xs.filter((x) => x.estado === "desmontar");
    return { total: act.length, montados: mont.length, desmontar: desm.length, pendientes: act.length - mont.length + desm.length,
      porPedir: act.filter((x) => !x.montado_at && x.pieza === "por_pedir").length, pedidas: act.filter((x) => !x.montado_at && x.pieza === "pedida").length };
  }
  function avisos(m, xs) {
    const out = [], p = progreso(xs);
    if (est(m.estado).fin) return out;
    const d = diasHasta(m.fecha_entrega);
    if (d != null && m.estado !== "listo") { if (d < 0) out.push({ c: "rojo", t: `Entrega vencida hace ${-d} d` }); else if (d <= 5) out.push({ c: "ambar", t: d === 0 ? "Se entrega hoy" : `Entrega en ${d} d` }); }
    if (m.montaje_sin_pagar && !m.pagado_at) out.push({ c: "rojo", t: "Montando sin pagar" });
    if (p.porPedir) out.push({ c: m.estado === "senado" ? "gris" : "ambar", t: `${p.porPedir} pieza${p.porPedir > 1 ? "s" : ""} por pedir` });
    if (p.pedidas && ["pagado", "en_montaje"].includes(m.estado)) out.push({ c: "ambar", t: `${p.pedidas} pieza${p.pedidas > 1 ? "s" : ""} sin llegar` });
    const nuevos = xs.filter((x) => x.estado === "activo" && !x.montado_at && esNuevo(m, x)).length;
    if (nuevos && m.estado !== "senado") out.push({ c: "violeta", t: `${nuevos} extra${nuevos > 1 ? "s" : ""} añadido${nuevos > 1 ? "s" : ""} después` });
    if (p.desmontar) out.push({ c: "rojo", t: `${p.desmontar} por desmontar` });
    return out;
  }
  // Extra añadido después de abrir el expediente (más de 10 min después), para que no se escape
  const esNuevo = (m, x) => new Date(x.created_at) - new Date(m.created_at) > 6e5;
  function textoEventoM(ev) {
    const d = ev.detalle || {};
    if (ev.tipo === "m_creado") return `Expediente ${d.numero} abierto`;
    if (ev.tipo === "m_extra_alta") return `${d.origen === "incidencia" ? "Incidencia añadida" : "Extra añadido"}: “${d.descripcion}”${Number(d.cantidad) > 1 ? " × " + d.cantidad : ""}`;
    if (ev.tipo === "m_comprobacion") return `Comprobación ${COMP_TIPO[d.tipo] ? COMP_TIPO[d.tipo].toLowerCase() : d.tipo}: ${d.resultado === "ok" ? "OK" : "con incidencias"} · hecha por ${d.hecho_por}${d.notas ? " · " + d.notas : ""}`;
    if (ev.texto) return ev.texto;
    const pref = ev.tipo === "m_extra_cambio" ? `Extra “${d.descripcion || ""}”: ` : "";
    const partes = Object.keys(d).filter((k) => !(ev.tipo === "m_extra_cambio" && k === "descripcion")).map((k) => {
      const v = d[k] || {};
      if (k === "estado" && ev.tipo === "m_estado") return `Estado: ${est(v.de).l} → ${est(v.a).l}`;
      if (k === "estado") return { quitado: "quitado de la lista", desmontar: "marcado para desmontar", desmontado: "desmontado", activo: "vuelve a la lista" }[v.a] || `estado ${v.a}`;
      if (k === "montado_at") return v.a ? "montado" : "desmarcado como montado";
      if (k === "mecanicos" || k === "desmontado_por") return `${CAMPOS[k]}: ${(v.a || []).join(", ") || "—"}`;
      if (k === "vehiculo" && U.difVeh) { const t = U.difVeh(v.de, v.a); if (t) return "Vehículo · " + t; }
      if (k === "pieza") return `Pieza: ${(PIEZA.find((p) => p[0] === v.a) || ["", v.a])[1]}`;
      const f = (x) => (x == null || x === "" ? "—" : typeof x === "object" ? vehTxt(x) : /_at$/.test(k) ? fFechaHora(x) : k === "fecha_entrega" || k === "fecha_senal" ? fFecha(x) : String(x));
      return `${CAMPOS[k] || k}: ${f(v.de)} → ${f(v.a)}`;
    });
    return pref + (partes.join(" · ") || "cambio");
  }
  const anotar = (m, texto) => sb().from("crm_eventos").insert({ tipo: "bitacora", detalle: { clase: "nota" }, texto, montaje_id: m.id, cliente_id: m.cliente_id || null });
  const Barra = ({ T, p }) => h("div", { title: `${p.montados} de ${p.total} extras montados`, style: { display: "flex", alignItems: "center", gap: "8px" } },
    h("div", { style: { flex: 1, height: "8px", borderRadius: "5px", background: T.bgAlt || T.bg, border: `1px solid ${T.border}`, overflow: "hidden" } },
      h("div", { style: { width: `${p.total ? Math.round((p.montados / p.total) * 100) : 0}%`, height: "100%", background: p.total && p.montados === p.total ? CH.verde.fg : T.rust } })),
    h("span", { style: { fontSize: "12px", fontWeight: 800, whiteSpace: "nowrap" } }, p.total ? `${p.montados}/${p.total}` : "sin extras"));

  // =====================================================================
  function MontajesView({ T, F }) {
    const [lista, setLista] = useState([]); const [extras, setExtras] = useState([]);
    const [cargando, setCargando] = useState(true); const [error, setError] = useState("");
    const [vista, setVista] = useState("curso"); const [txt, setTxt] = useState("");
    const [abierto, setAbierto] = useState(() => { try { const x = localStorage.getItem("acllar_montaje_abrir"); if (x) localStorage.removeItem("acllar_montaje_abrir"); return x || null; } catch (e) { return null; } });
    const [nuevo, setNuevo] = useState(false); const [fichaId, setFichaId] = useState(null);
    useEffect(() => { const f = (e) => { if (!e || e.detail !== "montajes") return; try { const x = localStorage.getItem("acllar_montaje_abrir"); if (x) { localStorage.removeItem("acllar_montaje_abrir"); setAbierto(x); } } catch (y) {} };
      window.addEventListener("acllar-taller-tab", f); return () => window.removeEventListener("acllar-taller-tab", f); }, []);
    const rol = window.acllarCloud && window.acllarCloud.rol ? window.acllarCloud.rol() : null;
    const sinAcceso = rol && rol !== "admin" && rol !== "comercial";
    const cargar = async () => {
      if (!sb() || sinAcceso) { setCargando(false); return; }
      const [a, b] = await Promise.all([
        sb().from("montajes").select("*, cliente:crm_clientes(id,nombre,apellidos,telefono,tipo_cliente,bc_no)").eq("archivado", false).order("created_at", { ascending: false }).limit(2000),
        sb().from("montaje_extras").select("id,montaje_id,estado,montado_at,pieza,created_at").limit(20000),
      ]);
      if (a.error) setError("No se pudieron cargar los expedientes: " + a.error.message); else { setLista(a.data || []); setExtras(b.data || []); setError(""); }
      setCargando(false);
    };
    useEffect(() => { cargar(); const t = setInterval(cargar, 60000); return () => clearInterval(t); }, []);
    if (sinAcceso) return h("div", { style: { background: T.surface, border: `1px dashed ${T.border}`, borderRadius: "14px", padding: "36px", textAlign: "center", color: T.inkSoft } }, "Tu cuenta no tiene acceso a los expedientes de vehículos nuevos.");
    const q = txt.trim().toLowerCase();
    const filtrados = lista.filter((m) => !q || [m.numero, m.comercial, m.mecanico, vehTxt(m.vehiculo), m.vehiculo && m.vehiculo.bastidor, m.cliente && nombreCli(m.cliente)].join(" ").toLowerCase().includes(q));
    const ex = (m) => extras.filter((x) => x.montaje_id === m.id);
    const enCurso = filtrados.filter((m) => !est(m.estado).fin);
    const col = (k) => enCurso.filter((m) => (k === "comp" ? m.estado.startsWith("comp_") : m.estado === k)).sort((a, b) => String(a.fecha_entrega || "9999").localeCompare(String(b.fecha_entrega || "9999")));
    const Tarjeta = (m) => { const xs = ex(m), p = progreso(xs), av = avisos(m, xs);
      return h("div", { key: m.id, "data-vn-card": m.numero, role: "button", tabIndex: 0, className: "acl-tarjeta" + (esNueva(m) ? " acl-es-nueva" : ""), onClick: () => setAbierto(m.id), onKeyDown: (e) => { if (e.key === "Enter") setAbierto(m.id); }, style: { textAlign: "left", cursor: "pointer", background: T.surface, border: `1px solid ${av.some((a) => a.c === "rojo") ? CH.rojo.bd : T.border}`, borderRadius: "12px", padding: "10px 12px", display: "flex", flexDirection: "column", gap: "6px", fontFamily: "inherit", color: T.ink } },
        esNueva(m) ? h("div", null, h(ChipNueva, { x: m, borde: 12 })) : null,
        h("div", { style: { display: "flex", justifyContent: "space-between", gap: "6px" } }, h("b", { style: { fontFamily: "'JetBrains Mono', monospace", fontSize: "12px" } }, m.numero), h("span", { style: { fontSize: "12px", color: T.inkSoft } }, m.comercial || "")),
        h("div", { style: { fontWeight: 800, fontSize: "14px" } }, (m.vehiculo || {}).modelo || "—"),
        h("div", { style: { fontSize: "12.5px", color: T.inkSoft } }, m.cliente ? h(NombreLink, { c: m.cliente, onCliente: setFichaId }) : "—", (m.vehiculo || {}).bastidor ? h("span", { style: { fontFamily: "'JetBrains Mono', monospace" } }, " · …" + normMat(m.vehiculo.bastidor).slice(-6)) : null),
        m.estado === "en_montaje" || m.estado === "pagado" || p.total ? h(Barra, { T, p }) : null,
        h("div", { style: { fontSize: "12px", color: T.inkSoft } }, m.fecha_entrega ? `Entrega ${fFecha(m.fecha_entrega)}` : "Sin fecha de entrega", m.mecanico ? ` · ${m.mecanico}` : ""),
        av.length ? h("div", { style: { display: "flex", flexWrap: "wrap", gap: "4px" } }, av.map((a, i) => h(Chip, { key: i, c: a.c }, a.t))) : null); };
    const th = { fontSize: "11px", letterSpacing: ".08em", textTransform: "uppercase", color: T.inkSoft, fontWeight: 700, padding: "10px 12px", textAlign: "left", borderBottom: `1.5px solid ${T.border}` };
    const td = { padding: "10px 12px", borderBottom: `1px solid ${T.border}`, fontSize: "13.5px", verticalAlign: "top" };
    const cerrados = filtrados.filter((m) => m.estado === (vista === "entregados" ? "entregado" : "cancelado"));
    return h("div", { "data-montajes": "1", style: { fontFamily: F.body, color: T.ink, display: "flex", flexDirection: "column", gap: "16px" } },
      h("div", { style: { display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center" } },
        h("input", { type: "search", value: txt, onChange: (e) => setTxt(e.target.value), "aria-label": "Buscar expediente", placeholder: "Buscar por nº, modelo, bastidor, cliente, comercial o mecánico", style: { ...inp(T), flex: "1 1 420px", height: "46px", borderRadius: "12px" } }),
        h("button", { "data-vn-nuevo": "1", onClick: () => setNuevo(true), style: { ...btn(T, "p"), height: "46px", padding: "0 20px", fontSize: "15px" } }, "+ Nuevo vehículo vendido")),
      h(Seg, { T, opts: [["curso", `En curso (${lista.filter((m) => !est(m.estado).fin).length})`], ["entregados", "Entregados"], ["cancelados", "Cancelados"]], value: vista, onChange: setVista }),
      error ? h("div", { style: { color: T.danger, fontSize: "13px" } }, error) : null,
      cargando ? h("div", { style: { color: T.inkFaint, fontSize: "13px" } }, "Cargando…")
        : vista === "curso" ? h("div", { style: { display: "grid", gridTemplateColumns: "repeat(6, minmax(190px, 1fr))", gap: "10px", overflowX: "auto", alignItems: "start" } },
          COLUMNAS.map(([k, l]) => { const xs = col(k); return h("div", { key: k, "data-vn-col": k, style: { background: T.bg, border: `1px solid ${T.border}`, borderRadius: "14px", padding: "10px", display: "flex", flexDirection: "column", gap: "8px", minHeight: "120px" } },
            h("div", { style: { fontSize: "11.5px", letterSpacing: ".06em", textTransform: "uppercase", fontWeight: 800, color: T.inkSoft, display: "flex", justifyContent: "space-between" } }, l, h("span", null, xs.length)),
            xs.map(Tarjeta)); }))
        : !cerrados.length ? h("div", { style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: "14px", padding: "28px", textAlign: "center", color: T.inkSoft } }, vista === "entregados" ? "Todavía no hay vehículos entregados." : "No hay ventas canceladas.")
        : h("div", { style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: "14px", overflowX: "auto" } }, h("table", { style: { width: "100%", borderCollapse: "collapse", minWidth: "800px" } },
          h("thead", null, h("tr", null, ["Nº", "Vehículo", "Cliente", "Comercial", vista === "entregados" ? "Entregado" : "Motivo"].map((x) => h("th", { key: x, style: th }, x)))),
          h("tbody", null, cerrados.map((m) => h("tr", { key: m.id, className: "acl-fila", onClick: () => setAbierto(m.id), style: { cursor: "pointer" } },
            h("td", { style: { ...td, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 } }, m.numero), h("td", { style: td }, vehTxt(m.vehiculo)), h("td", { style: td }, m.cliente ? h(NombreLink, { c: m.cliente, onCliente: setFichaId }) : "—"),
            h("td", { style: td }, m.comercial || "—"), h("td", { style: td }, vista === "entregados" ? fFecha(m.entregado_at) : m.motivo_cierre || "—")))))),
      nuevo ? h(NuevoVN, { T, F, onClose: () => setNuevo(false), onCreated: (m) => { setNuevo(false); cargar(); setAbierto(m.id); } }) : null,
      abierto ? h(Expediente, { T, F, id: abierto, onClose: () => { setAbierto(null); cargar(); }, onChanged: cargar }) : null,
      fichaId && window.AcllarGarantias && window.AcllarGarantias.FichaCliente ? h(window.AcllarGarantias.FichaCliente, { T, F, id: fichaId, onClose: () => setFichaId(null), onChanged: cargar }) : null);
  }

  // ---------- alta ----------
  function NuevoVN({ T, F, onClose, onCreated }) {
    const [q, setQ] = useState(""); const [res, setRes] = useState([]); const [sel, setSel] = useState(null); const [nuevoCli, setNuevoCli] = useState(false);
    const [cli, setCli] = useState({ nombre: "", apellidos: "", telefono: "", email: "", nif: "", direccion: "", cp: "", ciudad: "", provincia: "" });
    const yoN = yo();
    const [d, setD] = useState({ modelo: "", bastidor: "", matricula: "", comercial: COMERCIALES.includes(yoN) ? yoN : "", fecha_senal: hoyISO(), fecha_entrega: "", extras: "" });
    const [err, setErr] = useState(""); const [guardando, setGuardando] = useState(false);
    const t = useRef(null); const I = inp(T);
    useEffect(() => { clearTimeout(t.current); if (sel || qSafe(q).length < 2) { setRes([]); return; } t.current = setTimeout(async () => { try { setRes(await buscarClientes(q)); } catch (e) {} }, 300); }, [q, sel]);
    const setC = (k) => (e) => setCli((x) => ({ ...x, [k]: e.target.value }));
    const setDd = (k) => (e) => setD((x) => ({ ...x, [k]: e.target.value }));
    const guardar = async () => {
      setErr("");
      if (!sel && !(nuevoCli && cli.nombre.trim())) { setErr("Elige el cliente o rellena sus datos."); return; }
      if (!d.modelo.trim()) { setErr("Indica el modelo del vehículo."); return; }
      if (!d.comercial) { setErr("Indica el comercial."); return; }
      setGuardando(true);
      try {
        let clienteId;
        if (sel && sel.tipo === "crm") { clienteId = sel.c.id; if (!sel.c.tipo_cliente) await sb().from("crm_clientes").update({ tipo_cliente: "propio" }).eq("id", clienteId); }
        else if (sel && sel.tipo === "bc") {
          const ex = await sb().from("crm_clientes").select("id").eq("bc_no", sel.bc.no).maybeSingle();
          if (ex.data) clienteId = ex.data.id;
          else { const b = sel.bc; const ins = await sb().from("crm_clientes").insert({ bc_no: b.no, nombre: b.nombre || "(sin nombre)", telefono: b.telefono, email: b.email, direccion: b.direccion, cp: b.cp, ciudad: b.ciudad, provincia: b.provincia, nif: b.nif, tipo_cliente: "propio" }).select("id").single(); if (ins.error) throw ins.error; clienteId = ins.data.id; }
        } else {
          const ins = await sb().from("crm_clientes").insert({ ...Object.fromEntries(Object.entries(cli).map(([k, v]) => [k, String(v).trim() || null])), tipo_cliente: "propio",
            vehiculos: [{ modelo: d.modelo.trim(), matricula: normMat(d.matricula), bastidor: normMat(d.bastidor) }] }).select("id").single();
          if (ins.error) throw ins.error; clienteId = ins.data.id;
        }
        const m = await sb().from("montajes").insert({ cliente_id: clienteId, vehiculo: { modelo: d.modelo.trim(), bastidor: normMat(d.bastidor), matricula: normMat(d.matricula) }, comercial: d.comercial,
          fecha_senal: d.fecha_senal || null, fecha_entrega: d.fecha_entrega || null }).select("*").single();
        if (m.error) throw m.error;
        const lineas = d.extras.split("\n").map((x) => x.trim()).filter(Boolean);
        if (lineas.length) { const r = await sb().from("montaje_extras").insert(lineas.map((x, i) => ({ montaje_id: m.data.id, descripcion: x, orden: i }))); if (r.error) throw r.error; }
        onCreated(m.data);
      } catch (e) { setErr("No se pudo crear: " + (e.message || e)); setGuardando(false); }
    };
    const fila = (k, l, extra) => h(Field, { T, label: l, ...(extra || {}) }, h("input", { value: cli[k], onChange: setC(k), "aria-label": l, style: I }));
    return h("div", { role: "dialog", "aria-label": "Nuevo vehículo vendido", style: { position: "fixed", inset: 0, zIndex: 1250, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "30px 12px" } },
      h("div", { onClick: onClose, style: { position: "fixed", inset: 0, background: "rgba(15,27,46,.35)" } }),
      h("div", { style: { position: "relative", width: "min(720px, 100%)", background: T.surface, borderRadius: "16px", border: `1px solid ${T.border}`, padding: "22px", display: "flex", flexDirection: "column", gap: "14px", fontFamily: F.body, color: T.ink } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } }, h("div", { style: { fontFamily: F.display, fontSize: "22px", fontWeight: 800 } }, "Nuevo vehículo vendido"), h("button", { onClick: onClose, "aria-label": "Cerrar", style: { border: "none", background: "transparent", cursor: "pointer", fontSize: "22px", color: T.inkSoft } }, "×")),
        h(Lbl, { T }, "Cliente"),
        sel ? h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", background: T.bg, borderRadius: "10px", padding: "10px 12px" } }, h("b", null, sel.tipo === "crm" ? nombreCli(sel.c) : sel.bc.nombre), h("button", { onClick: () => setSel(null), style: btn(T, "s") }, "Cambiar"))
          : nuevoCli ? h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" } }, fila("nombre", "Nombre"), fila("apellidos", "Apellidos"), fila("telefono", "Teléfono"), fila("email", "Email"), fila("nif", "NIF"), fila("direccion", "Dirección"), fila("cp", "CP"), fila("ciudad", "Población"), fila("provincia", "Provincia"),
            h("button", { onClick: () => setNuevoCli(false), style: { ...btn(T, "s"), alignSelf: "end" } }, "Buscar uno existente"))
          : h(React.Fragment, null, h("input", { type: "search", value: q, onChange: (e) => setQ(e.target.value), "aria-label": "Buscar cliente", placeholder: "Nombre, teléfono, email, NIF o matrícula (busca en el CRM y en BC)", style: I }),
            res.length ? h("div", { style: { border: `1px solid ${T.border}`, borderRadius: "10px", overflow: "hidden" } }, res.map((r) => h(ResultadoCliente, { key: r.k, T, r, cta: "Usar", onPick: setSel }))) : null,
            h("button", { "data-vn-cli-nuevo": "1", onClick: () => setNuevoCli(true), style: { ...btn(T, "s"), alignSelf: "flex-start" } }, "+ Cliente nuevo")),
        h(Lbl, { T }, "Vehículo"),
        h("div", { style: { display: "grid", gridTemplateColumns: "1.4fr 1.4fr 1fr", gap: "8px" } },
          h(Field, { T, label: "Modelo" }, h("input", { value: d.modelo, onChange: setDd("modelo"), "aria-label": "Modelo", placeholder: "p. ej. Benimar Tessoro 487", style: I })),
          h(Field, { T, label: "Bastidor" }, h("input", { value: d.bastidor, onChange: setDd("bastidor"), "aria-label": "Bastidor", style: { ...I, fontFamily: "'JetBrains Mono', monospace" } })),
          h(Field, { T, label: "Matrícula (si la tiene)" }, h("input", { value: d.matricula, onChange: setDd("matricula"), "aria-label": "Matrícula", style: I }))),
        h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" } },
          h(Field, { T, label: "Comercial" }, h("select", { value: d.comercial, onChange: setDd("comercial"), "aria-label": "Comercial", style: I }, h("option", { value: "" }, "—"), COMERCIALES.map((c) => h("option", { key: c, value: c }, c)))),
          h(Field, { T, label: "Fecha de la señal" }, h("input", { type: "date", value: d.fecha_senal, onChange: setDd("fecha_senal"), style: I })),
          h(Field, { T, label: "Entrega comprometida" }, h("input", { type: "date", value: d.fecha_entrega, onChange: setDd("fecha_entrega"), "aria-label": "Entrega comprometida", style: I }))),
        h(Field, { T, label: "Extras a montar (uno por línea; se pueden añadir o quitar después)" }, h("textarea", { rows: 5, value: d.extras, onChange: setDd("extras"), "aria-label": "Extras", placeholder: "Toldo Fiamma F45 4 m\nPlaca solar 150 W\nAntena TV", style: { ...I, resize: "vertical" } })),
        err ? h("div", { style: { color: T.danger, fontSize: "13px" } }, err) : null,
        h("div", { style: { display: "flex", justifyContent: "flex-end", gap: "10px" } }, h("button", { onClick: onClose, style: btn(T) }, "Cancelar"), h("button", { "data-vn-crear": "1", onClick: guardar, disabled: guardando, style: btn(T, "p") }, guardando ? "Creando…" : "Abrir expediente"))));
  }

  // ---------- selector de mecánicos (varios a la vez) ----------
  function ElegirMecanicos({ T, inicial, onOk, onCancel, ok }) {
    const [sel, setSel] = useState(inicial && inicial.length ? inicial : []);
    const tog = (m) => setSel((xs) => (xs.includes(m) ? xs.filter((x) => x !== m) : [...xs, m]));
    return h("div", { "data-vn-mecs": "1", style: { display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center", background: T.bg, borderRadius: "10px", padding: "8px", marginTop: "6px" } },
      h("span", { style: { fontSize: "12px", fontWeight: 800, color: T.inkSoft } }, "¿Quién lo ha montado?"),
      MECANICOS.map((m) => h("button", { key: m, type: "button", "data-mec": m, onClick: () => tog(m), style: { ...btn(T, "s"), background: sel.includes(m) ? T.ink : T.surface, color: sel.includes(m) ? T.bg : T.ink } }, m)),
      h("button", { "data-vn-mecs-ok": "1", disabled: !sel.length, onClick: () => onOk(sel), style: btn(T, "p") }, ok || "Marcar montado"), h("button", { onClick: onCancel, style: btn(T, "s") }, "Cancelar"));
  }

  // ---------- comprobación ----------
  function Comprobacion({ T, tipo, m, onHecho, trab }) {
    const yoN = yo();
    const [por, setPor] = useState(tipo === "mecanico" ? (m.mecanico || "") : tipo === "jefe" ? (yoN || "Sebastián") : (m.comercial || yoN || ""));
    const [items, setItems] = useState(() => Object.fromEntries(CHECKLIST.map((x) => [x, ""])));
    const [notas, setNotas] = useState("");
    const I = inp(T);
    const fallos = tipo === "mecanico" ? CHECKLIST.filter((x) => items[x] === "falla") : [];
    const faltan = tipo === "mecanico" ? CHECKLIST.filter((x) => !items[x]).length : 0;
    const opciones = tipo === "mecanico" ? MECANICOS : tipo === "comercial" ? COMERCIALES : ["Sebastián"];
    const enviar = (resultado) => onHecho({ tipo, resultado, hecho_por: por, notas: notas.trim() || null, checklist: tipo === "mecanico" ? items : null, fallos });
    return h("div", { "data-vn-comp": tipo, style: { background: T.bg, border: `1px solid ${T.border}`, borderRadius: "12px", padding: "12px", display: "flex", flexDirection: "column", gap: "10px" } },
      h(Field, { T, label: tipo === "mecanico" ? "Mecánico que hace la comprobación" : "Quién comprueba" }, h("select", { value: por, onChange: (e) => setPor(e.target.value), "aria-label": "Quién comprueba", style: { ...I, width: "auto" } }, h("option", { value: "" }, "—"), opciones.map((x) => h("option", { key: x, value: x }, x)))),
      tipo === "mecanico" ? h("div", { style: { display: "flex", flexDirection: "column", gap: "4px" } }, CHECKLIST.map((x, i) => h("div", { key: x, "data-check": i, style: { display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center", fontSize: "13px", padding: "3px 0", borderBottom: `1px solid ${T.border}` } },
        h("span", null, x), h("span", { style: { display: "flex", gap: "4px" } }, [["ok", "OK", "verde"], ["falla", "Falla", "rojo"], ["na", "No aplica", "gris"]].map(([k, l, c]) => h("button", { key: k, type: "button", "data-r": k, onClick: () => setItems((o) => ({ ...o, [x]: k })),
          style: { ...btn(T, "s"), fontSize: "11.5px", padding: "3px 8px", background: items[x] === k ? CH[c].bg : T.surface, borderColor: items[x] === k ? CH[c].bd : T.borderHi, color: items[x] === k ? CH[c].fg : T.ink, fontWeight: items[x] === k ? 800 : 600 } }, l)))))) : null,
      h(Field, { T, label: fallos.length || tipo !== "mecanico" ? "Notas / incidencias encontradas" : "Notas (opcional)" }, h("textarea", { rows: 2, "data-vn-comp-notas": "1", value: notas, onChange: (e) => setNotas(e.target.value), style: { ...I, resize: "vertical" } })),
      h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" } },
        h("button", { "data-vn-comp-ok": "1", disabled: trab || !por || faltan > 0 || fallos.length > 0, onClick: () => enviar("ok"), style: btn(T, "p") }, "Todo OK"),
        h("button", { "data-vn-comp-inc": "1", disabled: trab || !por || faltan > 0 || (!fallos.length && !notas.trim()), onClick: () => enviar("incidencias"), style: { ...btn(T), color: CH.rojo.fg } }, "Hay incidencias: vuelve a montaje"),
        faltan ? h("span", { style: { fontSize: "12px", color: T.inkSoft } }, `Faltan ${faltan} puntos por revisar.`) : null),
      h("div", { style: { fontSize: "12px", color: T.inkSoft } }, "Se guarda con la fecha y hora exactas del servidor y no se puede modificar."));
  }

  // ---------- expediente ----------
  function Expediente({ T, F, id, onClose, onChanged }) {
    const [m, setM] = useState(null); const [xs, setXs] = useState([]); const [comps, setComps] = useState([]); const [ev, setEv] = useState([]);
    const [msg, setMsg] = useState(""); const [trab, setTrab] = useState(false); const [bitKey, setBitKey] = useState(0);
    const [montando, setMontando] = useState(null); const [desmontando, setDesmontando] = useState(null);
    const [nx, setNx] = useState({ descripcion: "", cantidad: "1", pieza: "no_necesita" });
    const [d, setD] = useState({}); const [panel, setPanel] = useState(null); const [motivo, setMotivo] = useState(""); const [destino, setDestino] = useState("");
    const [limp, setLimp] = useState({ interior: "", exterior: "" });
    const I = inp(T);
    const cargar = async () => {
      const [a, b, c, e] = await Promise.all([
        sb().from("montajes").select("*, cliente:crm_clientes(*)").eq("id", id).maybeSingle(),
        sb().from("montaje_extras").select("*").eq("montaje_id", id).order("orden").order("created_at"),
        sb().from("montaje_comprobaciones").select("*").eq("montaje_id", id).order("at", { ascending: false }),
        sb().from("crm_eventos").select("*").eq("montaje_id", id).order("at", { ascending: false }).limit(400),
      ]);
      setM(a.data); setXs(b.data || []); setComps(c.data || []); setEv((e.data || []).filter((x) => x.tipo !== "bitacora" && x.tipo !== "nota")); setBitKey((k) => k + 1);
      if (a.data) { const v = a.data.vehiculo || {}; setD({ modelo: v.modelo || "", bastidor: v.bastidor || "", matricula: v.matricula || "", comercial: a.data.comercial || "", mecanico: a.data.mecanico || "", fecha_entrega: a.data.fecha_entrega || "", notas: a.data.notas || "" }); }
    };
    useEffect(() => { cargar(); }, [id]);
    if (!m) return h(Drawer, { T, onClose, width: 900, label: "Expediente vehículo nuevo" }, h("div", { style: { padding: "24px", color: T.inkSoft } }, "Cargando…"));
    const s = est(m.estado), p = progreso(xs), av = avisos(m, xs);
    const puedeMontar = ["en_montaje"].includes(m.estado);
    const upd = async (patch, texto) => {
      setTrab(true); setMsg("");
      const { error } = await sb().from("montajes").update(patch).eq("id", m.id); setTrab(false);
      if (error) { setMsg("No se pudo guardar: " + error.message); return false; }
      if (texto) setMsg(texto); await cargar(); onChanged && onChanged(); return true;
    };
    const updX = async (xid, patch) => { const { error } = await sb().from("montaje_extras").update(patch).eq("id", xid); if (error) setMsg("No se pudo guardar: " + error.message); };
    // Un extra nuevo o por desmontar cuando ya se estaba comprobando o limpiando: vuelve a montaje
    const volverSiHaceFalta = async (porque) => { if (VUELVE_A_MONTAJE.includes(m.estado)) { await anotar(m, `Vuelve a montaje: ${porque}`); await sb().from("montajes").update({ estado: "en_montaje" }).eq("id", m.id); } };
    const addExtra = async () => {
      if (!nx.descripcion.trim()) return;
      setTrab(true);
      const { error } = await sb().from("montaje_extras").insert({ montaje_id: m.id, descripcion: nx.descripcion.trim(), cantidad: Number(String(nx.cantidad).replace(",", ".")) || 1, pieza: nx.pieza, orden: xs.length });
      if (error) setMsg("No se pudo añadir: " + error.message);
      else { await volverSiHaceFalta(`se añadió “${nx.descripcion.trim()}”`); setNx({ descripcion: "", cantidad: "1", pieza: "no_necesita" }); }
      setTrab(false); await cargar(); onChanged && onChanged();
    };
    const quitar = async (x) => {
      if (x.montado_at) { if (!window.confirm(`“${x.descripcion}” ya está montado. ¿Marcarlo para desmontar?`)) return; await updX(x.id, { estado: "desmontar" }); await volverSiHaceFalta(`hay que desmontar “${x.descripcion}”`); }
      else { if (!window.confirm(`¿Quitar “${x.descripcion}” de la lista? Queda en el historial.`)) return; await updX(x.id, { estado: "quitado" }); }
      await cargar(); onChanged && onChanged();
    };
    const reponer = async (x) => { await updX(x.id, { estado: "activo" }); await volverSiHaceFalta(`se vuelve a montar “${x.descripcion}”`); await cargar(); onChanged && onChanged(); };
    const marcarMontado = async (x, mecs) => { await updX(x.id, { montado_at: new Date().toISOString(), mecanicos: mecs }); setMontando(null); await cargar(); onChanged && onChanged(); };
    const desmarcar = async (x) => { if (!window.confirm(`¿Desmarcar “${x.descripcion}” como montado?`)) return; await updX(x.id, { montado_at: null, mecanicos: null }); await cargar(); onChanged && onChanged(); };
    const marcarDesmontado = async (x, mecs) => { await updX(x.id, { estado: "desmontado", desmontado_at: new Date().toISOString(), desmontado_por: mecs }); setDesmontando(null); await cargar(); onChanged && onChanged(); };
    const comprobar = async ({ tipo, resultado, hecho_por, notas, checklist, fallos }) => {
      setTrab(true); setMsg("");
      const r = await sb().from("montaje_comprobaciones").insert({ montaje_id: m.id, tipo, resultado, hecho_por, notas, checklist });
      if (r.error) { setTrab(false); setMsg("No se pudo guardar: " + r.error.message); return; }
      if (resultado === "ok") { await upd({ estado: tipo === "mecanico" ? "comp_jefe" : tipo === "jefe" ? "comp_comercial" : "limpieza" }, "Comprobación registrada."); return; }
      const inc = [...(fallos || []).map((f) => `Revisar: ${f}`), ...(notas && !(fallos || []).length ? [notas] : [])];
      if (inc.length) await sb().from("montaje_extras").insert(inc.map((t, i) => ({ montaje_id: m.id, descripcion: t, origen: "incidencia", orden: xs.length + i })));
      await upd({ estado: "en_montaje" }, "Incidencias registradas: vuelve a montaje.");
    };
    const limpiar = async (zona) => {
      const por = limp[zona].trim(); if (!por) { setMsg("Indica quién ha hecho la limpieza."); return; }
      const patch = zona === "interior" ? { limpieza_interior_at: new Date().toISOString(), limpieza_interior_por: por } : { limpieza_exterior_at: new Date().toISOString(), limpieza_exterior_por: por };
      const otra = zona === "interior" ? m.limpieza_exterior_at : m.limpieza_interior_at;
      if (otra) patch.estado = "listo";
      await upd(patch, otra ? "Limpieza completa: listo para entregar." : "Limpieza registrada.");
    };
    const guardarDatos = () => {
      const v = { ...(m.vehiculo || {}), modelo: d.modelo.trim(), bastidor: normMat(d.bastidor), matricula: normMat(d.matricula) };
      const patch = {};
      if (JSON.stringify(v) !== JSON.stringify(m.vehiculo || {})) patch.vehiculo = v;
      [["comercial", d.comercial], ["mecanico", d.mecanico], ["fecha_entrega", d.fecha_entrega], ["notas", d.notas]].forEach(([k, x]) => { const y = String(x || "").trim() || null; if (y !== (m[k] || null)) patch[k] = y; });
      if (!Object.keys(patch).length) { setMsg("No hay cambios."); return; }
      upd(patch, "Guardado.");
    };
    const activos = xs.filter((x) => x.estado === "activo" || x.estado === "desmontar");
    const fuera = xs.filter((x) => x.estado === "quitado" || x.estado === "desmontado");
    const td = { padding: "7px 6px", borderBottom: `1px solid ${T.border}`, fontSize: "13.5px", verticalAlign: "middle" };
    const fase = (i) => { const done = s.fin ? m.estado === "entregado" : s.f != null && i < s.f, cur = i === s.f && !s.fin; return h("div", { key: i, style: { borderRadius: "6px", padding: "6px 2px", background: cur ? T.rust : done ? CH.verde.bg : T.bgAlt || T.bg, color: cur ? "#fff" : done ? CH.verde.fg : T.inkSoft } }, FASES[i]); };

    return h(Drawer, { T, onClose, width: 900, label: "Expediente vehículo nuevo" },
      h("div", { style: { background: T.surface, padding: "18px 22px", borderBottom: `1px solid ${T.border}`, display: "flex", flexDirection: "column", gap: "6px" } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" } },
          h("span", { style: { fontSize: "12px", color: T.inkSoft, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" } }, `Vehículo nuevo · comercial ${m.comercial || "—"}${m.mecanico ? " · mecánico " + m.mecanico : ""}`),
          h("button", { onClick: onClose, "aria-label": "Cerrar", style: { border: "none", background: "transparent", cursor: "pointer", fontSize: "22px", color: T.inkSoft } }, "×")),
        h("div", { style: { fontFamily: F.display, fontSize: "24px", fontWeight: 800 } }, h("span", { style: { fontFamily: "'JetBrains Mono', monospace" } }, m.numero), " · ", (m.vehiculo || {}).modelo || "—"),
        h("div", { style: { fontSize: "13.5px", color: T.inkSoft, display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" } },
          (m.vehiculo || {}).bastidor ? h("span", null, "Bastidor ", h("b", { style: { fontFamily: "'JetBrains Mono', monospace", color: T.ink } }, m.vehiculo.bastidor)) : h(Chip, { c: "ambar" }, "Falta el bastidor"),
          (m.vehiculo || {}).matricula ? h("span", null, "Matrícula ", h("b", { style: { color: T.ink } }, m.vehiculo.matricula)) : null,
          h("span", null, `Señal ${fFecha(m.fecha_senal)}`), m.pagado_at ? h("span", null, `· Pagado ${fFecha(m.pagado_at)}`) : null,
          h("span", null, m.fecha_entrega ? `· Entrega comprometida ${fFecha(m.fecha_entrega)}` : "· Sin fecha de entrega")),
        m.cliente ? h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", fontSize: "13.5px" } }, h("b", null, nombreCli(m.cliente)), h(ChipCli, { c: m.cliente }), m.cliente.telefono ? h("span", { style: { color: T.inkSoft } }, m.cliente.telefono) : null,
          h("button", { onClick: () => irA("clientes", { acllar_crm_abrir_cliente: m.cliente_id }), style: btn(T, "s") }, "Ficha del cliente →")) : null),
      h("div", { style: { padding: "16px 22px 40px", display: "flex", flexDirection: "column", gap: "14px" } },
        // ---- recorrido y siguiente paso
        h(Box, { T }, h(Lbl, { T }, "Recorrido"),
          h("div", { style: { display: "grid", gridTemplateColumns: "repeat(6, minmax(0,1fr))", gap: "4px", fontSize: "10.5px", fontWeight: 700, textAlign: "center", marginBottom: "12px" } }, FASES.map((_, i) => fase(i))),
          h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } }, h(Chip, { c: s.c, style: { fontSize: "13px" } }, s.l), av.map((a, i) => h(Chip, { key: i, c: a.c }, a.t))),
          !s.fin ? h("div", { style: { display: "flex", flexDirection: "column", gap: "8px", marginTop: "10px" } },
            m.estado === "senado" ? h(React.Fragment, null,
              h("button", { "data-vn-pagado": "1", disabled: trab, onClick: () => upd({ estado: "pagado", pagado_at: new Date().toISOString() }, "Marcado como pagado: ya se puede montar."), style: { ...btn(T, "p"), textAlign: "left" } }, "→ Pagado (pago completo recibido)"),
              panel === "sinpagar" ? h("div", { style: { display: "flex", gap: "8px", alignItems: "flex-end", flexWrap: "wrap" } }, h(Field, { T, label: "Por qué se empieza sin estar pagado", style: { flex: 1 } }, h("input", { "data-vn-sinpagar-motivo": "1", value: motivo, onChange: (e) => setMotivo(e.target.value), style: I })),
                h("button", { "data-vn-sinpagar-ok": "1", disabled: !motivo.trim() || trab, onClick: async () => { await anotar(m, `Montaje autorizado sin estar pagado: ${motivo.trim()}`); if (await upd({ estado: "en_montaje", montaje_sin_pagar: true })) { setPanel(null); setMotivo(""); } }, style: btn(T, "p") }, "Empezar montaje"), h("button", { onClick: () => setPanel(null), style: btn(T) }, "Cancelar"))
                : h("button", { "data-vn-sinpagar": "1", onClick: () => setPanel("sinpagar"), style: { ...btn(T, "s"), alignSelf: "flex-start", color: T.inkSoft } }, "Empezar montaje sin estar pagado…")) : null,
            m.estado === "pagado" ? h("div", { style: { display: "flex", gap: "8px", alignItems: "flex-end", flexWrap: "wrap" } },
              h(Field, { T, label: "Mecánico asignado" }, h("select", { value: d.mecanico || "", onChange: (e) => setD((x) => ({ ...x, mecanico: e.target.value })), "aria-label": "Mecánico asignado", style: { ...I, width: "auto" } }, h("option", { value: "" }, "—"), MECANICOS.map((x) => h("option", { key: x, value: x }, x)))),
              h("button", { "data-vn-empezar": "1", disabled: trab, onClick: () => upd({ estado: "en_montaje", mecanico: d.mecanico || m.mecanico || null }, "Montaje empezado."), style: btn(T, "p") }, "→ Empezar montaje")) : null,
            m.estado === "en_montaje" ? h(React.Fragment, null,
              h("button", { "data-vn-fin-montaje": "1", disabled: trab || p.pendientes > 0, onClick: () => upd({ estado: "comp_mecanico" }, "Montaje terminado: falta la comprobación del mecánico."), style: { ...btn(T, "p"), textAlign: "left" } }, "→ Montaje terminado: comprobación del mecánico"),
              p.pendientes ? h("div", { style: { fontSize: "12.5px", color: T.inkSoft } }, `Quedan ${p.pendientes} extra${p.pendientes > 1 ? "s" : ""} por montar o desmontar.`) : null) : null,
            m.estado === "comp_mecanico" ? h(Comprobacion, { T, tipo: "mecanico", m, trab, onHecho: comprobar }) : null,
            m.estado === "comp_jefe" ? h(Comprobacion, { T, tipo: "jefe", m, trab, onHecho: comprobar }) : null,
            m.estado === "comp_comercial" ? h(Comprobacion, { T, tipo: "comercial", m, trab, onHecho: comprobar }) : null,
            m.estado === "limpieza" ? h("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } }, ["interior", "exterior"].map((z) => { const at = m[`limpieza_${z}_at`];
              return h("div", { key: z, "data-vn-limpieza": z, style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", fontSize: "13.5px" } }, h("b", { style: { width: "80px", textTransform: "capitalize" } }, z),
                at ? h("span", { style: { color: T.ok } }, `✓ ${m[`limpieza_${z}_por`]} · ${fLarga(at)}`)
                  : h(React.Fragment, null, h("input", { value: limp[z], onChange: (e) => setLimp((o) => ({ ...o, [z]: e.target.value })), placeholder: "Quién la ha hecho", "aria-label": `Limpieza ${z} por`, style: { ...I, width: "200px", padding: "6px 8px" } }),
                    h("button", { "data-vn-limpieza-ok": z, disabled: trab || !limp[z].trim(), onClick: () => limpiar(z), style: btn(T, "s") }, "Hecha"))); })) : null,
            m.estado === "listo" ? h("button", { "data-vn-entregado": "1", disabled: trab, onClick: () => upd({ estado: "entregado", entregado_at: new Date().toISOString() }, "Vehículo entregado."), style: { ...btn(T, "p"), textAlign: "left" } }, "→ Entregado al cliente") : null,
            panel === "mover" ? h("div", { style: { display: "flex", gap: "8px", alignItems: "flex-end", flexWrap: "wrap", background: T.bg, padding: "10px", borderRadius: "10px" } },
              h(Field, { T, label: "Llevar al paso" }, h("select", { "data-vn-mover-destino": "1", value: destino, onChange: (e) => setDestino(e.target.value), style: { ...I, width: "auto" } }, h("option", { value: "" }, "Elige…"), Object.keys(EST).filter((k) => !EST[k].fin && k !== m.estado).map((k) => h("option", { key: k, value: k }, EST[k].l)))),
              h(Field, { T, label: "Por qué", style: { flex: 1 } }, h("input", { value: motivo, onChange: (e) => setMotivo(e.target.value), style: I })),
              h("button", { "data-vn-mover-ok": "1", disabled: !destino || trab, onClick: async () => { await anotar(m, `Paso cambiado a mano: ${s.l} → ${est(destino).l}${motivo.trim() ? " · " + motivo.trim() : ""}`); if (await upd({ estado: destino })) { setPanel(null); setMotivo(""); setDestino(""); } }, style: btn(T, "p") }, "Cambiar"), h("button", { onClick: () => setPanel(null), style: btn(T) }, "Cancelar"))
            : panel === "cancelar" ? h("div", { style: { display: "flex", gap: "8px", alignItems: "flex-end", flexWrap: "wrap", background: T.bg, padding: "10px", borderRadius: "10px" } },
              h(Field, { T, label: "Motivo de la cancelación", style: { flex: 1 } }, h("input", { "data-vn-cancelar-motivo": "1", value: motivo, onChange: (e) => setMotivo(e.target.value), style: I })),
              h("button", { "data-vn-cancelar-ok": "1", disabled: !motivo.trim() || trab, onClick: async () => { await anotar(m, `Venta cancelada: ${motivo.trim()}`); if (await upd({ estado: "cancelado", motivo_cierre: motivo.trim() })) { setPanel(null); setMotivo(""); } }, style: { ...btn(T), color: CH.rojo.fg } }, "Cancelar venta"), h("button", { onClick: () => setPanel(null), style: btn(T) }, "Volver"))
            : h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
              h("button", { "data-vn-mover": "1", onClick: () => { setPanel("mover"); setMotivo(""); }, style: { ...btn(T, "s"), color: T.inkSoft } }, "↺ Cambiar de paso…"),
              h("button", { "data-vn-cancelar": "1", onClick: () => { setPanel("cancelar"); setMotivo(""); }, style: { ...btn(T, "s"), color: T.inkSoft } }, "✕ Cancelar la venta…")))
            : h("div", { style: { marginTop: "10px", display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } }, m.estado === "entregado" ? h("span", { style: { fontSize: "13px" } }, `Entregado el ${fLarga(m.entregado_at)}.`) : h("span", { style: { fontSize: "13px" } }, `Motivo: ${m.motivo_cierre || "—"}`),
              h("button", { onClick: async () => { await anotar(m, "Expediente reabierto."); upd({ estado: m.pagado_at ? "en_montaje" : "senado", motivo_cierre: null }, "Reabierto."); }, style: btn(T, "s") }, "Reabrir")),
          msg ? h("div", { style: { marginTop: "8px", fontSize: "12.5px", color: /^No se|Indica/.test(msg) ? T.danger : T.ok } }, msg) : null),

        // ---- extras
        h(Box, { T }, h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" } }, h(Lbl, { T }, `Extras a montar (${p.total})`), h("div", { style: { width: "220px" } }, h(Barra, { T, p }))),
          !puedeMontar && !s.fin ? h("div", { style: { fontSize: "12px", color: T.inkSoft, marginBottom: "6px" } }, m.estado === "senado" ? "Se podrán marcar como montados cuando el vehículo esté pagado (o se autorice empezar sin pagar)." : m.estado === "pagado" ? "Pulsa “Empezar montaje” para ir marcando lo que se monta." : "Si añades o mandas desmontar algo, el expediente vuelve a montaje.") : null,
          activos.length ? h("table", { style: { width: "100%", borderCollapse: "collapse" } }, h("tbody", null, activos.map((x) => h(React.Fragment, { key: x.id },
            h("tr", { "data-vn-extra": x.descripcion },
              h("td", { style: { ...td, width: "34px" } }, x.estado === "desmontar" ? h("span", { title: "Por desmontar" }, "⤺")
                : h("input", { type: "checkbox", "aria-label": `Montado: ${x.descripcion}`, checked: !!x.montado_at, disabled: s.fin || (!puedeMontar && !x.montado_at), onChange: () => (x.montado_at ? desmarcar(x) : setMontando(x.id)) })),
              h("td", { style: td }, h("span", { style: { fontWeight: 700, textDecoration: x.estado === "desmontar" ? "line-through" : "none" } }, x.descripcion), Number(x.cantidad) > 1 ? ` × ${Number(x.cantidad)}` : "",
                x.origen === "incidencia" ? h(Chip, { c: "rojo", style: { marginLeft: "6px" } }, "Incidencia") : null,
                x.estado === "desmontar" ? h(Chip, { c: "rojo", style: { marginLeft: "6px" } }, "Desmontar") : null,
                esNuevo(m, x) && x.origen !== "incidencia" ? h(Chip, { c: "violeta", style: { marginLeft: "6px" } }, `Añadido ${fFecha(x.created_at)} · ${quien(x.created_by)}`) : null,
                x.montado_at ? h("div", { style: { fontSize: "12px", color: T.inkSoft } }, `Montado por ${(x.mecanicos || []).join(", ") || "—"} · ${fLarga(x.montado_at)}`) : null),
              h("td", { style: { ...td, width: "150px" } }, x.montado_at || x.estado !== "activo" ? (x.pieza !== "no_necesita" ? h("span", { style: { fontSize: "12px", color: T.inkSoft } }, (PIEZA.find((q) => q[0] === x.pieza) || ["", ""])[1]) : null)
                : h("select", { value: x.pieza, disabled: s.fin, "aria-label": `Pieza: ${x.descripcion}`, onChange: async (e) => { await updX(x.id, { pieza: e.target.value }); cargar(); onChanged && onChanged(); }, style: { ...I, padding: "4px 6px", fontSize: "12.5px", borderColor: x.pieza === "por_pedir" ? CH.ambar.bd : x.pieza === "pedida" ? CH.azul.bd : T.borderHi } }, PIEZA.map(([k, l]) => h("option", { key: k, value: k }, l)))),
              h("td", { style: { ...td, width: "120px", textAlign: "right" } }, s.fin ? null : x.estado === "desmontar"
                ? h("button", { "data-vn-desmontado": x.descripcion, onClick: () => setDesmontando(x.id), style: { ...btn(T, "s"), fontSize: "11.5px" } }, "Desmontado")
                : h("button", { "data-vn-quitar": x.descripcion, onClick: () => quitar(x), style: { ...btn(T, "s"), fontSize: "11.5px", color: T.inkSoft } }, "Quitar"))),
            montando === x.id ? h("tr", null, h("td", { colSpan: 4 }, h(ElegirMecanicos, { T, inicial: m.mecanico ? [m.mecanico] : [], onOk: (mecs) => marcarMontado(x, mecs), onCancel: () => setMontando(null) }))) : null,
            desmontando === x.id ? h("tr", null, h("td", { colSpan: 4 }, h(ElegirMecanicos, { T, inicial: m.mecanico ? [m.mecanico] : [], ok: "Marcar desmontado", onOk: (mecs) => marcarDesmontado(x, mecs), onCancel: () => setDesmontando(null) }))) : null)))) : h("div", { style: { fontSize: "13px", color: T.inkFaint } }, "Sin extras."),
          !s.fin ? h("div", { style: { display: "grid", gridTemplateColumns: "1fr 70px 150px auto", gap: "6px", marginTop: "10px" } },
            h("input", { value: nx.descripcion, onChange: (e) => setNx((o) => ({ ...o, descripcion: e.target.value })), onKeyDown: (e) => { if (e.key === "Enter") addExtra(); }, placeholder: "Nuevo extra (p. ej. Portabicis Thule)", "aria-label": "Nuevo extra", style: I }),
            h("input", { value: nx.cantidad, onChange: (e) => setNx((o) => ({ ...o, cantidad: e.target.value })), inputMode: "decimal", "aria-label": "Cantidad del extra", style: I }),
            h("select", { value: nx.pieza, onChange: (e) => setNx((o) => ({ ...o, pieza: e.target.value })), "aria-label": "Pieza del extra", style: I }, PIEZA.slice(0, 3).map(([k, l]) => h("option", { key: k, value: k }, l))),
            h("button", { "data-vn-add-extra": "1", disabled: trab || !nx.descripcion.trim(), onClick: addExtra, style: btn(T, "p") }, "Añadir")) : null,
          fuera.length ? h("div", { style: { marginTop: "10px", fontSize: "12.5px", color: T.inkSoft } }, h("b", null, "Quitados / desmontados: "),
            fuera.map((x) => h("span", { key: x.id, style: { marginRight: "10px" } }, h("span", { style: { textDecoration: "line-through" } }, x.descripcion), x.estado === "desmontado" ? ` (desmontado por ${(x.desmontado_por || []).join(", ")} · ${fFecha(x.desmontado_at)})` : "",
              !s.fin ? h("button", { onClick: () => reponer(x), style: { border: "none", background: "transparent", color: T.rust, cursor: "pointer", fontSize: "12px", fontWeight: 700 } }, "volver a poner") : null))) : null),

        // ---- comprobaciones
        comps.length ? h(Box, { T }, h(Lbl, { T }, "Comprobaciones"),
          comps.map((c) => h("div", { key: c.id, "data-vn-comprobacion": c.tipo, style: { borderTop: `1px solid ${T.border}`, padding: "8px 0", fontSize: "13.5px" } },
            h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } }, h("b", null, COMP_TIPO[c.tipo]), h(Chip, { c: c.resultado === "ok" ? "verde" : "rojo" }, c.resultado === "ok" ? "OK" : "Incidencias"),
              h("span", null, `Hecha por ${c.hecho_por} · ${fLarga(c.at)}`), h("span", { style: { fontSize: "12px", color: T.inkSoft } }, `registrada por ${quien(c.registrado_por)}`)),
            c.notas ? h("div", { style: { fontSize: "13px", marginTop: "4px" } }, c.notas) : null,
            c.checklist ? h("div", { style: { fontSize: "12px", color: T.inkSoft, marginTop: "4px" } }, Object.entries(c.checklist).filter(([, v]) => v === "falla").map(([k]) => "✗ " + k).join(" · ") || "Checklist completo sin fallos") : null))) : null,

        // ---- limpieza (si ya se hizo)
        m.limpieza_interior_at || m.limpieza_exterior_at ? h(Box, { T }, h(Lbl, { T }, "Limpieza"), ["interior", "exterior"].map((z) => h("div", { key: z, style: { fontSize: "13.5px" } }, h("b", { style: { textTransform: "capitalize" } }, z + ": "), m[`limpieza_${z}_at`] ? `${m[`limpieza_${z}_por`]} · ${fLarga(m[`limpieza_${z}_at`])}` : "pendiente"))) : null,

        // ---- bitácora
        h(Bitacora, { T, montaje_id: m.id, cliente_id: m.cliente_id || null, titulo: "Bitácora del expediente", recargar: bitKey }),

        // ---- datos
        h(Box, { T }, h(Lbl, { T }, "Datos del expediente"),
          h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" } },
            h(Field, { T, label: "Modelo" }, h("input", { value: d.modelo, onChange: (e) => setD((x) => ({ ...x, modelo: e.target.value })), style: I })),
            h(Field, { T, label: "Bastidor" }, h("input", { "data-vn-bastidor": "1", value: d.bastidor, onChange: (e) => setD((x) => ({ ...x, bastidor: e.target.value })), style: { ...I, fontFamily: "'JetBrains Mono', monospace" } })),
            h(Field, { T, label: "Matrícula" }, h("input", { value: d.matricula, onChange: (e) => setD((x) => ({ ...x, matricula: e.target.value })), style: I })),
            h(Field, { T, label: "Comercial" }, h("select", { value: d.comercial, onChange: (e) => setD((x) => ({ ...x, comercial: e.target.value })), style: I }, h("option", { value: "" }, "—"), COMERCIALES.map((c) => h("option", { key: c, value: c }, c)))),
            h(Field, { T, label: "Mecánico asignado" }, h("select", { value: d.mecanico, onChange: (e) => setD((x) => ({ ...x, mecanico: e.target.value })), style: I }, h("option", { value: "" }, "—"), MECANICOS.map((c) => h("option", { key: c, value: c }, c)))),
            h(Field, { T, label: "Entrega comprometida" }, h("input", { type: "date", value: d.fecha_entrega || "", onChange: (e) => setD((x) => ({ ...x, fecha_entrega: e.target.value })), style: I })),
            h(Field, { T, label: "Notas", style: { gridColumn: "1 / -1" } }, h("textarea", { rows: 2, value: d.notas, onChange: (e) => setD((x) => ({ ...x, notas: e.target.value })), style: { ...I, resize: "vertical" } }))),
          h("button", { "data-vn-guardar": "1", onClick: guardarDatos, disabled: trab, style: { ...btn(T, "p"), marginTop: "10px" } }, "Guardar datos")),

        h(Box, { T }, h(Lbl, { T }, "Cambios automáticos · estados, extras y comprobaciones"),
          h("ol", { style: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "9px", fontSize: "13px" } },
            ev.map((e) => h("li", { key: e.id, style: { display: "grid", gridTemplateColumns: "84px 1fr", gap: "8px" } }, h("span", { style: { color: T.inkSoft } }, fFechaHora(e.at)), h("span", null, h("b", null, quien(e.autor)), " · ", textoEventoM(e))))))));
  }

  window.AcllarMontajes = MontajesView;
  window.AcllarMontajes._test = { EST, progreso, avisos, textoEventoM };
})();
