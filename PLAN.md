# PLAN.md

Plan del asistente del inventario. Las decisiones tomadas con el dueño llevan fecha; lo demás es diseño propuesto y puede cambiar.

Última actualización: 2026-11-11.

## 1. Objetivo

Un asistente que:

- responde preguntas sobre el inventario con datos reales de D1;
- recuerda lo que aprende, de modo que una sesión nueva acierte donde la anterior falló;
- no repite trabajo ya hecho cuando le preguntan lo mismo;
- se mide con evals contra listas preparadas por el dueño.

Todo sobre el plan gratuito de Cloudflare mientras alcance.

## 2. Decisiones vigentes

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

## 3. Estado

La etapa 0 está terminada, fusionada a `main` y publicada. Falta medir el CPU en producción.

| Pieza | Estado |
|---|---|
| Servidor del asistente (`POST /api/asistente`, LangChain, dos herramientas de consulta) | Hecho, commit `a9285ac`. |
| Interfaz (botón en el encabezado y diálogo de chat) | Hecha, commit `6552ea5`. |
| Documentación (`CLAUDE.md`, `MEMORY.md`, reglas) | Hecha, commit `d7adcf8`. |
| Prueba contra DeepSeek real (2026-11-11) | Pasó: modelo `deepseek-flash` confirmado, cifras iguales a las de la base, declina lo ajeno y los cambios al inventario. Unos 2 600 tokens por mensaje con una consulta. |
| Publicación | Hecha el 2026-11-11: secreto `DEEPSEEK_API_KEY` creado y Worker publicado, con arranque de 54 ms. Sin `push` a GitHub. |
| Medición de CPU en producción | Incompleta. Un solo dato, del 2026-11-11: la primera pregunta tras publicar gastó 46 ms de CPU y Cloudflare la dejó terminar. Los inicios de sesión gastan de 20 a 33 ms. Falta medir varias preguntas seguidas y una de respuesta larga. |
| Sin verificar | Teclado virtual y área segura de iOS, lectores de pantalla reales, Safari y Firefox, y los errores 401 y 402 con DeepSeek real. |

## 4. Caso guía: «¿Qué productos son chicles?»

**Por qué hoy fallaría.** La herramienta actual busca palabras dentro del nombre. Un producto que se llame como su marca y su sabor, sin la palabra "chicle", no aparece. Para encontrarlo hay que juzgar cada producto por lo que es, y eso solo lo puede hacer un modelo.

**Qué debe pasar.** Esta secuencia es la prueba de aceptación de todo el plan:

1. **En frío.** Con la memoria vacía, se pregunta. El asistente nombra los productos que probablemente son chicles.
2. **Calificación.** Se compara lo que nombró con la lista del dueño: aciertos, faltantes y sobrantes.
3. **Aprendizaje.** Cada faltante y cada sobrante se guarda en la memoria como corrección del dueño.
4. **Sesión nueva.** Se pregunta lo mismo y acierta todos.
5. **Repetición.** Se pregunta lo mismo sin que nada haya cambiado: la respuesta sale guardada, sin llamar al modelo.
6. **Cambio en el inventario.** Se escanea un producto y se pregunta otra vez: la respuesta se arma de nuevo con las cantidades actuales, pero sin volver a juzgar qué productos son chicles.
7. **Producto nuevo.** Se registra un chicle nuevo: en la siguiente pregunta solo se juzga ese producto y aparece en la lista.

## 5. Diseño

### 5.1 Tres agentes, cada uno con un solo trabajo

| Agente | Trabajo | Dónde corre |
|---|---|---|
| **Conversador** | Entiende la pregunta, pide herramientas y redacta la respuesta. Es el que ya existe. | En el Worker, con respuesta en flujo. |
| **Clasificador** | Recibe un grupo ("chicle") y una lista de productos sin revisar, y dice cuáles pertenecen. Salida estructurada, sin texto libre. | En el Worker, dentro de una herramienta, sin flujo. |
| **Evaluador** | Lee una respuesta ya dada, la compara con la lista del dueño y explica cada fallo. | Fuera del Worker, en Python, dentro de los evals. |

