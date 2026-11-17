# MEMORY.md

Decisiones tomadas con el usuario y datos que no se deducen del código. Agrega lo nuevo con fecha; no reescribas el historial.

## Publicación

- App: https://inventario.lector-barras.workers.dev (Worker `inventario`).
- Subdominio de la cuenta: `lector-barras`, neutro a propósito para no exponer el correo del dueño en la URL.
- Base D1 `lector-inventario` (región WNAM) y Durable Object `Difusor` (migración `v1`).
- Secretos del Worker: `PIMIENTA` y `CODIGO_CONFIGURACION`. El código de configuración ya se usó: la cuenta de administrador del dueño existe desde el 2026-10-16.
- No se pudo consultar la suscripción de Cloudflare; se asume el plan gratuito de Workers (10 ms de CPU por petición).
- ~~2026-11-11 · Secreto nuevo `DEEPSEEK_API_KEY` para el asistente, todavía sin crear en producción. El asistente aún no está publicado.~~
- 2026-11-11 · Asistente publicado. `main` avanzó a `d7adcf8`, se creó el secreto `DEEPSEEK_API_KEY` (la misma clave del `.dev.vars` del worktree) y se publicó el Worker: 585 KiB comprimido y arranque de 54 ms. `main` quedó con tres commits sin `push` a GitHub.
- 2026-11-11 · En producción hay una cuenta de administrador, la del dueño, y dos de editor. El asistente solo lo ve el administrador.
- 2026-11-13 · Etapa 1 del asistente publicada, a petición del dueño: migración `0002` aplicada en producción y después el Worker (587.92 KiB comprimido, arranque de 31 ms). Ese día el inventario de producción tenía 2 productos.
- 2026-11-13 · Etapa 2 del asistente publicada, a petición del dueño, sin migración: Worker de 589.99 KiB comprimido, arranque de 33 ms, versión `bae0fe57`. En producción no existe `GEMINI_API_KEY`: el chat sigue con DeepSeek, y pedir `modelo: "gemini"` responde 503.
- 2026-11-16 · A petición del dueño, se agregaron directo en D1 de producción 11 productos definitivos, tomados de Open Food Facts: chicles de su lista y trampas para los evals. Quedaron con precio 0 y cantidad 0, y producción pasó a 14 productos. El detalle está en `plan/etapa-3-evals.md`. Punto de restauración previo: `0000002e-00000000-00005125-4f6a4fe07e22ecf99591c9a6b0c1685a`.
  - Ese mismo día, a petición del dueño, se agregaron otros 5 productos de su lista que no están en Open Food Facts, con códigos inventados del rango interno de GS1: `2000000000015` a `2000000000053`. Producción quedó con 19 productos. Punto de restauración previo: `0000002f-00000000-00005125-77e4a3d58b118ee987c85cfddde22c7b`.
  - La app guarda los códigos tal como los lee el escáner, sin normalizar. El lector ZXing, sin formatos fijados, entrega los UPC-A con 12 dígitos, sin el 0 inicial que usa Open Food Facts.
- 2026-11-16 · Etapa 4 del asistente publicada, a petición del dueño: migración `0003` (memoria de grupos, vacía) aplicada en producción y después el Worker (593.15 KiB comprimido, arranque de 74 ms, versión `35c377fb`). Productos sin cambios. Punto de restauración previo: `0000003e-00000000-00005126-21e459b66dc1cc46c9b488db14e02c1b`.

## Decisiones

- **2026-10-14 · Nombre de producto.** El usuario pidió "solo texto, sin emojis ni caracteres especiales". Se permiten letras, dígitos y espacios: los dígitos se aceptaron como texto normal ("Leche 1 litro").
- **2026-10-14 · Cantidad.** Empieza en 0 al registrar un producto. Escanear un código ya registrado suma 1.
- **2026-10-14 · Precio.** Se guarda en centavos enteros para evitar errores de redondeo.
- **2026-10-14 · Autollenado.** El nombre se busca en Open Food Facts, luego Open Beauty Facts y luego Open Products Facts. Muchos productos mexicanos no aparecen; entonces se escribe a mano.
- **2026-10-14 · Eliminar.** Se hace manteniendo presionado 2 s (reemplazó a `confirm()`).
- **2026-10-15 · Base de datos.** Todo en Cloudflare: D1 en lugar de Supabase.
- **2026-10-15 · Acceso.** Inicio de sesión propio, no Cloudflare Access.
  - Quien se registra queda en solo lectura y el dueño lo autoriza.
  - Las cuentas de solo lectura pueden escanear para consultar un producto, sin sumar.
