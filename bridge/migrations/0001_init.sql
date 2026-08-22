-- ═══════════════════════════════════════════════════════════════
--  Buzón de cartas · Diego ⇄ Yulizet
--  El sello no es una promesa del código: son triggers. Una carta
--  enviada no se puede editar ni borrar ni aunque el Worker tenga
--  un bug o alguien entre con wrangler d1 execute.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE cartas (
  id             TEXT    PRIMARY KEY,           -- crypto.randomUUID()
  de             TEXT    NOT NULL CHECK (de   IN ('diego','yulizet')),
  para           TEXT    NOT NULL CHECK (para IN ('diego','yulizet')),
  titulo         TEXT             CHECK (titulo IS NULL OR length(titulo) <= 120),
  sobre          TEXT             CHECK (sobre  IS NULL OR length(sobre)  <= 140),
  cuerpo         TEXT    NOT NULL CHECK (length(cuerpo) BETWEEN 1 AND 20000),
  creada_en      INTEGER NOT NULL,              -- epoch ms UTC, reloj del servidor
  abre_en        INTEGER NOT NULL,              -- epoch ms UTC, calculado en el servidor
  abre_el        TEXT,                          -- 'YYYY-MM-DD' local, solo para mostrar
  tz             TEXT    NOT NULL DEFAULT 'America/Mexico_City',
  tz_offset_min  INTEGER NOT NULL DEFAULT -360, -- offset usado al calcular abre_en
  abierta_en     INTEGER,                       -- 1a vez que el servidor entregó el cuerpo
  clave_cliente  TEXT,                          -- Idempotency-Key
  ip_hash        TEXT,
  agente         TEXT,
  CHECK (de <> para),
  CHECK (abre_en >= creada_en)
);

CREATE UNIQUE INDEX ux_cartas_idem     ON cartas(de, clave_cliente) WHERE clave_cliente IS NOT NULL;
CREATE INDEX        ix_cartas_buzon    ON cartas(para, creada_en DESC);
CREATE INDEX        ix_cartas_enviadas ON cartas(de,   creada_en DESC);
CREATE INDEX        ix_cartas_sin_leer ON cartas(para, abre_en) WHERE abierta_en IS NULL;

-- Fotos: los bytes viven en R2, aquí solo el índice.
CREATE TABLE fotos (
  id         TEXT    PRIMARY KEY,
  carta_id   TEXT    NOT NULL REFERENCES cartas(id),
  orden      INTEGER NOT NULL,
  clave      TEXT    NOT NULL,                  -- llave del objeto en R2
  tipo       TEXT    NOT NULL DEFAULT 'image/webp',
  bytes      INTEGER NOT NULL,
  ancho      INTEGER,
  alto       INTEGER,
  creada_en  INTEGER NOT NULL
);
CREATE INDEX        ix_fotos_carta ON fotos(carta_id, orden);
CREATE UNIQUE INDEX ux_fotos_orden ON fotos(carta_id, orden);

-- ── El sello ───────────────────────────────────────────────────
-- BEGIN/END en MAYÚSCULAS: en minúsculas D1 falla al migrar en
-- remoto con SQLITE_ERROR 7500 (bug conocido de workers-sdk).
CREATE TRIGGER tg_cartas_no_editar
BEFORE UPDATE OF de, para, titulo, sobre, cuerpo, creada_en, abre_en, abre_el, tz, tz_offset_min ON cartas
BEGIN
  SELECT RAISE(ABORT, 'carta sellada: no se edita');
END;

CREATE TRIGGER tg_cartas_no_borrar
BEFORE DELETE ON cartas
BEGIN
  SELECT RAISE(ABORT, 'carta sellada: no se borra');
END;

CREATE TRIGGER tg_cartas_abrir_una_vez
BEFORE UPDATE OF abierta_en ON cartas
WHEN OLD.abierta_en IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'ya estaba abierta');
END;

CREATE TRIGGER tg_fotos_no_editar
BEFORE UPDATE ON fotos
BEGIN
  SELECT RAISE(ABORT, 'foto sellada: no se edita');
END;

CREATE TRIGGER tg_fotos_no_borrar
BEFORE DELETE ON fotos
BEGIN
  SELECT RAISE(ABORT, 'foto sellada: no se borra');
END;

-- ── Portero ────────────────────────────────────────────────────
-- Agregado por minuto a propósito: si cada intento fallido fuera
-- una fila, un flood agotaría la cuota de escrituras de D1 y la
-- base entera dejaría de responder ese día, lecturas incluidas.
CREATE TABLE intentos (
  ambito  TEXT    NOT NULL,        -- 'global' | 'ip:<hash>'
  minuto  INTEGER NOT NULL,        -- floor(epoch_ms / 60000)
  fallos  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ambito, minuto)
) WITHOUT ROWID;

CREATE INDEX ix_intentos_minuto ON intentos(minuto);

CREATE TABLE accesos (             -- solo entradas CORRECTAS: volumen acotado
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      INTEGER NOT NULL,
  quien   TEXT    NOT NULL,
  ip_hash TEXT,
  agente  TEXT,
  pais    TEXT
);
CREATE INDEX ix_accesos_ts ON accesos(ts DESC);
