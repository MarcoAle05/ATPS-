# Etapa 0: chatbot de consulta

Estado: se anota en la tabla «Etapas del asistente» de `CLAUDE.md`, no aquí.

## Qué entrega

Un chat para el administrador que responde preguntas sobre el inventario con datos reales de D1: servidor, interfaz y documentación.

## Cómo se verifica

Pruebas con DeepSeek real y medición de CPU ya publicado.

## Piezas

| Pieza | Resultado |
|---|---|
| Servidor del asistente (`POST /api/asistente`, LangChain, dos herramientas de consulta) | Hecho, commit `a9285ac`. |
| Interfaz (botón en el encabezado y diálogo de chat) | Hecha, commit `6552ea5`. |
| Documentación (`CLAUDE.md`, `MEMORY.md`, reglas) | Hecha, commit `d7adcf8`. |
| Prueba contra DeepSeek real (2026-11-11) | Pasó: modelo `deepseek-flash` confirmado, cifras iguales a las de la base, declina lo ajeno y los cambios al inventario. Unos 2 600 tokens por mensaje con una consulta. |
| Publicación | Hecha el 2026-11-11: secreto `DEEPSEEK_API_KEY` creado y Worker publicado, con arranque de 54 ms. |

El diseño tal como quedó está en el apartado «Asistente» de `CLAUDE.md`, y las cifras medidas en `MEMORY.md`.

## Pendiente

La etapa está fusionada y publicada, pero quedaron dos cosas sin cerrar:

- **Medición de CPU en producción.** Incompleta. Hay un solo dato, del 2026-11-11: la primera pregunta tras publicar gastó 46 ms de CPU y Cloudflare la dejó terminar. Los inicios de sesión gastan de 20 a 33 ms. Falta medir varias preguntas seguidas y una de respuesta larga, grabando antes los registros con `npx wrangler tail inventario`.
- **Sin verificar.** Teclado virtual y área segura de iOS, lectores de pantalla reales, Safari y Firefox, y los errores 401 y 402 con DeepSeek real.

## Avance

- 2026-11-10 · Servidor e interfaz implementados y revisados.
- 2026-11-11 · Prueba con DeepSeek real, fusión a `main` y publicación.
