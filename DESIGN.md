---
name: Lector de códigos de barras
description: Cuaderno de inventario sereno y silencioso, pensado para usarse de pie con el celular.
colors:
  fondo: "oklch(0.975 0.004 255)"
  superficie: "oklch(1 0 0)"
  superficie-hundida: "oklch(0.965 0.005 255)"
  texto: "oklch(0.23 0.015 260)"
  texto-suave: "oklch(0.5 0.015 260)"
  borde-suave: "oklch(0.92 0.006 260)"
  borde-control: "oklch(0.66 0.01 260)"
  acento: "oklch(0.53 0.19 262)"
  acento-hover: "oklch(0.48 0.18 262)"
  acento-texto: "oklch(0.5 0.19 262)"
  acento-suave: "oklch(0.955 0.018 262)"
  sobre-solido: "oklch(1 0 0)"
  exito-texto: "oklch(0.46 0.12 152)"
  exito-suave: "oklch(0.955 0.04 152)"
  exito-brillante: "oklch(0.78 0.17 152)"
  peligro-texto: "oklch(0.52 0.19 27)"
  peligro-solido: "oklch(0.55 0.2 27)"
  peligro-suave: "oklch(0.96 0.018 27)"
  visor: "oklch(0.2 0.01 260)"
  visor-texto: "oklch(0.8 0.01 260)"
  laser: "oklch(0.72 0.16 262)"
typography:
  titulo:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 650
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  encabezado:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 650
    lineHeight: 1.5
  producto:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 650
    lineHeight: 1.3
  cifra:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 700
    lineHeight: 1.1
    fontFeature: "'tnum'"
  cuerpo:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  etiqueta:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.5
  nota:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.5
  codigo:
    fontFamily: "ui-monospace, 'SF Mono', 'Cascadia Code', 'JetBrains Mono', monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "'tnum'"
rounded:
  barra: "2px"
  pestana: "8px"
  control: "10px"
  visor: "12px"
  marca: "14px"
  panel: "16px"
  pastilla: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  xxl: "24px"
  amplio: "32px"
components:
  panel:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.texto}"
    rounded: "{rounded.panel}"
    padding: "20px"
  boton:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.texto}"
    typography: "{typography.etiqueta}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  boton-primario:
    backgroundColor: "{colors.acento}"
    textColor: "{colors.sobre-solido}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  boton-primario-hover:
    backgroundColor: "{colors.acento-hover}"
  boton-chico:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.texto}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "32px"
  campo:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.texto}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "42px"
  pastilla:
    backgroundColor: "{colors.superficie-hundida}"
    textColor: "{colors.texto-suave}"
    typography: "{typography.nota}"
    rounded: "{rounded.pastilla}"
    padding: "4px 12px"
  pastilla-exito:
    backgroundColor: "{colors.exito-suave}"
    textColor: "{colors.exito-texto}"
  pastilla-acento:
    backgroundColor: "{colors.acento-suave}"
    textColor: "{colors.acento-texto}"
  pastilla-peligro:
    backgroundColor: "{colors.peligro-suave}"
    textColor: "{colors.peligro-texto}"
  contador:
    backgroundColor: "{colors.superficie-hundida}"
    textColor: "{colors.texto}"
    rounded: "{rounded.visor}"
    padding: "12px 16px"
  pestana-activa:
    backgroundColor: "{colors.superficie}"
    textColor: "{colors.texto}"
    rounded: "{rounded.pestana}"
    height: "36px"
---

# Design System: Lector de códigos de barras

## Overview

**Creative North Star: "El cuaderno de inventario"**

El inventario se lee como un cuaderno bien llevado: hojas blancas sobre un escritorio gris azulado, texto oscuro y sereno, y un solo color que señala dónde actuar. Los componentes son refinados y silenciosos: casi no tienen sombra, la jerarquía la dan la tipografía y el espacio, y el movimiento apenas se nota. Nada compite con el escáner ni con el número que el dueño necesita ver.