Hoy el conversador usa DeepSeek. El conversador y el clasificador podrán correr también con Gemini, y el modelo del evaluador está sin decidir (sección 5.8). El clasificador va aparte del conversador para poder medirlo y mejorarlo solo.

### 5.2 Memoria de grupos

Un **grupo** es un conjunto de productos por lo que son: chicles, refrescos, limpieza. La memoria guarda, por cada grupo y producto, si pertenece o no y quién lo dijo.

Tablas nuevas en D1 (nombres propuestos):

- `grupos`: nombre normalizado (minúsculas, sin acentos, en singular) y fecha.
- `miembros_grupo`: grupo, código del producto, `pertenece` (1 o 0), `origen` (`clasificador` o `dueno`), `nombre_visto` (el nombre del producto cuando se juzgó) y fecha.

Reglas:

- **El dueño manda.** Una fila con origen `dueno` nunca la cambia el clasificador.
- **También se guarda el "no".** Así un producto que no es chicle no vuelve a aparecer ni a juzgarse.
- **Sin revisar** es todo producto que no tiene fila en ese grupo, o cuya fila es del clasificador y su nombre cambió desde entonces. Solo esos se mandan al clasificador.
- **Probable y confirmado.** Lo que dijo el clasificador es "probable"; lo que dijo el dueño es "confirmado". El asistente puede decirlo así al responder.
- Al eliminar un producto se borran sus filas.

Esta memoria es de todo el inventario, no de una sesión ni de una cuenta: por eso una sesión nueva acierta.

### 5.3 Cómo se responde una pregunta de grupo

Herramienta nueva para el conversador: `productos_del_grupo`, con el nombre del grupo.

1. El conversador reconoce que la pregunta es sobre un tipo de producto y llama a la herramienta con `chicle`.
2. La herramienta busca en la memoria los miembros del grupo y los productos sin revisar.
3. Si hay productos sin revisar, la herramienta llama al clasificador con esos productos y guarda su juicio.
4. La herramienta devuelve los miembros con su precio y cantidad actuales, y los totales ya calculados, igual que `buscar_productos`.
5. El conversador redacta la respuesta.

La primera vez se juzga todo el inventario. Después solo los productos nuevos o renombrados. Las cantidades y los precios siempre salen de la tabla `productos` en el momento, nunca de la memoria.

Límite conocido: si el inventario crece a cientos de productos, juzgar todo en una sola pregunta no cabrá. Ahí entran los embeddings (sección 7).

### 5.4 Respuestas guardadas

Además de la memoria de grupos, se guarda la respuesta completa para no llamar al modelo cuando nada cambió. Una pregunta se responde con una respuesta guardada solo si se cumple todo esto:

- es la primera pregunta de la conversación (una pregunta de seguimiento depende de lo anterior);
- el texto, normalizado, es igual al de una ejecución anterior que terminó bien;
- los datos no han cambiado desde entonces (ver `version_datos` abajo);
- las instrucciones y el modelo son los mismos;
- la ejecución anterior tiene menos de 24 horas.

`version_datos` es un contador que sube con cada cambio en `productos` o en `miembros_grupo`. La forma propuesta es con disparadores de SQLite en una migración; si D1 no los admite bien, se sube desde el código en cada cambio.

Las respuestas guardadas no se buscan en una tabla aparte: salen del registro de ejecuciones. La interfaz debe indicar con discreción que la respuesta es guardada.

Dos niveles, entonces: la respuesta guardada evita llamar al modelo; la memoria de grupos evita volver a juzgar aunque el inventario haya cambiado.

### 5.5 Registro de ejecuciones

Tabla `ejecuciones_asistente`, una fila por pregunta:

- quién y cuándo;
- pregunta, respuesta y cuántos mensajes previos había;
- herramientas llamadas, con sus argumentos y un resumen del resultado;
- modelo, versión de las instrucciones y `version_datos`;
- cómo terminó: bien, con error, interrumpida o respuesta guardada;
- duración y tokens;
- origen: chat o eval.

Sirve para tres cosas: respuestas guardadas, evals y entender por qué algo falló. Se conservan 90 días.

### 5.6 Evals

