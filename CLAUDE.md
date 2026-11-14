# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Inventario con lector de códigos de barras en el navegador, publicado en Cloudflare (Workers + D1 + Durable Objects). Todo está en español: interfaz, mensajes de error, nombres de variables y comentarios. Escribe código nuevo en ese mismo idioma.

Decisiones tomadas con el usuario, datos de la publicación e historial: @MEMORY.md

Plan del asistente: `PLAN.md` (objetivo, decisiones, caso guía y forma de trabajo entre sesiones) y un archivo por etapa en `plan/`. Léelos antes de planear o de empezar un encargo. La versión al día es la de la carpeta principal (`/home/marco05/Lectorcodigodebarras`); la de un worktree puede ir atrasada.

Reglas por carpeta en `.claude/rules/` (se cargan solas al trabajar con esos archivos): `backend.md` (`src/`), `datos.md` (validación y migraciones) e `interfaz.md` (`public/`).

## Etapas del asistente

Esta tabla es el único lugar donde se anota el estado de cada etapa; el detalle está en su archivo.

| # | Etapa | Archivo | Estado |
|---|---|---|---|
| 0 | Chatbot de consulta | `plan/etapa-0-chatbot.md` | Terminada |
| 1 | Registro de ejecuciones y `version_datos` | `plan/etapa-1-registro-ejecuciones.md` | Terminada |
| 2 | Modelos intercambiables y Gemini | `plan/etapa-2-modelos-gemini.md` | En curso |
| 3 | Evals en Python y caso chicles | `plan/etapa-3-evals.md` | Sin empezar |
| 4 | Memoria de grupos y clasificador | `plan/etapa-4-memoria-grupos.md` | Sin empezar |
| 5 | Aprendizaje | `plan/etapa-5-aprendizaje.md` | Sin empezar |
| 6 | Respuestas guardadas | `plan/etapa-6-respuestas-guardadas.md` | Sin empezar |
| 7 | Correcciones desde el chat | `plan/etapa-7-correcciones-chat.md` | Sin empezar |

- `Sin empezar`: no se ha enviado ningún encargo de la etapa.
- `En curso`: desde que se envía su primer encargo.
- `Terminada`: revisada, fusionada a `main` y, si cambia la app, publicada. Lo que quede sin cerrar se anota en el apartado «Pendiente» de su archivo.

El estado lo cambia la sesión que planea, al enviar el primer encargo y al terminar la etapa. La sesión que implementa no toca esta tabla.

## Comandos

| Tarea | Comando |
|---|---|
| Servidor local (Worker + D1 local + Durable Object) | `npm run dev` → http://localhost:8787 |
| Aplicar migraciones a la base local | `npm run db:migrar:local` |
| Aplicar migraciones en producción | `npm run db:migrar` |
| Publicar | `npm run deploy` |
| Consultar la base | `npx wrangler d1 execute lector-inventario --local --command "SELECT …"` (o `--remote`) |
| Ver registros en producción | `npx wrangler tail inventario` |
| Medir el CPU del asistente (proveedor y D1 simulados, sin gastar saldo) | `node pruebas/banco-cpu.mjs [corta\|larga\|longitud\|muchas\|rechazo] [repeticiones]`; opciones y cómo comparar antes y después en su comentario inicial |

- `dev` y `deploy` ejecutan antes `npm run preparar`, que copia el lector ZXing de `node_modules` a `public/vendor/`.
- `npm run dev` necesita `.dev.vars` con `PIMIENTA`, `CODIGO_CONFIGURACION` y `DEEPSEEK_API_KEY` (valores solo locales; Wrangler no los sube). Sin `DEEPSEEK_API_KEY` la app funciona igual, pero el asistente responde 503. El modelo del asistente es la variable `MODELO_ASISTENTE` de `wrangler.jsonc`, no un secreto.
- Publicar usa la sesión OAuth de Wrangler del usuario; si expiró, él debe correr `npx wrangler login`. La conexión MCP de Cloudflare no puede subir archivos estáticos ni crear tokens, así que no sirve para publicar.
- No hay pruebas automatizadas, linter ni paso de compilación en el repositorio (`pruebas/` solo tiene el banco de CPU, que se corre a mano). Para verificar: `node --check <archivo>` y probar contra `npm run dev` (la API con `curl`, la interfaz en un navegador). La cookie de sesión es `Secure` con prefijo `__Host-`: usa `http://localhost:8787`, no `127.0.0.1`.

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

