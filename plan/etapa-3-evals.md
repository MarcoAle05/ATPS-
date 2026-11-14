# Etapa 3: evals en Python y caso chicles

Estado: se anota en la tabla «Etapas del asistente» de `CLAUDE.md`, no aquí.

## Qué entrega

La carpeta `evals/`, tu lista de chicles convertida en caso y la primera corrida con los dos modelos.

## Cómo se verifica

Queda una línea base por modelo: cuántos chicles encuentra cada uno. Cada etapa posterior tiene que mejorar ese número.

## Qué hace falta del dueño

- **Tu lista de chicles**, con el formato de abajo.
- **La copia del inventario real** para `evals/inventario.sql`. Falta decidir si la sacas tú o se encarga una exportación de solo lectura desde producción.
- **Decidir si `evals/inventario.sql` se sube al repositorio.** Contiene tus productos y precios.
- **Aclarar qué significa "evaluador en tiempo real"** para ti: durante los evals o también en producción.

## Diseño

Todo vive en una carpeta `evals/` del repositorio y corre en tu computadora contra el servidor local, no en Cloudflare. Está escrito en Python.

### Archivos

| Archivo | Contenido |
|---|---|
| `evals/pyproject.toml` y `evals/uv.lock` | Proyecto de Python con sus dependencias, administrado con `uv`. |
| `evals/inventario.sql` | Inventario fijo de prueba: una copia de tu inventario real en una fecha. |
| `evals/casos/*.json` | Un caso por archivo. |
| `evals/correr.py` | Corre los casos contra la app, califica y guarda el resultado. |
| `evals/calificar.py` | La cuenta de aciertos, faltantes y sobrantes. Sin modelo. |
| `evals/evaluador.py` | El agente evaluador, con LangChain para Python. Su modelo se elige al correr. |
| `evals/resultados/` | Un archivo por corrida, con fecha, modelo y versión de las instrucciones. |

### Frontera entre los dos lenguajes

Python nunca entra al Worker. Los evals tratan a la app como una caja cerrada:

- le preguntan por HTTP a `POST /api/asistente`, igual que el navegador;
- preparan y revisan la base local con `wrangler d1 execute --local`;
- usan un estado local propio, separado del de desarrollo, para no pisar tus datos de prueba.

Así el asistente se mide tal como lo usa el dueño, y cambiar algo en los evals no puede romper la app.

### Entorno

En esta computadora hay Python 3.14 y `uv` 0.12; no hay `pip`, y el Python del sistema no admite instalar paquetes directamente. Por eso todo va con `uv`, que crea el entorno dentro de `evals/`. Dependencias previstas, a confirmar al implementar: `httpx` para hablar con la app, `langchain-deepseek` para el evaluador y `pydantic` para su salida estructurada. El código va en español, como el resto del proyecto.

### Formato de un caso

Tu lista es la guía del eval:

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

### Calificación

La cuenta la hace código, no un modelo:

- **aciertos:** nombrados y en tu lista;
- **faltantes:** en tu lista y no nombrados;
- **sobrantes:** nombrados y fuera de tu lista.

El caso pasa solo con cero faltantes y cero sobrantes. Cada caso se corre 3 veces, porque el modelo no responde idéntico cada vez, y debe pasar las 3.

### El primer examen

Acordado el 2026-11-11: empezar con unos 12 casos y sin modelo juez.

| Grupo | Casos | Ejemplo | Cómo se califica |
|---|---|---|---|
| Cifras | 4 | "¿Cuánto vale mi inventario?" | La cifra de la respuesta es la de la base |
| Grupos | 3 | Chicles (de aprendizaje) y dos de reserva | Códigos nombrados contra la lista |
| Conducta | 3 | "Ponle 5 a la leche" debe negarse y la base queda igual | Reglas en código |
| Formato | 2 | Sin Markdown ni emojis, precios como `$1,234.50` | Expresiones regulares |

La cifra que se mira es el porcentaje de casos que pasan, por modelo, antes y después de cada cambio. Cada fallo real del asistente se convierte en un caso nuevo.

Cada caso se corre con cada modelo, 3 veces. El resultado es una tabla por modelo: si pasa, faltantes, sobrantes, duración y tokens.

### Dos tipos de caso

Si el sistema aprende la lista de chicles, volver a preguntar por chicles ya no mide qué tan bueno es: mide que la memoria funciona. Las dos cosas importan, así que hay dos tipos de caso:

- `aprendizaje`: el sistema puede aprender de él. Chicles es de este tipo.
- `reserva`: nunca se le corrige. Sirven para saber si el clasificador mejora de verdad. Conviene tener dos o tres grupos así, por ejemplo refrescos y botanas.

### Modos de corrida

- `frio`: borra la memoria de grupos antes. Mide lo que el clasificador sabe por sí solo. Llega con la etapa 4.
- `aprender`: después de calificar, guarda las correcciones. Llega con la etapa 5.
- `repetir`: corre otra vez para comprobar los pasos 4 a 7 del caso guía de `PLAN.md`. Llega con las etapas 5 y 6.

Los evals se saltan las respuestas guardadas, salvo en el paso que las prueba.

### Papel del evaluador

Propusiste que otro agente evalúe los resultados en el momento. Se mantiene, con un reparto: comparar dos listas fijas es aritmética, y un modelo puede contar mal o ser indulgente, justo lo que quieres evitar. Así que:

- qué productos nombró la respuesta se determina primero por código (el nombre exacto o el código de barras aparecen en el texto);
- el evaluador interviene cuando una línea de la respuesta no coincide exactamente con ningún producto: elige a cuál se refiere, solo entre los productos del inventario de prueba;
- el evaluador explica cada faltante y cada sobrante (por ejemplo, "el nombre no menciona que es chicle").

Con opciones fijas y la cuenta en código, la calificación no admite favoritismos, sea cual sea el modelo del evaluador.

### El evaluador, sin decidir

Qué modelo será el evaluador queda sin decidir (2026-11-11). El diseño permite posponerlo:

- La calificación nunca depende del evaluador: la cuenta la hace código.
- El evaluador se elige al correr: ninguno, DeepSeek o Gemini.
- Se puede **evaluar al evaluador**. En los casos donde el código ya sabe qué productos nombró la respuesta, se compara esa lectura con la de cada candidato. El que más coincida es el mejor evaluador, y lo decides con números.
- Una precaución: un modelo tiende a ser indulgente con sus propias respuestas. Si se evalúa a DeepSeek conviene que el evaluador sea Gemini, y al revés.

### "En tiempo real" tiene dos sentidos, y solo uno está planeado

- *Durante la corrida de evals*, justo después de cada respuesta. Es lo que describe este plan.
- *En producción, con cada respuesta al dueño.* No está planeado. Ahí no hay lista contra la cual comparar, duplica el costo por mensaje y agrega CPU dentro del plan gratuito. Si se quiere algo así, la opción barata es evaluar después, desde Python, las ejecuciones ya registradas.

## Avance

Sin encargos enviados. Depende de las etapas 1 y 2, de la lista de chicles y de la copia del inventario.
