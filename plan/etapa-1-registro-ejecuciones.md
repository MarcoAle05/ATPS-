# Etapa 1: registro de ejecuciones y `version_datos`

Estado: se anota en la tabla «Etapas del asistente» de `CLAUDE.md`, no aquí.

## Qué entrega

- Una migración nueva (`0002_...sql`, tablas `STRICT`) con la tabla `ejecuciones_asistente` y el contador `version_datos`.
- Una fila por cada pregunta al asistente, escrita al terminar la respuesta y sin retrasarla.
- Ningún cambio en la interfaz.

## Cómo se verifica

Cada pregunta deja su fila, con su modelo; el contador sube con cada cambio en `productos`.

## Para qué sirve

Para tres cosas: las respuestas guardadas (etapa 6), los evals (etapa 3) y entender por qué algo falló.

## Diseño

### Registro de ejecuciones

Tabla `ejecuciones_asistente`, una fila por pregunta:

- quién y cuándo;
- pregunta, respuesta y cuántos mensajes previos había;
- herramientas llamadas, con sus argumentos y un resumen del resultado;
- modelo, versión de las instrucciones y `version_datos`;
- cómo terminó;
- duración y tokens;
- origen: chat o eval.

Se conservan 90 días, borrando lo viejo al escribir.

Precisiones fijadas al redactar el encargo (2026-11-13):

- **Identificador.** Cada fila tiene un UUID que el Worker genera al empezar. La respuesta lo devuelve en la cabecera `X-Ejecucion`, para que los evals y las correcciones desde el chat puedan señalar una ejecución concreta.
- **Qué deja fila.** Toda petición que llegó a llamar al modelo, termine como termine. Las rechazadas antes (cuerpo inválido, sin permiso, límite de mensajes) no dejan fila.
- **Cómo terminó.** `bien`, `incompleta` (se entregó pero quedó cortada), `error` (con un código corto del motivo), `interrumpida` (el navegador cortó) y `guardada` (reservado para la etapa 6). Solo una ejecución `bien` podrá reutilizarse como respuesta guardada.
- **Versión de las instrucciones.** Se deriva del contenido (instrucciones, definición de las herramientas y parámetros de la llamada), no de un número que haya que subir a mano. La fecha del día queda fuera.
- **Herramientas.** Se guardan los argumentos y un resumen del resultado: totales y códigos de producto, sin nombres ni precios.
- **Tokens.** Entrada, salida y entrada servida desde la caché del proveedor. Entrada y salida van juntas: si falta el dato de alguna llamada, quedan vacías, porque una suma parcial engaña. Los de caché van aparte y quedan vacíos si el proveedor no los informa. Exigen activar el uso en el flujo de LangChain.
- **Origen.** La petición admite un campo opcional `origen` (`chat` o `eval`); la interfaz no lo envía.
- **Escritura.** Va con `waitUntil`: si falla, la respuesta llega igual.

### `version_datos`

Un contador que sube con cada cambio en `productos`. Desde la etapa 4 subirá también con los cambios en la memoria de grupos.

- **Cómo sube.** Primera opción: disparadores de SQLite en la migración, comprobando que D1 los admite en local y al aplicar la migración. Si no, se sube desde el código, en la misma transacción que cada cambio de `src/productos.js`.
- **Ante la duda, sube de más.** Un cambio que deja los mismos valores puede subirlo; lo que no puede pasar es un cambio real que no lo suba.
- **Se lee al empezar la pregunta**, antes de cualquier consulta de herramienta. Si el inventario cambia a media respuesta, la fila queda con la versión vieja y esa respuesta nunca se da por vigente.

## Cómo quedó

Entregado en la rama del worktree en cuatro commits: `3b31ad8` (código y migración), `907d1ea` (documentación), `3125199` (correcciones de la revisión) y `fa0fca4` (su documentación).

- **Migración `0002_registro_asistente.sql`:** tabla `contadores`, tres disparadores sobre `productos` y tabla `ejecuciones_asistente`. Los disparadores funcionan en D1 local con Wrangler 4.151.0, así que `src/productos.js` no se tocó.
- **`src/ejecuciones-asistente.js`:** abre el registro, lee `version_datos` a la vez que la primera llamada al modelo y escribe la fila con `waitUntil`.
- **Resumen de herramientas:** cada herramienta lo devuelve aparte del texto que recibe el modelo, así que no hay que volver a leer el JSON.
- **Versión de las instrucciones:** una huella de 16 caracteres calculada al arrancar el Worker. Cubre las instrucciones sin la fecha, la definición de las herramientas, los parámetros de la llamada y los topes del bucle. No cubre el modelo, que tiene su columna, ni el código de las herramientas.

Cifras medidas en local (2026-11-13):

| Medida | Antes | Después |
|---|---|---|
| CPU, respuesta corta con una consulta | 2.97 ms | 2.98 ms |
| CPU, respuesta larga de 800 fragmentos | 19.3 ms | 19.9 ms |
| Arranque del Worker | 103 ms | 108 ms |
| Worker comprimido | 587.41 KiB | 589.68 KiB |

El CPU se midió en Node con DeepSeek y D1 simulados, no en producción. El script quedó en el repositorio: `node pruebas/banco-cpu.mjs`, con su forma de uso en el comentario inicial. Cada etapa siguiente mide con él antes y después.

## En producción

