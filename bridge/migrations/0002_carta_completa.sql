-- ═══════════════════════════════════════════════════════════════
--  Las partes de una carta de verdad
--
--  Hasta ahora una carta era título + cuerpo, que es un mensaje, no
--  una carta. Una carta lleva lugar y fecha, saludo, cuerpo,
--  despedida y firma. La fecha ya estaba (creada_en); faltaban las
--  otras cuatro.
--
--  Migración ADITIVA: SQLite apenas sabe alterar tablas, así que
--  nunca se edita una migración ya aplicada, se añade la siguiente.
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE cartas ADD COLUMN lugar     TEXT;
ALTER TABLE cartas ADD COLUMN saludo    TEXT;
ALTER TABLE cartas ADD COLUMN despedida TEXT;
ALTER TABLE cartas ADD COLUMN firma     TEXT;

-- El sello tiene que cubrir también lo nuevo: si no, el saludo y la
-- firma serían las únicas partes de la carta que se podrían reescribir.
DROP TRIGGER IF EXISTS tg_cartas_no_editar;
CREATE TRIGGER tg_cartas_no_editar
BEFORE UPDATE OF de, para, titulo, sobre, cuerpo, creada_en, abre_en, abre_el,
                 tz, tz_offset_min, lugar, saludo, despedida, firma ON cartas
BEGIN
  SELECT RAISE(ABORT, 'carta sellada: no se edita');
END;