- **2026-10-15 · Cifrado de contraseñas.** PBKDF2 se quedó en 100 000 iteraciones aunque en producción usa unos 20 ms de CPU; Cloudflare lo tolera de forma ocasional. Si aparecen errores 1102 ("Worker exceeded resource limits"), hay dos salidas:
  - bajar las iteraciones, volviendo a cifrar cada contraseña cuando su dueño inicie sesión;
  - pasar al plan Workers Paid.
- **2026-10-16 · Tiempo real.** El aviso lleva solo el código del producto y cada página vuelve a pedirlo, en vez de enviar el producto completo. Así los cambios simultáneos no dejan valores viejos; se probó con 10 escaneos simultáneos.
- **2026-10-18 · Pulido con impeccable.** El detector marca tres cosas que son intencionales y se mantienen:
  - las esquinas del visor (las toma por bordes laterales);
  - el brillo de la línea láser;
  - el video que llena el visor de borde a borde.
- **2026-11-10 · Asistente del inventario.** Chat con DeepSeek para hacer preguntas sobre el inventario.
  - Es solo para el administrador.
  - Solo consulta el inventario: no agrega, edita ni elimina nada.
  - El historial vive en la página, no en D1.
  - LangChain.js, por petición del usuario. Se usa `bindTools` con un bucle propio en vez de `createAgent`, por los límites del plan gratuito.
  - DeepSeek no ofrece embeddings.
  - El usuario sigue en el plan gratuito hasta que algún límite lo obligue a cambiar.
  - El usuario aceptó que se guarden las preguntas y respuestas; se hará en una etapa futura.
- **2026-11-10 · Asistente: cifras medidas.**
  - Worker: pasó de 10.64 KiB a 585.37 KiB comprimido (límite: 3 MB).
  - Arranque en frío: de 4 ms a 108 ms, medido en Node.
  - CPU por mensaje, estimado en Node con un DeepSeek simulado: unos 3.5 ms con una consulta y respuesta corta, y unos 18 ms con una consulta y una respuesta de 800 fragmentos. No está medido en producción.
  - Versiones: `@langchain/deepseek` 1.1.24, `@langchain/core` 1.3.7 y `zod` 4.6.7. No hicieron falta el paquete `langchain` ni `nodejs_compat`.
- **2026-11-11 · Asistente: prueba con DeepSeek real.** Modelo `deepseek-flash` (DeepSeek-V4.1-Flash), confirmado en `GET /models`.
  - Las cifras y los productos de cuatro preguntas coincidieron con SQL: agotados, valor del inventario, "cafe" sin acento y los 3 más caros.
  - Declinó una pregunta fuera de tema y "ponle 5 a la leche", y la tabla `productos` quedó igual.
  - Respondió sin Markdown ni emojis, con precios como `$1,234.50`.
  - No llega `reasoning_content`.
  - Un mensaje con una consulta hace dos llamadas: unos 2 600 tokens en total, casi todos de entrada y la mayoría desde la caché de DeepSeek (1 223 + 1 310 de entrada y 24 + 34 de salida). La respuesta completa tardó de 1 a 2 s.
  - En el navegador funcionó una pregunta de seguimiento que dependía de la anterior.
- **2026-11-11 · Asistente: CPU en producción.** Medición incompleta, con un solo dato.
  - La primera pregunta tras publicar gastó 46 ms de CPU y Cloudflare la dejó terminar.
  - Los inicios de sesión gastaron de 20 a 33 ms.
  - Falta medir varias preguntas seguidas y una de respuesta larga.
