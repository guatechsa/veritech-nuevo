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