Comprobado el 2026-11-13 con seis preguntas del dueño en la app publicada (versión `a94f1de0`). D1 y Observability guardan la hora en UTC, por eso las filas dicen 2026-11-14.

- Seis preguntas, seis filas, todas `bien`, con modelo `deepseek-flash` y la misma `version_instrucciones` (`89c36e57c48775ed`).
- `mensajes_previos` fue 0, 2, 4, 6, 8 y 10: la conversación se reenvió completa en cada pregunta.
- Las seis tienen tokens de entrada, salida y caché: de 1 244 a 3 318 de entrada y de 52 a 187 de salida.
- El resumen de herramientas solo trae argumentos, totales y códigos; ni nombres ni precios.
- Entre la tercera y la cuarta pregunta el dueño dio de alta un producto y le ajustó la cantidad. Fueron dos cambios, `version_datos` pasó de 0 a 2 y las tres preguntas siguientes quedaron con 2.

CPU por pregunta, tomado de Workers Observability (`observability.enabled` en `wrangler.jsonc`):

| Pregunta | Llamadas al modelo | CPU | Tiempo total |
|---|---|---|---|
| 1 | 2 | 79 ms | 2.4 s |
| 2 | 1 | 59 ms | 1.6 s |
| 3 | 2 | 55 ms | 2.5 s |
| 4 | 1 | 44 ms | 1.1 s |
| 5 | 1 | 33 ms | 1.3 s |
| 6 | 2 | 48 ms | 2.7 s |

- Todas pasan de los 10 ms del plan gratuito y ninguna se cortó. Los dos inicios de sesión de esa prueba gastaron 38 y 27 ms.
- El banco en Node estima unos 3 ms para una respuesta corta; en producción se gastó entre 11 y 27 veces más. El banco sirve para comparar antes y después, no para saber cuánto se gasta.
- La única pregunta de la etapa 0 que quedó en Observability gastó 46 ms, dentro del mismo rango: no hay señal de que la etapa 1 haya subido el CPU.
- La respuesta más larga tuvo 400 caracteres. La respuesta larga sigue sin medirse en producción.

## Límites conocidos

- **Respuesta cortada por el navegador.** La fila guarda lo que el Worker ya había enviado, que puede ser un poco más de lo que alcanzó a verse en pantalla.
- **Navegador que se va antes de que empiece la respuesta.** En local el Worker termina la respuesta completa y la fila queda como `bien`, aunque nadie la recibió. No se sabe cómo se comporta en producción.
- **Motivos de error sin provocar.** Con DeepSeek real solo se probó la clave rechazada (401). Tiempo de espera, filtro de contenido, falta de recursos, respuesta sin texto, 402, 429 y 5xx no se provocaron.

## Orden para publicar

Primero la migración (`npm run db:migrar`) y después el Worker (`npm run deploy`). Si se publica sin la tabla, cada pregunta se responde igual, pero no deja fila y anota un error en los registros. Así se hizo el 2026-11-13.

## Avance

- 2026-11-13 · Encargo enviado a la sesión que implementa (`logperch-b5`).
- 2026-11-13 · Entrega recibida y revisada: diff completo leído, y contador, disparadores y filas comprobados en la base local. Los diez puntos de la verificación pasaron.
- 2026-11-13 · Ronda de correcciones enviada, con tres puntos:
  - los tokens de caché no deben dejar vacíos los de entrada y salida cuando el proveedor no los informa (importa para Gemini);
  - el motivo de error pasa de `deepseek-NNN` a `proveedor-NNN`;
  - el script que mide el CPU se guarda en el repositorio.
- 2026-11-13 · Correcciones recibidas y revisadas. Con el script de medición se comprobó que, sin datos de caché, la fila conserva entrada y salida; que el rechazo del proveedor queda como `proveedor-401`; y que la base local tiene el esquema nuevo. Una fusión de prueba con los cambios pendientes de la carpeta principal no dio conflictos.
- 2026-11-13 · Fusionada a `main` (commit `c64f135`), a petición del dueño. La fusión no tuvo conflictos y el script de medición corre sobre `main`.
- 2026-11-13 · Migración aplicada en producción y Worker publicado, a petición del dueño.
  - Antes de migrar se anotó el punto de restauración de D1: `00000027-00000000-00005123-9f92a7075eb1fc4e52a19b9e41be913e`.
  - En producción quedaron las dos tablas, los tres disparadores y el contador en 0; los productos no cambiaron.
  - Worker: 587.92 KiB comprimido y arranque de 31 ms. Versión `a94f1de0-8b38-48f7-a616-0dc2bfbc8e96`.
  - Sin sesión, la app publicada responde 200 en la página y 401 en `POST /api/asistente`.
- 2026-11-13 · Verificada en producción con seis preguntas del dueño: cada una dejó su fila y `version_datos` subió con los dos cambios de productos. El CPU se tomó de Workers Observability. El detalle está en «En producción». Etapa terminada.

## Pendiente

- Medir en producción una respuesta larga. En Node, la de 800 fragmentos gasta unas 7 veces lo de una corta.
- Provocar los motivos de error que faltan (ver «Límites conocidos»).
- Cada pregunta gasta de 33 a 79 ms de CPU y el plan gratuito da 10 ms. Cloudflare las ha dejado terminar. Si aparecen errores 1102, habrá que recortar CPU o pasar a Workers Paid. No lo causó esta etapa, pero cada etapa que agregue trabajo al asistente lo acerca al límite.
