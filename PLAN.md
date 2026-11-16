# PLAN.md

Plan del asistente del inventario. Las decisiones tomadas con el dueño llevan fecha; lo demás es diseño propuesto y puede cambiar.

Última actualización: 2026-11-13.

## Cómo está organizado

- **Este archivo** tiene lo que vale para todo el plan: objetivo, decisiones, caso guía, límites y forma de trabajo.
- **Cada etapa tiene su archivo en `plan/`**, con lo que entrega, cómo se verifica, su diseño y su avance.
- **El estado de cada etapa** (`Sin empezar`, `En curso` o `Terminada`) se anota en un solo lugar: la tabla «Etapas del asistente» de `CLAUDE.md`.
- **Qué sigue:** la etapa que esté `En curso` en esa tabla. Su archivo dice en qué punto va.

## Objetivo

Un asistente que:

- responde preguntas sobre el inventario con datos reales de D1;
- recuerda lo que aprende, de modo que una sesión nueva acierte donde la anterior falló;
- no repite trabajo ya hecho cuando le preguntan lo mismo;
- se mide con evals contra listas preparadas por el dueño.

Todo sobre el plan gratuito de Cloudflare mientras alcance.

## Decisiones vigentes

| Fecha | Decisión |
|---|---|
| 2026-11-10 | El asistente lo usa solo el administrador. |
| 2026-11-10 | El asistente no modifica el inventario (productos, precios, cantidades). Sí puede escribir en su propia memoria. |
| 2026-11-10 | La conversación es con DeepSeek, por medio de LangChain.js. Sin LangGraph por ahora. |
| 2026-11-10 | Se guardan las preguntas y respuestas de cada ejecución. La conversación visible sigue viviendo solo en la página. |
| 2026-11-10 | Plan gratuito de Cloudflare hasta que limite. |
| 2026-11-10 | El caso guía es «¿Qué productos son chicles?», calificado contra una lista fija del dueño. |
| 2026-11-11 | Los evals y el ciclo de mejora se escriben en Python. La app (Worker e interfaz) sigue en JavaScript. |
| 2026-11-11 | Se agrega la API de Google (Gemini) como modelo a evaluar, junto a DeepSeek. |
| 2026-11-11 | Qué modelo será el evaluador queda sin decidir. El diseño deja ese lugar abierto. |
| 2026-11-11 | Los evals empiezan pequeños: unos 12 casos, calificación por código, sin modelo juez, y DeepSeek contra Gemini. |
| 2026-11-13 | Cada etapa del plan tiene su propio archivo en `plan/`, y el estado de cada una se lleva en `CLAUDE.md`. |
| 2026-11-16 | El evaluador trabaja solo durante los evals, justo después de cada respuesta. No revisa en el momento las respuestas que recibe el dueño en la app. Revisar después, desde Python, las ejecuciones guardadas queda como opción futura. |
| 2026-11-16 | Gemini queda a un lado por ahora: los evals y los agentes trabajan solo con DeepSeek. Cada agente (conversador, clasificador y evaluador) tiene su propia configuración: modelo (`deepseek-flash` o `deepseek-v4-pro`, los dos que ofrece la cuenta), parámetros e instrucciones. El código de Gemini de la etapa 2 queda en la app, sin usarse. Esto reemplaza el «DeepSeek contra Gemini» de los evals. |
| 2026-11-16 | El dueño propone clasificar los productos con embeddings y que el evaluador corrija la clasificación cuando el conversador se equivoque. Se acepta este orden: primero la línea base de los evals, después el clasificador con memoria de etiquetas y, encima, los embeddings para productos nuevos e inventarios grandes, medidos con los evals. Ver «Propuesta del dueño: embeddings» en `plan/etapa-4-memoria-grupos.md`. |

## Etapas

Cada etapa se entrega como encargo a la sesión que implementa y se revisa antes de la siguiente. El estado de cada una está en `CLAUDE.md`.

