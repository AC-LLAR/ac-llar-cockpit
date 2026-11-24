// taller-leer-doc.js  ---  Leer de una foto del permiso de circulación o de la ficha técnica:
// titular (nombre y apellidos), matrícula, bastidor y modelo. Gratis: el texto lo lee en el propio navegador
// un lector de texto (Tesseract, se descarga la primera vez); la foto no sale del ordenador.
// Prueba las cuatro orientaciones (fotos del revés o giradas) y se queda con la que mejor se lee.
// Nunca rellena nada sin que el usuario lo revise.
(function () {
  if (!window.React || !window.AcllarCRM || !window.AcllarCRM._ui) return;
  const U = window.AcllarCRM._ui;
  const { h, btn, inp } = U;
  const { useState, useRef } = React;

  // ---------------- interpretar el texto leído ----------------
  const WMI = ["WF0", "ZFA", "ZFC", "VF7", "VF3", "VF1", "WDB", "WDF", "W1V", "W1W", "WMA", "ZCF", "WV1", "WV2", "VNV", "VR7", "VR3", "NM0", "SAL", "VSS", "VS6", "TMB", "WAU", "WBA", "VF6", "UU1", "ZAR"];
  const MARCAS = ["BENIMAR", "ROLLER TEAM", "PILOTE", "HYMER", "DETHLEFFS", "ADRIA", "CHAUSSON", "CHALLENGER", "MCLOUIS", "MC LOUIS", "MOBILVETTA", "KNAUS", "WEINSBERG", "BURSTNER", "BÜRSTNER", "CARADO", "SUNLIGHT", "LAIKA", "RAPIDO", "FONT VENDOME", "GIOTTI", "GIOTTILINE", "ELNAGH", "FRANKIA", "CARTHAGO", "LMC", "HOBBY", "ETRUSCO", "PÖSSL", "POSSL", "WESTFALIA", "BAVARIA", "AUTOSTAR", "ITINEO", "AHORN", "BLUCAMP", "WINGAMM", "EURA MOBIL", "FLEURETTE", "LE VOYAGEUR", "NIESMANN", "MALIBU", "CARAVANS INTERNATIONAL", "FORD", "FIAT", "CITROEN", "CITROËN", "PEUGEOT", "MERCEDES-BENZ", "MERCEDES", "IVECO", "RENAULT", "VOLKSWAGEN", "MAN", "NISSAN", "OPEL", "TOYOTA"];
  const NO_MODELO = /^(PARTICULAR|VIVIENDA|OBSERVACIONES|DOCUMENTO|DIESEL|GASOLINA|GASÓLEO|ELECTRICO|ELÉCTRICO|PRÓXIMA|PROXIMA|ITV|M1|N1|AUTOCARAVANA|SERVICIO)/;
  const lim = (s) => String(s || "").replace(/[|\[\]{}“”"«»¿¡_]+/g, " ").replace(/\s+/g, " ").trim();
  const soloNombre = (s) => lim(s).replace(/[^A-ZÁÉÍÓÚÜÑÇ' .,-]/gi, " ").replace(/\s+/g, " ").replace(/^[^A-ZÁÉÍÓÚÜÑÇ]+/i, "").replace(/[\s.,-]+$/, "").trim();
  const MAT_NUEVA = /\b(\d{4})\s?-?\s?([BCDFGHJKLMNPRSTVWXYZ]{3})\b/;
  const MAT_VIEJA = /\b([A-Z]{1,2})\s?-?\s?(\d{4})\s?-?\s?([A-Z]{1,2})\b/;

  function bastidorDe(texto) {
    const toks = String(texto).toUpperCase().split(/[\s|\[\](){}:;,]+/).map((t) => t.replace(/[^A-Z0-9]/g, "")).filter(Boolean);
    const cands = [];
    const prueba = (t, extra) => { if (t.length !== 17) return; const n = t.replace(/O/g, "0").replace(/[IL](?=\d)/g, "1").replace(/Q/g, "0").replace(/I/g, "1");
      if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(n)) return; const dig = (n.match(/\d/g) || []).length; if (dig < 5 || dig > 15) return;
      if (!/\d{4}$/.test(n)) return; // los bastidores europeos terminan en el nº de serie (cifras)
      cands.push({ v: n, p: (WMI.includes(n.slice(0, 3)) ? 10 : 0) + (/\d{5}$/.test(n) ? 3 : 0) + extra }); };
    toks.forEach((t, i) => { prueba(t, 0); if (t.length < 17 && toks[i + 1]) prueba(t + toks[i + 1], -2); if (t.length === 18 && /^E/.test(t)) prueba(t.slice(1), 1); });
    cands.sort((a, b) => b.p - a.p);
    return cands[0] ? cands[0].v : "";
  }
  function matriculaDe(lineas) {
    // primero la casilla A del permiso; si no, cualquier matrícula de formato actual
    for (const l of lineas) { const m = /^\W*A\W{1,3}(.+)/i.exec(l); if (m) { const x = MAT_NUEVA.exec(m[1].toUpperCase()) || MAT_VIEJA.exec(m[1].toUpperCase()); if (x) return x.slice(1).join(""); } }
    for (const l of lineas) { const x = MAT_NUEVA.exec(l.toUpperCase()); if (x) return x.slice(1).join(""); }
    return "";
  }
  // Texto que sigue a una casilla tipo «C.1.1» (o en la línea siguiente si está vacía)
  function casilla(lineas, re) {
    for (let i = 0; i < lineas.length; i++) { const m = re.exec(lineas[i]); if (!m) continue;
      let resto = lineas[i].slice(m.index + m[0].length); resto = resto.replace(/^[\s|\]\)}:.,\d]*/, "");
      if (soloNombre(resto).length >= 2) return resto;
      if (lineas[i + 1] && !/^\W*[A-Z](\.\d)+/i.test(lineas[i + 1])) return lineas[i + 1]; }
    return "";
  }
  function quitarCola(s) { // «ARQUE GARCIA 125.0» → «ARQUE GARCIA»: corta en el primer dato que no es un nombre
    let p = soloNombre(String(s).split(/\s(?=[\d(]|[A-Z]\.\d|P\.\d|S\.\d)/)[0]);
    const ws = p.split(" "); while (ws.length > 1 && (ws[ws.length - 1].length <= 2 || /[a-zß-ÿ]/.test(ws[ws.length - 1]))) ws.pop(); // restos sueltos al final («… QS», «… gee»): en el permiso todo va en mayúsculas
    return ws.join(" "); }
  function modeloDe(lineas, U) {
    // Ficha técnica: «Denominación comercial»
    for (let i = 0; i < lineas.length; i++) { const m = /DENOMINACI[OÓ0]N\s+COMERCIAL\W*(.*)/i.exec(lineas[i]); if (m) { const v = lim(m[1]) || lim(lineas[i + 1]); if (v) return { modelo: v.replace(/^\(?\d+\)?\s*/, ""), marca: marcaDe(U) }; } }
    // Permiso: casilla D.3 (modelo) y D.1 (marca)
    let d3 = casilla(lineas, /\bD\s?[.,]\s?3\b\W*/i); const d1 = casilla(lineas, /\bD\s?[.,]\s?1\b\W*/i);
    const marca = (d1 && MARCAS.find((x) => lim(d1).toUpperCase().includes(x))) || marcaDe(U);
    if (d3) return { modelo: lim(d3).replace(/\s+\S*\d+\.\d+.*$/, ""), marca };
    // Sin casillas legibles: el modelo va justo después del código de tipo (D.2, con «/») o de la marca
    const iCod = lineas.findIndex((l) => /\bD\s?[.,]\s?2\b/i.test(l) || /[A-Z0-9]{4,}\/[A-Z0-9]{4,}/i.test(l));
    const iMarca = iCod >= 0 ? iCod : lineas.findIndex((l) => marca && lim(l).toUpperCase() === marca);
    for (let i = (iMarca >= 0 ? iMarca + 1 : 0); i < Math.min(lineas.length, (iMarca >= 0 ? iMarca + 5 : 0)); i++) {
      const v = lim(lineas[i]).toUpperCase(); if (!v || /[\/*]/.test(v) || NO_MODELO.test(v) || v === marca || v.length > 40) continue;
      if (/[A-Z]/.test(v) && /\d/.test(v) && /^[A-Z0-9ÁÉÍÓÚÑ .+-]+$/.test(v)) return { modelo: v, marca };
    }
    return { modelo: "", marca };
  }
  function marcaDe(U) { return MARCAS.find((x) => new RegExp(`(^|\\W)${x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\W|$)`).test(U)) || ""; }

  // Si en otra lectura el mismo nombre aparece con letras delante (p. ej. «ARQUE» → «JARQUE»), usa la versión completa
  function afinar(r, texto) {
    const T2 = String(texto || "").toUpperCase();
    ["apellidos", "nombre"].forEach((k) => { const v = r[k]; if (!v || v.length < 3) return;
      const m = new RegExp(`(^|[^A-ZÁÉÍÓÚÜÑ])([A-ZÁÉÍÓÚÜÑ]{1,2})${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-ZÁÉÍÓÚÜÑ])`).exec(T2); if (m) r[k] = m[2] + v; });
  }
  // Si el lector no ha leído las casillas C.1.1 / C.1.2: el titular va justo después de la provincia (I.2):
  // primera línea de solo palabras = apellidos (o razón social), la siguiente = nombre
  const NO_NOMBRE = /^(DIESEL|GASOLINA|GAS[OÓ]LEO|EL[EÉ]CTRICO|H[IÍ]BRIDO|PARTICULAR|VIVIENDA|OBSERVACIONES|DOCUMENTO|PR[OÓ]XIMA|SERVICIO|AUTOCARAVANA|ITV|TITULAR|DOMICILIO|NOMBRE|APELLIDOS)\b/;
  const PROVINCIAS = ["ALAVA", "ARABA", "ALBACETE", "ALICANTE", "ALACANT", "ALMERIA", "ASTURIAS", "AVILA", "BADAJOZ", "BALEARES", "ILLES BALEARS", "BARCELONA", "BURGOS", "CACERES", "CADIZ", "CANTABRIA", "CASTELLON", "CASTELLO", "CEUTA", "CIUDAD REAL", "CORDOBA", "CUENCA", "GIRONA", "GERONA", "GRANADA", "GUADALAJARA", "GUIPUZCOA", "GIPUZKOA", "HUELVA", "HUESCA", "JAEN", "LA CORUÑA", "A CORUÑA", "LA RIOJA", "LAS PALMAS", "LEON", "LLEIDA", "LERIDA", "LUGO", "MADRID", "MALAGA", "MELILLA", "MURCIA", "NAVARRA", "OURENSE", "ORENSE", "PALENCIA", "PONTEVEDRA", "SALAMANCA", "SANTA CRUZ DE TENERIFE", "SEGOVIA", "SEVILLA", "SORIA", "TARRAGONA", "TERUEL", "TOLEDO", "VALENCIA", "VALÈNCIA", "VALLADOLID", "VIZCAYA", "BIZKAIA", "ZAMORA", "ZARAGOZA"];
  const sinAcentos = (x) => String(x).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  function titularSinCasillas(lineas) {
    let i0 = lineas.findIndex((l) => /\(?\s*[I1l]\s?[.,]\s?2\s*\)?\W/.test(l));
    if (i0 < 0) { lineas.forEach((l, i) => { if (i < lineas.length * 0.7 && /\d{2}[-/.]\d{2}[-/.]\d{4}/.test(l)) i0 = i; }); }
    if (i0 < 0) return [];
    const out = [];
    for (let i = i0 + 1; i < Math.min(lineas.length, i0 + 9) && out.length < 2; i++) {
      const v = quitarCola(lineas[i]); const U = v.toUpperCase();
      if (!v || /\d/.test(lineas[i].split(/\s(?=P\.\d|[\[(]?\d)/)[0]) || NO_NOMBRE.test(U) || MARCAS.includes(U)) continue;
      if (/\//.test(lineas[i].split(/\s(?=P\.\d|[\[(]?\d)/)[0]) || PROVINCIAS.some((p) => sinAcentos(U).split(" ").join(" ").startsWith(sinAcentos(p)))) continue; // provincia (I.2)
      const ws = U.split(" ").filter(Boolean); if (!ws.length || !ws.some((w) => w.length >= 3) || ws.some((w) => w.length > 20)) continue;
      out.push(v);
    }
    return out;
  }
  // Completa lo que falte en r con lo leído en otra pasada (r2), y afina el nombre
  function fusionar(r, r2, texto2) {
    ["apellidos", "nombre", "matricula", "bastidor", "marca", "modelo"].forEach((k) => { if (!r[k] && r2[k]) r[k] = r2[k]; });
    afinar(r, texto2);
    r.modeloCompleto = [r.marca && !String(r.modelo).toUpperCase().includes(r.marca) ? r.marca : "", r.modelo].filter(Boolean).join(" ");
    return r;
  }
  function leerDatos(texto) {
    const lineas = String(texto || "").replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
    const U = lineas.join("\n").toUpperCase();
    let apellidos = quitarCola(casilla(lineas, /C\s?[.,]\s?1\s?[.,]\s?1[1lI|\])]?(?!\d)\W*/i));
    let nombre = quitarCola(casilla(lineas, /C\s?[.,]\s?1\s?[.,]\s?2[1lI|\])]?(?!\d)\W*/i));
    if (!apellidos || !nombre) { const t = titularSinCasillas(lineas); if (!apellidos && t[0] && t[0] !== nombre) apellidos = t[0]; if (!nombre && t[1] && t[1] !== apellidos) nombre = t[1]; }
    const { modelo, marca } = modeloDe(lineas, U);
    const r = { apellidos, nombre, matricula: matriculaDe(lineas), bastidor: bastidorDe(U), marca, modelo };
    r.modeloCompleto = [r.marca && !r.modelo.toUpperCase().includes(r.marca) ? r.marca : "", r.modelo].filter(Boolean).join(" ");
    r.puntos = (r.matricula ? 3 : 0) + (r.bastidor ? 3 : 0) + (r.apellidos ? 1 : 0) + (r.nombre ? 1 : 0) + (r.modelo ? 1 : 0) + (/C\.1|ITV|OBSERVACIONES|DENOMINACI|HOMOLOGACI|PERMISO|FICHA/.test(U) ? 1 : 0);
    return r;
  }

  // ---------------- leer la imagen (Tesseract en el navegador) ----------------
  let tessP = null;
  const cargarTess = () => tessP || (tessP = new Promise((res, rej) => { if (window.Tesseract) return res(window.Tesseract);
    const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"; s.async = true;
    s.onload = () => (window.Tesseract ? res(window.Tesseract) : rej(new Error("no cargó"))); s.onerror = () => { tessP = null; rej(new Error("No se pudo descargar el lector de texto. Revisa la conexión.")); }; document.head.appendChild(s); }));
  let workerP = null;
  const worker = async () => workerP || (workerP = (async () => { const T = await cargarTess(); return T.createWorker("spa"); })().catch((e) => { workerP = null; throw e; }));
  const imagen = (file) => new Promise((res, rej) => { const u = URL.createObjectURL(file); const im = new Image(); im.onload = () => { res(im); }; im.onerror = () => rej(new Error("No se pudo abrir la imagen.")); im.src = u; });
  function lienzo(im, grados, escala) {
    const lado = Math.max(im.naturalWidth, im.naturalHeight); const MAX = 2000 * (escala || 1);
    const k = lado < 1200 ? Math.min(2.5, 1600 / lado) * (escala || 1) : Math.min(escala || 1, MAX / lado); // las fotos pequeñas se agrandan
    const w = Math.round(im.naturalWidth * k), hh = Math.round(im.naturalHeight * k); const a = (grados * Math.PI) / 180;
    const W = Math.ceil(Math.abs(w * Math.cos(a)) + Math.abs(hh * Math.sin(a)) - 1e-6), H = Math.ceil(Math.abs(w * Math.sin(a)) + Math.abs(hh * Math.cos(a)) - 1e-6);
    const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d");
    x.fillStyle = "#000"; x.fillRect(0, 0, W, H); // fondo oscuro en las esquinas que deja el giro (el lector lo lleva mejor que el blanco)
    x.translate(W / 2, H / 2); x.rotate(a); x.filter = "grayscale(1) contrast(1.25)"; x.drawImage(im, -w / 2, -hh / 2, w, hh);
    return c;
  }
  // Cuánto está torcida la foto (perfil de proyección de las líneas de texto): devuelve el giro que la endereza
  function inclinacion(im) {
    const L = Math.max(im.naturalWidth, im.naturalHeight); const k = 600 / L; const w = Math.round(im.naturalWidth * k), hh = Math.round(im.naturalHeight * k);
    const c = document.createElement("canvas"); const x = c.getContext("2d", { willReadFrequently: true }); let thr = null;
    const puntua = (ang) => { const a = (ang * Math.PI) / 180; const W = Math.ceil(Math.abs(w * Math.cos(a)) + Math.abs(hh * Math.sin(a)) - 1e-6), H = Math.ceil(Math.abs(w * Math.sin(a)) + Math.abs(hh * Math.cos(a)) - 1e-6);
      c.width = W; c.height = H; x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = "#fff"; x.fillRect(0, 0, W, H); x.translate(W / 2, H / 2); x.rotate(a); x.drawImage(im, -w / 2, -hh / 2, w, hh);
      const d = x.getImageData(0, 0, W, H).data;
      if (thr == null) { let s = 0, s2 = 0, n = 0; for (let i = 0; i < d.length; i += 16) { const g = (d[i] + d[i + 1] + d[i + 2]) / 3; s += g; s2 += g * g; n++; } const m = s / n; thr = m - 0.5 * Math.sqrt(Math.max(0, s2 / n - m * m)); }
      let prev = null, sc = 0; for (let y = 0; y < H; y++) { let cnt = 0; const o = y * W * 4; for (let i = o; i < o + W * 4; i += 4) if (d[i] + d[i + 1] + d[i + 2] < thr * 3) cnt++; if (prev != null) sc += (cnt - prev) * (cnt - prev); prev = cnt; }
      return sc / W; };
    puntua(0); let mejor = [0, -1];
    for (const base of [0, 90]) for (let ang = -12; ang <= 12; ang++) { const sc = puntua(base + ang); if (sc > mejor[1]) mejor = [base + ang, sc]; }
    const b = mejor[0]; for (let ang = b - 1; ang <= b + 1; ang += 0.25) { const sc = puntua(ang); if (sc > mejor[1]) mejor = [ang, sc]; }
    return mejor[0];
  }
  async function leerFoto(file, onPaso) {
    const im = await imagen(file); onPaso && onPaso("Preparando el lector de texto (la primera vez tarda un poco)…");
    const w = await worker(); let mejor = null; let d = 0; try { d = inclinacion(im); } catch (e) {}
    if (Math.abs(d) < 0.75 || Math.abs(Math.abs(d) - 90) < 0.75) d = Math.round(d / 90) * 90; // casi recta: no se gira (girar emborrona un poco)
    for (const g of [d, d + 180, d + 90, d + 270]) {
      onPaso && onPaso(g === d ? "Leyendo la foto…" : "Probando otra orientación…");
      const { data } = await w.recognize(lienzo(im, g)); const r = leerDatos(data.text); r.texto = data.text; r.giro = g;
      if (!mejor || r.puntos > mejor.puntos) mejor = r;
      if (mejor.puntos >= 7) break;
    }
    // Segunda pasada más grande: completa lo que falte y afina el nombre (el lector a veces se come la primera letra)
    if (mejor && mejor.puntos >= 2) { try { onPaso && onPaso("Repasando el documento…");
      const { data } = await w.recognize(lienzo(im, mejor.giro, 1.6)); fusionar(mejor, leerDatos(data.text), data.text); } catch (e) {} }
    return mejor;
  }

  // ---------------- recuadro para la pantalla ----------------
  // onUsar({ nombre, apellidos, matricula, bastidor, modelo, file })
  function LeerDocumento({ T, onUsar, abiertoInicial }) {
    const [abierto, setAbierto] = useState(!!abiertoInicial);
    const [paso, setPaso] = useState(""); const [err, setErr] = useState(""); const [d, setD] = useState(null); const [sobre, setSobre] = useState(false);
    const archivo = useRef(null); const ref = useRef(null);
    const leer = async (file) => { if (!file || !/^image\//.test(file.type)) { setErr("Eso no es una foto. Usa una foto o captura del permiso o de la ficha técnica."); return; }
      setErr(""); setD(null); archivo.current = file;
      try { const r = await leerFoto(file, setPaso); setPaso("");
        if (!r || r.puntos < 2) { setErr("No he podido leer el documento. Prueba con una foto más recta, cerca y sin brillos."); return; }
        setD({ apellidos: r.apellidos, nombre: r.nombre, matricula: r.matricula, bastidor: r.bastidor, modelo: r.modeloCompleto }); }
      catch (e) { setPaso(""); setErr(e.message || String(e)); } };
    const pegar = (e) => { const f = Array.from((e.clipboardData && e.clipboardData.items) || []).find((i) => i.kind === "file" && /^image\//.test(i.type)); if (f) { e.preventDefault(); leer(f.getAsFile()); } };
    if (!abierto) return h("button", { type: "button", "data-leer-doc": "1", onClick: () => setAbierto(true), style: { ...btn(T, "s"), alignSelf: "flex-start" } }, "📷 Leer permiso de circulación o ficha técnica");
    const I = { ...inp(T), padding: "6px 9px" };
    const campo = (k, l, mono) => h("label", { style: { display: "flex", flexDirection: "column", gap: "3px", fontSize: "11.5px", fontWeight: 800, color: T.inkSoft } }, l,
      h("input", { "data-leer-campo": k, value: d[k] || "", onChange: (e) => setD((x) => ({ ...x, [k]: e.target.value })), placeholder: "no leído", style: { ...I, fontWeight: 600, color: T.ink, ...(mono ? { fontFamily: "'JetBrains Mono', monospace" } : {}), borderColor: d[k] ? T.border : T.warn } }));
    return h("div", { "data-leer-doc-caja": "1", style: { border: `1px solid ${T.border}`, borderRadius: "12px", padding: "12px", background: T.bg, display: "flex", flexDirection: "column", gap: "10px" } },
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } }, h("b", { style: { fontSize: "13.5px" } }, "📷 Leer permiso de circulación o ficha técnica"),
        h("button", { type: "button", onClick: () => { setAbierto(false); setD(null); setErr(""); }, style: { border: "none", background: "transparent", cursor: "pointer", fontSize: "18px", color: T.inkSoft } }, "×")),
      !d && !paso ? h("div", { onDragOver: (e) => { e.preventDefault(); setSobre(true); }, onDragLeave: () => setSobre(false), onDrop: (e) => { e.preventDefault(); setSobre(false); const f = Array.from(e.dataTransfer.files || [])[0]; leer(f); },
          style: { border: `2px dashed ${sobre ? T.rust : T.border}`, borderRadius: "10px", padding: "14px", textAlign: "center", fontSize: "13px", color: T.inkSoft, background: sobre ? "#EEF2FF" : T.surface } },
          "Arrastra aquí la foto, ", h("button", { type: "button", onClick: () => ref.current && ref.current.click(), style: { border: "none", background: "transparent", color: T.rust, fontWeight: 800, cursor: "pointer", padding: 0, textDecoration: "underline" } }, "elígela"),
          " o pégala:", h("textarea", { "data-leer-pegar": "1", rows: 1, value: "", onChange: () => {}, onPaste: pegar, placeholder: "haz clic aquí y pulsa Ctrl+V", style: { ...inp(T), display: "block", marginTop: "8px", textAlign: "center", resize: "none", caretColor: "transparent" } }),
          h("input", { ref, type: "file", accept: "image/*", style: { display: "none" }, onChange: (e) => { leer(e.target.files && e.target.files[0]); e.target.value = ""; } })) : null,
      paso ? h("div", { "data-leer-paso": "1", style: { fontSize: "13px", color: T.rust, fontWeight: 700 } }, "⏳ " + paso) : null,
      err ? h("div", { style: { fontSize: "13px", color: T.danger } }, err) : null,
      d ? h(React.Fragment, null,
        h("div", { style: { fontSize: "12px", color: T.inkSoft } }, "Revisa lo leído y corrige lo que haga falta. Lo vacío no se ha podido leer."),
        h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" } }, campo("nombre", "Nombre del titular"), campo("apellidos", "Apellidos (o razón social)")),
        h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1.4fr", gap: "8px" } }, campo("matricula", "Matrícula", true), campo("bastidor", "Bastidor", true), campo("modelo", "Modelo")),
        h("div", { style: { display: "flex", gap: "8px", justifyContent: "flex-end" } },
          h("button", { type: "button", onClick: () => { setD(null); }, style: btn(T, "s") }, "Leer otra foto"),
          h("button", { type: "button", "data-leer-usar": "1", onClick: () => { onUsar({ ...d, matricula: U.normMat ? U.normMat(d.matricula) : d.matricula, bastidor: String(d.bastidor || "").toUpperCase().replace(/[^A-Z0-9]/g, ""), file: archivo.current }); setAbierto(false); setD(null); }, style: btn(T, "p") }, "Usar estos datos"))) : null);
  }

  window.AcllarLeerDoc = { LeerDocumento, leerDatos, leerFoto, afinar, fusionar, inclinacion, lienzo };
})();
