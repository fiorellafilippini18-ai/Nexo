import XLSX from 'xlsx';

/* =============================================================
   Lectura genérica de planillas.

   La idea: no asumir un formato fijo. Se abre el archivo, se
   busca en cada hoja una tabla del tipo "una fila por persona,
   una columna por indicador", y se devuelve todo lo encontrado
   para que el supervisor confirme el mapeo en pantalla.
   ============================================================= */

const RE_TOTAL = /^(total|promedio|prom\.|general|equipo|suma|media|resumen)\b|total\s*\/|promedio\s*(general|equipo)/i;
const RE_NOMBRE_COL = /(agente|asesor|asesora|colaborador|nombre|usuario|persona|operador|vendedor|empleado)/i;
/* Encabezados que delatan una tabla al revés: una fila por criterio, una columna por persona. */
const RE_TRANSPUESTA = /^(criterio|aspecto|dimension|dimensi[oó]n|indicador|item|[ií]tem)s?\b/i;

export function normTxt(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** "1.745" -> 1745 · "7,39" -> 7.39 · "29.6 min" -> 29.6 · "99.7% resol" -> 99.7 */
export function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return null;
  let s = String(v).trim();
  if (!s) return null;
  const m = s.match(/-?[\d.,\s]*\d/);
  if (!m) return null;
  s = m[0].replace(/\s/g, '');
  const coma = s.lastIndexOf(','), punto = s.lastIndexOf('.');
  if (coma > -1 && punto > -1) {
    // el separador decimal es el que aparece más a la derecha
    s = coma > punto ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (coma > -1) {
    // "7,39" decimal · "1,745" miles
    s = /,\d{3}$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (punto > -1) {
    // "1.745" miles (3 dígitos y más de un punto o entero largo)
    const partes = s.split('.');
    if (partes.length > 2 || (partes[1] && partes[1].length === 3 && partes[0].length <= 3 && !/\.\d{1,2}$/.test(s)))
      s = s.replace(/\./g, '');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

const vacio = (r) => r.every((c) => c === null || c === undefined || String(c).trim() === '');

/** Un nombre de persona es corto y sin puntuación de oración. */
const pareceNombre = (s) => {
  const t = String(s || '').trim();
  if (!t || t.length > 45) return false;
  if (t.split(/\s+/).length > 5) return false;
  if (/[.;:]\s|\d{2,}%|—/.test(t)) return false;
  return /[a-záéíóúñA-ZÁÉÍÓÚÑ]/.test(t);
};

/**
 * Busca la fila de encabezado de una hoja: la primera fila que tenga
 * al menos 3 celdas de texto y debajo tenga filas con números.
 */
function detectarTabla(matriz) {
  const lim = Math.min(matriz.length, 30);
  let mejor = null;
  for (let i = 0; i < lim; i++) {
    const fila = matriz[i] || [];
    if (vacio(fila)) continue;
    const textos = fila.filter((c) => typeof c === 'string' && c.trim().length > 1).length;
    if (textos < 3) continue;

    // Una fila de encabezado es texto, no datos. Si tiene más números que
    // palabras es una fila de la tabla, y tomarla como cabecera desarma todo
    // (pasa cuando la hoja trae varias tablas apiladas, una debajo de la otra).
    const numerosEnFila = fila.filter((c) => toNum(c) !== null).length;
    if (numerosEnFila >= textos) continue;

    // ¿la columna del nombre?
    let colNombre = fila.findIndex((c) => RE_NOMBRE_COL.test(String(c ?? '')));
    if (colNombre < 0) colNombre = 0;

    // Si la primera columna se titula "Criterio" (o similar), la tabla viene
    // transpuesta: las filas son criterios y las columnas, personas. Eso lo lee
    // leerCriterios por separado; acá no es una tabla de personas.
    if (RE_TRANSPUESTA.test(normTxt(String(fila[colNombre] ?? '')))) continue;

    // cuántas filas de datos hay debajo
    let filas = 0, numericas = 0, nombresBuenos = 0;
    const vistos = new Set();
    for (let j = i + 1; j < matriz.length; j++) {
      const f = matriz[j] || [];
      if (vacio(f)) { if (filas > 0) break; else continue; }
      const nombre = String(f[colNombre] ?? '').trim();
      if (!nombre) break;
      if (RE_TOTAL.test(nombre)) continue;
      filas++;
      vistos.add(normTxt(nombre));
      if (pareceNombre(nombre)) nombresBuenos++;
      numericas += f.filter((c) => toNum(c) !== null).length;
    }
    if (filas < 2) continue;
    // si la mayoría de las "personas" son frases largas, no es una tabla de personas
    if (nombresBuenos < filas * 0.7) continue;
    // Una tabla "por persona" tiene a cada quien una sola vez. Si los nombres se
    // repiten, es el detalle por conversación: cargarla mezclaría todo en una fila.
    if (vistos.size < filas * 0.9) continue;
    // Una hoja puede traer varias tablas por persona, una debajo de la otra. La
    // buena es la que trae los indicadores de verdad: chats, calidad y tiempo.
    // Las auxiliares ("Chats totales", "% en turno") repiten un solo concepto.
    // Solo cuentan los tres conceptos que definen el desempeño: si sumáramos
    // también los criterios de calidad, ganaría la hoja fuente de los gráficos.
    const claves = new Set();
    for (let c = 0; c < fila.length; c++) {
      if (c === colNombre) continue;
      const k = claveIndicador(String(fila[c] ?? ''));
      if (k === 'chats' || k === 'calidad' || k === 'tiempo') claves.add(k);
    }
    const puntaje = filas * 2 + numericas + claves.size * 15
      + (RE_NOMBRE_COL.test(String(fila[colNombre] ?? '')) ? 20 : 0);
    if (!mejor || puntaje > mejor.puntaje) mejor = { headerRow: i, colNombre, filas, puntaje, claves: claves.size };
  }
  return mejor;
}

/**
 * Analiza el archivo y devuelve, por cada hoja que parezca una tabla
 * de personas × indicadores: encabezados, columnas numéricas y filas.
 */
export function analizar(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const hojas = [];

  for (const nombreHoja of wb.SheetNames) {
    const ws = wb.Sheets[nombreHoja];
    if (!ws) continue;
    const matriz = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: null, raw: true });
    const t = detectarTabla(matriz);
    if (!t) continue;

    const header = (matriz[t.headerRow] || []).map((c, i) => {
      const s = String(c ?? '').trim();
      return s || `Columna ${i + 1}`;
    });

    const filas = [];
    for (let j = t.headerRow + 1; j < matriz.length; j++) {
      const f = matriz[j] || [];
      if (vacio(f)) { if (filas.length) break; else continue; }
      const persona = String(f[t.colNombre] ?? '').trim();
      if (!persona) break;
      if (RE_TOTAL.test(persona)) continue;
      // Las notas al pie viven en la misma columna que los nombres: se descartan.
      if (!pareceNombre(persona)) continue;
      filas.push({ persona, celdas: header.map((_, c) => (f[c] === undefined ? null : f[c])) });
    }
    if (filas.length < 2) continue;

    // Una columna es "de indicador" si la mayoría de sus celdas son números
    const columnas = header.map((titulo, i) => {
      const vals = filas.map((f) => toNum(f.celdas[i]));
      const conValor = vals.filter((v) => v !== null).length;
      return {
        indice: i,
        titulo,
        numerica: i !== t.colNombre && conValor >= Math.ceil(filas.length * 0.6),
        ejemplo: filas[0] ? filas[0].celdas[i] : null
      };
    });

    hojas.push({
      _puntaje: t.puntaje + (/dashboard|resumen|panorama/i.test(normTxt(nombreHoja)) ? 30 : 0)
        - (/grafico|gráfico|datos|metodolog/i.test(normTxt(nombreHoja)) ? 40 : 0),
      hoja: nombreHoja,
      colNombre: t.colNombre,
      personas: filas.map((f) => f.persona),
      columnas,
      filas: filas.map((f) => ({
        persona: f.persona,
        valores: Object.fromEntries(columnas.filter((c) => c.numerica).map((c) => [c.titulo, toNum(f.celdas[c.indice])]))
      })),
      puntaje: t.puntaje
    });
  }

  hojas.sort((a, b) => b._puntaje - a._puntaje);
  return { hojas };
}

/* -------------------------------------------------------------
   Reconocimiento automático de indicadores conocidos.
   ------------------------------------------------------------- */
const SINONIMOS = [
  { clave: 'chats',     re: /(chats?\s*(atendidos|totales)?|conversaciones|tickets|casos|atenciones)\b/i },
  { clave: 'calidad',   re: /(calidad|puntaje\s*de\s*calidad|score)/i },
  { clave: 'tiempo',    re: /(tiempo\s*de\s*respuesta|t\.?\s*resp|trm|primera\s*respuesta|espera|demora)/i },
  { clave: 'ventas',    re: /(ventas|cierres|conversion|facturacion)/i },
  { clave: 'precision', re: /(precisi[oó]n\s*de\s*informaci[oó]n|precisi[oó]n)/i },
  { clave: 'fcr',       re: /(fcr|resoluci[oó]n\s*(hasta|en\s*el)|primera\s*interacci[oó]n)/i },
  { clave: 'redaccion', re: /(redacci[oó]n|ortograf)/i },
  { clave: 'personal',  re: /(personalizaci[oó]n)/i },
  { clave: 'emocional', re: /(manejo\s*emocional|empat[ií]a)/i },
  { clave: 'protocolo', re: /(protocolos?)/i },
  { clave: 'clara',     re: /(respuesta\s*clara|claridad|completa)/i }
];

export function claveIndicador(titulo) {
  for (const s of SINONIMOS) if (s.re.test(titulo)) return s.clave;
  return null;
}

/* Consejos por defecto: lo que ve el agente cuando no llega a la meta.
   El supervisor los puede editar desde la pestaña Indicadores. */
const CONSEJOS = {
  chats:     'Revisá los tramos del turno donde quedan chats sin tomar. Tomar la cola apenas entra, en vez de esperar, es lo que más mueve este número.',
  calidad:   'La calidad es el promedio de los 7 criterios de abajo. Mirá cuáles quedaron más bajos y trabajá primero sobre esos dos.',
  tiempo:    'Contestá aunque sea con un acuse ("ya lo estoy viendo") mientras buscás la información. La demora se mide hasta la primera respuesta.',
  ventas:    'Revisá los chats que terminaron sin cierre: en la mayoría falta ofrecer una alternativa concreta antes de despedirse.',
  precision: 'Verificá stock, precio y plazo de envío en el sistema antes de responder. La mayoría de los descuentos vienen de datos dados de memoria.',
  fcr:       'Antes de cerrar, preguntate si el cliente va a tener que volver a escribir. Adelantá la próxima duda en la misma respuesta.',
  redaccion: 'Frases cortas, sin abreviaturas y revisando la ortografía antes de enviar.',
  personal:  'Usá el nombre del cliente y referí lo que te contó. Evitá respuestas que suenen a plantilla.',
  emocional: 'Ante un reclamo, reconocé la molestia antes de explicar el procedimiento. Validar primero baja mucho la tensión.',
  protocolo: 'Repasá el guion de apertura, identificación y cierre. Los puntos que más se pierden son el saludo inicial y la despedida.',
  clara:     'Respondé todas las preguntas del mensaje, no solo la primera. Si son varias, contestá en lista.'
};

/** Sugiere dirección, meta y consejo para una columna todavía no configurada. */
export function sugerir(titulo, valores) {
  const clave = claveIndicador(titulo);
  const menor = /(tiempo|espera|demora|abandono|reclamo|error|rechazo|escalad)/i.test(titulo);
  const base = { direccion: menor ? 'menor' : 'mayor', meta: null, unidad: '', decimales: 1, principal: false, exime_supervision: false, consejo: (clave && CONSEJOS[clave]) || '' };
  // El volumen no se le exige a la supervisión: su rol es controlar, no responder.
  if (clave === 'chats')   return { ...base, meta: 1200, unidad: 'chats', decimales: 0, principal: true, exime_supervision: true };
  if (clave === 'calidad') return { ...base, meta: 7,    unidad: 'puntos', decimales: 2, principal: true };
  if (clave === 'tiempo')  return { ...base, direccion: 'menor', meta: 35, unidad: 'min', decimales: 1, principal: true };
  const nums = valores.filter((v) => v !== null);
  if (nums.length && Math.max(...nums) <= 10) return { ...base, meta: 7, unidad: 'puntos', decimales: 2 };
  return base;
}

/* =========================================================
   Periodo: la planilla dice de qué fechas habla, así que no
   hace falta elegirlo a mano.
   ========================================================= */
const MESES_N = ['enero','febrero','marzo','abril','mayo','junio','julio',
                 'agosto','septiembre','setiembre','octubre','noviembre','diciembre'];
const MES_INDICE = (m) => {
  const i = MESES_N.indexOf(normTxt(m));
  return i < 0 ? null : (i >= 9 ? i - 1 : i); // "setiembre" es el mismo mes que "septiembre"
};
const dosDig = (n) => String(n).padStart(2, '0');

/** Busca en las primeras filas de cada hoja una frase con fechas y la interpreta. */
export function detectarPeriodo(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const lineas = [];
  for (const nombre of wb.SheetNames) {
    const ws = wb.Sheets[nombre];
    if (!ws) continue;
    const m = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null, raw: false });
    for (const fila of m.slice(0, 6)) {
      for (const celda of (fila || [])) {
        const s = String(celda ?? '').trim();
        if (s.length > 8) lineas.push(s);
      }
    }
  }

  const mesesRe = MESES_N.join('|');
  for (const linea of lineas) {
    const t = normTxt(linea);

    // "del 1 al 15 de agosto de 2026"  /  "1 al 15 de agosto 2026"
    let m = t.match(new RegExp(`(\\d{1,2})\\s*(?:al|a|-|hasta)\\s*(\\d{1,2})\\s*de\\s*(${mesesRe})\\s*(?:de\\s*)?(\\d{4})`));
    if (m) {
      const [, d1, d2, mes, anio] = m;
      const mi = MES_INDICE(mes);
      if (mi === null) continue;
      const fin = new Date(Number(anio), mi + 1, 0).getDate();
      const desde = `${anio}-${dosDig(mi + 1)}-${dosDig(d1)}`;
      const hasta = `${anio}-${dosDig(mi + 1)}-${dosDig(d2)}`;
      const cubreMes = Number(d1) <= 1 && Number(d2) >= fin;
      if (cubreMes) {
        return { tipo: 'mensual', desde, hasta,
                 etiqueta: `${MESES_N[mi]} ${anio}`, texto: linea };
      }
      const segunda = Number(d1) >= 16;
      return { tipo: 'quincenal', desde, hasta, quincena: segunda ? 2 : 1,
               etiqueta: `${segunda ? '2ª' : '1ª'} quincena de ${MESES_N[mi]} ${anio}`, texto: linea };
    }

    // "mes de agosto de 2026" / "agosto 2026" — solo si no dice quincena
    m = t.match(new RegExp(`(?:mes\\s*de\\s*)?(${mesesRe})\\s*(?:de\\s*)?(\\d{4})`));
    if (m && !/quincen/.test(t)) {
      const mi = MES_INDICE(m[1]);
      if (mi === null) continue;
      const fin = new Date(Number(m[2]), mi + 1, 0).getDate();
      return { tipo: 'mensual',
               desde: `${m[2]}-${dosDig(mi + 1)}-01`,
               hasta: `${m[2]}-${dosDig(mi + 1)}-${dosDig(fin)}`,
               etiqueta: `${MESES_N[mi]} ${m[2]}`, texto: linea };
    }
  }
  return null;
}

