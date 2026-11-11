# 17 — Estándares GUATECH que obligan al diseño nuevo · LEÍDOS COMPLETOS (2026-11-11)

Leídos completos: `GUATECH_STANDARDS.md` (21 secciones, 1.446 renglones) y los cinco estándares aparte: `SUPERADMIN_STANDARD.md`, `SUPPORT_ACCESS_STANDARD.md`, `PLATFORM_PASSWORD_RECOVERY_STANDARD.md`, `EMAIL_DESIGN_STANDARD.md` y `PLANES_Y_COBRO_STANDARD.md`. Aquí se anota qué le exige cada uno al producto nuevo, y los puntos donde una decisión tomada en esta revisión choca con un estándar.

## A. Lo que el diseño nuevo debe cumplir (resumen por estándar)

### GUATECH_STANDARDS.md
| § | Obliga a |
|---|---|
| 1 Versiones | Esquema `MAYOR.NNN`; cada cambio visible sube 1; **un salto de versión mayor lo decide Luis**. Se registra en 4 lugares (archivo `version` del frontend —no se lee de `package.json`—, los `package.json`, `/health`, la Ayuda) más `CHANGELOG.md`. La app móvil lleva su propia versión `MAYOR.NNN` visible y los campos nativos de cada tienda. |
| 2 Ayuda | Menú de Ayuda con Funciones básicas, Soporte (correo a `soporte@guatech.lat`), Versión, Política y privacidad, GUATECH S.A.; novedades desde el `CHANGELOG.md`. |
| 3 Legal | Texto único en guatech.lat; aceptación con casilla y **se guarda la versión legal aceptada**; Ayuda solo enlaza. |
| 4 Datos maestros | Clientes y Proveedores con los campos del estándar (`nombre, nit, contacto_nombre, contacto_email, contacto_telefono, telefono, email, direccion, condicion_pago, dias_credito, limite_credito, notas, activo, created_at, updated_at`); `departamentos` del cliente como subtabla opcional; entidad "equipo". API en español (`/api/usuarios`). |
| 5 Texto | Mayúsculas y sin tildes en todo texto libre **guardado así**, excepto el correo; guarda de contraseñas (WeakSet + `autocomplete` + `name/id`); trampa del `el.value =`. Saneamiento también en el servidor. |
| 6, 6.1 Listados | Encabezado gris `#A6A6A6`, orden asc/desc con ícono, barra de desplazamiento horizontal arriba (16 px). |
| 7 Formularios | Crear y editar son el mismo formulario (o crear mínimo y reabrir el de edición). |
| 8 Migraciones | **El despliegue debe copiar las migraciones** y el aprovisionamiento no puede tener lista escrita a mano; verificación semanal en el VPS (BD desechable + comparar `SHOW TABLES`). |
| 11 Kit `ui-guatech` | Modal, Button, Badge, AccionBoton, FechaInput, etc. se copian desde `ui-kit` con `sync-ui-kit.sh`; nunca se edita la copia. VERI-TECH usa TypeScript (trae `.d.ts`). |
| 13 Menú | Un solo nivel, **6 a 11 entradas**, máximo **dos filas de pestañas**; sin excepciones (también Configuración). |
| 14, 15 Servidor | Apache sirve la SPA; `index.html` sin caché y los assets con hash 1 año (`GUATECH-CACHE-BLOCK`); `ProxyPass` solo a `/api` (y `/uploads` si hace falta). |
| 16 Detalle de orden | Cabecera fija con cliente y equipo, **costo a la derecha**, estado como línea de progreso, pestañas (ejecución primero) con conteos, **acciones abajo**, alto fijo, pestaña activa sólida. |
| 17 Taller | Línea de orden independiente (técnico, estado propio, tiempos); **8 estados de línea** sin grafo (Pendiente, En proceso, Pausado, Detenido por material / trabajos terceros / autorización / espacio, Terminado); un técnico no tiene dos en proceso (409); **matriz técnico↔sistema con fila ausente = sin permiso** (se siembra permisiva si no hay política); **checklist ligado a la orden bloquea el cierre** (409 con cuántos faltan). |
| 18, 19 Fechas | `DD/MM/YYYY` (`DD/MM/YYYY HH:mm`), nunca `type="date"` ni `toLocale*`; intercambio ISO; componentes del kit; **fechas razonables** (año entre 1980 y hoy+30; nacimiento 1900) con middleware y reglas finas; prueba automática. |
| 20 Botones | Acción de fila = **la palabra** en azul centrada (Editar, Eliminar, Activar…), nunca íconos; "Eliminar" puede solo desactivar. |
| 21 Landing | Cintillo de confianza con 5 logos y selector Español/English; landing **generada** desde `guatech-web`. |

