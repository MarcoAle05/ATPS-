# Etapa 2: modelos intercambiables y Gemini

Estado: se anota en la tabla «Etapas del asistente» de `CLAUDE.md`, no aquí.

## Qué entrega

La lista de modelos permitidos, la elección de modelo por petición y la conexión con Gemini por medio de la clave de Google.

## Cómo se verifica

Las mismas preguntas responden bien con DeepSeek y con Gemini, y el tamaño del Worker sigue dentro del límite.

## Qué hace falta del dueño

Una clave de la API de Google (Gemini), de Google AI Studio. Va en el `.dev.vars` del worktree, como la de DeepSeek. Entregada el 2026-11-13: el dueño la puso como `GEMINI_API_KEY`.

## Diseño

El objetivo es correr el mismo asistente con DeepSeek o con Gemini y compararlos con los mismos casos.

- **Lista de modelos permitidos** en la configuración del Worker. Cada uno tiene un identificador corto, su proveedor y el nombre del modelo. El primero de la lista es el de uso normal.
- **Elección por petición.** `POST /api/asistente` acepta uno de esos identificadores. Sigue siendo solo para el administrador, y cualquier valor fuera de la lista se rechaza. Los evals lo usan para correr los mismos casos con cada modelo sin reiniciar nada. La interfaz no cambia por ahora.
- **Secreto nuevo** con la clave de la API de Google, en `.dev.vars`. En producción solo se crea si decides usar Gemini ahí.
- **Cómo se conecta Gemini.** Primera opción: su API compatible con OpenAI, con la misma pieza de LangChain que ya está en el Worker, para no aumentar el tamaño. Si las herramientas no funcionan bien por esa vía, se usa el paquete de Google para LangChain y se mide cuánto pesa. Se confirma al implementar.
- **Registro.** El registro de ejecuciones (etapa 1) guarda qué modelo respondió, así los evals y las respuestas guardadas nunca mezclan modelos.

**Antes de mandar el inventario real a Gemini** hay que revisar las condiciones de su nivel gratuito sobre el uso de los datos.