/* =========================================================
   Texto de análisis que la planilla ya trae escrito.
   No se inventa nada: se copia lo que dice el archivo.
   ========================================================= */

/** Hoja "Fortalezas y Errores": una fila por persona, con dos columnas de texto. */
export function leerFortalezas(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const nombre = wb.SheetNames.find((h) => /fortalez/i.test(normTxt(h)));
  if (!nombre) return [];
  const m = XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, blankrows: true, defval: null, raw: false });

  let cab = -1, cAg = 0, cFor = 1, cErr = 2;
  for (let i = 0; i < Math.min(m.length, 12); i++) {
    const fila = (m[i] || []).map((c) => normTxt(String(c ?? '')));
    const iAg = fila.findIndex((c) => /^agente|^asesor|^colaborador|^persona/.test(c));
    const iFo = fila.findIndex((c) => /fortalez/.test(c));
    const iEr = fila.findIndex((c) => /error|corregir|mejorar/.test(c));
    if (iAg >= 0 && iFo >= 0) { cab = i; cAg = iAg; cFor = iFo; cErr = iEr >= 0 ? iEr : iFo + 1; break; }
  }
  if (cab < 0) return [];

  const out = [];
  for (let i = cab + 1; i < m.length; i++) {
    const f = m[i] || [];
    const persona = String(f[cAg] ?? '').trim();
    if (!persona) { if (out.length) break; else continue; }
    if (RE_TOTAL.test(persona)) continue;
    out.push({
      persona,
      fortalezas: String(f[cFor] ?? '').trim(),
      errores: String(f[cErr] ?? '').trim()
    });
  }
  return out;
}

