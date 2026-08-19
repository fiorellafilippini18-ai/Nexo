/* Pantalla del colaborador. */
let YO = null, PERIODOS = [], ACTUAL = null, DATOS = null, NOTAS = [], VISTA = 'panel';
let PODIO = null, PALMARES = null;
let ultimaNotaVista = null;

/* Modo "ver como": la supervisión abre /mi-panel?ver=<id> para mirar el panel
   de otra persona exactamente como lo ve ella. Es solo lectura. */
const VER = Number(new URLSearchParams(location.search).get('ver')) || null;
const qs = (extra) => (VER ? (extra ? '&' : '?') + 'usuarioId=' + VER : '');

const TITULOS = {
  panel:     ['Mis resultados', 'Cómo te fue en el periodo'],
  detalle:   ['Detalle por criterio', 'Aspecto por aspecto'],
  evolucion: ['Mi evolución', 'Cómo venís periodo a periodo'],
  notas:     ['Notas del supervisor', 'Mensajes dejados en tu perfil'],
  ajustes:   ['Ajustes', 'Perfil, apariencia y notificaciones']
};

async function iniciar() {
  YO = await api('/api/yo');
  Apariencia.iniciar(YO);
  Sonido.activo = !!YO.sonido;
  Marca.aplicar(YO.marca);
  pintarIdentidad();
  Presencia.iniciar(YO, () => pintarIdentidad());
  montarMenuUsuario($('#pie'), { alAjustes: () => ir('ajustes') });
  if (YO.debe_cambiar && !VER) $('#avisoClave').classList.remove('oculto');

  if (VER) {
    document.body.classList.add('modo-ver');
    $('#avisoVer').classList.remove('oculto');
    const b = $('#nav button[data-v="ajustes"]'); if (b) b.remove();
  }

  PERIODOS = await api('/api/periodos');
  if (PERIODOS.length) {
    $('#periodo').innerHTML = PERIODOS.map((p) => `<option value="${p.id}">${esc(p.etiqueta)}</option>`).join('');
    ACTUAL = PERIODOS[0].id;
    await cargar();
  } else {
    $('#v-panel').innerHTML = '<div class="card"><div class="vacio">Todavía no hay ningún periodo publicado.<br>Tu supervisora te va a avisar cuando esté disponible.</div></div>';
    $('#periodo').closest('div').style.display = 'none';
  }
  await cargarNotas(true);
  setInterval(() => cargarNotas(false), 45000);
}

function pintarIdentidad() {
  $('#pieAvatar').innerHTML = avatarEstado({ ...YO, conectado: Presencia.estado !== 'desconectado', presencia: Presencia.estado });
  $('#pieNombre').textContent = YO.nombre;
  $('#piePuesto').textContent = YO.puesto || 'Colaborador';
}

/** En modo "ver como", los títulos hablan de la otra persona. */
function tituloDe(v) {
  const t = [...TITULOS[v]];
  if (VER && DATOS && DATOS.persona) {
    if (v === 'panel') { t[0] = 'Panel de ' + DATOS.persona.nombre; t[1] = 'Lo que ve en su pantalla'; }
    if (v === 'notas') t[0] = 'Notas recibidas';
    if (v === 'evolucion') t[1] = 'Cómo viene periodo a periodo';
  }
  return t;
}

async function cargar() {
  const [d, podio, palmares] = await Promise.all([
    api('/api/mi-desempeno/' + ACTUAL + qs()),
    api('/api/destacados/' + ACTUAL).catch(() => null),
    api('/api/palmares' + qs()).catch(() => null)
  ]);
  DATOS = d; PODIO = podio; PALMARES = palmares;
  if (VER && d.persona) {
    $('#verNombre').textContent = d.persona.nombre;
    document.title = 'Panel de ' + d.persona.nombre;
  }
  pintar();
  ir(VISTA);
}

