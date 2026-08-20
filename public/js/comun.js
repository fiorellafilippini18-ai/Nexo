/* Utilidades compartidas por las dos pantallas. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', err);
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2600);
}

async function api(url, opts = {}) {
  const o = { ...opts };
  if (o.body && !(o.body instanceof FormData)) {
    o.headers = { 'Content-Type': 'application/json', ...(o.headers || {}) };
    o.body = JSON.stringify(o.body);
  }
  const r = await fetch(url, o);
  if (r.status === 401) { location.href = '/'; throw new Error('Sesión vencida'); }
  const ct = r.headers.get('content-type') || '';
  const d = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error((d && d.error) || 'Error del servidor');
  return d;
}

const nfmt = (v, dec = 1) =>
  v === null || v === undefined ? '—'
    : Number(v).toLocaleString('es-PY', { minimumFractionDigits: dec, maximumFractionDigits: dec });

const iniciales = (n) => String(n || '?').split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();

/** Foto de perfil, o las iniciales si todavía no cargó ninguna. */
const avatarHTML = (persona, clase = '') =>
  `<span class="avatar ${clase}">${persona && persona.avatar
    ? `<img src="${esc(persona.avatar)}" alt="">`
    : esc(iniciales(persona && persona.nombre))}</span>`;

/* =========================================================
   Marca de la plataforma
   ========================================================= */
const Marca = {
  nombre: 'Nexo',
  lema: 'Desempeño & resultados',
  paleta: 'indigo',       // la de la plataforma
  paletaPersonal: 'auto', // 'auto' sigue a la de la plataforma

  /** La que realmente se pinta. */
  get paletaEfectiva() {
    return this.paletaPersonal === 'auto' ? this.paleta : this.paletaPersonal;
  },

  aplicar(m) {
    if (m) {
      this.nombre = m.marca || this.nombre;
      this.lema = m.lema || this.lema;
      if (m.paleta) this.paleta = m.paleta;
    }
    const pal = this.paletaEfectiva;
    if (pal && pal !== 'indigo') document.documentElement.setAttribute('data-palette', pal);
    else document.documentElement.removeAttribute('data-palette');
    document.title = `${this.nombre} — ${this.lema}`;
    const t = $('#marcaT'), l = $('#marcaS'), lg = $('#marcaLogo');
    if (t) t.textContent = this.nombre;
    if (l) l.textContent = this.lema;
    if (lg) inicialDelLogo(lg, this.nombre.slice(0, 1).toUpperCase());
  }
};

/** El logo trae la "N" dibujada a mano, idéntica a la del ícono de la pestaña.
 *  Si algún día la marca empieza con otra letra, mostramos esa letra en texto. */
function inicialDelLogo(caja, letra) {
  const ene = caja.querySelector('.ene'), ini = caja.querySelector('.ini');
  if (!ene || !ini) return;
  const esN = letra === 'N';
  ene.classList.toggle('oculto', !esN);
  ini.classList.toggle('oculto', esN);
  ini.textContent = letra;
}

/* Las paletas disponibles: clave, nombre visible y los dos colores de la muestra.
   Para sumar una nueva alcanza con agregarla acá y definirla en app.css. */
const PALETAS = [
  ['indigo',  'Índigo',  '#3a24c4', '#e9e2fb'],
  ['rosa',    'Rosa',    '#d81b60', '#fbe4ee'],
  ['lavanda', 'Lavanda', '#6d3ae8', '#f0e9fc']
];
const muestraDe = (p) => (PALETAS.find(([v]) => v === p) || PALETAS[0]).slice(2);


/* =========================================================
   Progreso hacia la meta del mes.
   Se usa igual en el panel de supervisión y en el del colaborador:
   el servidor ya decide cuántas filas manda según los permisos.
   ========================================================= */