- **2026-11-11 · Asistente: etapas siguientes.** El detalle está en `PLAN.md`.
  - Los evals y el ciclo de mejora van en Python, con `uv` (la computadora tiene Python 3.14 y no tiene `pip`). La app sigue en JavaScript.
  - Se agrega la API de Google (Gemini) como modelo a evaluar junto a DeepSeek.
  - Qué modelo será el evaluador queda sin decidir.
  - El primer examen será pequeño: unos 12 casos, calificación por código, sin modelo juez.
  - El caso guía es «¿Qué productos son chicles?», contra una lista fija del dueño.
  - El asistente podrá escribir en su propia memoria (grupos de productos), pero sigue sin modificar el inventario.
  - Que el asistente solo hable del inventario es una instrucción puesta por defecto; el dueño no ha decidido qué tan abierto lo quiere.
- **2026-11-11 · Forma de trabajo.** Una sesión planea y revisa desde la carpeta principal, sin escribir código; otra implementa en el worktree `logperch`. Los encargos van por mensajes entre sesiones, que el dueño aprueba. Fusionar y publicar son del dueño, y cada publicación necesita su visto bueno. El detalle está en el apartado «Cómo se trabaja» de `PLAN.md`.
- **2026-11-13 · Asistente: etapa 1 entregada y revisada en el worktree.** Registro de ejecuciones y contador `version_datos`, en cuatro commits (el último, `fa0fca4`). Fusionada a `main` (commit `c64f135`) y publicada ese mismo día, a petición del dueño. El detalle está en `plan/etapa-1-registro-ejecuciones.md`.
  - El CPU del asistente se mide con `node pruebas/banco-cpu.mjs`, que simula DeepSeek y D1 y no gasta saldo.
  - Los disparadores de SQLite funcionan en D1 local con Wrangler 4.151.0, incluidos sus `BEGIN … END;` dentro de la migración.
  - DeepSeek sí manda el uso de tokens en el flujo. La misma pregunta de la etapa 0 dio 2 531 de entrada y 58 de salida, con 2 176 servidos desde su caché.
  - CPU estimado en Node, antes y después: 2.97 y 2.98 ms la respuesta corta; 19.3 y 19.9 ms la larga. Arranque de 103 a 108 ms. Worker de 587.41 a 589.68 KiB.
  - Para publicar: primero la migración en producción y después el Worker.
  - `wrangler dev` recarga al cambiar `.dev.vars`, pero sigue usando el valor viejo; hay que reiniciarlo.
- **2026-11-13 · Plan por archivos.** El dueño pidió separar el plan: cada etapa tiene su archivo en `plan/` y su estado (`Sin empezar`, `En curso` o `Terminada`) se anota solo en la tabla «Etapas del asistente» de `CLAUDE.md`. `PLAN.md` queda con lo que vale para todo el plan.
- **2026-11-13 · Asistente: etapa 1 verificada en producción.** El dueño hizo seis preguntas en la app publicada. El detalle está en `plan/etapa-1-registro-ejecuciones.md`.
  - Cada pregunta dejó su fila con resultado `bien`, tokens y caché. `version_datos` subió de 0 a 2 con un alta y un ajuste de producto.
  - CPU por pregunta: de 33 a 79 ms, con una mediana de unos 51 ms. Ninguna se cortó.
  - El banco en Node subestima: calcula unos 3 ms para una respuesta corta. Sirve para comparar antes y después, no para cifras absolutas.
  - El CPU de cada petición en producción se consulta en Workers Observability, que está activado en `wrangler.jsonc`; no hace falta dejar corriendo `wrangler tail`.
  - Falta medir una respuesta larga.
- **2026-11-13 · Gemini: clave y nivel gratuito.** El dueño entregó su clave de Google AI Studio, guardada como `GEMINI_API_KEY` en el `.dev.vars` del worktree. Aún no existe en producción.
  - Con esa clave, `gemini-2.5-flash` ya no está disponible para cuentas nuevas. Las peticiones a `gemini-3.5-flash` se cuentan en la cuota de `gemini-3.6-flash`.
  - El nivel gratuito da 20 peticiones al día por proyecto y por modelo, y se renueva a medianoche, hora del Pacífico. Ese mismo día se agotó con las pruebas de la etapa 2.
  - Una clave inválida hace que la API compatible con OpenAI responda 400, no 401.
  - En el nivel gratuito, Google puede usar lo que se le manda para mejorar sus productos. El dueño no ha decidido si activa la facturación.
