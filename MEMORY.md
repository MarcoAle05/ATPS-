# MEMORY.md

Decisiones tomadas con el usuario y datos que no se deducen del código. Agrega lo nuevo con fecha; no reescribas el historial.

## Publicación

- App: https://inventario.lector-barras.workers.dev (Worker `inventario`).
- Subdominio de la cuenta: `lector-barras`, neutro a propósito para no exponer el correo del dueño en la URL.
- Base D1 `lector-inventario` (región WNAM) y Durable Object `Difusor` (migración `v1`).
- Secretos del Worker: `PIMIENTA` y `CODIGO_CONFIGURACION`. El código de configuración ya se usó: la cuenta de administrador del dueño existe desde el 2026-10-16.
- No se pudo consultar la suscripción de Cloudflare; se asume el plan gratuito de Workers (10 ms de CPU por petición).

## Decisiones

- **2026-10-14 · Nombre de producto.** El usuario pidió "solo texto, sin emojis ni caracteres especiales". Se permiten letras, dígitos y espacios: los dígitos se aceptaron como texto normal ("Leche 1 litro").
- **2026-10-14 · Cantidad.** Empieza en 0 al registrar un producto. Escanear un código ya registrado suma 1.
- **2026-10-14 · Precio.** Se guarda en centavos enteros para evitar errores de redondeo.
- **2026-10-14 · Autollenado.** El nombre se busca en Open Food Facts, luego Open Beauty Facts y luego Open Products Facts. Muchos productos mexicanos no aparecen; entonces se escribe a mano.
- **2026-10-14 · Eliminar.** Se hace manteniendo presionado 2 s (reemplazó a `confirm()`).
- **2026-10-15 · Base de datos.** Todo en Cloudflare: D1 en lugar de Supabase.
- **2026-10-15 · Acceso.** Inicio de sesión propio, no Cloudflare Access.
  - Quien se registra queda en solo lectura y el dueño lo autoriza.
  - Las cuentas de solo lectura pueden escanear para consultar un producto, sin sumar.
- **2026-10-15 · Cifrado de contraseñas.** PBKDF2 se quedó en 100 000 iteraciones aunque en producción usa unos 20 ms de CPU; Cloudflare lo tolera de forma ocasional. Si aparecen errores 1102 ("Worker exceeded resource limits"), hay dos salidas:
  - bajar las iteraciones, volviendo a cifrar cada contraseña cuando su dueño inicie sesión;
  - pasar al plan Workers Paid.
- **2026-10-16 · Tiempo real.** El aviso lleva solo el código del producto y cada página vuelve a pedirlo, en vez de enviar el producto completo. Así los cambios simultáneos no dejan valores viejos; se probó con 10 escaneos simultáneos.
- **2026-10-18 · Pulido con impeccable.** El detector marca tres cosas que son intencionales y se mantienen:
  - las esquinas del visor (las toma por bordes laterales);
  - el brillo de la línea láser;
  - el video que llena el visor de borde a borde.

## Historial

- 2026-10-14 · Primera versión: Express con SQLite local. `data/productos.db` queda como respaldo y ya no se usa.
- 2026-10-14 · Animaciones y diseño con las skills de Emil Kowalski y Jakub Krehel.
- 2026-10-15 · Migración a Workers + D1, con cuentas y roles. Los productos del usuario se copiaron a D1.
- 2026-10-16 · Actualización en tiempo real con Durable Objects.
- 2026-10-18 · Pase de pulido con la skill impeccable.
- 2026-10-19 · Se instaló `@playwright/test` como dependencia de desarrollo y Chromium (fuera del proyecto, en la caché de Playwright) para probar la interfaz en un navegador. Aún no hay pruebas escritas ni configuración. Arch Linux no está soportado oficialmente; usa la compilación de ubuntu24.04 y arrancó bien.

## Pendiente

- ~~No existe `PRODUCT.md`~~ Creado el 2026-10-18 con `/impeccable init`. `DESIGN.md` (con `.impeccable/design.json`) creado el mismo día con `/impeccable document`: Estrella polar "El cuaderno de inventario", componentes "refinados y silenciosos", anti-referencia: emojis y mascotas.
- No hay pruebas automatizadas en el repositorio. Las verificaciones se hicieron con scripts que están fuera del proyecto.