La densidad es media. En escritorio, el escáner y el producto comparten fila (5 : 6) y el inventario ocupa todo el ancho debajo; en celular todo se apila y cada fila de la tabla se convierte en una tarjeta compacta. La interfaz sigue el tema del sistema (claro u oscuro) sin selector propio.

Se descarta explícitamente cualquier emoji o mascota: los iconos son siempre Lucide, de trazo `currentColor`.

**Key Characteristics:**
- Superficies planas con un borde de sombra casi invisible, no sombras de elevación.
- Un solo acento azul-violeta (matiz 262) para la acción principal, el foco y el estado seleccionado.
- Estados con tono propio (éxito, acento, peligro) siempre en pares texto/fondo suave.
- Cifras tabulares en todo lo que se compara: precio, cantidad, código.
- Movimiento corto, con las mismas curvas y duraciones en todo el producto.

## Colors

Paleta fría y apagada en OKLCH, nombrada por rol, con tema claro y tema oscuro. Los neutros llevan un matiz azul casi imperceptible (255–260) para que el papel no se vea gris muerto.

### Primary
- **Azul de tinta** (`oklch(0.53 0.19 262)`): relleno del botón principal, anillo de foco, `accent-color` y cursor de los campos. Se oscurece a `acento-hover` al pasar el puntero. Su versión legible como texto es **Azul de tinta para texto** (`acento-texto`), y su fondo discreto es **Azul de papel** (`acento-suave`), para filas resaltadas, avisos y la marca.

### Secondary
- **Verde de visto bueno** (`exito-texto` sobre `exito-suave`): estado en vivo, escaneo activo, requisitos cumplidos. **Verde brillante** (`exito-brillante`) se usa solo en el visor: esquinas y sello al capturar un código.

### Tertiary
- **Rojo de borrado** (`peligro-texto`, `peligro-solido`, `peligro-suave`): errores, campos inválidos y la acción de eliminar. El relleno sólido solo aparece mientras se mantiene presionado.

### Neutral
- **Escritorio** (`fondo`): fondo de la página.
- **Hoja** (`superficie`): paneles, botones y campos.
- **Hoja hundida** (`superficie-hundida`): contador, pastillas, pestañas, campos de solo lectura; todo lo que está "por debajo" de la hoja.
- **Tinta** (`texto`) y **Tinta suave** (`texto-suave`): texto principal y secundario.
- **Línea de cuaderno** (`borde-suave`): separadores de tabla, listas y secciones.
- **Borde de control** (`borde-control`): contorno de campos y selects; medido a ≥ 3:1.
- **Visor** (`visor`, `visor-texto`) y **Láser** (`laser`): el interior oscuro de la cámara, que no cambia con el tema claro, y la línea de barrido.

### Tema oscuro
Solo dentro de `@media (prefers-color-scheme: dark)`. El fondo baja a `oklch(0.16 0.01 260)` y las hojas a `oklch(0.205 0.012 260)`; el texto sube a `oklch(0.94 0.005 260)`. Los textos de acento, éxito y peligro se aclaran (luminosidad ≈ 0.76–0.8) y sus fondos suaves se oscurecen (≈ 0.27–0.28). El borde de sombra pasa a un anillo blanco translúcido de 1 px.

### Named Rules
**The One Voice Rule.** El azul de tinta marca la acción principal y el foco; no se usa como decoración. Los demás tonos solo aparecen para comunicar estado.

**The Role Token Rule.** Los colores se usan únicamente a través de los tokens de `:root` en `styles.css`, nombrados por rol. Un par texto/fondo nuevo se mide en ambos temas: texto ≥ 4.5:1, bordes de controles ≥ 3:1.

## Typography

**Fuente única:** pila del sistema (`system-ui`, `-apple-system`, `Segoe UI`, `Roboto`). **Mono:** `ui-monospace` para códigos de barras.

**Character:** neutra y nativa en cada plataforma; la personalidad viene del peso (650 en títulos, 600 en etiquetas) y no de una familia. Cuenta con `text-wrap: balance` en títulos y `pretty` en párrafos.