**Asistente** (`src/asistente.js`): `POST /api/asistente`, nivel `admin`, porque cada mensaje gasta saldo de DeepSeek. Usa LangChain.js con `ChatDeepSeek`, `bindTools` y un bucle propio: hasta 4 llamadas al modelo y 6 consultas por mensaje, y la última llamada va sin herramientas. Las herramientas (`buscar_productos` y `resumen_inventario`) viven en `src/consultas-inventario.js`, que calcula los totales en SQL para que el modelo no tenga que sumar. La respuesta es `text/event-stream` con eventos `data: {json}`: `texto` (un fragmento), `consulta` (se consultó el inventario), `fin` y `error`. El historial vive en la memoria de la página: el navegador lo reenvía completo en cada pregunta (`validarConversacion`) y se pierde al recargar. El cliente es `public/js/asistente.js`, con el `<dialog id="asistente">` de `index.html`.

**Registro de ejecuciones** (`src/ejecuciones-asistente.js`, migración `0002`): cada pregunta que llega a llamar al modelo deja una fila en `ejecuciones_asistente`, termine como termine. `resultado` es `bien`, `incompleta`, `error` (con un `motivo` corto, como `proveedor-401` o `tiempo`) o `interrumpida`; `guardada` queda reservado para las respuestas guardadas. La fila lleva:
- la pregunta, la respuesta tal como se emitió y cuántos mensajes previos había;
- las herramientas con sus argumentos y un resumen del resultado, que cada herramienta devuelve en `artifact` (el modelo no lo recibe);
- el modelo, `version_instrucciones` y `version_datos`;
- la duración y los tokens, que salen de `streamUsage`. Entrada y salida quedan en NULL si alguna llamada no informó su uso. La caché va aparte: queda en NULL si el proveedor no la informó.

La fila se escribe con `ejecucion.waitUntil`, y cada escritura borra lo que tenga más de 90 días. La respuesta lleva el id de la fila en la cabecera `X-Ejecucion`, también en el error JSON. El cuerpo admite `origen`: `chat` (por defecto; la interfaz no lo manda) o `eval`. `version_datos` es un contador de la tabla `contadores` que suben solos los disparadores de `productos`.

**Cliente** (`public/js/`): `inicio.js` comprueba la sesión y muestra `sesion.js` (acceso) o la app: `app.js` (cámara, panel de producto, formulario e inventario), `usuarios.js` (panel del admin) y `tiempo-real.js`. Lo compartido está en `comun.js` (llamadas a la API, animaciones, iconos, botón de mantener presionado). `api()` lanza los eventos `sesion-perdida` y `permisos-cambiados` en `window`, e `inicio.js` responde recargando la página.

## Restricciones que no son obvias

- **Nunca cambies ni regeneres el secreto `PIMIENTA`**: invalidaría todas las contraseñas guardadas.
- **CPU:** el plan de Cloudflare da 10 ms por petición. Iniciar sesión usa unos 20 ms por PBKDF2 y se tolera porque es ocasional; no agregues más trabajo de CPU a las rutas de cuentas.
- Toda mutación de productos debe llamar a `avisarCambioDeProducto`, y los cambios de cuentas a sus avisos de `tiempo-real.js`; si no, las otras páginas abiertas no se enteran.
- **Asistente:**
  - `src/worker.js` importa `asistente.js` de forma estática a propósito: así LangChain se evalúa al arrancar el Worker y no dentro de la primera petición al asistente, que tiene 10 ms de CPU. No lo cambies por un `import()` dinámico.
  - Cada fragmento de la respuesta cuesta CPU (unos 20 µs en la estimación local): no agregues trabajo por fragmento.
  - El razonamiento de DeepSeek va desactivado con `modelKwargs: { thinking: { type: 'disabled' } }`. Con razonamiento y herramientas, DeepSeek exige que se le devuelva `reasoning_content`, y el conversor de mensajes de LangChain no lo manda.
  - Lo que el asistente puede hacer lo limitan sus herramientas, no el prompt: solo leen la tabla `productos`. Una herramienta nueva amplía lo que puede conseguir cualquier texto que llegue al modelo, incluidos los nombres de producto.
  - `version_datos` se pide junto con la primera llamada al modelo, y `responder` lo espera antes de ejecutar cualquier herramienta. Si se leyera después, una fila podría quedar con una versión más nueva que los datos con que se respondió, y una respuesta guardada parecería vigente sin serlo.
  - `VERSION_INSTRUCCIONES` se calcula al cargar el módulo a partir de `PLANTILLA` (la fecha entra por `{fecha}`), `DEFINICIONES`, `PARAMETROS_MODELO` y los topes del bucle. Un parámetro fijo nuevo del modelo va en `PARAMETROS_MODELO`, no suelto en `conversar`; si no, la versión no cambia. El código de las herramientas (su SQL) no entra en la versión.
  - La pregunta y la respuesta solo se guardan en `ejecuciones_asistente`: nunca las escribas en la consola. Ninguna herramienta lee esa tabla ni `contadores`.
- El sistema visual salió de las skills instaladas en `.claude/skills/` (Emil Kowalski, `better-*` de Jakub Krehel e `impeccable`). Sus valores concretos están en `.claude/rules/interfaz.md`.
