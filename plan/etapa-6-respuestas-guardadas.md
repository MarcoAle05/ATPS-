# Etapa 6: respuestas guardadas

Estado: se anota en la tabla «Etapas del asistente» de `CLAUDE.md`, no aquí.

## Qué entrega

La búsqueda de una respuesta anterior en el registro de ejecuciones y un aviso discreto en la interfaz cuando la respuesta es guardada.

## Cómo se verifica

Con los pasos 5, 6 y 7 del caso guía de `PLAN.md`: la misma pregunta sin cambios sale guardada y sin llamar al modelo; tras un cambio en el inventario se arma de nuevo sin volver a juzgar; y un producto nuevo es el único que se juzga.

## Diseño

Además de la memoria de grupos, se guarda la respuesta completa para no llamar al modelo cuando nada cambió. Una pregunta se responde con una respuesta guardada solo si se cumple todo esto:

- es la primera pregunta de la conversación (una pregunta de seguimiento depende de lo anterior);
- el texto, normalizado, es igual al de una ejecución anterior que terminó bien;
- los datos no han cambiado desde entonces: el contador `version_datos` es el mismo (etapa 1);
- las instrucciones y el modelo son los mismos;
- la ejecución anterior tiene menos de 24 horas.

Las respuestas guardadas no se buscan en una tabla aparte: salen del registro de ejecuciones. La interfaz debe indicar con discreción que la respuesta es guardada.

Dos niveles, entonces: la respuesta guardada evita llamar al modelo; la memoria de grupos evita volver a juzgar aunque el inventario haya cambiado.

Los evals se saltan las respuestas guardadas, salvo en el paso que las prueba.

### Por decidir al llegar

La versión de las instrucciones (etapa 1) no cubre el código de las herramientas. Si cambia cómo busca `buscar_productos`, una respuesta guardada seguiría pareciendo vigente. Hay que decidir cómo se invalida: la opción más simple es exigir también que la versión publicada del Worker sea la misma.

## Avance

Sin encargos enviados. Depende de las etapas 1 y 4.