function progresoHTML(d) {
  if (!d || !d.filas || !d.filas.length) {
    return `<div class="card"><h2>Progreso por agente</h2>
      <div class="vacio">Todavía no hay datos cargados en este periodo.</div></div>`;
  }
  const ind = d.indicador;
  const meta = ind && ind.meta !== null && ind.meta !== undefined ? Number(ind.meta) : null;
  const nf = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('es-PY', { maximumFractionDigits: 0 }));

  const fila = (f) => `<tr class="${f.esMio ? 'yo' : ''}">
      <td><div class="who">${avatarHTML(f)}<div>
        <b>${esc(f.nombre)}</b>${f.esMio ? '<span class="pill lima" style="margin-left:7px">sos vos</span>' : ''}
        <small>${esc(f.puesto || '')}</small></div></div></td>
      <td class="num">${nf(f.valor)}</td>
      <td class="num">${f.exento ? '<span class="pill gris">No aplica</span>' : `<b>${nf(f.faltan)}</b>`}</td>
      <td class="nota-larga">${esc(f.nota)}</td>
      ${(f.otros || []).map((o) => `<td class="num">${o.valor === null ? '—'
        : `${nfmt(o.valor, o.decimales)} ${o.cumple === null ? ''
          : o.cumple ? '<span style="color:var(--good)">✓</span>' : '<span style="color:var(--critical)">✕</span>'}`}</td>`).join('')}
    </tr>`;

  const otros = d.filas[0].otros || [];

  let html = `<div class="card">
    <h2>Progreso por agente · ${esc(d.periodo.etiqueta)}</h2>
    <p class="sub">${meta !== null
      ? `Cuánto lleva cada persona y cuánto le falta para la meta de ${nf(meta)} ${esc(ind.unidad || '')} del mes.`
      : 'Cuánto lleva cada persona en el periodo.'}</p>
    <div class="scroll"><div class="tabla-progreso"><table><thead><tr>
      <th>Agente</th>
      <th class="num">${esc(ind ? ind.nombre : 'Valor')}</th>
      <th class="num">Faltan para<br>la meta</th>
      <th>Nota</th>
      ${otros.map((o) => `<th class="num" title="${esc(o.nombre)}">${esc(tituloCortoMet(o.nombre))}</th>`).join('')}
    </tr></thead><tbody>${d.filas.map(fila).join('')}</tbody></table></div></div>`;

  /* ---- el mes cerrado ---- */
  if (d.mes && d.mes.filas.length) {
    const fm = (f) => `<tr class="${f.esMio ? 'yo' : ''}">
        <td><div class="who">${avatarHTML(f)}<div>
          <b>${esc(f.nombre)}</b>${f.esMio ? '<span class="pill lima" style="margin-left:7px">sos vos</span>' : ''}
          <small>${esc(f.puesto || '')}</small></div></div></td>
        <td class="num">${nf(f.valor)}</td>
        <td><span class="pill ${f.clase === 'ok' ? 'good' : f.clase === 'limite' ? 'warning' : f.clase === 'exento' ? 'gris' : 'critical'}">${esc(f.etiqueta || '—')}</span></td>
        <td class="nota-larga"><span style="font-size:15px">${f.emoji || ''}</span> ${esc(f.texto || '')}</td>
      </tr>`;
    html += `<div class="franja-mes">🏁 Datos actualizados del mes
        <span class="sub">— ${esc(d.mes.periodo.etiqueta)}</span></div>
      <div class="scroll"><div class="tabla-progreso"><table><thead><tr>
        <th>Agente</th><th class="num">Total del mes</th><th>Resultado</th><th>${d.completo ? 'Mensaje que le llega' : 'Tu mensaje'}</th>
      </tr></thead><tbody>${d.mes.filas.map(fm).join('')}</tbody></table></div></div>`;
  }

  html += `<p class="sub" style="margin:16px 0 0">${d.completo
    ? 'Vista completa del equipo. Cada colaborador ve únicamente su propia línea.'
    : 'Solo ves tu propia línea: los resultados de tus compañeros son privados.'}</p></div>`;
  return html;
}

/** Los títulos que vienen del Excel suelen ser larguísimos: se recortan en el encabezado. */
const tituloCortoMet = (n) => String(n || '')
  .replace(/\s+en\s+turno\b/i, '')
  .replace(/\s+evaluad[oa]s?\b/i, '')
  .replace(/\s{2,}/g, ' ')
  .trim();


/* =========================================================
   Fortalezas y errores del periodo.
   El texto es el que escribió la supervisión en la planilla:
   se muestra tal cual. Lo que cambia es el encabezado, que le
   habla directamente a la persona cuando es su propia ficha.
   ========================================================= */
