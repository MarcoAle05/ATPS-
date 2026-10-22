---
paths:
  - "public/js/validacion.js"
  - "migrations/**/*.sql"
---

# Validación y esquema

- `validacion.js` corre en el navegador y en el Worker: módulo ES sin DOM, sin APIs de Node y sin dependencias.
- Cada validador devuelve `{ ok: true, valor }` o `{ ok: false, error }`, con el valor ya normalizado (NFC y espacios colapsados, correo en minúsculas, precio en centavos enteros, código sin espacios alrededor).
- Límites vigentes, acordados con el usuario:
  - Nombre de producto: 1–250 caracteres; solo letras, dígitos y espacios. Sin emojis ni signos. Los selectores de variación (U+FE0F…) cuentan como emoji.
  - Precio: número finito de 0 a 10 000 con máximo 2 decimales.
  - Cantidad: entero seguro ≥ 0, empieza en 0 al registrar.
  - Código: ASCII imprimible sin espacios, 1–64 caracteres.
  - Contraseña: 10–128 caracteres; letras con números o símbolos (o 16 caracteres o más); sin el nombre ni el correo (se compara sin acentos); no común.
- Si cambias un límite, cambia también su `CHECK` con una migración nueva, y al revés.
- Migraciones: nunca edites un archivo ya aplicado (`0001_inicial.sql` está aplicado en producción). Crea `000N_descripcion.sql`, con tablas `STRICT`. Aplícala primero con `npm run db:migrar:local` y luego con `npm run db:migrar`.