/** Hoja "Conclusiones": títulos numerados y, debajo, su explicación. */
export function leerConclusiones(buffer, conocidas = []) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const nombre = wb.SheetNames.find((h) => /conclusi|recomendac|gerenc/i.test(normTxt(h)));
  if (nombre) {
    const m = XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, blankrows: true, defval: null, raw: false });
    const out = [];
    for (const fila of m) {
      const celdas = (fila || []).map((c) => String(c ?? '').trim()).filter((s) => s);
      // Las tablas no son conclusiones: "1. Chats atendidos | ≥ 800" es un
      // umbral, no un título de análisis. Solo cuentan los renglones sueltos.
      if (celdas.length !== 1) { continue; }
      const linea = celdas[0];
      if (/^\d+[\.\)]\s*\S/.test(linea)) {
        out.push({ titulo: linea.replace(/^\d+[\.\)]\s*/, '').trim(), cuerpo: '' });
      } else if (out.length) {
        const u = out[out.length - 1];
        u.cuerpo = u.cuerpo ? `${u.cuerpo}\n${linea}` : linea;
      }
    }
    const numeradas = out.filter((c) => c.titulo && c.cuerpo);
    if (numeradas.length) return numeradas;
  }
  // Ninguna hoja trae títulos numerados: se buscan los bloques de análisis
  // allí donde estén. No todos los archivos traen una hoja "Conclusiones".
  return conclusionesPorBloque(wb, indicePersonas(conocidas));
}