- **2026-11-16 · Evals: evaluador y lista de chicles.**
  - El evaluador trabaja solo durante los evals, no con las respuestas que recibe el dueño en la app.
  - La lista de chicles quedó en `plan/etapa-3-evals.md`: 8 sí y 3 no, y los tres «no» son pastillas de menta. En producción solo hay 3 productos, 2 de ellos de la lista. El dueño tiene que registrar los demás.
  - El dueño propone clasificar con embeddings y que el evaluador corrija la clasificación; cómo se clasifica un producto nuevo está sin decidir. La respuesta de la sesión que planea está en `plan/etapa-4-memoria-grupos.md`.
- **2026-11-16 · Solo DeepSeek, con configuración por agente.** El dueño dejó Gemini a un lado por ahora. Los evals y los agentes (conversador, clasificador y evaluador) usan solo DeepSeek, cada uno con su propio modelo, parámetros e instrucciones. La cuenta ofrece `deepseek-flash` y `deepseek-v4-pro` (`GET /models`). El código de Gemini queda en la app sin usarse.
  - El dueño aceptó el orden para los embeddings: primero la línea base, luego el clasificador con memoria y encima los embeddings.
  - Confirmó las 5 trampas y pidió inventar los precios de los 16 productos agregados (de $2.00 a $35.00). Producción quedó con 19 productos, todos con precio, y `version_datos` en 34.
  - Por ahora se usa solo `deepseek-flash` para todo, también para el evaluador.
  - `evals/inventario.sql` es una copia de producción del 2026-11-16, solo con los datos de `productos`, y se sube al repositorio. El encargo de la etapa 3 se envió ese día a `logperch-95`. El dueño confirmó la lista de pastillas de menta: Life Savers Mint Pep O Mint, Pastillas Menta, Ment Mouth, Tic Tac, Yerbabuena Mentos y Halls yerbabuena.
- **2026-11-16 · Evals: línea base.** Etapa 3 entregada, revisada y fusionada. El detalle está en `plan/etapa-3-evals.md`.
  - Con `deepseek-flash` pasan 10 de 12 casos: todos los de cifras, formato y conducta.
  - `chicles` encuentra 0 de 11, porque el asistente busca la palabra «chicle» en los nombres y nunca ve el inventario completo. `pastillas-menta` encuentra 1 de 6. Es el número que tiene que mejorar la etapa 4.
  - El evaluador es `deepseek-flash` con temperatura 0, sin razonamiento y salida estructurada. Solo lee líneas dudosas y explica fallos; recalificar sin él dio el mismo resultado.
  - Una corrida completa (36 preguntas más el evaluador) cuesta unos $0.006 dólares fuera de horario pico y tarda unos 3 minutos.
- **2026-11-16 · GitHub y cuentas de prueba.** El dueño aprobó subir `main` a GitHub (31 commits, hasta `88189f9`).
  - El repositorio `MarcoAle05/ATPS-` es público. Las contraseñas de las tres cuentas de prueba locales, que estaban en `PLAN.md`, quedaron en su historial: la sesión que planea no vio la nota que pedía decidir antes de subir.
  - Esas cuentas solo existen en la base local del worktree. El dueño decidió quitarlas de `PLAN.md` y guardarlas en `cuentas-prueba.local.md`, que no se sube (`*.local.md` en `.gitignore`), sin reescribir el historial.
  - Antes de cada `push`, revisar en `PLAN.md` y `MEMORY.md` si hay algo pendiente de decidir sobre lo que se sube.
- **2026-11-16 · Etapa 4 enviada.** El encargo de la memoria de grupos y el clasificador se envió a `logperch-95`, aprobado por el dueño. El clasificador usa `deepseek-flash` con su propia configuración. Cuando una lista no la confirmó el dueño, el asistente avisa en una línea al final que puede tener errores. Las precisiones están en `plan/etapa-4-memoria-grupos.md`.

