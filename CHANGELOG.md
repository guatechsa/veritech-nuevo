# Registro de cambios — VERI-TECH

Formato `MAYOR.NNN` (estándar GUATECH §1). Cada cambio visible para el cliente sube el contador en 1.

## 4.000 — en construcción (2026-11-11)
- Fase 0 (cimientos): repositorio, backend TypeScript estricto, aplicador de migraciones con bloqueo y control de cambios,
  conexión a las bases en UTC, validación de configuración, normalización de texto (mayúsculas sin tildes), fechas razonables,
  `/health` con versión, frontend base con el kit `ui-guatech`, integración continua con MariaDB 10.11.
- Sitio de pruebas `https://pruebas.veritech.lat` en el servidor (subdominio, base de datos y usuario limitados, Apache con proxy y caché, proceso pm2 propio) y guion de despliegue `scripts/desplegar-pruebas.sh`.
- Tipografía Montserrat en el frontend.
- Despliegue automático al sitio de pruebas en cada push a `master`, solo si las pruebas pasan (llave SSH restringida con comando forzado).
- Fase 1 (plataforma): panel de administración de GUATECH en `/admin` con las 4 secciones del estándar (Dashboard con 5 indicadores, Empresas con pestaña Planes y módulos, Usuarios de Plataforma, Audit Logs).
  - Acceso: ingreso con respuesta idéntica para correo desconocido o clave errónea, límite de intentos, recuperación de contraseña (enlace de 30 minutos y un solo uso), política de contraseña, Turnstile opcional.
  - Tres roles de plataforma (super administrador, administrador, solo lectura) aplicados en el servidor; no se puede desactivar a sí mismo ni dejar la plataforma sin un super administrador activo.
  - Empresas con 8 estados, planes (Básico 30, Profesional 60, Empresarial 120 USD) con límites y módulos editables, auditoría de cada acción y lógica del token "Entrar" de soporte (60 s, un solo uso; el botón llega en la Fase 3).
  - Cola de correos con reintentos (el envío real queda a la espera de configurar SMTP).
  - Verificado en navegador real (escritorio y ancho de teléfono sin desbordes). 
- Fase 2 (alta y cobro), parte 1 — backend:
  - Registro en dos pasos con pase de 48 h (solo se guarda su huella), nombre en la dirección apartado mientras el registro está vigente, lista de nombres reservados y comprobación contra PayPal de que la suscripción es de ese plan y de ese registro.
  - Creación automática del taller: base propia con su estructura inicial, administrador, rol, sucursal principal, módulos del plan y directorio de accesos. Se puede repetir sin duplicar nada; un fallo se reanuda y, tras 5 intentos, avisa a GUATECH.
  - Cobro con PayPal: prueba de 30 días, cobro mensual, cancelación (el servicio sigue hasta el final del período pagado), gracia de 7 días con correos los días 0, 3 y 6, suspensión y reactivación automáticas, 30 días de solo exportar y cierre. Conciliación cada 3 horas; el aviso de PayPal se guarda primero, se verifica su firma (nunca falla abierta) y solo acelera.
  - Correos del ciclo de vida en "usted" (bienvenida solo cuando el subdominio responde, prueba por terminar, pago recibido, pago fallido, suspensión, reactivación, cancelación, exportar, borrado próximo, cierre), cada uno una sola vez.
  - "Entrar" por correo: un correo, varios talleres, siempre la misma respuesta.
  - Panel: ficha de empresa con pagos y eventos, "Conciliar ahora" y "Reintentar alta"; suspender exige motivo y una suspensión manual no se levanta sola.
  - Un cuerpo que no es JSON válido ahora responde 400 (antes 500).
  - Borrado automático de la base de un taller cerrado: construido pero apagado (`BORRADO_AUTOMATICO=false`).
