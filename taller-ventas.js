// taller-ventas.js  ---  TALLER → Ventas en la visita
// Lo que se vende de más cuando el cliente ya está en el taller:
//   pactado  = importe (IVA incl.) del pedido de servicio — o de la oferta — a primera hora del día de la cita (foto automática; corregible en el caso)
//   final    = factura de servicio de BC (o el pedido actual si aún no se ha facturado: provisional)
//   vendido de más = final − pactado
// Lo añadido se registra igualmente en el pedido de servicio de BC; aquí solo se mide. Los «qué se añadió» son opcionales (recuadro del caso).
// Solo lectura: para cambiar algo se abre el caso. Usa las piezas de taller-crm.js (window.AcllarCRM._ui).
(function () {
  if (!window.React || !window.AcllarCRM || !window.AcllarCRM._ui) return;
  const U = window.AcllarCRM._ui;
  const { h, Chip, btn, Box, Lbl, sb, nombreCli, irA, eur, fFecha, pad } = U;
  const { useState, useEffect, useMemo } = React;
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const r2 = (n) => Math.round(n * 100) / 100;
  const pct = (a, b) => (b > 0 ? `${a >= 0 ? "+" : ""}${Math.round((a / b) * 1000) / 10} %` : "—");
  const clave = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  function Ventas({ T, F }) {
    const [mes, setMes] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
    const [datos, setDatos] = useState(null);
    const [err, setErr] = useState("");
    const cargar = async () => {
      setErr("");
      const c = await sb().from("crm_casos").select("id, estado, archivado, responsable, vehiculo, cita_at, oferta_bc, pedido_bc, factura_bc, importe_pactado, pactado_at, pactado_origen, vendido_items, cliente:crm_clientes(*)")
        .eq("archivado", false).or("pedido_bc.not.is.null,oferta_bc.not.is.null,factura_bc.not.is.null,importe_pactado.not.is.null").limit(5000);
      if (c.error) { setErr(c.error.message); setDatos([]); return; }
      const casos = c.data || [];
      const docs = [...new Set(casos.flatMap((k) => [k.oferta_bc, k.pedido_bc]).filter(Boolean))];
      const facs = [...new Set(casos.map((k) => k.factura_bc).filter(Boolean))];
      const serv = [], fac = [];
      for (let i = 0; i < docs.length; i += 200) { const r = await sb().from("bc_servicio").select("tipo,no,importe_iva,activo").in("no", docs.slice(i, i + 200)); serv.push(...(r.data || [])); }
      for (let i = 0; i < facs.length; i += 200) { const r = await sb().from("bc_facturas_servicio").select("no,fecha,importe_iva,cobrada,pendiente").in("no", facs.slice(i, i + 200)); fac.push(...(r.data || [])); }
      const sv = (tipo, no) => serv.find((x) => x.tipo === tipo && x.no === no);
      setDatos(casos.map((k) => {
        const f = k.factura_bc ? fac.find((x) => x.no === k.factura_bc) : null;
        const ped = k.pedido_bc ? sv("pedido", k.pedido_bc) : null, of = k.oferta_bc ? sv("oferta", k.oferta_bc) : null;
        const final = f ? Number(f.importe_iva) : ped && ped.importe_iva != null ? Number(ped.importe_iva) : of && of.importe_iva != null ? Number(of.importe_iva) : null;
        const pact = k.importe_pactado != null ? Number(k.importe_pactado) : null;
        const items = Array.isArray(k.vendido_items) ? k.vendido_items : [];
        const fecha = f && f.fecha ? f.fecha : k.cita_at ? ymd(new Date(k.cita_at)) : k.pactado_at ? ymd(new Date(k.pactado_at)) : null;
        return { k, f, final, pact, dif: final != null && pact != null ? r2(final - pact) : null, items, fecha, provisional: !f };
      }).filter((x) => x.fecha && (x.pact != null || x.f || x.items.length)));
    };
    useEffect(() => { cargar(); }, []);

    const desde = ymd(mes), hasta = ymd(new Date(mes.getFullYear(), mes.getMonth() + 1, 0));
    const delMes = useMemo(() => (datos || []).filter((x) => x.fecha >= desde && x.fecha <= hasta).sort((a, b) => (b.dif ?? -1e9) - (a.dif ?? -1e9) || (a.fecha < b.fecha ? 1 : -1)), [datos, desde]);
    const medidos = delMes.filter((x) => x.dif != null);
    const sum = (arr, f) => r2(arr.reduce((s, x) => s + (f(x) || 0), 0));
    const tot = { casos: medidos.length, pactado: sum(medidos, (x) => x.pact), final: sum(medidos, (x) => x.final), mas: sum(medidos, (x) => x.dif), conVenta: medidos.filter((x) => x.dif > 0).length };
    const facturados = medidos.filter((x) => !x.provisional);
    const ranking = useMemo(() => {
      const m = new Map();
      delMes.forEach((x) => x.items.forEach((it) => { const c = clave(it.descripcion); if (!c) return; const p = m.get(c) || { descripcion: it.descripcion, veces: 0, importe: 0 }; p.veces++; p.importe += Number(it.importe) || 0; m.set(c, p); }));
      return [...m.values()].sort((a, b) => b.importe - a.importe || b.veces - a.veces);
    }, [delMes]);

    const kpi = (titulo, valor, sub, color) => h("div", { style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: "12px", padding: "14px 16px" } },
      h("div", { style: { fontSize: "11px", letterSpacing: ".08em", textTransform: "uppercase", color: T.inkSoft, fontWeight: 800 } }, titulo),
      h("div", { style: { fontSize: "24px", fontWeight: 800, marginTop: "4px", color: color || T.ink, fontFamily: F && F.display } }, valor),
      sub ? h("div", { style: { fontSize: "12px", color: T.inkSoft, marginTop: "2px" } }, sub) : null);
    const th = { textAlign: "left", fontSize: "11px", letterSpacing: ".06em", textTransform: "uppercase", color: T.inkSoft, fontWeight: 800, padding: "8px 10px", borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap" };
    const td = { padding: "9px 10px", borderBottom: `1px solid ${T.border}`, fontSize: "13.5px", verticalAlign: "top" };
    const num = { ...td, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
    const veh = (v) => (v && typeof v === "object" ? [v.modelo, v.matricula].filter(Boolean).join(" · ") : v || "");

    return h("div", { "data-ventas": "1" },
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap", marginBottom: "16px" } },
        h("div", null,
          h("h2", { style: { margin: 0, fontSize: "22px", fontFamily: F && F.display } }, "Ventas en la visita"),
          h("div", { style: { fontSize: "13px", color: T.inkSoft, marginTop: "2px" } }, "Lo que se vende de más con el cliente en el taller: pactado antes de la visita frente a lo facturado.")),
        h("div", { style: { display: "flex", alignItems: "center", gap: "6px" } },
          h("button", { "data-ventas-prev": "1", onClick: () => setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1)), style: btn(T, "s") }, "‹"),
          h("div", { "data-ventas-mes": "1", style: { minWidth: "150px", textAlign: "center", fontWeight: 800, fontSize: "15px" } }, `${MESES[mes.getMonth()][0].toUpperCase()}${MESES[mes.getMonth()].slice(1)} ${mes.getFullYear()}`),
          h("button", { "data-ventas-next": "1", onClick: () => setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1)), style: btn(T, "s") }, "›"),
          h("button", { onClick: () => { setDatos(null); cargar(); }, style: { ...btn(T, "s"), marginLeft: "6px" } }, "Actualizar"))),
      err ? h("div", { style: { color: T.danger, marginBottom: "10px" } }, "No se pudo cargar: " + err) : null,
      datos == null ? h("div", { style: { color: T.inkSoft, padding: "30px 0" } }, "Cargando…") : h(React.Fragment, null,
        h("div", { "data-ventas-kpis": "1", style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "10px", marginBottom: "16px" } },
          kpi("Casos medidos", String(tot.casos), `${tot.conVenta} con venta añadida${facturados.length !== tot.casos ? ` · ${tot.casos - facturados.length} aún sin facturar` : ""}`),
          kpi("Pactado", eur(tot.pactado), "antes de la visita, IVA incl."),
          kpi("Facturado", eur(tot.final), facturados.length !== tot.casos ? "incluye pedidos aún sin facturar" : "IVA incl."),
          kpi("Vendido de más", `${tot.mas > 0 ? "+" : ""}${eur(tot.mas)}`, null, tot.mas > 0 ? "#166534" : tot.mas < 0 ? "#92400E" : null),
          kpi("Aumento", pct(tot.mas, tot.pactado), "sobre lo pactado", tot.mas > 0 ? "#166534" : null)),
        h(Box, { T }, h(Lbl, { T }, `Casos del mes (${delMes.length})`),
          delMes.length ? h("div", { style: { overflowX: "auto" } }, h("table", { style: { width: "100%", borderCollapse: "collapse" } },
            h("thead", null, h("tr", null, ["Fecha", "Cliente", "Documento", "Pactado", "Final", "De más", "Qué se añadió"].map((t, i) => h("th", { key: t, style: { ...th, textAlign: i >= 3 && i <= 5 ? "right" : "left" } }, t)))),
            h("tbody", null, delMes.map((x) => h("tr", { key: x.k.id, "data-ventas-caso": x.k.id, className: "acl-fila", onClick: () => irA("clientes", { acllar_crm_abrir_caso: x.k.id }), style: { cursor: "pointer" }, title: "Abrir el caso" },
              h("td", { style: { ...td, whiteSpace: "nowrap" } }, fFecha(x.fecha)),
              h("td", { style: td }, h("div", { style: { fontWeight: 700 } }, nombreCli(x.k.cliente) || "—"), veh(x.k.vehiculo) ? h("div", { style: { fontSize: "12px", color: T.inkSoft } }, veh(x.k.vehiculo)) : null),
              h("td", { style: { ...td, fontFamily: "'JetBrains Mono', monospace", fontSize: "12.5px", whiteSpace: "nowrap" } }, x.f ? x.f.no : x.k.pedido_bc || x.k.oferta_bc || "—", x.provisional && x.final != null ? h("div", null, h(Chip, { c: "ambar" }, "sin facturar")) : null),
              h("td", { style: num }, x.pact != null ? eur(x.pact) : h(Chip, { c: "gris", title: "Ábrelo y escribe lo pactado en el recuadro «Vendido en la visita»" }, "falta")),
              h("td", { style: num }, x.final != null ? eur(x.final) : "—"),
              h("td", { "data-ventas-dif": x.dif == null ? "" : String(x.dif), style: { ...num, fontWeight: 800, color: x.dif > 0 ? "#166534" : x.dif < 0 ? "#92400E" : T.inkSoft } }, x.dif == null ? "—" : `${x.dif > 0 ? "+" : ""}${eur(x.dif)}`, x.dif != null && x.pact > 0 && x.dif !== 0 ? h("div", { style: { fontSize: "11.5px", fontWeight: 600 } }, pct(x.dif, x.pact)) : null),
              h("td", { style: { ...td, fontSize: "12.5px" } }, x.items.length ? x.items.map((it, i) => h("div", { key: i }, `${it.descripcion}${it.importe != null ? " · " + eur(it.importe) : ""}`)) : h("span", { style: { color: T.inkSoft } }, "—"))))))
          ) : h("div", { style: { color: T.inkSoft, fontSize: "13.5px", padding: "10px 0" } }, "Aún no hay visitas medidas este mes. Lo pactado se guarda solo el día de cada cita; lo facturado llega de BC al registrar el pedido.")),
        h("div", { style: { height: "14px" } }),
        h(Box, { T }, h(Lbl, { T }, "Lo que más se añade"),
          ranking.length ? h("table", { "data-ventas-ranking": "1", style: { width: "100%", borderCollapse: "collapse" } },
            h("thead", null, h("tr", null, h("th", { style: th }, "Producto o trabajo"), h("th", { style: { ...th, textAlign: "right" } }, "Veces"), h("th", { style: { ...th, textAlign: "right" } }, "Importe"))),
            h("tbody", null, ranking.map((r, i) => h("tr", { key: i }, h("td", { style: td }, r.descripcion), h("td", { style: num }, String(r.veces)), h("td", { style: num }, r.importe ? eur(r.importe) : "—")))))
            : h("div", { style: { color: T.inkSoft, fontSize: "13.5px" } }, "Se rellena con lo que apuntes en «Qué se añadió» dentro de cada caso (opcional)."))));
  }
  window.AcllarVentas = Ventas;
})();