## Historial

- 2026-10-14 · Primera versión: Express con SQLite local. `data/productos.db` queda como respaldo y ya no se usa.
- 2026-10-14 · Animaciones y diseño con las skills de Emil Kowalski y Jakub Krehel.
- 2026-10-15 · Migración a Workers + D1, con cuentas y roles. Los productos del usuario se copiaron a D1.
- 2026-10-16 · Actualización en tiempo real con Durable Objects.
- 2026-10-18 · Pase de pulido con la skill impeccable.
- 2026-10-19 · Se instaló `@playwright/test` como dependencia de desarrollo y Chromium (fuera del proyecto, en la caché de Playwright) para probar la interfaz en un navegador. Aún no hay pruebas escritas ni configuración. Arch Linux no está soportado oficialmente; usa la compilación de ubuntu24.04 y arrancó bien.
- 2026-11-10 · Asistente del inventario con DeepSeek y LangChain.js (etapa 0): ruta `POST /api/asistente` e interfaz de chat. El 2026-11-11 se probó contra DeepSeek real.
- 2026-11-11 · Etapa 0 del asistente fusionada a `main` y publicada.
- 2026-11-13 · Etapa 1 del asistente (registro de ejecuciones y `version_datos`) fusionada a `main` y publicada.
- 2026-11-13 · Etapa 1 verificada en producción y marcada como terminada.
- 2026-11-13 · Etapa 2 del asistente (modelos intercambiables y Gemini) fusionada a `main` y publicada.
- 2026-11-16 · Etapa 2 verificada en producción con una pregunta del dueño (DeepSeek, 78 ms de CPU) y marcada como terminada. Ese día Gemini respondió muy lento en flujo (de 22 s a más de 90 s antes del primer trozo) y las dos preguntas locales terminaron por tiempo. Hay que volver a medirlo antes de los evals.
- 2026-11-16 · Etapa 3 del asistente (evals en Python y caso chicles) fusionada a `main` y marcada como terminada. No cambia la app, así que no hubo publicación.
- 2026-11-16 · Etapa 4 del asistente (memoria de grupos y clasificador) fusionada a `main` y publicada.
- 2026-11-16 · Etapa 4 verificada en producción con una pregunta de chicles del dueño (108 ms de CPU, la cifra más alta medida; Cloudflare la dejó terminar) y marcada como terminada.

## Pendiente

- ~~No existe `PRODUCT.md`~~ Creado el 2026-10-18 con `/impeccable init`. `DESIGN.md` (con `.impeccable/design.json`) creado el mismo día con `/impeccable document`: Estrella polar "El cuaderno de inventario", componentes "refinados y silenciosos", anti-referencia: emojis y mascotas.
- No hay pruebas automatizadas en el repositorio. Las verificaciones se hicieron con scripts que están fuera del proyecto.
- El plan del asistente está en `PLAN.md` y en `plan/`, un archivo por etapa. Qué sigue lo dice la tabla de etapas de `CLAUDE.md`. ~~El 2026-11-13 se envió a la sesión que implementa el encargo de la etapa 1, el registro de ejecuciones; falta su entrega y la revisión.~~ Entregada, revisada, publicada y verificada el mismo día.
- ~~Asistente: completar la medición de CPU en producción (hay un solo dato).~~ El 2026-11-13 se midieron seis preguntas cortas, de 33 a 79 ms. Falta una respuesta larga.
- ~~Asistente: el dueño debe entregar la clave de la API de Google, su lista de chicles y la copia del inventario real para los evals, y aclarar qué entiende por "evaluador en tiempo real".~~ Todo resuelto el 2026-11-13 y el 2026-11-16; los evals ya corren con esa lista y ese inventario.
- ~~Asistente: el dueño debe decidir si activa la facturación de Gemini antes de la etapa 3.~~ El 2026-11-16 dejó Gemini a un lado; la decisión vuelve si se retoma.
- Asistente: no se pudo verificar en la interfaz el teclado virtual y el área segura de iOS, lectores de pantalla reales, Safari ni Firefox.