### SUPERADMIN_STANDARD.md (panel de plataforma)
Menú fijo de 4 entradas (Dashboard, Empresas, Usuarios de Plataforma, Audit Logs); Dashboard con **5 KPIs obligatorios** y el endpoint `GET /superadmin/stats` con el mismo JSON de siempre; **regla "—" nunca cero** si no hay dato; Empresas como tabla con columnas fijas (Empresa, Subdominio, Plan, Cuota, Admin, Módulos, Estado, Provisionado, Acciones) y **Entrar en la fila**; modal con plan, cuota, módulos habilitados, estado del admin, restablecer contraseña, reenviar bienvenida; roles de plataforma `PLATFORM_SUPER_ADMIN / ADMIN / VIEWER` **con cumplimiento real**; auditoría de toda acción administrativa (tabla `platform_audit_logs` con quién, qué, a quién, IP y navegador; si falla no rompe la acción).

### SUPPORT_ACCESS_STANDARD.md ("Entrar")
Token de un solo uso (32 bytes aleatorios) de **60 s** → sesión de **2 horas sin refresco**, con bandera de soporte en el token que **`/auth/me` debe propagar**; banner ámbar fijo "Sesión de soporte GUATECH" con **Salir**; el canje es ruta pública (y debe estar en la lista pública del cliente web); abre en pestaña nueva; se audita; se prueba en ventana de incógnito. (El código actual ya impide que una sesión de soporte cancele la suscripción.)

### PLATFORM_PASSWORD_RECOVERY_STANDARD.md
Token de un solo uso de **30 min** (guardado como huella), respuesta siempre genérica, al pedir uno nuevo se invalidan los anteriores; **política de contraseña: mínimo 10 caracteres con mayúscula, minúscula, número y símbolo**; mostrar/ocultar y lista de reglas en vivo; **cinco atributos** en todo campo de contraseña (`autoComplete="new-password"`, `autoCapitalize="off"`, `autoCorrect="off"`, `spellCheck="false"`, `textTransform:none`); remitente `"VERI-TECH" <correo>`; el hub tiene además acceso de emergencia por el servidor.

### EMAIL_DESIGN_STANDARD.md
Una sola plantilla (azul `#4997D0`, encabezado con el nombre del producto, cuerpo simple con listas, botón sólido, pie "GUATECH S.A. — Este es un correo automático, no lo respondas."); función `wrap()` única; remitente `"<PRODUCTO>-TECH" <correo>`; los tickets de soporte van en texto plano a `soporte@guatech.lat`.

### PLANES_Y_COBRO_STANDARD.md
Tres niveles **30 / 60 / 120 USD**; prueba de 30 días con PayPal aprobado desde el inicio; pago recurrente por PayPal; cancelar en cualquier momento con servicio hasta el fin del período pagado; pantalla Suscripción y pagos; `cobro_por_contrato` para quien no paga por PayPal; **tope de 10 webhooks** → conciliación por consulta cada 3 h; guardar fechas en UTC y comparar con `UTC_TIMESTAMP()`; una empresa sin nivel no tiene tope.

