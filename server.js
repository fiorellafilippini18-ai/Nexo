import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { pool, q, one, all, migrate, norm } from './src/db.js';
import { analizar, sugerir, claveIndicador, normTxt,
         detectarPeriodo, leerFortalezas, leerConclusiones } from './src/parse.js';
import { evaluar, destacados, cumple, ESCALA } from './src/score.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

const PgStore = connectPgSimple(session);
app.use(session({
  store: new PgStore({ pool, createTableIfMissing: true, tableName: 'sesiones' }),
  secret: process.env.SESSION_SECRET || 'cambiar-esta-clave-en-produccion',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 12
  }
}));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

app.use((req, res, next) => (req.path.startsWith('/api/') ? cargarUsuario(req, res, next) : next()));

// Registro de respuestas con error, para poder diagnosticar
app.use((req, res, next) => {
  res.on('finish', () => {
    if (res.statusCode >= 400) console.warn(`[${res.statusCode}] ${req.method} ${req.originalUrl}`);
  });
  next();
});

/* ---------------------------------------------------------------
   Autenticación
--------------------------------------------------------------- */
/* =========================================================
   Roles y permisos

   - gerente    : control total, siempre. Es quien reparte los permisos.
   - supervisor : tiene los permisos que la gerencia le haya dado.
   - invitado   : normalmente solo 'ver_equipo'.
   - agente     : ninguno; ve su propio panel.
   ========================================================= */
export const PERMISOS = [
  ['ver_equipo',  'Ver los resultados de todo el equipo'],
  ['cargar',      'Subir planillas y cargar datos'],
  ['periodos',    'Publicar, archivar y deshacer cargas'],
  ['personas',    'Dar de alta, editar y dar de baja colaboradores'],
  ['indicadores', 'Cambiar metas, indicadores y consejos'],
  ['notas',       'Enviar notas a los colaboradores'],
  ['analisis_equipo', 'Ver las fortalezas y errores de todo el equipo'],
  ['conclusiones',    'Ver las conclusiones y recomendaciones para Gerencia'],
  ['marca',       'Cambiar el nombre y el aspecto de la plataforma']
];
const CLAVES = PERMISOS.map(([k]) => k);

const PRESETS = {
  gerente:    CLAVES,
  supervisor: ['ver_equipo', 'cargar', 'periodos', 'notas'],
  invitado:   ['ver_equipo'],
  agente:     []
};

const permisosDe = (u) =>
  !u ? [] : u.rol === 'gerente' ? CLAVES : (Array.isArray(u.permisos) ? u.permisos.filter((p) => CLAVES.includes(p)) : []);

/** Carga al usuario de la sesión en cada pedido, así los permisos son siempre los actuales. */
const cargarUsuario = async (req, res, next) => {
  if (!req.session.uid) return next();
  try {
    const u = await one('SELECT id, nombre, rol, permisos, activo FROM usuarios WHERE id=$1', [req.session.uid]);
    if (!u || !u.activo) {
      return req.session.destroy(() => res.status(401).json({ error: 'Tu acceso fue dado de baja' }));
    }
    req.usuario = u;
    req.permisos = permisosDe(u);
    req.uid = u.id;
    req.real = u;

    /* Vista previa: mirar el sistema con los ojos de otra persona.
       Solo puede activarla quien administra colaboradores, y es de
       SOLO LECTURA: cualquier operación que escriba queda bloqueada. */
    if (req.session.preview && req.permisos.includes('personas')) {
      const v = await one('SELECT id, nombre, rol, permisos, activo FROM usuarios WHERE id=$1',
        [req.session.preview]);
      if (v && v.activo && v.rol !== 'gerente') {
        req.usuario = v;
        req.permisos = permisosDe(v);
        req.uid = v.id;
        req.preview = v;
        if (req.method !== 'GET' && !/^\/api\/vista-previa/.test(req.path)) {
          return res.status(403).json({ error: 'Estás en vista previa: es solo lectura' });
        }
      } else {
        delete req.session.preview;
      }
    }
    next();
  } catch (e) { next(e); }
};

const pedirLogin = (req, res, next) =>
  req.usuario ? next() : res.status(401).json({ error: 'Sesión no iniciada' });

/** Exige un permiso puntual. La gerencia pasa siempre. */
const pedir = (clave) => (req, res, next) =>
  req.permisos && req.permisos.includes(clave)
    ? next()
    : res.status(403).json({ error: 'No tenés permiso para esto' });

const pedirGerente = (req, res, next) =>
  req.usuario && req.usuario.rol === 'gerente'
    ? next() : res.status(403).json({ error: 'Solo la gerencia puede hacer esto' });

/** Cualquiera que pueda mirar la gestión. */
const pedirGestion = pedir('ver_equipo');
const pedirAdmin = pedirGerente;   // se conserva para las rutas más delicadas

const MINUTOS_CONECTADO = 3;
/** Etiqueta con la que se muestra a alguien que ya no está en el equipo. */
const etiquetaNombre = (u) => (u.activo === false ? `${u.nombre} (eliminada)` : u.nombre);
const estaConectado = (u) =>
  u.presencia !== 'desconectado' && u.ultimo_ping &&
  (Date.now() - new Date(u.ultimo_ping).getTime()) < MINUTOS_CONECTADO * 60000;

