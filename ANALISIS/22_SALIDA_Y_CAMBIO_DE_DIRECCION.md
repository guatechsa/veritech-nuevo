# 22 — Salida: pasar de VERI-TECH 3.xxx a 4.000 (guion para Luis)

Este guion es para el día de la salida. **Nada de esto se ha ejecutado en producción**: lo único que se tocó del sistema viejo fue leerlo (conteos y copias de seguridad). Cada paso dice quién lo hace y qué se comprueba antes de seguir.

## 0. Qué ya está hecho y verificado

| Pieza | Estado |
|---|---|
| Respaldo verificado de `enova`, `cafe`, `waga` y la plataforma vieja | Hecho el 13/11/2026: `/home/veritech/backups/fase9_20261113/` en el servidor y copia en `C:\GUATECH\RESPALDOS_VERITECH_VIEJO\fase9_20261113\` (suma de comprobación revisada; en cada base, las filas del respaldo son iguales a las de la base). |
| Traslado de `enova` | Programa listo y probado (`backend/src/herramientas/migracion-enova.ts`). Ensayado con los datos reales en una base de prueba de esta computadora: todas las cifras de control coinciden. **No se ha corrido contra el taller definitivo.** |
| Talleres de cortesía y de demostración (sin PayPal) | Listo y probado (`crear-taller-especial`). Quedan «activos», sin cobro, y el ciclo de vida no los suspende ni les manda avisos de pago. |
| Seguridad de la página | Sondeo `scripts/seguridad/sondeo.js`: 53 comprobaciones. La página no traía HSTS ni política de contenido: ya están en `scripts/servidor/htaccess-spa.conf` y puestas en el sitio de pruebas (comprobado en navegador: entrada, registro con PayPal y pantallas internas sin errores). |
| Carga | Prueba `CARGA=1 npx jest tests/carga`: taller con 40.000 órdenes, 6.000 equipos y 3.000 materiales. Todas las pantallas bajo 1,5 s; con 10 personas a la vez, bajo 3,3 s. Se encontró y corrigió que el listado de órdenes tardaba 1,2 s (ahora 0,05 s). La búsqueda por texto en órdenes tarda 1,3 s con 40.000 órdenes (sirve; si crece, hay que indexarla). |

## 1. Lo que usted debe decidir antes (nada de esto lo decidí yo)

1. **Dirección definitiva.** Hoy el sistema nuevo vive en `pruebas.veritech.lat/t/<taller>`. Para producción hay tres caminos: (a) `app.veritech.lat/t/<taller>` (un solo nombre, un solo certificado, el más simple); (b) un subdominio por taller `<taller>.veritech.lat` (exige DNS «comodín» `*.veritech.lat` y certificado comodín); (c) quedarse con `veritech.lat`. Recomiendo (a). La app móvil y los enlaces de correo se arman con esa dirección.
2. **Correo (SMTP).** Sin él no salen avisos, invitaciones ni recuperación de contraseña. Necesito el servidor de correo y la casilla remitente (hoy `noreply@guatech.lat`).
3. **PayPal en vivo.** Los planes en vivo ya existen (13 productos); el sistema nuevo concilia por consulta cada 3 horas (el tope de 10 webhooks). Falta cambiar las credenciales a «live» en el servidor.
4. **`cafe` y `waga`.** Usted dijo que no son clientes y se pueden borrar «cuando el sistema nuevo esté listo, con respaldo». El respaldo ya existe. **Yo no los borro hasta que usted me lo pida con esas palabras.**
5. **`enova`.** Se crea como taller de cortesía (no paga). Hay que decidir quién es su administrador (el sistema viejo tiene a Hasso Tengelmann como administrador) y si se le avisa antes del cambio.
6. **Google Play.** La app vieja sigue en prueba cerrada (0 probadores). Opciones: 12 probadores durante 14 días, o distribución privada. Y el proyecto de Expo para los avisos al teléfono.

## 2. Pasos de la salida (en orden; no seguir si un paso falla)

**Paso 1 — Respaldo final.** Lo hago yo, el mismo día, justo antes de empezar:
`bash scripts/migracion/respaldar-talleres-viejos.sh` → debe terminar con «RESPALDO VERIFICADO». Si no, se detiene todo.

**Paso 2 — Crear el taller de `enova` en el sistema nuevo.** En el servidor del sistema nuevo:
`node dist/cli/crear-taller-especial.js --tipo cortesia --slug enova --nombre "ENOVA" --admin "<nombre del administrador>" --correo <su correo>`
Muestra una contraseña temporal una sola vez (yo no la repito en el chat; se la entrego a usted por el medio que prefiera).

**Paso 3 — Ensayo del traslado.** Con el token del administrador (se saca entrando al taller nuevo):
`node dist/cli/migrar-enova.js --datos <carpeta con los .tsv> --url <dirección de la API> --taller enova --simular`
Debe decir «ENSAYO (no se escribió nada)». Se revisa el informe con usted.

**Paso 4 — Traslado real** (el mismo comando sin `--simular`). Termina con el «CONTROL DE CIFRAS»: todas deben decir OK (1 cliente, 5 equipos, 4 materiales, 12 colaboradores, 1 orden abierta, medidores con su valor actual). Se puede repetir: no duplica nada.

**Paso 5 — Revisión con quien usa enova.** Que revise: clientes y sus 5 sedes, los 5 equipos y sus horas, la orden abierta (el valor del trabajo es el mismo Q800; el sistema nuevo suma el IVA), los 12 colaboradores y la matriz de qué nivel trabaja en qué sistema, y el checklist de revisión preoperacional (10 puntos).

**Paso 6 — Invitar a las personas.** Desde Configuración › Colaboradores › «Dar acceso» (envía el enlace para crear su contraseña; las contraseñas viejas no se pueden copiar). Requiere el correo (SMTP) funcionando.

**Paso 7 — Taller de demostración.** `crear-taller-especial.js --tipo demo --slug demo ...` y cargar sus datos de ejemplo. (La carga de datos de ejemplo todavía no está escrita: ver «Lo que falta».)

**Paso 8 — Cambio de dirección.** Según la decisión 1: crear el nombre en el DNS del servidor (recargar la zona con `pdns_control bind-reload-now` antes de abrirlo), el sitio en Apache con `scripts/servidor/htaccess-spa.conf`, el certificado (AutoSSL) y desplegar con el mismo guion de pruebas apuntando a la carpeta definitiva. Comprobar `/health`, ingresar, y correr `node scripts/seguridad/sondeo.js <dirección> <taller>` (debe dar 53 de 53).

**Paso 9 — Plan de vuelta atrás.** El sistema viejo NO se apaga ni se modifica en la salida: sigue donde está. Si algo sale mal, simplemente se deja de usar la dirección nueva y se sigue con la vieja; `enova` no pierde nada porque su base vieja no se tocó. El sistema viejo se retira recién después de que `enova` trabaje unos días en el nuevo y usted lo autorice.

**Paso 10 — Retiro.** Solo con su orden explícita: desactivar `cafe` y `waga` (primero «solo exportar», luego borrar) y, más adelante, el sistema viejo.

## 3. Lo que falta de la Fase 9 (y por qué)

- **Datos de ejemplo del taller de demostración**: el programa para cargarlos no está escrito todavía (el taller de demostración se crea vacío hoy).
- **Landing y registro al estándar** (`guatech-web`): está en otro repositorio y depende de la dirección definitiva (decisión 1).
- **Pruebas de seguridad más profundas**: lo hecho es un sondeo de lo visible desde afuera (cabeceras, archivos expuestos, rutas sin sesión, límites de intentos, inyecciones simples). No equivale a una auditoría externa; si el producto va a manejar clientes reales a escala, conviene contratar una.
- **App móvil**: sigue sin probarse en un teléfono (ver Fase 8).