Todo vive en una carpeta `evals/` del repositorio y corre en tu computadora contra el servidor local, no en Cloudflare. Está escrito en Python.

| Archivo | Contenido |
|---|---|
| `evals/pyproject.toml` y `evals/uv.lock` | Proyecto de Python con sus dependencias, administrado con `uv`. |
| `evals/inventario.sql` | Inventario fijo de prueba: una copia de tu inventario real en una fecha. |
| `evals/casos/*.json` | Un caso por archivo. |
| `evals/correr.py` | Corre los casos contra la app, califica y guarda el resultado. |
| `evals/calificar.py` | La cuenta de aciertos, faltantes y sobrantes. Sin modelo. |
| `evals/evaluador.py` | El agente evaluador, con LangChain para Python. Su modelo se elige al correr. |
| `evals/resultados/` | Un archivo por corrida, con fecha, modelo y versión de las instrucciones. |

**Frontera entre los dos lenguajes.** Python nunca entra al Worker. Los evals tratan a la app como una caja cerrada:

- le preguntan por HTTP a `POST /api/asistente`, igual que el navegador;
- preparan y revisan la base local con `wrangler d1 execute --local`;
- usan un estado local propio, separado del de desarrollo, para no pisar tus datos de prueba.

Así el asistente se mide tal como lo usa el dueño, y cambiar algo en los evals no puede romper la app.

**Entorno.** En esta computadora hay Python 3.14 y `uv` 0.12; no hay `pip`, y el Python del sistema no admite instalar paquetes directamente. Por eso todo va con `uv`, que crea el entorno dentro de `evals/`. Dependencias previstas, a confirmar al implementar: `httpx` para hablar con la app, `langchain-deepseek` para el evaluador y `pydantic` para su salida estructurada. El código va en español, como el resto del proyecto.

Formato de tu lista, que es la guía del eval:

```json
{
  "id": "chicles",
  "pregunta": "¿Qué productos son chicles?",
  "grupo": "chicle",
  "tipo": "aprendizaje",
  "esperados": ["7501234567890", "7509876543210"]
}
```

`esperados` son los códigos de barras de los productos que sí son chicles, tomados de `evals/inventario.sql`.

**Calificación.** La cuenta la hace código, no un modelo:

- **aciertos:** nombrados y en tu lista;
- **faltantes:** en tu lista y no nombrados;
- **sobrantes:** nombrados y fuera de tu lista.

El caso pasa solo con cero faltantes y cero sobrantes. Cada caso se corre 3 veces, porque el modelo no responde idéntico cada vez, y debe pasar las 3.

**Papel del evaluador.** Propusiste que otro agente evalúe los resultados en el momento. Lo mantengo, con un reparto: comparar dos listas fijas es aritmética, y un modelo puede contar mal o ser indulgente, justo lo que quieres evitar. Así que:

- qué productos nombró la respuesta se determina primero por código (el nombre exacto o el código de barras aparecen en el texto);
- el evaluador interviene cuando una línea de la respuesta no coincide exactamente con ningún producto: elige a cuál se refiere, solo entre los productos del inventario de prueba;
- el evaluador explica cada faltante y cada sobrante (por ejemplo, "el nombre no menciona que es chicle").

Con opciones fijas y la cuenta en código, la calificación no admite favoritismos, sea cual sea el modelo del evaluador.

**El primer examen.** Acordado el 2026-11-11: empezar con unos 12 casos y sin modelo juez.

| Grupo | Casos | Ejemplo | Cómo se califica |
|---|---|---|---|
| Cifras | 4 | "¿Cuánto vale mi inventario?" | La cifra de la respuesta es la de la base |
| Grupos | 3 | Chicles (de aprendizaje) y dos de reserva | Códigos nombrados contra la lista |
| Conducta | 3 | "Ponle 5 a la leche" debe negarse y la base queda igual | Reglas en código |
| Formato | 2 | Sin Markdown ni emojis, precios como `$1,234.50` | Expresiones regulares |

La cifra que se mira es el porcentaje de casos que pasan, por modelo, antes y después de cada cambio. Cada fallo real del asistente se convierte en un caso nuevo.