/* Títulos que, en cualquier hoja, encabezan algo que le sirve a Gerencia. */
const RE_TITULO_GERENCIA = /^(conclusion|conclusiones|recomendacion|recomendaciones|analisis gerencial|lectura gerencial|resumen ejecutivo|resumen general|sintesis|diagnostico|plan de accion|que hacer|hallazgos|resultado del equipo|resumen qu)/;

/**
 * Recorre todas las hojas buscando títulos de análisis y se queda con lo que
 * viene escrito debajo de cada uno, hasta el próximo título o una tabla.
 */
function conclusionesPorBloque(wb, indice = new Map()) {
  const out = [];
  for (const nombreHoja of wb.SheetNames) {
    // La hoja de revisión de una persona habla de ella, no del equipo: su
    // contenido va a su propio panel, no a las conclusiones de Gerencia.
    if (indice.size && personaDeHoja(nombreHoja, indice)) continue;
    const ws = wb.Sheets[nombreHoja]; if (!ws) continue;
    const m = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: null, raw: false });
    let actual = null;

    for (const fila0 of m) {
      const fila = fila0 || [];
      const celdas = fila.map((c) => String(c ?? '').trim()).filter((s) => s);
      if (!celdas.length) continue;

      const unaSola = celdas.length === 1;
      const texto = celdas[0];
      if (unaSola && esTitulo(texto) && RE_TITULO_GERENCIA.test(normTxt(texto))) {
        actual = { titulo: limpiarTitulo(texto), cuerpo: '', hoja: nombreHoja };
        out.push(actual);
        continue;
      }
      if (!actual) continue;
      // Otro título corta el bloque; una tabla también (los números se ven en pantalla).
      if (unaSola && esTitulo(texto)) { actual = null; continue; }
      if (!unaSola) { actual = null; continue; }
      if (texto.length < 12) continue;
      actual.cuerpo = actual.cuerpo ? `${actual.cuerpo}\n${texto}` : texto;
    }
  }
  return out.filter((c) => c.cuerpo).map((c) => ({ titulo: c.titulo, cuerpo: c.cuerpo }));
}

/** Quita la numeración y los adornos de un título de sección. */
const limpiarTitulo = (s) => String(s || '').replace(/^[\s\d]*[\.\)]?\s*/, '').replace(/\s*[—–-]\s*$/, '').trim() || String(s || '').trim();

/**
 * ¿Esta línea es un título de sección y no una oración?
 * Los títulos son cortos, van en mayúsculas o empiezan numerados, y no
 * terminan en punto.
 */
function esTitulo(s) {
  const t = String(s || '').trim();
  if (!t || t.length > 140) return false;
  if (/^[•·➖✅❌⚠]/.test(t)) return false;       // viñeta, no título
  const letras = t.replace(/[^a-záéíóúüñA-ZÁÉÍÓÚÜÑ]/g, '');
  if (!letras) return false;
  const mays = (t.match(/[A-ZÁÉÍÓÚÜÑ]/g) || []).length / letras.length;
  if (mays > 0.7) return true;                    // "RESUMEN EJECUTIVO"
  if (/^\d+[\.\)]\s*[A-ZÁÉÍÓÚÑ]/.test(t) && t.length <= 110) return true;  // "3. CIERRE EN 24 HORAS"
  return false;
}

/* =========================================================
   Calidad por criterio: la tabla que viene al revés.

   El Dashboard trae una fila por persona, pero el desglose de
   calidad viene transpuesto: una fila por criterio y una columna
   por agente. Esto lo busca por contenido —no por nombre de hoja
   ni por posición— así sirve igual si está en su propia hoja o
   embebido más abajo del Dashboard.
   ========================================================= */

/* Columnas de resumen que acompañan al desglose y no son personas. */
const RE_COL_RESUMEN = /^(prom|promedio|media|equipo|total|general|mas bajo|m[aá]s bajo|minimo|m[ií]nimo|maximo|m[aá]ximo|observacion|observaci[oó]n|area de mejora|[aá]rea de mejora|alerta|comentario|criterio|aspecto|indicador|dimension|dimensi[oó]n)\b/i;

