# Etapa 3: evals en Python y caso chicles

Estado: se anota en la tabla «Etapas del asistente» de `CLAUDE.md`, no aquí.

## Qué entrega

La carpeta `evals/`, tu lista de chicles convertida en caso y la primera corrida con DeepSeek.

**Cambio del 2026-11-16:** Gemini queda a un lado por ahora. Los evals corren solo con DeepSeek, y cada agente tiene su propia configuración (modelo, parámetros e instrucciones). Donde este archivo dice «cada modelo», se entiende cada configuración de DeepSeek que se quiera comparar.

## Cómo se verifica

Queda una línea base por modelo: cuántos chicles encuentra cada uno. Cada etapa posterior tiene que mejorar ese número.

## Qué hace falta del dueño

- ~~**Tu lista de chicles**, con el formato de abajo.~~ Entregada el 2026-11-16, por nombre, con «sí» o «no»:

  | Producto | ¿Es chicle? | En producción (2026-11-16) |
  |---|---|---|
  | Xtracare Menta | Sí | `7622210571380` «Trident XtraCare menta fresca» |
  | Xtracare Twist | Sí | `7622210530509` «X TWIST fresa y limón Trident» |
  | Bubaloo Plátano | Sí | `2000000000015` «Bubbaloo Plátano» (código inventado). Además se agregó un «Bubbaloo» de sabor desconocido (ver abajo). |
  | Canels | Sí | `2000000000022` «Canels» (código inventado) |
  | Trident | Sí | `7506105606053` «Trident Menta» |
  | Clorets | Sí | `7622210624482` «Clorets» |
  | Motitas y Yucatán | Sí | `2000000000039` «Motitas y Yucatán» (código inventado) |
  | Orbit | Sí | `7502226812700` «Orbit Wrigleys» |
  | Pastillas Menta | No | `2000000000046` «Pastillas Menta» (código inventado) |
  | Life Savers Mint | No | `022000018366` «Life Savers Mint Pep O Mint» (importado de Estados Unidos) |
  | Ment mouth | No | `2000000000053` «Ment Mouth» (código inventado) |

  Los tres «no» son pastillas de menta: se parecen a un chicle y por eso sirven para medir los sobrantes.

  **Códigos inventados.** Cinco productos no están en Open Food Facts, y el dueño pidió inventarles el código (2026-11-16). Van en el rango de uso interno de GS1 (prefijo 200, EAN-13 con dígito verificador válido), que nunca coincide con un producto real. Si el dueño escanea el empaque real, la app creará otro producto con el código verdadero. Punto de restauración de D1 anterior a esta alta: `0000002f-00000000-00005125-77e4a3d58b118ee987c85cfddde22c7b`.

  **Productos agregados el 2026-11-16 por la sesión que planea, a petición del dueño.** Los datos salieron de Open Food Facts, la misma fuente del autollenado de la app. Los nombres son los que sugiere la app, solo con ajustes de mayúsculas. Quedaron como productos definitivos de producción, con precio 0 y cantidad 0. El punto de restauración de D1 anterior al alta es `0000002e-00000000-00005125-4f6a4fe07e22ecf99591c9a6b0c1685a`.

  Del dueño, además de los de la tabla:

  | Código | Nombre | ¿Es chicle? | Para qué está |
  |---|---|---|---|
  | `7622210571328` | Trident XtraCare yerbabuena | Sí | Otro chicle cuyo nombre no dice «chicle» |
  | `75073275` | Bubbaloo | Sí (lleva goma base) | El más cercano al Bubbaloo Plátano; sabor sin confirmar |

  Trampas, propuestas por la sesión que planea y confirmadas por el dueño el 2026-11-16:

  | Código | Nombre | ¿Es chicle? | Trampa |
  |---|---|---|---|
  | `7503027878377` | Mentos goma de mascar sabor yerbabuena | Sí | Marca de pastillas, pero esta sí es chicle |
  | `7503027878629` | Yerbabuena Mentos | No | Mismo sabor y marca que el anterior, pero es pastilla |
  | `7622210267832` | Halls yerbabuena | No | Caramelo de la misma empresa que Trident y Clorets |
  | `80941385` | Tic Tac | No | Pastilla de menta |
  | `7622210996190` | Bubbaloo Pik Pop | No (no lleva goma base) | Misma marca que un chicle, pero no es chicle |
- **La copia del inventario real** para `evals/inventario.sql`. Falta decidir si la sacas tú o se encarga una exportación de solo lectura desde producción.
- ~~**Un inventario con suficientes productos.**~~ Resuelto el 2026-11-16: producción tiene 19 productos, entre ellos los 11 de la lista y 5 trampas. Los precios de los 16 agregados ese día son inventados, a petición del dueño.
- **Decidir si `evals/inventario.sql` se sube al repositorio.** Contiene tus productos y precios.
- ~~**Aclarar qué significa "evaluador en tiempo real"** para ti: durante los evals o también en producción.~~ Aclarado el 2026-11-16: solo durante los evals.

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
- El evaluador se elige al correr: ninguno o una configuración de DeepSeek. Gemini, a un lado desde el 2026-11-16.
- Se puede **evaluar al evaluador**. En los casos donde el código ya sabe qué productos nombró la respuesta, se compara esa lectura con la de cada candidato. El que más coincida es el mejor evaluador, y lo decides con números.
- Una precaución: un modelo tiende a ser indulgente con sus propias respuestas. Como ahora todo es DeepSeek, conviene que el evaluador use un modelo distinto al del conversador (por ejemplo `deepseek-v4-pro` si el conversador usa `deepseek-flash`). De todos modos, la cuenta de aciertos la hace código.

### "En tiempo real" tiene dos sentidos, y solo uno está planeado

- *Durante la corrida de evals*, justo después de cada respuesta. Es lo que describe este plan.
- *En producción, con cada respuesta al dueño.* No está planeado. Ahí no hay lista contra la cual comparar, duplica el costo por mensaje y agrega CPU dentro del plan gratuito. Si se quiere algo así, la opción barata es evaluar después, desde Python, las ejecuciones ya registradas.

## Avance

- 2026-11-16 · El dueño entregó su lista de chicles y aclaró que el evaluador trabaja solo durante los evals. Faltan los productos registrados, la copia del inventario y la decisión sobre la facturación de Gemini.
- 2026-11-16 · A petición del dueño, la sesión que planea agregó 11 productos a producción, tomados de Open Food Facts: 6 chicles y 5 trampas. Producción pasó de 3 a 14 productos, y `version_datos` de 2 a 13. Faltan 5 productos de la lista que no están en Open Food Facts; los tiene que escanear el dueño.
- 2026-11-16 · A petición del dueño, esos 5 productos se agregaron con códigos inventados del rango interno 200. Producción quedó con 19 productos y `version_datos` en 18. La lista del dueño ya está completa en producción.
- 2026-11-16 · El dueño confirmó las trampas, pidió inventar los precios y dejó Gemini a un lado: los evals trabajan solo con DeepSeek, con una configuración propia por agente. Los precios inventados ya están en los 16 productos agregados (de $2.00 a $35.00); `version_datos` quedó en 34. Punto de restauración previo: `00000030-00000000-00005125-7204cd589897f1cafc88875c1f8b5e5e`.
