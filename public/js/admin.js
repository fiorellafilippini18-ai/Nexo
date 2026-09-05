/* Panel de supervisión. */
let YO = null, PERIODOS = [], METRICAS = [], USUARIOS = [], ANALISIS = null, HOJA = null, VISTA = 'cargar';
let EDITANDO = null, CATALOGO = [];

const TITULOS = {
  cargar:      ['Cargar planilla', 'Subí el Excel del periodo'],
  equipo:      ['Equipo', 'Resultados de todo el equipo'],
  progreso:    ['Progreso del mes', 'Cuánto le falta a cada uno para la meta'],
  analisis:    ['Fortalezas y errores', 'Lo que cada persona hace bien y lo que debe corregir'],
  conclusiones:['Conclusiones', 'Recomendaciones para Gerencia'],
  destacados:  ['Destacados', 'Podio del periodo y registro histórico'],
  notas:       ['Notas al equipo', 'Mensajes en el perfil de cada persona'],
  personas:    ['Colaboradores', 'Alta y gestión del equipo'],
  invitados:   ['Invitados', 'Quién entra solo a mirar, con qué permisos'],
  indicadores: ['Indicadores', 'Metas y consejos de mejora'],
  periodos:    ['Periodos', 'Publicar y administrar periodos'],
  ajustes:     ['Ajustes', 'Perfil, apariencia y notificaciones']
};

async function iniciar() {
  YO = await api('/api/yo');
  Apariencia.iniciar(YO);
  Sonido.activo = !!YO.sonido;
  Marca.aplicar(YO.marca);
  pintarIdentidad();
  Presencia.iniciar(YO, () => pintarIdentidad());
  montarMenuUsuario($('#pie'), { alAjustes: () => ir('ajustes') });

  // Vista previa: mirar el sistema como otra persona
  if (YO.preview) {
    document.body.classList.add('modo-preview');
    $('#pvNombre').textContent = YO.preview.nombre;
    $('#avisoPreview').classList.remove('oculto');
    $('#pvSalir').addEventListener('click', async () => {
      await api('/api/vista-previa', { method: 'POST', body: { usuarioId: null } });
      location.href = '/admin?v=invitados';
    });
  }

  // La barra lateral se arma con lo que cada persona tiene permitido
  const REQUIERE = { cargar: 'cargar', equipo: 'ver_equipo', destacados: 'ver_equipo',
                     progreso: 'ver_equipo', analisis: 'analisis_equipo', conclusiones: 'conclusiones',
                     notas: 'notas', personas: 'personas', invitados: 'personas',
                     indicadores: 'indicadores', periodos: 'periodos' };
  Object.entries(REQUIERE).forEach(([vista, permiso]) => {
    if (!puede(YO, permiso)) { const b = $(`#nav button[data-v="${vista}"]`); if (b) b.remove(); }
  });
  $$('#nav .grupo').forEach((g) => { // ocultar títulos de grupos que quedaron vacíos
    let n = g.nextElementSibling, vacio = true;
    while (n && !n.classList.contains('grupo')) { if (n.tagName === 'BUTTON') vacio = false; n = n.nextElementSibling; }
    if (vacio) g.remove();
  });
  if (YO.rol !== 'gerente') { const o = $('#optSupervisor'); if (o) o.remove(); }
  // Escribirle un comentario a alguien es una acción: quien solo mira no la ve.
  if (!puede(YO, 'notas') || !puedeEditar(YO)) { const c = $('#cardComentario'); if (c) c.remove(); }
  // Las metas del periodo se tocan desde Indicadores: sin ese permiso, ni se muestran.
  if (!puede(YO, 'indicadores')) { const c = $('#mtpCaja')?.closest('.card'); if (c) c.remove(); }
  // si la dirección trae ?v=equipo (por ejemplo al volver de ver el panel de alguien),
  // se abre esa sección en vez de la primera del menú
  const pedida = new URLSearchParams(location.search).get('v');
  const valida = pedida && $(`#nav button[data-v="${pedida}"]`);
  const primera = $('#nav button[data-v]');
  ir(valida ? pedida : (primera ? primera.dataset.v : 'ajustes'));

  await recargar();
  setInterval(() => {
    if (VISTA === 'personas') pintarUsuarios();
    if (VISTA === 'invitados') pintarInvitados();
  }, 45000);
}

function pintarIdentidad() {
  $('#pieAvatar').innerHTML = avatarEstado({ ...YO, conectado: Presencia.estado !== 'desconectado', presencia: Presencia.estado });
  $('#pieNombre').textContent = YO.nombre;
  $('#piePuesto').textContent = YO.puesto || 'Supervisión';
}

/** Quién cuenta como colaborador: la gente del equipo que aparece (o puede aparecer)
 *  en la planilla. Supervisión cuenta; los invitados no, porque solo miran. */
const esColaborador = (u) => !!u.activo && (u.rol === 'agente' || u.rol === 'supervisor');

/* Quien entra con permisos recortados (o a quien estoy mirando en vista previa) no
   tiene en pantalla todos los botones ni todas las secciones: cada escritura se hace
   solo si el elemento existe, y cada consulta que su rol no permite se deja pasar. */
const conTexto = (sel, valor) => { const el = $(sel); if (el) el.textContent = valor; };
const llenarSelect = (sel, html) => {
  const el = $(sel); if (!el) return;
  const v = el.value; el.innerHTML = html; if (v) el.value = v;
};

async function recargar() {
  const siPuede = (clave, url, vacio) => (puede(YO, clave) ? api(url).catch(() => vacio) : Promise.resolve(vacio));
  const [pe, me, us, pm] = await Promise.all([
    api('/api/periodos?incluirArchivados=1').catch(() => []),
    api('/api/metricas').catch(() => []),
    siPuede('ver_equipo', '/api/usuarios', []),
    api('/api/permisos').catch(() => ({ catalogo: [] }))
  ]);
  PERIODOS = pe || []; METRICAS = me || []; USUARIOS = us || []; CATALOGO = (pm && pm.catalogo) || [];
  const opts = PERIODOS.filter((p) => !p.archivado)
    .map((p) => `<option value="${p.id}">${esc(p.etiqueta)}${p.publicado ? '' : ' (sin publicar)'}</option>`).join('');
  ['#perSel', '#eqPeriodo', '#dsPeriodo', '#prPeriodo', '#anPeriodo', '#cnPeriodo', '#mtPeriodo'].forEach((s) => llenarSelect(s, opts));
  const opUsuarios = USUARIOS.filter((u) => u.activo && u.rol === 'agente').map((u) => `<option value="${u.id}">${esc(u.nombre)}</option>`).join('');
  ['#coUsuario', '#ntUsuario'].forEach((s) => llenarSelect(s, opUsuarios));
  llenarSelect('#ntFiltro', '<option value="">Todo el equipo</option>' + opUsuarios);
  conTexto('#bPersonas', USUARIOS.filter(esColaborador).length);
  conTexto('#bInvitados', USUARIOS.filter((u) => u.activo && u.rol === 'invitado').length);
  conTexto('#bEquipo', PERIODOS.filter((p) => p.publicado && !p.archivado).length);
  pintarUsuarios(); pintarInvitados(); pintarMetricas(); pintarPeriodos();
  if (puede(YO, 'notas')) cargarNotasAdmin();
  if (PERIODOS.length && puede(YO, 'ver_equipo')) cargarEquipo();
  contenidoDeLaVista(VISTA);   // la sección abierta ya tiene sus periodos: se refresca
}

/* ---------------- navegación ---------------- */
function ir(v) {
  VISTA = v;
  $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  $$('.vista').forEach((s) => s.classList.toggle('on', s.id === 'v-' + v));
  $('#tituloVista').textContent = TITULOS[v][0];
  $('#subVista').textContent = TITULOS[v][1];
  $('#sidebar').classList.remove('abierta');
  if (v === 'ajustes') { $('#v-ajustes').innerHTML = panelAjustes(YO); activarAjustes(YO, pintarIdentidad); }
  contenidoDeLaVista(v);
}

/** Carga lo que muestra cada sección. Se llama al entrar y otra vez cuando llegan
 *  los periodos, porque si no la sección que ya estaba abierta queda en blanco. */
function contenidoDeLaVista(v) {
  if (v === 'destacados') cargarDestacados();
  if (v === 'progreso') cargarProgreso();
  if (v === 'analisis') cargarAnalisis();
  if (v === 'conclusiones') cargarConclusiones();
  if (v === 'invitados') pintarInvitados();
  if (v === 'periodos') cargarMetasPeriodo();
  if (v === 'notas') cargarNotasAdmin();   // para ver al toque quién confirmó
}
$('#nav').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) ir(b.dataset.v); });
$('#btnMenu').addEventListener('click', () => $('#sidebar').classList.toggle('abierta'));
$('#btnTema').addEventListener('click', () => {
  YO.tema = Apariencia.tema === 'oscuro' ? 'claro' : 'oscuro';
  Apariencia.guardar({ tema: YO.tema });
  toast(YO.tema === 'oscuro' ? 'Modo oscuro' : 'Modo claro');
});


