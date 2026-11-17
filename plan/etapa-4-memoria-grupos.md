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

### Propuesta del dueño: embeddings

El 2026-11-16 el dueño propuso clasificar los productos con embeddings, y que el evaluador corrija la clasificación de un producto cuando el conversador se equivoque. Cómo se clasifica un producto nuevo está sin decidir. Respuesta de la sesión que planea; el dueño aceptó el orden recomendado el 2026-11-16:

- **La corrección no cambia el vector, cambia una etiqueta.** El embedding de un producto sale de su nombre y no se edita a mano. Lo que se corrige es la etiqueta que va junto a él («chicle: sí o no» y quién lo dijo), que es justo lo que guarda `miembros_grupo`. La propuesta encaja con esta etapa: los vectores sirven para encontrar parecidos y la memoria guarda las etiquetas.
- **Producto nuevo: por vecinos.** Se calcula su embedding y se buscan los productos ya etiquetados más parecidos. Si los más cercanos son chicles confirmados y el parecido es alto, queda como «probable chicle». Si está en duda, decide el clasificador o el dueño.
- **Límite de los embeddings en este caso:** «Clorets» y «Life Savers Mint» quedan cerca porque los dos son de menta, pero uno es chicle y el otro no. Los embeddings miden parecido, no pertenencia a un grupo, y fallan justo en la frontera que importa. Las marcas mexicanas («Canels», «Motitas») pueden no ser conocidas por el modelo de embeddings.
- **Quién corrige.** En los evals, la corrección sale de la lista del dueño, no de la opinión del evaluador (etapa 5). Solo se corrigen los casos de tipo `aprendizaje`.
- **Recomendación:** primero la línea base de la etapa 3. Después, el clasificador con memoria y, sobre él, los embeddings como pieza aparte, para preseleccionar candidatos y sugerir la etiqueta de un producto nuevo. Los evals dicen con números si los embeddings mejoran el resultado.
- **Infraestructura posible:** Cloudflare Vectorize, con embeddings de Workers AI o de Gemini. DeepSeek no ofrece embeddings.

## Precisiones fijadas al redactar el encargo (2026-11-16)

Punto de partida: la línea base de la etapa 3, con chicles en 0 de 11 y pastillas de menta en 1 de 6.

- **Solo `deepseek-flash`**, por decisión del dueño. Nada de Gemini, `deepseek-v4-pro` ni embeddings en esta etapa.
- **Configuración del clasificador.** El modelo va en una variable nueva de `wrangler.jsonc`, `CLASIFICADOR_ASISTENTE` (`deepseek` / `deepseek-flash`). Los parámetros fijos van en el código:
  - temperatura 0, sin razonamiento y sin flujo;
  - `maxTokens` acotado;
  - su propia espera, de unos 20 s, bajo la misma señal de cancelación de la pregunta.

  Toma la URL, la clave y la clase de `PROVEEDORES.deepseek`, y tiene su propia versión: un hash de las instrucciones, el esquema, el modelo y los parámetros. Esa versión se guarda en `miembros_grupo.version_clasificador`.
- **Entrada y salida del clasificador.** Recibe el grupo y una lista numerada de nombres, sin códigos, precios ni cantidades. Devuelve `{ pertenecen: [números] }`.
  - Lo enviado que no esté en la lista queda como «no».
  - Si la salida se corta o no se puede leer, no se guarda nada.
  - Se usan números porque la salida es más corta y no hay que copiar códigos largos.
- **Cupo:** una clasificación por pregunta, con hasta 100 productos. Lo que falte queda en `sin_revisar`, y la herramienta lo dice.
- **Si el clasificador falla,** la pregunta no falla. La herramienta responde con los miembros que ya conocía y un aviso, sin guardar nada.
- **Nombre del grupo:** `validarNombreGrupo` en `validacion.js`. Normaliza a minúsculas, sin acentos y con espacios colapsados, y acepta de 1 a 40 caracteres de letras, dígitos y espacios. El singular lo pone el conversador; el código no lo intenta.
- **`productos_del_grupo`** acepta los mismos filtros, orden y límite que `buscar_productos`, sin `texto`. Devuelve cada miembro con `confirmado`, que es verdadero si el origen es `dueno`.
- **El registro.** El resumen de la herramienta usa `total` y `codigos`, como `buscar_productos`, y agrega la clasificación con su modelo, versión, tokens y duración. Las columnas de tokens de la fila siguen siendo solo del conversador.
- **Lo que dice el conversador:** si algún producto no está confirmado, avisa en una sola línea al final que la lista la armó el asistente y puede tener errores.
- **Sin trampas en las instrucciones.** Ni las del clasificador ni las del conversador pueden nombrar productos ni marcas del inventario del examen.
- **Evals:**
  - la memoria se vacía antes de cada repetición, para que cada una sea en frío;
  - los juicios del clasificador se califican aparte de la respuesta, pero no deciden si el caso pasa;
  - el caso de conducta acepta un cambio de `version_datos` solo si esa pregunta escribió en la memoria;
  - el evaluador recibe también qué dijo el clasificador de cada fallo;
  - los casos y `evals/inventario.sql` no cambian.
- **Productos borrados.** `ON DELETE CASCADE` hacia `productos`: borrar un producto borra sus filas sin código nuevo. El código de un producto nunca cambia.

## Avance

