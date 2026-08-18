-- Esquema del panel de desempeño
CREATE TABLE IF NOT EXISTS usuarios (
  id            SERIAL PRIMARY KEY,
  usuario       TEXT UNIQUE NOT NULL,
  nombre        TEXT NOT NULL,
  puesto        TEXT DEFAULT '',
  rol           TEXT NOT NULL DEFAULT 'agente',      -- 'admin' | 'agente'
  password_hash TEXT NOT NULL,
  debe_cambiar  BOOLEAN NOT NULL DEFAULT TRUE,
  activo        BOOLEAN NOT NULL DEFAULT TRUE,
  creado        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Nombres alternativos con los que aparece la persona en el Excel
CREATE TABLE IF NOT EXISTS alias (
  id         SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  alias      TEXT NOT NULL,
  alias_norm TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS metricas (
  id         SERIAL PRIMARY KEY,
  nombre     TEXT UNIQUE NOT NULL,
  unidad     TEXT DEFAULT '',
  direccion  TEXT NOT NULL DEFAULT 'mayor',          -- 'mayor' | 'menor' (es mejor)
  meta       NUMERIC,
  decimales  INTEGER NOT NULL DEFAULT 1,
  principal  BOOLEAN NOT NULL DEFAULT FALSE,         -- cuenta para la escala de plus
  consejo    TEXT DEFAULT '',                        -- qué hacer para mejorarla
  orden      INTEGER NOT NULL DEFAULT 0,
  activa     BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS periodos (
  id        SERIAL PRIMARY KEY,
  etiqueta  TEXT NOT NULL,
  tipo      TEXT NOT NULL DEFAULT 'mensual',         -- 'quincenal' | 'mensual'
  desde     DATE NOT NULL,
  hasta     DATE NOT NULL,
  publicado BOOLEAN NOT NULL DEFAULT FALSE,
  creado    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (desde, hasta)
);

CREATE TABLE IF NOT EXISTS resultados (
  id         SERIAL PRIMARY KEY,
  periodo_id INTEGER NOT NULL REFERENCES periodos(id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  metrica_id INTEGER NOT NULL REFERENCES metricas(id) ON DELETE CASCADE,
  valor      NUMERIC,
  UNIQUE (periodo_id, usuario_id, metrica_id)
);

CREATE TABLE IF NOT EXISTS comentarios (
  id         SERIAL PRIMARY KEY,
  periodo_id INTEGER NOT NULL REFERENCES periodos(id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  texto      TEXT DEFAULT '',
  UNIQUE (periodo_id, usuario_id)
);

-- Mapeos de columnas guardados, para no repetir el trabajo cada periodo
CREATE TABLE IF NOT EXISTS plantillas (
  id     SERIAL PRIMARY KEY,
  nombre TEXT UNIQUE NOT NULL,
  config JSONB NOT NULL,
  creado TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Archivo original, guardado en la base (el disco del servidor es efímero)
CREATE TABLE IF NOT EXISTS archivos (
  id         SERIAL PRIMARY KEY,
  periodo_id INTEGER NOT NULL REFERENCES periodos(id) ON DELETE CASCADE,
  nombre     TEXT NOT NULL,
  peso       INTEGER NOT NULL DEFAULT 0,
  contenido  BYTEA,
  subido     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Preferencias y perfil de cada persona
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS avatar    TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS tema      TEXT    NOT NULL DEFAULT 'claro';   -- 'claro' | 'oscuro' | 'auto'
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS escala    INTEGER NOT NULL DEFAULT 100;       -- tamaño de texto, en %
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS sonido    BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email     TEXT    DEFAULT '';
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS turno     TEXT    DEFAULT '';

-- Notas que la supervisión deja en el perfil de una persona
CREATE TABLE IF NOT EXISTS notas (
  id         SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  autor_id   INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  texto      TEXT NOT NULL,
  tipo       TEXT NOT NULL DEFAULT 'nota',      -- 'nota' | 'felicitacion' | 'atencion'
  leida      BOOLEAN NOT NULL DEFAULT FALSE,
  creada     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Baja lógica: la persona sale del equipo pero sus datos quedan en el historial
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS baja_fecha  DATE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ultimo_ping TIMESTAMPTZ;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS presencia   TEXT NOT NULL DEFAULT 'disponible'; -- 'disponible' | 'ausente' | 'desconectado'

-- Un periodo archivado queda fuera de estadísticas, palmarés y de la vista de los agentes,
-- pero no se borra: se puede desarchivar cuando se quiera.
ALTER TABLE periodos ADD COLUMN IF NOT EXISTS archivado BOOLEAN NOT NULL DEFAULT FALSE;

-- Historial de cargas, para saber qué se subió, cuándo y quién
CREATE TABLE IF NOT EXISTS cargas (
  id         SERIAL PRIMARY KEY,
  periodo_id INTEGER NOT NULL REFERENCES periodos(id) ON DELETE CASCADE,
  autor_id   INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  archivo    TEXT DEFAULT '',
  hoja       TEXT DEFAULT '',
  personas   INTEGER NOT NULL DEFAULT 0,
  valores    INTEGER NOT NULL DEFAULT 0,
  accion     TEXT NOT NULL DEFAULT 'carga',   -- 'carga' | 'vaciado'
  creada     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Permisos individuales. La gerencia los tiene todos siempre; al resto se los otorga ella.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS permisos JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Paleta elegida por cada persona: 'auto' sigue la de la plataforma.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS paleta TEXT NOT NULL DEFAULT 'auto';

-- Nombre de la plataforma y otros ajustes generales
CREATE TABLE IF NOT EXISTS config (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL DEFAULT ''
);
INSERT INTO config (clave, valor) VALUES
  ('marca', 'Nexo'),
  ('lema',  'Desempeño & resultados'),
  ('paleta', 'indigo')
ON CONFLICT (clave) DO NOTHING;

-- El rol 'admin' pasa a llamarse 'gerente' (control total) o 'supervisor' (permisos otorgados).
UPDATE usuarios SET rol = 'gerente'
 WHERE rol = 'admin' AND id = (SELECT min(id) FROM usuarios WHERE rol = 'admin');
UPDATE usuarios
   SET rol = 'supervisor',
       permisos = '["ver_equipo","cargar","periodos","notas"]'::jsonb
 WHERE rol = 'admin';

CREATE INDEX IF NOT EXISTS idx_cargas_periodo ON cargas(periodo_id);
CREATE INDEX IF NOT EXISTS idx_res_periodo ON resultados(periodo_id);
CREATE INDEX IF NOT EXISTS idx_res_usuario ON resultados(usuario_id);
CREATE INDEX IF NOT EXISTS idx_notas_usuario ON notas(usuario_id, leida);
