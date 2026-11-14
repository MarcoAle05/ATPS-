# Etapa 5: aprendizaje

Estado: se anota en la tabla «Etapas del asistente» de `CLAUDE.md`, no aquí.

## Qué entrega

El modo `aprender` de los evals: después de calificar, las correcciones se guardan en la memoria de grupos.

## Cómo se verifica

Con los pasos 3 y 4 del caso guía de `PLAN.md`: cada faltante y cada sobrante queda guardado como corrección del dueño, y en una sesión nueva la misma pregunta acierta todos.

## Diseño

### Automático

Lo que viene de ti es un hecho, y entra directo a la memoria. En los evals, cada faltante se guarda como "sí pertenece" y cada sobrante como "no pertenece", con origen `dueno`. Lo mismo, hecho desde el chat, es la etapa 7.

### Con tu aprobación

Lo que propone un modelo no entra solo. Si el evaluador sugiere cambiar las instrucciones del clasificador, el cambio corre contra todos los evals, y solo se activa si mejora sin romper nada y tú lo apruebas.

### Una advertencia sobre la medición

Si el sistema aprende la lista de chicles, volver a preguntar por chicles ya no mide qué tan bueno es: mide que la memoria funciona. Por eso solo se aprende de los casos de tipo `aprendizaje`; a los de tipo `reserva` nunca se les corrige. Los dos tipos están descritos en `plan/etapa-3-evals.md`.

## Avance

Sin encargos enviados. Depende de la etapa 4.