Revisadas el 2026-11-13 ([condiciones adicionales de la API](https://ai.google.dev/gemini-api/terms)): en el nivel gratuito Google puede usar lo que se le manda para mejorar sus productos, y una persona puede leerlo, después de separarlo de la cuenta y de la clave. Con la facturación activada no lo usa. El dueño decide antes de mandarle el inventario real, ya sea desde producción o en los evals. Mientras tanto, Gemini solo recibe datos de prueba.

Precisiones fijadas al redactar el encargo (2026-11-13), a partir de un sondeo con texto inventado:

- **Modelo de Gemini: `gemini-3.5-flash`.** Con la clave del dueño, `gemini-2.5-flash` ya no está disponible para cuentas nuevas (404), y `gemini-3.8-flash`, `gemini-3.5-flash-lite` y `gemini-flash-latest` respondieron 403. `gemini-3.5-flash` respondió en 1.2 s en el nivel gratuito.
- **Firma de las llamadas de herramienta.** Gemini manda una firma (`thought_signature`) con cada llamada de herramienta y exige que se le devuelva en la siguiente; sin ella responde 400. `@langchain/openai` 1.8.3 la pierde al rearmar las llamadas, igual que pasa con el `reasoning_content` de DeepSeek. Primera opción: conservarla dentro del bucle propio, con la pieza de LangChain que ya está en el Worker. Segunda: el paquete de Google para LangChain, avisando antes de su tamaño. La firma ficticia que Google documenta para saltarse la validación solo con permiso del dueño.
- **Configuración.** La variable `MODELOS_ASISTENTE` de `wrangler.jsonc` reemplaza a `MODELO_ASISTENTE`. Contiene `deepseek` (`deepseek-flash`) y `gemini` (`gemini-3.5-flash`), y el primero es el de uso normal. Los parámetros fijos de cada proveedor quedan en el código.
- **Petición.** Campo opcional `modelo` con el identificador corto. Un valor fuera de la lista se rechaza con 400 antes de llamar al modelo, sin dejar fila.
- **Claves.** `DEEPSEEK_API_KEY` y `GEMINI_API_KEY`. Si falta la del modelo elegido, 503 nombrando al proveedor; DeepSeek no depende de la de Gemini.
- **Versión de las instrucciones.** Una por modelo, que incluye los parámetros fijos de su proveedor.
- **Registro.** `modelo` guarda el nombre del modelo que respondió.
- **Razonamiento.** El mínimo que acepte `gemini-3.5-flash`, comprobando que no se come el tope de 800 tokens de salida. En el sondeo, el uso total (207) pasó por mucho la suma de entrada y salida (60 + 16).

### A comprobar con Gemini

- **Tokens.** Si Gemini informa el uso de tokens en el flujo, y si informa los de caché. El registro admite que los de caché falten.
- **Mensajes de error.** Hoy los avisos al dueño y los de la consola nombran a DeepSeek; hay que hacerlos valer para cualquier proveedor.
- **Razonamiento.** DeepSeek va con el razonamiento desactivado por un parámetro propio; Gemini necesita el suyo.

## Avance

- 2026-11-13 · El dueño entregó la clave de Google. Se comprobó con la lista de modelos (200) y con un sondeo de texto inventado; los resultados están en «Precisiones fijadas al redactar el encargo».
- 2026-11-13 · Encargo enviado a la sesión que implementa (`logperch-b5`), aprobado por el dueño. Pide llevar la rama del worktree al `main` actual (`489e176`) antes de empezar.
- 2026-11-13 · Entrega recibida en dos commits: `6a0331f` (código, `wrangler.jsonc`, banco y `package.json`) y `5334807` (`CLAUDE.md`, aprobado por el dueño). Sin migración.
  - La firma se resolvió sin paquete nuevo ni firma ficticia. `responder` guarda las llamadas crudas en `additional_kwargs.tool_calls`, y `ModeloGemini` (subclase de `ChatOpenAICompletions`) pone la firma de vuelta, por id, justo antes de enviar.
  - Las cuatro preguntas respondieron bien con los dos modelos, y las cifras coincidieron con SQL. Gemini no informa tokens de caché. Con `reasoning_effort: 'minimal'`, el razonamiento no aparece aparte en el uso.
  - CPU con DeepSeek, antes y después: 3.37 y 3.37 ms la respuesta corta; 20.57 y 20.53 ms la larga. Gemini simulado: 3.27 y 19.62 ms. Worker de 589.81 a 591.64 KiB.
  - Gemini manda el texto en 2 a 4 trozos, contra 32 a 96 de DeepSeek.
- 2026-11-13 · Revisión: diff completo leído. La sintaxis pasa y el banco corre con los dos modelos (con Gemini simulado también en `muchas`); las filas de la base local coinciden con el informe. Al probar contra Google salieron tres cosas:
  - **Nombre del modelo.** Google cuenta las peticiones a `gemini-3.5-flash` en la cuota de `gemini-3.6-flash`, aunque la respuesta diga 3.5: la fila nombraría un modelo que no es el que respondió.
  - **Clave inválida.** Gemini responde 400 («Please pass a valid API key»), no 401, así que el dueño vería «no pudo responder» en vez de «revisa la clave».
  - **Cuota del nivel gratuito.** Son 20 peticiones al día por proyecto y por modelo (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`); se renueva a medianoche, hora del Pacífico. Se agotó ese día. Ante un 429, el asistente dice «intenta de nuevo en unos segundos».
- 2026-11-13 · Ronda de correcciones enviada a `logperch-b5`, aprobada por el dueño:
  - la lista pasa a `gemini-3.6-flash`;
  - mensaje de clave rechazada también para el 400 de Google;
  - mensaje propio cuando se agota la cuota.
- 2026-11-13 · Correcciones recibidas en el commit `90bd953` y revisadas. `CLAUDE.md` ahora menciona la cuota de 20 peticiones al día.
  - **Modelo:** la lista ya dice `gemini-3.6-flash`. Las versiones de las instrucciones no cambiaron (Gemini `71ae0df4`, DeepSeek `a6754dd8`).
  - **Clave rechazada:** se reconoce un 401 o un 400 que hable de la API key. Con Google real y una clave inventada, el dueño lee «Gemini rechazó la clave del asistente…», y la fila queda con `proveedor-400`.
  - **Cuota agotada:** un 429 que hable de cuota distingue la del día de la del minuto. Con Google real y la cuota del día agotada: «Se acabó la cuota de hoy de Gemini para este modelo. Intenta mañana.», con `proveedor-429`. El 429 de DeepSeek («Rate Limit Reached») sigue diciendo «ocupado».
  - El banco tiene un escenario nuevo, `cuota`, y comprobé los cinco casos con los dos modelos. Una fusión de prueba con `main` (`5ae81d4`) no tuvo conflictos.
  - Falta una pregunta real con Gemini que termine bien con el nombre `gemini-3.6-flash`: la cuota del día se agotó en las pruebas.
- 2026-11-13 · Fusionada a `main` (commit `abe98c6`) y publicada, a petición del dueño. Sin migración.
  - Worker: 589.99 KiB comprimido y arranque de 33 ms. Versión `bae0fe57-120b-42a1-9e2c-641f5f203be6`.
  - Sin sesión, la página responde 200 y `POST /api/asistente` 401. El `validacion.js` publicado ya trae `validarModeloAsistente`.
  - En producción no hay `GEMINI_API_KEY`: el chat sigue con DeepSeek, y una petición con `modelo: "gemini"` responde 503.
- Falta:
  - una pregunta del dueño en la app publicada, para ver que DeepSeek sigue bien y que su fila trae la versión nueva (`a6754dd8…`);
  - una pregunta real con Gemini, en local, que termine bien con `gemini-3.6-flash`, cuando se renueve la cuota.

## Pendiente

- **Cuota de Gemini para los evals (etapa 3).** Con 20 peticiones al día por modelo, una corrida de 12 casos con Gemini (unas 24 a 36 peticiones) no cabe en un día. El dueño decide entre activar la facturación en Google, que además quita el uso de sus datos para mejorar los productos de Google, o repartir las corridas o usar menos casos.
- **Temperatura distinta.** Gemini va con la de fábrica, porque Google pide no cambiarla en 3.x, y DeepSeek con 0.2. La comparación de la etapa 3 no es con la misma temperatura.
- **Sin probar con Gemini real:** el tiempo de espera y el filtro de contenido.