/* ---------------- crear periodo ---------------- */
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
function etiquetaPeriodo() {
  const mes = $('#nMes').value; if (!mes) return null;
  const [y, m] = mes.split('-').map(Number);
  const tipo = $('#nTipo').value;
  if (tipo === 'mensual') {
    return { etiqueta: `${MESES[m - 1]} ${y}`, desde: `${mes}-01`, hasta: `${mes}-${new Date(y, m, 0).getDate()}`, tipo };
  }
  const q = $('#nQuinc').value;
  return q === '1'
    ? { etiqueta: `1ª quincena de ${MESES[m - 1]} ${y}`, desde: `${mes}-01`, hasta: `${mes}-15`, tipo }
    : { etiqueta: `2ª quincena de ${MESES[m - 1]} ${y}`, desde: `${mes}-16`, hasta: `${mes}-${new Date(y, m, 0).getDate()}`, tipo };
}
function refrescarEtiqueta() {
  const e = etiquetaPeriodo();
  $('#nEtiqueta').textContent = e ? e.etiqueta : '—';
  $('#wQuinc').style.display = $('#nTipo').value === 'quincenal' ? '' : 'none';
}
['#nTipo', '#nMes', '#nQuinc'].forEach((s) => $(s).addEventListener('change', refrescarEtiqueta));
$('#nMes').value = new Date().toISOString().slice(0, 7);
refrescarEtiqueta();

$('#nCrear').addEventListener('click', async () => {
  const e = etiquetaPeriodo();
  if (!e) return toast('Elegí el mes', true);
  try {
    const p = await api('/api/periodos', { method: 'POST', body: e });
    await recargar();
    $('#perSel').value = p.id;
    toast('Periodo creado: ' + p.etiqueta);
  } catch (err) { toast(err.message, true); }
});

/* ---------------- subir y analizar ---------------- */
const drop = $('#drop'), file = $('#file');
drop.addEventListener('click', () => file.click());
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('on'); });
drop.addEventListener('dragleave', () => drop.classList.remove('on'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('on'); subir(e.dataTransfer.files[0]); });
file.addEventListener('change', (e) => subir(e.target.files[0]));

async function subir(f) {
  if (!f) return;
  // Ya no hace falta elegir el periodo antes: la planilla dice de qué fechas
  // habla, y en la revisión se ofrece crearlo con un clic.
  $('#subErr').classList.add('oculto');
  $('#dropTxt').innerHTML = 'Leyendo <b>' + esc(f.name) + '</b>…';
  const fd = new FormData(); fd.append('archivo', f);
  try {
    ANALISIS = await api('/api/analizar', { method: 'POST', body: fd });
    HOJA = ANALISIS.hojas[0];
    $('#dropTxt').innerHTML = `<b>${esc(f.name)}</b> leído · ${ANALISIS.hojas.length} hoja(s) con datos<br><span style="font-size:13.5px">Clic para cambiar el archivo</span>`;
    pintarRevision();
    $('#p3').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    $('#dropTxt').innerHTML = '<b>Arrastrá el archivo acá</b><br><span style="font-size:13.5px">o hacé clic para elegirlo</span>';
    $('#subErr').textContent = e.message; $('#subErr').classList.remove('oculto');
  }
}

/** La planilla dice de qué fechas habla: lo mostramos antes de guardar nada. */
function avisoPeriodo() {
  const p = ANALISIS && ANALISIS.periodoDetectado;
  if (!p) return '';
  const elegido = PERIODOS.find((x) => String(x.id) === String($('#perSel').value));
  // Tienen que coincidir las dos fechas: la quincena y el mes empiezan el
  // mismo día, y cargar el mes dentro de la quincena arruinaría el periodo.
  const coincide = !!elegido
    && String(elegido.desde).slice(0, 10) === p.desde
    && String(elegido.hasta).slice(0, 10) === p.hasta;
  const dias = `${p.desde.split('-').reverse().join('/')} al ${p.hasta.split('-').reverse().join('/')}`;
  return `<div class="aviso ${coincide ? 'ok' : 'info'}">
    <b>Detecté un periodo ${p.tipo}: ${esc(p.etiqueta)}.</b><br>
    <span style="font-size:13.5px">Las fechas del archivo van del ${dias}.
      ${coincide ? 'Coincide con el periodo elegido arriba.'
        : `${elegido ? `El periodo elegido arriba es <b>${esc(elegido.etiqueta)}</b>.`
                     : 'Todavía no elegiste ningún periodo.'}
           <button class="btn sm" id="usarDetectado" style="margin-left:6px">Usar ${esc(p.etiqueta)}</button>`}</span>
  </div>`;
}

/** Si el archivo trae el análisis escrito, avisamos que también se va a cargar. */
function avisoExtras() {
  const e = ANALISIS && ANALISIS.extras;
  if (!e || (!e.fortalezas && !e.conclusiones)) return '';
  const partes = [];
  if (e.fortalezas) partes.push(`<b>fortalezas y errores</b> de ${e.fortalezas} persona(s)`);
  if (e.conclusiones) partes.push(`<b>${e.conclusiones} conclusiones</b> para Gerencia`);
  return `<div class="aviso info">La planilla también trae ${partes.join(' y ')}.
    Se cargan tal cual están escritas: las fortalezas le llegan a cada persona y las conclusiones quedan solo para quien tenga permiso.</div>`;
}

/* ---------------- pantalla de revisión ---------------- */
function pintarRevision() {
  if (!HOJA) { $('#p3').innerHTML = ''; return; }
  const cols = HOJA.columnas.filter((c) => c.numerica);
  const sinMapear = HOJA.personasMapeadas.filter((p) => !p.usuarioId).length;

  $('#p3').innerHTML = `
  <div class="card">
    <h2>3. Revisá lo que leyó la app</h2>
    <p class="sub">Encontré <b>${HOJA.filas.length} personas</b> y <b>${cols.length} indicadores</b> en la hoja
      <b>${esc(HOJA.hoja)}</b>. Corregí lo que haga falta y confirmá.</p>
    ${ANALISIS.hojas.length > 1 ? `<div style="margin-bottom:16px;max-width:340px">
      <label class="f">Hoja del archivo</label>
      <select id="selHoja">${ANALISIS.hojas.map((h) => `<option value="${esc(h.hoja)}"${h.hoja === HOJA.hoja ? ' selected' : ''}>${esc(h.hoja)} — ${h.filas.length} personas, ${h.columnas.filter((c) => c.numerica).length} indicadores</option>`).join('')}</select>
    </div>` : ''}

    ${avisoPeriodo()}
    ${avisoExtras()}
    ${sinMapear ? `<div class="aviso warn">Hay <b>${sinMapear}</b> nombre(s) de la planilla que no reconozco. Asignalos abajo o quedarán fuera de la carga.</div>` : `<div class="aviso ok">Reconocí a las ${HOJA.personasMapeadas.length} personas de la planilla.</div>`}

    <h3 style="margin-top:22px">Personas</h3>
    <div class="scroll"><table><thead><tr><th>Nombre en la planilla</th><th>Es esta persona</th><th></th></tr></thead><tbody>
      ${HOJA.personasMapeadas.map((p, i) => `<tr>
        <td><b>${esc(p.texto)}</b></td>
        <td><select data-persona="${i}" style="max-width:280px">
          <option value="">— No cargar esta fila —</option>
          ${USUARIOS.filter(esColaborador).map((u) => `<option value="${u.id}"${p.usuarioId === u.id ? ' selected' : ''}>${esc(u.nombre)}</option>`).join('')}
        </select></td>
        <td>${p.usuarioId ? '' : `<button class="btn sm" data-nuevo="${esc(p.texto)}"
          title="Darla de alta como colaboradora y volver acá">+ Darla de alta</button>`}</td></tr>`).join('')}
    </tbody></table></div>

    <h3 style="margin-top:24px">Indicadores</h3>
    <p class="sub">Destildá lo que no quieras cargar. La meta y la dirección quedan guardadas para los próximos periodos.</p>
    <div class="scroll"><table><thead><tr>
      <th style="width:34px"></th><th>Columna del Excel</th><th>Se guarda como</th>
      <th>Mejor cuando es</th><th class="num">Meta</th><th>Unidad</th><th style="text-align:center">Principal</th><th class="num">Ejemplo</th>
    </tr></thead><tbody>
      ${cols.map((c, i) => `<tr>
        <td><input type="checkbox" data-col="${i}" data-k="usar" ${c.usar ? 'checked' : ''} style="width:17px;height:17px"></td>
        <td style="font-size:13px;color:var(--ink-2)">${esc(c.titulo)}</td>
        <td><input data-col="${i}" data-k="nombre" value="${esc(c.config.nombre)}" style="min-width:190px"></td>
        <td><select data-col="${i}" data-k="direccion" style="min-width:95px">
          <option value="mayor"${c.config.direccion === 'mayor' ? ' selected' : ''}>Mayor</option>
          <option value="menor"${c.config.direccion === 'menor' ? ' selected' : ''}>Menor</option></select></td>
        <td><input type="number" step="0.01" data-col="${i}" data-k="meta" value="${c.config.meta ?? ''}" style="min-width:85px;text-align:right"></td>
        <td><input data-col="${i}" data-k="unidad" value="${esc(c.config.unidad || '')}" style="min-width:70px"></td>
        <td style="text-align:center"><input type="checkbox" data-col="${i}" data-k="principal" ${c.config.principal ? 'checked' : ''} style="width:17px;height:17px"></td>
        <td class="num" style="color:var(--muted)">${esc(c.ejemplo ?? '')}</td>
      </tr>`).join('')}
    </tbody></table></div>

    <div class="flex" style="margin-top:22px">
      <button class="btn primary" id="btnImportar">Cargar datos al periodo</button>
      <span style="font-size:13.5px;color:var(--ink-2)">Se cargan en: <b>${esc((PERIODOS.find((p) => String(p.id) === $('#perSel').value) || {}).etiqueta || '—')}</b></span>
    </div>
  </div>`;

  const sh = $('#selHoja');
  if (sh) sh.addEventListener('change', (e) => { HOJA = ANALISIS.hojas.find((h) => h.hoja === e.target.value); pintarRevision(); });

  // "Usar el periodo que detecté": lo crea si no existe y lo deja elegido
  const ud = $('#usarDetectado');
  if (ud) ud.addEventListener('click', async () => {
    const p = ANALISIS.periodoDetectado;
    let ya = PERIODOS.find((x) => String(x.desde).slice(0, 10) === p.desde && String(x.hasta).slice(0, 10) === p.hasta);
    try {
      if (!ya) ya = await api('/api/periodos', { method: 'POST',
        body: { etiqueta: p.etiqueta, desde: p.desde, hasta: p.hasta, tipo: p.tipo } });
      await recargar();
      $('#perSel').value = ya.id;
      pintarRevision();
      toast('Periodo: ' + p.etiqueta);
    } catch (err) { toast(err.message, true); }
  });

  $$('#p3 [data-persona]').forEach((s) => s.addEventListener('change', (e) => {
    HOJA.personasMapeadas[+e.target.dataset.persona].usuarioId = e.target.value ? +e.target.value : null;
  }));
  // Atajo: si en la planilla aparece alguien que todavía no está en el sistema,
  // se la da de alta desde Colaboradores con el nombre ya escrito.
  $$('#p3 [data-nuevo]').forEach((b) => b.addEventListener('click', () => {
    const nombre = b.dataset.nuevo;
    ir('personas');
    $('#uNombre').value = nombre;
    $('#uUsuario').value = nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z ]/g, '').trim().split(/\s+/)[0] || '';
    $('#uRol').value = 'agente';
    $('#uNombre').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('#uClave').focus();
    toast('Poné una contraseña provisoria y agregala. Después volvé a Cargar planilla.');
  }));
  $$('#p3 [data-col]').forEach((el) => el.addEventListener('change', (e) => {
    const c = HOJA.columnas.filter((x) => x.numerica)[+e.target.dataset.col];
    const k = e.target.dataset.k;
    const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (k === 'usar') c.usar = val; else c.config[k] = k === 'meta' ? (val === '' ? null : Number(val)) : val;
  }));
  $('#btnImportar').addEventListener('click', importar);
}