## B. Choques entre lo decidido en esta revisión y un estándar
| # | Decisión de esta revisión | Estándar | Cómo se resuelve (propuesta) |
|---|---|---|---|
| C1 | Módulo 16 (decisión 8): **quitar los logotipos de terceros** del cintillo; (decisión 7): **inglés con dirección propia `/en/`** | GUATECH §21: cintillo con 5 logos obligatorio en las 13 landings (decisión de Luis del 2026-11-01) y selector de idioma con un solo sitio (`?lang=en`) | **Requiere decisión de Luis.** Recomiendo **retirar mi recomendación** y seguir el estándar: el cintillo y el selector son suyos, de hace diez días, y la landing se genera desde `guatech-web`. Conservar la medición de visitas y de conversión. |
| C2 | Módulo 13 (decisión 4): correos del taller a sus clientes con **el nombre del taller como remitente** y respuestas al taller | EMAIL_DESIGN: remitente `"VERI-TECH" <correo>` y pie "no lo respondas" | **Confirmar:** mismo diseño y mismo azul, pero en los correos que van del taller a sus clientes el nombre visible es "Taller, vía VERI-TECH", hay "responder a" el taller y el pie cambia. Hay que actualizar el estándar de correos. |
| C3 | Se reescribe el sistema | GUATECH §1: el salto de versión mayor lo decide Luis | **Confirmar:** el sistema nuevo sale como **4.000** (continúa la línea 3.NNN); la app móvil nueva como **2.000** (hoy lleva 1.0.7, que ni siquiera sigue el formato). |
| C4 | Esquema en español consistente | §4 fija `created_at` / `updated_at` y `condiciones_pago` (proveedores) frente a `condicion_pago` (clientes) | Propongo **respetar el estándar** en `created_at`/`updated_at` (para no romper la forma entre productos) y unificar a `condicion_pago` también en proveedores corrigiendo el estándar. Todo lo demás en español. |
| C5 | Módulo 11 y 13: planes por usuarios, sucursales y módulos, **no por órdenes al mes** | PLANES: "usuarios y volumen mensual, más módulos donde el producto los tenga; la tabla vive en el `CLAUDE.md` de cada producto" | No hay choque real: la tabla es por producto. Se agrega la fila de VERI-TECH (usuarios, sucursales, módulos). |
| C6 | Contraseña de alta con mayúscula, minúscula y número (10) | Recuperación: además **símbolo** | El sistema nuevo usa la regla del estándar (10 + símbolo). Sin consulta. |
| C7 | — | SUPERADMIN §8 (todos los botones con ícono y texto) frente a GUATECH §20 (acciones de fila solo con la palabra) | Gana §20 (más nuevo) para Editar/Eliminar/Activar; Entrar y Suspender conservan su estilo, como dice §20. Sin consulta. |
| C8 | Mi hallazgo 10 del módulo 15 decía que los estados "Detenido por…" de la app chocan con lo decidido | §17: esos **8 estados son el estándar** | **Era un error mío.** Lo correcto: están escritos a mano en la app en vez de venir del catálogo del servidor; las razones de pausa deben salir de esos 8 estados. Corregido en `15_APP_MOVIL.md`. |
| C9 | Checklists requeridos configurables (bloquear o solo avisar) | §17-3: el checklist ligado **bloquea el cierre** (409) | Por defecto **bloquea**; la empresa puede relajarlo a "avisar" (decisión ya aprobada). |
| C10 | Soporte: ticket con número y "Mis tickets" | §2.2: el mecanismo es el **correo a `soporte@guatech.lat`** (Raiseaticket) | Compatible: el correo sigue siendo el canal; además se guarda el registro en la plataforma para el número y "Mis tickets". |

## C. Consecuencias directas para el diseño de la base de datos
- **Nombres:** tablas y columnas en español, con `created_at` y `updated_at` como en el estándar; `clientes`, `proveedores`, `departamentos`, `equipos` con los campos de §4 exactamente.
- **Plataforma:** `empresas` con `cuota_mensual` (nulo = "—"), `modulos_habilitados`, `estado`, `cobro_por_contrato`, versión legal aceptada, `acceso_hasta` y `cancelacion_solicitada_en` (UTC); `usuarios_plataforma` con los 3 roles; `auditoria_plataforma` con las columnas mínimas del estándar; `tokens_acceso_soporte` (un solo uso, 60 s); `tokens_recuperacion` (huella, 30 min); `suscripcion_eventos` y `correos_salida` (módulo 13); `pendientes_alta` con vencimiento (módulo 16).
- **Taller:** `lineas_orden` con técnico, estado (8 valores) y tiempos; `matriz_tecnico_sistema` con existencia = permiso; `checklists.orden_id` con candado de cierre; `cotizaciones` y `lineas_cotizacion` ligadas al ítem del checklist (módulo 9).
- **Fechas:** todo en UTC en la base; lo que se muestra, en `DD/MM/YYYY`.
- **Migraciones:** una carpeta única en el repositorio que el despliegue copia siempre y aplica a todos los talleres; el aprovisionamiento recorre la carpeta (sin lista escrita a mano); la verificación semanal del VPS se extiende al producto nuevo.
- **Menú (≤ 11 entradas):** propuesta de partida — Inicio, Órdenes, Cotizaciones, Equipos, Clientes, Servicios programados, Inventario, Carga de taller, Reportes, Configuración y Ayuda. Citas, revisiones operativas, compras, solicitudes de material y bodegas viven como pestañas (máximo dos filas).


---
# Resolución de Luis (2026-11-11): "Sí, como recomienda"
- **C1 (landing):** se **retiran** las recomendaciones 7 y 8 del módulo 16: el sistema nuevo sigue GUATECH §21 (cintillo con los 5 logos y selector Español/English en un solo sitio con `?lang=en`). Se conserva la medición de visitas y de conversión del registro. La landing se sigue generando desde `guatech-web`.
- **C2 (correos del taller):** se mantiene lo aprobado: mismo diseño y azul, remitente visible "Taller, vía VERI-TECH", "responder a" el taller y pie distinto. **Hay que actualizar `EMAIL_DESIGN_STANDARD.md`** (tarea pendiente, al construir).
- **C3 (versión):** el sistema nuevo sale como **4.000** y la app móvil nueva como **2.000**.
- Las decisiones C4–C10 de la tabla quedan como se propusieron.
