/* =============================================================
   Cálculo de desempeño.
   Traduce números en un resultado que cualquiera pueda leer:
   cumple / no cumple, escala de plus, y qué hacer para mejorar.
   ============================================================= */

export const ESCALA = [
  { min: 1.00, clave: 'EXCELENTE', color: 'good',    plus: 'Plus total — incentivo completo',        desc: 'Cumpliste todos los indicadores. Desempeño sobresaliente.' },
  { min: 0.66, clave: 'BUENO',     color: 'warning', plus: 'Plus parcial — 50% del incentivo',       desc: 'Buen desempeño, con una oportunidad de mejora clara.' },
  { min: 0.33, clave: 'MALO',      color: 'serious', plus: 'Sin plus — revisión con Gerencia',       desc: 'Se requiere un plan de acción para el próximo periodo.' },
  { min: 0.00, clave: 'CRÍTICO',   color: 'critical',plus: 'Sin plus — revisión urgente con Gerencia', desc: 'No se alcanzó ningún indicador. Requiere intervención inmediata.' }
];

/* Íconos y títulos de los destacados, según el tipo de indicador. */
export function tituloDestacado(metrica) {
  const n = metrica.nombre || '';
  if (/tiempo|respuesta|espera|demora/i.test(n)) return { icono: '⚡', titulo: 'MVP Velocidad' };
  if (/calidad|score|puntaje/i.test(n))          return { icono: '⭐', titulo: 'MVP Calidad' };
  if (/chat|conversacion|ticket|caso|atencion/i.test(n)) return { icono: '📊', titulo: 'MVP Volumen' };
  if (/venta|cierre|conversion/i.test(n))        return { icono: '💰', titulo: 'MVP Ventas' };
  return { icono: '🏅', titulo: 'MVP ' + n };
}

/**
 * Destacados de un periodo: el mejor de cada indicador principal
 * y el mejor asesor general.
 * @param {Array}  metricas
 * @param {Array}  personas  [{ id, nombre, puesto, avatar, valores }]
 */
export function destacados(metricas, personas) {
  const principales = metricas.filter((m) => m.principal);
  const promedios = {};
  for (const m of metricas) {
    const vs = personas.map((p) => p.valores[m.id]).filter((v) => v !== null && v !== undefined);
    promedios[m.id] = vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
  }

  // Un MVP por indicador principal
  const porIndicador = principales.map((m) => {
    const conValor = personas.filter((p) => p.valores[m.id] !== null && p.valores[m.id] !== undefined);
    if (!conValor.length) return null;
    const mejor = conValor.reduce((a, b) =>
      (m.direccion === 'menor' ? Number(b.valores[m.id]) < Number(a.valores[m.id])
                               : Number(b.valores[m.id]) > Number(a.valores[m.id])) ? b : a);
    // solo se premia si además cumple la meta
    if (cumple(mejor.valores[m.id], m) === false) return null;
    return {
      metricaId: m.id, metrica: m.nombre, unidad: m.unidad, decimales: m.decimales,
      ...tituloDestacado(m),
      usuarioId: mejor.id, nombre: mejor.nombre, puesto: mejor.puesto, avatar: mejor.avatar || null,
      valor: Number(mejor.valores[m.id]),
      promedioEquipo: promedios[m.id]
    };
  }).filter(Boolean);

  /* Mejor asesor del periodo: el que ganó más indicadores principales (más MVP).
     Si empatan, decide quién cumplió más metas y, si sigue el empate, el promedio
     de avance. Se mira sobre los tres indicadores principales, no sobre uno solo. */
  let general = null;
  const puntuados = personas.map((p) => {
    const ev = evaluar(metricas, p.valores, promedios, p);
    const avs = ev.detalle.filter((d) => d.principal && d.avance !== null && !d.exento).map((d) => d.avance);
    return {
      p, cumplidos: ev.cumplidos, total: ev.total,
      prom: avs.length ? avs.reduce((a, b) => a + b, 0) / avs.length : 0,
      mvps: porIndicador.filter((x) => x.usuarioId === p.id).length
    };
  }).filter((x) => x.total > 0);

  if (puntuados.length > 1) {
    puntuados.sort((a, b) => (b.mvps - a.mvps) || (b.cumplidos - a.cumplidos) || (b.prom - a.prom));
    const g = puntuados[0];
    // tiene que haber ganado al menos un indicador principal
    if (g.mvps > 0) {
      general = {
        usuarioId: g.p.id, nombre: g.p.nombre, puesto: g.p.puesto, avatar: g.p.avatar || null,
        cumplidos: g.cumplidos, total: g.total, promedio: g.prom,
        mvps: g.mvps, principales: principales.length,
        icono: '🏆', titulo: 'Mejor asesor del periodo'
      };
    }
  }

  return { general, porIndicador };
}

