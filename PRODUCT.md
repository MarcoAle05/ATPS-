# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Dueño de un negocio pequeño que lleva el inventario él mismo, de pie en el local, escaneando productos con la cámara del celular. Puede dar acceso a otras personas: quien se registra queda en solo lectura hasta que el dueño la autoriza como editora. Hay una sola cuenta de administrador, la del dueño.

## Product Purpose

Registrar y consultar el inventario escaneando códigos de barras desde el navegador, sin instalar nada. Escanear un producto nuevo lo registra con cantidad 0; escanear uno ya registrado suma 1. El éxito es que el dueño tenga el inventario al día con el mínimo de pasos por producto.

## Positioning

Los cambios se ven en tiempo real: cada cambio de producto o de cuenta aparece al instante en todas las pantallas abiertas, y los cambios simultáneos no dejan valores viejos.

## Operating Context

- Se usa en el local, con el celular en la mano; el lector de la cámara corre en el navegador (ZXing).
- Si la cámara no lee o no existe, el código se escribe a mano.
- El nombre del producto se autollena desde Open Food Facts, Open Beauty Facts y Open Products Facts; muchos productos mexicanos no aparecen y el nombre se escribe a mano.
- Publicado en Cloudflare (Workers, D1 y Durable Objects).

## Capabilities and Constraints

- Roles: `lector` (solo ver; puede escanear para consultar sin sumar), `editor` (autorizado por el administrador) y `admin` (único).
- El registro normal está cerrado hasta que se crea la cuenta de administrador.
- Nombre de producto: solo letras, dígitos y espacios, sin emojis ni signos. Precio guardado en centavos, de $0.00 a $10,000.00. Eliminar un producto exige mantener presionado 2 segundos.
- Solo el plan gratuito de Cloudflare: 10 ms de CPU por petición, así que el trabajo en el servidor debe mantenerse mínimo.
- Todo el producto está en español: interfaz, mensajes de error y código.
- Sin decidir: moneda y mercado más allá de lo que ya muestra la interfaz, y cualquier idioma adicional.

## Brand Commitments

Ninguno declarado. El nombre visible es "Lector de códigos de barras". La URL pública usa un subdominio neutro a propósito, para no exponer el correo del dueño.

## Evidence on Hand

- Inventario real del dueño, copiado a D1 desde la primera versión (`data/productos.db` queda como respaldo sin uso).
- No hay pruebas automatizadas, testimonios, clientes ni métricas de uso. No inventarlos.

## Product Principles

1. Lo más frecuente es lo más rápido: escanear y sumar no debe pedir pasos extra.
2. El dueño decide quién edita; la interfaz refleja los permisos, pero el servidor es quien los impone.
3. Nunca mostrar un valor viejo: ante un cambio simultáneo, la pantalla vuelve a pedir el dato.
4. Los errores dicen qué pasó y cómo seguir, en español.
5. Cabe en el plan gratuito: no se agrega trabajo de CPU a las rutas de cuentas.

## Accessibility & Inclusion

Sin requisito formal declarado. El proyecto ya exige contraste de 4.5:1 en texto y 3:1 en bordes de controles, y respeta `prefers-reduced-motion`.
