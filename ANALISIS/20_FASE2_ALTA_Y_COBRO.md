# 20 — Fase 2: alta y cobro · decisiones de construcción (2026-11-11)

Luis aprobó empezar la Fase 2 ("Sí, empiece"). Esto fija **cómo** se construye; lo que Luis decidió antes (módulos 13 y 16) no cambia.

## Qué incluye
1. **Alta en dos pasos** con pase: (1) datos del taller + aceptación de términos → pase de 48 h; (2) PayPal aprobado → el taller se crea solo.
2. **Aprovisionamiento idempotente** de un taller: base propia, migraciones, administrador, módulos del plan. Si algo falla se REANUDA (no se deshace: el cliente ya pagó): cada paso comprueba si ya está hecho, tras 5 intentos el alta queda en error y GUATECH recibe una alerta, y soporte la reintenta desde el panel.
3. **Cobro por PayPal**: prueba de 30 días, cobro mensual, cancelación, gracia de 7 días, suspensión, reactivación, cierre con 30 días de solo-exportar y borrado.
4. **Conciliación cada 3 horas** como mecanismo principal (PayPal es la fuente de verdad); el aviso de PayPal (webhook) solo acelera: se guarda primero, se verifica la firma (falla cerrada) y se procesa consultando a PayPal.
5. **Correos del ciclo de vida** en "usted", con la marca VERI-TECH y datos escapados; cada correo sale una sola vez (clave única).
6. **"Entrar" por correo**: un correo, varios talleres; siempre la misma respuesta exista o no el correo.
7. **Pantallas**: registro público, "Entrar", y el panel de GUATECH con detalle de empresa (estado, pagos, eventos de suscripción, conciliar ahora, reintentar alta).

## Decisiones que toma el asistente (no cambian lo que Luis decidió)
- **Pase** = texto aleatorio que solo tiene el navegador que se registró; en la base solo queda su huella. El `custom_id` de la suscripción de PayPal es parte de esa huella: así se comprueba que la suscripción aprobada pertenece a ESE registro.
- **El subdominio y el correo se reservan solo mientras el registro está vigente** (emitido, aprobado o con error). Un taller cerrado libera su nombre (se renombra con el número de la empresa).
- **Subdominios reservados** (`api`, `admin`, `www`, nombres de productos…) en una tabla que el super administrador puede ampliar.
- **Un correo puede administrar varios talleres**: no hay unicidad de correo entre talleres; el directorio de accesos los relaciona.
- **PayPal se aísla detrás de una interfaz** (`ProveedorPagos`): la implementación real usa la API REST con tiempo máximo de 12 s por llamada; las pruebas automáticas usan una simulada. Los cobros reales NO se prueban aquí (los hace Luis, Fase 9).
- **El estado del taller sale de una sola función pura** (estado de PayPal + fechas → estado del taller) usada por la conciliación y por el aviso.
- **Borrado automático de la base de un taller cerrado**: construido y probado, pero **apagado por defecto** (`BORRADO_AUTOMATICO=false`) hasta que Luis lo active; solo borra bases con el prefijo de talleres y de empresas en `solo_exportar` con la fecha vencida.
- **Base de cada taller (migración 0001)**: solo lo que el alta necesita escribir (colaboradores, usuarios, roles sembrados, sucursales, áreas, niveles técnicos, configuración, numeración, bitácora). El resto del taller se agrega en la Fase 3 con migraciones nuevas.

## Lo que Luis debe aportar (no bloquea construir)
- Credenciales de la aplicación de PayPal **en modo de pruebas** (identificador y llave) y los planes de pruebas, para recorrer el alta completa en `pruebas.veritech.lat`.
- Cómo se abre el subdominio de cada taller nuevo (DNS + Apache + certificado). Recomendación: un comodín `*.veritech.lat` con un solo sitio que sirve la pantalla y reenvía `/api`; así un taller nuevo no requiere tocar el servidor.