export function cumple(valor, metrica) {
  if (valor === null || valor === undefined || metrica.meta === null || metrica.meta === undefined) return null;
  return metrica.direccion === 'menor' ? Number(valor) <= Number(metrica.meta) : Number(valor) >= Number(metrica.meta);
}

/** Porcentaje de avance hacia la meta, acotado a 0–150 para que un outlier no distorsione. */
export function avance(valor, metrica) {
  if (valor === null || valor === undefined || !metrica.meta || Number(metrica.meta) === 0) return null;
  const v = Number(valor), m = Number(metrica.meta);
  const r = metrica.direccion === 'menor' ? (v <= 0 ? 1.5 : m / v) : v / m;
  return Math.max(0, Math.min(1.5, r)) * 100;
}

export function fmt(valor, metrica) {
  if (valor === null || valor === undefined) return '—';
  const d = metrica?.decimales ?? 1;
  return Number(valor).toLocaleString('es-PY', { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** Cuánto falta para llegar a la meta, en palabras. */
export function brecha(valor, metrica) {
  if (valor === null || !metrica.meta) return null;
  const v = Number(valor), m = Number(metrica.meta);
  if (metrica.direccion === 'menor') {
    if (v <= m) return null;
    return { falta: v - m, texto: `Tenés que bajar ${fmt(v - m, metrica)} ${metrica.unidad || ''}`.trim() };
  }
  if (v >= m) return null;
  return { falta: m - v, texto: `Te faltan ${fmt(m - v, metrica)} ${metrica.unidad || ''} para llegar a la meta`.trim() };
}

/**
 * Evalúa a una persona en un periodo.
 * @param {Array} metricas  configuración de indicadores
 * @param {Object} valores  { metrica_id: valor }
 * @param {Object} promedios { metrica_id: promedio del equipo }
 */
export function evaluar(metricas, valores, promedios = {}, persona = null) {
  // A la supervisión no se le evalúan los indicadores marcados como
  // "no aplica a supervisión" (el volumen, típicamente).
  const exento = (m) => !!m.exime_supervision && persona && persona.rol === 'supervisor';

  const detalle = metricas.map((m) => {
    const valor = valores[m.id] ?? null;
    const ok = cumple(valor, m);
    const av = avance(valor, m);
    const br = brecha(valor, m);
    const prom = promedios[m.id] ?? null;
    let vsEquipo = null;
    if (valor !== null && prom !== null && Number(prom) !== 0) {
      const dif = ((Number(valor) - Number(prom)) / Math.abs(Number(prom))) * 100;
      const mejor = m.direccion === 'menor' ? dif < 0 : dif > 0;
      const mag = Math.abs(dif);
      vsEquipo = {
        dif, mejor,
        texto: mag < 2 ? 'En línea con el promedio del equipo'
          : `${mag.toFixed(0)}% ${mejor ? 'mejor' : 'peor'} que el promedio del equipo`
      };
    }
    return { ...m, valor, cumple: exento(m) ? null : ok, exento: exento(m),
             avance: av, brecha: exento(m) ? null : br, promedioEquipo: prom, vsEquipo };
  });

  const principales = detalle.filter((d) => d.principal && d.cumple !== null);
  const cumplidos = principales.filter((d) => d.cumple).length;
  const total = principales.length;
  const ratio = total ? cumplidos / total : 0;
  const nivel = total ? ESCALA.find((e) => ratio >= e.min) : null;

  // Qué mejorar: primero los indicadores principales incumplidos, después el resto,
  // ordenados por qué tan lejos están de la meta.
  const mejorar = detalle
    .filter((d) => d.cumple === false)
    .sort((a, b) => (b.principal - a.principal) || ((a.avance ?? 0) - (b.avance ?? 0)))
    .map((d) => ({
      nombre: d.nombre,
      principal: d.principal,
      valor: d.valor,
      meta: d.meta,
      unidad: d.unidad,
      decimales: d.decimales,
      texto: d.brecha ? d.brecha.texto : `Estás por debajo de la meta de ${fmt(d.meta, d)} ${d.unidad || ''}`.trim(),
      consejo: d.consejo || ''
    }));

  const logros = detalle
    .filter((d) => d.cumple === true)
    .sort((a, b) => (b.avance ?? 0) - (a.avance ?? 0))
    .map((d) => ({ nombre: d.nombre, valor: d.valor, meta: d.meta, unidad: d.unidad, decimales: d.decimales, avance: d.avance }));

  return { detalle, cumplidos, total, ratio, nivel, mejorar, logros };
}
