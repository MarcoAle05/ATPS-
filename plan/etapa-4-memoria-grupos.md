# Etapa 4: memoria de grupos y clasificador

Estado: se anota en la tabla «Etapas del asistente» de `CLAUDE.md`, no aquí.

## Qué entrega

Las tablas de la memoria de grupos, la herramienta `productos_del_grupo` y el agente clasificador.

## Cómo se verifica

Una corrida de evals en frío (con la memoria vacía) da mejor resultado que la línea base de la etapa 3.

## Diseño

### Por qué hace falta

La herramienta actual busca palabras dentro del nombre. Un producto que se llame como su marca y su sabor, sin la palabra "chicle", no aparece. Para encontrarlo hay que juzgar cada producto por lo que es, y eso solo lo puede hacer un modelo.

### El clasificador

Recibe un grupo ("chicle") y una lista de productos sin revisar, y dice cuáles pertenecen. Su salida es estructurada, sin texto libre. Corre en el Worker, dentro de una herramienta y sin flujo. Va aparte del conversador para poder medirlo y mejorarlo solo.

### Memoria de grupos

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
- Los cambios en `miembros_grupo` suben `version_datos`, igual que los de `productos` (etapa 1).

Esta memoria es de todo el inventario, no de una sesión ni de una cuenta: por eso una sesión nueva acierta.

### Cómo se responde una pregunta de grupo

Herramienta nueva para el conversador: `productos_del_grupo`, con el nombre del grupo.

1. El conversador reconoce que la pregunta es sobre un tipo de producto y llama a la herramienta con `chicle`.
2. La herramienta busca en la memoria los miembros del grupo y los productos sin revisar.
3. Si hay productos sin revisar, la herramienta llama al clasificador con esos productos y guarda su juicio.
4. La herramienta devuelve los miembros con su precio y cantidad actuales, y los totales ya calculados, igual que `buscar_productos`.
5. El conversador redacta la respuesta.

La primera vez se juzga todo el inventario. Después solo los productos nuevos o renombrados. Las cantidades y los precios siempre salen de la tabla `productos` en el momento, nunca de la memoria.

Límite conocido: si el inventario crece a cientos de productos, juzgar todo en una sola pregunta no cabrá. Ahí entran los embeddings («Más adelante» en `PLAN.md`).

## Avance

Sin encargos enviados. Depende de la etapa 3, que da la línea base contra la que se compara.
