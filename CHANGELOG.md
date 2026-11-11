# Registro de cambios — VERI-TECH

Formato `MAYOR.NNN` (estándar GUATECH §1). Cada cambio visible para el cliente sube el contador en 1.

## 4.000 — en construcción (2026-11-11)
- Fase 0 (cimientos): repositorio, backend TypeScript estricto, aplicador de migraciones con bloqueo y control de cambios,
  conexión a las bases en UTC, validación de configuración, normalización de texto (mayúsculas sin tildes), fechas razonables,
  `/health` con versión, frontend base con el kit `ui-guatech`, integración continua con MariaDB 10.11.
- Sitio de pruebas `https://pruebas.veritech.lat` en el servidor (subdominio, base de datos y usuario limitados, Apache con proxy y caché, proceso pm2 propio) y guion de despliegue `scripts/desplegar-pruebas.sh`.
- Tipografía Montserrat en el frontend.
- Despliegue automático al sitio de pruebas en cada push a `master`, solo si las pruebas pasan (llave SSH restringida con comando forzado).
