-- ═══════════════════════════════════════════════════════════════
--  Retirar una carta que todavía nadie ha abierto
--
--  El sello sigue siendo real: en cuanto la otra persona la lee, la
--  carta es para siempre. Antes de eso, quien la escribió puede
--  arrepentirse. La regla vive en la base, no en el código del
--  Worker: ni un bug mío puede hacer desaparecer una carta leída.
-- ═══════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS tg_cartas_no_borrar;
CREATE TRIGGER tg_cartas_no_borrar
BEFORE DELETE ON cartas
WHEN OLD.abierta_en IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'carta ya leida: no se borra');
END;

-- Las fotos siguen a su carta: si la carta se puede retirar, ellas
-- también; si ya se leyó, quedan selladas igual que el texto.
DROP TRIGGER IF EXISTS tg_fotos_no_borrar;
CREATE TRIGGER tg_fotos_no_borrar
BEFORE DELETE ON fotos
WHEN (SELECT abierta_en FROM cartas WHERE id = OLD.carta_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'la carta ya se leyo: sus fotos no se borran');
END;
