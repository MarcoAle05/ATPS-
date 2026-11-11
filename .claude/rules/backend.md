---
paths:
  - "src/**/*.js"
  - "wrangler.jsonc"
---

# Reglas del Worker (`src/`)

- Errores: `throw new ErrorApi(status, mensaje, { campo, codigo, cabeceras })`. El mensaje llega tal cual al usuario: en español, dice qué pasó y cómo seguir. `campo` hace que el cliente lo muestre bajo ese input; `codigo` es para lógica del cliente (`sin-sesion`, `sin-permiso`, `ya-configurado`, `sin-configurar`, `bloqueado`, `asistente-sin-configurar`).
- Validación: `exigir(validarX(valor), 'campo')` con las funciones de `public/js/validacion.js`. No dupliques reglas en `src/`.
- Cuerpos: `leerJson(request, tamanoMaximo)` (exige `application/json`; máximo 10 KB, medido en caracteres). Solo la ruta que necesite más pasa su propio tamaño, como los 32 KB de `ASISTENTE_CUERPO_MAX` en `/api/asistente`. Respuestas: `json(datos, status, cabeceras)`; con 204 va sin cuerpo.
- Límite de intentos: `comprobarLimite(env, clave, maximo, ventana, { motivo })` y luego `anotarIntento(env, clave)`. `motivo` es el inicio del mensaje 429 ("Demasiados intentos" por defecto; el asistente usa "Demasiados mensajes").
- SQL solo con `prepare(...).bind(...)`, nunca interpolando valores. Lo que deba ir junto va en `env.DB.batch([...])`, que es una transacción. Fechas como texto UTC con `datetime('now')`.
- Ruta nueva: agrégala a `RUTAS` en `worker.js` con su nivel. No compruebes roles dentro del manejador.
- Efectos secundarios (avisos en tiempo real) con los helpers de `tiempo-real.js`, que usan `ejecucion.waitUntil`: nunca retrasan la respuesta y su error no la rompe.
- Inicio de sesión: siempre "Correo o contraseña incorrectos." y se calcula un hash ficticio si el correo no existe, para no revelar qué cuentas hay.
- La cuenta `admin` no se puede modificar ni eliminar desde la API (las sentencias llevan `AND rol <> 'admin'`); mantén esa protección.
- Cambios en `wrangler.jsonc` que agreguen clases de Durable Object necesitan una entrada nueva en `migrations` (con un `tag` nuevo); no edites `v1`.
