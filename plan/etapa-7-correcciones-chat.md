# Etapa 7: correcciones desde el chat

Estado: se anota en la tabla «Etapas del asistente» de `CLAUDE.md`, no aquí.

## Qué entrega

En una respuesta del chat, dos acciones para el dueño: "falta un producto" y "este no es".

## Cómo se verifica

Una corrección hecha en el chat cambia la siguiente respuesta a la misma pregunta.

## Diseño

Es el aprendizaje de la etapa 5, hecho desde la interfaz en vez de desde los evals:

- lo que marca el dueño es un hecho y entra directo a la memoria de grupos, con origen `dueno`;
- "falta un producto" guarda que ese producto sí pertenece al grupo; "este no es" guarda que no pertenece;
- la corrección señala la respuesta concreta por medio del identificador de ejecución (cabecera `X-Ejecucion`, etapa 1).

El resto del diseño se detalla cuando llegue la etapa.

## Avance

Sin encargos enviados. Depende de las etapas 4 y 5.