/* ================= NOTAS ================= */
async function cargarNotas(primeraVez) {
  try { NOTAS = await api('/api/notas' + qs()); } catch (e) { return; }
  const nuevas = NOTAS.filter((n) => !n.leida).length;
  $('#bNotas').textContent = $('#ptNotas').textContent = nuevas;
  $('#bNotas').classList.toggle('oculto', !nuevas);
  $('#ptNotas').classList.toggle('oculto', !nuevas);

  const ultima = NOTAS.length ? NOTAS[0].id : null;
  if (!VER && !primeraVez && ultima && ultima !== ultimaNotaVista && nuevas) {
    Sonido.sonar();
    toast('Tenés una nota nueva de tu supervisora');
  }
  if (!VER && primeraVez && nuevas) Sonido.sonar();
  ultimaNotaVista = ultima;
  if (VISTA === 'notas') pintarNotas();
}

function pintarNotas() {
  const iconos = { nota: '📝', felicitacion: '🎉', atencion: '⚠️' };
  $('#v-notas').innerHTML = `<div class="card">
    <div class="flex"><div><h2 style="margin:0">Notas en tu perfil</h2>
      <p class="sub" style="margin:3px 0 0">${VER ? 'Las notas que recibió esta persona.' : 'Lo que tu supervisora quiere que sepas.'}</p></div>
      <div class="sp"></div>
      ${!VER && NOTAS.some((n) => !n.leida) ? '<button class="btn sm" id="btnLeidas">Marcar como leídas</button>' : ''}
    </div></div>
    ${NOTAS.length ? NOTAS.map((n) => `<div class="nota ${n.leida ? '' : 'nueva'}">
        <div style="font-size:14.5px">${iconos[n.tipo] || '📝'} ${esc(n.texto)}</div>
        <div class="meta">${esc(n.autor || 'Supervisión')} · ${new Date(n.creada).toLocaleString('es-PY', { dateStyle: 'medium', timeStyle: 'short' })}
          ${n.leida ? '' : ' · <b style="color:var(--primary)">Nueva</b>'}</div>
      </div>`).join('')
    : '<div class="card"><div class="vacio">Todavía no tenés notas.</div></div>'}`;
  const b = $('#btnLeidas');
  if (b) b.addEventListener('click', async () => {
    await api('/api/notas/leidas', { method: 'POST' });
    await cargarNotas(true);
    toast('Notas marcadas como leídas');
  });
}

/* ================= PANEL ================= */
const barColor = (a) => (a >= 100 ? 'var(--good)' : a >= 85 ? 'var(--primary)' : a >= 60 ? 'var(--serious)' : 'var(--critical)');

function tarjeta(m) {
  const ok = m.cumple === true;
  const cls = m.cumple === null ? '' : ok ? 'ok' : 'no';
  return `<div class="kpi ${cls}">
    <div class="n">${esc(m.nombre)}</div>
    <div class="v">${nfmt(m.valor, m.decimales)}${m.unidad ? ` <small>${esc(m.unidad)}</small>` : ''}</div>
    <div class="m">Meta: ${m.direccion === 'menor' ? 'hasta' : 'desde'} ${nfmt(m.meta, m.decimales)}${m.unidad ? ' ' + esc(m.unidad) : ''}</div>
    ${m.avance === null ? '' : `<div class="barra"><i style="width:${Math.min(100, m.avance)}%;background:${barColor(m.avance)}"></i></div>`}
    ${m.cumple === null ? '' : `<div class="estado">${ok ? '✓ Cumplís la meta' : '✕ Todavía no llegás'}${!ok && m.brecha ? ' — ' + esc(m.brecha.texto.toLowerCase()) : ''}</div>`}
    ${m.vsEquipo ? `<div class="cmp" style="color:${m.vsEquipo.mejor ? 'var(--good)' : 'var(--muted)'}">${m.vsEquipo.mejor ? '▲' : '▼'} ${esc(m.vsEquipo.texto)}</div>` : ''}
  </div>`;
}

