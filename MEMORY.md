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
- **2026-11-11 · Forma de trabajo.** Una sesión planea y revisa desde la carpeta principal, sin escribir código; otra implementa en el worktree `logperch`. Los encargos van por mensajes entre sesiones, que el dueño aprueba. Fusionar y publicar son del dueño, y cada publicación necesita su visto bueno. El detalle está en la sección 10 de `PLAN.md`.

## Historial

- 2026-10-14 · Primera versión: Express con SQLite local. `data/productos.db` queda como respaldo y ya no se usa.
- 2026-10-14 · Animaciones y diseño con las skills de Emil Kowalski y Jakub Krehel.
- 2026-10-15 · Migración a Workers + D1, con cuentas y roles. Los productos del usuario se copiaron a D1.
- 2026-10-16 · Actualización en tiempo real con Durable Objects.
- 2026-10-18 · Pase de pulido con la skill impeccable.
- 2026-10-19 · Se instaló `@playwright/test` como dependencia de desarrollo y Chromium (fuera del proyecto, en la caché de Playwright) para probar la interfaz en un navegador. Aún no hay pruebas escritas ni configuración. Arch Linux no está soportado oficialmente; usa la compilación de ubuntu24.04 y arrancó bien.
- 2026-11-10 · Asistente del inventario con DeepSeek y LangChain.js (etapa 0): ruta `POST /api/asistente` e interfaz de chat. El 2026-11-11 se probó contra DeepSeek real.
- 2026-11-11 · Etapa 0 del asistente fusionada a `main` y publicada.

## Pendiente

- ~~No existe `PRODUCT.md`~~ Creado el 2026-10-18 con `/impeccable init`. `DESIGN.md` (con `.impeccable/design.json`) creado el mismo día con `/impeccable document`: Estrella polar "El cuaderno de inventario", componentes "refinados y silenciosos", anti-referencia: emojis y mascotas.
- No hay pruebas automatizadas en el repositorio. Las verificaciones se hicieron con scripts que están fuera del proyecto.
- El plan de las etapas siguientes del asistente está en `PLAN.md`, en la raíz de la carpeta principal del repositorio. Al 2026-11-11 sigue sin commit. Su sección 11 dice cuál es el siguiente paso: la etapa 1, el registro de ejecuciones.
- Asistente: completar la medición de CPU en producción (hay un solo dato).
- Asistente: el dueño debe entregar la clave de la API de Google, su lista de chicles y la copia del inventario real para los evals, y aclarar qué entiende por "evaluador en tiempo real".
- Asistente: no se pudo verificar en la interfaz el teclado virtual y el área segura de iOS, lectores de pantalla reales, Safari ni Firefox.
