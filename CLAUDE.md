# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Inventario con lector de códigos de barras en el navegador, publicado en Cloudflare (Workers + D1 + Durable Objects). Todo está en español: interfaz, mensajes de error, nombres de variables y comentarios. Escribe código nuevo en ese mismo idioma.

Decisiones tomadas con el usuario, datos de la publicación e historial: @MEMORY.md

Reglas por carpeta en `.claude/rules/` (se cargan solas al trabajar con esos archivos): `backend.md` (`src/`), `datos.md` (validación y migraciones) e `interfaz.md` (`public/`).

## Comandos

| Tarea | Comando |
|---|---|
| Servidor local (Worker + D1 local + Durable Object) | `npm run dev` → http://localhost:8787 |
| Aplicar migraciones a la base local | `npm run db:migrar:local` |
| Aplicar migraciones en producción | `npm run db:migrar` |
| Publicar | `npm run deploy` |
| Consultar la base | `npx wrangler d1 execute lector-inventario --local --command "SELECT …"` (o `--remote`) |
| Ver registros en producción | `npx wrangler tail inventario` |

- `dev` y `deploy` ejecutan antes `npm run preparar`, que copia el lector ZXing de `node_modules` a `public/vendor/`.
- `npm run dev` necesita `.dev.vars` con `PIMIENTA` y `CODIGO_CONFIGURACION` (valores solo locales; Wrangler no los sube).
- Publicar usa la sesión OAuth de Wrangler del usuario; si expiró, él debe correr `npx wrangler login`. La conexión MCP de Cloudflare no puede subir archivos estáticos ni crear tokens, así que no sirve para publicar.
- No hay pruebas automatizadas, linter ni paso de compilación en el repositorio. Para verificar: `node --check <archivo>` y probar contra `npm run dev` (la API con `curl`, la interfaz en un navegador). La cookie de sesión es `Secure` con prefijo `__Host-`: usa `http://localhost:8787`, no `127.0.0.1`.

## Arquitectura

**Una sola entrada.** `src/worker.js` atiende solo `/api/*` (`run_worker_first` en `wrangler.jsonc`). Todo lo demás lo sirve Cloudflare directo desde `public/`, con las cabeceras de `public/_headers` (CSP estricta). Las rutas viven en la tabla `RUTAS` de `worker.js`, cada una con su nivel mínimo: `publico` < `lector` (cualquier sesión) < `editor` < `admin`. El permiso se comprueba ahí, antes del manejador, que recibe `{ request, env, ejecucion, url, params, usuario, sesionId }`.

**Validación compartida.** `public/js/validacion.js` lo usan el navegador y el Worker (los archivos de `src/` lo importan desde `../public/js/validacion.js`; Wrangler lo empaqueta). Los mismos límites existen como `CHECK` en `migrations/`.

**Cuentas** (`src/cuentas.js`, `src/seguridad.js`):
- Roles: `lector` (al registrarse; solo ver), `editor` (autorizado por el admin), `admin` (único, garantizado por el índice `usuarios_un_admin`).
- La cuenta admin se crea una sola vez en `/api/configurar` con el secreto `CODIGO_CONFIGURACION`. El registro normal está cerrado hasta que exista.
- Contraseñas: HMAC con el secreto `PIMIENTA` y luego PBKDF2-SHA256 con 100 000 iteraciones (el máximo de Web Crypto en Workers).
- Sesión: cookie `__Host-sesion` (HttpOnly, Secure, SameSite=Lax). En D1 solo se guarda el SHA-256 del token. Dura 7 días renovables, con un máximo de 30.
- Límite de intentos con la tabla `intentos`: inicio de sesión por correo y por IP; registro y configuración por IP.
- CSRF: `verificarOrigen` (cabeceras `Origin` y `Sec-Fetch-Site`) y cuerpos aceptados solo como `application/json`.

**Tiempo real** (`src/tiempo-real.js` y `public/js/tiempo-real.js`): un Durable Object `Difusor` (`getByName('inventario')`) mantiene un WebSocket por página abierta, con la API de hibernación y respuesta automática a `ping`. Cada socket lleva las etiquetas `usuario:<id>`, `sesion:<hash>` y `rol:<rol>`. Un aviso de producto solo dice `{ tipo: 'producto', codigo }`: el navegador vuelve a pedir ese producto (`refrescarProducto` en `app.js`, que agrupa avisos repetidos), así los cambios simultáneos nunca dejan un valor viejo. Cerrar con código 4001 significa "sesión terminada" (bloqueo, cuenta eliminada o cierre de sesión).

**Cliente** (`public/js/`): `inicio.js` comprueba la sesión y muestra `sesion.js` (acceso) o la app: `app.js` (cámara, panel de producto, formulario e inventario), `usuarios.js` (panel del admin) y `tiempo-real.js`. Lo compartido está en `comun.js` (llamadas a la API, animaciones, iconos, botón de mantener presionado). `api()` lanza los eventos `sesion-perdida` y `permisos-cambiados` en `window`, e `inicio.js` responde recargando la página.

## Restricciones que no son obvias

- **Nunca cambies ni regeneres el secreto `PIMIENTA`**: invalidaría todas las contraseñas guardadas.
- **CPU:** el plan de Cloudflare da 10 ms por petición. Iniciar sesión usa unos 20 ms por PBKDF2 y se tolera porque es ocasional; no agregues más trabajo de CPU a las rutas de cuentas.
- Toda mutación de productos debe llamar a `avisarCambioDeProducto`, y los cambios de cuentas a sus avisos de `tiempo-real.js`; si no, las otras páginas abiertas no se enteran.
- El sistema visual salió de las skills instaladas en `.claude/skills/` (Emil Kowalski, `better-*` de Jakub Krehel e `impeccable`). Sus valores concretos están en `.claude/rules/interfaz.md`.