async function importar() {
  if (!$('#perSel').value) {
    return toast('Primero elegí el periodo, o usá el que detecté arriba', true);
  }
  const btn = $('#btnImportar'); btn.disabled = true; btn.textContent = 'Cargando…';
  try {
    const r = await api('/api/importar', {
      method: 'POST',
      body: {
        periodoId: Number($('#perSel').value),
        hoja: HOJA.hoja,
        columnas: HOJA.columnas.filter((c) => c.numerica).map((c) => ({ titulo: c.titulo, usar: c.usar, ...c.config })),
        personas: HOJA.personasMapeadas
      }
    });
    toast(`Listo: ${r.valores} valores de ${r.personas} personas`);
    ANALISIS = null; HOJA = null;
    $('#file').value = '';   // permite volver a subir el mismo archivo
    $('#p3').innerHTML = `<div class="card"><div class="aviso ok" style="margin-bottom:14px">
      Datos cargados. Falta el último paso: <b>publicar el periodo</b> para que los agentes lo vean.</div>
      <button class="btn primary" id="btnPublicarYa">Publicar ahora</button></div>`;
    $('#btnPublicarYa').addEventListener('click', async () => {
      await api('/api/periodos/' + $('#perSel').value, { method: 'PUT', body: { publicado: true } });
      toast('Periodo publicado — los agentes ya lo pueden ver');
      $('#p3').innerHTML = '';
      $('#dropTxt').innerHTML = '<b>Arrastrá el archivo acá</b><br><span style="font-size:13.5px">o hacé clic para elegirlo</span>';
      $('#file').value = '';
      recargar();
    });
    await recargar();
  } catch (e) { toast(e.message, true); }
  btn.disabled = false; btn.textContent = 'Cargar datos al periodo';
}

/* ---------------- equipo ---------------- */
$('#eqPeriodo').addEventListener('change', cargarEquipo);
$('#eqVerBtn').addEventListener('click', () => {
  const id = $('#eqVerSel').value;
  if (id) location.href = '/mi-panel?ver=' + id;
});
/** Los nombres que vienen del Excel suelen ser larguísimos. En el encabezado de la
 *  tabla se recortan las muletillas; el nombre completo queda en el globito. */
const tituloCorto = (n) => String(n || '')
  .replace(/\s+en\s+turno\b/i, '')
  .replace(/\s+evaluad[oa]s?\b/i, '')
  .replace(/\s{2,}/g, ' ')
  .trim();

async function cargarEquipo() {
  const id = $('#eqPeriodo').value; if (!id) return;
  let d;
  try { d = await api('/api/equipo/' + id); } catch (e) { return; }
  const escala = d.escala;
  $('#eqResumen').innerHTML = escala.map((e) => `<div class="kpi">
      <div class="n">${esc(e.clave)}</div>
      <div class="v">${d.resumen[e.clave] || 0}</div>
      <div class="m">${esc(e.plus)}</div></div>`).join('');

  // Solo se muestran los indicadores principales que realmente tienen datos cargados
  // en este periodo: una columna llena de guiones no le dice nada a nadie.
  const conDatos = (m) => d.filas.some((f) => {
    const x = f.detalle.find((y) => y.id === m.id);
    return x && x.valor !== null && x.valor !== undefined;
  });
  const principales = d.metricas.filter((m) => m.principal && conDatos(m));
  try {
    const podio = await api('/api/destacados/' + id);
    $('#eqResumen').insertAdjacentHTML('beforebegin', '');
    const cont = $('#eqPodio') || (() => { const el = document.createElement('div'); el.id = 'eqPodio'; $('#eqResumen').before(el); return el; })();
    cont.innerHTML = podioHTML(podio, -1);
  } catch (e) { /* sin podio */ }

  // atajo arriba de todo: elegir persona y abrir su panel sin tener que bajar
  const sel = $('#eqVerSel');
  if (sel) {
    const v = sel.value;
    sel.innerHTML = d.filas.map((f) => `<option value="${f.id}">${esc(f.nombre)}</option>`).join('');
    if (v) sel.value = v;
    $('#eqVerBtn').classList.toggle('oculto', !d.filas.length);
  }

  $('#eqTabla').innerHTML = d.filas.length ? `<table><thead><tr>
      <th>Colaborador</th>${principales.map((m) => `<th class="num" title="${esc(m.nombre)}">${esc(tituloCorto(m.nombre))}</th>`).join('')}
      <th class="num">Cumplidos</th><th>Resultado</th><th></th></tr></thead><tbody>
    ${d.filas.map((f) => `<tr>
      <td><div class="who">${avatarEstado({ ...f, ...(USUARIOS.find((u) => u.id === f.id) || {}) })}<div>
        <b>${esc(f.nombre)}</b><small>${esc(f.puesto || '')}</small></div></div></td>
      ${principales.map((m) => {
        const det = f.detalle.find((x) => x.id === m.id);
        if (!det || det.valor === null) return '<td class="num">—</td>';
        // Si el indicador no se le exige, no lleva ✓ ni ✕: no se lo está evaluando.
        const marca = det.exento
          ? '<span style="color:var(--muted)" title="No se le exige este indicador">·</span>'
          : det.cumple ? '<span style="color:var(--good)">✓</span>'
                       : '<span style="color:var(--critical)">✕</span>';
        const suya = det.meta_de_persona ? ` title="Meta propia de ${esc(f.nombre)}: ${nfmt(det.meta, m.decimales)}"` : '';
        return `<td class="num"${suya}>${nfmt(det.valor, m.decimales)} ${marca}</td>`;
      }).join('')}
      <td class="num"><b>${f.cumplidos}/${f.total}</b></td>
      <td>${f.nivel ? `<span class="pill ${f.nivel.color}">${esc(f.nivel.clave)}</span>` : '—'}</td>
      <td style="text-align:right"><a class="btn sm" href="/mi-panel?ver=${f.id}"
           title="Ver su panel tal como lo ve esa persona">👁 Ver panel</a></td>
    </tr>`).join('')}</tbody></table>`
    : '<div class="vacio">No hay datos cargados en este periodo.</div>';
}

$('#coGuardar')?.addEventListener('click', async () => {
  try {
    await api('/api/comentario', { method: 'POST', body: { periodoId: Number($('#eqPeriodo').value), usuarioId: Number($('#coUsuario').value), texto: $('#coTexto').value } });
    toast('Comentario guardado');
  } catch (e) { toast(e.message, true); }
});

/* ---------------- progreso hacia la meta ---------------- */
async function cargarProgreso() {
  const id = $('#prPeriodo').value;
  if (!id) { $('#prCaja').innerHTML = '<div class="card"><div class="vacio">Todavía no hay periodos.</div></div>'; return; }
  try {
    $('#prCaja').innerHTML = progresoHTML(await api('/api/progreso/' + id));
  } catch (e) {
    $('#prCaja').innerHTML = `<div class="card"><div class="aviso err">${esc(e.message)}</div></div>`;
  }
}
$('#prPeriodo').addEventListener('change', cargarProgreso);

/* ---------------- fortalezas y errores ---------------- */
async function cargarAnalisis() {
  const id = $('#anPeriodo').value;
  if (!id) { $('#anCaja').innerHTML = '<div class="card"><div class="vacio">Todavía no hay periodos.</div></div>'; return; }
  try { $('#anCaja').innerHTML = analisisHTML(await api('/api/analisis/' + id)); }
  catch (e) { $('#anCaja').innerHTML = `<div class="card"><div class="aviso err">${esc(e.message)}</div></div>`; }
}
const anSel = $('#anPeriodo'); if (anSel) anSel.addEventListener('change', cargarAnalisis);