function analisisHTML(d) {
  if (!d || !d.filas || !d.filas.length) {
    return `<div class="card"><h2>Fortalezas y errores</h2>
      <div class="vacio">Todavía no hay análisis cargado para este periodo.<br>
        Se completa solo cuando la planilla trae la hoja <b>Fortalezas y Errores</b>.</div></div>`;
  }

  /* --- ficha personal: la propia, hablándole de vos --- */
  const ficha = (f) => {
    const primer = esc(String(f.nombre).split(' ')[0]);
    return `<div class="card">
      <h2>${primer}, así venís en ${esc(d.periodo.etiqueta)}</h2>
      <p class="sub">Escrito por tu supervisión a partir de los números del periodo.</p>
      <div class="analisis">
        <div class="lado bien">
          <div class="t">✓ Lo que estás haciendo bien</div>
          <p>${f.fortalezas ? esc(f.fortalezas) : 'Sin observaciones cargadas para este periodo.'}</p>
        </div>
        <div class="lado corregir">
          <div class="t">↗ ${primer}, esto es lo que tenés que corregir</div>
          <p>${f.errores ? esc(f.errores) : 'Sin puntos a corregir para este periodo. Muy bien.'}</p>
        </div>
      </div>
    </div>`;
  };

  if (!d.completo) return d.filas.map(ficha).join('');

  /* --- vista de quien puede ver a todo el equipo --- */
  const fila = (f) => `<tr class="${f.esMio ? 'yo' : ''}">
      <td><div class="who">${avatarHTML(f)}<div>
        <b>${esc(f.nombre)}</b>${f.esMio ? '<span class="pill lima" style="margin-left:7px">sos vos</span>' : ''}
        <small>${esc(f.puesto || '')}</small></div></div></td>
      <td class="celda-bien">${f.fortalezas ? esc(f.fortalezas) : '—'}</td>
      <td class="celda-corregir">${f.errores ? esc(f.errores) : '—'}</td>
    </tr>`;

  const mia = d.filas.find((f) => f.esMio);
  return `${mia ? ficha(mia) : ''}
    <div class="card">
      <h2>Fortalezas y errores del equipo · ${esc(d.periodo.etiqueta)}</h2>
      <p class="sub">Vista completa. Cada colaborador ve únicamente su propia ficha, redactada hacia él.</p>
      <div class="scroll"><div class="tabla-analisis"><table><thead><tr>
        <th>Agente</th><th>Fortalezas</th><th>Errores a corregir</th>
      </tr></thead><tbody>${d.filas.map(fila).join('')}</tbody></table></div></div>
    </div>`;
}

/** ¿Esta persona puede hacer tal cosa? La gerencia siempre puede. */
const puede = (yo, clave) => !!yo && (yo.rol === 'gerente' || (yo.permisos || []).includes(clave));

/* =========================================================
   Apariencia: modo claro/oscuro y tamaño de texto
   ========================================================= */
const Apariencia = {
  tema: 'claro',
  escala: 100,

  aplicar(tema, escala) {
    if (tema !== undefined) this.tema = tema;
    if (escala !== undefined) this.escala = escala;
    const efectivo = this.tema === 'auto'
      ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro')
      : this.tema;
    document.documentElement.setAttribute('data-theme', efectivo);
    document.documentElement.style.setProperty('--escala', (this.escala / 100).toFixed(2));
  },

  /** Se llama al arrancar, con lo que vino del servidor. */
  iniciar(usuario) {
    Marca.paletaPersonal = usuario.paleta || 'auto';
    this.aplicar(usuario.tema || 'claro', usuario.escala || 100);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (this.tema === 'auto') this.aplicar();
    });
  },

  async guardar(cambios) {
    this.aplicar(cambios.tema, cambios.escala);
    try { await api('/api/preferencias', { method: 'PUT', body: cambios }); } catch (e) { /* se reintenta al próximo cambio */ }
  }
};

/* =========================================================
   Sonido de notificación (generado, sin archivos externos)
   ========================================================= */
