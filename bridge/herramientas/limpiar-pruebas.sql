-- ⚠️  BORRA TODAS LAS CARTAS. Solo para vaciar datos de prueba ANTES
--     de empezar a usar el buzón de verdad. Nunca después.
--     Uso: wrangler d1 execute jardin-cartas --remote --file=herramientas/limpiar-pruebas.sql
--
--  Las cartas están protegidas por triggers que abortan cualquier
--  DELETE, así que hay que quitarlos, borrar y volver a ponerlos.
--  Si se dejan quitados, el sello deja de existir.
DROP TRIGGER IF EXISTS tg_cartas_no_editar;
DROP TRIGGER IF EXISTS tg_cartas_no_borrar;
DROP TRIGGER IF EXISTS tg_cartas_abrir_una_vez;
DROP TRIGGER IF EXISTS tg_fotos_no_editar;
DROP TRIGGER IF EXISTS tg_fotos_no_borrar;
DELETE FROM fotos;
DELETE FROM archivadas;
DELETE FROM cartas;
DELETE FROM accesos;
DELETE FROM intentos;
CREATE TRIGGER tg_cartas_no_editar
BEFORE UPDATE OF de, para, titulo, sobre, cuerpo, creada_en, abre_en, abre_el,
                 tz, tz_offset_min, lugar, saludo, despedida, firma ON cartas
BEGIN
  SELECT RAISE(ABORT, 'carta sellada: no se edita');
END;
CREATE TRIGGER tg_cartas_no_borrar
BEFORE DELETE ON cartas
WHEN OLD.abierta_en IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'carta ya leida: no se borra');
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
WHEN (SELECT abierta_en FROM cartas WHERE id = OLD.carta_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'la carta ya se leyo: sus fotos no se borran');
END;