/* ---------------- conclusiones para Gerencia ---------------- */
let CONCLU = [], CONCLU_ORIG = '';

async function cargarConclusiones() {
  const id = $('#cnPeriodo').value;
  if (!id) { $('#cnCaja').innerHTML = '<div class="card"><div class="vacio">Todavía no hay periodos.</div></div>'; return; }
  try {
    const d = await api('/api/conclusiones/' + id);
    CONCLU = d.filas.map((f) => ({ titulo: f.titulo, cuerpo: f.cuerpo }));
    CONCLU_ORIG = JSON.stringify(CONCLU);
    pintarConclusiones();
  } catch (e) {
    $('#cnCaja').innerHTML = `<div class="card"><div class="aviso err">${esc(e.message)}</div></div>`;
  }
}
const cnSel = $('#cnPeriodo'); if (cnSel) cnSel.addEventListener('change', cargarConclusiones);

const conclusionesCambiaron = () => JSON.stringify(CONCLU) !== CONCLU_ORIG;

function pintarConclusiones() {
  const cambios = conclusionesCambiaron();
  const titulo = `${CONCLU.length} conclusión(es) de ${esc($('#cnPeriodo').selectedOptions[0]?.textContent || '')}`;

  // Quien entra solo a mirar las lee como texto: sin campos, sin botones, sin barra de guardar.
  if (!puedeEditar(YO)) {
    $('#cnCaja').innerHTML = `<div class="card">
      <h2 style="margin:0">${titulo}</h2>
      <p class="sub" style="margin:3px 0 0">Tu acceso es de solo lectura.</p>
      <div style="margin-top:18px">
        ${CONCLU.length ? CONCLU.map((c) => `<div class="conclusion leida">
          <div class="t">${esc(c.titulo)}</div>
          ${c.cuerpo ? `<p>${esc(c.cuerpo)}</p>` : ''}
        </div>`).join('')
        : '<div class="vacio">Todavía no hay conclusiones cargadas para este periodo.</div>'}
      </div>
    </div>`;
    return;
  }

  $('#cnCaja').innerHTML = `<div class="card">
    <div class="flex">
      <div><h2 style="margin:0">${titulo}</h2>
        <p class="sub" style="margin:3px 0 0">Vienen de la hoja <b>Conclusiones</b> de la planilla. Podés editarlas, agregar o quitar.</p></div>
      <div class="sp"></div>
      <button class="btn" id="cnAgregar">＋ Agregar conclusión</button>
    </div>
    <div style="margin-top:18px">
      ${CONCLU.length ? CONCLU.map((c, i) => `<div class="conclusion">
        <input data-cn="${i}" data-k="titulo" value="${esc(c.titulo)}" placeholder="Título de la conclusión">
        <textarea data-cn="${i}" data-k="cuerpo" placeholder="Explicación">${esc(c.cuerpo)}</textarea>
        <div class="acciones">
          <button class="btn sm" data-subir="${i}" ${i === 0 ? 'disabled' : ''}>↑ Subir</button>
          <button class="btn sm" data-bajar="${i}" ${i === CONCLU.length - 1 ? 'disabled' : ''}>↓ Bajar</button>
          <div class="sp"></div>
          <button class="btn sm danger" data-quitar="${i}">Quitar</button>
        </div>
      </div>`).join('')
      : '<div class="vacio">Todavía no hay conclusiones cargadas para este periodo.</div>'}
    </div>
    <div class="barra-guardar">
      ${cambios ? '<span class="pendiente">Hay cambios sin guardar</span>' : '<span class="sub" style="margin:0">Todo guardado.</span>'}
      <div class="sp"></div>
      <button class="btn" id="cnDescartar" ${cambios ? '' : 'disabled'}>Descartar cambios</button>
      <button class="btn primary" id="cnGuardar" ${cambios ? '' : 'disabled'}>Guardar conclusiones</button>
    </div>
  </div>`;
  activarConclusiones();
}

function activarConclusiones() {
  $$('#cnCaja [data-cn]').forEach((el) => el.addEventListener('input', () => {
    CONCLU[+el.dataset.cn][el.dataset.k] = el.value;
    const b = $('#cnCaja .barra-guardar');
    if (b && !b.querySelector('.pendiente')) {
      b.insertAdjacentHTML('afterbegin', '<span class="pendiente">Hay cambios sin guardar</span>');
      b.querySelector('.sub')?.remove();
      $('#cnGuardar').disabled = false; $('#cnDescartar').disabled = false;
    }
  }));
  const mover = (de, a) => { const [x] = CONCLU.splice(de, 1); CONCLU.splice(a, 0, x); pintarConclusiones(); };
  $$('#cnCaja [data-subir]').forEach((b) => b.addEventListener('click', () => mover(+b.dataset.subir, +b.dataset.subir - 1)));
  $$('#cnCaja [data-bajar]').forEach((b) => b.addEventListener('click', () => mover(+b.dataset.bajar, +b.dataset.bajar + 1)));
  $$('#cnCaja [data-quitar]').forEach((b) => b.addEventListener('click', () => {
    CONCLU.splice(+b.dataset.quitar, 1); pintarConclusiones();
  }));
  $('#cnAgregar')?.addEventListener('click', () => { CONCLU.push({ titulo: '', cuerpo: '' }); pintarConclusiones(); });
  $('#cnDescartar')?.addEventListener('click', () => {
    CONCLU = JSON.parse(CONCLU_ORIG); pintarConclusiones(); toast('Cambios descartados');
  });
  $('#cnGuardar')?.addEventListener('click', async () => {
    const btn = $('#cnGuardar'); btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      const r = await api('/api/conclusiones/' + $('#cnPeriodo').value, { method: 'PUT', body: { filas: CONCLU } });
      CONCLU_ORIG = JSON.stringify(CONCLU);
      pintarConclusiones();
      toast(`✓ Guardado: ${r.guardadas} conclusión(es)`);
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Guardar conclusiones';
      toast(e.message, true);
    }
  });
}

/* ---------------- destacados ---------------- */
let PALMARES = null;

async function cargarDestacados() {
  const id = $('#dsPeriodo').value;
  if (id) {
    try {
      const podio = await api('/api/destacados/' + id);
      $('#dsPodio').innerHTML = podioHTML(podio, -1) || '<div class="aviso info">Este periodo todavía no tiene destacados: hace falta que alguien cumpla las metas.</div>';
    } catch (e) { $('#dsPodio').innerHTML = ''; }
  }
  const qs = [];
  if ($('#dsDesde').value) qs.push('desde=' + $('#dsDesde').value);
  if ($('#dsHasta').value) qs.push('hasta=' + $('#dsHasta').value);
  try { PALMARES = await api('/api/palmares' + (qs.length ? '?' + qs.join('&') : '')); }
  catch (e) { return; }

  const titulos = [...new Set(PALMARES.ranking.flatMap((r) => Object.keys(r.porIndicador)))];
  $('#dsTabla').innerHTML = PALMARES.ranking.length ? `<table><thead><tr>
      <th>Colaborador</th><th class="num">🏆 Mejor asesor</th>
      ${titulos.map((t) => `<th class="num">${esc(t)}</th>`).join('')}
      <th class="num">Total</th></tr></thead><tbody>
    ${PALMARES.ranking.map((r) => `<tr>
      <td><div class="who">${avatarHTML(r)}<div><b>${esc(r.nombre)}</b><small>${esc(r.puesto || '')}</small></div></div></td>
      <td class="num">${r.general ? `<span class="medallero">🏆 ${r.general}</span>` : '<span style="color:var(--muted)">—</span>'}</td>
      ${titulos.map((t) => `<td class="num">${r.porIndicador[t] || '<span style="color:var(--muted)">—</span>'}</td>`).join('')}
      <td class="num"><b>${r.total}</b></td></tr>`).join('')}
    </tbody></table>
    <p class="sub" style="margin:14px 0 0">Sobre ${PALMARES.periodos} periodo(s) publicados.</p>`
    : '<div class="vacio">Todavía no hay periodos publicados con destacados.</div>';

  $('#dsDetalle').innerHTML = PALMARES.detalle.length
    ? PALMARES.detalle.slice().reverse().map((d) => `<div class="nota" style="border-left-color:var(--primary)">
        <b style="font-size:15px">${esc(d.etiqueta)}</b>
        <div style="margin-top:7px;font-size:14px">
          ${d.general ? `🏆 <b>${esc(d.general.nombre)}</b> — mejor asesor<br>` : ''}
          ${d.porIndicador.map((x) => `${x.icono} <b>${esc(x.nombre)}</b> — ${esc(x.titulo)} (${nfmt(x.valor, x.decimales)}${x.unidad ? ' ' + esc(x.unidad) : ''})`).join('<br>')}
          ${!d.general && !d.porIndicador.length ? '<span style="color:var(--muted)">Sin destacados</span>' : ''}
        </div></div>`).join('')
    : '<div class="vacio">Sin periodos publicados.</div>';
}

