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
- Los talleres de prueba que cree el registro (Fase 2) llevan el prefijo `veritech_pruebas_` y la dirección `<nombre>.pruebas.veritech.lat`. El usuario de base de datos tiene permiso sobre `veritech_pruebas_%` (concedido 2026-11-11) y sobre nada más.

## Despliegue automático (desde 2026-11-11)
Cada push a `master` corre las pruebas y, si pasan, `desplegar-pruebas` (en `.github/workflows/ci.yml`) arma el paquete y lo envía por SSH.
- La llave de GitHub Actions (secretos `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `DEPLOY_HOST`, `DEPLOY_PORT`) está en `/root/.ssh/authorized_keys` con `restrict,command=...`: solo puede ejecutar `/root/scripts/veritech-nuevo-pruebas-deploy.sh`. Una copia versionada de ese guion está en `scripts/servidor/` (editarla NO cambia la del servidor: hay que subirla por scp).
- Respaldo del `authorized_keys` previo: `/root/.ssh/authorized_keys.bak_antes_veritech_nuevo_20261111`.
- Pendiente: agregar el sitio a la verificación semanal de aprovisionamiento del servidor.

## Registro y cobro en el sitio de pruebas (Fase 2)
Variables del `.env` del servidor (`/home/veritech/pruebas/backend/.env`, permisos 600):
| Variable | Valor en pruebas |
|---|---|
| `PREFIJO_BD_TALLER` | `veritech_pruebas_` |
| `DOMINIO_TALLERES` | `pruebas.veritech.lat` (agregada 2026-11-11) |
| `PAYPAL_MODO` | `sandbox` (por defecto) |
| `PAYPAL_CLIENT_ID`, `PAYPAL_SECRETO` | **pendientes**: aplicación de PayPal en modo de pruebas. Sin ellas el cobro está apagado: el registro lo avisa y no deja continuar |
| `PAYPAL_WEBHOOK_ID` | opcional; sin él los avisos de PayPal se rechazan y solo manda la conciliación cada 3 horas |
| `BORRADO_AUTOMATICO` | `false` (por defecto): al cerrar un taller su base se conserva |
| `SMTP_*` | pendientes: sin ellos los correos quedan en la cola `correos_salida` |

Para tener planes de PayPal de pruebas (30 días gratis + cobro mensual) una vez puestas las credenciales:
```bash
cd /home/veritech/pruebas/backend && sudo -u veritech npm run planes:paypal-pruebas
```
Los talleres nuevos no se pueden abrir en el navegador hasta que exista su dirección (DNS + Apache + certificado): ver la decisión pendiente en `ANALISIS/20_FASE2_ALTA_Y_COBRO.md`.
