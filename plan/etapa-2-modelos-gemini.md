# Etapa 2: modelos intercambiables y Gemini

Estado: se anota en la tabla «Etapas del asistente» de `CLAUDE.md`, no aquí.

## Qué entrega

La lista de modelos permitidos, la elección de modelo por petición y la conexión con Gemini por medio de la clave de Google.

## Cómo se verifica

Las mismas preguntas responden bien con DeepSeek y con Gemini, y el tamaño del Worker sigue dentro del límite.

## Qué hace falta del dueño

Una clave de la API de Google (Gemini), de Google AI Studio. Va en el `.dev.vars` del worktree, como la de DeepSeek.

## Diseño

El objetivo es correr el mismo asistente con DeepSeek o con Gemini y compararlos con los mismos casos.

- **Lista de modelos permitidos** en la configuración del Worker. Cada uno tiene un identificador corto, su proveedor y el nombre del modelo. El primero de la lista es el de uso normal.
- **Elección por petición.** `POST /api/asistente` acepta uno de esos identificadores. Sigue siendo solo para el administrador, y cualquier valor fuera de la lista se rechaza. Los evals lo usan para correr los mismos casos con cada modelo sin reiniciar nada. La interfaz no cambia por ahora.
- **Secreto nuevo** con la clave de la API de Google, en `.dev.vars`. En producción solo se crea si decides usar Gemini ahí.
- **Cómo se conecta Gemini.** Primera opción: su API compatible con OpenAI, con la misma pieza de LangChain que ya está en el Worker, para no aumentar el tamaño. Si las herramientas no funcionan bien por esa vía, se usa el paquete de Google para LangChain y se mide cuánto pesa. Se confirma al implementar.
- **Registro.** El registro de ejecuciones (etapa 1) guarda qué modelo respondió, así los evals y las respuestas guardadas nunca mezclan modelos.

**Antes de mandar el inventario real a Gemini** hay que revisar las condiciones de su nivel gratuito sobre el uso de los datos.

### A comprobar con Gemini

- **Tokens.** Si Gemini informa el uso de tokens en el flujo, y si informa los de caché. El registro admite que los de caché falten.
- **Mensajes de error.** Hoy los avisos al dueño y los de la consola nombran a DeepSeek; hay que hacerlos valer para cualquier proveedor.
- **Razonamiento.** DeepSeek va con el razonamiento desactivado por un parámetro propio; Gemini necesita el suyo.

## Avance

Sin encargos enviados. Depende de la etapa 1 y de la clave de Google.
