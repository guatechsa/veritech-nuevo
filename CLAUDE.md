# VERI-TECH 4.000 — Guía para Claude Code

Reescritura completa de VERI-TECH. **Versión actual: 4.000** (en construcción). El sistema anterior (3.NNN) vive en `C:\GUATECH\veritech` y NO se toca hasta la Fase 9.

## Antes de escribir código
1. Leer `ANALISIS/18_DISENO_BASE_DE_DATOS.md` (tablas aprobadas por Luis), `ANALISIS/19_PLAN_DE_CONSTRUCCION.md` (fases) y `ANALISIS/17_ESTANDARES_QUE_OBLIGAN.md` (estándares GUATECH que se cumplen desde el primer commit).
2. Las decisiones de cada módulo están en `ANALISIS/05`–`16`. Si algo no está decidido, se pregunta a Luis; no se inventa.
3. Luis pide **"usted"**, palabras cotidianas y sin jerga al explicar. Lo que lleva cada trabajo es el **precio**; "costo" es lo que le cuesta al taller (interno).

## Reglas de código
- TypeScript estricto, sin `any`. Validación con Zod en toda entrada. Transacciones en operaciones de varios pasos.
- **Estructura de las bases SOLO por migraciones** `database/{plataforma,taller}/NNNN_descripcion.sql` (una aplicada no se edita: se agrega otra). Nunca preguntar "¿existe la columna?" en tiempo de ejecución.
- **Todo en UTC**; la zona del taller es configuración. Las pruebas corren con `TZ=America/Guatemala` a propósito.
- Nombres en español (`created_at`/`updated_at` por estándar). Estados y tipos por código estable con banderas; nunca por el texto.
- Texto libre guardado en MAYÚSCULAS sin tildes (excepto correo) también en el servidor (`utils/texto.ts`).
- Fechas: se muestran `DD/MM/YYYY` con el kit; intercambio ISO. Fechas imposibles se rechazan (`utils/fechas.ts`).
- Toda tabla nueva con datos del taller se agrega a la descarga (`backend/src/taller/datos/exportar.ts`) o, si no debe salir, a `TABLAS_NO_EXPORTADAS` con su motivo: una prueba lo exige. Lo mismo para cargas masivas nuevas (`datos/importar.ts`).
- Numeración con tabla `secuencias` (nunca `MAX()+1`). Archivos registrados en `archivos`.
- Versión: se escribe en `backend/src/version.ts` y `frontend/src/version.ts` (`4.000`) y en los `package.json` como `4.0.0` (4.012 → `4.12.0`) y `CHANGELOG.md`.
- El kit `ui-guatech` se copia desde `C:\GUATECH\GUATECH\ui-kit`; nunca se edita la copia.

## Pruebas
- `cd backend && npm test` (necesita `backend/.env.test` con usuario MySQL limitado a `vtn_%`; las pruebas crean/borran `vtn_test_*`). Todo cambio de regla importante lleva su prueba.
- `cd frontend && npm test` (fechas, estándar §18).
- Una prueba que nunca falló no demuestra nada: ante una regla crítica, comprobar que falla al quitar la protección (como se hizo con la zona horaria).

## Despliegue
- Integración continua en `.github/workflows/ci.yml` (MariaDB 10.11). El despliegue se agrega con el sitio de pruebas.
- Apache sirve la SPA y solo proxya `/api` (estándar §15); `index.html` sin caché (§14).