$('#dsPeriodo').addEventListener('change', cargarDestacados);
$('#dsFiltrar').addEventListener('click', cargarDestacados);
$('#dsLimpiar').addEventListener('click', () => { $('#dsDesde').value = $('#dsHasta').value = ''; cargarDestacados(); });
$('#dsCSV').addEventListener('click', () => {
  if (!PALMARES) return;
  const titulos = [...new Set(PALMARES.ranking.flatMap((r) => Object.keys(r.porIndicador)))];
  const filas = [['Colaborador', 'Puesto', 'Mejor asesor', ...titulos, 'Total'],
    ...PALMARES.ranking.map((r) => [r.nombre, r.puesto || '', r.general, ...titulos.map((t) => r.porIndicador[t] || 0), r.total])];
  const csv = '\ufeff' + filas.map((f) => f.map((c) => /[";\n]/.test(String(c)) ? '"' + String(c).replace(/"/g, '""') + '"' : c).join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'destacados.csv'; a.click();
  toast('CSV descargado');
});

/* ---------------- notas ---------------- */
async function cargarNotasAdmin() {
  const uid = $('#ntFiltro').value;
  let lista = [];
  try {
    lista = await api('/api/notas/enviadas');
    if (uid) lista = lista.filter((n) => String(n.usuario_id) === String(uid));
  } catch (e) { return; }

  const iconos = { nota: '📝', felicitacion: '🎉', atencion: '⚠️' };
  const fecha = (f) => new Date(f).toLocaleString('es-PY', { dateStyle: 'short', timeStyle: 'short' });
  const sinConfirmar = lista.filter((n) => !n.confirmada).length;

  $('#ntLista').innerHTML = lista.length
    ? `${sinConfirmar ? `<div class="aviso warn">Hay <b>${sinConfirmar}</b> nota(s) que todavía nadie confirmó.</div>` : ''}
      <div class="scroll"><div class="tabla-notas"><table><thead><tr>
        <th>Para</th><th>Nota</th><th>Enviada</th><th>Confirmación</th><th></th>
      </tr></thead><tbody>
      ${lista.map((n) => `<tr>
        <td><div class="who">${avatarHTML(n)}<div><b>${esc(n.nombre)}</b><small>${esc(n.puesto || '')}</small></div></div></td>
        <td class="celda-nota">${iconos[n.tipo] || '📝'} ${esc(n.texto)}</td>
        <td style="font-size:12.5px;color:var(--ink-2);white-space:nowrap">${fecha(n.creada)}</td>
        <td>${n.confirmada
          ? `<span class="pill good">${esc(n.confirmacion || '✓')} ${fecha(n.confirmada)}</span>`
          : '<span class="pill warning">⏳ Sin confirmar</span>'}</td>
        <td style="text-align:right"><button class="btn sm danger" data-deln="${n.id}">Borrar</button></td>
      </tr>`).join('')}
      </tbody></table></div></div>`
    : '<div class="vacio">Todavía no enviaste notas.</div>';
}
$('#ntFiltro').addEventListener('change', cargarNotasAdmin);
$('#ntEnviar').addEventListener('click', async () => {
  if (!$('#ntTexto').value.trim()) return toast('Escribí el mensaje', true);
  try {
    await api('/api/notas', { method: 'POST', body: {
      usuarioId: Number($('#ntUsuario').value), texto: $('#ntTexto').value, tipo: $('#ntTipo').value } });
    $('#ntTexto').value = '';
    toast('Nota enviada');
    cargarNotasAdmin();
  } catch (e) { toast(e.message, true); }
});
$('#ntLista').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-deln]'); if (!b) return;
  await api('/api/notas/' + b.dataset.deln, { method: 'DELETE' });
  toast('Nota borrada'); cargarNotasAdmin();
});

/* ---------------- personas ---------------- */
$('#uCrear').addEventListener('click', async () => {
  const err = $('#usErr'); err.classList.add('oculto');
  try {
    await api('/api/usuarios', { method: 'POST', body: {
      nombre: $('#uNombre').value.trim(), usuario: $('#uUsuario').value.trim(),
      puesto: $('#uPuesto').value.trim(), rol: $('#uRol').value, clave: $('#uClave').value } });
    ['#uNombre', '#uUsuario', '#uPuesto', '#uClave'].forEach((s) => ($(s).value = ''));
    toast('Colaborador agregado');
    recargar();
  } catch (e) { err.textContent = e.message; err.classList.remove('oculto'); }
});

function pintarUsuarios() {
  // Los invitados tienen su propia sección: acá va solo el equipo.
  const delEquipo = (u) => u.rol !== 'invitado';
  const activos = USUARIOS.filter((u) => u.activo && delEquipo(u));
  const bajas = USUARIOS.filter((u) => !u.activo && delEquipo(u));
  const fila = (u) => `<tr class="${u.activo ? '' : 'dado-de-baja'}" data-fila="${u.id}">
      <td><div class="who">${avatarEstado(u)}<div>
        <b>${esc(u.nombre)}</b>${u.activo ? '' : '<span class="tag-baja">eliminada</span>'}
        <small>${esc(textoSemaforo(u))}${u.baja_fecha ? ' · baja ' + String(u.baja_fecha).slice(0, 10).split('-').reverse().join('/') : ''}</small>
      </div></div></td>
      <td>${esc(u.usuario)}</td>
      <td>${esc(u.puesto || '—')}</td>
      <td>${u.rol === 'gerente' ? '<span class="pill lima">Gerencia</span>'
          : u.rol === 'supervisor' ? `<span class="pill gris">Supervisor</span>
              <small style="display:block;color:var(--muted);margin-top:3px">${u.permisos.length} permiso(s)</small>`
          : u.rol === 'invitado' ? '<span class="pill gris">Invitado</span>' : 'Agente'}</td>
      <td class="num">${u.registros}</td>
      <td style="font-size:12.5px;color:var(--muted);max-width:210px">${(u.alias || []).map(esc).join(' · ') || '—'}</td>
      <td><div class="acciones">
        ${!puede(YO, 'personas') ? '' : `
        ${u.activo && u.rol !== 'gerente' && u.id !== YO.id
          ? `<button class="btn sm" data-vercomo="${u.id}" title="Ver el sistema tal como lo ve esta persona">👁 Ver su panel</button>` : ''}
        <button class="btn sm" data-editar="${u.id}">Editar</button>
        ${u.id === YO.id ? '<span class="tag-baja">sos vos</span>'
          : u.activo
            ? `<button class="btn sm danger" data-baja="${u.id}">Eliminar</button>`
            : `<button class="btn sm" data-alta="${u.id}">Reincorporar</button>`}`}
      </div></td>
    </tr>`;

  $('#usTabla').innerHTML = `<table><thead><tr>
      <th>Colaborador</th><th>Usuario</th><th>Puesto</th><th>Rol</th>
      <th class="num">Datos</th><th>Nombres en la planilla</th><th></th></tr></thead>
    <tbody>${activos.map(fila).join('')}</tbody></table>
    ${bajas.length ? `<h3 style="margin:26px 0 4px">Ya no están en el equipo</h3>
      <p class="sub">Sus resultados siguen contando en los periodos donde participaron, y aparecen como
        "<b>Nombre (eliminada)</b>" en los informes. Podés reincorporarlas cuando quieras.</p>
      <div class="scroll"><table><tbody>${bajas.map(fila).join('')}</tbody></table></div>` : ''}`;
  if (EDITANDO) abrirEditor(EDITANDO);
}

/** Sección aparte para los invitados: quiénes son y qué pueden hacer exactamente.
 *  No cuentan como colaboradores ni aparecen en los resultados. */
function pintarInvitados() {
  const caja = $('#invTabla'); if (!caja) return;
  const activos = USUARIOS.filter((u) => u.activo && u.rol === 'invitado');
  const bajas = USUARIOS.filter((u) => !u.activo && u.rol === 'invitado');
  const nombrePermiso = (k) => { const p = CATALOGO.find(([c]) => c === k); return p ? p[1] : k; };

  const fila = (u) => `<tr class="${u.activo ? '' : 'dado-de-baja'}" data-fila="${u.id}">
      <td><div class="who">${avatarEstado(u)}<div>
        <b>${esc(u.nombre)}</b>${u.activo ? '' : '<span class="tag-baja">eliminada</span>'}
        <small>${esc(textoSemaforo(u))}</small>
      </div></div></td>
      <td>${esc(u.usuario)}</td>
      <td>${esc(u.puesto || '—')}</td>
      <td><span class="pill gris">Invitado</span></td>
      <td>${(u.permisos || []).length
          ? `<div class="permiso-lista">${u.permisos.map((k) => `<span class="pill gris">${esc(nombrePermiso(k))}</span>`).join('')}</div>`
          : '<small style="color:var(--muted)">Solo entra: no ve resultados de nadie</small>'}</td>
      <td><div class="acciones">
        ${!puede(YO, 'personas') ? '' : `
        ${u.activo ? `<button class="btn sm" data-vercomo="${u.id}" title="Ver el sistema tal como lo ve esta persona">👁 Ver su panel</button>` : ''}
        <button class="btn sm" data-editar="${u.id}">Editar</button>
        ${u.activo
          ? `<button class="btn sm danger" data-baja="${u.id}">Quitar acceso</button>`
          : `<button class="btn sm" data-alta="${u.id}">Reactivar</button>`}`}
      </div></td>
    </tr>`;

  caja.innerHTML = !activos.length && !bajas.length
    ? '<p class="sub">Todavía no hay invitados. Agregá uno arriba si querés que alguien mire los resultados sin formar parte del equipo.</p>'
    : `<table><thead><tr>
        <th>Invitado</th><th>Usuario</th><th>Puesto o motivo</th><th>Rol</th>
        <th>Qué puede hacer</th><th></th></tr></thead>
      <tbody>${activos.map(fila).join('')}</tbody></table>
      ${bajas.length ? `<h3 style="margin:26px 0 4px">Invitados sin acceso</h3>
        <p class="sub">Ya no pueden entrar. Podés reactivarlos cuando quieras.</p>
        <div class="scroll"><table><tbody>${bajas.map(fila).join('')}</tbody></table></div>` : ''}`;
  if (EDITANDO) abrirEditor(EDITANDO);
}

