-- Esquema inicial: inventario, cuentas, sesiones y control de intentos.
-- Los CHECK repiten las reglas de public/js/validacion.js como última barrera.

CREATE TABLE productos (
  codigo           TEXT PRIMARY KEY CHECK (length(codigo) BETWEEN 1 AND 64),
  nombre           TEXT NOT NULL CHECK (length(nombre) BETWEEN 1 AND 250),
  precio_centavos  INTEGER NOT NULL CHECK (precio_centavos BETWEEN 0 AND 1000000),
  cantidad         INTEGER NOT NULL DEFAULT 0 CHECK (cantidad BETWEEN 0 AND 9007199254740991),
  creado_en        TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en   TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

-- rol: lector (solo ver, valor por defecto al registrarse), editor (autorizado), admin (dueño).
CREATE TABLE usuarios (
  id              INTEGER PRIMARY KEY,
  nombre          TEXT NOT NULL CHECK (length(nombre) BETWEEN 2 AND 60),
  correo          TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(correo) BETWEEN 3 AND 254),
  hash            TEXT NOT NULL CHECK (hash LIKE 'pbkdf2-sha256$%'),
  rol             TEXT NOT NULL DEFAULT 'lector' CHECK (rol IN ('lector', 'editor', 'admin')),
  estado          TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'bloqueado')),
  creado_en       TEXT NOT NULL DEFAULT (datetime('now')),
  autorizado_en   TEXT,
  autorizado_por  INTEGER REFERENCES usuarios (id) ON DELETE SET NULL,
  ultimo_acceso   TEXT
) STRICT;

-- Solo puede existir una cuenta de administrador.
CREATE UNIQUE INDEX usuarios_un_admin ON usuarios (rol) WHERE rol = 'admin';

-- id = SHA-256 del token de la cookie; el token en sí nunca se guarda.
CREATE TABLE sesiones (
  id                TEXT PRIMARY KEY CHECK (length(id) = 64),
  usuario_id        INTEGER NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  creada_en         TEXT NOT NULL DEFAULT (datetime('now')),
  ultima_actividad  TEXT NOT NULL DEFAULT (datetime('now')),
  expira_en         TEXT NOT NULL
) STRICT;
CREATE INDEX sesiones_usuario ON sesiones (usuario_id);
CREATE INDEX sesiones_expiracion ON sesiones (expira_en);

-- Intentos de inicio de sesión, registro y configuración, para frenar ataques de fuerza bruta.
CREATE TABLE intentos (
  clave    TEXT NOT NULL,
  momento  INTEGER NOT NULL
) STRICT;
CREATE INDEX intentos_clave_momento ON intentos (clave, momento);
CREATE INDEX intentos_momento ON intentos (momento);
