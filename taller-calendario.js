// taller-calendario.js  ---  TALLER → Calendario
// Calendario propio del taller (sustituye a Google Calendar). Cada cita queda ligada a cliente, caso o garantía,
// vehículo y mecánico (un color por mecánico). Vistas Día (una columna por mecánico), Semana, Mes y Agenda.
// Crear arrastrando, mover arrastrando, estirar para cambiar la duración. Nada se borra: realizada / no se presentó / anulada.
// Tabla citas (Supabase). Los triggers anotan cada cambio en la bitácora del caso y mantienen cita_at del caso/garantía.
// Se carga después de taller-crm.js y taller-garantias.js y usa sus piezas (window.AcllarCRM._ui).
(function () {
  if (!window.React || !window.AcllarCRM || !window.AcllarCRM._ui) return;
  const U = window.AcllarCRM._ui;
  const { h, Chip, btn, inp, Lbl, Box, Field, Seg, Drawer, sb, quien, nombreCli, normMat, asVeh, vehTxt, buscarClientes, ResultadoCliente, qSafe, irA, telWa, pad, fFechaHora, lblTipos } = U;
  const { useState, useEffect, useRef, useMemo } = React;

  // ---------- configuración ----------
  const MECANICOS = U.MECANICOS_CAL || [["Ali", "#2563EB"], ["Carlos", "#16A34A"], ["Hugo", "#EA580C"], ["Sebastián", "#9333EA"], ["Agente externo", "#0E7490"]];
  const SIN_MEC = "#64748B";
  const colorMec = (m) => (MECANICOS.find((x) => x[0] === m) || [null, SIN_MEC])[1];
  const TIPOS = [["taller", "Cita de taller", "🔧"], ["garantia", "Garantía", "🛡"], ["recogida", "Recogida / entrega", "🚐"], ["entrega_vn", "Entrega vehículo nuevo", "🔑"], ["llamada", "Llamada", "📞"], ["bloqueo", "Bloqueo / cerrado", "⛔"], ["otro", "Otro", "•"]];
  const tipoL = (k) => (TIPOS.find((t) => t[0] === k) || [k, k || "—", "•"]);
  const ESTADOS = { programada: ["Programada", "azul"], realizada: ["Realizada", "verde"], no_presentado: ["No se presentó", "rojo"], anulada: ["Anulada", "gris"] };
  const H0 = 7, H1 = 19, PX = 48, SNAP = 15, GUT = 52;           // cuadrícula de 7:00 a 19:00, 48 px por hora
  const TURNOS = [[8 * 60, 14 * 60], [15 * 60, 17 * 60]];          // horario del taller, lunes a viernes
  const DUR_DEF = 120;                                             // duración por defecto: 2 horas
  const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const DIAS_C = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

  // ---------- fechas ----------
  const d0 = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addD = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const lunes = (d) => { const x = d0(d); return addD(x, -((x.getDay() + 6) % 7)); };
  const mismo = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const keyD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const deKey = (k) => { const [y, m, dd] = String(k).split("-").map(Number); return new Date(y, m - 1, dd); };
  const hm = (d) => `${d.getHours()}:${pad(d.getMinutes())}`;
  const minDe = (d) => d.getHours() * 60 + d.getMinutes();
  const conMin = (dia, m) => { const x = d0(dia); x.setMinutes(m); return x; };
  const laborable = (d) => d.getDay() >= 1 && d.getDay() <= 5;
  const enHorario = (ini, fin) => laborable(ini) && mismo(ini, new Date(fin - 1)) && TURNOS.some(([a, b]) => minDe(ini) >= a && minDe(new Date(fin)) <= b && minDe(new Date(fin)) > minDe(ini));
  const txtHora = (m) => `${Math.floor(m / 60)}:${pad(m % 60)}`;
  const fCorta = (d) => `${DIAS_C[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;

  // ---------- textos de una cita ----------
  const nomCita = (c) => (c.cliente ? nombreCli(c.cliente) : c.titulo || tipoL(c.tipo)[1]);
  const vehCita = (c) => (c.vehiculo ? vehTxt(c.vehiculo) : "");
  const horaCita = (c) => (c.todo_dia ? "Todo el día" : `${hm(new Date(c.inicio))}–${hm(new Date(c.fin))}`);
  const resumenCita = (c) => [horaCita(c), nomCita(c), vehCita(c), c.mecanico || "Sin mecánico", tipoL(c.tipo)[1], c.garantia ? c.garantia.numero : "", c.titulo && c.cliente ? c.titulo : ""].filter(Boolean).join(" · ");
  const nomPila = (c) => String((c && c.nombre) || "").trim().split(/\s+/)[0] || "";
  const msgRecordatorio = (c) => { const d = new Date(c.inicio); const v = c.vehiculo ? asVeh(c.vehiculo) : null;
    return `Hola ${nomPila(c.cliente)}, te recordamos tu cita en el taller de AC·LLAR${v && v.modelo ? " para tu " + [v.modelo, v.matricula ? normMat(v.matricula) : null].filter(Boolean).join(" · ") : ""}: ${DIAS[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}${c.todo_dia ? "" : " a las " + hm(d)}. Si no puedes venir, avísanos por aquí. ¡Gracias!`; };

  // Reparto en carriles de las citas que se solapan dentro de una columna
  function carriles(lista) {
    const xs = lista.slice().sort((a, b) => a._s - b._s || b._e - a._e);
    let grupo = [], fin = -1;
    const cerrar = () => { const ends = []; grupo.forEach((e) => { let l = ends.findIndex((x) => x <= e._s); if (l < 0) { l = ends.length; ends.push(e._e); } else ends[l] = e._e; e._l = l; }); grupo.forEach((e) => { e._n = ends.length; }); };
    xs.forEach((e) => { if (grupo.length && e._s >= fin) { cerrar(); grupo = []; fin = -1; } grupo.push(e); fin = Math.max(fin, e._e); });
    if (grupo.length) cerrar();
    return xs;
  }

  // ---------- estilos de una cita ----------
  const estiloCita = (c) => {
    const col = c.tipo === "bloqueo" ? "#475569" : colorMec(c.mecanico);
    const s = { background: col, color: "#fff", borderLeft: `4px solid rgba(0,0,0,.25)` };
    if (c.tipo === "bloqueo") s.background = `repeating-linear-gradient(45deg, #64748B, #64748B 6px, #475569 6px, #475569 12px)`;
    if (c.estado === "realizada") { s.opacity = 0.55; }
    if (c.estado === "no_presentado") { s.background = `repeating-linear-gradient(45deg, ${col}, ${col} 6px, #B91C1C 6px, #B91C1C 9px)`; }
    if (c.estado === "anulada") { s.opacity = 0.4; s.textDecoration = "line-through"; s.background = "#94A3B8"; }
    return s;
  };
  const marca = (c) => (c.estado === "realizada" ? "✓ " : c.estado === "no_presentado" ? "✗ " : c.estado === "anulada" ? "Anulada · " : "");

  // =====================================================================
  //  Cuadrícula de horas (vistas Día y Semana)
  // =====================================================================
  function Cuadricula({ T, cols, citas, colDe, onCrear, onMover, onEstirar, onAbrir }) {
    const ref = useRef(null);
    const [drag, setDrag] = useState(null); const dragR = useRef(null);
    const alto = (H1 - H0) * PX;
    const snapM = (y, modo) => { const m = H0 * 60 + (y / PX) * 60; const f = modo === "ceil" ? Math.ceil : modo === "round" ? Math.round : Math.floor; return Math.max(H0 * 60, Math.min(H1 * 60, f(m / SNAP) * SNAP)); };
    const pos = (e) => { const r = ref.current.getBoundingClientRect(); const ancho = (r.width - GUT) / cols.length; const ci = Math.max(0, Math.min(cols.length - 1, Math.floor((e.clientX - r.left - GUT) / ancho))); return { ci, y: Math.max(0, Math.min(alto, e.clientY - r.top)) }; };
    const set = (x) => { dragR.current = x; setDrag(x); };
    useEffect(() => {
      if (!drag) return;
      const mover = (e) => { const d = dragR.current; if (!d) return; const p = pos(e);
        if (d.modo === "crear") set({ ...d, m1: Math.max(d.m0 + SNAP, snapM(p.y, "ceil")), movido: d.movido || Math.abs(p.y - d.y0) > 4 });
        else if (d.modo === "mover") { const dm = Math.round(((p.y - d.y0) / PX) * 60 / SNAP) * SNAP; set({ ...d, dm, ci: p.ci, movido: d.movido || Math.abs(p.y - d.y0) > 4 || p.ci !== d.ci0 }); }
        else if (d.modo === "estirar") set({ ...d, m1: Math.max(d.s + SNAP, snapM(p.y, "round")), movido: true }); };
      const soltar = () => { const d = dragR.current; set(null); if (!d) return;
        if (d.modo === "crear") onCrear(cols[d.ci], d.m0, d.movido ? d.m1 : d.m0 + DUR_DEF);
        else if (d.modo === "mover") { if (!d.movido) onAbrir(d.c); else onMover(d.c, cols[d.ci], d.s + d.dm); }
        else if (d.modo === "estirar") onEstirar(d.c, d.m1); };
      window.addEventListener("pointermove", mover); window.addEventListener("pointerup", soltar);
      return () => { window.removeEventListener("pointermove", mover); window.removeEventListener("pointerup", soltar); };
    }, [!!drag]);
    const ahora = new Date();
    const porCol = cols.map(() => []);
    citas.forEach((c) => { if (c.todo_dia) return; const ci = colDe(c); if (ci < 0) return; const i = new Date(c.inicio), f = new Date(c.fin);
      const s = minDe(i), e = mismo(i, f) ? minDe(f) : 24 * 60; porCol[ci].push({ ...c, _s: s, _e: Math.max(e, s + SNAP) }); });
    const ancho = `calc((100% - ${GUT}px) / ${cols.length})`;
    const izq = (ci) => `calc(${GUT}px + (100% - ${GUT}px) * ${ci} / ${cols.length})`;
    const topDe = (m) => ((Math.max(m, H0 * 60) - H0 * 60) / 60) * PX;
    const bloque = (c, ci, s, e, fantasma) => {
      const top = topDe(s), hgt = Math.max(16, topDe(Math.min(e, H1 * 60)) - top);
      const w = `calc((100% - ${GUT}px) / ${cols.length} / ${c._n || 1} - 3px)`;
      const left = `calc(${GUT}px + (100% - ${GUT}px) * ${ci} / ${cols.length} + (100% - ${GUT}px) / ${cols.length} / ${c._n || 1} * ${c._l || 0} + 1px)`;
      return h("div", { key: (fantasma ? "f-" : "") + c.id, "data-cal-cita": fantasma ? undefined : c.id, title: resumenCita(c),
        onPointerDown: fantasma ? undefined : (e) => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); const p = pos(e); set({ modo: "mover", c, s: c._s, dm: 0, ci0: ci, ci, y0: p.y, movido: false }); },
        style: { position: "absolute", top: top + "px", height: hgt + "px", left, width: w, borderRadius: "7px", padding: "2px 6px", boxSizing: "border-box", overflow: "hidden", fontSize: "11.5px", lineHeight: 1.25, cursor: "grab", userSelect: "none", zIndex: fantasma ? 5 : 2,
          boxShadow: fantasma ? "0 6px 18px rgba(15,27,46,.35)" : "0 1px 2px rgba(15,27,46,.2)", ...estiloCita(c), ...(fantasma ? { opacity: 0.85 } : drag && drag.c && drag.c.id === c.id && drag.movido ? { opacity: 0.25 } : {}) } },
        h("div", { style: { fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, marca(c), txtHora(s), " ", nomCita(c)),
        hgt > 30 ? h("div", { style: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", opacity: 0.95 } }, [vehCita(c), c.garantia && c.garantia.numero].filter(Boolean).join(" · ") || tipoL(c.tipo)[1]) : null,
        hgt > 46 && c.mecanico ? h("div", { style: { fontSize: "10.5px", opacity: 0.9 } }, c.mecanico) : null,
        fantasma ? null : h("div", { "data-cal-estirar": c.id, onPointerDown: (e) => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); set({ modo: "estirar", c, s: c._s, m1: c._e }); },
          style: { position: "absolute", left: 0, right: 0, bottom: 0, height: "7px", cursor: "ns-resize" } }));
    };
    let fantasma = null;
    if (drag && drag.modo === "mover" && drag.movido) { const c = drag.c; const dur = c._e - c._s; fantasma = bloque({ ...c, _n: 1, _l: 0 }, drag.ci, c._s + drag.dm, c._s + drag.dm + dur, true); }
    if (drag && drag.modo === "estirar") { const c = drag.c; fantasma = bloque({ ...c }, cols.findIndex((x, i) => porCol[i].some((y) => y.id === c.id)), c._s, drag.m1, true); }
    return h("div", { style: { position: "relative" } },
      h("div", { ref, "data-cal-grid": "1", style: { position: "relative", height: alto + "px", userSelect: "none", touchAction: "none" } },
        // franjas de horario y líneas de hora
        cols.map((col, ci) => h("div", { key: "bg" + ci, "data-cal-col": ci, onPointerDown: (e) => { if (e.button !== 0) return; e.preventDefault(); const p = pos(e); const m0 = snapM(p.y); set({ modo: "crear", ci: p.ci, m0, m1: m0 + SNAP, y0: p.y, movido: false }); },
          style: { position: "absolute", top: 0, bottom: 0, left: izq(ci), width: ancho, borderLeft: `1px solid ${T.border}`, cursor: "cell", background: laborable(col.dia) ? "#EDF0F5" : "#E4E8EF" } },
          laborable(col.dia) ? TURNOS.map(([a, b]) => h("div", { key: a, style: { position: "absolute", left: 0, right: 0, top: topDe(a) + "px", height: topDe(b) - topDe(a) + "px", background: T.surface } })) : null)),
        Array.from({ length: H1 - H0 + 1 }, (_, i) => h("div", { key: "h" + i, style: { position: "absolute", left: 0, right: 0, top: i * PX + "px", borderTop: `1px solid ${i === 0 ? "transparent" : T.border}`, pointerEvents: "none" } },
          h("span", { style: { position: "absolute", left: "6px", top: "-8px", fontSize: "11px", color: T.inkSoft, background: T.surface, padding: "0 3px" } }, i === 0 ? "" : `${H0 + i}:00`))),
        Array.from({ length: H1 - H0 }, (_, i) => h("div", { key: "m" + i, style: { position: "absolute", left: GUT + "px", right: 0, top: i * PX + PX / 2 + "px", borderTop: `1px dashed ${T.border}`, opacity: 0.6, pointerEvents: "none" } })),
        // ahora
        cols.map((col, ci) => mismo(col.dia, ahora) && minDe(ahora) >= H0 * 60 && minDe(ahora) <= H1 * 60 ? h("div", { key: "now" + ci, style: { position: "absolute", left: izq(ci), width: ancho, top: topDe(minDe(ahora)) + "px", borderTop: "2px solid #DC2626", zIndex: 4, pointerEvents: "none" } },
          h("span", { style: { position: "absolute", left: "-5px", top: "-6px", width: "10px", height: "10px", borderRadius: "50%", background: "#DC2626" } })) : null),
        // citas
        porCol.map((lista, ci) => carriles(lista).map((c) => bloque(c, ci, c._s, c._e))),
        fantasma,
        drag && drag.modo === "crear" ? h("div", { style: { position: "absolute", left: izq(drag.ci), width: ancho, top: topDe(drag.m0) + "px", height: topDe(drag.m1) - topDe(drag.m0) + "px", background: "rgba(59,91,255,.18)", border: `2px solid ${T.rust}`, borderRadius: "7px", boxSizing: "border-box", zIndex: 6, pointerEvents: "none", fontSize: "11.5px", fontWeight: 800, color: T.rust, padding: "2px 6px" } },
          `${txtHora(drag.m0)}–${txtHora(drag.movido ? drag.m1 : drag.m0 + DUR_DEF)}`) : null));
  }

  // Fila de citas de todo el día y entregas de vehículos nuevos
  function FilaTodoDia({ T, cols, citas, entregas, colDe, colEntrega, onAbrir, onEntrega }) {
    const hay = citas.some((c) => c.todo_dia && colDe(c) >= 0) || entregas.some((m) => colEntrega(m) >= 0);
    if (!hay) return null;
    return h("div", { style: { display: "grid", gridTemplateColumns: `${GUT}px repeat(${cols.length}, 1fr)`, borderBottom: `1px solid ${T.border}`, background: T.surface } },
      h("div", { style: { fontSize: "10.5px", color: T.inkSoft, padding: "4px", alignSelf: "center" } }, "Todo el día"),
      cols.map((col, ci) => h("div", { key: ci, style: { borderLeft: `1px solid ${T.border}`, padding: "3px", display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 } },
        citas.filter((c) => c.todo_dia && colDe(c) === ci).map((c) => h("button", { key: c.id, "data-cal-cita": c.id, title: resumenCita(c), onClick: () => onAbrir(c), style: { border: "none", borderRadius: "6px", padding: "2px 6px", fontSize: "11.5px", fontWeight: 700, textAlign: "left", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...estiloCita(c) } }, marca(c), nomCita(c))),
        entregas.filter((m) => colEntrega(m) === ci).map((m) => h("button", { key: m.id, "data-cal-entrega": m.id, title: `Entrega comprometida · ${m.numero} · ${vehTxt(m.vehiculo)}`, onClick: () => onEntrega(m), style: { border: `1px dashed #0E7490`, background: "#ECFEFF", color: "#0E7490", borderRadius: "6px", padding: "2px 6px", fontSize: "11.5px", fontWeight: 800, textAlign: "left", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, `🔑 Entrega ${m.numero} · ${m.cliente ? nombreCli(m.cliente) : ""}`)))));
  }

  // =====================================================================
  //  Vista Mes
  // =====================================================================
  function VistaMes({ T, fecha, citas, entregas, onDia, onAbrir, onNueva, onMoverDia, onEntrega }) {
    const ini = lunes(new Date(fecha.getFullYear(), fecha.getMonth(), 1));
    const dias = Array.from({ length: 42 }, (_, i) => addD(ini, i));
    const hoy = new Date();
    const [sobre, setSobre] = useState(null);
    return h("div", { "data-cal-mes": "1", style: { border: `1px solid ${T.border}`, borderRadius: "12px", overflow: "hidden", background: T.surface } },
      h("div", { style: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: `1px solid ${T.border}` } }, ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"].map((d) => h("div", { key: d, style: { padding: "6px", fontSize: "11px", fontWeight: 800, color: T.inkSoft, textTransform: "uppercase", textAlign: "center" } }, d))),
      h("div", { style: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gridAutoRows: "minmax(108px, auto)" } },
        dias.map((d) => { const k = keyD(d); const xs = citas.filter((c) => mismo(new Date(c.inicio), d)).sort((a, b) => (b.todo_dia - a.todo_dia) || new Date(a.inicio) - new Date(b.inicio));
          const en = entregas.filter((m) => m.fecha_entrega === k); const otros = d.getMonth() !== fecha.getMonth(); const MAX = 4; const todos = [...en.map((m) => ({ _ent: m })), ...xs];
          return h("div", { key: k, "data-cal-dia": k, onDoubleClick: (e) => { if (e.target === e.currentTarget) onNueva(d); },
            onDragOver: (e) => { e.preventDefault(); setSobre(k); }, onDragLeave: () => setSobre((s) => (s === k ? null : s)), onDrop: (e) => { e.preventDefault(); setSobre(null); const id = e.dataTransfer.getData("text/plain"); if (id) onMoverDia(id, d); },
            style: { borderRight: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}`, padding: "4px", display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, background: sobre === k ? "#EEF2FF" : !laborable(d) ? "#F5F7FB" : T.surface, opacity: otros ? 0.55 : 1 } },
            h("button", { onClick: () => onDia(d), style: { alignSelf: "flex-start", border: "none", cursor: "pointer", fontSize: "12px", fontWeight: 800, borderRadius: "50%", width: "24px", height: "24px", background: mismo(d, hoy) ? T.rust : "transparent", color: mismo(d, hoy) ? "#fff" : T.ink } }, d.getDate()),
            todos.slice(0, MAX).map((x) => x._ent
              ? h("button", { key: "e" + x._ent.id, onClick: () => onEntrega(x._ent), style: { border: `1px dashed #0E7490`, background: "#ECFEFF", color: "#0E7490", borderRadius: "5px", padding: "1px 5px", fontSize: "11px", fontWeight: 800, textAlign: "left", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, `🔑 ${x._ent.numero}`)
              : h("div", { key: x.id, "data-cal-cita": x.id, draggable: true, onDragStart: (e) => e.dataTransfer.setData("text/plain", x.id), onClick: () => onAbrir(x), title: resumenCita(x),
                  style: { display: "flex", gap: "4px", alignItems: "center", borderRadius: "5px", padding: "1px 5px", fontSize: "11px", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...(x.todo_dia ? estiloCita(x) : { color: T.ink, opacity: x.estado === "anulada" ? 0.45 : 1, textDecoration: x.estado === "anulada" ? "line-through" : "none" }) } },
                  x.todo_dia ? null : h("span", { style: { width: "8px", height: "8px", borderRadius: "50%", background: x.tipo === "bloqueo" ? "#475569" : colorMec(x.mecanico), flex: "0 0 auto" } }),
                  h("span", { style: { overflow: "hidden", textOverflow: "ellipsis" } }, marca(x), x.todo_dia ? "" : hm(new Date(x.inicio)) + " ", h("b", null, nomCita(x))))),
            todos.length > MAX ? h("button", { onClick: () => onDia(d), style: { border: "none", background: "transparent", color: T.inkSoft, fontSize: "11px", fontWeight: 800, textAlign: "left", cursor: "pointer", padding: "0 4px" } }, `+${todos.length - MAX} más`) : null); })));
  }

  // =====================================================================
  //  Vista Agenda (lista) — también para los resultados del buscador
  // =====================================================================
  function VistaAgenda({ T, citas, entregas, onAbrir, onEntrega, vacio }) {
    const grupos = {};
    citas.forEach((c) => { const k = keyD(new Date(c.inicio)); (grupos[k] = grupos[k] || { c: [], e: [] }).c.push(c); });
    (entregas || []).forEach((m) => { (grupos[m.fecha_entrega] = grupos[m.fecha_entrega] || { c: [], e: [] }).e.push(m); });
    const ks = Object.keys(grupos).sort();
    if (!ks.length) return h("div", { style: { padding: "40px", textAlign: "center", color: T.inkSoft, border: `1px dashed ${T.border}`, borderRadius: "12px", background: T.surface } }, vacio || "No hay citas.");
    const hoy = new Date();
    return h("div", { "data-cal-agenda": "1", style: { border: `1px solid ${T.border}`, borderRadius: "12px", background: T.surface, overflow: "hidden" } },
      ks.map((k) => { const d = deKey(k); const g = grupos[k];
        return h("div", { key: k, style: { display: "grid", gridTemplateColumns: "130px 1fr", borderTop: `1px solid ${T.border}` } },
          h("div", { style: { padding: "10px 12px", fontWeight: 800, fontSize: "13px", color: mismo(d, hoy) ? T.rust : T.ink } }, `${DIAS[d.getDay()]} ${d.getDate()}`, h("div", { style: { fontSize: "11.5px", color: T.inkSoft, fontWeight: 600 } }, `${MESES[d.getMonth()]} ${d.getFullYear()}`)),
          h("div", null,
            g.e.map((m) => h("button", { key: m.id, onClick: () => onEntrega(m), style: { display: "flex", width: "100%", gap: "10px", alignItems: "center", padding: "8px 12px", border: "none", borderBottom: `1px solid ${T.border}`, background: "#ECFEFF", cursor: "pointer", textAlign: "left", fontSize: "13px", color: "#0E7490", fontWeight: 700 } }, `🔑 Entrega comprometida ${m.numero} · ${m.cliente ? nombreCli(m.cliente) : ""} · ${vehTxt(m.vehiculo)}`)),
            g.c.sort((a, b) => (b.todo_dia - a.todo_dia) || new Date(a.inicio) - new Date(b.inicio)).map((c) => h("button", { key: c.id, "data-cal-cita": c.id, onClick: () => onAbrir(c),
              style: { display: "grid", gridTemplateColumns: "110px 14px 1fr auto", width: "100%", gap: "10px", alignItems: "center", padding: "8px 12px", border: "none", borderBottom: `1px solid ${T.border}`, background: "transparent", cursor: "pointer", textAlign: "left", fontSize: "13px", color: T.ink, opacity: c.estado === "anulada" ? 0.5 : 1 } },
              h("span", { style: { fontWeight: 700 } }, horaCita(c)),
              h("span", { style: { width: "12px", height: "12px", borderRadius: "50%", background: c.tipo === "bloqueo" ? "#475569" : colorMec(c.mecanico) } }),
              h("span", { style: { minWidth: 0 } }, h("b", { style: { textDecoration: c.estado === "anulada" ? "line-through" : "none" } }, nomCita(c)), " ", h("span", { style: { color: T.inkSoft } }, [vehCita(c), c.garantia && c.garantia.numero, tipoL(c.tipo)[1], c.mecanico || "sin mecánico"].filter(Boolean).join(" · "))),
              ESTADOS[c.estado] && c.estado !== "programada" ? h(Chip, { c: ESTADOS[c.estado][1] }, ESTADOS[c.estado][0]) : h("span"))))); }));
  }

  // =====================================================================
  //  Mini calendario
  // =====================================================================
  function MiniMes({ T, fecha, onElegir, marcados }) {
    const [ver, setVer] = useState(() => new Date(fecha.getFullYear(), fecha.getMonth(), 1));
    useEffect(() => { setVer(new Date(fecha.getFullYear(), fecha.getMonth(), 1)); }, [fecha.getFullYear(), fecha.getMonth()]);
    const ini = lunes(ver); const hoy = new Date();
    return h("div", { style: { fontSize: "12px" } },
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" } },
        h("b", null, `${MESES[ver.getMonth()].charAt(0).toUpperCase() + MESES[ver.getMonth()].slice(1)} ${ver.getFullYear()}`),
        h("span", null, h("button", { onClick: () => setVer(new Date(ver.getFullYear(), ver.getMonth() - 1, 1)), "aria-label": "Mes anterior", style: { border: "none", background: "transparent", cursor: "pointer", fontSize: "15px" } }, "‹"),
          h("button", { onClick: () => setVer(new Date(ver.getFullYear(), ver.getMonth() + 1, 1)), "aria-label": "Mes siguiente", style: { border: "none", background: "transparent", cursor: "pointer", fontSize: "15px" } }, "›"))),
      h("div", { style: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", textAlign: "center", gap: "1px" } },
        ["L", "M", "X", "J", "V", "S", "D"].map((x) => h("div", { key: x, style: { color: T.inkSoft, fontWeight: 800, fontSize: "10.5px" } }, x)),
        Array.from({ length: 42 }, (_, i) => { const d = addD(ini, i); const sel = mismo(d, fecha); const esHoy = mismo(d, hoy);
          return h("button", { key: i, onClick: () => onElegir(d), style: { border: "none", cursor: "pointer", borderRadius: "50%", width: "24px", height: "24px", margin: "0 auto", fontSize: "11.5px", position: "relative",
            background: sel ? T.ink : esHoy ? T.rust : "transparent", color: sel || esHoy ? "#fff" : d.getMonth() !== ver.getMonth() ? T.inkFaint || "#94A3B8" : T.ink, fontWeight: sel || esHoy ? 800 : 500 } }, d.getDate(),
            marcados && marcados.has(keyD(d)) && !sel && !esHoy ? h("span", { style: { position: "absolute", bottom: "1px", left: "50%", marginLeft: "-2px", width: "4px", height: "4px", borderRadius: "50%", background: T.rust } }) : null); })));
  }

  // =====================================================================
  //  Editor de cita (nueva o cambiar)
  // =====================================================================
  function Editor({ T, F, inicial, onClose, onSaved }) {
    const I = inp(T);
    const ini = new Date(inicial.inicio), fin = new Date(inicial.fin);
    const [d, setD] = useState({ tipo: inicial.tipo || "taller", fecha: keyD(ini), desde: `${pad(ini.getHours())}:${pad(ini.getMinutes())}`, hasta: `${pad(fin.getHours())}:${pad(fin.getMinutes())}`,
      todo_dia: !!inicial.todo_dia, mecanico: inicial.mecanico || "", titulo: inicial.titulo || "", notas: inicial.notas || "" });
    const [cli, setCli] = useState(inicial.cliente || null);           // cliente del CRM
    const [selBC, setSelBC] = useState(null);                           // cliente elegido de BC (se crea en el CRM al guardar)
    const [nuevo, setNuevo] = useState(null);                           // { nombre, apellidos, telefono }
    const [q, setQ] = useState(""); const [res, setRes] = useState([]); const t = useRef(null);
    const [abiertos, setAbiertos] = useState({ casos: [], garantias: [] });
    const [link, setLink] = useState(inicial.garantia_id ? "g:" + inicial.garantia_id : inicial.caso_id ? "c:" + inicial.caso_id : "");
    const [veh, setVeh] = useState(inicial.vehiculo ? JSON.stringify(asVeh(inicial.vehiculo)) : "");
    const [vehOtro, setVehOtro] = useState({ modelo: "", matricula: "" });
    const [pasar, setPasar] = useState(true);
    const [solapes, setSolapes] = useState([]);
    const [err, setErr] = useState(""); const [guardando, setGuardando] = useState(false);
    const setK = (k) => (e) => setD((x) => ({ ...x, [k]: e && e.target ? (e.target.type === "checkbox" ? e.target.checked : e.target.value) : e }));
    useEffect(() => { clearTimeout(t.current); if (cli || selBC || nuevo || qSafe(q).length < 2) { setRes([]); return; } t.current = setTimeout(async () => { try { setRes(await buscarClientes(q)); } catch (e) {} }, 300); }, [q, cli, selBC, nuevo]);
    // Casos y garantías abiertos del cliente, para vincular la cita
    useEffect(() => { let vivo = true; if (!cli) { setAbiertos({ casos: [], garantias: [] }); return; }
      Promise.all([sb().from("crm_casos").select("id,estado,tipo,consulta,vehiculo,archivado,created_at").eq("cliente_id", cli.id).eq("archivado", false).order("created_at", { ascending: false }).limit(30),
        sb().from("garantias").select("id,numero,estado,vehiculo,caso_id,archivado,created_at").eq("cliente_id", cli.id).eq("archivado", false).order("created_at", { ascending: false }).limit(30)])
        .then(([a, b]) => { if (!vivo) return; const finC = (e) => { const x = U.est ? U.est(e) : null; return x && x.fin; }; const EG = (window.AcllarGarantias && window.AcllarGarantias._test && window.AcllarGarantias._test.EST) || {};
          setAbiertos({ casos: (a.data || []).filter((k) => !finC(k.estado) && k.estado !== "en_garantias" || ("c:" + k.id) === link), garantias: (b.data || []).filter((g) => !(EG[g.estado] || {}).fin && !["cerrada", "descartada"].includes(g.estado) || ("g:" + g.id) === link) }); });
      return () => { vivo = false; }; }, [cli && cli.id]);
    const casoSel = link.startsWith("c:") ? abiertos.casos.find((k) => "c:" + k.id === link) : null;
    const garSel = link.startsWith("g:") ? abiertos.garantias.find((g) => "g:" + g.id === link) : null;
    // Opciones de vehículo: los de la ficha del cliente y el del caso/garantía
    const opcVeh = useMemo(() => { const xs = []; const add = (v) => { if (!v) return; const o = asVeh(v); if (!o.modelo && !o.matricula) return; const s = JSON.stringify({ modelo: o.modelo || "", matricula: o.matricula || "", bastidor: o.bastidor || "" }); if (!xs.some((x) => x[0] === s)) xs.push([s, vehTxt(o)]); };
      if (garSel) add(garSel.vehiculo); if (casoSel) add(casoSel.vehiculo); ((cli && cli.vehiculos) || []).forEach(add); if (inicial.vehiculo) add(inicial.vehiculo); return xs; }, [cli, casoSel, garSel]);
    useEffect(() => { if (veh && veh !== "__otro" && !opcVeh.some((o) => o[0] === veh) && opcVeh.length) setVeh(opcVeh[0][0]); else if (!veh && opcVeh.length) setVeh(opcVeh[0][0]); }, [opcVeh.map((o) => o[0]).join("|")]);
    useEffect(() => { if (garSel) setD((x) => ({ ...x, tipo: x.tipo === "taller" ? "garantia" : x.tipo })); }, [garSel && garSel.id]);
    // ¿se puede pasar el caso / la garantía a "cita"?
    const opcCita = (() => { if (garSel) { const EG = (window.AcllarGarantias && window.AcllarGarantias._test && window.AcllarGarantias._test.EST) || {}; const s = ((EG[garSel.estado] || {}).sig || []).find((x) => x.to === "cita_asignada" && garSel.estado !== "cita_asignada"); return s ? { tabla: "garantias", id: garSel.id, s, l: "Pasar el expediente a «Cita asignada»" } : null; }
      if (casoSel && U.est) { const s = (U.est(casoSel.estado).sig || []).find((x) => x.to === "cita_asignada"); return s ? { tabla: "crm_casos", id: casoSel.id, s, l: `Pasar el caso a «${U.est("cita_asignada").l}»` } : null; } return null; })();
    // Rango elegido
    const rango = () => { const base = deKey(d.fecha); if (d.todo_dia) return [base, addD(base, 1)]; const [h1, m1] = d.desde.split(":").map(Number); const [h2, m2] = d.hasta.split(":").map(Number); return [conMin(base, h1 * 60 + m1), conMin(base, h2 * 60 + m2)]; };
    // Avisos: el mecánico ya tiene otra cita a esa hora
    useEffect(() => { let vivo = true; const [a, b] = rango(); if (!d.mecanico || !(b > a)) { setSolapes([]); return; }
      sb().from("citas").select("id,inicio,fin,todo_dia,titulo,cliente_id,estado,mecanico").eq("mecanico", d.mecanico).eq("estado", "programada").lt("inicio", b.toISOString()).gte("fin", a.toISOString()).limit(10)
        .then(({ data }) => { if (vivo) setSolapes((data || []).filter((x) => x.id !== inicial.id && new Date(x.fin) > a && new Date(x.inicio) < b)); });
      return () => { vivo = false; }; }, [d.mecanico, d.fecha, d.desde, d.hasta, d.todo_dia]);
    const durar = (min) => { const [h1, m1] = d.desde.split(":").map(Number); const t2 = Math.min(23 * 60 + 45, h1 * 60 + m1 + min); setD((x) => ({ ...x, todo_dia: false, hasta: `${pad(Math.floor(t2 / 60))}:${pad(t2 % 60)}` })); };
    const franja = (a, b) => setD((x) => ({ ...x, todo_dia: false, desde: `${pad(Math.floor(a / 60))}:${pad(a % 60)}`, hasta: `${pad(Math.floor(b / 60))}:${pad(b % 60)}` }));
    const guardar = async () => {
      setErr(""); const [a, b] = rango();
      if (!(b > a)) { setErr("La hora de fin tiene que ser posterior a la de inicio."); return; }
      if (d.tipo !== "bloqueo" && !cli && !selBC && !(nuevo && nuevo.nombre.trim()) && !d.titulo.trim()) { setErr("Elige el cliente o escribe un título para la cita."); return; }
      setGuardando(true);
      try {
        let clienteId = cli ? cli.id : null;
        if (!clienteId && selBC) { const ex = await sb().from("crm_clientes").select("id").eq("bc_no", selBC.no).maybeSingle();
          if (ex.data) clienteId = ex.data.id; else { const ins = await sb().from("crm_clientes").insert({ bc_no: selBC.no, nombre: selBC.nombre || "(sin nombre)", telefono: selBC.telefono, email: selBC.email, direccion: selBC.direccion, cp: selBC.cp, ciudad: selBC.ciudad, provincia: selBC.provincia, nif: selBC.nif }).select("id").single(); if (ins.error) throw ins.error; clienteId = ins.data.id; } }
        if (!clienteId && nuevo && nuevo.nombre.trim()) { const ins = await sb().from("crm_clientes").insert({ nombre: nuevo.nombre.trim(), apellidos: nuevo.apellidos.trim() || null, telefono: nuevo.telefono.trim() || null, vehiculos: vehOtro.modelo.trim() ? [{ modelo: vehOtro.modelo.trim(), matricula: normMat(vehOtro.matricula) }] : [] }).select("id").single(); if (ins.error) throw ins.error; clienteId = ins.data.id; }
        let vehiculo = null;
        if (veh === "__otro" || (!veh && vehOtro.modelo.trim())) { if (vehOtro.modelo.trim() || vehOtro.matricula.trim()) vehiculo = { modelo: vehOtro.modelo.trim(), matricula: normMat(vehOtro.matricula) }; }
        else if (veh) vehiculo = JSON.parse(veh);
        const row = { inicio: a.toISOString(), fin: b.toISOString(), todo_dia: d.todo_dia, tipo: d.tipo, mecanico: d.mecanico || null, titulo: d.titulo.trim() || null, notas: d.notas.trim() || null,
          cliente_id: d.tipo === "bloqueo" ? null : clienteId, caso_id: garSel ? garSel.caso_id || null : casoSel ? casoSel.id : null, garantia_id: garSel ? garSel.id : null, vehiculo: d.tipo === "bloqueo" ? null : vehiculo };
        const r = inicial.id ? await sb().from("citas").update(row).eq("id", inicial.id).select("*").single() : await sb().from("citas").insert(row).select("*").single();
        if (r.error) throw r.error;
        if (opcCita && pasar) { const p = await sb().from(opcCita.tabla).update({ estado: "cita_asignada", ...(opcCita.s.set || {}) }).eq("id", opcCita.id); if (p.error) throw p.error; }
        onSaved(r.data);
      } catch (e) { setErr("No se pudo guardar: " + (e.message || e)); setGuardando(false); }
    };
    const [a0, b0] = rango(); const fuera = !d.todo_dia && b0 > a0 && !enHorario(a0, b0);
    const nombreSel = cli ? nombreCli(cli) : selBC ? selBC.nombre : null;
    return h("div", { role: "dialog", "aria-label": inicial.id ? "Cambiar cita" : "Nueva cita", style: { position: "fixed", inset: 0, zIndex: 1260, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "30px 12px" } },
      h("div", { onClick: onClose, style: { position: "fixed", inset: 0, background: "rgba(15,27,46,.35)" } }),
      h("div", { style: { position: "relative", width: "min(720px, 100%)", background: T.surface, borderRadius: "16px", border: `1px solid ${T.border}`, padding: "22px", display: "flex", flexDirection: "column", gap: "14px", fontFamily: F.body, color: T.ink } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } }, h("div", { style: { fontFamily: F.display, fontSize: "22px", fontWeight: 800 } }, inicial.id ? "Cambiar cita" : "Nueva cita"),
          h("button", { onClick: onClose, "aria-label": "Cerrar", style: { border: "none", background: "transparent", cursor: "pointer", fontSize: "22px", color: T.inkSoft } }, "×")),
        h(Seg, { T, opts: TIPOS.map((x) => [x[0], `${x[2]} ${x[1]}`]), value: d.tipo, onChange: setK("tipo") }),
        // cuándo
        h("div", { style: { display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr auto", gap: "8px", alignItems: "end" } },
          h(Field, { T, label: "Día" }, h("input", { type: "date", "aria-label": "Día", value: d.fecha, onChange: setK("fecha"), style: I })),
          h(Field, { T, label: "Desde" }, h("input", { type: "time", step: 900, "aria-label": "Desde", value: d.desde, disabled: d.todo_dia, onChange: (e) => { const v = e.target.value; setD((x) => { const [h1, m1] = x.desde.split(":").map(Number), [h2, m2] = x.hasta.split(":").map(Number), [h3, m3] = v.split(":").map(Number); const dur = Math.max(SNAP, h2 * 60 + m2 - h1 * 60 - m1); const t2 = Math.min(23 * 60 + 45, h3 * 60 + m3 + dur); return { ...x, desde: v, hasta: `${pad(Math.floor(t2 / 60))}:${pad(t2 % 60)}` }; }); }, style: I })),
          h(Field, { T, label: "Hasta" }, h("input", { type: "time", step: 900, "aria-label": "Hasta", value: d.hasta, disabled: d.todo_dia, onChange: setK("hasta"), style: I })),
          h("label", { style: { display: "flex", gap: "6px", alignItems: "center", fontSize: "13px", paddingBottom: "10px", whiteSpace: "nowrap" } }, h("input", { type: "checkbox", "aria-label": "Todo el día", checked: d.todo_dia, onChange: setK("todo_dia") }), "Todo el día")),
        d.todo_dia ? null : h("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } },
          [[30, "30 min"], [60, "1 h"], [120, "2 h"], [180, "3 h"], [240, "4 h"]].map(([m, l]) => h("button", { key: m, type: "button", onClick: () => durar(m), style: { ...btn(T, "s"), padding: "3px 10px", fontSize: "12px" } }, l)),
          h("button", { type: "button", onClick: () => franja(8 * 60, 14 * 60), style: { ...btn(T, "s"), padding: "3px 10px", fontSize: "12px" } }, "Mañana 8–14"),
          h("button", { type: "button", onClick: () => franja(15 * 60, 17 * 60), style: { ...btn(T, "s"), padding: "3px 10px", fontSize: "12px" } }, "Tarde 15–17")),
        fuera ? h("div", { "data-cal-fuera": "1", style: { fontSize: "12.5px", color: T.warn } }, "Fuera del horario del taller (lunes a viernes, 8–14 y 15–17).") : null,
        // mecánico
        h("div", null, h(Lbl, { T }, "Mecánico"),
          h("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } },
            [["", "Sin asignar", SIN_MEC], ...MECANICOS.map((m) => [m[0], m[0], m[1]])].map(([k, l, c]) => { const on = d.mecanico === k;
              return h("button", { key: l, type: "button", "data-cal-mec": l, onClick: () => setD((x) => ({ ...x, mecanico: k })), style: { display: "inline-flex", alignItems: "center", gap: "6px", padding: "5px 11px", borderRadius: "999px", cursor: "pointer", fontSize: "13px", fontWeight: 700, border: `2px solid ${c}`, background: on ? c : T.surface, color: on ? "#fff" : T.ink } },
                h("span", { style: { width: "9px", height: "9px", borderRadius: "50%", background: on ? "#fff" : c } }), l); })),
          solapes.length ? h("div", { "data-cal-solape": "1", style: { fontSize: "12.5px", color: T.warn, marginTop: "6px" } }, `${d.mecanico} ya tiene ${solapes.length === 1 ? "una cita" : solapes.length + " citas"} a esa hora: ${solapes.map((x) => horaCita(x)).join(", ")}. Puedes guardarla igualmente.`) : null),
        // cliente
        d.tipo === "bloqueo" ? null : h("div", null, h(Lbl, { T }, "Cliente"),
          nombreSel ? h("div", { "data-cal-cliente": "1", style: { display: "flex", justifyContent: "space-between", alignItems: "center", background: T.bg, borderRadius: "10px", padding: "10px 12px" } },
              h("span", null, h("b", null, nombreSel), " ", h("span", { style: { color: T.inkSoft, fontSize: "12.5px" } }, [(cli || selBC).telefono, (cli || selBC).ciudad].filter(Boolean).join(" · ")), selBC ? h("span", { style: { fontSize: "12px", color: T.inkSoft } }, " · se añade al CRM al guardar") : null),
              h("button", { type: "button", onClick: () => { setCli(null); setSelBC(null); setLink(""); setVeh(""); }, style: { ...btn(T, "s"), padding: "3px 10px", fontSize: "12px" } }, "Cambiar"))
            : nuevo ? h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: "8px", alignItems: "end" } },
                h(Field, { T, label: "Nombre" }, h("input", { "aria-label": "Nombre", value: nuevo.nombre, onChange: (e) => setNuevo((x) => ({ ...x, nombre: e.target.value })), style: I })),
                h(Field, { T, label: "Apellidos" }, h("input", { "aria-label": "Apellidos", value: nuevo.apellidos, onChange: (e) => setNuevo((x) => ({ ...x, apellidos: e.target.value })), style: I })),
                h(Field, { T, label: "Teléfono" }, h("input", { "aria-label": "Teléfono", value: nuevo.telefono, onChange: (e) => setNuevo((x) => ({ ...x, telefono: e.target.value })), style: I })),
                h("button", { type: "button", onClick: () => setNuevo(null), style: { ...btn(T, "s"), marginBottom: "2px" } }, "Buscar"))
            : h(React.Fragment, null,
                h("input", { type: "search", "data-cal-buscar-cli": "1", "aria-label": "Buscar cliente", value: q, onChange: (e) => setQ(e.target.value), placeholder: "Nombre, teléfono, email, NIF, matrícula o bastidor (CRM y BC)", style: I }),
                res.length ? h("div", { style: { border: `1px solid ${T.border}`, borderRadius: "10px", overflow: "hidden", marginTop: "6px", maxHeight: "260px", overflowY: "auto" } }, res.map((r) => h(ResultadoCliente, { key: r.k, T, r, cta: "Elegir", onPick: (x) => { setQ(""); if (x.tipo === "crm") setCli(x.c); else setSelBC(x.bc); } }))) : null,
                h("button", { type: "button", "data-cal-cli-nuevo": "1", onClick: () => setNuevo({ nombre: "", apellidos: "", telefono: "" }), style: { ...btn(T, "s"), marginTop: "6px", fontSize: "12.5px" } }, "+ Cliente nuevo"))),
        // vincular a caso / garantía
        cli && d.tipo !== "bloqueo" ? h("div", null, h(Lbl, { T }, "Vincular a"),
          h("div", { style: { display: "flex", flexDirection: "column", gap: "4px" } },
            [["", "Sin caso (solo la cita)"], ...abiertos.casos.map((k) => ["c:" + k.id, `Caso · ${lblTipos(k.tipo)} · ${(U.est ? U.est(k.estado).l : k.estado)}${k.consulta ? " · " + String(k.consulta).slice(0, 70) : ""}`]),
              ...abiertos.garantias.map((g) => ["g:" + g.id, `Garantía ${g.numero} · ${((window.AcllarGarantias && window.AcllarGarantias._test && window.AcllarGarantias._test.EST[g.estado]) || { l: g.estado }).l} · ${vehTxt(g.vehiculo)}`])]
              .map(([k, l]) => h("label", { key: k || "no", "data-cal-link": k || "ninguno", style: { display: "flex", gap: "8px", alignItems: "flex-start", fontSize: "13px", padding: "6px 8px", borderRadius: "8px", background: link === k ? "#EEF2FF" : "transparent", cursor: "pointer" } },
                h("input", { type: "radio", name: "cal-link", checked: link === k, onChange: () => setLink(k) }), l))),
          opcCita ? h("label", { "data-cal-pasar": "1", style: { display: "flex", gap: "8px", alignItems: "center", fontSize: "13px", marginTop: "6px", fontWeight: 700 } }, h("input", { type: "checkbox", checked: pasar, onChange: (e) => setPasar(e.target.checked) }), opcCita.l) : null) : null,
        // vehículo
        d.tipo === "bloqueo" ? null : h("div", null, h(Lbl, { T }, "Vehículo"),
          opcVeh.length ? h("select", { "aria-label": "Vehículo", value: veh, onChange: (e) => setVeh(e.target.value), style: I }, opcVeh.map(([k, l]) => h("option", { key: k, value: k }, l)), h("option", { value: "__otro" }, "Otro vehículo…"), h("option", { value: "" }, "— sin vehículo")) : null,
          !opcVeh.length || veh === "__otro" ? h("div", { style: { display: "grid", gridTemplateColumns: "2fr 1fr", gap: "8px", marginTop: opcVeh.length ? "6px" : 0 } },
            h("input", { "aria-label": "Modelo", placeholder: "Modelo", value: vehOtro.modelo, onChange: (e) => setVehOtro((x) => ({ ...x, modelo: e.target.value })), style: I }),
            h("input", { "aria-label": "Matrícula", placeholder: "Matrícula", value: vehOtro.matricula, onChange: (e) => setVehOtro((x) => ({ ...x, matricula: e.target.value })), style: I })) : null),
        h("div", { style: { display: "grid", gridTemplateColumns: "1fr", gap: "8px" } },
          h(Field, { T, label: d.tipo === "bloqueo" ? "Motivo (p. ej. Festivo, Formación…)" : "Título (opcional)" }, h("input", { "aria-label": "Título", value: d.titulo, onChange: setK("titulo"), placeholder: d.tipo === "bloqueo" ? "Festivo" : "Qué se va a hacer", style: I })),
          h(Field, { T, label: "Notas" }, h("textarea", { rows: 3, "aria-label": "Notas", value: d.notas, onChange: setK("notas"), style: { ...I, resize: "vertical" } }))),
        err ? h("div", { style: { color: T.danger, fontSize: "13px" } }, err) : null,
        h("div", { style: { display: "flex", justifyContent: "flex-end", gap: "10px" } }, h("button", { onClick: onClose, style: btn(T) }, "Cancelar"),
          h("button", { "data-cal-guardar": "1", onClick: guardar, disabled: guardando, style: btn(T, "p") }, guardando ? "Guardando…" : inicial.id ? "Guardar cambios" : "Crear cita"))));
  }

  // =====================================================================
  //  Ficha de una cita
  // =====================================================================
  function Detalle({ T, F, cita, onClose, onEditar, onDuplicar, onCambiado, onCliente }) {
    const [msg, setMsg] = useState(""); const [trab, setTrab] = useState(false); const [hist, setHist] = useState([]);
    const c = cita;
    useEffect(() => { let vivo = true; sb().from("crm_eventos").select("*").eq("detalle->>cita_id", c.id).order("at", { ascending: false }).limit(30).then(({ data }) => { if (vivo) setHist(data || []); }); return () => { vivo = false; }; }, [c.id, c.updated_at]);
    const upd = async (p, txt) => { setTrab(true); setMsg(""); const r = await sb().from("citas").update(p).eq("id", c.id); setTrab(false); if (r.error) { setMsg("No se pudo guardar: " + r.error.message); return false; } setMsg(txt || "Guardado."); onCambiado(); return true; };
    const avisar = async (canal) => {
      const texto = msgRecordatorio(c); const cl = c.cliente || {};
      if (canal === "wa") { const tel = telWa(cl.telefono); if (!tel) { setMsg("El cliente no tiene teléfono en su ficha."); return; } window.open(`https://wa.me/${tel}?text=${encodeURIComponent(texto)}`, "_blank", "noopener"); }
      else { if (!cl.email) { setMsg("El cliente no tiene email en su ficha."); return; } window.open(`mailto:${cl.email}?subject=${encodeURIComponent("Recordatorio de cita · AC·LLAR")}&body=${encodeURIComponent(texto)}`, "_blank"); }
      if (c.caso_id || c.garantia_id || c.cliente_id) await sb().from("crm_eventos").insert({ tipo: "bitacora", detalle: { clase: "respondi" }, texto: `Recordatorio de la cita por ${canal === "wa" ? "WhatsApp" : "email"}:\n${texto}`, caso_id: c.caso_id || null, garantia_id: c.garantia_id || null, cliente_id: c.cliente_id || null });
      await upd({ aviso_cliente_at: new Date().toISOString() }, "Mensaje abierto y anotado en la bitácora.");
    };
    const e = ESTADOS[c.estado] || ESTADOS.programada;
    const linea = (k, v) => v ? h("div", { style: { display: "grid", gridTemplateColumns: "110px 1fr", gap: "10px", fontSize: "13.5px", padding: "4px 0" } }, h("span", { style: { color: T.inkSoft } }, k), h("span", null, v)) : null;
    const link = (txt, onClick, data) => h("button", { "data-cal-ir": data, onClick, style: { border: "none", background: "transparent", color: T.rust, fontWeight: 800, cursor: "pointer", padding: 0, textAlign: "left", fontSize: "13.5px", textDecoration: "underline" } }, txt);
    const ini = new Date(c.inicio);
    return h(Drawer, { T, onClose, label: "Cita", width: 520 },
      h("div", { style: { background: T.surface, padding: "18px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", flexDirection: "column", gap: "6px" } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
          h("span", { style: { display: "inline-flex", gap: "8px", alignItems: "center", fontSize: "12px", fontWeight: 800, color: T.inkSoft, textTransform: "uppercase", letterSpacing: ".06em" } }, h("span", { style: { width: "12px", height: "12px", borderRadius: "50%", background: c.tipo === "bloqueo" ? "#475569" : colorMec(c.mecanico) } }), `${tipoL(c.tipo)[2]} ${tipoL(c.tipo)[1]}`),
          h("button", { onClick: onClose, "aria-label": "Cerrar", style: { border: "none", background: "transparent", cursor: "pointer", fontSize: "22px", color: T.inkSoft } }, "×")),
        h("div", { style: { fontFamily: F.display, fontSize: "22px", fontWeight: 800 } }, nomCita(c)),
        h("div", { style: { fontSize: "14px" } }, `${DIAS[ini.getDay()]} ${ini.getDate()} de ${MESES[ini.getMonth()]} · ${horaCita(c)}`),
        h("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } }, h(Chip, { c: e[1] }, e[0]), c.aviso_cliente_at ? h(Chip, { c: "verde" }, "Cliente avisado " + fFechaHora(c.aviso_cliente_at)) : null)),
      h("div", { style: { padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px" } },
        h(Box, { T },
          h("div", { "data-cal-det-mec": "1", style: { padding: "4px 0 8px" } }, h("div", { style: { fontSize: "12px", fontWeight: 800, color: T.inkSoft, marginBottom: "6px" } }, "Mecánico (pulsa para asignar)"),
            U.ElegirMecanico ? h(U.ElegirMecanico, { T, value: c.mecanico, disabled: trab, compacto: true, onChange: (m) => { if ((m || null) !== (c.mecanico || null)) upd({ mecanico: m }, m ? `Asignada a ${m}.` : "Sin mecánico."); } })
              : h("span", { style: { fontWeight: 700 } }, c.mecanico || "Sin asignar")),
          c.cliente ? linea("Cliente", h("span", null, link(nombreCli(c.cliente), () => onCliente(c.cliente.id), "cliente"), c.cliente.telefono ? h("span", { style: { color: T.inkSoft } }, " · " + c.cliente.telefono) : null)) : null,
          linea("Vehículo", vehCita(c) + (c.vehiculo && asVeh(c.vehiculo).bastidor ? " · bastidor " + asVeh(c.vehiculo).bastidor : "")),
          c.caso ? linea("Caso", link(`${lblTipos(c.caso.tipo)} · ${U.est ? U.est(c.caso.estado).l : c.caso.estado} →`, () => irA("clientes", { acllar_crm_abrir_caso: c.caso.id }), "caso")) : null,
          c.garantia ? linea("Garantía", link(`${c.garantia.numero} →`, () => irA("garantias", { acllar_garantia_abrir: c.garantia.id }), "garantia")) : null,
          c.montaje_id ? linea("Vehículo nuevo", link("Abrir expediente →", () => irA("montajes", { acllar_montaje_abrir: c.montaje_id }), "montaje")) : null,
          linea("Título", c.titulo), linea("Notas", c.notas ? h("span", { style: { whiteSpace: "pre-wrap" } }, c.notas) : null)),
        c.cliente && c.estado === "programada" ? h(Box, { T }, h(Lbl, { T }, "Recordar la cita al cliente"),
          h("div", { style: { display: "flex", gap: "8px" } }, h("button", { "data-cal-wa": "1", disabled: trab, onClick: () => avisar("wa"), style: { ...btn(T, "wa"), flex: 1 } }, "💬 WhatsApp"), h("button", { "data-cal-mail": "1", disabled: trab, onClick: () => avisar("mail"), style: { ...btn(T, "s"), flex: 1 } }, "✉ Email"))) : null,
        h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
          h("button", { "data-cal-editar": "1", onClick: onEditar, style: btn(T, "p") }, "✎ Cambiar"),
          h("button", { "data-cal-duplicar": "1", onClick: onDuplicar, style: btn(T, "s") }, "⧉ Duplicar"),
          c.estado === "programada" ? h(React.Fragment, null,
            h("button", { "data-cal-estado": "realizada", disabled: trab, onClick: () => upd({ estado: "realizada" }, "Marcada como realizada."), style: btn(T, "s") }, "✓ Realizada"),
            h("button", { "data-cal-estado": "no_presentado", disabled: trab, onClick: () => upd({ estado: "no_presentado" }, "Anotado: no se presentó."), style: btn(T, "s") }, "✗ No se presentó"),
            h("button", { "data-cal-estado": "anulada", disabled: trab, onClick: () => { if (window.confirm("¿Anular esta cita? No se borra: queda anulada en el historial.")) upd({ estado: "anulada" }, "Cita anulada."); }, style: { ...btn(T, "s"), color: T.danger } }, "Anular"))
            : h("button", { "data-cal-estado": "programada", disabled: trab, onClick: () => upd({ estado: "programada" }, "Cita reactivada."), style: btn(T, "s") }, "↺ Volver a programada")),
        msg ? h("div", { style: { fontSize: "13px", color: /No se pudo|no tiene/.test(msg) ? T.danger : T.ok || "#15803D" } }, msg) : null,
        hist.length ? h(Box, { T }, h(Lbl, { T }, "Historial de la cita"), hist.map((x) => h("div", { key: x.id, style: { fontSize: "12.5px", padding: "3px 0", borderTop: `1px solid ${T.border}` } }, h("span", { style: { color: T.inkSoft } }, `${fFechaHora(x.at)} · ${quien(x.autor)} · `), x.texto))) : null,
        h("div", { style: { fontSize: "11.5px", color: T.inkSoft } }, `Creada ${fFechaHora(c.created_at)} por ${quien(c.created_by)}${c.updated_at && c.updated_at !== c.created_at ? ` · último cambio ${fFechaHora(c.updated_at)} por ${quien(c.updated_by)}` : ""}`)));
  }

  // =====================================================================
  //  Pantalla principal
  // =====================================================================
  function Calendario({ T, F }) {
    const lsGet = (k) => { try { const x = localStorage.getItem(k); return x; } catch (e) { return null; } };
    const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} };
    const [vista, setVista] = useState(() => { const x = lsGet("acllar_cal_vista"); return ["dia", "semana", "mes", "agenda"].includes(x) ? x : "semana"; });
    const [fecha, setFecha] = useState(() => { const x = lsGet("acllar_cal_ir"); if (x) { lsSet("acllar_cal_ir", null); const d = new Date(x); if (!isNaN(d)) return d0(d); } return d0(new Date()); });
    const [ocultos, setOcultos] = useState(() => { try { return new Set(JSON.parse(lsGet("acllar_cal_ocultos") || "[]")); } catch (e) { return new Set(); } });
    const [verAnuladas, setVerAnuladas] = useState(false);
    const [citas, setCitas] = useState([]); const [entregas, setEntregas] = useState([]); const [cargando, setCargando] = useState(true); const [err, setErr] = useState("");
    const [q, setQ] = useState(""); const [busq, setBusq] = useState(null);
    const [editor, setEditor] = useState(null); const [abierta, setAbierta] = useState(null); const [fichaId, setFichaId] = useState(null);
    const [colocar, setColocar] = useState(null);       // cita a colocar que viene de un caso o una garantía
    const [aviso, setAviso] = useState("");
    useEffect(() => { if (!aviso || /No se pudo/.test(aviso)) return; const t = setTimeout(() => setAviso(""), 5000); return () => clearTimeout(t); }, [aviso]);
    useEffect(() => { lsSet("acllar_cal_vista", vista); }, [vista]);
    useEffect(() => { lsSet("acllar_cal_ocultos", JSON.stringify([...ocultos])); }, [ocultos]);
    // Viene de un caso o de una garantía: «Dar cita en el calendario»
    const leerColocar = async () => { const x = lsGet("acllar_cal_colocar"); if (!x) return; lsSet("acllar_cal_colocar", null);
      try { const o = JSON.parse(x); let cli = null, txt = "";
        if (o.garantia_id) { const g = await sb().from("garantias").select("id,numero,cliente_id,caso_id,vehiculo,cita_at").eq("id", o.garantia_id).maybeSingle(); if (g.data) { o.caso_id = g.data.caso_id; o.vehiculo = g.data.vehiculo; o.cliente_id = g.data.cliente_id; txt = "Garantía " + g.data.numero; if (g.data.cita_at) setFecha(d0(new Date(g.data.cita_at))); } }
        else if (o.caso_id) { const k = await sb().from("crm_casos").select("id,cliente_id,vehiculo,tipo,cita_at").eq("id", o.caso_id).maybeSingle(); if (k.data) { o.cliente_id = k.data.cliente_id; o.vehiculo = k.data.vehiculo ? { modelo: k.data.vehiculo } : null; txt = "Caso · " + lblTipos(k.data.tipo); if (k.data.cita_at) setFecha(d0(new Date(k.data.cita_at))); } }
        if (o.cliente_id) { const c = await sb().from("crm_clientes").select("*").eq("id", o.cliente_id).maybeSingle(); cli = c.data; }
        setColocar({ ...o, cliente: cli, txt }); if (vista === "mes" || vista === "agenda") setVista("semana"); } catch (e) {} };
    useEffect(() => { leerColocar(); const f = (e) => { if (e && e.detail === "calendario") { leerColocar(); const x = lsGet("acllar_cal_ir"); if (x) { lsSet("acllar_cal_ir", null); const d = new Date(x); if (!isNaN(d)) setFecha(d0(d)); } } };
      window.addEventListener("acllar-taller-tab", f); return () => window.removeEventListener("acllar-taller-tab", f); }, []);
    // Rango visible
    const rango = () => {
      if (vista === "dia") return [d0(fecha), addD(d0(fecha), 1)];
      if (vista === "semana") return [lunes(fecha), addD(lunes(fecha), 7)];
      if (vista === "mes") { const a = lunes(new Date(fecha.getFullYear(), fecha.getMonth(), 1)); return [a, addD(a, 42)]; }
      return [d0(fecha), addD(d0(fecha), 60)];
    };
    const completar = async (xs) => {
      const ids = (k) => [...new Set(xs.map((x) => x[k]).filter(Boolean))];
      const [cl, ca, ga] = await Promise.all([
        ids("cliente_id").length ? sb().from("crm_clientes").select("id,nombre,apellidos,telefono,email,ciudad,vehiculos,bc_no").in("id", ids("cliente_id")) : { data: [] },
        ids("caso_id").length ? sb().from("crm_casos").select("id,estado,tipo,consulta,vehiculo").in("id", ids("caso_id")) : { data: [] },
        ids("garantia_id").length ? sb().from("garantias").select("id,numero,estado,vehiculo").in("id", ids("garantia_id")) : { data: [] }]);
      const m = (r) => Object.fromEntries((r.data || []).map((x) => [x.id, x]));
      const C = m(cl), K = m(ca), G = m(ga);
      return xs.map((x) => ({ ...x, estado: x.estado || "programada", cliente: C[x.cliente_id] || null, caso: K[x.caso_id] || null, garantia: G[x.garantia_id] || null }));
    };
    const cargar = async () => {
      setCargando(true); setErr("");
      try {
        const [a, b] = rango();
        const r = await sb().from("citas").select("*").lt("inicio", b.toISOString()).gte("fin", a.toISOString()).order("inicio").limit(1500);
        if (r.error) throw r.error;
        const m = await sb().from("montajes").select("id,numero,vehiculo,cliente_id,fecha_entrega,estado").gte("fecha_entrega", keyD(a)).lt("fecha_entrega", keyD(b)).not("estado", "in", "(entregado,cancelado)").limit(200);
        const ents = m.data || [];
        const cids = [...new Set(ents.map((x) => x.cliente_id).filter(Boolean))];
        const cl = cids.length ? await sb().from("crm_clientes").select("id,nombre,apellidos").in("id", cids) : { data: [] };
        setEntregas(ents.map((x) => ({ ...x, cliente: (cl.data || []).find((y) => y.id === x.cliente_id) || null })));
        setCitas(await completar(r.data || []));
      } catch (e) { setErr("No se pudo cargar el calendario: " + (e.message || e)); }
      setCargando(false);
    };
    useEffect(() => { cargar(); }, [vista, keyD(fecha)]);
    useEffect(() => { const t = setInterval(() => { if (!editor && !document.hidden) cargar(); }, 60000); return () => clearInterval(t); }, [vista, keyD(fecha), !!editor]);
    // Buscador (en todas las citas del último medio año y el próximo)
    useEffect(() => { let vivo = true; const s = qSafe(q).toLowerCase(); if (s.length < 2) { setBusq(null); return; }
      const t = setTimeout(async () => { const a = addD(new Date(), -180), b = addD(new Date(), 365);
        const r = await sb().from("citas").select("*").gte("inicio", a.toISOString()).lt("inicio", b.toISOString()).order("inicio").limit(2000);
        const xs = await completar(r.data || []); if (!vivo) return;
        const n = (x) => String(x || "").toLowerCase(); const sm = normMat(s).toLowerCase();
        setBusq(xs.filter((c) => [nombreCli(c.cliente), c.cliente && c.cliente.telefono, c.titulo, c.notas, vehCita(c), c.vehiculo && asVeh(c.vehiculo).bastidor, c.garantia && c.garantia.numero, c.mecanico, tipoL(c.tipo)[1]].some((x) => n(x).includes(s) || (sm.length >= 4 && normMat(x).toLowerCase().includes(sm))))); }, 300);
      return () => { vivo = false; clearTimeout(t); }; }, [q]);
    // Atajos de teclado (como Google): t hoy · d día · s semana · m mes · a agenda · ← →
    const mover = (n) => setFecha((f) => vista === "dia" ? addD(f, n) : vista === "semana" ? addD(f, 7 * n) : vista === "mes" ? new Date(f.getFullYear(), f.getMonth() + n, 1) : addD(f, 30 * n));
    useEffect(() => { const f = (e) => { const tg = e.target && e.target.tagName; if (/INPUT|TEXTAREA|SELECT/.test(tg) || e.ctrlKey || e.metaKey || e.altKey || editor || abierta) return;
        const k = e.key.toLowerCase(); if (k === "t") setFecha(d0(new Date())); else if (k === "d") setVista("dia"); else if (k === "s" || k === "w") setVista("semana"); else if (k === "m") setVista("mes"); else if (k === "a") setVista("agenda");
        else if (e.key === "ArrowLeft") mover(-1); else if (e.key === "ArrowRight") mover(1); else if (k === "c" || k === "n") nueva(); else return; e.preventDefault(); };
      window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f); }, [vista, editor, abierta, colocar]);
    // Filtros
    const visible = (c) => (verAnuladas || c.estado !== "anulada") && !ocultos.has(c.mecanico || "__sin");
    const vis = citas.filter(visible);
    const togMec = (k) => setOcultos((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
    // Acciones
    const base = (ini, fin, extra) => ({ inicio: ini.toISOString(), fin: fin.toISOString(), tipo: colocar && colocar.garantia_id ? "garantia" : "taller", ...(colocar ? { cliente: colocar.cliente, caso_id: colocar.caso_id, garantia_id: colocar.garantia_id, vehiculo: colocar.vehiculo } : {}), ...(extra || {}) });
    const nueva = (dia, m0, m1, extra) => { const d = dia || (vista === "dia" ? fecha : laborable(new Date()) ? new Date() : fecha); const a = m0 != null ? m0 : 8 * 60; setEditor(base(conMin(d, a), conMin(d, m1 != null ? m1 : a + DUR_DEF), extra)); };
    const guardarRapido = async (c, patch, txt) => {
      const antes = citas; setCitas((xs) => xs.map((x) => (x.id === c.id ? { ...x, ...patch } : x)));
      const r = await sb().from("citas").update(patch).eq("id", c.id);
      if (r.error) { setCitas(antes); setAviso("No se pudo mover: " + r.error.message); } else { setAviso(txt); cargar(); }
    };
    const onMover = (c, col, m) => { const dur = new Date(c.fin) - new Date(c.inicio); const ini = conMin(col.dia, Math.max(0, m)); const patch = { inicio: ini.toISOString(), fin: new Date(+ini + dur).toISOString() };
      if (col.mec !== undefined) patch.mecanico = col.mec; guardarRapido(c, patch, `Cita movida a ${fCorta(ini)} ${hm(ini)}${col.mec !== undefined ? " · " + (col.mec || "sin mecánico") : ""}.`); };
    const onEstirar = (c, m1) => { const ini = new Date(c.inicio); const fin = conMin(ini, m1); guardarRapido(c, { fin: fin.toISOString() }, `Cita hasta las ${hm(fin)}.`); };
    const onMoverDia = (id, dia) => { const c = citas.find((x) => x.id === id); if (!c) return; const i = new Date(c.inicio); if (mismo(i, dia)) return; const dur = new Date(c.fin) - i; const ini = conMin(dia, minDe(i));
      guardarRapido(c, { inicio: ini.toISOString(), fin: new Date(+ini + dur).toISOString() }, `Cita movida al ${fCorta(ini)}.`); };
    const abrirEntrega = (m) => irA("montajes", { acllar_montaje_abrir: m.id });
    // Columnas
    const mecsVis = [...MECANICOS.map((m) => m[0]), null].filter((m) => !ocultos.has(m || "__sin"));
    let cols = [], colDe = () => -1, colEnt = () => -1;
    if (vista === "dia") { cols = mecsVis.map((m) => ({ dia: fecha, mec: m, label: m || "Sin asignar", color: m ? colorMec(m) : SIN_MEC }));
      colDe = (c) => mismo(new Date(c.inicio), fecha) ? cols.findIndex((x) => x.mec === (c.mecanico || null)) : -1; colEnt = (m) => (m.fecha_entrega === keyD(fecha) ? cols.length - 1 : -1); }
    if (vista === "semana") { const l = lunes(fecha); const dias = Array.from({ length: 7 }, (_, i) => addD(l, i)).filter((d, i) => i < 5 || vis.some((c) => mismo(new Date(c.inicio), d)));
      cols = dias.map((d) => ({ dia: d, label: `${DIAS_C[d.getDay()]} ${d.getDate()}` })); colDe = (c) => cols.findIndex((x) => mismo(x.dia, new Date(c.inicio))); colEnt = (m) => cols.findIndex((x) => keyD(x.dia) === m.fecha_entrega); }
    const titulo = vista === "dia" ? `${DIAS[fecha.getDay()]} ${fecha.getDate()} de ${MESES[fecha.getMonth()]} de ${fecha.getFullYear()}`
      : vista === "semana" ? (() => { const a = lunes(fecha), b = addD(a, 6); return a.getMonth() === b.getMonth() ? `${a.getDate()} – ${b.getDate()} de ${MESES[a.getMonth()]} ${a.getFullYear()}` : `${a.getDate()} ${MESES[a.getMonth()].slice(0, 3)} – ${b.getDate()} ${MESES[b.getMonth()].slice(0, 3)} ${b.getFullYear()}`; })()
      : vista === "mes" ? `${MESES[fecha.getMonth()]} ${fecha.getFullYear()}` : `Desde el ${fecha.getDate()} de ${MESES[fecha.getMonth()]}`;
    const marcados = useMemo(() => new Set(citas.filter((c) => c.estado === "programada").map((c) => keyD(new Date(c.inicio)))), [citas]);
    // Resumen del día (vista día): cuántas citas tiene cada mecánico
    const cuenta = (m) => vis.filter((c) => mismo(new Date(c.inicio), fecha) && (c.mecanico || null) === m && c.estado === "programada").length;
    const B = (on) => ({ ...btn(T, on ? "p" : "s"), padding: "6px 12px", fontSize: "13px" });
    return h("div", { "data-cal": "1", style: { fontFamily: F.body, color: T.ink } },
      // barra superior
      h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginBottom: "12px" } },
        h("button", { "data-cal-hoy": "1", onClick: () => setFecha(d0(new Date())), style: B(false) }, "Hoy"),
        h("button", { "aria-label": "Anterior", "data-cal-prev": "1", onClick: () => mover(-1), style: { ...B(false), padding: "6px 10px" } }, "‹"),
        h("button", { "aria-label": "Siguiente", "data-cal-next": "1", onClick: () => mover(1), style: { ...B(false), padding: "6px 10px" } }, "›"),
        h("div", { "data-cal-titulo": "1", style: { fontFamily: F.display, fontSize: "20px", fontWeight: 800, marginRight: "auto", marginLeft: "6px" } }, titulo.charAt(0).toUpperCase() + titulo.slice(1), cargando ? h("span", { style: { fontSize: "12px", color: T.inkSoft, fontWeight: 600, marginLeft: "8px", textTransform: "none" } }, "cargando…") : null),
        h("input", { type: "search", "data-cal-buscar": "1", "aria-label": "Buscar citas", value: q, onChange: (e) => setQ(e.target.value), placeholder: "Buscar cliente, matrícula, nº…", style: { ...inp(T), width: "220px", padding: "7px 10px" } }),
        h("div", { style: { display: "flex", gap: "2px", background: T.bg, borderRadius: "10px", padding: "3px" } },
          [["dia", "Día"], ["semana", "Semana"], ["mes", "Mes"], ["agenda", "Agenda"]].map(([k, l]) => h("button", { key: k, "data-cal-vista": k, onClick: () => setVista(k), style: { border: "none", borderRadius: "8px", padding: "6px 12px", cursor: "pointer", fontSize: "13px", fontWeight: 800, background: vista === k ? T.surface : "transparent", color: vista === k ? T.ink : T.inkSoft, boxShadow: vista === k ? "0 1px 3px rgba(15,27,46,.15)" : "none" } }, l))),
        h("button", { "data-cal-nueva": "1", onClick: () => nueva(), style: { ...btn(T, "p"), padding: "7px 14px" } }, "+ Nueva cita")),
      colocar ? h("div", { "data-cal-colocar": "1", style: { display: "flex", gap: "10px", alignItems: "center", justifyContent: "space-between", background: "#EEF2FF", border: `1px solid ${T.rust}`, borderRadius: "10px", padding: "9px 12px", marginBottom: "10px", fontSize: "13.5px" } },
        h("span", null, "📅 Dando cita a ", h("b", null, colocar.cliente ? nombreCli(colocar.cliente) : "—"), colocar.txt ? ` (${colocar.txt})` : "", ": arrastra sobre el hueco del calendario o pulsa «+ Nueva cita»."),
        h("button", { onClick: () => setColocar(null), style: { ...btn(T, "s"), padding: "3px 10px", fontSize: "12px" } }, "Cancelar")) : null,
      aviso ? h("div", { "data-cal-aviso": "1", onClick: () => setAviso(""), style: { position: "fixed", left: "50%", bottom: "24px", transform: "translateX(-50%)", zIndex: 1300, fontSize: "13.5px", fontWeight: 700, color: "#fff", background: /No se pudo/.test(aviso) ? "#B91C1C" : "#0F1B2E", borderRadius: "10px", padding: "10px 16px", boxShadow: "0 8px 24px rgba(15,27,46,.3)", cursor: "pointer" } }, aviso) : null,
      err ? h("div", { style: { color: T.danger, fontSize: "13px", marginBottom: "8px" } }, err) : null,
      h("div", { style: { display: "grid", gridTemplateColumns: "210px 1fr", gap: "16px", alignItems: "start" } },
        // lateral: mini calendario y mecánicos
        h("div", { style: { display: "flex", flexDirection: "column", gap: "16px", position: "sticky", top: "60px" } },
          h("div", { style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: "12px", padding: "10px" } }, h(MiniMes, { T, fecha, marcados, onElegir: (d) => { setFecha(d0(d)); setQ(""); } })),
          h("div", { style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: "12px", padding: "10px" } }, h(Lbl, { T }, "Mecánicos"),
            [...MECANICOS, [null, SIN_MEC]].map(([m, c]) => { const k = m || "__sin"; const on = !ocultos.has(k);
              return h("label", { key: k, "data-cal-filtro": m || "Sin asignar", style: { display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", padding: "3px 0", cursor: "pointer" } },
                h("input", { type: "checkbox", checked: on, onChange: () => togMec(k), style: { accentColor: c, width: "16px", height: "16px" } }),
                h("span", { style: { width: "12px", height: "12px", borderRadius: "3px", background: c } }), h("span", { style: { flex: 1 } }, m || "Sin asignar"),
                vista === "dia" ? h("span", { style: { fontSize: "11.5px", color: T.inkSoft } }, cuenta(m) || "") : null); }),
            h("label", { style: { display: "flex", alignItems: "center", gap: "8px", fontSize: "12.5px", paddingTop: "8px", marginTop: "6px", borderTop: `1px solid ${T.border}`, color: T.inkSoft } }, h("input", { type: "checkbox", "data-cal-anuladas": "1", checked: verAnuladas, onChange: (e) => setVerAnuladas(e.target.checked) }), "Ver citas anuladas")),
          h("div", { style: { fontSize: "11.5px", color: T.inkSoft, lineHeight: 1.5 } }, "Arrastra en un hueco para crear una cita; arrastra una cita para moverla y su borde inferior para cambiar la duración. Teclas: T hoy · D día · S semana · M mes · A agenda · ← →")),
        // vista
        h("div", { style: { minWidth: 0 } },
          busq ? h("div", null, h("div", { style: { fontSize: "13px", color: T.inkSoft, marginBottom: "8px" } }, `${busq.length} cita${busq.length === 1 ? "" : "s"} encontrada${busq.length === 1 ? "" : "s"} para «${q}» `, h("button", { onClick: () => setQ(""), style: { ...btn(T, "s"), padding: "2px 9px", fontSize: "12px" } }, "Quitar búsqueda")),
              h(VistaAgenda, { T, citas: busq, entregas: [], onAbrir: setAbierta, onEntrega: abrirEntrega, vacio: "Ninguna cita coincide con la búsqueda." }))
          : vista === "mes" ? h(VistaMes, { T, fecha, citas: vis, entregas, onDia: (d) => { setFecha(d0(d)); setVista("dia"); }, onAbrir: setAbierta, onNueva: (d) => nueva(d), onMoverDia, onEntrega: abrirEntrega })
          : vista === "agenda" ? h(VistaAgenda, { T, citas: vis.filter((c) => new Date(c.fin) >= d0(fecha)), entregas, onAbrir: setAbierta, onEntrega: abrirEntrega, vacio: "No hay citas en los próximos 60 días." })
          : h("div", { style: { border: `1px solid ${T.border}`, borderRadius: "12px", overflow: "hidden", background: T.surface } },
              h("div", { style: { display: "grid", gridTemplateColumns: `${GUT}px repeat(${cols.length}, 1fr)`, borderBottom: `1px solid ${T.border}`, position: "sticky", top: 0, background: T.surface, zIndex: 8 } },
                h("div"),
                cols.map((c, i) => vista === "dia"
                  ? h("div", { key: i, "data-cal-colhead": c.label, style: { padding: "8px 6px", textAlign: "center", borderLeft: `1px solid ${T.border}`, fontSize: "13px", fontWeight: 800, color: c.color, borderBottom: `3px solid ${c.color}` } }, c.label)
                  : h("button", { key: i, onClick: () => { setFecha(d0(c.dia)); setVista("dia"); }, title: "Ver el día por mecánico", style: { padding: "6px", textAlign: "center", border: "none", borderLeft: `1px solid ${T.border}`, background: "transparent", cursor: "pointer", fontFamily: "inherit" } },
                      h("div", { style: { fontSize: "11px", fontWeight: 800, color: mismo(c.dia, new Date()) ? T.rust : T.inkSoft, textTransform: "uppercase" } }, DIAS_C[c.dia.getDay()]),
                      h("div", { style: { fontSize: "20px", fontWeight: 800, color: mismo(c.dia, new Date()) ? T.rust : T.ink } }, c.dia.getDate())))),
              h(FilaTodoDia, { T, cols, citas: vis, entregas, colDe, colEntrega: colEnt, onAbrir: setAbierta, onEntrega: abrirEntrega }),
              h("div", { "data-cal-scroll": "1", style: { maxHeight: "calc(100vh - 230px)", minHeight: "420px", overflowY: "auto" } },
                h(Cuadricula, { T, cols, citas: vis, colDe, onAbrir: setAbierta, onMover, onEstirar, onCrear: (col, m0, m1) => nueva(col.dia, m0, m1, col.mec !== undefined ? { mecanico: col.mec } : undefined) }))))),
      editor ? h(Editor, { T, F, inicial: editor, onClose: () => setEditor(null), onSaved: (c) => { setEditor(null); setColocar(null); setAviso(editor.id ? "Cita guardada." : `Cita creada: ${fCorta(new Date(c.inicio))} ${c.todo_dia ? "" : hm(new Date(c.inicio))}.`); setFecha(d0(new Date(c.inicio))); cargar(); } }) : null,
      abierta ? h(Detalle, { T, F, cita: citas.find((x) => x.id === abierta.id) || (busq || []).find((x) => x.id === abierta.id) || abierta, onClose: () => setAbierta(null), onCambiado: cargar, onCliente: (id) => setFichaId(id),
        onEditar: () => { const c = citas.find((x) => x.id === abierta.id) || abierta; setAbierta(null); setEditor({ ...c }); },
        onDuplicar: () => { const c = citas.find((x) => x.id === abierta.id) || abierta; setAbierta(null); const dur = new Date(c.fin) - new Date(c.inicio); const ini = addD(new Date(c.inicio), 7);
          setEditor({ ...c, id: undefined, estado: undefined, aviso_cliente_at: undefined, inicio: ini.toISOString(), fin: new Date(+ini + dur).toISOString() }); } }) : null,
      fichaId && window.AcllarGarantias && window.AcllarGarantias.FichaCliente ? h(window.AcllarGarantias.FichaCliente, { T, F, id: fichaId, onClose: () => setFichaId(null), onChanged: cargar }) : null);
  }

  window.AcllarCalendario = Calendario;
  window.AcllarCalendario._test = { carriles, enHorario, msgRecordatorio, MECANICOS, colorMec };
})();