app.post('/api/login', async (req, res) => {
  const usuario = String(req.body.usuario || '').trim().toLowerCase();
  const clave = String(req.body.clave || '');
  const u = await one('SELECT * FROM usuarios WHERE lower(usuario)=$1 AND activo', [usuario]);
  if (!u || !bcrypt.compareSync(clave, u.password_hash)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  req.session.uid = u.id;
  req.session.rol = u.rol;
  await q("UPDATE usuarios SET ultimo_ping=NOW(), presencia='disponible' WHERE id=$1", [u.id]);
  res.json({ ok: true, rol: u.rol, nombre: u.nombre, debeCambiar: u.debe_cambiar });
});

app.post('/api/logout', async (req, res) => {
  if (req.session.uid) await q('UPDATE usuarios SET ultimo_ping=NULL WHERE id=$1', [req.session.uid]);
  req.session.destroy(() => res.json({ ok: true }));
});

/* --- Presencia: latido del navegador + estado elegido a mano --- */
app.post('/api/presencia', pedirLogin, async (req, res) => {
  const { estado } = req.body;
  const ok = ['disponible', 'ausente', 'desconectado'].includes(estado) ? estado : null;
  await q(`UPDATE usuarios SET ultimo_ping=NOW(), presencia=COALESCE($1, presencia) WHERE id=$2`,
    [ok, req.session.uid]);
  const u = await one('SELECT presencia FROM usuarios WHERE id=$1', [req.session.uid]);
  res.json({ ok: true, presencia: u.presencia });
});

/** Quién está conectado ahora. La ve la supervisión. */
app.get('/api/conectados', pedirLogin, pedirGestion, async (req, res) => {
  const us = await all(`SELECT id, nombre, puesto, avatar, rol, activo, presencia, ultimo_ping
                        FROM usuarios ORDER BY nombre`);
  res.json(us.map((u) => ({
    id: u.id, nombre: etiquetaNombre(u), puesto: u.puesto, avatar: u.avatar, rol: u.rol, activo: u.activo,
    presencia: u.presencia, ultimoPing: u.ultimo_ping, conectado: estaConectado(u)
  })));
});

/* ---------------------------------------------------------------
   Vista previa: ver el sistema tal como lo ve otra persona.
   Sirve sobre todo para los invitados, que entran al mismo panel
   que la supervisión pero con menos secciones. Es de solo lectura.
--------------------------------------------------------------- */
app.post('/api/vista-previa', pedirLogin, async (req, res) => {
  // Ojo: en vista previa los permisos son los de la otra persona, así que
  // hay que mirar los reales para saber si puede entrar o salir.
  const real = req.real || req.usuario;
  const suyos = permisosDe(real);
  if (!suyos.includes('personas')) {
    return res.status(403).json({ error: 'No tenés permiso para esto' });
  }
  const id = Number(req.body.usuarioId) || null;
  if (!id) { delete req.session.preview; return res.json({ ok: true, preview: null }); }

  const u = await one('SELECT id, nombre, rol, activo FROM usuarios WHERE id=$1', [id]);
  if (!u || !u.activo) return res.status(404).json({ error: 'Esa persona no existe o está dada de baja' });
  if (u.rol === 'gerente') return res.status(400).json({ error: 'No se puede mirar el panel de la gerencia' });
  if (u.id === real.id) return res.status(400).json({ error: 'Ese es tu propio panel' });

  req.session.preview = u.id;
  res.json({ ok: true, preview: { id: u.id, nombre: u.nombre, rol: u.rol } });
});

app.get('/api/yo', pedirLogin, async (req, res) => {
  const u = await one(`SELECT id, usuario, nombre, puesto, email, turno, rol, debe_cambiar,
                              avatar, tema, escala, sonido, presencia, paleta
                       FROM usuarios WHERE id=$1`, [req.uid]);
  res.json({
    ...u, permisos: req.permisos, esGerente: u.rol === 'gerente', marca: await leerMarca(),
    // Si estoy mirando el sistema como otra persona, la pantalla lo tiene que decir
    preview: req.preview ? { id: req.preview.id, nombre: req.preview.nombre, rol: req.preview.rol } : null,
    real: req.preview ? { id: req.real.id, nombre: req.real.nombre } : null
  });
});

/* --- Nombre de la plataforma --- */
/** Paletas que el sistema conoce. La primera es la de fábrica. */
const PALETAS = ['indigo', 'rosa', 'lavanda'];

async function leerMarca() {
  const filas = await all('SELECT clave, valor FROM config');
  const c = Object.fromEntries(filas.map((f) => [f.clave, f.valor]));
  return {
    marca: c.marca || 'Nexo',
    lema: c.lema || 'Desempeño & resultados',
    paleta: PALETAS.includes(c.paleta) ? c.paleta : 'indigo'
  };
}

app.get('/api/marca', async (req, res) => res.json(await leerMarca()));

app.put('/api/marca', pedirLogin, pedir('marca'), async (req, res) => {
  const { marca, lema, paleta } = req.body;
  const paletaOk = paleta === undefined ? undefined : (PALETAS.includes(paleta) ? paleta : 'indigo');
  for (const [clave, valor] of [['marca', marca], ['lema', lema], ['paleta', paletaOk]]) {
    if (valor === undefined) continue;
    await q(`INSERT INTO config (clave, valor) VALUES ($1,$2)
             ON CONFLICT (clave) DO UPDATE SET valor=EXCLUDED.valor`, [clave, String(valor).trim().slice(0, 60)]);
  }
  res.json(await leerMarca());
});

/* --- Permisos: los reparte únicamente la gerencia --- */
app.get('/api/permisos', pedirLogin, async (req, res) =>
  res.json({ catalogo: PERMISOS, presets: PRESETS, mios: req.permisos, esGerente: req.usuario.rol === 'gerente' }));

app.put('/api/usuarios/:id/permisos', pedirLogin, pedirGerente, async (req, res) => {
  const id = Number(req.params.id);
  const u = await one('SELECT rol FROM usuarios WHERE id=$1', [id]);
  if (!u) return res.status(404).json({ error: 'Persona inexistente' });
  if (u.rol === 'gerente') return res.status(400).json({ error: 'La gerencia siempre tiene todos los permisos' });
  const lista = Array.isArray(req.body.permisos) ? req.body.permisos.filter((p) => CLAVES.includes(p)) : [];
  await q('UPDATE usuarios SET permisos=$1::jsonb WHERE id=$2', [JSON.stringify(lista), id]);
  res.json({ ok: true, permisos: lista });
});

/**
 * Traspasar la gerencia. Solo hay una, y solo la gerencia actual puede cederla:
 * queda como supervisora con todos los permisos, para no perder el acceso.
 */
app.post('/api/usuarios/:id/gerencia', pedirLogin, pedirGerente, async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.session.uid) return res.status(400).json({ error: 'Ya sos la gerencia' });
  const u = await one('SELECT * FROM usuarios WHERE id=$1 AND activo', [id]);
  if (!u) return res.status(404).json({ error: 'Persona inexistente o dada de baja' });
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query(`UPDATE usuarios SET rol='supervisor', permisos=$1::jsonb WHERE id=$2`,
      [JSON.stringify(CLAVES), req.session.uid]);
    await cliente.query(`UPDATE usuarios SET rol='gerente', permisos='[]'::jsonb WHERE id=$1`, [id]);
    await cliente.query('COMMIT');
  } catch (e) {
    await cliente.query('ROLLBACK');
    return res.status(500).json({ error: e.message });
  } finally { cliente.release(); }
  res.json({ ok: true });
});

/* --- Perfil y preferencias: cada quien edita lo suyo --- */
app.put('/api/perfil', pedirLogin, async (req, res) => {
  const { nombre, puesto, email, turno } = req.body;
  await q(`UPDATE usuarios SET nombre=COALESCE(NULLIF($1,''),nombre), puesto=COALESCE($2,puesto),
           email=COALESCE($3,email), turno=COALESCE($4,turno) WHERE id=$5`,
    [nombre ? String(nombre).trim() : null, puesto, email, turno, req.session.uid]);
  res.json({ ok: true });
});

app.put('/api/preferencias', pedirLogin, async (req, res) => {
  const { tema, escala, sonido, paleta } = req.body;
  const temaOk = ['claro', 'oscuro', 'auto'].includes(tema) ? tema : null;
  const paletaOk = ['auto', ...PALETAS].includes(paleta) ? paleta : null;
  const escalaOk = escala === undefined ? null : Math.max(85, Math.min(140, Number(escala) || 100));
  await q(`UPDATE usuarios SET tema=COALESCE($1,tema), escala=COALESCE($2,escala),
           sonido=COALESCE($3,sonido), paleta=COALESCE($4,paleta) WHERE id=$5`,
    [temaOk, escalaOk, sonido === undefined ? null : !!sonido, paletaOk, req.session.uid]);
  res.json({ ok: true });
});

app.put('/api/perfil/foto', pedirLogin, async (req, res) => {
  const foto = req.body.foto;
  if (foto === null) { await q('UPDATE usuarios SET avatar=NULL WHERE id=$1', [req.session.uid]); return res.json({ ok: true }); }
  if (typeof foto !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(foto))
    return res.status(400).json({ error: 'Formato de imagen no válido' });
  if (foto.length > 400_000) return res.status(400).json({ error: 'La imagen es demasiado grande' });
  await q('UPDATE usuarios SET avatar=$1 WHERE id=$2', [foto, req.session.uid]);
  res.json({ ok: true });
});