| # | Etapa | Archivo | Entrega | Cómo se verifica |
|---|---|---|---|---|
| 0 | Chatbot de consulta | `plan/etapa-0-chatbot.md` | Servidor, interfaz y documentación | Pruebas con DeepSeek real y medición de CPU ya publicado |
| 1 | Registro de ejecuciones y `version_datos` | `plan/etapa-1-registro-ejecuciones.md` | Migración, registro al final de cada pregunta | Cada pregunta deja su fila, con su modelo; el contador sube con cada cambio |
| 2 | Modelos intercambiables y Gemini | `plan/etapa-2-modelos-gemini.md` | Lista de modelos, elección por petición, clave de Google | Las mismas preguntas responden bien con DeepSeek y con Gemini; tamaño del Worker dentro del límite |
| 3 | Evals en Python y caso chicles | `plan/etapa-3-evals.md` | Carpeta `evals/`, tu lista, primera corrida con los dos modelos | Línea base por modelo: cuántos chicles encuentra cada uno |
| 4 | Memoria de grupos y clasificador | `plan/etapa-4-memoria-grupos.md` | Tablas, herramienta `productos_del_grupo`, clasificador | Corrida en frío mejor que la línea base |
| 5 | Aprendizaje | `plan/etapa-5-aprendizaje.md` | Modo `aprender` | Pasos 3 y 4 del caso guía |
| 6 | Respuestas guardadas | `plan/etapa-6-respuestas-guardadas.md` | Búsqueda en el registro, aviso en la interfaz | Pasos 5, 6 y 7 del caso guía |
| 7 | Correcciones desde el chat | `plan/etapa-7-correcciones-chat.md` | Botones "falta" y "este no es" | Una corrección hecha en el chat cambia la siguiente respuesta |

Los evals van antes que la memoria a propósito: primero se mide cómo responde el asistente actual con cada modelo, y cada etapa posterior tiene que mejorar ese número.

## Caso guía: «¿Qué productos son chicles?»

**Por qué hoy fallaría.** La herramienta actual busca palabras dentro del nombre. Un producto que se llame como su marca y su sabor, sin la palabra "chicle", no aparece. Para encontrarlo hay que juzgar cada producto por lo que es, y eso solo lo puede hacer un modelo.

**Qué debe pasar.** Esta secuencia es la prueba de aceptación de todo el plan:

1. **En frío.** Con la memoria vacía, se pregunta. El asistente nombra los productos que probablemente son chicles.
2. **Calificación.** Se compara lo que nombró con la lista del dueño: aciertos, faltantes y sobrantes.
3. **Aprendizaje.** Cada faltante y cada sobrante se guarda en la memoria como corrección del dueño.
4. **Sesión nueva.** Se pregunta lo mismo y acierta todos.
5. **Repetición.** Se pregunta lo mismo sin que nada haya cambiado: la respuesta sale guardada, sin llamar al modelo.
6. **Cambio en el inventario.** Se escanea un producto y se pregunta otra vez: la respuesta se arma de nuevo con las cantidades actuales, pero sin volver a juzgar qué productos son chicles.
7. **Producto nuevo.** Se registra un chicle nuevo: en la siguiente pregunta solo se juzga ese producto y aparece en la lista.

## Tres agentes, cada uno con un solo trabajo

| Agente | Trabajo | Dónde corre |
|---|---|---|
| **Conversador** | Entiende la pregunta, pide herramientas y redacta la respuesta. Es el que ya existe. | En el Worker, con respuesta en flujo. |
| **Clasificador** | Recibe un grupo ("chicle") y una lista de productos sin revisar, y dice cuáles pertenecen. Salida estructurada, sin texto libre. | En el Worker, dentro de una herramienta, sin flujo. |
| **Evaluador** | Lee una respuesta ya dada, la compara con la lista del dueño y explica cada fallo. | Fuera del Worker, en Python, dentro de los evals. |

Hoy el conversador usa DeepSeek. Desde el 2026-11-16 los tres agentes usan DeepSeek, cada uno con su propia configuración; Gemini queda a un lado por ahora, aunque la app ya sabe usarlo (etapa 2). El modelo y los parámetros del evaluador se fijan en la etapa 3. El clasificador va aparte del conversador para poder medirlo y mejorarlo solo.