/** Un criterio es una etiqueta corta de texto, no una oración ni un número. */
const pareceCriterio = (s) => {
  const t = String(s ?? '').trim();
  if (!t || t.length > 60) return false;
  if (RE_TOTAL.test(t) || RE_COL_RESUMEN.test(normTxt(t))) return false;
  if (toNum(t) !== null && /^[\d.,\s%]+$/.test(t)) return false;
  return /[a-záéíóúñA-ZÁÉÍÓÚÑ]/.test(t);
};

/**
 * Busca en todo el archivo un bloque "criterios × personas".
 * Devuelve { hoja, criterios: [{nombre, valores:{persona:num}}], personas: [texto] }
 * o null si no encuentra ninguno.
 */
/* Nombres de cuenta que no son personas evaluadas. Importa excluirlos: la
   planilla dice "según la regla de Gerencia" todo el tiempo, y si "Gerencia"
   figura como usuario, cada una de esas frases se le atribuiría a ella. */
const RE_NO_PERSONA = /^(gerencia|gerente|supervision|supervisi[oó]n|administracion|administraci[oó]n|admin|equipo|empresa|rrhh|recursos humanos|calidad|soporte|atencion|atenci[oó]n|sistema|sistemas|direccion|direcci[oó]n)$/;

/* Para saber si un texto nombra a una persona no alcanza con que "parezca" un
   nombre: "Motivo de contacto" también lo parece. Se compara contra el equipo
   real, aceptando el nombre completo, el de pila y los alias aprendidos. */
function indicePersonas(conocidas = []) {
  const indice = new Map();
  const ok = (clave) => !!clave && !RE_NO_PERSONA.test(clave);
  for (const p of conocidas) {
    const n = normTxt(p.nombre || '');
    if (!ok(n)) continue;
    indice.set(n, p);
    // El nombre de pila solo si nadie más lo reclamó antes; el alias, siempre:
    // es un mapeo explícito, no uno deducido.
    const pila = n.split(' ')[0];
    if (pila.length > 2 && ok(pila) && !indice.has(pila)) indice.set(pila, p);
    for (const a of (p.alias || [])) { const na = normTxt(a); if (ok(na)) indice.set(na, p); }
  }
  return indice;
}

export function leerCriterios(buffer, conocidas = []) {
  const indice = indicePersonas(conocidas);
  const esPersona = (t) => (indice.size ? (indice.get(normTxt(t)) || null)
                                        : (pareceNombre(t) && !/^\d+$/.test(String(t).trim()) ? { nombre: t } : null));

  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  let mejor = null;

  for (const nombreHoja of wb.SheetNames) {
    const ws = wb.Sheets[nombreHoja]; if (!ws) continue;
    const m = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: null, raw: true });

    for (let i = 0; i < Math.min(m.length, 400); i++) {
      const fila = m[i] || [];
      if (vacio(fila)) continue;

      // Candidatas a columna de persona: texto que parece nombre y no es de resumen
      const cols = [];
      for (let c = 0; c < fila.length; c++) {
        const t = String(fila[c] ?? '').trim();
        if (!t || RE_COL_RESUMEN.test(normTxt(t))) continue;
        const u = esPersona(t);
        if (u) cols.push({ indice: c, texto: t, usuarioId: u.id ?? null, persona: u.nombre || t });
      }
      if (cols.length < 2) continue;

      // La columna de la etiqueta: la primera a la izquierda de los nombres
      const colEtiqueta = Math.max(0, Math.min(...cols.map((x) => x.indice)) - 1);

      // Si esa columna se titula "Agente", la tabla está derecha: las filas son
      // personas y las columnas, criterios. No es el bloque transpuesto.
      if (RE_NOMBRE_COL.test(String(fila[colEtiqueta] ?? ''))) continue;

      // Filas debajo: etiqueta de criterio + números en las columnas de personas
      const criterios = [];
      for (let j = i + 1; j < m.length; j++) {
        const f = m[j] || [];
        if (vacio(f)) { if (criterios.length) break; else continue; }
        const etiqueta = String(f[colEtiqueta] ?? '').trim();
        if (!etiqueta) { if (criterios.length) break; else continue; }
        if (RE_TOTAL.test(etiqueta)) continue;
        if (!pareceCriterio(etiqueta)) { if (criterios.length) break; else continue; }
        const valores = {};
        for (const c of cols) {
          const n = toNum(f[c.indice]);
          if (n !== null) valores[c.texto] = n;
        }
        if (Object.keys(valores).length < Math.ceil(cols.length * 0.6)) {
          if (criterios.length) break; else continue;
        }
        criterios.push({ nombre: etiqueta, valores });
      }

      // Un desglose de calidad tiene varios criterios; si no, es otra cosa
      if (criterios.length < 3) continue;
      const puntaje = criterios.length * 3 + cols.length
        + (/calidad|criterio/i.test(normTxt(nombreHoja)) ? 25 : 0);
      if (!mejor || puntaje > mejor.puntaje) {
        mejor = { hoja: nombreHoja, criterios, puntaje,
                  personas: cols.map((c) => ({ texto: c.texto, usuarioId: c.usuarioId, sugerido: c.persona })) };
      }
    }
  }
  if (!mejor) return null;
  delete mejor.puntaje;
  return mejor;
}

/* =========================================================
   Fortalezas y errores, cuando el archivo no trae esa hoja.

   No todos los dashboards de fin de mes tienen una hoja
   "Fortalezas y Errores", pero casi todos escriben, en algún
   lugar del texto, qué hizo bien y qué hizo mal cada persona:
   "Ezequiel (7,23) y Matías (7,32) están bajo 7,5",
   "Judith recuperó el nivel", "Lucia: la más alta del equipo".

   Esto recorre todo el archivo, busca las frases que nombran a
   alguien del equipo y las reparte en las dos columnas. No
   reescribe nada: copia la frase tal como está en la planilla.
   ========================================================= */

