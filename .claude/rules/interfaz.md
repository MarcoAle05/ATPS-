---
paths:
  - "public/**/*.{js,html,css}"
---

# Reglas de la interfaz (`public/`)

- `public/vendor/` lo genera `npm run preparar`; no lo edites.
- CSP estricta (`public/_headers`): nada de `<script>` ni `<style>` en línea ni atributos `style=`. Usa clases, `elemento.style` o `elemento.animate()`.
- Datos del usuario en el DOM siempre con `textContent` o `append`, nunca con `innerHTML`.
- Colores solo con los tokens de `:root` en `styles.css` (OKLCH, nombrados por rol). El tema oscuro va solo en `@media (prefers-color-scheme: dark)`. Al agregar un par texto/fondo, mide el contraste en ambos temas: ≥ 4.5:1 para texto y ≥ 3:1 para bordes de controles.
- Iconos del sprite Lucide de `index.html` (`<use href="#i-nombre">`, o `icono()` de `comun.js`), con trazo `currentColor`.
- Movimiento con valores fijos:
  - Entrar: 300 ms con `--ease-out`, opacidad + 12 px + desenfoque de 4 px.
  - Salir: 150 ms.
  - Presionar: `scale: 0.96` en 150 ms.
  - Cambiar de icono: escala de 0.25 a 1 en 300 ms con `--ease-icono`.
- Accesibilidad del movimiento:
  - Movimiento, escala y desenfoque solo dentro de `@media (prefers-reduced-motion: no-preference)`; con movimiento reducido queda solo la opacidad.
  - `:hover` solo dentro de `@media (hover: hover) and (pointer: fine)`.
  - Nunca `transition: all`.
  - Lo que se usa muchas veces seguidas (−/+, escribir, cambiar de pestaña) va sin animación; como mucho, un cambio de color de 150 ms.
- Acciones destructivas con `crearBotonSostener` de `comun.js` (mantener presionado 2 s), no con `confirm()`.
- Formularios: el error de un campo aparece después de tocarlo. Si el foco sale del campo hacia el botón de enviar, no lo muestres en ese momento: movería el botón y el clic se perdería.
- La interfaz según el rol usa `estado.puedeEditar` en `app.js` y `data-rol` en `#app`, pero quien decide los permisos es el servidor.
- Las filas del inventario se reutilizan (`filasPorCodigo`) para no perder el foco; no reconstruyas la tabla entera.