### Hierarchy
- **Título** (650, 1.375rem, -0.01em): nombre de la app en el encabezado y en la pantalla de acceso.
- **Encabezado de panel** (650, 1.0625rem): Escáner, Producto, Inventario, Usuarios.
- **Producto** (650, 1.25rem, 1.3): nombre del producto en la tarjeta; se parte con `overflow-wrap: anywhere`.
- **Cifra** (700, 2.5rem, 1.1, tabular): la cantidad en el contador.
- **Cuerpo** (400, 1rem, 1.5): texto corrido; los textos de estado y vacíos usan 0.9375rem y un máximo de 34ch.
- **Etiqueta** (600, 0.875rem): etiquetas de campo y botones chicos.
- **Nota** (600, 0.8125rem): pastillas, ayudas, encabezados de tabla, detalles de usuario.
- **Código** (mono 0.875rem, tabular): códigos de barras.

### Named Rules
**The Tabular Rule.** Todo número que se compara o cambia (precio, cantidad, contadores de caracteres) lleva `font-variant-numeric: tabular-nums` para que no salte al actualizarse.

## Layout

Contenedor de 1120 px centrado con 20 px de margen lateral. Una columna en celular; a partir de 860 px el contenido es una cuadrícula de dos columnas (5 fr / 6 fr) con el inventario y el panel de usuarios a todo el ancho. Ritmo en múltiplos de 4: 4, 8, 12, 16, 20, 24, 32.

La tabla del inventario se convierte, por debajo de 640 px, en tarjetas compactas con nombre y precio arriba, código debajo, y cantidad a la izquierda con acciones a la derecha en la misma fila; por debajo de 360 px la cantidad y las acciones pasan a líneas separadas. La pantalla de acceso es una sola columna de 440 px máximo, centrada.

## Elevation & Depth

Sistema plano con capas tonales: la profundidad la dan los contrastes entre **Escritorio**, **Hoja** y **Hoja hundida**, más un borde de sombra casi invisible. No hay sombras de elevación.

### Shadow Vocabulary
- **Borde de hoja** (`0 0 0 1px oklch(0 0 0 / 0.06), 0 1px 2px -1px oklch(0 0 0 / 0.06), 0 2px 4px 0 oklch(0 0 0 / 0.04)`): paneles, botones secundarios y pestaña activa. Sube a 0.08 / 0.08 / 0.06 al pasar el puntero.
- **Resplandor del láser** (`0 0 12px 2px` en el color del láser): única sombra "luminosa", dentro del visor.

### Named Rules
**The Flat-By-Default Rule.** Las superficies están planas en reposo. La sombra de borde solo se intensifica con el puntero, y el botón principal no lleva sombra.

## Shapes

Esquinas generosas pero contenidas, en una escala anidada: panel 16 px, visor y contador 12 px, controles 10 px, pestañas 8 px, marca 14 px; pastillas y avatar completamente redondos. El radio interior siempre es el exterior menos el relleno (pestañas: 12 − 4 = 8). Los paneles llevan un borde transparente de 1 px para que el modo de alto contraste lo dibuje.

## Components

### Buttons
- **Shape:** esquinas de 10 px, altura mínima de 40 px (chico: 32 px; cuadrado: 32 × 32).
- **Secundario (por defecto):** hoja blanca con borde de sombra, texto en tinta, peso 600.
- **Primario:** relleno azul de tinta, texto blanco, sin sombra; una sola acción principal por vista.
- **Hover:** solo con puntero fino (`@media (hover: hover) and (pointer: fine)`): el secundario intensifica su borde de sombra y el primario se oscurece.
- **Presionado:** `scale: 0.96` en 150 ms, solo sin preferencia de movimiento reducido.
- **Deshabilitado:** opacidad 0.45.
- **Con icono:** 14 px de relleno del lado del icono para que se vea centrado.

