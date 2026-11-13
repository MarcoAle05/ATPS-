-- Etapa 1 del asistente: contador version_datos y registro de ejecuciones.

-- Contadores que solo suben. version_datos cambia con cada cambio en los datos que el asistente consulta:
-- hoy solo productos; en la etapa 4 también los grupos. Una respuesta guardada solo sigue vigente
-- si version_datos no ha cambiado desde que se dio.
CREATE TABLE contadores (
  nombre  TEXT PRIMARY KEY CHECK (length(nombre) BETWEEN 1 AND 64),
  valor   INTEGER NOT NULL DEFAULT 0 CHECK (valor >= 0)
) STRICT;

INSERT INTO contadores (nombre, valor) VALUES ('version_datos', 0);

-- Sube una vez por fila tocada. Un UPDATE que deja los mismos valores también lo sube (ante la duda, de más).
-- Una sentencia que no toca ninguna fila no dispara nada: código repetido (ON CONFLICT DO NOTHING)
-- o un ajuste que dejaría la cantidad negativa (el WHERE no coincide).
CREATE TRIGGER productos_version_insercion AFTER INSERT ON productos
BEGIN
  UPDATE contadores SET valor = valor + 1 WHERE nombre = 'version_datos';
END;

CREATE TRIGGER productos_version_cambio AFTER UPDATE ON productos
BEGIN
  UPDATE contadores SET valor = valor + 1 WHERE nombre = 'version_datos';
END;

CREATE TRIGGER productos_version_borrado AFTER DELETE ON productos
BEGIN
  UPDATE contadores SET valor = valor + 1 WHERE nombre = 'version_datos';
END;

-- Una fila por cada pregunta al asistente que llegó a llamar al modelo (src/ejecuciones-asistente.js).
-- Se conservan 90 días: cada escritura borra lo más viejo.
--
-- resultado:
--   bien         respuesta completa.
--   incompleta   se entregó, pero quedó cortada (max_tokens del modelo o tope de texto); lleva el aviso al final.
--   error        se emitió un evento error, o DeepSeek rechazó la primera llamada (respuesta de error JSON).
--   interrumpida el navegador cerró la conexión (también al pulsar «Detener»).
--   guardada     reservado para la etapa 6 (respuesta reutilizada sin llamar al modelo).
--
-- motivo (solo con resultado = 'error'; el formato admite códigos nuevos sin reconstruir la tabla):
--   tiempo             DeepSeek no empezó a responder a tiempo o se pasó el tiempo total.
--   deepseek-NNN       DeepSeek respondió con el estado HTTP NNN (401 clave, 402 sin saldo, 429, 5xx…).
--   sin-estado         error sin estado HTTP (red, respuesta ilegible o un fallo del propio Worker).
--   filtro-contenido   DeepSeek cortó la respuesta por su filtro de contenido.
--   sin-recursos       DeepSeek se quedó sin recursos (finish_reason insufficient_system_resource).
--   sin-texto          el modelo terminó sin escribir texto.
--
-- herramientas: lista JSON en orden de llamada, con { nombre, argumentos, resultado } por elemento.
--   argumentos son los que mandó el modelo (texto, si no eran JSON válido).
--   resultado es un resumen: buscar_productos → { total, unidades, valor, codigos };
--   resumen_inventario → el resultado completo; si falló o no quedaba cupo → { error }.
--   Si no cabe en 16 000 caracteres, se recorta por elementos y el último dice cuántos se omitieron.
--
-- tokens_*: suma de todas las llamadas al modelo de esa pregunta. tokens_cache son los de entrada
-- que DeepSeek sirvió desde su caché. Si falta el uso de alguna llamada, los tres quedan en NULL.
CREATE TABLE ejecuciones_asistente (
  id                     TEXT PRIMARY KEY CHECK (length(id) = 36),
  usuario_id             INTEGER REFERENCES usuarios (id) ON DELETE SET NULL,
  creada_en              TEXT NOT NULL DEFAULT (datetime('now')),
  origen                 TEXT NOT NULL CHECK (origen IN ('chat', 'eval')),
  pregunta               TEXT NOT NULL CHECK (pregunta <> '' AND length(pregunta) <= 500),
  mensajes_previos       INTEGER NOT NULL CHECK (mensajes_previos >= 0),
  respuesta              TEXT NOT NULL CHECK (length(respuesta) <= 4000),
  herramientas           TEXT NOT NULL CHECK (json_valid(herramientas) AND json_type(herramientas) = 'array'
                                              AND length(herramientas) <= 16000),
  modelo                 TEXT NOT NULL CHECK (length(modelo) BETWEEN 1 AND 100),
  version_instrucciones  TEXT NOT NULL CHECK (length(version_instrucciones) BETWEEN 1 AND 64),
  version_datos          INTEGER CHECK (version_datos >= 0),
  resultado              TEXT NOT NULL CHECK (resultado IN ('bien', 'incompleta', 'error', 'interrumpida', 'guardada')),
  motivo                 TEXT CHECK (length(motivo) BETWEEN 1 AND 40 AND motivo NOT GLOB '*[^a-z0-9-]*'),
  llamadas               INTEGER NOT NULL CHECK (llamadas >= 0),
  duracion_ms            INTEGER NOT NULL CHECK (duracion_ms >= 0),
  tokens_entrada         INTEGER CHECK (tokens_entrada >= 0),
  tokens_salida          INTEGER CHECK (tokens_salida >= 0),
  tokens_cache           INTEGER CHECK (tokens_cache >= 0),
  CHECK (resultado <> 'error' OR motivo IS NOT NULL),
  CHECK ((tokens_entrada IS NULL) = (tokens_salida IS NULL) AND (tokens_salida IS NULL) = (tokens_cache IS NULL))
) STRICT;

CREATE INDEX ejecuciones_asistente_creada ON ejecuciones_asistente (creada_en);