/* --- Notas en el perfil --- */
app.get('/api/notas', pedirLogin, async (req, res) => {
  // Las notas son personales: para leer las de otra persona hace falta el permiso
  // de notas, no alcanza con poder mirar los resultados del equipo.
  const puedeVerOtros = req.permisos.includes('notas');
  const objetivo = puedeVerOtros && req.query.usuarioId ? Number(req.query.usuarioId) : req.uid;
  if (objetivo !== req.uid && !puedeVerOtros) return res.status(403).json({ error: 'Sin permiso' });
  res.json(await all(
    `SELECT n.*, a.nombre AS autor FROM notas n LEFT JOIN usuarios a ON a.id=n.autor_id
     WHERE n.usuario_id=$1 ORDER BY n.creada DESC LIMIT 50`, [objetivo]));
});

app.post('/api/notas', pedirLogin, pedir('notas'), async (req, res) => {
  const { usuarioId, texto, tipo = 'nota' } = req.body;
  if (!usuarioId || !String(texto || '').trim()) return res.status(400).json({ error: 'Falta el destinatario o el texto' });
  const n = await one('INSERT INTO notas (usuario_id, autor_id, texto, tipo) VALUES ($1,$2,$3,$4) RETURNING *',
    [usuarioId, req.session.uid, String(texto).trim(), ['nota', 'felicitacion', 'atencion'].includes(tipo) ? tipo : 'nota']);
  res.json(n);
});

app.post('/api/notas/leidas', pedirLogin, async (req, res) => {
  await q('UPDATE notas SET leida=TRUE WHERE usuario_id=$1 AND NOT leida', [req.session.uid]);
  res.json({ ok: true });
});

/** El colaborador confirma que leyó y entendió la nota. Solo puede
 *  confirmar las suyas, y una vez confirmada no se vuelve atrás sola. */
app.post('/api/notas/:id/confirmar', pedirLogin, async (req, res) => {
  const n = await one('SELECT * FROM notas WHERE id=$1', [req.params.id]);
  if (!n) return res.status(404).json({ error: 'Esa nota no existe' });
  if (n.usuario_id !== req.session.uid) {
    return res.status(403).json({ error: 'Solo podés confirmar las notas de tu propio perfil' });
  }
  if (n.confirmada) return res.json({ ok: true, confirmada: n.confirmada, confirmacion: n.confirmacion });

  const gesto = ['👍', '✅'].includes(req.body.gesto) ? req.body.gesto : '👍';
  const r = await one(
    'UPDATE notas SET confirmada=NOW(), confirmacion=$2, leida=TRUE WHERE id=$1 RETURNING confirmada, confirmacion',
    [n.id, gesto]);
  res.json({ ok: true, ...r });
});

/** Para la supervisión: todas las notas enviadas, con su confirmación. */
app.get('/api/notas/enviadas', pedirLogin, pedir('notas'), async (req, res) => {
  res.json(await all(
    `SELECT n.id, n.texto, n.tipo, n.creada, n.leida, n.confirmada, n.confirmacion,
            u.id AS usuario_id, u.nombre, u.puesto, u.avatar, u.activo,
            a.nombre AS autor
       FROM notas n
       JOIN usuarios u ON u.id = n.usuario_id
       LEFT JOIN usuarios a ON a.id = n.autor_id
      ORDER BY n.creada DESC LIMIT 100`));
});