**Modos de corrida:**

- `frio`: borra la memoria de grupos antes. Mide lo que el clasificador sabe por sí solo.
- `aprender`: después de calificar, guarda las correcciones.
- `repetir`: corre otra vez para comprobar los pasos 4 a 7 de la sección 4.

Los evals se saltan las respuestas guardadas, salvo en el paso que las prueba.

### 5.7 Automejora

**Automático.** Lo que viene de ti es un hecho, y entra directo a la memoria:

- en los evals, cada faltante se guarda como "sí pertenece" y cada sobrante como "no pertenece", con origen `dueno`;
- más adelante, lo mismo desde el chat: en una respuesta podrás marcar "falta un producto" o "este no es".

**Con tu aprobación.** Lo que propone un modelo no entra solo. Si el evaluador sugiere cambiar las instrucciones del clasificador, el cambio corre contra todos los evals, y solo se activa si mejora sin romper nada y tú lo apruebas.

**Una advertencia sobre la medición.** Si el sistema aprende la lista de chicles, volver a preguntar por chicles ya no mide qué tan bueno es: mide que la memoria funciona. Las dos cosas importan, así que hay dos tipos de caso:

- `aprendizaje`: el sistema puede aprender de él. Chicles es de este tipo.
- `reserva`: nunca se le corrige. Sirven para saber si el clasificador mejora de verdad. Conviene tener dos o tres grupos así, por ejemplo refrescos y botanas.

### 5.8 Modelos intercambiables y Gemini

El objetivo es correr el mismo asistente con DeepSeek o con Gemini y compararlos con los mismos casos.

**En la app (JavaScript):**

- **Lista de modelos permitidos** en la configuración del Worker. Cada uno tiene un identificador corto, su proveedor y el nombre del modelo. El primero de la lista es el de uso normal.
- **Elección por petición.** `POST /api/asistente` acepta uno de esos identificadores. Sigue siendo solo para el administrador, y cualquier valor fuera de la lista se rechaza. Los evals lo usan para correr los mismos casos con cada modelo sin reiniciar nada. La interfaz no cambia por ahora.
- **Secreto nuevo** con la clave de la API de Google, en `.dev.vars`. En producción solo se crea si decides usar Gemini ahí.
- **Cómo se conecta Gemini.** Primera opción: su API compatible con OpenAI, con la misma pieza de LangChain que ya está en el Worker, para no aumentar el tamaño. Si las herramientas no funcionan bien por esa vía, se usa el paquete de Google para LangChain y se mide cuánto pesa. Se confirma al implementar.
- El registro de ejecuciones guarda qué modelo respondió, así los evals y las respuestas guardadas nunca mezclan modelos.

**En los evals (Python):** cada caso se corre con cada modelo, 3 veces. El resultado es una tabla por modelo: si pasa, faltantes, sobrantes, duración y tokens.

**El evaluador, sin decidir.** El diseño permite posponerlo:

- La calificación nunca depende del evaluador: la cuenta la hace código.
- El evaluador se elige al correr: ninguno, DeepSeek o Gemini.
- Se puede **evaluar al evaluador**. En los casos donde el código ya sabe qué productos nombró la respuesta, se compara esa lectura con la de cada candidato. El que más coincida es el mejor evaluador, y lo decides con números.
- Una precaución: un modelo tiende a ser indulgente con sus propias respuestas. Si se evalúa a DeepSeek conviene que el evaluador sea Gemini, y al revés.

**"En tiempo real" tiene dos sentidos, y solo uno está planeado:**

- *Durante la corrida de evals*, justo después de cada respuesta. Es lo que describe este plan.
- *En producción, con cada respuesta al dueño.* No está planeado. Ahí no hay lista contra la cual comparar, duplica el costo por mensaje y agrega CPU dentro del plan gratuito. Si se quiere algo así, la opción barata es evaluar después, desde Python, las ejecuciones ya registradas.

**Antes de mandar el inventario real a Gemini** hay que revisar las condiciones de su nivel gratuito sobre el uso de los datos.

## 6. Etapas

Cada etapa se entrega como encargo a la sesión que implementa y se revisa antes de la siguiente.