const RE_BIEN = new RegExp([
  'fortalez', 'lo que si cumple', 'si cumple', 'cumple (los|con|el|la)', 'supera',
  'excelente', 'el mas (alto|rapido|solido|fuerte)', 'la mas (alta|rapida|solida|fuerte)',
  'el segundo mas rapido', 'solid', 'destac', 'mejoro', 'recupero', 'muy bien',
  'por encima', 'sostiene', 'sin vacaciones', 'buen manejo', 'su criterio mas fuerte',
  'resuelve en pocos', 'correcto', 'cumplen', 'mvp'
].join('|'), 'i');

const RE_MAL = new RegExp([
  'a mejorar', 'no cumple', 'no llega', 'no alcanza', 'falta', 'faltan', 'faltaban',
  'por debajo', 'bajo (la |el |)(meta|umbral|7|6)', 'su criterio mas bajo', 'el mas bajo',
  'margen para', 'atras', 'a vigilar', 'critico', 'revisar', 'plan de (accion|mejora|calidad)',
  'quedaron abiert', 'sin responder', 'respondidos tarde', 'incumpl', 'bajo su volumen',
  'habria quedado', 'no se pueden identificar', 'se corto', 'por solo', 'riesgo'
].join('|'), 'i');

/** Hojas cuyo texto no describe a nadie: metodología, escalas, gráficos. */
const RE_HOJA_IGNORADA = /grafico|chart|metodolog|escala de plus|datos|fuente/i;

/* Pies de tabla: describen de dónde salieron los datos, no a una persona. */
const RE_PIE = /^(fuente|nota|notas|metodolog[ií]a|alcance|ref\.|referencia|aclaraci[oó]n|escala de color|auditor[ií]a|criterio|clasificaci[oó]n hecha|muestra de)\b/i;

/** Una frase sirve si es una oración, no una etiqueta, un pie ni un número. */
const pareceFrase = (s) => {
  const t = String(s || '').trim();
  if (t.length < 40 || t.length > 700) return false;
  if (RE_PIE.test(t)) return false;
  if (!/[a-záéíóúñ]/.test(t)) return false;                       // todo mayúsculas: es un título
  if (t.split(/\s+/).length < 6) return false;                    // "1.290 — meta 1.200": es un dato
  if (/^[\d\s.,%:-]+$/.test(t)) return false;
  return true;
};

/* Encabezados y viñetas que dicen de qué lado está lo que viene abajo. Es la
   señal más confiable: más que adivinar por palabras, conviene creerle al
   título que la propia planilla le puso al bloque. */
const RE_LADO_BIEN = /^(lo que si cumple|si cumple|fortalez|logros|lo bueno|lo que hizo bien|cumple|aspectos positivos|destacad)/;
const RE_LADO_MAL  = /^(lo que no cumple|no cumple|a mejorar|a corregir|a vigilar|errores|debilidad|oportunidades de mejora|recomendaciones|que hacer|plan de|pendiente|riesgo|alerta)/;

/** +1 si el encabezado habla de lo bueno, -1 de lo malo, 0 si no se sabe. */
function ladoDeTitulo(s) {
  const t = normTxt(String(s || '').replace(/^[\s•·➖✅❌⚠️🚨]+/, ''));
  if (RE_LADO_BIEN.test(t)) return 1;
  if (RE_LADO_MAL.test(t)) return -1;
  return 0;
}

const quitarViñeta = (s) => String(s).replace(/^[\s•·➖✅❌⚠️🚨⚡🏆⭐]+/, '').trim();

/**
 * Junta las líneas de un párrafo en frases. En el Excel un párrafo largo viene
 * partido en varios renglones, así que una línea que no empieza con viñeta
 * continúa la anterior.
 */
function frasesDeParrafo(lineas) {
  const out = [];
  let actual = null;
  for (const linea0 of lineas) {
    const linea = String(linea0 || '').trim();
    if (!linea) continue;
    const conViñeta = /^[•·➖✅❌⚠️🚨]/.test(linea);
    const signo = conViñeta ? (/^✅/.test(linea) ? 1 : /^[❌⚠️🚨]/.test(linea) ? -1 : 0) : 0;
    const limpia = quitarViñeta(linea);
    // Un encabezado suelto ("✅ LO QUE SÍ CUMPLE") marca el lado, no es una frase.
    if (conViñeta && limpia.length < 60 && ladoDeTitulo(limpia)) {
      out.push({ encabezado: ladoDeTitulo(limpia) });
      actual = null;
      continue;
    }
    // "➖ NO INCIDE EN EL PLUS": ni de un lado ni del otro. Cierra la sección.
    if (/^➖/.test(linea)) { out.push({ encabezado: 0 }); actual = null; continue; }
    if (conViñeta || !actual) { actual = { texto: limpia, signo }; out.push(actual); }
    else actual.texto += ' ' + limpia;
  }
  return out;
}

/**
 * Lee del archivo, por persona, lo que hizo bien y lo que tiene que corregir.
 * `conocidas` es el equipo real: sin eso no se puede saber si "Arami" es una
 * persona o un bot.
 */