### Inputs / Fields
- **Style:** hoja blanca, borde de control de 1 px, esquinas de 10 px, 42 px de alto, 12 px de relleno.
- **Focus:** anillo de 2 px en azul de tinta con 2 px de separación (global en `:focus-visible`).
- **Error:** borde en rojo de borrado y mensaje bajo el campo; el error aparece después de tocar el campo, no antes.
- **Solo lectura / deshabilitado:** fondo hundido y borde suave.
- **Contraseña:** botón de ojo de 36 px dentro del campo, medidor de cuatro barras de 4 px y lista de requisitos que se pintan en verde al cumplirse.

### Panels / Cards
- **Corner Style:** 16 px.
- **Background:** hoja blanca con borde de sombra, 20 px de relleno (24 px en acceso).
- **Entrada:** aparecen escalonados cada 100 ms, 300 ms con opacidad, 12 px de desplazamiento y 4 px de desenfoque.

### Pastillas, chips e insignias
Formas redondas de fondo hundido y texto suave; con `data-tono` cambian a éxito, acento o peligro. Las pastillas llevan icono de 16 px; las insignias de rol son más pequeñas (0.75rem).

### Navigation
No hay barra lateral ni menú. El encabezado lleva la marca (icono sobre fondo azul de papel, 48 px) y la cuenta (avatar de 36 px con iniciales, nombre, insignia de rol y botón de salir). La pantalla de acceso usa un control segmentado de dos pestañas (Iniciar sesión / Crear cuenta) sobre fondo hundido; la activa es una hoja con borde de sombra.

### Visor del escáner (componente distintivo)
Rectángulo 4 : 3 oscuro de 12 px de radio, con estados `apagado`, `iniciando`, `escaneando`, `capturado` y `error`. Mientras escanea, un marco de cuatro esquinas de 28 px y una línea láser barren el área; al leer un código el marco se cierra a 0.96, las esquinas pasan a verde brillante y aparece un sello circular con una marca. Es la única zona que usa colores brillantes y brillo.

### Mantener para eliminar (componente distintivo)
Botón de texto rojo que se rellena de izquierda a derecha en 2 s mientras se mantiene presionado (relleno rojo sólido, texto blanco) y regresa en 200 ms al soltar. Sustituye a los cuadros de confirmación.

### Contador de cantidad
Franja hundida de 12 px de radio con la etiqueta a la izquierda y la cifra de 2.5rem a la derecha; el número rueda al cambiar.

## Do's and Don'ts

### Do:
- **Do** usar solo tokens de color de `:root`, en OKLCH y por rol; mide el contraste en ambos temas.
- **Do** mantener el movimiento con valores fijos: entrar 300 ms con `--ease-out`, salir 150 ms, presionar `scale: 0.96` en 150 ms, cambio de icono de 0.25 a 1 en 300 ms con `--ease-icono`.
- **Do** poner movimiento, escala y desenfoque solo dentro de `@media (prefers-reduced-motion: no-preference)`; con movimiento reducido queda solo la opacidad.
- **Do** poner `:hover` solo dentro de `@media (hover: hover) and (pointer: fine)`.
- **Do** usar iconos del sprite Lucide con trazo `currentColor`.
- **Do** dejar sin animación lo que se repite muchas veces seguidas (−/+, escribir, cambiar de pestaña); como mucho, un cambio de color de 150 ms.
- **Do** hacer las acciones destructivas con mantener presionado 2 s.

### Don't:
- **Don't** usar emojis ni mascotas en la interfaz.
- **Don't** usar `transition: all`.
- **Don't** usar `<script>` ni `<style>` en línea, ni atributos `style=` (la CSP lo bloquea).
- **Don't** insertar datos del usuario con `innerHTML`; usa `textContent` o `append`.
- **Don't** usar `confirm()` para eliminar.
- **Don't** usar el azul de tinta como decoración ni agregar sombras de elevación a las hojas.
- **Don't** reconstruir la tabla del inventario completa: se reutilizan las filas para no perder el foco.
- **Don't** mostrar el error de un campo cuando el foco sale hacia el botón de enviar: movería el botón y se perdería el clic.