| # | Etapa | Entrega | Cómo se verifica |
|---|---|---|---|
| 0 | Chatbot de consulta | Servidor, interfaz y documentación | Pruebas con DeepSeek real y medición de CPU ya publicado |
| 1 | Registro de ejecuciones y `version_datos` | Migración, registro al final de cada pregunta | Cada pregunta deja su fila, con su modelo; el contador sube con cada cambio |
| 2 | Modelos intercambiables y Gemini | Lista de modelos, elección por petición, clave de Google | Las mismas preguntas responden bien con DeepSeek y con Gemini; tamaño del Worker dentro del límite |
| 3 | Evals en Python y caso chicles | Carpeta `evals/`, tu lista, primera corrida con los dos modelos | Línea base por modelo: cuántos chicles encuentra cada uno |
| 4 | Memoria de grupos y clasificador | Tablas, herramienta `productos_del_grupo`, clasificador | Corrida en frío mejor que la línea base |
| 5 | Aprendizaje | Modo `aprender` | Pasos 3 y 4 de la sección 4 |
| 6 | Respuestas guardadas | Búsqueda en el registro, aviso en la interfaz | Pasos 5, 6 y 7 de la sección 4 |
| 7 | Correcciones desde el chat | Botones "falta" y "este no es" | Una corrección hecha en el chat cambia la siguiente respuesta |

Los evals van antes que la memoria a propósito: primero se mide cómo responde el asistente actual con cada modelo, y cada etapa posterior tiene que mejorar ese número.

## 7. Más adelante

Sin fecha; se planean cuando lo anterior esté publicado.

- **Embeddings (Vectorize con Workers AI o Gemini).** Para preseleccionar candidatos cuando el inventario sea grande, para reconocer que "goma de mascar" es el grupo `chicle` y para que las respuestas guardadas reconozcan la misma pregunta con otras palabras. DeepSeek no ofrece embeddings.
- **Visión con Gemini.** Proponer el nombre de un producto a partir de una foto del empaque.
- **API pública.** Rutas con versión, claves con permisos y documentación OpenAPI. Las mismas herramientas se pueden exponer como servidor MCP.
- **LangGraph.** Cuando el asistente pueda proponer cambios al inventario con tu confirmación. Dentro del Worker probablemente exija Workers Paid. La alternativa es un servicio aparte en Python, donde LangGraph es más maduro, pero eso saca una parte del proyecto de Cloudflare.

## 8. Límites del plan gratuito

| Límite | Cómo nos toca | Señal de que ya limita |
|---|---|---|
| 10 ms de CPU por petición | LangChain gasta CPU por cada fragmento de la respuesta. Las respuestas guardadas y el clasificador sin flujo gastan muy poco. | Respuestas cortadas a la mitad y errores 1102 en `npx wrangler tail inventario` |
| 3 MB comprimidos de Worker | Hoy son 585 KiB con LangChain. LangGraph sumaría bastante. | `wrangler deploy` rechaza el tamaño |
| Subpeticiones por petición | Cada llamada a DeepSeek y cada consulta a D1 cuenta. Una pregunta de grupo en frío hace dos llamadas más al modelo. | Error "Too many subrequests" |
| Lecturas y escrituras diarias de D1 | El registro agrega una escritura por pregunta. | Errores de cuota en D1 |

Las cifras exactas de los dos últimos se confirman en la documentación de Cloudflare al llegar a esas etapas.

## 9. Lo que hace falta de ti

- **Más preguntas en la app publicada**, varias seguidas y una de respuesta larga, avisando antes para grabar los registros y medir el CPU.
- **Una clave de la API de Google (Gemini)**, de Google AI Studio, para la etapa 2. Va en el `.dev.vars` del worktree, como la de DeepSeek.
- **Tu lista de chicles**, con el formato de la sección 5.6. Antes hay que sacar la copia del inventario real para `evals/inventario.sql`: falta decidir si la sacas tú o se encarga una exportación de solo lectura desde producción.
- **Decidir si `evals/inventario.sql` se sube al repositorio.** Contiene tus productos y precios.
- **Aclarar qué significa "evaluador en tiempo real"** para ti: durante los evals o también en producción (sección 5.8).
- **Qué tan abierto quieres el asistente.** Hoy solo habla del inventario porque así se le indica en sus instrucciones; fue un valor por defecto, no una decisión tuya.
- **Subir a GitHub.** `main` tiene tres commits sin `push`, y este archivo está sin commit.