## Más adelante

Sin fecha; se planean cuando lo anterior esté publicado.

- **Embeddings (Vectorize con Workers AI o Gemini).** Para preseleccionar candidatos cuando el inventario sea grande, para reconocer que "goma de mascar" es el grupo `chicle` y para que las respuestas guardadas reconozcan la misma pregunta con otras palabras. DeepSeek no ofrece embeddings.
- **Visión con Gemini.** Proponer el nombre de un producto a partir de una foto del empaque.
- **API pública.** Rutas con versión, claves con permisos y documentación OpenAPI. Las mismas herramientas se pueden exponer como servidor MCP.
- **LangGraph.** Cuando el asistente pueda proponer cambios al inventario con tu confirmación. Dentro del Worker probablemente exija Workers Paid. La alternativa es un servicio aparte en Python, donde LangGraph es más maduro, pero eso saca una parte del proyecto de Cloudflare.

## Límites del plan gratuito

| Límite | Cómo nos toca | Señal de que ya limita |
|---|---|---|
| 10 ms de CPU por petición | LangChain gasta CPU por cada fragmento de la respuesta. Las respuestas guardadas y el clasificador sin flujo gastan muy poco. | Respuestas cortadas a la mitad y errores 1102 en `npx wrangler tail inventario` |
| 3 MB comprimidos de Worker | Hoy son 585 KiB con LangChain. LangGraph sumaría bastante. | `wrangler deploy` rechaza el tamaño |
| Subpeticiones por petición | Cada llamada a DeepSeek cuenta. Una pregunta de grupo en frío hace dos llamadas más al modelo. | Error "Too many subrequests" |
| 50 consultas a D1 por petición | Un `batch` cuenta como una sola. Hoy una pregunta usa pocas: sesión, límite de mensajes y hasta 6 consultas de herramienta. | Error "Too many API requests by single Worker invocation" |
| Lecturas y escrituras diarias de D1 | El registro agrega una escritura por pregunta, y cada cambio de producto una más por el contador. | Las consultas fallan hasta la medianoche UTC |
| 30 s de `waitUntil` | Es el tiempo que queda para escribir el registro después de que la respuesta termina o el navegador se va. | Preguntas que no dejan fila |

Las consultas por petición y el tiempo de `waitUntil` se confirmaron en la documentación de Cloudflare el 2026-11-13. Las cifras diarias de D1 se confirman al llegar a las etapas que escriben más.

## Lo que hace falta de ti

- **Una pregunta de respuesta larga en la app publicada**, para medir su CPU. Las preguntas seguidas ya se midieron el 2026-11-13: de 33 a 79 ms cada una. El CPU se lee en Workers Observability, así que no hace falta avisar antes.
- ~~**Una clave de la API de Google (Gemini)** (etapa 2)~~ Entregada el 2026-11-13.
- ~~**Si activas la facturación de Gemini** antes de la etapa 3.~~ El 2026-11-16 el dueño dejó Gemini a un lado; la decisión vuelve si se retoma. El nivel gratuito tiene dos límites:
  - Google puede usar lo que se le manda para mejorar sus productos, y eso incluiría tu inventario real, en producción o en los evals.
  - Da 20 peticiones al día por modelo, y una corrida de los evals con Gemini no cabe en un día.

  Con la facturación se paga por uso y desaparecen los dos límites. Sin ella hay que aceptar las condiciones y repartir las corridas en varios días. Detalle en `plan/etapa-2-modelos-gemini.md`.
