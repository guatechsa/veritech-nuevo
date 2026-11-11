# Sitio de pruebas — https://pruebas.veritech.lat

Creado el 2026-11-11 (Fase 0). Vive en el servidor `guatech-vps`, **cuenta cPanel `veritech`**, separado del sistema actual y de todos los talleres.

| Pieza | Valor |
|---|---|
| Dirección | `https://pruebas.veritech.lat` (certificado comodín `*.veritech.lat`, HTTP redirige a HTTPS) |
| Frontend | `/home/veritech/pruebas.veritech.lat/` (Apache sirve la SPA; `.htaccess` con el bloque de caché `GUATECH-CACHE-BLOCK-v1`) |
| Backend | `/home/veritech/pruebas/backend/` (`dist/`, `.env` con permisos 600) |
| Migraciones | `/home/veritech/pruebas/database/{plataforma,taller}/` |
| Proceso | pm2 `veritech-pruebas` (usuario `veritech`), puerto **4300** (solo local) |
| Proxy | `/etc/apache2/conf.d/userdata/ssl/2_4/veritech/pruebas.veritech.lat/api-proxy.conf`: `/api` y `/health` → `127.0.0.1:4300` (solo por HTTPS; por HTTP se redirige) |
| Base de datos | `veritech_pruebas_plataforma`, usuario limitado `veritech_pruebas` (solo esa base; la clave solo está en el `.env` del servidor) |
| Prefijo de talleres de prueba | `veritech_pruebas_` |
| Respaldo y reversa | `/root/backups/pruebas_veritech_20261111_105355/` (zona DNS original y `REVERSA.txt`) |

## Desplegar
```bash
bash scripts/desplegar-pruebas.sh
```
Corre las pruebas y la compilación del backend y del frontend; si algo falla, no sube nada. Luego sube, retira los archivos viejos de `assets`, instala dependencias, aplica las migraciones de la plataforma, reinicia el proceso y verifica en vivo que `/health` responde con la versión del código.

## Reglas
- No usa las credenciales de producción: su usuario de base de datos solo ve `veritech_pruebas_*`.
- No toca el proceso `veritech` (versión 3.x, puerto 4000) ni `api.veritech.lat`.
- Al crear talleres de prueba (Fase 2), el aprovisionador usará el prefijo `veritech_pruebas_` y subdominios de prueba aparte.

## Pendiente (cuando exista el repositorio en GitHub)
- Trabajo de despliegue automático en `.github/workflows/` con compuerta de pruebas (llave SSH restringida con comando forzado, como el sistema actual).
- Agregar el sitio a la verificación semanal de aprovisionamiento del servidor.