$('#iCrear').addEventListener('click', async () => {
  const err = $('#invErr'); err.classList.add('oculto');
  try {
    await api('/api/usuarios', { method: 'POST', body: {
      nombre: $('#iNombre').value.trim(), usuario: $('#iUsuario').value.trim(),
      puesto: $('#iPuesto').value.trim(), rol: 'invitado', clave: $('#iClave').value } });
    ['#iNombre', '#iUsuario', '#iPuesto', '#iClave'].forEach((s) => ($(s).value = ''));
    toast('Invitado agregado');
    recargar();
  } catch (e) { err.textContent = e.message; err.classList.remove('oculto'); }
});

/** Editor en línea, debajo de la fila de la persona. */
function abrirEditor(id) {
  const u = USUARIOS.find((x) => x.id === id);
  const fila = $(`tr[data-fila="${id}"]`);
  if (!u || !fila) { EDITANDO = null; return; }
  EDITANDO = id;
  $$('tr.editor').forEach((t) => t.remove());
  const tr = document.createElement('tr');
  tr.className = 'editor';
  tr.innerHTML = `<td colspan="7">
    <div id="edErr" class="aviso err oculto"></div>
    <div class="row">
      <div><label class="f">Nombre completo</label><input id="edNombre" value="${esc(u.nombre)}"></div>
      <div><label class="f">Usuario</label><input id="edUsuario" value="${esc(u.usuario)}" autocapitalize="none"></div>
      <div><label class="f">Puesto</label><input id="edPuesto" value="${esc(u.puesto || '')}"></div>
      <div><label class="f">Email</label><input id="edEmail" type="email" value="${esc(u.email || '')}"></div>
      <div><label class="f">Turno</label><input id="edTurno" value="${esc(u.turno || '')}"></div>
      <div><label class="f">Rol</label><select id="edRol" ${u.rol === 'gerente' ? 'disabled' : ''}>
        ${(u.rol === 'gerente' ? [['gerente', 'Gerencia']] : [
            ['agente', 'Agente — ve solo lo suyo'],
            ['invitado', 'Invitado — solo mira'],
            ...(YO.rol === 'gerente' ? [['supervisor', 'Supervisor — permisos a medida']] : [])
          ]).map(([v, t]) => `<option value="${v}"${u.rol === v ? ' selected' : ''}>${t}</option>`).join('')}
      </select></div>
      <div><label class="f">Nueva contraseña</label><input id="edClave" placeholder="dejar vacío para no cambiarla"></div>
      <div><label class="f">Agregar nombre de planilla</label><input id="edAlias" placeholder="Ej: Alma E."></div>
    </div>
    ${YO.rol === 'gerente' && u.rol !== 'gerente' && u.rol !== 'agente' ? `
      <div style="margin-top:20px">
        <label class="f">Permisos de ${esc(u.nombre)}</label>
        <p class="sub" style="margin:0 0 11px">Marcá solo lo que necesite. Sin marcar, no aparece en su menú.</p>
        <div class="permisos">${CATALOGO.map(([k, t]) => `
          <label class="permiso"><input type="checkbox" data-permiso="${k}" ${u.permisos.includes(k) ? 'checked' : ''}>
            <span><b>${esc(t)}</b><small>${esc(k)}</small></span></label>`).join('')}
        </div>
      </div>` : ''}
    ${YO.rol === 'gerente' && u.rol === 'gerente' ? `
      <div class="aviso info" style="margin-top:18px">La gerencia tiene todos los permisos, siempre.
        No se le pueden quitar: es el perfil que reparte los permisos del resto.</div>` : ''}

    ${puede(YO, 'indicadores') && u.rol !== 'invitado' ? `
      <div style="margin-top:20px" id="edMetas">
        <label class="f">Metas propias de ${esc(u.nombre)}</label>
        <p class="sub" style="margin:0 0 11px">Solo si a esta persona se le exige un número distinto al del resto.
          Vacío = se le aplica la meta del periodo. Lo que pongas acá manda sobre todo lo demás.</p>
        <div class="cargando-metas sub">Cargando sus metas…</div>
      </div>` : ''}

    <div class="barra-guardar" style="margin:18px 0 0;border-radius:var(--radius-sm)">
      <span class="pendiente oculto" id="edPendiente">Hay cambios sin guardar</span>
      <span class="sub" id="edSinCambios" style="margin:0">Sin cambios por ahora.</span>
      <div class="sp"></div>
      <button class="btn" id="edCerrar">Descartar cambios</button>
      <button class="btn primary" id="edGuardar">Guardar cambios</button>
      ${YO.rol === 'gerente' && u.rol === 'supervisor' && u.activo
        ? `<button class="btn sm" id="edGerencia">Traspasar la gerencia</button>` : ''}
      ${u.registros ? `<button class="btn sm danger" id="edBorrar">Borrar definitivamente</button>` : ''}
    </div>
    ${u.registros ? `<div class="peligro"><b>Ojo:</b> "Eliminar" la da de baja y conserva sus
      ${u.registros} registros, así los promedios de los periodos anteriores no cambian.
      "Borrar definitivamente" borra también esos datos y <b>sí</b> altera los resultados ya publicados.</div>` : ''}
  </td>`;
  fila.after(tr);

  // Cualquier cambio en el editor enciende el aviso de "sin guardar"
  const marcarCambio = () => {
    $('#edPendiente')?.classList.remove('oculto');
    $('#edSinCambios')?.classList.add('oculto');
  };
  const escucharCambios = (raiz) => $$('input, select, textarea', raiz).forEach((el) => {
    el.addEventListener('input', marcarCambio);
    el.addEventListener('change', marcarCambio);
  });
  escucharCambios(tr);

  // Las metas propias se traen aparte: son pocas y solo cuando se abre el editor
  if ($('#edMetas')) {
    api(`/api/usuarios/${id}/metas`).then((d) => {
      const caja = $('#edMetas'); if (!caja) return;
      const principales = d.filas.filter((f) => f.principal);
      caja.querySelector('.cargando-metas')?.remove();
      caja.insertAdjacentHTML('beforeend', `<div class="metas-propias">
        ${principales.map((f) => `<label class="meta-propia">
          <span class="n">${esc(f.nombre)}</span>
          <input type="number" step="any" min="0" data-metausu="${f.id}"
            value="${f.propia === null ? '' : f.propia}"
            placeholder="${f.general === null ? 'sin meta' : nfmt(f.general, f.decimales)}">
          <small>${f.unidad ? esc(f.unidad) + ' · ' : ''}general: ${f.general === null ? '—' : nfmt(f.general, f.decimales)}</small>
        </label>`).join('')}
      </div>
      ${u.rol === 'supervisor' && principales.some((f) => f.exime_supervision)
        ? '<p class="sub" style="margin:10px 0 0">Hay un indicador marcado como <b>"no aplica a supervisión"</b>: si le cargás una meta propia acá, pasa a exigírsele ese número en vez de quedar exenta.</p>'
        : ''}`);
      escucharCambios(caja);
    }).catch(() => { $('#edMetas')?.remove(); });
  }

  $('#edCerrar').addEventListener('click', () => {
    const hayCambios = !$('#edPendiente')?.classList.contains('oculto');
    if (hayCambios && !confirm('Tenés cambios sin guardar.\n\n¿Descartarlos?')) return;
    EDITANDO = null; tr.remove();
    if (hayCambios) toast('Cambios descartados');
  });
  $('#edGuardar').addEventListener('click', async () => {
    const err = $('#edErr'); err.classList.add('oculto');
    try {
      await api('/api/usuarios/' + id, { method: 'PUT', body: {
        nombre: $('#edNombre').value, usuario: $('#edUsuario').value, puesto: $('#edPuesto').value,
        email: $('#edEmail').value, turno: $('#edTurno').value, rol: $('#edRol').value,
        clave: $('#edClave').value || undefined } });
      if ($('#edAlias').value.trim()) {
        await api(`/api/usuarios/${id}/alias`, { method: 'POST', body: { alias: $('#edAlias').value.trim() } });
      }
      const cajas = $$('[data-permiso]');
      if (cajas.length && YO.rol === 'gerente') {
        await api(`/api/usuarios/${id}/permisos`, { method: 'PUT',
          body: { permisos: cajas.filter((c) => c.checked).map((c) => c.dataset.permiso) } });
      }
      // metas propias: se manda el campo vacío como null para volver a la del periodo
      const campos = $$('[data-metausu]', tr);
      let conMeta = 0;
      if (campos.length) {
        const metas = {};
        campos.forEach((c) => {
          metas[c.dataset.metausu] = c.value === '' ? null : Number(c.value);
          if (c.value !== '') conMeta++;
        });
        await api(`/api/usuarios/${id}/metas`, { method: 'PUT', body: { metas } });
      }
      EDITANDO = null;
      const cuantos = cajas.length ? cajas.filter((c) => c.checked).length : null;
      toast(cuantos === null
        ? `✓ Guardado: ${u.nombre}${conMeta ? ` quedó con ${conMeta} meta(s) propia(s)` : ' quedó actualizada'}`
        : `✓ Guardado: ${u.nombre} quedó con ${cuantos} permiso(s)${conMeta ? ` y ${conMeta} meta(s) propia(s)` : ''}`);
      recargar();
    } catch (e) { err.textContent = e.message; err.classList.remove('oculto'); }
  });
  const bg = $('#edGerencia');
  if (bg) bg.addEventListener('click', async () => {
    if (!confirm(`${u.nombre} pasa a ser la gerencia y vos quedás como supervisora con todos los permisos.\n\nSolo puede haber una gerencia a la vez.\n\n¿Traspasar?`)) return;
    if (prompt('Para confirmar, escribí TRASPASAR') !== 'TRASPASAR') return toast('Cancelado');
    await api(`/api/usuarios/${id}/gerencia`, { method: 'POST' });
    toast('Gerencia traspasada');
    location.reload();
  });

  const bb = $('#edBorrar');
  if (bb) bb.addEventListener('click', async () => {
    if (!confirm(`Vas a BORRAR a ${u.nombre} y sus ${u.registros} registros.\n\nEsto cambia los promedios de los periodos ya publicados y no se puede deshacer.\n\n¿Seguir?`)) return;
    if (prompt('Para confirmar, escribí BORRAR') !== 'BORRAR') return toast('Cancelado');
    await api(`/api/usuarios/${id}?modo=borrar`, { method: 'DELETE' });
    EDITANDO = null;
    toast('Persona borrada definitivamente');
    recargar();
  });
}

