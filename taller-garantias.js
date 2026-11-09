// taller-garantias.js  ---  TALLER → Garantías
// Registro exhaustivo de cada garantía (o gestión de chasis): cliente o vehículo de flota, problemas,
// trabajos con horas y mecánico, piezas (y si el fabricante ya las ha repuesto), fotos y tramitación.
// La reclamación se hace luego en la web del fabricante; esto es para no olvidar nada de lo que se hizo.
// Tablas: garantias / garantia_lineas / garantia_fotos (+ historial en crm_eventos con garantia_id).
// Fotos: bucket privado "garantias". Nada se borra: las líneas y fotos se anulan.
// Se carga después de taller-crm.js y usa sus piezas visuales (window.AcllarCRM._ui).
(function () {
  if (!window.React || !window.AcllarCRM || !window.AcllarCRM._ui) return;
  const U = window.AcllarCRM._ui;
  const { h, CH, Chip, btn, inp, Lbl, Box, Row, Field, Seg, Drawer, sb, quien, fFecha, fFechaHora, toLocalInput, fromLocalInput, nombreCli, normMat, asVeh, vehTxt, vehDeBC, buscarClientes, ResultadoCliente, horas, pad } = U;
  const { useState, useEffect, useRef } = React;

  const FAB_GARANTIA = [["Benimar", "Benimar"], ["Roller Team", "Roller Team"], ["Otro", "Otro"]];
  const FAB_CHASIS = [["Ford", "Ford"], ["Fiat", "Fiat"], ["Peugeot", "Peugeot"], ["Otro", "Otro"]];
  const MECANICOS = ["Ali", "Carlos", "Hugo", "Agente externo", "Sebastián"];
  const ETIQUETAS = [["antes", "Antes"], ["despues", "Después"], ["pieza", "Pieza cambiada"], ["otra", "Otra"]];
  const EST = {
    en_curso: { l: "Reparación en curso", c: "ambar", sig: [{ to: "terminado", l: "Trabajo terminado" }] },
    terminado: { l: "Terminado · pendiente de tramitar", c: "ambar", sig: [{ to: "tramitada", l: "Tramitada en la web del fabricante", set: { tramitada_at: "__now__" } }, { to: "en_curso", l: "Volver a en curso" }] },
    tramitada: { l: "Tramitada", c: "azul", sig: [
      { to: "aprobada", l: "Aprobada", set: { resultado: "aprobada", resolucion_at: "__now__" } },
      { to: "parcial", l: "Aprobada parcial", set: { resultado: "parcial", resolucion_at: "__now__" } },
      { to: "rechazada", l: "Rechazada", set: { resultado: "rechazada", resolucion_at: "__now__" } }] },
    aprobada: { l: "Aprobada", c: "verde", sig: [{ to: "cerrada", l: "Cerrar (piezas repuestas)" }] },
    parcial: { l: "Aprobada parcial", c: "violeta", sig: [{ to: "cerrada", l: "Cerrar" }] },
    rechazada: { l: "Rechazada", c: "rojo", sig: [{ to: "cerrada", l: "Cerrar" }] },
    abierta: { l: "Abierta", c: "ambar", sig: [{ to: "cita_pedida", l: "Cita pedida en el concesionario" }, { to: "cerrada", l: "Cerrar" }] },
    cita_pedida: { l: "Cita pedida", c: "azul", sig: [{ to: "en_concesionario", l: "Vehículo en el concesionario" }, { to: "cerrada", l: "Cerrar" }] },
    en_concesionario: { l: "En el concesionario", c: "violeta", sig: [{ to: "cerrada", l: "Vuelto · cerrar" }] },
    cerrada: { l: "Cerrada", c: "gris", fin: true, sig: [] },
  };
  const est = (k) => EST[k] || { l: k || "—", c: "gris", sig: [] };
  const CAMPOS = { estado: "Estado", fabricante: "Fabricante", descripcion: "Descripción", reclamacion_no: "Nº reclamación", resultado: "Resultado", concesionario: "Concesionario", cita_at: "Cita",
    notas: "Notas", vehiculo: "Vehículo", tramitada_at: "Tramitada", resolucion_at: "Resolución", horas: "Horas", mecanico: "Mecánico", fecha: "Fecha", referencia: "Referencia", cantidad: "Cantidad",
    origen_pieza: "Origen", repuesto_recibido_at: "Repuesto recibido", anulada: "Anulada", fecha_entrada: "Entrada", archivado: "Archivado" };
  const NOW = "__now__";
  const num = (v) => (v === "" || v == null ? null : Number(String(v).replace(",", ".")));
  const fmtH = (n) => `${Number(n || 0).toLocaleString("es-ES", { maximumFractionDigits: 2 })} h`;
  const vehLinea = (v) => { const x = v || {}; return [x.ac, x.modelo, x.matricula ? normMat(x.matricula) : null].filter(Boolean).join(" · ") || "—"; };

  function totales(lineas) {
    const vivas = lineas.filter((l) => !l.anulada);
    const tr = vivas.filter((l) => l.tipo === "trabajo"), pz = vivas.filter((l) => l.tipo === "pieza");
    const porMec = {}; tr.forEach((l) => { const k = l.mecanico || "—"; porMec[k] = (porMec[k] || 0) + Number(l.horas || 0); });
    return { horas: tr.reduce((a, l) => a + Number(l.horas || 0), 0), piezas: pz.reduce((a, l) => a + Number(l.cantidad || 0), 0), lineasPieza: pz.length,
      pendRepuesto: pz.filter((l) => !l.repuesto_recibido_at).length, problemas: vivas.filter((l) => l.tipo === "problema").length, porMec };
  }
  function aviso(g, t) {
    const hEst = horas(g.estado_at || g.created_at);
    if (g.estado === "terminado" && hEst > 168) return { t: `Sin tramitar ${Math.floor(hEst / 24)} d`, c: "rojo" };
    if (g.estado === "tramitada" && hEst > 720) return { t: `Sin resolución ${Math.floor(hEst / 24)} d`, c: "ambar" };
    if ((g.estado === "aprobada" || g.estado === "parcial") && t && t.pendRepuesto) return { t: `${t.pendRepuesto} pieza${t.pendRepuesto > 1 ? "s" : ""} por reponer`, c: "ambar" };
    return null;
  }
  function textoEventoG(ev) {
    const d = ev.detalle || {};
    if (ev.tipo === "g_creado") return `Expediente ${d.numero} creado`;
    if (ev.tipo === "g_linea_alta") return d.linea === "problema" ? `Problema añadido: “${d.descripcion || ""}”` : d.linea === "trabajo" ? `Trabajo: “${d.descripcion || ""}” · ${fmtH(d.horas)}` : `Pieza: ${d.cantidad || 1} × ${d.referencia ? d.referencia + " " : ""}${d.descripcion || ""}`;
    if (ev.tipo === "nota") return `Nota: “${ev.texto}”`;
    if (ev.tipo === "g_foto") return ev.texto || "Foto añadida";
    if (ev.texto) return ev.texto;
    const pref = ev.tipo === "g_linea_cambio" ? `${d.linea === "problema" ? "Problema" : d.linea === "trabajo" ? "Trabajo" : "Pieza"} “${d.descripcion || ""}”: ` : "";
    const partes = Object.keys(d).filter((k) => !["linea", "descripcion"].includes(k) || (ev.tipo !== "g_linea_cambio" && k === "descripcion")).map((k) => {
      const v = d[k] || {};
      if (k === "estado") return `Estado: ${est(v.de).l} → ${est(v.a).l}`;
      if (k === "anulada") return v.a ? "anulado" : "reactivado";
      if (k === "repuesto_recibido_at") return v.a ? "repuesto recibido" : "repuesto desmarcado";
      const f = (x) => (x == null || x === "" ? "—" : typeof x === "object" ? vehLinea(x) : /_at$/.test(k) ? fFechaHora(x) : String(x));
      return `${CAMPOS[k] || k}: ${f(v.de)} → ${f(v.a)}`;
    });
    return pref + (partes.join(" · ") || "cambio");
  }

  // Reduce la foto antes de subirla (móvil: 4000 px → 1600 px).
  async function comprimir(file) {
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      return await new Promise((r) => c.toBlob((b) => r(b || file), "image/jpeg", 0.82));
    } catch (e) { return file; }
  }

  // =====================================================================
  function GarantiasView({ T, F, flota }) {
    const [lista, setLista] = useState([]); const [lineas, setLineas] = useState([]);
    const [cargando, setCargando] = useState(true); const [error, setError] = useState("");
    const [filtro, setFiltro] = useState("abiertas"); const [txt, setTxt] = useState("");
    const [abierta, setAbierta] = useState(null); const [nuevo, setNuevo] = useState(false);
    const rol = window.acllarCloud && window.acllarCloud.rol ? window.acllarCloud.rol() : null;
    const sinAcceso = rol && rol !== "admin" && rol !== "comercial";
    const cargar = async () => {
      if (!sb() || sinAcceso) { setCargando(false); return; }
      const [a, b] = await Promise.all([
        sb().from("garantias").select("*, cliente:crm_clientes(id,nombre,apellidos,bc_no)").eq("archivado", false).order("created_at", { ascending: false }).limit(2000),
        sb().from("garantia_lineas").select("garantia_id,tipo,horas,cantidad,repuesto_recibido_at,anulada").limit(20000),
      ]);
      if (a.error) setError("No se pudieron cargar las garantías: " + a.error.message); else { setLista(a.data || []); setLineas(b.data || []); setError(""); }
      setCargando(false);
    };
    useEffect(() => { cargar(); const t = setInterval(cargar, 60000); return () => clearInterval(t); }, []);
    useEffect(() => { // abrir un expediente pedido desde el CRM
      const id = (() => { try { return localStorage.getItem("acllar_garantia_abrir"); } catch (e) { return null; } })();
      if (id) { try { localStorage.removeItem("acllar_garantia_abrir"); } catch (e) {} setAbierta(id); }
    }, []);
    if (sinAcceso) return h("div", { style: { background: T.surface, border: `1px dashed ${T.border}`, borderRadius: "14px", padding: "36px", textAlign: "center", color: T.inkSoft } }, "Tu cuenta no tiene acceso a Garantías.");

    const tot = {}; lista.forEach((g) => { tot[g.id] = totales(lineas.filter((l) => l.garantia_id === g.id)); });
    const q = txt.trim().toLowerCase();
    const visibles = lista.filter((g) => (filtro === "abiertas" ? !est(g.estado).fin : filtro === "cerradas" ? est(g.estado).fin : true))
      .filter((g) => !q || [g.numero, g.fabricante, g.descripcion, g.reclamacion_no, vehLinea(g.vehiculo), g.vehiculo && g.vehiculo.bastidor, g.cliente && nombreCli(g.cliente)].join(" ").toLowerCase().includes(q));
    const nPend = lista.filter((g) => g.estado === "terminado").length;
    const nEsp = lista.filter((g) => g.estado === "tramitada").length;
    const nRep = lista.filter((g) => (g.estado === "aprobada" || g.estado === "parcial") && tot[g.id].pendRepuesto).length;
    const th = { fontSize: "11px", letterSpacing: ".08em", textTransform: "uppercase", color: T.inkSoft, fontWeight: 700, padding: "10px 12px", textAlign: "left", borderBottom: `1.5px solid ${T.border}` };
    const td = { padding: "11px 12px", borderBottom: `1px solid ${T.border}`, verticalAlign: "top", fontSize: "13.5px" };
    const kpi = (n, l, c) => h("div", { style: { background: T.surface, border: `1px solid ${n ? CH[c].bd : T.border}`, borderRadius: "12px", padding: "10px 14px", minWidth: "170px" } },
      h("div", { style: { fontSize: "22px", fontWeight: 800, color: n ? CH[c].fg : T.inkFaint } }, n), h("div", { style: { fontSize: "12px", color: T.inkSoft, fontWeight: 700 } }, l));
    return h("div", { "data-garantias": "1", style: { fontFamily: F.body, color: T.ink, display: "flex", flexDirection: "column", gap: "16px" } },
      h("div", { style: { display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center" } },
        h("input", { type: "search", value: txt, onChange: (e) => setTxt(e.target.value), "aria-label": "Buscar garantía", placeholder: "Buscar por nº, matrícula, bastidor, cliente, fabricante o nº de reclamación", style: { ...inp(T), flex: "1 1 420px", height: "46px", borderRadius: "12px" } }),
        h("button", { "data-g-nuevo": "1", onClick: () => setNuevo(true), style: { ...btn(T, "p"), height: "46px", padding: "0 20px", fontSize: "15px" } }, "+ Nuevo expediente")),
      h("div", { style: { display: "flex", flexWrap: "wrap", gap: "10px" } }, kpi(nPend, "Pendientes de tramitar", "ambar"), kpi(nEsp, "Esperando resolución", "azul"), kpi(nRep, "Con piezas por reponer", "violeta")),
      h(Seg, { T, opts: [["abiertas", "Abiertas"], ["cerradas", "Cerradas"], ["todas", "Todas"]], value: filtro, onChange: setFiltro }),
      error ? h("div", { style: { color: T.danger, fontSize: "13px" } }, error) : null,
      cargando ? h("div", { style: { color: T.inkFaint, fontSize: "13px" } }, "Cargando…")
        : !visibles.length ? h("div", { style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: "14px", padding: "28px", textAlign: "center", color: T.inkSoft } }, lista.length ? "Ningún expediente con ese filtro." : "Todavía no hay expedientes. Crea el primero con “+ Nuevo expediente”.")
        : h("div", { style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: "14px", overflowX: "auto" } },
          h("table", { style: { width: "100%", borderCollapse: "collapse", minWidth: "980px" } },
            h("thead", null, h("tr", null, ["Nº", "Vehículo", "Cliente / flota", "Fabricante", "Estado", "Horas", "Piezas", "Entrada"].map((x) => h("th", { key: x, style: th }, x)))),
            h("tbody", null, visibles.map((g) => { const t = tot[g.id], s = est(g.estado), av = aviso(g, t);
              return h("tr", { key: g.id, "data-g-fila": g.numero, onClick: () => setAbierta(g.id), style: { cursor: "pointer" } },
                h("td", { style: { ...td, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 } }, g.numero, g.tipo === "chasis" ? h("div", null, h(Chip, { c: "gris" }, "Chasis")) : null),
                h("td", { style: td }, h("b", null, vehLinea(g.vehiculo)), g.vehiculo && g.vehiculo.bastidor ? h("div", { style: { fontSize: "12px", color: T.inkSoft, fontFamily: "'JetBrains Mono', monospace" } }, g.vehiculo.bastidor) : null),
                h("td", { style: td }, g.origen === "flota" ? h(Chip, { c: "azul" }, "Flota") : nombreCli(g.cliente)),
                h("td", { style: td }, g.fabricante || "—"),
                h("td", { style: td }, h(Chip, { c: s.c }, s.l), av ? h("div", { style: { marginTop: "4px" } }, h(Chip, { c: av.c }, av.t)) : null),
                h("td", { style: { ...td, fontWeight: 700 } }, fmtH(t.horas)),
                h("td", { style: td }, t.lineasPieza ? `${t.piezas} (${t.lineasPieza - t.pendRepuesto}/${t.lineasPieza} repuestas)` : "—"),
                h("td", { style: td }, fFecha(g.fecha_entrada || g.created_at)));
            })))),
      nuevo ? h(NuevoExpediente, { T, F, flota, onClose: () => setNuevo(false), onCreated: (g) => { setNuevo(false); cargar(); setAbierta(g.id); } }) : null,
      abierta ? h(Expediente, { T, F, id: abierta, flota, onClose: () => { setAbierta(null); cargar(); }, onChanged: cargar }) : null);
  }

  // ---------- nuevo expediente ----------
  async function crearExpediente({ tipo, origen, cliente, bc, vehiculo, fabricante, descripcion, caso_id }) {
    let clienteId = cliente ? cliente.id : null;
    if (!clienteId && bc) {
      const ex = await sb().from("crm_clientes").select("id").eq("bc_no", bc.no).maybeSingle();
      if (ex.data) clienteId = ex.data.id;
      else { const ins = await sb().from("crm_clientes").insert({ bc_no: bc.no, nombre: bc.nombre || "(sin nombre)", telefono: bc.telefono, email: bc.email, direccion: bc.direccion, cp: bc.cp, ciudad: bc.ciudad, provincia: bc.provincia, nif: bc.nif }).select("id").single(); if (ins.error) throw ins.error; clienteId = ins.data.id; }
    }
    const ins = await sb().from("garantias").insert({ tipo, origen, cliente_id: origen === "cliente" ? clienteId : null, caso_id: caso_id || null, vehiculo: vehiculo || {}, fabricante: fabricante || null, descripcion: descripcion || null, estado: tipo === "chasis" ? "abierta" : "en_curso" }).select("*").single();
    if (ins.error) throw ins.error;
    return ins.data;
  }
  window.AcllarGarantiasCrear = crearExpediente; // usado desde el CRM (caso de garantía → expediente)

  function NuevoExpediente({ T, F, flota, onClose, onCreated }) {
    const [tipo, setTipo] = useState("garantia"); const [origen, setOrigen] = useState("cliente");
    const [q, setQ] = useState(""); const [res, setRes] = useState([]); const [sel, setSel] = useState(null);
    const [vehs, setVehs] = useState([]); const [vSel, setVSel] = useState(null);
    const [veh, setVeh] = useState({ modelo: "", matricula: "", bastidor: "" });
    const [qf, setQf] = useState(""); const [ac, setAc] = useState(null);
    const [fab, setFab] = useState("Benimar"); const [desc, setDesc] = useState("");
    const [err, setErr] = useState(""); const [guardando, setGuardando] = useState(false);
    const t = useRef(null); const I = inp(T);
    useEffect(() => { setFab(tipo === "chasis" ? "Ford" : "Benimar"); }, [tipo]);
    useEffect(() => { clearTimeout(t.current); if (sel || q.trim().length < 2) { setRes([]); return; } t.current = setTimeout(async () => { try { setRes(await buscarClientes(q)); } catch (e) {} }, 300); }, [q, sel]);
    useEffect(() => {
      setVSel(null); setVehs([]); if (!sel) return;
      const own = sel.tipo === "crm" ? (sel.c.vehiculos || []).map(asVeh) : [];
      const no = sel.tipo === "crm" ? sel.c.bc_no : sel.bc.no;
      if (no) sb().from("bc_productos_servicio").select("*").eq("cliente_no", no).eq("activo", true).then((r) => setVehs([...own, ...(r.data || []).filter((p) => !own.some((v) => v.bc_ps === p.no)).map(vehDeBC)]));
      else setVehs(own);
    }, [sel]);
    const flotaF = (flota || []).filter((v) => !qf.trim() || [v.id, v.model, v.plate, v.brand].join(" ").toLowerCase().includes(qf.trim().toLowerCase())).slice(0, 12);
    const guardar = async () => {
      setErr("");
      let vehiculo;
      if (origen === "flota") { if (!ac) { setErr("Elige el vehículo de la flota."); return; } vehiculo = { ac: ac.id, modelo: [ac.brand, ac.model].filter(Boolean).join(" "), matricula: ac.plate || "", bastidor: ac.vin || "" }; }
      else {
        if (!sel) { setErr("Elige el cliente."); return; }
        vehiculo = vSel != null ? vehs[vSel] : { modelo: veh.modelo.trim(), matricula: normMat(veh.matricula), bastidor: normMat(veh.bastidor) };
        if (!vehiculo.modelo && !vehiculo.matricula) { setErr("Indica el vehículo."); return; }
      }
      setGuardando(true);
      try { onCreated(await crearExpediente({ tipo, origen, cliente: sel && sel.tipo === "crm" ? sel.c : null, bc: sel && sel.tipo === "bc" ? sel.bc : null, vehiculo, fabricante: fab, descripcion: desc.trim() })); }
      catch (e) { setErr("No se pudo crear: " + (e.message || e)); setGuardando(false); }
    };
    return h("div", { role: "dialog", "aria-label": "Nuevo expediente", style: { position: "fixed", inset: 0, zIndex: 1250, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "30px 12px" } },
      h("div", { onClick: onClose, style: { position: "fixed", inset: 0, background: "rgba(15,27,46,.35)" } }),
      h("div", { style: { position: "relative", width: "min(680px, 100%)", background: T.surface, borderRadius: "16px", border: `1px solid ${T.border}`, padding: "22px", display: "flex", flexDirection: "column", gap: "14px", fontFamily: F.body, color: T.ink } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } }, h("div", { style: { fontFamily: F.display, fontSize: "22px", fontWeight: 800 } }, "Nuevo expediente"), h("button", { onClick: onClose, "aria-label": "Cerrar", style: { border: "none", background: "transparent", cursor: "pointer", fontSize: "22px", color: T.inkSoft } }, "×")),
        h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" } },
          h("div", null, h("div", { style: { fontSize: "12px", fontWeight: 800, color: T.inkSoft, marginBottom: "5px" } }, "Tipo"), h(Seg, { T, opts: [["garantia", "Garantía"], ["chasis", "Gestión de chasis"]], value: tipo, onChange: setTipo })),
          h("div", null, h("div", { style: { fontSize: "12px", fontWeight: 800, color: T.inkSoft, marginBottom: "5px" } }, "Vehículo de"), h(Seg, { T, opts: [["cliente", "Cliente"], ["flota", "Flota de alquiler"]], value: origen, onChange: setOrigen }))),
        origen === "flota" ? h("div", null,
          ac ? h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", background: T.bg, borderRadius: "10px", padding: "10px 12px" } }, h("b", null, `${ac.id} · ${[ac.brand, ac.model].filter(Boolean).join(" ")} · ${ac.plate || "sin matrícula"}`), h("button", { onClick: () => setAc(null), style: btn(T, "s") }, "Cambiar"))
            : h(React.Fragment, null, h(Field, { T, label: "Vehículo de la flota" }, h("input", { value: qf, onChange: (e) => setQf(e.target.value), placeholder: (flota || []).length ? "AC-xxx, modelo o matrícula" : "La flota no está disponible en esta cuenta", style: I })),
              h("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "6px" } }, flotaF.map((v) => h("button", { key: v.id, onClick: () => setAc(v), style: btn(T, "s") }, `${v.id} · ${v.model || v.brand || ""} · ${v.plate || "—"}`)))))
          : sel ? h(React.Fragment, null,
            h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", background: T.bg, borderRadius: "10px", padding: "10px 12px" } }, h("b", null, sel.tipo === "crm" ? nombreCli(sel.c) : sel.bc.nombre), h("button", { onClick: () => setSel(null), style: btn(T, "s") }, "Cambiar")),
            h("div", null, h("div", { style: { fontSize: "12px", fontWeight: 800, color: T.inkSoft, marginBottom: "5px" } }, "Vehículo"),
              vehs.length ? h("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "8px" } }, vehs.map((v, i) => h("button", { key: i, onClick: () => setVSel(vSel === i ? null : i), style: { ...btn(T, "s"), background: vSel === i ? T.ink : T.surface, color: vSel === i ? T.bg : T.ink } }, vehTxt(v) || v.modelo)), h("button", { onClick: () => setVSel(null), style: { ...btn(T, "s"), borderStyle: "dashed" } }, "Otro vehículo")) : null,
              vSel == null ? h("div", { style: { display: "grid", gridTemplateColumns: "1.3fr 1fr 1.3fr", gap: "8px" } },
                h("input", { value: veh.modelo, onChange: (e) => setVeh((x) => ({ ...x, modelo: e.target.value })), placeholder: "Modelo", "aria-label": "Modelo", style: I }),
                h("input", { value: veh.matricula, onChange: (e) => setVeh((x) => ({ ...x, matricula: e.target.value })), placeholder: "Matrícula", "aria-label": "Matrícula", style: I }),
                h("input", { value: veh.bastidor, onChange: (e) => setVeh((x) => ({ ...x, bastidor: e.target.value })), placeholder: "Bastidor", "aria-label": "Bastidor", style: I })) : null))
          : h(React.Fragment, null, h(Field, { T, label: "Cliente (nombre, teléfono, matrícula…)" }, h("input", { type: "search", value: q, onChange: (e) => setQ(e.target.value), style: I })),
            res.length ? h("div", { style: { border: `1px solid ${T.border}`, borderRadius: "10px", overflow: "hidden" } }, res.map((r) => h(ResultadoCliente, { key: r.k, T, r, cta: "Usar", onPick: setSel }))) : null),
        h("div", null, h("div", { style: { fontSize: "12px", fontWeight: 800, color: T.inkSoft, marginBottom: "5px" } }, "Fabricante"), h(Seg, { T, opts: tipo === "chasis" ? FAB_CHASIS : FAB_GARANTIA, value: fab, onChange: setFab })),
        h(Field, { T, label: tipo === "chasis" ? "Qué hay que gestionar" : "Descripción general (opcional)" }, h("textarea", { rows: 2, value: desc, onChange: (e) => setDesc(e.target.value), style: { ...I, resize: "vertical" } })),
        err ? h("div", { style: { color: T.danger, fontSize: "13px" } }, err) : null,
        h("div", { style: { display: "flex", justifyContent: "flex-end", gap: "10px" } }, h("button", { onClick: onClose, style: btn(T) }, "Cancelar"), h("button", { "data-g-crear": "1", onClick: guardar, disabled: guardando, style: btn(T, "p") }, guardando ? "Creando…" : "Crear expediente"))));
  }

  // ---------- expediente ----------
  function Expediente({ T, F, id, onClose, onChanged }) {
    const [g, setG] = useState(null); const [ls, setLs] = useState([]); const [fotos, setFotos] = useState([]); const [urls, setUrls] = useState({}); const [ev, setEv] = useState([]);
    const [d, setD] = useState({}); const [msg, setMsg] = useState(""); const [trab, setTrab] = useState(false);
    const [nuevoProb, setNuevoProb] = useState(""); const [nota, setNota] = useState(""); const [verFoto, setVerFoto] = useState(null);
    const I = inp(T);
    const cargar = async () => {
      const [a, b, c, e] = await Promise.all([
        sb().from("garantias").select("*, cliente:crm_clientes(*), caso:crm_casos(id,estado,consulta)").eq("id", id).maybeSingle(),
        sb().from("garantia_lineas").select("*").eq("garantia_id", id).order("orden").order("created_at"),
        sb().from("garantia_fotos").select("*").eq("garantia_id", id).eq("anulada", false).order("created_at"),
        sb().from("crm_eventos").select("*").eq("garantia_id", id).order("at", { ascending: false }).limit(300),
      ]);
      setG(a.data); setLs(b.data || []); setFotos(c.data || []); setEv(e.data || []);
      if (a.data) setD({ fabricante: a.data.fabricante || "", descripcion: a.data.descripcion || "", reclamacion_no: a.data.reclamacion_no || "", concesionario: a.data.concesionario || "", cita_at: toLocalInput(a.data.cita_at), notas: a.data.notas || "",
        modelo: (a.data.vehiculo || {}).modelo || "", matricula: (a.data.vehiculo || {}).matricula || "", bastidor: (a.data.vehiculo || {}).bastidor || "" });
      const paths = (c.data || []).map((f) => f.path).filter((p) => !urls[p]);
      if (paths.length) { const s = await sb().storage.from("garantias").createSignedUrls(paths, 3600); const m = { ...urls }; (s.data || []).forEach((x) => { if (x.signedUrl) m[x.path] = x.signedUrl; }); setUrls(m); }
    };
    useEffect(() => { cargar(); }, [id]);
    if (!g) return h(Drawer, { T, onClose, width: 880, label: "Expediente de garantía" }, h("div", { style: { padding: "24px", color: T.inkSoft } }, "Cargando…"));
    const s = est(g.estado), t = totales(ls), av = aviso(g, t), chasis = g.tipo === "chasis";
    const upd = async (patch, texto) => {
      setTrab(true); setMsg("");
      const p = {}; Object.keys(patch).forEach((k) => { p[k] = patch[k] === NOW ? new Date().toISOString() : patch[k]; });
      const { error } = await sb().from("garantias").update(p).eq("id", g.id); setTrab(false);
      if (error) { setMsg("No se pudo guardar: " + error.message); return false; }
      if (texto) setMsg(texto); await cargar(); onChanged && onChanged(); return true;
    };
    const guardarDatos = () => {
      const v = { ...(g.vehiculo || {}), modelo: d.modelo.trim(), matricula: normMat(d.matricula), bastidor: normMat(d.bastidor) };
      const p = {};
      [["fabricante", d.fabricante], ["descripcion", d.descripcion], ["reclamacion_no", d.reclamacion_no], ["concesionario", d.concesionario], ["notas", d.notas]].forEach(([k, x]) => { const y = String(x || "").trim() || null; if (y !== (g[k] || null)) p[k] = y; });
      const cita = fromLocalInput(d.cita_at); if ((cita ? Math.floor(new Date(cita) / 6e4) : null) !== (g.cita_at ? Math.floor(new Date(g.cita_at) / 6e4) : null)) p.cita_at = cita;
      if (JSON.stringify(v) !== JSON.stringify(g.vehiculo || {})) p.vehiculo = v;
      if (!Object.keys(p).length) { setMsg("No hay cambios."); return; }
      upd(p, "Guardado.");
    };
    const addLinea = async (row) => { const { error } = await sb().from("garantia_lineas").insert({ garantia_id: g.id, orden: ls.length, ...row }); if (error) { setMsg("No se pudo añadir: " + error.message); return false; } await cargar(); onChanged && onChanged(); return true; };
    const updLinea = async (lid, patch) => { const { error } = await sb().from("garantia_lineas").update(patch).eq("id", lid); if (error) setMsg("No se pudo guardar: " + error.message); await cargar(); onChanged && onChanged(); };
    const subirFotos = async (files, lineaId, etiqueta) => {
      if (!files || !files.length) return;
      setTrab(true); setMsg(`Subiendo ${files.length} foto${files.length > 1 ? "s" : ""}…`);
      let ok = 0;
      for (const f of Array.from(files)) {
        const blob = await comprimir(f);
        const path = `${g.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
        const up = await sb().storage.from("garantias").upload(path, blob, { contentType: "image/jpeg", upsert: false });
        if (up.error) { setMsg("No se pudo subir: " + up.error.message); continue; }
        const ins = await sb().from("garantia_fotos").insert({ garantia_id: g.id, linea_id: lineaId || null, path, etiqueta: etiqueta || "otra", nombre: f.name || null });
        if (!ins.error) ok++;
      }
      if (ok) await sb().from("crm_eventos").insert({ garantia_id: g.id, tipo: "g_foto", texto: `${ok} foto${ok > 1 ? "s" : ""} añadida${ok > 1 ? "s" : ""}` });
      setTrab(false); setMsg(ok ? `${ok} foto${ok > 1 ? "s" : ""} subida${ok > 1 ? "s" : ""}.` : msg); cargar();
    };
    const anularFoto = async (f) => { await sb().from("garantia_fotos").update({ anulada: true }).eq("id", f.id); await sb().from("crm_eventos").insert({ garantia_id: g.id, tipo: "g_foto", texto: "Foto retirada del expediente" }); setVerFoto(null); cargar(); };
    const addNota = async () => { if (!nota.trim()) return; await sb().from("crm_eventos").insert({ garantia_id: g.id, tipo: "nota", texto: nota.trim() }); setNota(""); cargar(); };
    const abrirCaso = () => { if (g.caso_id) { try { localStorage.setItem("acllar_crm_abrir_caso", g.caso_id); } catch (e) {} window.dispatchEvent(new CustomEvent("acllar-taller-tab", { detail: "clientes" })); } };

    const problemas = ls.filter((l) => l.tipo === "problema" && !l.anulada);
    const sueltas = ls.filter((l) => l.tipo !== "problema" && !l.anulada && !problemas.some((p) => p.id === l.problema_id));
    const resumen = () => abrirResumen(g, ls, fotos, urls, t);

    return h(Drawer, { T, onClose, width: 880, label: "Expediente de garantía" },
      h("div", { style: { background: T.surface, padding: "18px 22px", borderBottom: `1px solid ${T.border}`, display: "flex", flexDirection: "column", gap: "6px" } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" } },
          h("span", { style: { fontSize: "12px", color: T.inkSoft, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" } }, `${chasis ? "Gestión de chasis" : "Garantía"} · ${g.fabricante || "sin fabricante"} · ${g.origen === "flota" ? "Flota" : "Cliente"}`),
          h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } }, h("button", { "data-g-resumen": "1", onClick: resumen, style: btn(T) }, "Resumen para el fabricante"), h("button", { onClick: onClose, "aria-label": "Cerrar", style: { border: "none", background: "transparent", cursor: "pointer", fontSize: "22px", color: T.inkSoft } }, "×"))),
        h("div", { style: { fontFamily: F.display, fontSize: "24px", fontWeight: 800 } }, h("span", { style: { fontFamily: "'JetBrains Mono', monospace" } }, g.numero), " · ", vehLinea(g.vehiculo)),
        h("div", { style: { fontSize: "13.5px", color: T.inkSoft } }, g.origen === "flota" ? "Vehículo de la flota de alquiler" : `Cliente: ${nombreCli(g.cliente)}${g.cliente && g.cliente.bc_no ? " · BC " + g.cliente.bc_no : ""}`, g.vehiculo && g.vehiculo.bastidor ? ` · Bastidor ${g.vehiculo.bastidor}` : "", ` · Entrada ${fFecha(g.fecha_entrada || g.created_at)}`),
        g.caso_id ? h("button", { onClick: abrirCaso, style: { ...btn(T, "s"), alignSelf: "flex-start" } }, "Ver caso del CRM →") : null),
      h("div", { style: { padding: "16px 22px 40px", display: "flex", flexDirection: "column", gap: "14px" } },
        h(Box, { T }, h(Lbl, { T }, "Estado"),
          h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } }, h(Chip, { c: s.c, style: { fontSize: "13px" } }, s.l), av ? h(Chip, { c: av.c }, av.t) : null, g.reclamacion_no ? h("span", { style: { fontSize: "13px" } }, "Reclamación ", h("b", null, g.reclamacion_no)) : null),
          s.sig.length ? h("div", { style: { display: "flex", flexDirection: "column", gap: "6px", marginTop: "10px" } }, s.sig.map((x, i) => h("button", { key: i, "data-g-paso": x.to, disabled: trab, onClick: () => upd({ estado: x.to, ...(x.set || {}) }), style: { ...btn(T, i === 0 ? "p" : undefined), textAlign: "left" } }, "→ " + x.l))) : h("button", { onClick: () => upd({ estado: chasis ? "abierta" : "en_curso" }), style: { ...btn(T), marginTop: "10px" } }, "Reabrir"),
          msg ? h("div", { style: { marginTop: "8px", fontSize: "12.5px", color: /^No se/.test(msg) ? T.danger : T.ok } }, msg) : null),

        !chasis ? h(Box, { T }, h(Lbl, { T }, "Totales a reclamar"),
          h("div", { style: { display: "flex", gap: "22px", flexWrap: "wrap", alignItems: "baseline" } },
            h("div", null, h("div", { style: { fontSize: "26px", fontWeight: 800 } }, fmtH(t.horas)), h("div", { style: { fontSize: "12px", color: T.inkSoft } }, "mano de obra")),
            h("div", null, h("div", { style: { fontSize: "26px", fontWeight: 800 } }, t.piezas), h("div", { style: { fontSize: "12px", color: T.inkSoft } }, `piezas (${t.lineasPieza} referencias)`)),
            h("div", null, h("div", { style: { fontSize: "26px", fontWeight: 800, color: t.pendRepuesto ? CH.ambar.fg : CH.verde.fg } }, t.lineasPieza - t.pendRepuesto, "/", t.lineasPieza), h("div", { style: { fontSize: "12px", color: T.inkSoft } }, "repuestas por el fabricante")),
            h("div", { style: { fontSize: "12.5px", color: T.inkSoft } }, Object.entries(t.porMec).map(([m, n]) => `${m}: ${fmtH(n)}`).join(" · ")))) : null,

        !chasis ? h(Box, { T }, h(Lbl, { T }, `Problemas y trabajos (${problemas.length})`),
          problemas.map((p, i) => h(Problema, { key: p.id, T, n: i + 1, p, ls, fotos: fotos.filter((f) => f.linea_id === p.id), urls, trab, addLinea, updLinea, subirFotos, onVerFoto: setVerFoto })),
          ls.some((l) => l.tipo === "problema" && l.anulada) ? h("div", { style: { fontSize: "12.5px", color: T.inkSoft, display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" } }, "Anulados:",
            ls.filter((l) => l.tipo === "problema" && l.anulada).map((l) => h("button", { key: l.id, onClick: () => updLinea(l.id, { anulada: false }), title: "Reactivar", style: { ...btn(T, "s"), textDecoration: "line-through", color: T.inkSoft } }, l.descripcion || "(sin descripción)"))) : null,
          sueltas.length ? h("div", { style: { fontSize: "12.5px", color: T.warn } }, `${sueltas.length} línea(s) sin problema asociado.`) : null,
          h("div", { style: { display: "flex", gap: "8px", marginTop: "10px" } },
            h("input", { value: nuevoProb, onChange: (e) => setNuevoProb(e.target.value), onKeyDown: async (e) => { if (e.key === "Enter" && nuevoProb.trim()) { if (await addLinea({ tipo: "problema", descripcion: nuevoProb.trim() })) setNuevoProb(""); } }, placeholder: "Nuevo problema (p. ej. Filtración en claraboya trasera)", "aria-label": "Nuevo problema", style: I }),
            h("button", { "data-g-add-prob": "1", disabled: trab || !nuevoProb.trim(), onClick: async () => { if (await addLinea({ tipo: "problema", descripcion: nuevoProb.trim() })) setNuevoProb(""); }, style: btn(T, "p") }, "Añadir problema"))) : null,

        h(Box, { T }, h(Lbl, { T }, chasis ? "Gestión con el concesionario" : "Datos del expediente"),
          h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" } },
            h(Field, { T, label: "Fabricante" }, h("select", { value: d.fabricante, onChange: (e) => setD((x) => ({ ...x, fabricante: e.target.value })), style: I }, (chasis ? FAB_CHASIS : FAB_GARANTIA).map(([k, l]) => h("option", { key: k, value: k }, l)))),
            chasis ? h(Field, { T, label: "Cita" }, h("input", { type: "datetime-local", value: d.cita_at || "", onChange: (e) => setD((x) => ({ ...x, cita_at: e.target.value })), style: I }))
              : h(Field, { T, label: "Nº de reclamación (web del fabricante)" }, h("input", { value: d.reclamacion_no, onChange: (e) => setD((x) => ({ ...x, reclamacion_no: e.target.value })), style: I })),
            chasis ? h(Field, { T, label: "Concesionario / taller oficial", style: { gridColumn: "1 / -1" } }, h("input", { value: d.concesionario, onChange: (e) => setD((x) => ({ ...x, concesionario: e.target.value })), style: I })) : null,
            h(Field, { T, label: "Modelo" }, h("input", { value: d.modelo, onChange: (e) => setD((x) => ({ ...x, modelo: e.target.value })), style: I })),
            h(Field, { T, label: "Matrícula" }, h("input", { value: d.matricula, onChange: (e) => setD((x) => ({ ...x, matricula: e.target.value })), style: I })),
            h(Field, { T, label: "Bastidor", style: { gridColumn: "1 / -1" } }, h("input", { value: d.bastidor, onChange: (e) => setD((x) => ({ ...x, bastidor: e.target.value })), style: { ...I, fontFamily: "'JetBrains Mono', monospace" } })),
            h(Field, { T, label: chasis ? "Qué hay que gestionar" : "Descripción general", style: { gridColumn: "1 / -1" } }, h("textarea", { rows: 2, value: d.descripcion, onChange: (e) => setD((x) => ({ ...x, descripcion: e.target.value })), style: { ...I, resize: "vertical" } })),
            h(Field, { T, label: "Notas", style: { gridColumn: "1 / -1" } }, h("textarea", { rows: 2, value: d.notas, onChange: (e) => setD((x) => ({ ...x, notas: e.target.value })), style: { ...I, resize: "vertical" } }))),
          h("button", { "data-g-guardar": "1", onClick: guardarDatos, disabled: trab, style: { ...btn(T, "p"), marginTop: "10px" } }, "Guardar datos")),

        h(Box, { T }, h(Lbl, { T }, `Fotos generales (${fotos.filter((f) => !f.linea_id).length})`),
          h(Fotos, { T, fotos: fotos.filter((f) => !f.linea_id), urls, onVer: setVerFoto }),
          h(SubirFotos, { T, trab, onFiles: (fs, et) => subirFotos(fs, null, et) })),

        h(Box, { T }, h(Lbl, { T }, "Historial · automático, no se puede editar"),
          h("div", { style: { display: "flex", gap: "8px", marginBottom: "12px" } }, h("input", { value: nota, onChange: (e) => setNota(e.target.value), onKeyDown: (e) => { if (e.key === "Enter") addNota(); }, placeholder: "Añadir nota (llamada al fabricante, respuesta, etc.)…", style: I }), h("button", { onClick: addNota, style: btn(T) }, "Añadir")),
          h("ol", { style: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "9px", fontSize: "13px" } },
            ev.map((e) => h("li", { key: e.id, style: { display: "grid", gridTemplateColumns: "84px 1fr", gap: "8px" } }, h("span", { style: { color: T.inkSoft } }, fFechaHora(e.at)), h("span", null, h("b", null, quien(e.autor)), " · ", textoEventoG(e))))))),
      verFoto ? h("div", { role: "dialog", "aria-label": "Foto", onClick: () => setVerFoto(null), style: { position: "fixed", inset: 0, zIndex: 1300, background: "rgba(0,0,0,.85)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", padding: "20px" } },
        h("img", { src: urls[verFoto.path], alt: verFoto.etiqueta || "foto", style: { maxWidth: "100%", maxHeight: "82vh", borderRadius: "8px" } }),
        h("div", { onClick: (e) => e.stopPropagation(), style: { display: "flex", gap: "8px" } }, h("a", { href: urls[verFoto.path], target: "_blank", rel: "noopener", style: { ...btn(T), textDecoration: "none" } }, "Abrir original"), h("button", { onClick: () => anularFoto(verFoto), style: { ...btn(T), color: T.danger } }, "Quitar del expediente"))) : null);
  }

  const Fotos = ({ T, fotos, urls, onVer }) => fotos.length ? h("div", { style: { display: "flex", flexWrap: "wrap", gap: "8px", margin: "6px 0" } }, fotos.map((f) => h("button", { key: f.id, onClick: () => onVer(f), title: f.etiqueta, style: { border: `1px solid ${T.border}`, borderRadius: "8px", padding: 0, background: T.bg, cursor: "pointer", position: "relative", width: "92px", height: "92px", overflow: "hidden" } },
    urls[f.path] ? h("img", { src: urls[f.path], alt: f.etiqueta || "foto", style: { width: "100%", height: "100%", objectFit: "cover", display: "block" } }) : null,
    h("span", { style: { position: "absolute", left: 3, bottom: 3, fontSize: "10px", fontWeight: 700, background: "rgba(15,27,46,.75)", color: "#fff", borderRadius: "5px", padding: "1px 5px" } }, (ETIQUETAS.find((x) => x[0] === f.etiqueta) || ["", "Foto"])[1])))) : null;
  function SubirFotos({ T, trab, onFiles }) {
    const [et, setEt] = useState("antes"); const ref = useRef(null);
    return h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginTop: "6px" } },
      h("select", { value: et, onChange: (e) => setEt(e.target.value), "aria-label": "Tipo de foto", style: { ...inp(T), width: "auto", padding: "6px 8px", fontSize: "13px" } }, ETIQUETAS.map(([k, l]) => h("option", { key: k, value: k }, l))),
      h("button", { disabled: trab, onClick: () => ref.current && ref.current.click(), style: btn(T, "s") }, "📷 Añadir fotos"),
      h("input", { ref, type: "file", accept: "image/*", multiple: true, style: { display: "none" }, onChange: (e) => { onFiles(e.target.files, et); e.target.value = ""; } }));
  }

  function Problema({ T, n, p, ls, fotos, urls, trab, addLinea, updLinea, subirFotos, onVerFoto }) {
    const tr = ls.filter((l) => l.problema_id === p.id && l.tipo === "trabajo");
    const pz = ls.filter((l) => l.problema_id === p.id && l.tipo === "pieza");
    const hoy = new Date(); const hoyStr = `${hoy.getFullYear()}-${pad(hoy.getMonth() + 1)}-${pad(hoy.getDate())}`;
    const [nt, setNt] = useState({ descripcion: "", horas: "", mecanico: MECANICOS[0], fecha: hoyStr });
    const [np, setNp] = useState({ referencia: "", descripcion: "", cantidad: "1", origen_pieza: "stock" });
    const I = { ...inp(T), padding: "7px 9px", fontSize: "13px" };
    const td = { padding: "6px 6px", borderBottom: `1px solid ${T.border}`, fontSize: "13px", verticalAlign: "middle" };
    const hp = tr.filter((l) => !l.anulada).reduce((a, l) => a + Number(l.horas || 0), 0);
    return h("div", { "data-g-problema": n, style: { border: `1px solid ${T.border}`, borderRadius: "12px", padding: "12px", marginBottom: "10px", background: T.bg } },
      h("div", { style: { display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center" } },
        h("b", null, `${n}. ${p.descripcion || "(sin descripción)"}`), h("span", { style: { display: "flex", gap: "6px", alignItems: "center" } }, h(Chip, null, fmtH(hp)), h("button", { onClick: () => { if (window.confirm("¿Anular este problema? Sus trabajos y piezas dejarán de contar en el expediente (se puede reactivar).")) updLinea(p.id, { anulada: true }); }, title: "Anular este problema (queda en el historial)", style: { ...btn(T, "s"), color: T.inkSoft } }, "Anular"))),
      h("div", { style: { fontSize: "12px", fontWeight: 800, color: T.inkSoft, margin: "10px 0 4px" } }, "Trabajos"),
      tr.length ? h("table", { style: { width: "100%", borderCollapse: "collapse" } }, h("tbody", null, tr.map((l) => h("tr", { key: l.id, style: { opacity: l.anulada ? 0.45 : 1, textDecoration: l.anulada ? "line-through" : "none" } },
        h("td", { style: td }, l.descripcion), h("td", { style: { ...td, fontWeight: 700, whiteSpace: "nowrap" } }, fmtH(l.horas)), h("td", { style: td }, l.mecanico || "—"), h("td", { style: td }, l.fecha ? fFecha(l.fecha) : "—"),
        h("td", { style: { ...td, textAlign: "right" } }, h("button", { onClick: () => updLinea(l.id, { anulada: !l.anulada }), style: { ...btn(T, "s"), fontSize: "11.5px" } }, l.anulada ? "Reactivar" : "Anular")))))) : null,
      h("div", { style: { display: "grid", gridTemplateColumns: "2fr .7fr 1fr 1fr auto", gap: "6px", marginTop: "6px" } },
        h("input", { value: nt.descripcion, onChange: (e) => setNt((x) => ({ ...x, descripcion: e.target.value })), placeholder: "Qué se hizo", "aria-label": "Trabajo realizado", style: I }),
        h("input", { value: nt.horas, onChange: (e) => setNt((x) => ({ ...x, horas: e.target.value })), placeholder: "Horas", inputMode: "decimal", "aria-label": "Horas", style: I }),
        h("select", { value: nt.mecanico, onChange: (e) => setNt((x) => ({ ...x, mecanico: e.target.value })), "aria-label": "Mecánico", style: I }, MECANICOS.map((m) => h("option", { key: m, value: m }, m))),
        h("input", { type: "date", value: nt.fecha, onChange: (e) => setNt((x) => ({ ...x, fecha: e.target.value })), "aria-label": "Fecha", style: I }),
        h("button", { "data-g-add-trab": n, disabled: trab || !nt.descripcion.trim() || !(num(nt.horas) > 0), onClick: async () => { if (await addLinea({ tipo: "trabajo", problema_id: p.id, descripcion: nt.descripcion.trim(), horas: num(nt.horas), mecanico: nt.mecanico, fecha: nt.fecha || null })) setNt((x) => ({ ...x, descripcion: "", horas: "" })); }, style: btn(T, "s") }, "Añadir")),
      h("div", { style: { fontSize: "12px", fontWeight: 800, color: T.inkSoft, margin: "12px 0 4px" } }, "Piezas"),
      pz.length ? h("table", { style: { width: "100%", borderCollapse: "collapse" } }, h("tbody", null, pz.map((l) => h("tr", { key: l.id, style: { opacity: l.anulada ? 0.45 : 1, textDecoration: l.anulada ? "line-through" : "none" } },
        h("td", { style: { ...td, fontFamily: "'JetBrains Mono', monospace", fontSize: "12px" } }, l.referencia || "—"), h("td", { style: td }, l.descripcion), h("td", { style: { ...td, fontWeight: 700 } }, `× ${Number(l.cantidad || 1)}`),
        h("td", { style: td }, l.origen_pieza === "fabricante" ? "Enviada por fabricante" : "De nuestro stock"),
        h("td", { style: td }, h("label", { style: { display: "flex", gap: "5px", alignItems: "center", whiteSpace: "nowrap" } }, h("input", { type: "checkbox", checked: !!l.repuesto_recibido_at, disabled: l.anulada, onChange: (e) => updLinea(l.id, { repuesto_recibido_at: e.target.checked ? new Date().toISOString() : null }) }), l.repuesto_recibido_at ? `Repuesta ${fFecha(l.repuesto_recibido_at)}` : "Repuesta")),
        h("td", { style: { ...td, textAlign: "right" } }, h("button", { onClick: () => updLinea(l.id, { anulada: !l.anulada }), style: { ...btn(T, "s"), fontSize: "11.5px" } }, l.anulada ? "Reactivar" : "Anular")))))) : null,
      h("div", { style: { display: "grid", gridTemplateColumns: "1fr 2fr .6fr 1.2fr auto", gap: "6px", marginTop: "6px" } },
        h("input", { value: np.referencia, onChange: (e) => setNp((x) => ({ ...x, referencia: e.target.value })), placeholder: "Referencia", "aria-label": "Referencia", style: I }),
        h("input", { value: np.descripcion, onChange: (e) => setNp((x) => ({ ...x, descripcion: e.target.value })), placeholder: "Descripción de la pieza", "aria-label": "Pieza", style: I }),
        h("input", { value: np.cantidad, onChange: (e) => setNp((x) => ({ ...x, cantidad: e.target.value })), inputMode: "decimal", "aria-label": "Cantidad", style: I }),
        h("select", { value: np.origen_pieza, onChange: (e) => setNp((x) => ({ ...x, origen_pieza: e.target.value })), "aria-label": "Origen", style: I }, h("option", { value: "stock" }, "De nuestro stock"), h("option", { value: "fabricante" }, "Enviada por fabricante")),
        h("button", { "data-g-add-pieza": n, disabled: trab || !np.descripcion.trim(), onClick: async () => { if (await addLinea({ tipo: "pieza", problema_id: p.id, referencia: np.referencia.trim() || null, descripcion: np.descripcion.trim(), cantidad: num(np.cantidad) || 1, origen_pieza: np.origen_pieza })) setNp({ referencia: "", descripcion: "", cantidad: "1", origen_pieza: np.origen_pieza }); }, style: btn(T, "s") }, "Añadir")),
      h("div", { style: { fontSize: "12px", fontWeight: 800, color: T.inkSoft, margin: "12px 0 4px" } }, `Fotos (${fotos.length})`),
      h(Fotos, { T, fotos, urls, onVer: onVerFoto }),
      h(SubirFotos, { T, trab, onFiles: (fs, et) => subirFotos(fs, p.id, et) }));
  }

  // ---------- resumen imprimible para tramitar en la web del fabricante ----------
  function abrirResumen(g, ls, fotos, urls, t) {
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const v = g.vehiculo || {};
    const probs = ls.filter((l) => l.tipo === "problema" && !l.anulada);
    const bloque = (p, i) => {
      const tr = ls.filter((l) => l.problema_id === p.id && l.tipo === "trabajo" && !l.anulada);
      const pz = ls.filter((l) => l.problema_id === p.id && l.tipo === "pieza" && !l.anulada);
      const fs = fotos.filter((f) => f.linea_id === p.id && urls[f.path]);
      return `<section><h2>${i + 1}. ${esc(p.descripcion)}</h2>
        ${tr.length ? `<table><tr><th>Trabajo</th><th>Horas</th><th>Mecánico</th><th>Fecha</th></tr>${tr.map((l) => `<tr><td>${esc(l.descripcion)}</td><td>${esc(Number(l.horas || 0).toLocaleString("es-ES"))}</td><td>${esc(l.mecanico || "")}</td><td>${l.fecha ? esc(fFecha(l.fecha)) : ""}</td></tr>`).join("")}</table>` : ""}
        ${pz.length ? `<table><tr><th>Referencia</th><th>Pieza</th><th>Cant.</th><th>Origen</th></tr>${pz.map((l) => `<tr><td class="m">${esc(l.referencia || "")}</td><td>${esc(l.descripcion)}</td><td>${esc(Number(l.cantidad || 1))}</td><td>${l.origen_pieza === "fabricante" ? "Fabricante" : "Stock"}</td></tr>`).join("")}</table>` : ""}
        ${fs.length ? `<div class="fotos">${fs.map((f) => `<figure><img src="${urls[f.path]}"><figcaption>${esc((ETIQUETAS.find((x) => x[0] === f.etiqueta) || ["", ""])[1])}</figcaption></figure>`).join("")}</div>` : ""}</section>`;
    };
    const gen = fotos.filter((f) => !f.linea_id && urls[f.path]);
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(g.numero)} · Resumen de garantía</title><style>
      body{font-family:system-ui,sans-serif;color:#0F1B2E;margin:24px;font-size:13px}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:18px 0 6px}
      .meta{display:grid;grid-template-columns:repeat(2,1fr);gap:4px 20px;margin:10px 0 14px}.meta b{display:inline-block;min-width:120px;color:#5B6B82}
      table{width:100%;border-collapse:collapse;margin:6px 0}th,td{border-bottom:1px solid #E4E9F1;padding:5px 6px;text-align:left}th{font-size:11px;text-transform:uppercase;color:#5B6B82}
      .m{font-family:monospace}.tot{display:flex;gap:30px;background:#F5F7FB;border-radius:8px;padding:10px 14px;margin:10px 0}.tot div{font-size:20px;font-weight:800}.tot span{display:block;font-size:11px;color:#5B6B82;font-weight:600}
      .fotos{display:flex;flex-wrap:wrap;gap:8px}figure{margin:0;width:31%}figure img{width:100%;border-radius:6px;border:1px solid #E4E9F1}figcaption{font-size:11px;color:#5B6B82}
      section{break-inside:avoid}.bar{margin-bottom:12px}@media print{.bar{display:none}}</style></head><body>
      <div class="bar"><button onclick="print()">Imprimir / guardar PDF</button></div>
      <h1>${esc(g.numero)} · ${g.tipo === "chasis" ? "Gestión de chasis" : "Reclamación de garantía"} · ${esc(g.fabricante || "")}</h1>
      <div class="meta"><div><b>Vehículo</b> ${esc(v.modelo || "")}</div><div><b>Matrícula</b> <span class="m">${esc(v.matricula || "")}</span></div>
      <div><b>Bastidor</b> <span class="m">${esc(v.bastidor || "")}</span></div><div><b>${g.origen === "flota" ? "Flota" : "Cliente"}</b> ${esc(g.origen === "flota" ? v.ac || "" : nombreCli(g.cliente))}</div>
      <div><b>Entrada</b> ${esc(fFecha(g.fecha_entrada || g.created_at))}</div><div><b>Nº reclamación</b> ${esc(g.reclamacion_no || "—")}</div></div>
      ${g.descripcion ? `<p>${esc(g.descripcion)}</p>` : ""}
      <div class="tot"><div>${esc(Number(t.horas).toLocaleString("es-ES"))} h<span>mano de obra</span></div><div>${esc(t.piezas)}<span>piezas</span></div><div>${esc(t.problemas)}<span>problemas</span></div></div>
      ${probs.map(bloque).join("")}
      ${gen.length ? `<section><h2>Fotos generales</h2><div class="fotos">${gen.map((f) => `<figure><img src="${urls[f.path]}"><figcaption>${esc((ETIQUETAS.find((x) => x[0] === f.etiqueta) || ["", ""])[1])}</figcaption></figure>`).join("")}</div></section>` : ""}
      <p style="color:#8B98AB;font-size:11px;margin-top:20px">AC·LLAR · generado ${esc(fFechaHora(new Date().toISOString()))}</p></body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.open(); w.document.write(html); w.document.close(); }
  }

  window.AcllarGarantias = GarantiasView;
  window.AcllarGarantias._test = { EST, totales, aviso, textoEventoG };
})();