- 2026-11-16 · Encargo redactado y aprobado por el dueño, y enviado a `logperch-95`. Pide llevar la rama del worktree al `main` actual antes de empezar.
- 2026-11-16 · Entrega recibida en cuatro commits sobre `c3fea29`:
  - `673696c`: migración `0003`, `src/clasificador.js`, `productos_del_grupo`, instrucciones, `validarNombreGrupo`, `wrangler.jsonc` y banco;
  - `c68d071`: evals con memoria fría y el clasificador calificado aparte;
  - `e730d1e`: la corrida `evals/resultados/2026-11-16_181130.json`;
  - `4c36e49`: `CLAUDE.md` y `.claude/rules/datos.md`, con permiso del dueño.
- 2026-11-16 · Revisión:
  - Leí el diff completo. La sintaxis pasa, y el banco corre `grupo`, `grupo-memoria` y los tres fallos simulados del clasificador. Con cada fallo la fila queda `bien`, `sin_revisar` en 19 y nada guardado.
  - La corrida recalificada sin evaluador da el mismo resultado.
  - El diff no contiene valores de `.dev.vars` ni las contraseñas de prueba.
  - Una consulta de solo lectura en D1 de producción confirmó que acepta `json_each` y `->>`, y que `->> 'p'` devuelve un entero, como espera el upsert.
  - Una fusión de prueba con `main` no tuvo conflictos.
  - Detalles menores de documentación:
    - el comentario de `0003` no lista `enviados` en la clasificación;
    - `CLAUDE.md` todavía dice que a `version_datos` solo lo suben los disparadores de `productos`.
- 2026-11-16 · Fusionada a `main` (`738bfa4`) y publicada, a petición del dueño. Los dos detalles de documentación se corrigieron en `dc84219`.
  - Punto de restauración previo a la migración: `0000003e-00000000-00005126-21e459b66dc1cc46c9b488db14e02c1b`.
  - Migración `0003` aplicada en producción: tablas, índice y los tres disparadores creados. Productos sin cambios (19) y `version_datos` en 34.
  - Worker publicado: 593.15 KiB comprimido, arranque de 74 ms y versión `35c377fb`.
- 2026-11-16 · Verificada en producción con una pregunta de chicles del dueño (2026-11-17 01:56 UTC). Etapa terminada.
  - La fila quedó `bien`, con 2 llamadas al modelo y 4.7 s. El clasificador juzgó los 19 productos en 1 s, con 533 tokens de entrada y 48 de salida.
  - La respuesta dio los mismos 14 productos que los evals y cerró con el aviso de que puede tener errores.
  - La memoria guardó 19 filas de «chicle»: 14 sí y 5 no, todas del clasificador. `version_datos` pasó de 34 a 53, una vez por fila, como estaba previsto.
  - CPU: 108 ms según Workers Observability, y Cloudflare la dejó terminar. Es la cifra más alta medida: las preguntas de la etapa 1 iban de 33 a 79 ms y la de la etapa 2 gastó 78. El aumento contra esa (unos 38 %) se parece al que calculó el banco (de 3.1 a 4.2 ms).

## Resultado contra la línea base (2026-11-16)

Archivo `evals/resultados/2026-11-16_181130.json`, con 3 repeticiones y la memoria fría en cada una:
- conversador `deepseek-flash`, instrucciones `d73495c8`;
- clasificador `deepseek-flash`, versión `cef57089`.

- **Pasan 10 de 12 casos, igual que la línea base.** Un caso de grupo solo pasa sin ningún error en las tres repeticiones. Los 10 que pasaban siguen pasando 3 de 3.
- **`chicles`: de 0 de 11 a 11 de 11** en las tres repeticiones, con 3 sobrantes: Ment Mouth, Yerbabuena Mentos y Bubbaloo Pik Pop.
- **`pastillas-menta`: de 1 de 6 a 5 de 6**, sin sobrantes. Falta Yerbabuena Mentos, que el clasificador cree que es chicle.
- **Todos los errores son del clasificador.** El conversador repite su lista tal cual y cierra con «Esta lista la armó el asistente y puede tener errores.» Con temperatura 0, el clasificador dio los mismos juicios en sus 6 llamadas.
- **Trampas:** engañan 2 de 5, Yerbabuena Mentos y Bubbaloo Pik Pop, las dos por compartir marca con un chicle. También Ment Mouth, uno de los «no» del dueño.
- **«Más de 15 pesos»** ya no incluye los productos de $15.00, aunque ese caso no lo mide.
- **Costo:** $0.0065 por corrida fuera de pico.
  - conversador: $0.0048;
  - clasificador: $0.0003;
  - evaluador: $0.0014.
- **CPU en el banco:** una pregunta de grupo que clasifica gasta unos 4.2 ms, contra 3.1 de una corta, y una que ya tiene la memoria, 3.5. El Worker crece unos 3 KiB comprimido.

## Pendiente

- **Los tres errores del clasificador son estables.** Se corrigen con las etapas 5 (aprendizaje en los evals) y 7 (correcciones desde el chat), o con otro modelo para el clasificador, que decide el dueño. Las instrucciones no se ajustaron al examen, a propósito.
- **CPU en producción:** la única pregunta de grupo medida gastó 108 ms, con la memoria vacía. Falta medir una con la memoria ya llena. Si aparecen errores 1102 («Worker exceeded resource limits»), las salidas son las de `MEMORY.md` (2026-10-15): bajar trabajo o pasar a Workers Paid.
- **El texto previo a una consulta queda en la respuesta.** En una pregunta con dos grupos, el conversador escribió «Voy a consultar ambos grupos.» antes de llamar a la herramienta, y ese texto quedó al principio. Viene de antes de esta etapa.
- **Los grupos no se excluyen:** Ment Mouth quedó a la vez como chicle y como pastilla de menta.
