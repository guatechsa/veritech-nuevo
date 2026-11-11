# VERI-TECH 4.000

Reescritura de VERI-TECH (software de mantenimiento para talleres y flotas) de GUATECH S.A.

- **Diseño y decisiones:** `ANALISIS/` (módulos 1–16, estándares, diseño de la base de datos y plan de construcción).
- **Backend:** `backend/` (Node 22 + TypeScript estricto + Express 5 + MariaDB).
- **Frontend:** `frontend/` (React + Vite + Tailwind 3 + kit `ui-guatech`).
- **Estructura de las bases de datos:** `database/plataforma/` y `database/taller/` (migraciones `NNNN_descripcion.sql`).

## Arranque local
```bash
cd backend && npm install && cp .env.example .env   # completar BD_USUARIO / BD_CLAVE
npm run dev                                          # http://127.0.0.1:4100/health
cd ../frontend && npm install && npm run dev         # http://localhost:5180
```

## Pruebas
```bash
cd backend && npm test      # necesita backend/.env.test con un usuario MySQL limitado a bases vtn_%
cd frontend && npm test     # formato de fechas del estándar §18
```
Las pruebas de base de datos crean y borran bases `vtn_test_*`; nunca tocan las bases reales.