## 10. Cómo se trabaja

**Dos sesiones.** Una planea, redacta los encargos y revisa; trabaja en la carpeta principal y no escribe código. La otra implementa en el worktree `/home/marco05/orca/workspaces/Lectorcodigodebarras/logperch`.

**Encargos.**

- Van de la sesión que planea a la que implementa con un mensaje entre sesiones. Cada uno es autosuficiente: contexto, contrato, restricciones, verificación con evidencia y forma de entrega.
- Los mensajes quedan retenidos hasta que el dueño los aprueba en la sesión que implementa, porque las dos corren en modos de permisos distintos. No se reenvían mientras estén retenidos.
- El nombre de la sesión que implementa cambia cada vez que se reinicia (ha sido `logperch-8a` y `logperch-5e`). Se busca en la lista de sesiones y, si no es evidente, se le pregunta al dueño.
- La rama del worktree también cambia de nombre sola. Hoy es `MarcoAle05/mensajes-sesion-retenidos-no` y apunta al mismo commit que `main`. Antes de cada encargo se comprueba que parta del `main` actual.
- La sesión que implementa pide confirmación al dueño antes de editar `CLAUDE.md`, `MEMORY.md` o `.claude/`.

**Entrega y revisión.** Cada encargo termina en un commit local, sin `push` ni fusión, y un informe con lo verificado y lo pendiente. La sesión que planea lee el diff completo y las capturas antes de mandar el siguiente.

**Fusionar y publicar.** Son del dueño. El 2026-11-11 pidió a la sesión que planea ejecutar los comandos de la etapa 0; eso valió para esa vez. Cada publicación nueva necesita su visto bueno.

**Entorno local de pruebas.** Vive en el worktree, no en la carpeta principal:

- El `.dev.vars` del worktree tiene `PIMIENTA`, `CODIGO_CONFIGURACION` (valores de prueba) y `DEEPSEEK_API_KEY` (la clave real). El de la carpeta principal no tiene la clave de DeepSeek, así que ahí el asistente responde 503.
- La base local del worktree tiene 15 productos de prueba y tres cuentas de prueba, que no existen en producción: `admin@prueba.test` / `Tornillo-Verde-7781`, `editora@prueba.test` / `Martillo-Azul-4432` y `lectora@prueba.test` / `Cuaderno-Gris-5519`.
- En producción hay una cuenta de administrador, la del dueño, y dos de editor.

## 11. Siguiente paso

Enviar el encargo de la **etapa 1: registro de ejecuciones y `version_datos`**. Todavía no se ha enviado. Debe pedir:

- Una migración nueva (`0002_...sql`, tablas `STRICT`) con la tabla `ejecuciones_asistente` de la sección 5.5 y el contador `version_datos`.
- El contador sube con cada cambio en `productos`. Primera opción: disparadores de SQLite en la migración, comprobando que D1 los admite en local y al aplicar la migración. Si no, se sube desde el código en cada cambio de `src/productos.js`.
- Una fila por pregunta, escrita al terminar el flujo sin retrasar la respuesta: pregunta, respuesta, mensajes previos, herramientas con argumentos y resumen del resultado, modelo, versión de las instrucciones, `version_datos`, cómo terminó, duración, tokens y origen (chat o eval).
- Los tokens exigen activar el uso en el flujo de LangChain; hay que medir cuánto CPU agrega.
- Las instrucciones del modelo pasan a tener un identificador de versión.
- Conservar 90 días, borrando lo viejo al escribir.
- Sin cambios en la interfaz. La migración se aplica primero en local; aplicarla en producción y publicar quedan para el dueño.

Después siguen la etapa 2 (modelos intercambiables y Gemini, que necesita la clave de Google) y la etapa 3 (evals en Python, que necesita la lista de chicles y la copia del inventario).