function pintar() {
  const d = DATOS;
  if (!d) return;
  if (d.sinDatos) {
    $('#v-panel').innerHTML = podioHTML(PODIO, YO.id) +
      `<div class="card"><div class="vacio">No hay datos tuyos cargados en <b>${esc(d.periodo.etiqueta)}</b>.<br>Consultá con tu supervisora.</div></div>`;
    $('#v-detalle').innerHTML = $('#v-evolucion').innerHTML = '';
    return;
  }

  const n = d.nivel;
  const principales = d.detalle.filter((m) => m.principal);
  const secundarios = d.detalle.filter((m) => !m.principal && m.valor !== null);

  /* --- vista principal --- */
  let html = podioHTML(PODIO, YO.id);
  if (PALMARES && PALMARES.mio && PALMARES.mio.total) {
    const m = PALMARES.mio;
    const partes = [];
    if (m.general) partes.push(`<b>${m.general}</b> ${m.general === 1 ? 'vez' : 'veces'} mejor asesor`);
    Object.entries(m.porIndicador).forEach(([t, n]) => partes.push(`<b>${n}</b> ${t}`));
    html += `<div class="card"><h3>Tu palmarés</h3>
      <p class="sub" style="margin:6px 0 0">Sobre ${PALMARES.periodos} periodo(s) publicados: ${partes.join(' · ')}.</p></div>`;
  }
  if (n) {
    html += `<div class="resultado ${n.color}">
      <div class="lbl">Tu resultado — ${esc(d.periodo.etiqueta)}</div>
      <div class="big">${esc(n.clave)}</div>
      <div class="plus">${esc(n.plus)}</div>
      <div class="desc">${esc(n.desc)} Cumpliste <b>${d.cumplidos} de ${d.total}</b> indicadores principales.</div>
    </div>`;
  }
  if (principales.length) {
    html += `<div class="card"><h2>Tus indicadores principales</h2>
      <p class="sub">Estos ${principales.length === 3 ? 'tres' : principales.length} definen si te corresponde el plus del periodo.</p>
      <div class="grid">${principales.map(tarjeta).join('')}</div></div>`;
  }

  html += '<div class="card"><h2>Qué tenés que mejorar</h2>';
  if (!d.mejorar.length) {
    html += `<div class="aviso ok" style="margin-bottom:0">Estás cumpliendo todas las metas del periodo. Muy bien — mantené el ritmo.</div>`;
  } else {
    html += `<p class="sub">Ordenado por lo que más te conviene atacar primero.</p>`;
    html += d.mejorar.map((m) => `
      <div class="mejora ${m.principal ? 'principal' : ''}">
        <div class="t">${esc(m.nombre)} ${m.principal ? '<span class="pill critical" style="margin-left:6px">Indicador principal</span>' : ''}</div>
        <div class="q">Estás en <b>${nfmt(m.valor, m.decimales)}${m.unidad ? ' ' + esc(m.unidad) : ''}</b> y la meta es <b>${nfmt(m.meta, m.decimales)}${m.unidad ? ' ' + esc(m.unidad) : ''}</b>. ${esc(m.texto)}.</div>
        ${m.consejo ? `<div class="c"><b>Cómo mejorarlo:</b> ${esc(m.consejo)}</div>` : ''}
      </div>`).join('');
  }
  html += '</div>';

  if (d.logros.length) {
    html += `<div class="card"><h2>Lo que estás haciendo bien</h2>
      <p class="sub">Metas alcanzadas este periodo.</p>
      ${d.logros.map((l) => `<div class="logro"><span class="tick">✓</span>
        <span><b>${esc(l.nombre)}</b> — ${nfmt(l.valor, l.decimales)}${l.unidad ? ' ' + esc(l.unidad) : ''}
        <span style="color:var(--muted)">(meta ${nfmt(l.meta, l.decimales)})</span></span></div>`).join('')}
    </div>`;
  }
  if (d.comentario) {
    html += `<div class="card"><h2>Comentario de tu supervisora</h2>
      <p style="white-space:pre-wrap;margin:0">${esc(d.comentario)}</p></div>`;
  }
  if (d.posicion && d.deCuantos > 1) {
    html += `<div class="card"><h3>Tu posición en el equipo</h3>
      <p class="sub" style="margin:0">Quedaste <b>${d.posicion}º de ${d.deCuantos}</b> según indicadores cumplidos. Los datos de tus compañeros son privados.</p></div>`;
  }
  $('#v-panel').innerHTML = html;

  /* --- detalle --- */
  $('#v-detalle').innerHTML = secundarios.length ? `<div class="card">
    <h2>Detalle por criterio</h2>
    <p class="sub">Cómo te fue en cada aspecto evaluado. Los más bajos van primero.</p>
    <div class="scroll"><table><thead><tr>
      <th>Criterio</th><th class="num">Tu puntaje</th><th class="num">Meta</th><th>Avance</th><th></th>
    </tr></thead><tbody>${secundarios.slice().sort((a, b) => (a.avance ?? 999) - (b.avance ?? 999)).map((m) => `<tr>
        <td>${esc(m.nombre)}</td>
        <td class="num"><b>${nfmt(m.valor, m.decimales)}</b></td>
        <td class="num">${m.meta === null ? '—' : nfmt(m.meta, m.decimales)}</td>
        <td style="min-width:160px">${m.avance === null ? '—' :
          `<div class="flex" style="gap:10px"><div class="mini" style="flex:1"><i style="width:${Math.min(100, m.avance)}%;background:${barColor(m.avance)}"></i></div>
           <span style="font-variant-numeric:tabular-nums;font-size:13px">${Math.round(m.avance)}%</span></div>`}</td>
        <td>${m.cumple === null ? '' : m.cumple ? '<span class="pill good">Cumple</span>' : '<span class="pill critical">Bajo meta</span>'}</td>
      </tr>`).join('')}</tbody></table></div></div>`
    : '<div class="card"><div class="vacio">No hay criterios adicionales cargados en este periodo.</div></div>';

  /* --- evolución --- */
  const met = principales[0] || d.detalle.find((m) => m.valor !== null);
  $('#v-evolucion').innerHTML = met && d.historial.length > 1
    ? `<div class="card"><h2>Tu evolución</h2>
        <p class="sub">Elegí el indicador que querés seguir.</p>
        <div style="max-width:320px;margin-bottom:18px">
          <select id="selEvo">${d.detalle.filter((m) => m.valor !== null).map((m) => `<option value="${m.id}">${esc(m.nombre)}</option>`).join('')}</select>
        </div>
        <div id="evo"></div></div>`
    : `<div class="card"><div class="vacio">Todavía hay un solo periodo publicado.<br>El gráfico aparece cuando haya al menos dos.</div></div>`;

  if (met && d.historial.length > 1) {
    const dibujar = (id) => {
      const m = d.detalle.find((x) => x.id === Number(id));
      sparkline('#evo', d.historial.map((h) => ({ periodo: h.periodo, valor: h.valores[m.id] ?? null })),
        { meta: m.meta === null ? null : Number(m.meta), dec: m.decimales });
    };
    $('#selEvo').addEventListener('change', (e) => dibujar(e.target.value));
    dibujar(met.id);
  }
}

/* ================= NAVEGACIÓN ================= */
function ir(v) {
  VISTA = v;
  $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  $$('.vista').forEach((s) => s.classList.toggle('on', s.id === 'v-' + v));
  const [t1, t2] = tituloDe(v);
  $('#tituloVista').textContent = t1;
  $('#subVista').textContent = t2;
  $('#sidebar').classList.remove('abierta');
  if (v === 'notas') pintarNotas();
  if (v === 'ajustes') {
    $('#v-ajustes').innerHTML = panelAjustes(YO);
    activarAjustes(YO, pintarIdentidad);
  }
  if (v === 'evolucion' && DATOS) pintar();
}

$('#nav').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) ir(b.dataset.v); });
$('#campana').addEventListener('click', () => ir('notas'));
$('#btnMenu').addEventListener('click', () => $('#sidebar').classList.toggle('abierta'));
$('#periodo').addEventListener('change', (e) => { ACTUAL = e.target.value; cargar(); });
window.addEventListener('resize', () => { clearTimeout(window._rz); window._rz = setTimeout(() => DATOS && pintar(), 250); });

iniciar().catch((e) => toast(e.message, true));