const accionesDeFila = async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.vercomo) {
    const u = USUARIOS.find((x) => x.id === Number(b.dataset.vercomo));
    try {
      await api('/api/vista-previa', { method: 'POST', body: { usuarioId: Number(b.dataset.vercomo) } });
      // Los agentes tienen su propio panel; el resto usa este mismo
      location.href = u && u.rol === 'agente' ? '/mi-panel' : '/admin';
    } catch (err) { toast(err.message, true); }
    return;
  }
  if (b.dataset.editar) {
    const id = Number(b.dataset.editar);
    if (EDITANDO === id) { EDITANDO = null; $$('tr.editor').forEach((t) => t.remove()); }
    else abrirEditor(id);
  }
  if (b.dataset.baja) {
    const u = USUARIOS.find((x) => x.id === Number(b.dataset.baja));
    const aviso = u.rol === 'invitado'
      ? `${u.nombre} deja de tener acceso al sistema.\n\nEs un invitado: no tiene resultados cargados, así que no cambia nada de los informes.\n\n¿Continuar?`
      : `${u.nombre} deja de tener acceso al sistema.\n\nSus ${u.registros} registros se conservan y va a figurar como "${u.nombre} (eliminada)" en los informes, así los resultados de los periodos anteriores no cambian.\n\n¿Continuar?`;
    if (!confirm(aviso)) return;
    try { await api('/api/usuarios/' + u.id, { method: 'DELETE' }); toast('Dada de baja — sus datos se conservan'); recargar(); }
    catch (err) { toast(err.message, true); }
  }
  if (b.dataset.alta) {
    await api(`/api/usuarios/${b.dataset.alta}/alta`, { method: 'POST' });
    toast('Reincorporada al equipo'); recargar();
  }
};
$('#usTabla').addEventListener('click', accionesDeFila);
$('#invTabla').addEventListener('click', accionesDeFila);

/* ---------------- indicadores ---------------- */
function pintarMetricas() {
  $('#mtTabla').innerHTML = `<table><thead><tr>
    <th>Indicador</th><th>Mejor cuando es</th><th class="num">Meta</th><th>Unidad</th>
    <th style="text-align:center">Principal</th>
    <th style="text-align:center" title="La supervisión no se evalúa con este indicador">No aplica a<br>supervisión</th>
    <th>Consejo para el agente</th><th></th></tr></thead><tbody>
    ${METRICAS.map((m) => `<tr>
      <td><input data-m="${m.id}" data-k="nombre" value="${esc(m.nombre)}" style="min-width:190px"></td>
      <td><select data-m="${m.id}" data-k="direccion">
        <option value="mayor"${m.direccion === 'mayor' ? ' selected' : ''}>Mayor</option>
        <option value="menor"${m.direccion === 'menor' ? ' selected' : ''}>Menor</option></select></td>
      <td><input type="number" step="0.01" data-m="${m.id}" data-k="meta" value="${m.meta ?? ''}" style="min-width:85px;text-align:right"></td>
      <td><input data-m="${m.id}" data-k="unidad" value="${esc(m.unidad || '')}" style="min-width:70px"></td>
      <td style="text-align:center"><input type="checkbox" data-m="${m.id}" data-k="principal" ${m.principal ? 'checked' : ''} style="width:17px;height:17px"></td>
      <td style="text-align:center"><input type="checkbox" data-m="${m.id}" data-k="exime_supervision" ${m.exime_supervision ? 'checked' : ''} style="width:17px;height:17px"></td>
      <td><input data-m="${m.id}" data-k="consejo" value="${esc(m.consejo || '')}" placeholder="Qué hacer para mejorarlo" style="min-width:260px"></td>
      <td style="text-align:right"><button class="btn sm danger" data-delm="${m.id}">Quitar</button></td>
    </tr>`).join('')}</tbody></table>`;
}

$('#mtTabla').addEventListener('change', async (e) => {
  const el = e.target;
  if (!el.dataset.m) return;
  const k = el.dataset.k;
  const val = el.type === 'checkbox' ? el.checked : el.value;
  try {
    await api('/api/metricas/' + el.dataset.m, { method: 'PUT', body: { [k]: k === 'meta' ? (val === '' ? null : Number(val)) : val } });
    toast('Guardado');
    METRICAS = await api('/api/metricas');
  } catch (err) { toast(err.message, true); }
});
$('#mtTabla').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-delm]'); if (!b) return;
  if (!confirm('¿Quitar este indicador de los tableros?')) return;
  await api('/api/metricas/' + b.dataset.delm, { method: 'DELETE' });
  toast('Indicador quitado'); recargar();
});
$('#mCrear').addEventListener('click', async () => {
  if (!$('#mNombre').value.trim()) return toast('Falta el nombre', true);
  await api('/api/metricas', { method: 'POST', body: {
    nombre: $('#mNombre').value.trim(), unidad: $('#mUnidad').value.trim(),
    direccion: $('#mDir').value, meta: $('#mMeta').value === '' ? null : Number($('#mMeta').value) } });
  ['#mNombre', '#mUnidad', '#mMeta'].forEach((s) => ($(s).value = ''));
  toast('Indicador agregado'); recargar();
});

/* ---------------- periodos ---------------- */
/* ---------------- metas de cada periodo ----------------
   El umbral de chats no es el mismo todos los meses: en julio eran 800 y desde
   agosto son 1.200. Acá se define la meta que rige en el periodo elegido. */
let METAS = null, METAS_ORIG = '';

async function cargarMetasPeriodo() {
  const caja = $('#mtpCaja'); if (!caja) return;
  const id = $('#mtPeriodo')?.value;
  if (!id) { caja.innerHTML = '<div class="vacio">Todavía no hay periodos.</div>'; return; }
  try { METAS = await api('/api/metas/' + id); }
  catch (e) { caja.innerHTML = `<div class="aviso err">${esc(e.message)}</div>`; return; }
  METAS_ORIG = JSON.stringify(METAS.filas.map((f) => f.propia));
  pintarMetasPeriodo();
}

const metasCambiaron = () => METAS && JSON.stringify(METAS.filas.map((f) => f.propia)) !== METAS_ORIG;

function pintarMetasPeriodo() {
  const cambios = metasCambiaron();
  const soloLectura = !puedeEditar(YO);
  $('#mtpCaja').innerHTML = `<div class="scroll"><table><thead><tr>
      <th>Indicador</th><th>Mejor cuando es</th><th class="num">Meta general</th>
      <th class="num">Meta de este periodo</th><th></th></tr></thead><tbody>
    ${METAS.filas.map((f) => `<tr>
      <td><b>${esc(f.nombre)}</b>${f.principal ? ' <span class="pill lima">principal</span>' : ''}</td>
      <td>${f.direccion === 'menor' ? 'más baja' : 'más alta'}</td>
      <td class="num">${f.general === null ? '—' : nfmt(f.general, f.decimales)}</td>
      <td class="num">${soloLectura
        ? (f.propia === null ? '<span style="color:var(--muted)">la general</span>' : nfmt(f.propia, f.decimales))
        : `<input type="number" step="any" min="0" data-meta="${f.id}" style="width:120px;text-align:right"
             value="${f.propia === null ? '' : f.propia}" placeholder="la general">`}</td>
      <td>${f.unidad ? esc(f.unidad) : ''}</td>
    </tr>`).join('')}</tbody></table></div>
    ${soloLectura ? '' : `<div class="barra-guardar">
      ${cambios ? '<span class="pendiente">Hay cambios sin guardar</span>'
                : '<span class="sub" style="margin:0">Todo guardado.</span>'}
      <div class="sp"></div>
      <button class="btn" id="mtpAnteriores" title="Deja los periodos anteriores con estas mismas metas">⏮ Copiar a los anteriores</button>
      <button class="btn" id="mtpDescartar" ${cambios ? '' : 'disabled'}>Descartar cambios</button>
      <button class="btn primary" id="mtpGuardar" ${cambios ? '' : 'disabled'}>Guardar metas</button>
    </div>`}`;
  activarMetasPeriodo();
}