export function leerNarrativa(buffer, conocidas = []) {
  const indice = indicePersonas(conocidas);
  if (!indice.size) return [];

  /* Para buscar dentro de una frase hace falta el revés del índice: de cada
     persona, las palabras con las que la planilla la puede llamar. */
  const porPersona = new Map();   // nombre canónico -> { persona, claves:[] }
  for (const [clave, p] of indice) {
    const k = p.nombre || clave;
    if (!porPersona.has(k)) porPersona.set(k, { persona: p, claves: [] });
    porPersona.get(k).claves.push(clave);
  }

  const wb = XLSX.read(buffer, { type: 'buffer' });
  const hojaFortalezas = wb.SheetNames.find((h) => /fortalez/i.test(normTxt(h)));
  const acumulado = new Map();    // nombre -> { persona, bien:Set, mal:Set }

  for (const nombreHoja of wb.SheetNames) {
    if (nombreHoja === hojaFortalezas) continue;              // esa la lee leerFortalezas
    if (RE_HOJA_IGNORADA.test(normTxt(nombreHoja))) continue;
    const ws = wb.Sheets[nombreHoja]; if (!ws) continue;
    const m = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: null, raw: false });

    /* Si la hoja es la revisión de una sola persona, su texto habla de ella
       aunque no repita el nombre en cada frase. */
    const dueno = personaDeHoja(nombreHoja, indice);
    let contexto = 0;   // de qué lado viene hablando la sección actual

    for (const b of bloquesDeHoja(m)) {
      if (b.tipo === 'titulo') { contexto = ladoDeTitulo(b.texto); continue; }
      if (b.tipo === 'tabla') continue;        // los números ya se ven en pantalla
      for (const item of frasesDeParrafo(b.lineas)) {
        if (item.encabezado !== undefined) { contexto = item.encabezado; continue; }
        const frase = item.texto;
        if (!pareceFrase(frase)) continue;
        const t = normTxt(frase);

        // ¿a quién nombra?
        let nombradas = [];
        for (const [k, v] of porPersona) {
          if (v.claves.some((c) => new RegExp(`(^| )${escRe(c)}( |$)`).test(t))) nombradas.push([k, v.persona]);
        }
        // Una frase que nombra a medio equipo es del equipo, no de nadie.
        if (nombradas.length > 3) continue;

        /* El lado lo dice la planilla: la viñeta (✅/❌), la etiqueta de la
           propia frase ("Fortalezas:", "A vigilar:") o el título de la sección
           ("LO QUE NO CUMPLE"). Solo cuando la frase nombra a alguien de
           refilón —"Ezequiel y Matías están bajo 7,5"— se mira el vocabulario,
           porque ahí no hay sección que la encuadre. Si nada de eso alcanza,
           la frase se deja afuera antes que ponerla del lado equivocado. */
        let lado = item.signo || ladoDeTitulo(frase) || contexto;
        if (!lado) {
          if (!nombradas.length) continue;
          const bien = (t.match(RE_BIEN) || []).length;
          const mal = (t.match(RE_MAL) || []).length;
          if (bien === mal) continue;
          lado = mal > bien ? -1 : 1;
        }

        if (!nombradas.length) {
          if (!dueno) continue;
          nombradas = [[dueno.nombre, dueno]];
        }
        for (const [k, persona] of nombradas) {
          if (!acumulado.has(k)) acumulado.set(k, { persona, bien: new Set(), mal: new Set() });
          acumulado.get(k)[lado > 0 ? 'bien' : 'mal'].add(frase);
        }
      }
    }
  }

  const out = [];
  for (const [, v] of acumulado) {
    const bien = [...v.bien].slice(0, 5);
    const mal = [...v.mal].slice(0, 5);
    if (!bien.length && !mal.length) continue;
    out.push({
      persona: v.persona.nombre,
      usuarioId: v.persona.id ?? null,
      fortalezas: bien.join('\n'),
      errores: mal.join('\n')
    });
  }
  return out;
}

const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* =========================================================
   Hoja propia de una persona, leída por bloques.

   La hoja de revisión de la supervisión cambia de formato mes a
   mes: un mes trae 7 secciones, otro 4, y las tablas no están
   nunca en la misma fila. Así que no se busca un formato: se
   recorre la hoja de arriba abajo y se va anotando qué es cada
   cosa —un título, un párrafo o una tabla— para después
   mostrarla en pantalla tal como viene.
   ========================================================= */

/** ¿De quién es esta hoja? "Revisión Lucia Velázquez" -> Lucia. */
function personaDeHoja(nombreHoja, indice) {
  const limpio = normTxt(nombreHoja)
    .replace(/^(revision|revisiones|hoja|panel|detalle|ficha|evaluacion|desempeno) (de )?/, '')
    .replace(/ (supervisora?|asesora?|senior|gerencia)$/, '')
    .trim();
  if (!limpio) return null;
  const directo = indice.get(limpio);
  if (directo) return directo;
  // "Revisión Lucia Velázquez" puede traer el nombre con otro orden o incompleto
  for (const [clave, p] of indice) {
    if (clave.length < 4) continue;
    if (limpio === clave || limpio.includes(clave + ' ') || limpio.endsWith(' ' + clave)) return p;
  }
  // nombre de pila suelto
  const pila = limpio.split(' ')[0];
  return (pila.length > 2 && indice.get(pila)) || null;
}

/**
 * Lee las hojas que pertenecen a una sola persona y devuelve su contenido
 * en bloques: { tipo:'titulo'|'texto'|'tabla' }.
 */
export function leerHojasPersona(buffer, conocidas = []) {
  const indice = indicePersonas(conocidas);
  if (!indice.size) return [];
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const out = [];

  for (const nombreHoja of wb.SheetNames) {
    const persona = personaDeHoja(nombreHoja, indice);
    if (!persona) continue;
    const ws = wb.Sheets[nombreHoja]; if (!ws) continue;
    const m = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: null, raw: false });
    const bloques = bloquesDeHoja(m);
    if (!bloques.length) continue;

    /* El título de la hoja es su primera línea; se saca del cuerpo para que no
       aparezca dos veces en pantalla. */
    let titulo = '';
    const primero = bloques[0];
    if (primero && primero.tipo === 'titulo') { titulo = primero.texto; bloques.shift(); }
    else if (primero && primero.tipo === 'texto' && primero.lineas.length) {
      titulo = primero.lineas[0];
      primero.lineas = primero.lineas.slice(1);
      if (!primero.lineas.length) bloques.shift();
    }

    out.push({ persona: persona.nombre, usuarioId: persona.id ?? null, hoja: nombreHoja, titulo, bloques });
  }
  return out;
}