const Sonido = {
  activo: true,
  _ctx: null,

  sonar() {
    if (!this.activo) return;
    try {
      this._ctx ||= new (window.AudioContext || window.webkitAudioContext)();
      const ctx = this._ctx;
      if (ctx.state === 'suspended') ctx.resume();
      const ahora = ctx.currentTime;
      // dos notas cortas, tipo campanita
      [[880, 0], [1318.5, 0.13]].forEach(([hz, t]) => {
        const osc = ctx.createOscillator();
        const vol = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = hz;
        vol.gain.setValueAtTime(0, ahora + t);
        vol.gain.linearRampToValueAtTime(0.16, ahora + t + 0.02);
        vol.gain.exponentialRampToValueAtTime(0.0001, ahora + t + 0.42);
        osc.connect(vol).connect(ctx.destination);
        osc.start(ahora + t);
        osc.stop(ahora + t + 0.45);
      });
    } catch (e) { /* el navegador puede bloquear audio hasta el primer clic */ }
  }
};

/* =========================================================
   Redimensionar una foto antes de subirla (queda liviana)
   ========================================================= */
function fotoAdataURL(file, lado = 320) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('El archivo no es una imagen'));
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const min = Math.min(img.width, img.height);
      const c = document.createElement('canvas');
      c.width = c.height = lado;
      const g = c.getContext('2d');
      g.drawImage(img, (img.width - min) / 2, (img.height - min) / 2, min, min, 0, 0, lado, lado);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No pude leer la imagen')); };
    img.src = url;
  });
}

/* =========================================================
   Gráfico de líneas simple, sin librerías externas
   ========================================================= */