app.delete('/api/notas/:id', pedirLogin, pedir('notas'), async (req, res) => {
  await q('DELETE FROM notas WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

app.post('/api/clave', pedirLogin, async (req, res) => {
  const actual = String(req.body.actual || '');
  const nueva = String(req.body.nueva || '');
  if (nueva.length < 6) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
  const u = await one('SELECT * FROM usuarios WHERE id=$1', [req.session.uid]);
  if (!bcrypt.compareSync(actual, u.password_hash)) return res.status(400).json({ error: 'La contraseña actual no coincide' });
  await q('UPDATE usuarios SET password_hash=$1, debe_cambiar=FALSE WHERE id=$2', [bcrypt.hashSync(nueva, 10), u.id]);
  res.json({ ok: true });
});

/* ---------------------------------------------------------------
   Usuarios (admin)
--------------------------------------------------------------- */
app.get('/api/usuarios', pedirLogin, pedirGestion, async (req, res) => {
  const us = await all(`SELECT u.*, COALESCE(json_agg(a.alias) FILTER (WHERE a.id IS NOT NULL), '[]') AS alias,
                          (SELECT count(*)::int FROM notas n WHERE n.usuario_id=u.id) AS notas,
                          (SELECT count(*)::int FROM resultados r WHERE r.usuario_id=u.id) AS registros
                        FROM usuarios u LEFT JOIN alias a ON a.usuario_id=u.id
                        GROUP BY u.id ORDER BY u.activo DESC, u.rol DESC, u.nombre`);
  res.json(us.map(({ password_hash, ...r }) => ({
    ...r, etiqueta: etiquetaNombre(r), conectado: estaConectado(r), permisos: permisosDe(r)
  })));
});

app.post('/api/usuarios', pedirLogin, pedir('personas'), async (req, res) => {
  const { nombre, usuario, puesto = '', rol = 'agente', clave } = req.body;
  if (!nombre || !usuario || !clave) return res.status(400).json({ error: 'Faltan datos' });
  if (String(clave).length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  // Solo la gerencia puede crear supervisores; el resto crea agentes o invitados.
  let rolOk = ['supervisor', 'agente', 'invitado'].includes(rol) ? rol : 'agente';
  if (rolOk === 'supervisor' && req.usuario.rol !== 'gerente') rolOk = 'agente';
  try {
    const u = await one(
      `INSERT INTO usuarios (usuario, nombre, puesto, rol, password_hash, permisos)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING id`,
      [String(usuario).trim().toLowerCase(), nombre.trim(), puesto, rolOk,
       bcrypt.hashSync(String(clave), 10), JSON.stringify(PRESETS[rolOk] || [])]
    );
    await q('INSERT INTO alias (usuario_id, alias, alias_norm) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [u.id, nombre.trim(), norm(nombre)]);
    res.json({ ok: true, id: u.id });
  } catch (e) {
    res.status(400).json({ error: /unique/i.test(e.message) ? 'Ese nombre de usuario ya existe' : e.message });
  }
});

app.put('/api/usuarios/:id', pedirLogin, pedir('personas'), async (req, res) => {
  const { nombre, usuario, puesto, email, turno, rol, activo, clave } = req.body;
  let rolOk = ['supervisor', 'agente', 'invitado'].includes(rol) ? rol : null;
  if (rolOk === 'supervisor' && req.usuario.rol !== 'gerente') rolOk = null;
  const destino = await one('SELECT rol FROM usuarios WHERE id=$1', [req.params.id]);
  if (destino && destino.rol === 'gerente' && rolOk)
    return res.status(400).json({ error: 'Para cambiar el rol de la gerencia, primero traspasala' });
  try {
    await q(`UPDATE usuarios SET nombre=COALESCE(NULLIF($1,''),nombre), usuario=COALESCE(NULLIF(lower($2),''),usuario),
             puesto=COALESCE($3,puesto), email=COALESCE($4,email), turno=COALESCE($5,turno),
             rol=COALESCE($6,rol), activo=COALESCE($7,activo) WHERE id=$8`,
      [nombre, usuario, puesto, email, turno, rolOk, activo, req.params.id]);
  } catch (e) {
    return res.status(400).json({ error: /unique/i.test(e.message) ? 'Ese nombre de usuario ya está tomado' : e.message });
  }
  if (rolOk) await q('UPDATE usuarios SET permisos=$1::jsonb WHERE id=$2', [JSON.stringify(PRESETS[rolOk] || []), req.params.id]);
  if (clave) {
    if (String(clave).length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    await q('UPDATE usuarios SET password_hash=$1, debe_cambiar=TRUE WHERE id=$2', [bcrypt.hashSync(String(clave), 10), req.params.id]);
  }
  res.json({ ok: true });
});

/**
 * Dar de baja (por defecto) o borrar del todo.
 *  - baja   : la persona no entra más, pero sus resultados quedan y figura como "(eliminada)".
 *  - borrar : se va todo, incluidos sus datos históricos. Cambia los promedios del equipo.
 */
app.delete('/api/usuarios/:id', pedirLogin, pedir('personas'), async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.session.uid) return res.status(400).json({ error: 'No podés darte de baja a vos misma' });
  if (req.query.modo === 'borrar') {
    await q('DELETE FROM usuarios WHERE id=$1', [id]);
    return res.json({ ok: true, modo: 'borrado' });
  }
  await q('UPDATE usuarios SET activo=FALSE, baja_fecha=CURRENT_DATE, ultimo_ping=NULL WHERE id=$1', [id]);
  res.json({ ok: true, modo: 'baja' });
});

/** Reincorporar a alguien que había sido dado de baja. */
app.post('/api/usuarios/:id/alta', pedirLogin, pedir('personas'), async (req, res) => {
  await q('UPDATE usuarios SET activo=TRUE, baja_fecha=NULL WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

app.post('/api/usuarios/:id/alias', pedirLogin, pedir('personas'), async (req, res) => {
  const a = String(req.body.alias || '').trim();
  if (!a) return res.status(400).json({ error: 'Alias vacío' });
  await q('INSERT INTO alias (usuario_id, alias, alias_norm) VALUES ($1,$2,$3) ON CONFLICT (alias_norm) DO UPDATE SET usuario_id=$1',
    [req.params.id, a, norm(a)]);
  res.json({ ok: true });
});

/* ---------------------------------------------------------------
   Métricas
--------------------------------------------------------------- */
app.get('/api/metricas', pedirLogin, async (req, res) => {
  res.json(await all('SELECT * FROM metricas WHERE activa ORDER BY principal DESC, orden, id'));
});

app.post('/api/metricas', pedirLogin, pedir('indicadores'), async (req, res) => {
  const { nombre, unidad = '', direccion = 'mayor', meta = null, decimales = 1, principal = false, consejo = '', orden = 0 } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Falta el nombre' });
  const m = await one(
    `INSERT INTO metricas (nombre, unidad, direccion, meta, decimales, principal, consejo, orden)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (nombre) DO UPDATE SET unidad=$2, direccion=$3, meta=$4, decimales=$5, principal=$6, consejo=$7, orden=$8, activa=TRUE
     RETURNING *`,
    [nombre.trim(), unidad, direccion === 'menor' ? 'menor' : 'mayor', meta, decimales, !!principal, consejo, orden]);
  res.json(m);
});

app.put('/api/metricas/:id', pedirLogin, pedir('indicadores'), async (req, res) => {
  const { unidad, direccion, meta, decimales, principal, consejo, orden, nombre, exime_supervision } = req.body;
  await q(`UPDATE metricas SET nombre=COALESCE($1,nombre), unidad=COALESCE($2,unidad), direccion=COALESCE($3,direccion),
           meta=$4, decimales=COALESCE($5,decimales), principal=COALESCE($6,principal), consejo=COALESCE($7,consejo),
           orden=COALESCE($8,orden), exime_supervision=COALESCE($10,exime_supervision)
           WHERE id=$9`,
    [nombre, unidad, direccion, meta === '' ? null : meta, decimales, principal, consejo, orden, req.params.id,
     exime_supervision === undefined ? null : !!exime_supervision]);
  res.json({ ok: true });
});

app.delete('/api/metricas/:id', pedirLogin, pedir('indicadores'), async (req, res) => {
  await q('UPDATE metricas SET activa=FALSE WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

/* ---------------------------------------------------------------
   Periodos
--------------------------------------------------------------- */
app.get('/api/periodos', pedirLogin, async (req, res) => {
  const gestion = req.permisos.includes('ver_equipo');
  // Los agentes solo ven periodos publicados y no archivados.
  // La supervisión ve todo, salvo que pida explícitamente ocultar los archivados.
  const cond = gestion
    ? (req.query.incluirArchivados === '1' ? '' : 'WHERE NOT p.archivado')
    : 'WHERE p.publicado AND NOT p.archivado';
  res.json(await all(
    `SELECT p.*,
       (SELECT count(*) FROM resultados r WHERE r.periodo_id=p.id) AS registros,
       (SELECT count(DISTINCT r.usuario_id) FROM resultados r WHERE r.periodo_id=p.id) AS personas,
       (SELECT max(c.creada) FROM cargas c WHERE c.periodo_id=p.id) AS ultima_carga
     FROM periodos p ${cond} ORDER BY p.desde DESC`));
});

app.post('/api/periodos', pedirLogin, pedir('cargar'), async (req, res) => {
  const { etiqueta, tipo = 'mensual', desde, hasta } = req.body;
  if (!etiqueta || !desde || !hasta) return res.status(400).json({ error: 'Faltan datos del periodo' });
  try {
    const p = await one('INSERT INTO periodos (etiqueta, tipo, desde, hasta) VALUES ($1,$2,$3,$4) RETURNING *',
      [etiqueta.trim(), tipo, desde, hasta]);
    res.json(p);
  } catch (e) {
    res.status(400).json({ error: /unique/i.test(e.message) ? 'Ya existe un periodo con esas fechas' : e.message });
  }
});

app.put('/api/periodos/:id', pedirLogin, pedir('periodos'), async (req, res) => {
  const { publicado, etiqueta, archivado } = req.body;
  // Archivar implica sacarlo de la vista de los agentes.
  const despublicar = archivado === true ? false : null;
  await q(`UPDATE periodos SET publicado=COALESCE($1, COALESCE($2, publicado)),
           etiqueta=COALESCE($3,etiqueta), archivado=COALESCE($4,archivado) WHERE id=$5`,
    [despublicar, publicado, etiqueta, archivado, req.params.id]);
  res.json({ ok: true });
});

/**
 * Deshacer una carga: borra los resultados del periodo y el archivo guardado,
 * dejando el periodo vacío y listo para volver a subir la planilla.
 * Los indicadores y las personas no se tocan.
 */
app.delete('/api/periodos/:id/datos', pedirLogin, pedir('periodos'), async (req, res) => {
  const per = await one('SELECT * FROM periodos WHERE id=$1', [req.params.id]);
  if (!per) return res.status(404).json({ error: 'Periodo inexistente' });
  const { rows } = await q('SELECT count(*)::int AS n FROM resultados WHERE periodo_id=$1', [per.id]);
  await q('DELETE FROM resultados WHERE periodo_id=$1', [per.id]);
  await q('DELETE FROM archivos WHERE periodo_id=$1', [per.id]);
  await q('UPDATE periodos SET publicado=FALSE WHERE id=$1', [per.id]);
  await q(`INSERT INTO cargas (periodo_id, autor_id, accion, valores, archivo)
           VALUES ($1,$2,'vaciado',$3,'')`, [per.id, req.session.uid, rows[0].n]);
  res.json({ ok: true, borrados: rows[0].n });
});

/** Historial de cargas de un periodo. */
app.get('/api/periodos/:id/cargas', pedirLogin, pedirGestion, async (req, res) => {
  res.json(await all(
    `SELECT c.*, u.nombre AS autor FROM cargas c LEFT JOIN usuarios u ON u.id=c.autor_id
     WHERE c.periodo_id=$1 ORDER BY c.creada DESC LIMIT 30`, [req.params.id]));
});

app.delete('/api/periodos/:id', pedirLogin, pedir('periodos'), async (req, res) => {
  await q('DELETE FROM periodos WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

/* ---------------------------------------------------------------
   Subida de planilla: paso 1 (analizar) y paso 2 (confirmar)
--------------------------------------------------------------- */
app.post('/api/analizar', pedirLogin, pedir('cargar'), upload.single('archivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No llegó ningún archivo' });
  let info;
  try {
    info = analizar(req.file.buffer);
  } catch (e) {
    return res.status(400).json({ error: 'No pude leer el archivo. ¿Es un .xlsx o .csv válido?' });
  }
  if (!info.hojas.length) {
    return res.status(400).json({ error: 'No encontré ninguna tabla de "una fila por persona". Revisá que el archivo tenga una columna con los nombres y columnas con números.' });
  }

  const metricas = await all('SELECT * FROM metricas WHERE activa');
  const usuarios = await all(`SELECT u.id, u.nombre, COALESCE(json_agg(a.alias_norm) FILTER (WHERE a.id IS NOT NULL), '[]') AS alias
                              FROM usuarios u LEFT JOIN alias a ON a.usuario_id=u.id
                              WHERE u.activo GROUP BY u.id`);

  // sugerir configuración por columna y emparejar personas
  for (const h of info.hojas) {
    const yaPrincipal = new Set();   // un solo indicador principal por concepto
    for (const c of h.columnas) {
      if (!c.numerica) continue;
      const existente = metricas.find((m) => normTxt(m.nombre) === normTxt(c.titulo));
      const vals = h.filas.map((f) => f.valores[c.titulo] ?? null);
      c.config = existente
        ? { metricaId: existente.id, nombre: existente.nombre, direccion: existente.direccion, meta: existente.meta === null ? null : Number(existente.meta), unidad: existente.unidad, decimales: existente.decimales, principal: existente.principal, nueva: false }
        : { metricaId: null, nombre: c.titulo, ...sugerir(c.titulo, vals), nueva: true };

      // "Chats en turno evaluados" no es el indicador de carga: es una submuestra.
      if (c.config.principal && !existente) {
        const clave = claveIndicador(c.titulo);
        const esSubconjunto = /(evaluad|muestra|detalle|parcial|subtotal|de la muestra)/i.test(c.titulo);
        if (esSubconjunto || (clave && yaPrincipal.has(clave))) {
          c.config.principal = false;
          c.config.meta = esSubconjunto ? null : c.config.meta;
        } else if (clave) {
          yaPrincipal.add(clave);
        }
      }
      c.usar = true;
    }
    h.personasMapeadas = h.personas.map((p) => {
      const n = norm(p);
      const u = usuarios.find((x) => x.alias.includes(n) || norm(x.nombre) === n)
        || usuarios.find((x) => norm(x.nombre).split(' ')[0] === n.split(' ')[0] && n.split(' ').length > 1);
      return { texto: p, usuarioId: u ? u.id : null, sugerido: u ? u.nombre : null };
    });
  }

  // La planilla dice de qué fechas habla y trae el análisis ya escrito:
  // lo detectamos acá para mostrarlo antes de guardar nada.
  info.periodoDetectado = detectarPeriodo(req.file.buffer);
  const forta = leerFortalezas(req.file.buffer);
  const conclu = leerConclusiones(req.file.buffer);
  info.extras = {
    fortalezas: forta.length,
    conclusiones: conclu.length,
    personasFortalezas: forta.map((f) => f.persona)
  };

  // guardamos el archivo en la sesión para el paso 2
  req.session.pendiente = { nombre: req.file.originalname, b64: req.file.buffer.toString('base64') };
  res.json(info);
});

app.post('/api/importar', pedirLogin, pedir('cargar'), async (req, res) => {
  const { periodoId, hoja, columnas = [], personas = [] } = req.body;
  const per = await one('SELECT * FROM periodos WHERE id=$1', [periodoId]);
  if (!per) return res.status(400).json({ error: 'Periodo inexistente' });
  const pend = req.session.pendiente;
  if (!pend) return res.status(400).json({ error: 'Se perdió el archivo. Volvé a subirlo.' });

  const info = analizar(Buffer.from(pend.b64, 'base64'));
  const h = info.hojas.find((x) => x.hoja === hoja);
  if (!h) return res.status(400).json({ error: 'No encuentro esa hoja en el archivo' });

  const cliente = await pool.connect();
  let filas = 0, personasOk = 0;
  try {
    await cliente.query('BEGIN');

    // 1. asegurar métricas
    const mapaMetrica = {};
    for (const c of columnas) {
      if (!c.usar) continue;
      const r = await cliente.query(
        `INSERT INTO metricas (nombre, unidad, direccion, meta, decimales, principal, consejo, orden, exime_supervision)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (nombre) DO UPDATE SET unidad=EXCLUDED.unidad, direccion=EXCLUDED.direccion,
           meta=EXCLUDED.meta, decimales=EXCLUDED.decimales, principal=EXCLUDED.principal, activa=TRUE
         RETURNING id`,
        [String(c.nombre).trim(), c.unidad || '', c.direccion === 'menor' ? 'menor' : 'mayor',
         c.meta === '' || c.meta === undefined ? null : c.meta, c.decimales ?? 1, !!c.principal, c.consejo || '', c.orden ?? 0,
         !!c.exime_supervision]);
      mapaMetrica[c.titulo] = r.rows[0].id;
    }

    // 2. resolver personas (creando alias para que la próxima vez sea automático)
    const mapaPersona = {};
    for (const p of personas) {
      if (!p.usuarioId) continue;
      mapaPersona[p.texto] = p.usuarioId;
      await cliente.query(
        'INSERT INTO alias (usuario_id, alias, alias_norm) VALUES ($1,$2,$3) ON CONFLICT (alias_norm) DO UPDATE SET usuario_id=$1',
        [p.usuarioId, p.texto, norm(p.texto)]);
    }

    // 3. cargar resultados
    for (const fila of h.filas) {
      const uid = mapaPersona[fila.persona];
      if (!uid) continue;
      personasOk++;
      for (const c of columnas) {
        if (!c.usar) continue;
        const valor = fila.valores[c.titulo];
        if (valor === null || valor === undefined) continue;
        await cliente.query(
          `INSERT INTO resultados (periodo_id, usuario_id, metrica_id, valor) VALUES ($1,$2,$3,$4)
           ON CONFLICT (periodo_id, usuario_id, metrica_id) DO UPDATE SET valor=EXCLUDED.valor`,
          [periodoId, uid, mapaMetrica[c.titulo], valor]);
        filas++;
      }
    }

    // 4. el análisis escrito que ya viene en la planilla
    const buf0 = Buffer.from(pend.b64, 'base64');
    const forta = leerFortalezas(buf0);
    for (const f of forta) {
      const uid = mapaPersona[f.persona]
        || Object.entries(mapaPersona).find(([texto]) => norm(texto) === norm(f.persona))?.[1];
      if (!uid) continue;
      await cliente.query(
        `INSERT INTO analisis (periodo_id, usuario_id, fortalezas, errores) VALUES ($1,$2,$3,$4)
         ON CONFLICT (periodo_id, usuario_id)
         DO UPDATE SET fortalezas=EXCLUDED.fortalezas, errores=EXCLUDED.errores`,
        [periodoId, uid, f.fortalezas || '', f.errores || '']);
    }
    const conclu = leerConclusiones(buf0);
    if (conclu.length) {
      await cliente.query('DELETE FROM conclusiones WHERE periodo_id=$1', [periodoId]);
      for (let i = 0; i < conclu.length; i++) {
        await cliente.query(
          'INSERT INTO conclusiones (periodo_id, orden, titulo, cuerpo) VALUES ($1,$2,$3,$4)',
          [periodoId, i, conclu[i].titulo, conclu[i].cuerpo || '']);
      }
    }

    // 5. guardar el archivo original
    await cliente.query('DELETE FROM archivos WHERE periodo_id=$1', [periodoId]);
    const buf = Buffer.from(pend.b64, 'base64');
    await cliente.query('INSERT INTO archivos (periodo_id, nombre, peso, contenido) VALUES ($1,$2,$3,$4)',
      [periodoId, pend.nombre, buf.length, buf]);

    await cliente.query(
      `INSERT INTO cargas (periodo_id, autor_id, archivo, hoja, personas, valores, accion)
       VALUES ($1,$2,$3,$4,$5,$6,'carga')`,
      [periodoId, req.session.uid, pend.nombre, hoja, personasOk, filas]);

    await cliente.query('COMMIT');
  } catch (e) {
    await cliente.query('ROLLBACK');
    return res.status(500).json({ error: e.message });
  } finally {
    cliente.release();
  }

  delete req.session.pendiente;
  res.json({ ok: true, valores: filas, personas: personasOk });
});

app.get('/api/periodos/:id/archivo', pedirLogin, pedirGestion, async (req, res) => {
  const a = await one('SELECT * FROM archivos WHERE periodo_id=$1 ORDER BY id DESC LIMIT 1', [req.params.id]);
  if (!a) return res.status(404).send('Sin archivo');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(a.nombre)}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.send(a.contenido);
});

/* ---------------------------------------------------------------
   Resultados
--------------------------------------------------------------- */
async function datosPeriodo(periodoId) {
  const metricas = await all('SELECT * FROM metricas WHERE activa ORDER BY principal DESC, orden, id');
  // Se incluye a quienes ya no están en el equipo: sus datos siguen contando
  // para el promedio del periodo, y se muestran como "Nombre (eliminada)".
  const filas = await all(
    `SELECT r.usuario_id, r.metrica_id, r.valor, u.nombre, u.puesto, u.avatar, u.activo, u.rol
     FROM resultados r JOIN usuarios u ON u.id=r.usuario_id
     WHERE r.periodo_id=$1`, [periodoId]);

  const porUsuario = {};
  for (const f of filas) {
    porUsuario[f.usuario_id] ||= {
      id: f.usuario_id, nombre: etiquetaNombre(f), puesto: f.puesto, avatar: f.avatar,
      activo: f.activo, rol: f.rol, valores: {}
    };
    porUsuario[f.usuario_id].valores[f.metrica_id] = Number(f.valor);
  }
  const promedios = {};
  for (const m of metricas) {
    const vs = filas.filter((f) => f.metrica_id === m.id).map((f) => Number(f.valor));
    promedios[m.id] = vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
  }
  return { metricas, porUsuario, promedios };
}

/** Panel del agente: lo que ve cada colaborador de sí mismo. */
app.get('/api/mi-desempeno/:periodoId', pedirLogin, async (req, res) => {
  const per = await one('SELECT * FROM periodos WHERE id=$1', [req.params.periodoId]);
  if (!per) return res.status(404).json({ error: 'Periodo inexistente' });
  const gestion = req.permisos.includes('ver_equipo');
  if ((!per.publicado || per.archivado) && !gestion) return res.status(403).json({ error: 'Ese periodo no está disponible' });

  const objetivo = req.permisos.includes('ver_equipo') && req.query.usuarioId ? Number(req.query.usuarioId) : req.uid;
  const { metricas, porUsuario, promedios } = await datosPeriodo(per.id);
  const yo = porUsuario[objetivo];
  const evalu = evaluar(metricas, yo ? yo.valores : {}, promedios, yo);

  // Ranking silencioso: la posición sí, los nombres de los demás no.
  // Mismo criterio que el podio: indicadores cumplidos y, si empatan, avance promedio.
  const todos = Object.values(porUsuario)
    .map((u) => {
      const ev = evaluar(metricas, u.valores, promedios, u);
      const avs = ev.detalle.filter((x) => x.principal && x.avance !== null).map((x) => x.avance);
      return { id: u.id, r: ev.ratio, prom: avs.length ? avs.reduce((a, b) => a + b, 0) / avs.length : 0 };
    })
    .sort((a, b) => (b.r - a.r) || (b.prom - a.prom));
  const posicion = todos.findIndex((t) => t.id === objetivo) + 1;

  // evolución en los periodos publicados anteriores
  const anteriores = await all(
    `SELECT p.id, p.etiqueta, p.desde FROM periodos p
     WHERE p.publicado AND NOT p.archivado AND p.desde <= $1 ORDER BY p.desde DESC LIMIT 6`,
    [per.desde]);
  const historial = [];
  for (const a of anteriores.reverse()) {
    const d = await datosPeriodo(a.id);
    const u = d.porUsuario[objetivo];
    historial.push({
      periodo: a.etiqueta,
      valores: u ? u.valores : {},
      ratio: u ? evaluar(d.metricas, u.valores, d.promedios, u).ratio : null
    });
  }

  const comentario = await one('SELECT texto FROM comentarios WHERE periodo_id=$1 AND usuario_id=$2', [per.id, objetivo]);
  const persona = await one('SELECT nombre, puesto, avatar FROM usuarios WHERE id=$1', [objetivo]);

  res.json({
    periodo: per, persona, escala: ESCALA, ...evalu,
    posicion, deCuantos: todos.length,
    historial, comentario: comentario ? comentario.texto : '',
    sinDatos: !yo
  });
});

/* ---------------------------------------------------------------
   Destacados del periodo y palmarés histórico
--------------------------------------------------------------- */

/** Podio del periodo. Lo ve todo el mundo: es la parte pública. */
app.get('/api/destacados/:periodoId', pedirLogin, async (req, res) => {
  const per = await one('SELECT * FROM periodos WHERE id=$1', [req.params.periodoId]);
  if (!per) return res.status(404).json({ error: 'Periodo inexistente' });
  const gestion = req.permisos.includes('ver_equipo');
  if ((!per.publicado || per.archivado) && !gestion) return res.status(403).json({ error: 'Periodo no disponible' });
  const { metricas, porUsuario } = await datosPeriodo(per.id);
  res.json({ periodo: per, ...destacados(metricas, Object.values(porUsuario)) });
});

/**
 * Palmarés: cuántas veces salió destacado cada persona.
 * Se recalcula sobre los periodos publicados, así que siempre coincide
 * con los datos cargados; no hay forma de que quede desactualizado.
 */
async function calcularPalmares(desde, hasta) {
  const periodos = await all(
    `SELECT * FROM periodos WHERE publicado AND NOT archivado
       ${desde ? 'AND desde >= $1' : ''} ${hasta ? `AND hasta <= $${desde ? 2 : 1}` : ''}
     ORDER BY desde`, [desde, hasta].filter(Boolean));

  const acumulado = {};   // usuarioId -> conteos
  const detalle = [];     // una fila por periodo
  const asegurar = (u) => (acumulado[u.usuarioId] ||= {
    usuarioId: u.usuarioId, nombre: u.nombre, puesto: u.puesto, avatar: u.avatar,
    general: 0, total: 0, porIndicador: {}
  });

  for (const p of periodos) {
    const { metricas, porUsuario } = await datosPeriodo(p.id);
    const d = destacados(metricas, Object.values(porUsuario));
    if (d.general) { const a = asegurar(d.general); a.general++; a.total++; }
    for (const x of d.porIndicador) {
      const a = asegurar(x);
      a.porIndicador[x.titulo] = (a.porIndicador[x.titulo] || 0) + 1;
      a.total++;
    }
    detalle.push({ periodoId: p.id, etiqueta: p.etiqueta, desde: p.desde, ...d });
  }

  const ranking = Object.values(acumulado).sort((a, b) => (b.general - a.general) || (b.total - a.total));
  return { periodos: periodos.length, ranking, detalle };
}

app.get('/api/palmares', pedirLogin, async (req, res) => {
  const { desde, hasta, usuarioId } = req.query;
  const datos = await calcularPalmares(desde || null, hasta || null);
  const puedeVer = req.permisos.includes('ver_equipo');
  // la supervisión ve el cuadro completo, salvo que pida el de una persona puntual
  if (puedeVer && !usuarioId) return res.json(datos);
  const objetivo = puedeVer && usuarioId ? Number(usuarioId) : req.session.uid;
  const mio = datos.ranking.find((r) => r.usuarioId === objetivo) || null;
  res.json({ periodos: datos.periodos, mio });
});

/** Vista de equipo (solo supervisor). */
/** La tabla del equipo. La ve todo el mundo, pero quien no tiene permiso de
 *  gestión solo puede mirar periodos ya publicados (y no archivados). */
app.get('/api/equipo/:periodoId', pedirLogin, async (req, res) => {
  const per = await one('SELECT * FROM periodos WHERE id=$1', [req.params.periodoId]);
  if (!per) return res.status(404).json({ error: 'Periodo inexistente' });
  const gestion = req.permisos.includes('ver_equipo');
  if ((!per.publicado || per.archivado) && !gestion) {
    return res.status(403).json({ error: 'Ese periodo no está disponible' });
  }
  const { metricas, porUsuario, promedios } = await datosPeriodo(per.id);
  const filas = Object.values(porUsuario)
    .map((u) => ({ ...u, ...evaluar(metricas, u.valores, promedios, u) }))
    .sort((a, b) => b.ratio - a.ratio);
  const resumen = {};
  for (const e of ESCALA) resumen[e.clave] = filas.filter((f) => f.nivel && f.nivel.clave === e.clave).length;
  res.json({ periodo: per, metricas, promedios, filas, resumen, escala: ESCALA });
});

/* ---------------------------------------------------------------
   Progreso hacia la meta del mes.
   En una quincena muestra cuánto lleva cada persona y cuánto le
   falta. Cuando además existe el mes completo cargado, suma el
   bloque "Datos actualizados del mes" con el mensaje que le toca.
--------------------------------------------------------------- */

/** El indicador de volumen: el que mide cantidad de chats atendidos. */
function metricaVolumen(metricas) {
  const principales = metricas.filter((m) => m.principal && m.direccion !== 'menor');
  return principales.find((m) => claveIndicador(m.nombre) === 'chats')
      || principales.find((m) => /chat|conversacion|atencion|ticket|caso/i.test(normTxt(m.nombre)))
      || principales[0] || null;
}

const nf0 = (n) => Number(n).toLocaleString('es-PY', { maximumFractionDigits: 0 });

/** Los tres mensajes de cierre de mes. */
function mensajeDelMes(nombre, valor, meta, margen) {
  const primer = String(nombre || '').split(' ')[0];
  const v = Number(valor), m = Number(meta);
  if (v < m) {
    return { clase: 'no', etiqueta: 'No llegó', emoji: '💪',
      texto: `${primer}, estuviste cerca: te faltaron ${nf0(m - v)} chats para la meta. Esforzate un poco más y conseguí mejores resultados en el periodo siguiente.` };
  }
  if (v < m * (1 + margen / 100)) {
    return { clase: 'limite', etiqueta: 'Al límite', emoji: '👀',
      texto: `${primer}, lograste el objetivo con ${nf0(v)} chats, pero estuviste muy cerca de fallar. Esforzate más en la siguiente etapa: no te quedes al límite.` };
  }
  return { clase: 'ok', etiqueta: 'Cumplió', emoji: '🥳',
    texto: `${primer}, ¡felicitaciones! Alcanzaste la meta del mes con ${nf0(v)} chats. Seguí así.` };
}

app.get('/api/progreso/:periodoId', pedirLogin, async (req, res) => {
  const v = await periodoVisible(req, req.params.periodoId);
  if (v.error) return res.status(v.error).json({ error: v.msg });
  const per = v.per;
  const completo = req.permisos.includes('ver_equipo');

  const { metricas, porUsuario, promedios } = await datosPeriodo(per.id);
  const vol = metricaVolumen(metricas);
  const otras = metricas.filter((m) => m.principal && m !== vol);

  const visible = (u) => completo || u.id === req.uid;
  const filas = Object.values(porUsuario).filter(visible).map((u) => {
    const valor = vol ? u.valores[vol.id] ?? null : null;
    const exento = vol && vol.exime_supervision && u.rol === 'supervisor';
    const meta = vol && vol.meta !== null ? Number(vol.meta) : null;
    const faltan = (valor === null || meta === null || exento) ? null : Math.max(0, meta - Number(valor));
    const primer = String(u.nombre).split(' ')[0];
    return {
      usuarioId: u.id, nombre: u.nombre, puesto: u.puesto, avatar: u.avatar, rol: u.rol,
      esMio: u.id === req.uid,
      valor, faltan, exento,
      nota: exento
        ? `${primer} tiene rol de supervisión: su objetivo no es el volumen de chats, así que este indicador no se le exige.`
        : (faltan === null ? ''
          : faltan > 0
            ? `${primer} respondió ${nf0(valor)} chats en el periodo; le faltan ${nf0(faltan)} para llegar a la meta de ${nf0(meta)}. ¡Seguí a este ritmo y lo lográs!`
            : `${primer} ya superó la meta de ${nf0(meta)} chats con ${nf0(valor)}. Excelente.`),
      otros: otras.map((m) => ({
        id: m.id, nombre: m.nombre, unidad: m.unidad, decimales: m.decimales,
        valor: u.valores[m.id] ?? null, cumple: cumple(u.valores[m.id] ?? null, m)
      }))
    };
  }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  /* ---- el mes completo, si ya está cargado ---- */
  let mes = null;
  const mensual = await one(
    `SELECT * FROM periodos
      WHERE tipo='mensual' AND archivado=FALSE
        AND date_trunc('month', desde) = date_trunc('month', $1::date)
        AND EXISTS (SELECT 1 FROM resultados r WHERE r.periodo_id = periodos.id)
      ORDER BY publicado DESC, id DESC LIMIT 1`, [per.desde]);

  if (mensual && (mensual.publicado || completo)) {
    const cfg = await one("SELECT valor FROM config WHERE clave='margen_limite'");
    const margen = Number(cfg?.valor) || 5;
    const dm = await datosPeriodo(mensual.id);
    const volM = metricaVolumen(dm.metricas);
    const metaM = volM && volM.meta !== null ? Number(volM.meta) : null;

    mes = {
      periodo: mensual, meta: metaM, margen,
      filas: Object.values(dm.porUsuario).filter(visible).map((u) => {
        const valor = volM ? u.valores[volM.id] ?? null : null;
        const exento = volM && volM.exime_supervision && u.rol === 'supervisor';
        const m = (valor === null || metaM === null) ? null
          : exento
            ? { clase: 'exento', etiqueta: 'No aplica', emoji: '🛡',
                texto: `${String(u.nombre).split(' ')[0]}, por tu rol de supervisión no se te mide el volumen de chats. Tu foco es acompañar al equipo.` }
            : mensajeDelMes(u.nombre, valor, metaM, margen);
        return {
          usuarioId: u.id, nombre: u.nombre, puesto: u.puesto, avatar: u.avatar,
          esMio: u.id === req.uid, valor, ...(m || {})
        };
      }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    };
  }

  res.json({ periodo: per, completo, indicador: vol, filas, mes });
});

/* ---------------------------------------------------------------
   Análisis del periodo: fortalezas y errores, y conclusiones.
   Las fortalezas son privadas: cada quien ve la suya, salvo que
   tenga permiso para ver las del equipo.
--------------------------------------------------------------- */
async function periodoVisible(req, id) {
  const per = await one('SELECT * FROM periodos WHERE id=$1', [id]);
  if (!per) return { error: 404, msg: 'Periodo inexistente' };
  const gestion = req.permisos.includes('ver_equipo');
  if ((!per.publicado || per.archivado) && !gestion) {
    return { error: 403, msg: 'Ese periodo no está disponible' };
  }
  return { per };
}

app.get('/api/analisis/:periodoId', pedirLogin, async (req, res) => {
  const v = await periodoVisible(req, req.params.periodoId);
  if (v.error) return res.status(v.error).json({ error: v.msg });

  // ¿ve el de todos, o solo el suyo?
  const todos = req.permisos.includes('analisis_equipo');

  // "Ver el panel de" — las fortalezas y los errores de otra persona son privados:
  // solo los abre quien tiene el permiso del análisis del equipo.
  const pedido = Number(req.query.usuarioId) || null;
  const mirando = pedido && todos ? pedido : null;
  const quien = mirando || req.uid;

  const filas = await all(
    `SELECT a.usuario_id, a.fortalezas, a.errores, u.nombre, u.puesto, u.avatar, u.activo
       FROM analisis a JOIN usuarios u ON u.id = a.usuario_id
      WHERE a.periodo_id = $1 ${todos && !mirando ? '' : 'AND a.usuario_id = $2'}
      ORDER BY u.nombre`,
    todos && !mirando ? [v.per.id] : [v.per.id, quien]);

  res.json({
    periodo: v.per,
    completo: todos && !mirando,
    filas: filas.map((f) => ({ ...f, nombre: etiquetaNombre(f), esMio: f.usuario_id === quien }))
  });
});

app.get('/api/conclusiones/:periodoId', pedirLogin, pedir('conclusiones'), async (req, res) => {
  const per = await one('SELECT * FROM periodos WHERE id=$1', [req.params.periodoId]);
  if (!per) return res.status(404).json({ error: 'Periodo inexistente' });
  const filas = await all(
    'SELECT id, orden, titulo, cuerpo FROM conclusiones WHERE periodo_id=$1 ORDER BY orden, id',
    [per.id]);
  res.json({ periodo: per, filas });
});

app.put('/api/conclusiones/:periodoId', pedirLogin, pedir('conclusiones'), async (req, res) => {
  const per = await one('SELECT * FROM periodos WHERE id=$1', [req.params.periodoId]);
  if (!per) return res.status(404).json({ error: 'Periodo inexistente' });
  const lista = Array.isArray(req.body.filas) ? req.body.filas : [];
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query('DELETE FROM conclusiones WHERE periodo_id=$1', [per.id]);
    for (let i = 0; i < lista.length; i++) {
      const t = String(lista[i].titulo || '').trim();
      if (!t) continue;
      await cliente.query(
        'INSERT INTO conclusiones (periodo_id, orden, titulo, cuerpo) VALUES ($1,$2,$3,$4)',
        [per.id, i, t.slice(0, 300), String(lista[i].cuerpo || '').trim().slice(0, 2000)]);
    }
    await cliente.query('COMMIT');
  } catch (e) {
    await cliente.query('ROLLBACK');
    return res.status(500).json({ error: e.message });
  } finally { cliente.release(); }
  res.json({ ok: true, guardadas: lista.length });
});

app.post('/api/comentario', pedirLogin, pedir('notas'), async (req, res) => {
  const { periodoId, usuarioId, texto } = req.body;
  await q(`INSERT INTO comentarios (periodo_id, usuario_id, texto) VALUES ($1,$2,$3)
           ON CONFLICT (periodo_id, usuario_id) DO UPDATE SET texto=EXCLUDED.texto`,
    [periodoId, usuarioId, texto || '']);
  res.json({ ok: true });
});

/* ---------------------------------------------------------------
   Páginas
--------------------------------------------------------------- */
/* Cada publicación cambia esta firma, y con ella la dirección del CSS y de los
   scripts. Así el navegador nunca se queda con una versión vieja guardada. */
const VERSION = (() => {
  const h = crypto.createHash('sha1');
  for (const f of ['css/app.css', 'js/comun.js', 'js/admin.js', 'js/agente.js']) {
    try { h.update(String(fs.statSync(path.join(__dirname, 'public', f)).mtimeMs)); }
    catch (e) { /* si falta alguno, no pasa nada */ }
  }
  return h.digest('hex').slice(0, 8);
})();

const paginas = {};
const enviarPagina = (nombre) => (req, res) => {
  if (!paginas[nombre]) {
    paginas[nombre] = fs.readFileSync(path.join(__dirname, 'public', nombre), 'utf8')
      .replace(/__V__/g, VERSION);
  }
  res.set('Cache-Control', 'no-cache').type('html').send(paginas[nombre]);
};

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  if (!req.session.uid) return enviarPagina('login.html')(req, res);
  res.redirect(['gerente', 'supervisor', 'invitado'].includes(req.session.rol) ? '/admin' : '/mi-panel');
});
app.get('/admin', (req, res) =>
  ['gerente', 'supervisor', 'invitado'].includes(req.session.rol)
    ? enviarPagina('admin.html')(req, res) : res.redirect('/'));
app.get('/mi-panel', (req, res) =>
  req.session.uid ? enviarPagina('agente.html')(req, res) : res.redirect('/'));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Error interno' });
});

/* ---------------------------------------------------------------
   Arranque
--------------------------------------------------------------- */
const arrancar = async () => {
  if (!process.env.DATABASE_URL) {
    console.error('\nFalta la variable DATABASE_URL. Copiá .env.example a .env y completala.\n');
    process.exit(1);
  }
  await migrate();

  // Si no hay ningún usuario, se crea el supervisor inicial.
  const { rows } = await q('SELECT count(*)::int AS n FROM usuarios');
  if (rows[0].n === 0) {
    const clave = process.env.ADMIN_PASSWORD || 'cambiar123';
    await q(`INSERT INTO usuarios (usuario, nombre, puesto, rol, password_hash, debe_cambiar)
             VALUES ($1,$2,$3,'gerente',$4,TRUE)`,
      ['admin', process.env.ADMIN_NOMBRE || 'Gerencia', process.env.ADMIN_PUESTO || 'Gerente', bcrypt.hashSync(clave, 10)]);
    console.log(`\n>> Usuario inicial creado: "admin" — contraseña: ${clave}`);
    console.log('>> Entrá y cambiala en el primer inicio de sesión.\n');
  }

  app.listen(PORT, () => console.log(`Panel de desempeño escuchando en http://localhost:${PORT}`));
};

arrancar().catch((e) => { console.error(e); process.exit(1); });