- ~~**Tu lista de chicles** (etapa 3)~~ Entregada el 2026-11-16; está en `plan/etapa-3-evals.md`.
- ~~**Poner el precio real a los 16 productos agregados el 2026-11-16 y confirmar el «sí» o «no» de las trampas** (etapa 3).~~ El 2026-11-16 el dueño confirmó las trampas y pidió precios inventados, que ya están en producción. La copia del inventario para `evals/inventario.sql` la sacó la sesión que planea ese mismo día.
- ~~**Decidir si `evals/inventario.sql` se sube al repositorio** (etapa 3).~~ Sí, el 2026-11-16: casi todo es de prueba.
- ~~**Confirmar la lista de pastillas de menta** (etapa 3)~~ Confirmada el 2026-11-16: Life Savers Mint Pep O Mint, Pastillas Menta, Ment Mouth, Tic Tac, Yerbabuena Mentos y Halls yerbabuena.
- ~~**Aclarar qué significa "evaluador en tiempo real"** para ti (etapa 3)~~ Aclarado el 2026-11-16: solo durante los evals.
- **Qué tan abierto quieres el asistente.** Hoy solo habla del inventario porque así se le indica en sus instrucciones; fue un valor por defecto, no una decisión tuya.
- **Subir a GitHub.** Nada de lo hecho desde el 2026-11-10 está en GitHub: `main` va adelante de `origin/main` y no se ha hecho `push`. Este archivo incluye las cuentas de prueba locales (en «Cómo se trabaja»); decide si se quitan antes de subir.

## Cómo se trabaja

**Dos sesiones.** Una planea, redacta los encargos y revisa; trabaja en la carpeta principal y no escribe código. La otra implementa en el worktree `/home/marco05/orca/workspaces/Lectorcodigodebarras/logperch`.

**Encargos.**

- Van de la sesión que planea a la que implementa con un mensaje entre sesiones. Cada uno es autosuficiente: contexto, contrato, restricciones, verificación con evidencia y forma de entrega.
- Los mensajes pueden quedar retenidos hasta que el dueño los apruebe en la sesión que implementa, cuando las dos corren en modos de permisos distintos. No se reenvían mientras estén retenidos.
- El nombre de la sesión que implementa cambia cada vez que se reinicia, pero siempre empieza con el nombre de la carpeta del worktree: `logperch-8a`, `logperch-5e` y, el 2026-11-13, `logperch-b5`. Una sesión con otro prefijo es de otro proyecto, aunque sea la única de la lista: el 2026-11-13 el encargo de la etapa 1 se mandó primero por error a `longa-65`, que no hizo nada con él.
- Para confirmar qué sesión vive en el worktree: `~/.local/opt/orca/orca-ide --no-sandbox terminal list` muestra cada terminal con su carpeta. El comando `orca` a secas falla en los listados porque agrega una opción que estos no aceptan.
- Cada encargo empieza pidiendo a quien lo recibe que compruebe que su carpeta es el worktree.
- La rama del worktree también cambia de nombre sola. Hoy es `MarcoAle05/mensajes-sesion-retenidos-no`. Antes de cada encargo se comprueba que parta del `main` actual.
- La sesión que implementa pide confirmación al dueño antes de editar `CLAUDE.md`, `MEMORY.md` o `.claude/`.

**Entrega y revisión.** Cada encargo termina en un commit local, sin `push` ni fusión, y un informe con lo verificado y lo pendiente. La sesión que planea lee el diff completo y las capturas antes de mandar el siguiente.

**Estado y avance.** La sesión que planea cambia el estado de la etapa en la tabla de `CLAUDE.md` al enviar su primer encargo (`En curso`) y al terminarla (`Terminada`), y anota cada paso con fecha en el apartado «Avance» del archivo de la etapa.

**Fusionar y publicar.** Son del dueño. El 2026-11-11 pidió a la sesión que planea ejecutar los comandos de la etapa 0; eso valió para esa vez. Cada publicación nueva necesita su visto bueno.

**Entorno local de pruebas.** Vive en el worktree, no en la carpeta principal:

- El `.dev.vars` del worktree tiene `PIMIENTA`, `CODIGO_CONFIGURACION` (valores de prueba) y `DEEPSEEK_API_KEY` (la clave real). El de la carpeta principal no tiene la clave de DeepSeek, así que ahí el asistente responde 503.
- La base local del worktree tiene 15 productos de prueba y tres cuentas de prueba, que no existen en producción: `admin@prueba.test` / `Tornillo-Verde-7781`, `editora@prueba.test` / `Martillo-Azul-4432` y `lectora@prueba.test` / `Cuaderno-Gris-5519`.
- En producción hay una cuenta de administrador, la del dueño, y dos de editor.