function sparkline(host, puntos, opts = {}) {
  const el = typeof host === 'string' ? $(host) : host;
  if (!el) return;
  const vals = puntos.map((p) => p.valor).filter((v) => v !== null && v !== undefined);
  if (vals.length < 2) { el.innerHTML = '<div class="vacio">Todavía no hay suficientes periodos para ver la evolución.</div>'; return; }
  const w = el.clientWidth || 560, h = 200, pl = 50, pr = 20, pt = 16, pb = 32;
  const iw = w - pl - pr, ih = h - pt - pb;
  const mx = Math.max(...vals, opts.meta ?? -Infinity);
  const mn = Math.min(...vals, opts.meta ?? Infinity);
  const pad = (mx - mn) * 0.18 || Math.abs(mx * 0.15) || 1;
  const hi = mx + pad, lo = Math.max(0, mn - pad);
  const X = (i) => pl + (puntos.length === 1 ? iw / 2 : (i * iw) / (puntos.length - 1));
  const Y = (v) => pt + ih - ((v - lo) / ((hi - lo) || 1)) * ih;

  let s = `<svg width="100%" viewBox="0 0 ${w} ${h}" role="img" aria-label="Evolución por periodo">`;
  for (let k = 0; k <= 3; k++) {
    const v = lo + ((hi - lo) * k) / 3, y = Y(v);
    s += `<line x1="${pl}" y1="${y}" x2="${w - pr}" y2="${y}" stroke="var(--grid)" stroke-width="1"/>`;
    s += `<text x="${pl - 9}" y="${y + 4}" fill="var(--muted)" font-size="10.5" text-anchor="end">${nfmt(v, opts.dec ?? 1)}</text>`;
  }
  if (opts.meta !== null && opts.meta !== undefined) {
    const y = Y(opts.meta);
    s += `<line x1="${pl}" y1="${y}" x2="${w - pr}" y2="${y}" stroke="var(--good)" stroke-width="2" stroke-dasharray="5 4"/>`;
    s += `<text x="${w - pr}" y="${y - 7}" fill="var(--good)" font-size="10.5" text-anchor="end" font-weight="700">meta ${nfmt(opts.meta, opts.dec ?? 1)}</text>`;
  }
  const pts = puntos.map((p, i) => (p.valor == null ? null : [X(i), Y(p.valor)])).filter(Boolean);
  if (pts.length > 1) s += `<path d="M${pts.map((p) => p[0] + ' ' + p[1]).join(' L')}" fill="none" stroke="var(--primary)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  puntos.forEach((p, i) => {
    if (p.valor == null) return;
    s += `<circle cx="${X(i)}" cy="${Y(p.valor)}" r="5" fill="var(--primary)" stroke="var(--surface)" stroke-width="2.5"><title>${esc(p.periodo)}: ${nfmt(p.valor, opts.dec ?? 1)}</title></circle>`;
    s += `<text x="${X(i)}" y="${h - 10}" fill="var(--muted)" font-size="10.5" text-anchor="middle">${esc(p.periodo.length > 14 ? p.periodo.slice(0, 13) + '…' : p.periodo)}</text>`;
  });
  s += `<line x1="${pl}" y1="${pt + ih}" x2="${w - pr}" y2="${pt + ih}" stroke="var(--axis)" stroke-width="1"/></svg>`;
  el.innerHTML = s;
}

/* =========================================================
   Panel de ajustes — lo comparten agente y supervisión
   ========================================================= */
function panelAjustes(YO, alGuardarPerfil) {
  return `
  <div class="card">
    <h2>Mi perfil</h2>
    <p class="sub">Así te ven en el sistema.</p>
    <div class="flex" style="gap:20px;align-items:flex-start;margin-bottom:20px">
      <div style="text-align:center">
        <div id="miFoto">${avatarHTML(YO, 'g')}</div>
        <div style="margin-top:11px;display:flex;flex-direction:column;gap:6px">
          <button class="btn sm" id="btnFoto">Cambiar foto</button>
          <button class="btn sm danger ${YO.avatar ? '' : 'oculto'}" id="btnQuitarFoto">Quitar</button>
        </div>
        <input type="file" id="inpFoto" accept="image/*" class="oculto">
      </div>
      <div style="flex:1;min-width:240px">
        <div class="row">
          <div><label class="f">Nombre</label><input id="pfNombre" value="${esc(YO.nombre)}"></div>
          <div><label class="f">Puesto</label><input id="pfPuesto" value="${esc(YO.puesto || '')}"></div>
          <div><label class="f">Email</label><input id="pfEmail" type="email" value="${esc(YO.email || '')}"></div>
          <div><label class="f">Turno</label><input id="pfTurno" placeholder="Ej: Tarde L-V 11:00–20:00" value="${esc(YO.turno || '')}"></div>
        </div>
        <div style="margin-top:15px"><button class="btn primary" id="pfGuardar">Guardar perfil</button></div>
      </div>
    </div>
    <div class="opcion" style="border-top:1px solid var(--grid)">
      <div class="txt"><b>Contraseña</b><span>Cambiala cada tanto.</span></div>
      <button class="btn sm" id="btnAbrirClave">Cambiar</button>
    </div>
    <div id="cajaClave" class="oculto" style="padding-top:6px">
      <div id="claveErr" class="aviso err oculto"></div>
      <div class="row">
        <div><label class="f">Contraseña actual</label><input type="password" id="cActual"></div>
        <div><label class="f">Nueva contraseña</label><input type="password" id="cNueva"></div>
      </div>
      <div style="margin-top:13px"><button class="btn primary" id="cGuardar">Guardar contraseña</button></div>
    </div>
  </div>

  <div class="card">
    <h2>Apariencia</h2>
    <p class="sub">Se guarda en tu usuario: te sigue en cualquier computadora.</p>
    <div class="opcion">
      <div class="txt"><b>Modo de la página</b><span>Claro, oscuro o el que use tu dispositivo.</span></div>
    </div>
    <div class="colores" id="opModo" style="margin-bottom:6px">
      ${[['claro', 'Claro', '#f4f1ff'], ['oscuro', 'Oscuro', '#151033'],
         ['auto', 'Automático', 'linear-gradient(90deg,#f4f1ff 50%,#151033 50%)']]
        .map(([v, t, fondo]) => `<button type="button" class="color-op ${YO.tema === v ? 'on' : ''}" data-tema="${v}">
          <span class="punto" style="background:${fondo}"></span>
          <span><span class="nom">${t}</span></span></button>`).join('')}
    </div>
    <div class="opcion">
      <div class="txt"><b>Paleta de colores</b><span>El tono del sistema. Claro u oscuro se elige arriba.</span></div>
    </div>
    <div class="colores" id="opPaleta" style="margin-bottom:6px">
      ${(() => {
        const elegida = YO.paleta && YO.paleta !== 'auto' ? YO.paleta : Marca.paleta;
        return PALETAS.map(([v, t, a]) => `<button type="button" class="color-op ${elegida === v ? 'on' : ''}" data-mipaleta="${v}">
          <span class="punto" style="background:${a}"></span>
          <span><span class="nom">${t}</span><small>${v === Marca.paleta ? 'la de la plataforma' : ''}</small></span>
        </button>`).join('');
      })()}
    </div>
    <div class="opcion">
      <div class="txt"><b>Tamaño del texto</b><span>Si te cuesta leer, subilo.</span></div>
      <div style="display:flex;align-items:center;gap:12px">
        <input type="range" id="rgEscala" min="85" max="140" step="5" value="${YO.escala || 100}" style="width:190px">
        <b id="lblEscala" style="font-size:13.5px;min-width:46px;text-align:right">${YO.escala || 100}%</b>
      </div>
    </div>
  </div>

  ${puede(YO, 'marca') ? `<div class="card">
    <h2>Nombre de la plataforma</h2>
    <p class="sub">Así se llama el sistema para todo el equipo.</p>
    <div class="row">
      <div><label class="f">Nombre</label><input id="mkNombre" value="${esc(Marca.nombre)}" maxlength="30"></div>
      <div><label class="f">Bajada</label><input id="mkLema" value="${esc(Marca.lema)}" maxlength="60"></div>
    </div>
    <div class="opcion" style="margin-top:6px">
      <div class="txt"><b>Paleta por defecto de la plataforma</b><span>La que ve quien no eligió una propia,
        y la de la pantalla de ingreso. Cada quien puede cambiar la suya desde Apariencia.</span></div>
    </div>
    <div class="colores" id="opPaletaMarca">
      ${PALETAS.map(([v, t, a]) => `<button type="button" class="color-op ${Marca.paleta === v ? 'on' : ''}" data-paleta="${v}">
        <span class="punto" style="background:${a}"></span>
        <span><span class="nom">${t}</span></span></button>`).join('')}
    </div>
    <div style="margin-top:16px"><button class="btn primary" id="mkGuardar">Guardar cambios</button></div>
  </div>` : ''}

  <div class="card">
    <h2>Notificaciones</h2>
    <p class="sub">Cuando la supervisión deja una nota en tu perfil.</p>
    <div class="opcion">
      <div class="txt"><b>Sonido de aviso</b><span>Suena una campanita al llegar una nota nueva.</span></div>
      <label class="switch"><input type="checkbox" id="swSonido" ${YO.sonido ? 'checked' : ''}><i></i></label>
    </div>
    <div class="opcion">
      <div class="txt"><b>Probar el sonido</b><span>Así sabés cómo suena.</span></div>
      <button class="btn sm" id="btnProbar">Reproducir</button>
    </div>
  </div>`;
}

/** Conecta los controles del panel de ajustes. Se llama después de pintarlo. */
function activarAjustes(YO, refrescar) {
  $('#btnFoto').addEventListener('click', () => $('#inpFoto').click());
  $('#inpFoto').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const dataUrl = await fotoAdataURL(f);
      await api('/api/perfil/foto', { method: 'PUT', body: { foto: dataUrl } });
      YO.avatar = dataUrl;
      $('#miFoto').innerHTML = avatarHTML(YO, 'g');
      $('#btnQuitarFoto').classList.remove('oculto');
      toast('Foto actualizada');
      refrescar && refrescar();
    } catch (err) { toast(err.message, true); }
    e.target.value = '';
  });
  $('#btnQuitarFoto').addEventListener('click', async () => {
    await api('/api/perfil/foto', { method: 'PUT', body: { foto: null } });
    YO.avatar = null;
    $('#miFoto').innerHTML = avatarHTML(YO, 'g');
    $('#btnQuitarFoto').classList.add('oculto');
    toast('Foto quitada');
    refrescar && refrescar();
  });

  $('#pfGuardar').addEventListener('click', async () => {
    try {
      const body = { nombre: $('#pfNombre').value, puesto: $('#pfPuesto').value, email: $('#pfEmail').value, turno: $('#pfTurno').value };
      await api('/api/perfil', { method: 'PUT', body });
      Object.assign(YO, body);
      toast('Perfil guardado');
      refrescar && refrescar();
    } catch (e) { toast(e.message, true); }
  });

  $('#btnAbrirClave').addEventListener('click', () => $('#cajaClave').classList.toggle('oculto'));
  $('#cGuardar').addEventListener('click', async () => {
    const err = $('#claveErr'); err.classList.add('oculto');
    try {
      await api('/api/clave', { method: 'POST', body: { actual: $('#cActual').value, nueva: $('#cNueva').value } });
      $('#cActual').value = $('#cNueva').value = '';
      $('#cajaClave').classList.add('oculto');
      toast('Contraseña actualizada');
    } catch (e) { err.textContent = e.message; err.classList.remove('oculto'); }
  });

  $$('[data-tema]').forEach((op) => op.addEventListener('click', () => {
    $$('[data-tema]').forEach((x) => x.classList.toggle('on', x === op));
    YO.tema = op.dataset.tema;
    Apariencia.guardar({ tema: YO.tema });
  }));

  $$('[data-mipaleta]').forEach((op) => op.addEventListener('click', () => {
    $$('[data-mipaleta]').forEach((x) => x.classList.toggle('on', x === op));
    // Elegir la misma que usa la plataforma queda como "seguir a la plataforma":
    // si mañana la gerencia la cambia, esta persona la acompaña.
    YO.paleta = op.dataset.mipaleta === Marca.paleta ? 'auto' : op.dataset.mipaleta;
    Marca.paletaPersonal = YO.paleta;
    Marca.aplicar();
    Apariencia.guardar({ paleta: YO.paleta });
  }));

  $('#rgEscala').addEventListener('input', (e) => {
    YO.escala = Number(e.target.value);
    $('#lblEscala').textContent = YO.escala + '%';
    Apariencia.aplicar(undefined, YO.escala);
  });
  $('#rgEscala').addEventListener('change', () => Apariencia.guardar({ escala: YO.escala }));

  $('#swSonido').addEventListener('change', (e) => {
    YO.sonido = e.target.checked;
    Sonido.activo = YO.sonido;
    Apariencia.guardar({ sonido: YO.sonido });
    if (YO.sonido) Sonido.sonar();
  });
  $('#btnProbar').addEventListener('click', () => { const a = Sonido.activo; Sonido.activo = true; Sonido.sonar(); Sonido.activo = a; });

  let paletaElegida = Marca.paleta;
  $$('[data-paleta]').forEach((op) => op.addEventListener('click', () => {
    $$('[data-paleta]').forEach((x) => x.classList.toggle('on', x === op));
    paletaElegida = op.dataset.paleta;
    Marca.paleta = paletaElegida;
    Marca.aplicar();   // vista en vivo (si elegiste una propia, no cambia nada acá)
  }));

  const mk = $('#mkGuardar');
  if (mk) mk.addEventListener('click', async () => {
    try {
      const m = await api('/api/marca', { method: 'PUT',
        body: { marca: $('#mkNombre').value, lema: $('#mkLema').value, paleta: paletaElegida } });
      Marca.aplicar(m);
      // la aclaración "la de la plataforma" pasa a la paleta recién elegida
      $$('#opPaleta .color-op').forEach((b) => {
        const s = b.querySelector('small');
        if (s) s.textContent = b.dataset.mipaleta === Marca.paleta ? 'la de la plataforma' : '';
      });
      toast('Guardado — el cambio se ve para todo el equipo');
    } catch (e) { toast(e.message, true); }
  });
}

/* =========================================================
   Podio de destacados — se muestra igual al agente y a la supervisión
   ========================================================= */
function podioHTML(d, miId) {
  if (!d || (!d.general && !d.porIndicador.length)) return '';
  const soyGeneral = d.general && d.general.usuarioId === miId;
  const misMvp = d.porIndicador.filter((x) => x.usuarioId === miId);

  let html = '';
  if (soyGeneral || misMvp.length) {
    const que = soyGeneral ? 'el <b>mejor asesor del periodo</b>' : misMvp.map((m) => `<b>${esc(m.titulo)}</b>`).join(' y ');
    html += `<div class="felicitacion"><span class="em">🎉</span>
      <span>¡Felicitaciones! Saliste ${que}.
        <small>Tu nombre aparece destacado para todo el equipo.</small></span></div>`;
  }

  html += `<div class="podio">
    <div class="cabecera"><span class="chip">Destacados</span><h2>Lo mejor de ${esc(d.periodo ? d.periodo.etiqueta : 'este periodo')}</h2></div>
    <p class="lead">Quienes se destacaron del resto. Reconocimiento visible para todo el equipo.</p>`;

  if (d.general) {
    html += `<div class="estrella">
      <span class="corona">🏆</span>
      ${avatarHTML(d.general)}
      <div class="quien">
        <div class="rol">Mejor asesor del periodo</div>
        <div class="nom">${esc(d.general.nombre)}</div>
        <div class="det">${esc(d.general.puesto || 'Agente')} · cumplió los ${d.general.total} indicadores principales
          con un ${Math.round(d.general.promedio)}% de avance promedio</div>
      </div>
    </div>`;
  }

  if (d.porIndicador.length) {
    html += `<div class="mvps">${d.porIndicador.map((m) => `
      <div class="mvp ${m.usuarioId === miId ? 'propio' : ''}">
        <div class="cat"><span>${m.icono}</span>${esc(m.titulo)}</div>
        <div class="av">${avatarHTML(m)}</div>
        <div class="nom">${esc(m.nombre)}</div>
        <div class="val">${nfmt(m.valor, m.decimales)}${m.unidad ? ' ' + esc(m.unidad) : ''}</div>
        <div class="sub">promedio del equipo: ${nfmt(m.promedioEquipo, m.decimales)}${m.unidad ? ' ' + esc(m.unidad) : ''}</div>
      </div>`).join('')}</div>`;
  }

  html += '</div>';
  return html;
}

/* =========================================================
   Presencia: latido al servidor y menú de estado
   ========================================================= */
const Presencia = {
  estado: 'disponible',
  _timer: null,

  iniciar(usuario, alCambiar) {
    this.estado = usuario.presencia || 'disponible';
    this.alCambiar = alCambiar;
    this.latir();
    // un latido cada minuto mantiene el semáforo en verde
    this._timer = setInterval(() => this.latir(), 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.latir(); });
  },

  async latir(estado) {
    try {
      const r = await api('/api/presencia', { method: 'POST', body: { estado } });
      this.estado = r.presencia;
      this.alCambiar && this.alCambiar(this.estado);
    } catch (e) { /* si falla, se reintenta al próximo latido */ }
  },

  async cambiar(estado) {
    await this.latir(estado);
    toast(estado === 'desconectado' ? 'Figurás como desconectada'
      : estado === 'ausente' ? 'Figurás como ausente' : 'Figurás como conectada');
  }
};

const claseSemaforo = (u) =>
  u.activo === false ? 'baja'
    : !u.conectado ? 'off'
      : u.presencia === 'ausente' ? 'aus' : 'on';

const textoSemaforo = (u) =>
  u.activo === false ? 'Dada de baja'
    : !u.conectado ? 'Desconectada'
      : u.presencia === 'ausente' ? 'Ausente' : 'Conectada';

/** Avatar con el puntito de estado encima. */
const avatarEstado = (u, clase = '') =>
  `<span class="avatar-wrap">${avatarHTML(u, clase)}<span class="semaforo ${claseSemaforo(u)}" title="${textoSemaforo(u)}"></span></span>`;

/** Menú que se abre al tocar el pie de la barra lateral. */
function montarMenuUsuario(pie, { alAjustes }) {
  const cerrar = () => { const m = $('.menu-usuario'); if (m) m.remove(); };
  document.addEventListener('click', (e) => { if (!e.target.closest('.pie')) cerrar(); });

  pie.addEventListener('click', (e) => {
    if (e.target.closest('.menu-usuario')) return;
    if ($('.menu-usuario')) return cerrar();

    const m = document.createElement('div');
    m.className = 'menu-usuario';
    m.innerHTML = `
      <div class="tit">Mi estado</div>
      ${[['disponible', 'on', 'Conectada'], ['ausente', 'aus', 'Ausente'], ['desconectado', 'off', 'Aparecer desconectada']]
        .map(([v, c, t]) => `<button data-estado="${v}" class="${Presencia.estado === v ? 'on' : ''}">
          <span class="semaforo ${c}"></span>${t}</button>`).join('')}
      <hr>
      <button data-ir="ajustes">⚙ Mis ajustes</button>
      <button class="salir" data-salir>⇥ Cerrar sesión</button>`;
    pie.appendChild(m);

    m.querySelectorAll('[data-estado]').forEach((b) => b.addEventListener('click', async () => {
      await Presencia.cambiar(b.dataset.estado);
      cerrar();
    }));
    m.querySelector('[data-ir=ajustes]').addEventListener('click', () => { cerrar(); alAjustes && alAjustes(); });
    m.querySelector('[data-salir]').addEventListener('click', async () => {
      await api('/api/logout', { method: 'POST' });
      location.href = '/';
    });
  });
}