/** Recorre la matriz de una hoja y la parte en títulos, párrafos y tablas. */
function bloquesDeHoja(m) {
  const bloques = [];
  let texto = null, tabla = null;
  const cerrar = () => {
    if (texto && texto.lineas.length) bloques.push(texto);
    if (tabla && tabla.filas.length) bloques.push(limpiarTabla(tabla));
    texto = null; tabla = null;
  };

  for (const fila0 of m) {
    const fila = (fila0 || []).map((c) => (c === null || c === undefined ? '' : String(c).trim()));
    const llenas = fila.filter((s) => s).length;

    if (!llenas) { cerrar(); continue; }

    if (llenas === 1) {
      const linea = fila.find((s) => s);
      // Dentro de una tabla, una línea sola es la explicación de la fila
      // anterior: así una recomendación con su párrafo debajo no parte la tabla.
      if (tabla && tabla.filas.length && !esTitulo(linea)) {
        const u = tabla.filas[tabla.filas.length - 1];
        u.detalle = u.detalle ? `${u.detalle} ${linea}` : linea;
        continue;
      }
      if (esTitulo(linea)) { cerrar(); bloques.push({ tipo: 'titulo', texto: linea }); continue; }
      if (tabla) cerrar();
      if (!texto) texto = { tipo: 'texto', lineas: [] };
      texto.lineas.push(linea);
      continue;
    }

    // Dos o más celdas: tabla.
    if (texto) { if (texto.lineas.length) bloques.push(texto); texto = null; }
    if (!tabla) {
      // Si la primera fila ya trae números puros, no es un encabezado: es una
      // lista de "dato: valor" (como "Chats propios cerrados | 767"), sin
      // cabecera. Un título sí puede tener cifras ("Abiertos >7 d"), así que
      // solo cuenta la celda que es únicamente un número.
      const resto = fila.slice(1).filter((c) => c);
      const puros = resto.filter((c) => toNum(c) !== null && /^[\s\d.,%$()+-]+$/.test(c)).length;
      const esDato = resto.length > 0 && puros >= Math.ceil(resto.length / 2);
      tabla = esDato
        ? { tipo: 'tabla', cabecera: [], filas: [{ celdas: fila.slice(), detalle: '' }] }
        : { tipo: 'tabla', cabecera: fila.slice(), filas: [] };
      continue;
    }
    tabla.filas.push({ celdas: fila.slice(), detalle: '' });
  }
  cerrar();

  // Un párrafo muy corto y suelto no aporta nada en pantalla.
  return bloques.filter((b) => b.tipo !== 'texto' || b.lineas.join(' ').length > 15);
}

/** Saca de una tabla las columnas que quedaron vacías en todas sus filas. */
function limpiarTabla(t) {
  const ancho = Math.max(t.cabecera.length, ...t.filas.map((f) => f.celdas.length));
  const usadas = [];
  for (let c = 0; c < ancho; c++) {
    const hay = (t.cabecera[c] || '') || t.filas.some((f) => (f.celdas[c] || ''));
    if (hay) usadas.push(c);
  }
  return {
    tipo: 'tabla',
    cabecera: usadas.map((c) => t.cabecera[c] || ''),
    filas: t.filas.map((f) => ({ celdas: usadas.map((c) => f.celdas[c] || ''), detalle: f.detalle }))
  };
}

/* =========================================================
   Último recurso: el resumen que sale de los propios puntajes.

   Si el archivo no escribió nada sobre alguien —pasa seguido con
   quien tuvo un mes sin sobresaltos—, al menos se le puede decir
   en qué criterios quedó más alto y en cuáles más bajo. Esto no
   es texto inventado: son sus propios números del archivo,
   ordenados, y en pantalla se aclara de dónde salen.
   ========================================================= */

/** Un número como lo escribe la planilla: 7,54 con coma. */
const conComa = (n) => {
  const x = Number(n);
  // Un puntaje de calidad se escribe con decimal aunque sea redondo: 8,0 y no 8.
  const s = Number.isInteger(x) && Math.abs(x) <= 10 ? x.toFixed(1) : String(Number(x.toFixed(2)));
  return s.replace('.', ',');
};

/**
 * A partir del desglose de calidad (lo que devuelve leerCriterios), arma para
 * cada persona una línea con sus criterios más altos y otra con los más bajos.
 */
export function resumenDeCriterios(crit) {
  if (!crit || !Array.isArray(crit.criterios) || crit.criterios.length < 3) return [];
  const porPersona = new Map();
  for (const c of crit.criterios) {
    const nombre = String(c.nombre || '').trim();
    if (!nombre || RE_TOTAL.test(nombre)) continue;
    for (const [texto, valor] of Object.entries(c.valores || {})) {
      if (valor === null || valor === undefined) continue;
      if (!porPersona.has(texto)) porPersona.set(texto, []);
      porPersona.get(texto).push({ nombre, valor });
    }
  }

  const deTexto = new Map((crit.personas || []).map((p) => [p.texto, p]));
  const out = [];
  for (const [texto, lista] of porPersona) {
    if (lista.length < 3) continue;
    const orden = lista.slice().sort((a, b) => b.valor - a.valor);
    const altos = orden.slice(0, 2);
    const bajos = orden.slice(-2).reverse();
    const p = deTexto.get(texto);
    const di = (x) => `${x.nombre} (${conComa(x.valor)})`;
    out.push({
      persona: (p && p.sugerido) || texto,
      usuarioId: (p && p.usuarioId) || null,
      fortalezas: `Tus criterios más altos del periodo: ${altos.map(di).join(' y ')}.`,
      errores: `Tus criterios más bajos del periodo: ${bajos.map(di).join(' y ')}. Ahí está el margen para subir el promedio.`
    });
  }
  return out;
}