function activarMetasPeriodo() {
  $$('#mtpCaja [data-meta]').forEach((el) => el.addEventListener('input', () => {
    const f = METAS.filas.find((x) => x.id === Number(el.dataset.meta));
    f.propia = el.value === '' ? null : Number(el.value);
    const b = $('#mtpCaja .barra-guardar');
    if (b && !b.querySelector('.pendiente')) {
      b.insertAdjacentHTML('afterbegin', '<span class="pendiente">Hay cambios sin guardar</span>');
      b.querySelector('.sub')?.remove();
      $('#mtpGuardar').disabled = false; $('#mtpDescartar').disabled = false;
    }
  }));
  $('#mtpDescartar')?.addEventListener('click', () => { cargarMetasPeriodo(); toast('Cambios descartados'); });
  $('#mtpGuardar')?.addEventListener('click', async () => {
    const btn = $('#mtpGuardar'); btn.disabled = true; btn.textContent = 'Guardando…';
    const metas = {};
    METAS.filas.forEach((f) => { metas[f.id] = f.propia; });
    try {
      const r = await api('/api/metas/' + METAS.periodo.id, { method: 'PUT', body: { metas } });
      toast(`✓ Guardado: ${r.periodo} quedó con ${r.guardadas} meta(s) propia(s)`);
      await cargarMetasPeriodo();
      recargar();
    } catch (e) { btn.disabled = false; btn.textContent = 'Guardar metas'; toast(e.message, true); }
  });
  $('#mtpAnteriores')?.addEventListener('click', async () => {
    if (metasCambiaron()) return toast('Guardá los cambios antes de copiarlos', true);
    if (!confirm(`Los periodos anteriores a "${METAS.periodo.etiqueta}" van a quedar con estas mismas metas.\n\n¿Continuar?`)) return;
    try {
      const r = await api(`/api/metas/${METAS.periodo.id}/anteriores`, { method: 'POST' });
      toast(`✓ Aplicado a ${r.periodos} periodo(s) anteriores`);
      recargar();
    } catch (e) { toast(e.message, true); }
  });
}
const mtSel = $('#mtPeriodo'); if (mtSel) mtSel.addEventListener('change', cargarMetasPeriodo);

function pintarPeriodos() {
  const f = (d) => String(d).slice(0, 10).split('-').reverse().join('/');
  $('#peTabla').innerHTML = PERIODOS.length ? `<table><thead><tr>
    <th>Periodo</th><th>Rango</th><th class="num">Personas</th><th class="num">Datos</th>
    <th>Última carga</th><th>Estado</th><th></th></tr></thead><tbody>
    ${PERIODOS.map((p) => `<tr class="${p.archivado ? 'dado-de-baja' : ''}" data-per="${p.id}">
      <td><b>${esc(p.etiqueta)}</b><small style="display:block;color:var(--muted)">${esc(p.tipo)}</small></td>
      <td style="white-space:nowrap">${f(p.desde)} — ${f(p.hasta)}</td>
      <td class="num">${p.personas}</td>
      <td class="num">${p.registros}</td>
      <td style="font-size:12.5px;color:var(--muted)">${p.ultima_carga
        ? new Date(p.ultima_carga).toLocaleString('es-PY', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</td>
      <td>${p.archivado ? '<span class="pill gris">Archivado</span>'
          : p.publicado ? '<span class="pill good">Publicado</span>'
          : '<span class="pill warning">Sin publicar</span>'}</td>
      <td><div class="acciones">
        ${puede(YO, 'periodos') || puede(YO, 'cargar') ? `
        <button class="btn sm" data-gestion="${p.id}">Gestionar</button>` : ''}
      </div></td></tr>`).join('')}
    </tbody></table>` : '<div class="vacio">Todavía no creaste ningún periodo.</div>';
}

/** Panel de acciones de un periodo, desplegado bajo su fila. */
async function abrirGestionPeriodo(id) {
  const p = PERIODOS.find((x) => x.id === Number(id));
  const fila = $(`tr[data-per="${id}"]`);
  if (!p || !fila) return;
  const abierto = $('tr.editor');
  if (abierto) { const era = abierto.dataset.de; abierto.remove(); if (era === String(id)) return; }

  let cargas = [];
  try { cargas = await api(`/api/periodos/${id}/cargas`); } catch (e) { /* sin historial */ }

  const tr = document.createElement('tr');
  tr.className = 'editor';
  tr.dataset.de = id;
  tr.innerHTML = `<td colspan="7">
    <div class="row" style="align-items:start">
      <div>
        <label class="f">Nombre del periodo</label>
        <input id="gpEtiqueta" value="${esc(p.etiqueta)}">
        <button class="btn sm" id="gpRenombrar" style="margin-top:9px">Renombrar</button>
      </div>
      <div>
        <label class="f">Visibilidad</label>
        <div class="flex">
          <button class="btn sm ${p.publicado ? '' : 'primary'}" id="gpPublicar">
            ${p.publicado ? 'Despublicar' : 'Publicar'}</button>
          <button class="btn sm" id="gpArchivar">${p.archivado ? 'Desarchivar' : 'Archivar'}</button>
        </div>
        <p class="sub" style="margin:9px 0 0;font-size:12.5px">
          <b>Sin publicar:</b> los agentes no lo ven, pero sigue contando en tus estadísticas.<br>
          <b>Archivado:</b> queda fuera de todo — estadísticas, ranking y palmarés — sin borrarse.
          Al desarchivarlo vuelve como <i>sin publicar</i>, y lo publicás cuando quieras.</p>
      </div>
      <div>
        <label class="f">Datos cargados</label>
        <div class="flex">
          <a class="btn sm" href="/api/periodos/${p.id}/archivo">⭳ Excel original</a>
          <button class="btn sm danger" id="gpVaciar" ${p.registros ? '' : 'disabled'}>Deshacer la carga</button>
        </div>
        <p class="sub" style="margin:9px 0 0;font-size:12.5px">
          Borra los ${p.registros} valores de este periodo y lo despublica, para que puedas volver
          a subir la planilla corregida. No toca personas ni indicadores.</p>
      </div>
    </div>

    <h3 style="margin:22px 0 8px">Historial de cargas</h3>
    ${cargas.length ? `<div class="scroll"><table><thead><tr>
        <th>Cuándo</th><th>Acción</th><th>Archivo</th><th>Hoja</th>
        <th class="num">Personas</th><th class="num">Valores</th><th>Quién</th></tr></thead><tbody>
      ${cargas.map((c) => `<tr>
        <td style="white-space:nowrap">${new Date(c.creada).toLocaleString('es-PY', { dateStyle: 'short', timeStyle: 'short' })}</td>
        <td>${c.accion === 'vaciado' ? '<span class="pill critical">Deshecha</span>' : '<span class="pill good">Carga</span>'}</td>
        <td style="font-size:12.5px">${esc(c.archivo || '—')}</td>
        <td style="font-size:12.5px">${esc(c.hoja || '—')}</td>
        <td class="num">${c.personas}</td><td class="num">${c.valores}</td>
        <td style="font-size:12.5px">${esc(c.autor || '—')}</td></tr>`).join('')}
      </tbody></table></div>`
      : '<div class="vacio" style="padding:20px">Todavía no se cargó nada en este periodo.</div>'}

    <div class="flex" style="margin-top:18px">
      <button class="btn" id="gpCerrar">Cerrar</button>
      <div class="sp"></div>
      <button class="btn sm danger" id="gpBorrar">Eliminar el periodo entero</button>
    </div>
  </td>`;
  fila.after(tr);

  $('#gpCerrar').addEventListener('click', () => tr.remove());
  $('#gpRenombrar').addEventListener('click', async () => {
    await api('/api/periodos/' + p.id, { method: 'PUT', body: { etiqueta: $('#gpEtiqueta').value.trim() } });
    toast('Periodo renombrado'); recargar();
  });
  $('#gpPublicar').addEventListener('click', async () => {
    await api('/api/periodos/' + p.id, { method: 'PUT', body: { publicado: !p.publicado } });
    toast(p.publicado ? 'Despublicado — los agentes ya no lo ven' : 'Publicado — los agentes ya lo ven');
    recargar();
  });
  $('#gpArchivar').addEventListener('click', async () => {
    if (!p.archivado && !confirm('El periodo sale de las estadísticas, del ranking y del palmarés.\nLos datos no se borran y podés desarchivarlo cuando quieras.\n\n¿Archivar?')) return;
    await api('/api/periodos/' + p.id, { method: 'PUT', body: { archivado: !p.archivado } });
    toast(p.archivado
      ? 'Desarchivado — queda sin publicar hasta que lo publiques'
      : 'Archivado — queda fuera de las estadísticas');
    recargar();
  });
  $('#gpVaciar').addEventListener('click', async () => {
    if (!confirm(`Se borran los ${p.registros} valores cargados en ${p.etiqueta} y el periodo queda despublicado.\n\nLas personas, los indicadores y el resto de los periodos no se tocan. Después podés volver a subir la planilla.\n\n¿Deshacer la carga?`)) return;
    const r = await api(`/api/periodos/${p.id}/datos`, { method: 'DELETE' });
    toast(`Carga deshecha: ${r.borrados} valores borrados`);
    tr.remove(); recargar();
  });
  $('#gpBorrar').addEventListener('click', async () => {
    if (!confirm(`Se elimina el periodo ${p.etiqueta} con todo su contenido. No se puede deshacer.\n\n¿Continuar?`)) return;
    await api('/api/periodos/' + p.id, { method: 'DELETE' });
    toast('Periodo eliminado'); recargar();
  });
}

$('#peTabla').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-gestion]');
  if (b) abrirGestionPeriodo(b.dataset.gestion);
});

iniciar().catch((e) => toast(e.message, true));
