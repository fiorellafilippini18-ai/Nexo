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

    // ¿la columna del nombre?
    let colNombre = fila.findIndex((c) => RE_NOMBRE_COL.test(String(c ?? '')));
    if (colNombre < 0) colNombre = 0;

    // cuántas filas de datos hay debajo
    let filas = 0, numericas = 0, nombresBuenos = 0;
    for (let j = i + 1; j < matriz.length; j++) {
      const f = matriz[j] || [];
      if (vacio(f)) { if (filas > 0) break; else continue; }
      const nombre = String(f[colNombre] ?? '').trim();
      if (!nombre) break;
      if (RE_TOTAL.test(nombre)) continue;
      filas++;
      if (pareceNombre(nombre)) nombresBuenos++;
      numericas += f.filter((c) => toNum(c) !== null).length;
    }
    if (filas < 2) continue;
    // si la mayoría de las "personas" son frases largas, no es una tabla de personas
    if (nombresBuenos < filas * 0.7) continue;
    const puntaje = filas * 2 + numericas + (RE_NOMBRE_COL.test(String(fila[colNombre] ?? '')) ? 20 : 0);
    if (!mejor || puntaje > mejor.puntaje) mejor = { headerRow: i, colNombre, filas, puntaje };
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

  hojas.sort((a, b) => b.puntaje - a.puntaje);
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
  const base = { direccion: menor ? 'menor' : 'mayor', meta: null, unidad: '', decimales: 1, principal: false, consejo: (clave && CONSEJOS[clave]) || '' };
  if (clave === 'chats')   return { ...base, meta: 800,  unidad: 'chats', decimales: 0, principal: true };
  if (clave === 'calidad') return { ...base, meta: 7,    unidad: 'puntos', decimales: 2, principal: true };
  if (clave === 'tiempo')  return { ...base, direccion: 'menor', meta: 35, unidad: 'min', decimales: 1, principal: true };
  const nums = valores.filter((v) => v !== null);
  if (nums.length && Math.max(...nums) <= 10) return { ...base, meta: 7, unidad: 'puntos', decimales: 2 };
  return base;
}
