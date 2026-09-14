-- ═══════════════════════════════════════════════════════════════
--  Archivar: quitar una carta de la vista sin tocar la carta
--
--  El sello dice que una carta enviada no se edita, y esto no la
--  edita: archivar es una nota al margen, en su propia tabla y con
--  el nombre de quien la archiva. Cada persona archiva SU vista; la
--  carta se queda entera y la otra la sigue viendo igual.
--
--  Por eso va en una tabla aparte y no en una columna de `cartas`:
--  la tabla de las cartas es la que no se toca.
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE archivadas (
  carta_id TEXT    NOT NULL REFERENCES cartas(id),
  quien    TEXT    NOT NULL CHECK (quien IN ('diego','yulizet')),
  ts       INTEGER NOT NULL,
  PRIMARY KEY (carta_id, quien)
) WITHOUT ROWID;

CREATE INDEX ix_archivadas_quien ON archivadas(quien, ts DESC);
