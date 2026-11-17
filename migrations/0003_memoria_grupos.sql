-- Etapa 4 del asistente: memoria de grupos.
-- Un grupo es un conjunto de productos por lo que son (chicles, refrescos, productos de limpieza). La memoria guarda,
-- por cada grupo y producto, si pertenece o no y quién lo dijo. Es de todo el inventario, no de una sesión ni de una
-- cuenta. La escribe la herramienta productos_del_grupo (src/consultas-inventario.js) con los juicios del clasificador
-- (src/clasificador.js). Esta migración solo crea las tablas: no carga datos.

-- nombre: ya normalizado por validarNombreGrupo (public/js/validacion.js): minúsculas, sin acentos (la ñ queda como
--   n), espacios colapsados y solo letras a-z, dígitos y espacios. El singular lo pone el conversador, no el código.
--   El CHECK repite esas reglas.
CREATE TABLE grupos (
  id         INTEGER PRIMARY KEY,
  nombre     TEXT NOT NULL UNIQUE CHECK (length(nombre) BETWEEN 1 AND 40 AND nombre NOT GLOB '*[^a-z0-9 ]*'
                                         AND nombre = trim(nombre) AND instr(nombre, '  ') = 0),
  creado_en  TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

-- Una fila por grupo y producto juzgado. También se guarda el «no»: así un producto que no pertenece no se vuelve a
-- juzgar.
--
-- pertenece             1 si el producto es del grupo, 0 si no.
-- origen                clasificador: lo juzgó el clasificador, es «probable».
--                       dueno: lo dijo el dueño, es «confirmado». El clasificador nunca cambia una fila del dueño
--                       (el upsert de productos_del_grupo solo actualiza filas con origen clasificador).
-- nombre_visto          el nombre del producto cuando se juzgó. Un producto está «sin revisar» en un grupo si no tiene
--                       fila, o si su fila es del clasificador y su nombre actual ya no es nombre_visto (lo
--                       renombraron). Solo esos se mandan al clasificador.
-- version_clasificador  la versión del clasificador que lo juzgó (hash de sus instrucciones, esquema, modelo y
--                       parámetros); no nula si y solo si origen = 'clasificador'.
-- juzgado_en            cuándo se escribió el juicio.
--
-- Al borrar un producto se borran sus filas (ON DELETE CASCADE; D1 aplica las llaves foráneas). El código de un
-- producto nunca cambia (src/productos.js no lo actualiza), así que no hace falta ON UPDATE.
--
-- Tokens: las columnas tokens_* de ejecuciones_asistente siguen siendo solo del conversador. Los del clasificador
-- quedan en el resumen de productos_del_grupo dentro de la columna herramientas de esa fila:
--   { grupo, total, unidades, valor, codigos, sin_revisar, clasificacion }
--   clasificacion es null si no se llamó al clasificador; si se llamó:
--   { enviados, revisados, pertenecen, descartados, modelo, version, tokens: { entrada, salida, cache }, duracion_ms, error? }
--   enviados es cuántos productos se mandaron; revisados es cuántos quedaron juzgados (0 si el clasificador falló).
CREATE TABLE miembros_grupo (
  grupo_id              INTEGER NOT NULL REFERENCES grupos (id) ON DELETE CASCADE,
  codigo                TEXT NOT NULL REFERENCES productos (codigo) ON DELETE CASCADE,
  pertenece             INTEGER NOT NULL CHECK (pertenece IN (0, 1)),
  origen                TEXT NOT NULL CHECK (origen IN ('clasificador', 'dueno')),
  nombre_visto          TEXT NOT NULL CHECK (length(nombre_visto) BETWEEN 1 AND 250),
  version_clasificador  TEXT CHECK (length(version_clasificador) BETWEEN 1 AND 64),
  juzgado_en            TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (grupo_id, codigo),
  CHECK ((origen = 'clasificador') = (version_clasificador IS NOT NULL))
) STRICT;

-- Para el borrado en cascada desde productos (y para buscar las filas de un producto).
CREATE INDEX miembros_grupo_codigo ON miembros_grupo (codigo);

-- La memoria cambia las respuestas de grupo, así que también sube version_datos (migración 0002), una vez por fila
-- tocada. También cuentan los borrados en cascada al eliminar un producto o un grupo.
CREATE TRIGGER miembros_grupo_version_insercion AFTER INSERT ON miembros_grupo
BEGIN
  UPDATE contadores SET valor = valor + 1 WHERE nombre = 'version_datos';
END;

CREATE TRIGGER miembros_grupo_version_cambio AFTER UPDATE ON miembros_grupo
BEGIN
  UPDATE contadores SET valor = valor + 1 WHERE nombre = 'version_datos';
END;

CREATE TRIGGER miembros_grupo_version_borrado AFTER DELETE ON miembros_grupo
BEGIN
  UPDATE contadores SET valor = valor + 1 WHERE nombre = 'version_datos';
END;
