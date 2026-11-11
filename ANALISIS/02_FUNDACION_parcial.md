# 02 — Fundación (acceso, empresas, permisos) · lectura PARCIAL

Leído hasta ahora (≈1.400 renglones): `config/database.ts`, `config/tenantDb.ts`, `middleware/tenantResolver.ts`, `middleware/auth.ts`,
`middleware/authorization.ts`, `middleware/platformAuth.ts`, `services/permissionsService.ts`, `services/tenantProvisioner.ts`.
Pendiente: `authController` (1.781), `platformController` (917), `webhookController`, `subscribeController`, `billingService`,
middleware menores (errorHandler, validation, requireResolvedTenant, reenterTenantContext, portalAuth, publicRateLimit),
`config/session.ts`, `utils/passwordPolicy`, `utils/tenantLinks`, y el frontend (Login, Layout, Configuration 908, utils/access).
Antes de diseñar: leer los estándares de GUATECH (`SUPERADMIN_STANDARD.md`, `SUPPORT_ACCESS_STANDARD.md`, `PLATFORM_PASSWORD_RECOVERY_STANDARD.md`).

## Cómo funciona hoy
- **Una base de datos por taller** (`veritech_<slug>`) + una base de plataforma (`veritech_platform`: empresas, superadmins, tokens).
- La petición dice qué taller es por el subdominio (o por `Origin`/`X-Tenant-Slug`); `tenantResolver` consulta `companies`, y deja el
  "pool" de ese taller en un **contexto invisible** (`AsyncLocalStorage`) que `query()` lee después sin que nadie se lo pase.
- Alta de un taller nuevo (`tenantProvisioner`): crea la base por la API de cPanel, crea el subdominio, registra el DNS en Cloudflare,
  dispara AutoSSL, lee `01_SCHEMA_COMPLETO.sql` y `02_SEED_COMPLETO.sql` **del disco del servidor** y los ejecuta, y crea el admin.
- Permisos: dos matrices (visibilidad de menú `role_module_permissions` y acciones `role_action_permissions`), 12 módulos,
  15 claves "legacy" + unas 30 claves `crud.<modulo>.<accion>`, con rol `admin` que pasa todo.

## Hallazgos
1. **El contexto invisible es el origen de una clase entera de errores.** Si se pierde (por ejemplo después de subir un archivo con
   `multer`), `getActivePool` **cae en silencio a la base de plataforma**. El `CLAUDE.md` documenta tres parches sucesivos
   (`requireResolvedTenant`, `reenterTenantContext`, `runInResolvedTenantContext`) y un caso que ni siquiera se pudo explicar
   ("una ruta GET simple sin multer"). Hoy solo falla "ruidoso" porque las tablas no coinciden; no hay garantía de que siga así.
2. **El alta de un taller es una cadena de 6 pasos externos sin deshacer** (cPanel BD → cPanel subdominio → Cloudflare → AutoSSL →
   esquema → admin). Si falla a mitad queda un taller a medias. Además lee los SQL del disco del servidor: ya hubo un incidente
   (migración 108 sin copiar → falló el alta de un cliente dos días después).
3. **Cada petición protegida paga entre 5 y 8 consultas solo para saber quién es y qué puede hacer**: la empresa (`companies`), el
   usuario, sus roles, el alcance de sucursal, y para los permisos `hasTable()` **tres veces** (consultas a `information_schema`) más la
   consulta real. Sin memoria intermedia.
4. **Dos sistemas de roles conviviendo**: la columna vieja `users.role` (texto, un solo rol) y la tabla `user_roles` (varios). El
   código usa uno u otro según el archivo; `admin` se reconoce **por nombre** ('admin', sin importar mayúsculas), no por un permiso real.
   Una sola `authorizeRoles` sigue mirando `users.role`.
5. **Permisos con historia**: ~100 renglones de comentarios cuentan las "fases" de migración de permisos; hay claves legacy que no
   pertenecen a ningún módulo (`share.*`, `tariffs.manage`) y **`routes/tariffs.ts` no tiene ningún consumidor** (el propio código lo
   dice): candidato a eliminar con su servicio y tabla. Además hay mapas de permisos por rol **escritos a mano en el código** como
   plan B por si las tablas no existen (`legacyRoleModuleAccess`, `legacyRoleActionAccess`).
6. **Código repetido**: la misma consulta de "usuario de plataforma activo" aparece 3 veces (`authenticateToken`, `optionalAuth`,
   `optionalPlatformContext`); `optionalAuth` copia casi todo `authenticateToken`.
7. **Rastros de migraciones en el código vivo**: `authenticateToken` prueba una consulta sin `colaborador_id` si la columna no existe,
   acepta tokens viejos sin `companyId` ("se regularizan solos"). En una base nueva ambas cosas sobran y la segunda es un hueco de seguridad.
8. **Reintento automático de escrituras**: `query()` repite una vez cualquier sentencia que falle por `ECONNRESET`/`ETIMEDOUT`. Para un
   `INSERT` que sí llegó a ejecutarse, eso puede **duplicar el registro**. Solo debería reintentarse lo que es lectura.
9. **Zona horaria**: el pool trabaja en UTC (`+00:00`) mientras `NOW()` de MySQL va en hora local de Guatemala. Es la causa raíz de al
   menos tres errores documentados (V3.084, V3.085, y fechas 6 h adelantadas). El sistema nuevo debe decidir UNA regla y probarla.
10. **Pools que nunca se cierran**: `getTenantPool` guarda un pool (3 conexiones) por cada taller y no los libera; crece con cada taller.

## Decisión de arquitectura que necesito de Luis (define TODA la base de datos nueva)
**Opción A — una sola base de datos, cada fila con `empresa_id`** (así ya funcionan TEAM-TECH y SOPOR-TECH).
- Alta de un taller = insertar filas (segundos), sin tocar cPanel; un solo respaldo; una sola migración; desaparece el contexto invisible.
- Riesgo: una consulta que olvide filtrar por empresa mostraría datos de otro taller. Se controla con una sola capa de acceso a datos que
  exige la empresa en cada operación (el compilador avisa si falta), llaves foráneas que incluyen la empresa, y pruebas automáticas que
  intentan leer datos de otro taller.
**Opción B — una base por taller (como hoy), pero pasando la conexión de forma explícita en cada petición** (sin contexto invisible).
- Aislamiento más fuerte y es trivial exportar o borrar un taller completo; costo: N migraciones, N respaldos, alta de taller con cPanel.

**Recomendación: A.** Son muchos talleres pequeños que se registran solos por PayPal; con A el alta y el mantenimiento son simples, y
`enova` se carga como una empresa más. B tendría sentido si cada cliente exigiera su base aparte (contrato corporativo).

---
# Decisión de Luis (2026-11-10): **Opción B — una base de datos por taller.**
Consecuencias de diseño (obligatorias en el sistema nuevo):
1. **Adiós al contexto invisible.** La conexión del taller se resuelve UNA vez por petición y se pasa de forma explícita (`req.db` / argumento de cada función de datos). Si una función no recibe la conexión, no compila. Si no se resolvió el taller, la petición se rechaza; nunca se cae a la base de plataforma.
2. **Alta de taller idempotente y con deshacer.** Cada paso (crear BD, usuario de la BD, esquema, semilla, admin, subdominio, DNS) se registra en una tabla de progreso en la plataforma; si falla, se reintenta o se deshace. Los SQL del esquema salen del repositorio (versionados con el código), nunca del disco suelto del servidor.
3. **Migraciones ordenadas por taller.** Un solo esquema canónico + migraciones numeradas con una tabla `esquema_version` en cada base y un comando que migra todas las bases y reporta cuál falló. Se acaba el código que revisa si una columna existe.
4. **Pools con límite y liberación** (cierra los que llevan tiempo sin uso).
5. Cada taller, su usuario de MySQL con permisos solo sobre su base (aislamiento real).
6. `enova` se migra como un taller más; `cafe` y `waga` se respaldan y se eliminan al cierre.

---
# Adenda — backend de la fundación leído COMPLETO (2026-11-10)
Leído: `authController` (1.781), `platformController` (917), `routes/auth`, `routes/platform`, `app.ts` (orden de middleware), `errorHandler`, `validation`, `requireResolvedTenant`, `reenterTenantContext`, `publicRateLimit`, `config/session`, `passwordPolicy`, `platformAuditService`, `tenantLinks` y los estándares `SUPERADMIN_STANDARD`, `SUPPORT_ACCESS_STANDARD`, `PLATFORM_PASSWORD_RECOVERY_STANDARD`. Pendiente del módulo: frontend (Login, Layout, Configuration 908, utils/access, utils/api, AuthContext).

## Reglas que SÍ deben sobrevivir (son estándar de GUATECH o decisiones de Luis)
- Dos mundos de identidad: usuarios de **plataforma** (superadmin, roles SUPER_ADMIN / ADMIN / VIEWER, lectura vs. escritura real) y usuarios de **taller**.
- Superadmin: panel con KPIs (`/stats`, contrato fijo, "—" nunca cero), empresas, usuarios de plataforma, audit logs; alta de empresa muestra la contraseña temporal una sola vez; restablecer contraseña / reenviar bienvenida / activar-desactivar admin.
- **"Entrar"**: token de un solo uso de 60 s → sesión de 2 h **sin refresh**, banner ámbar "Sesión de soporte", cada emisión auditada. SSO desde el hub `admin.guatech.lat` con secreto compartido.
- Recuperación de contraseña: respuesta genérica (no revela si el correo existe), token de un solo uso de 30 min, el nuevo invalida los anteriores, el enlace siempre sale con el subdominio real del taller (nunca un dominio genérico).
- Contraseña mínima: 10 caracteres + mayúscula + minúscula + número (+ símbolo según el estándar del ecosistema; hoy VERI-TECH no exige el símbolo).
- Un administrador **nunca** conoce ni escribe la contraseña de otra persona: se manda un enlace para que la elija.
- Un usuario del taller solo se crea eligiendo un **colaborador** ya registrado (con correo). No se puede quitar el rol de administrador al último administrador ni a uno mismo; no se puede eliminar a uno mismo.
- Límites de intentos en login y recuperación; Turnstile en "olvidé mi contraseña".

## Hallazgos de `authController` (1.781 renglones)
1. **Un mismo `/login` atiende a superadmins y a usuarios de taller.** Se arma el token en tres lugares con código copiado (login, refresh, SSO). El sistema nuevo separa los dos mundos: endpoints, token y secreto distintos.
2. **Sesiones imposibles de cerrar bien.** Las sesiones de plataforma no guardan su refresh token (no se pueden revocar); las de taller sí lo guardan, pero **en texto claro**; cambiar o restablecer la contraseña **no cierra las sesiones abiertas** (quien robó una sesión la conserva 7 días). Los tokens de recuperación y de "Entrar" también se guardan en claro. Nuevo: se guarda solo el hash y cambiar la contraseña revoca todo.
3. **El "rol principal" se calcula mal.** `users.role` se llena con "el rol de menor id entre los elegidos", un criterio arbitrario, y varias reglas de permisos todavía leen esa columna en lugar de la tabla de roles. Se elimina la columna.
4. **Guardar permisos no es atómico.** Crear/editar un rol, guardar permisos CRUD y cambiar los roles de un usuario hacen "borrar todo y volver a insertar uno por uno" sin transacción: un corte deja un rol sin permisos o un usuario sin roles. Borrar un rol deja filas huérfanas en `role_action_permissions`; borrar un usuario es un borrado duro sin revisar su historial (debe ser desactivar).
5. **Error real: editar un usuario sin mandar el teléfono lo borra** (`undefined` se convierte en `NULL`). Además `users.email` y el correo del colaborador pueden quedar distintos.
6. **Sin validación de datos de entrada** (el proyecto tiene Zod, no se usa aquí): `role_ids` no se comprueba que existan → error 500 en vez de 400.
7. **SSO del hub**: siempre entra como "el primer superadmin activo" (`ORDER BY id LIMIT 1`), no como quien hizo clic; el secreto se compara sin comparación de tiempo constante.
8. **Detalles**: login deja ver por tiempo si el correo existe; la columna `mfa_enabled` se lee pero no existe verificación en dos pasos; dos costos de cifrado distintos (10 y 12); cada función repite el mismo `try/catch` en lugar de usar el manejador central de errores (que casi nunca se alcanza).

## Hallazgos de `platformController` (917 renglones)
1. **La auditoría de plataforma se pierde en silencio.** `logPlatformAudit` usa `query()` (la base del taller) en vez de `platformQuery()`: si la acción ocurre bajo un taller (por ejemplo un login de plataforma hecho desde el dominio de un taller) el registro cae en la base equivocada, falla con "tabla no existe" y el error se traga. Es exactamente la regla que el propio `CLAUDE.md` pide cumplir.
2. **Dar de alta una empresa no se deshace bien.** Si falla el aprovisionamiento solo se borra la fila de `companies`; queda la base creada, el subdominio y el DNS.
3. **El administrador de un taller se identifica por correo** (`WHERE email = admin_email`), no por id; si cambia el correo, la plataforma pierde el enlace. Y la plataforma escribe directo en la base de cada taller desde el controlador.
4. **Vocabularios que no coinciden:** planes `basic/professional/enterprise` (crear) vs. `starter/business/pro` (editar y PayPal); roles de plataforma `SUPER_ADMIN/ADMIN/VIEWER` (rutas) vs. `SUPER_ADMIN/SUPPORT` (tipo en `authController`).
5. **"Módulos habilitados" es un interruptor que no apaga nada.** Se guarda por empresa y el superadmin lo edita, pero solo oculta filas en la matriz de permisos del taller; ninguna ruta ni menú lo hace cumplir. (Decisión necesaria; ver abajo.)
6. `createPlatformUser` pide que el superadmin escriba la contraseña de otro superadmin (contradice la regla del enlace); borrar una empresa es solo marcarla `deleted`, sin plazo ni borrado real (la política de privacidad promete borrar a los 30 días y hoy es manual); `registerPlatformCompanyAccess` parece no tener quién lo llame (confirmar en el `admin-frontend`).

## Otros archivos
- `errorHandler` está bien hecho pero casi nunca se alcanza porque cada controlador atrapa sus errores.
- `validation.ts` (Zod) existe y casi no se usa.
- `config/session.ts` (`express-session` + tabla `sessions`) es **vestigio**: solo se activa con una bandera y el sistema trabaja con JWT. También el limitador sobre `/api/auth/register` apunta a una ruta que ya no existe.
- `requireResolvedTenant` y `reenterTenantContext` **desaparecen** con la conexión explícita por petición (decisión B).
- `publicRateLimit`: contadores en memoria de un solo proceso; vale tal cual, con almacén compartido si algún día hay más de un proceso.

## Decisión que necesito de Luis para cerrar el diseño del módulo
**¿"Módulos habilitados" por empresa debe limitar de verdad (menú y API) o se quita?** Recomiendo que **limite de verdad** y que quede atado al plan (starter / business / pro): es el único candado comercial que tendría el producto y el estándar de superadmin pide esas casillas. Si no lo quiere, se elimina por completo en vez de dejar una casilla que miente.

---
# Decisión de Luis (2026-11-10): **los módulos habilitados por empresa SÍ limitan de verdad**, atados al plan (starter / business / pro). Se hace cumplir en el menú Y en la API (una ruta de un módulo apagado responde 403 con mensaje claro). Los módulos y qué plan incluye cuál se definen en un solo archivo de configuración del plan.

---
# Adenda 2 — frontend de la fundación (app del taller) leído completo
Leído: `utils/api.ts` (416), `utils/access.ts` (100), `context/AuthContext.tsx` (130) + `auth-context.ts` + `useAuth.ts`, `routes/index.tsx` (120), `Login.tsx` (122), `Layout.tsx` (382), `Configuration.tsx` (908), `Home.tsx` (68), `EntrarSoporte.tsx` (43). Pendiente del módulo: `ForgotPassword`/`ResetPassword` (cliente), y el panel de superadmin `admin-frontend` (2.904 renglones) y la app móvil `mobile/` (2.181), que se agregan al mapa.

**Corrección a lo que dije antes:** el error de "editar un usuario borra el teléfono" es real en la API, pero la pantalla de Configuración siempre envía el teléfono, así que desde la pantalla no se ve. Queda como defecto latente.

## Lo que SÍ se conserva
Menú lateral de un solo nivel con pestañas (estándar GUATECH §13); banner ámbar de sesión de soporte con "Salir"; renovación de sesión por 401 con una sola solicitud de refresco a la vez; pantalla `/entrar` que canjea el token una sola vez; crear usuario eligiendo un colaborador; botón "Enviar link para configurar contraseña"; "ver contraseña" en el login; nombre de la empresa en el encabezado; Ayuda para cualquier usuario.

## Hallazgos
1. **Todo texto que sale del navegador se convierte a MAYÚSCULAS** (`normalizeStringValuesToUppercase` en `api.ts`), salvo una lista de excepciones escrita a mano (`NO_UPPERCASE_FIELDS`). Esa lista creció por errores reales: contraseñas, `permissions`, `movement_type`, `condicion_pago`, el token de "Entrar"… cada campo nuevo con significado exacto puede romperse en silencio. Nuevo: la regla de mayúsculas se declara **por campo en el esquema** y la aplica el servidor (y es coherente con el "formateador global" de GUATECH).
2. **Dos sistemas de permisos y la pantalla solo edita uno.** Existe la matriz de *módulos* (qué ve el menú: `role_module_permissions`) y la de *acciones* (`crud.<modulo>.<accion>`), pero la pantalla "Permisos CRUD por Módulo" solo edita las acciones y "Crear rol" siempre crea el rol con cero módulos. Resultado, por lo que leí en el código: `hasModuleAccess` trata "sin permisos de módulo" como **"mostrar todo"** (falla abierta), de modo que un rol nuevo ve todo el menú aunque el servidor le niegue casi todo con 403. Nuevo: **un solo sistema** — un módulo se ve en el menú si el rol tiene su permiso de "ver"; la falla es cerrada.
3. **El menú está escrito tres veces**, ya desincronizadas: `NAVIGATION` en `Layout`, `HOME_TILES` en `Home` (tiene "Contadores" y "Mantenimiento", que el menú ya quitó, y le faltan Proveedores y Solicitudes) y `technicianNavigation`. Además el menú móvil y el de escritorio repiten el mismo bloque de ~40 renglones. Nuevo: **un solo catálogo de módulos** del que salen menú, inicio, permisos y límites por plan.
4. **Roles decididos por nombre en el navegador** (`isTechnicianUser`, `isSupervisorUser`, `isBodegueroUser`, `canManageMaterialRequests`, `esAdmin`) y 20 rutas con `isTechnician ? <Navigate to="/my-work"> : …` repetido. Debe decidirse por permisos, no por el texto del nombre del rol.
5. **Listas de nombres de módulos repetidas en 4 sitios** (`MODULE_KEYS` del servidor, el tipo `ModuleAccessKey`, `MODULE_LABELS`/`MODULE_GROUP_INFO` de Configuration, `Layout`) y `ROLE_LABELS` a mano. Mismo origen único del punto 3.
6. **El navegador bloquea llamadas antes de enviarlas** si no hay token y el endpoint no está en `PUBLIC_ENDPOINTS` (así se rompió "Entrar" en un navegador limpio). Se elimina esa guarda: decide el servidor.
7. **Las sesiones viven en `localStorage`** (token y refresh token) — accesibles a cualquier script de la página. Nuevo: el refresh token en una cookie `httpOnly`.
8. **Detalles**: dirección de la API decidida por trucos con el nombre del dominio (`isVeritechHost`); `shouldSuppressApiErrorLog` es una función vacía; redirección dura a `/login` con `window.location`; `checkAuth` necesita una excepción especial para `/entrar` por una condición de carrera; la versión visible (`version.ts`) se sube a mano junto con 4 `package.json` y el `CLAUDE.md` (5 lugares) → una sola fuente; el modal de editar usuario deja cambiar nombre y correo aparte del colaborador (dos fuentes de verdad); `dataEdit` aún trae un campo `password` heredado; confirmaciones con `confirm()` del navegador; `Configuration.tsx` mezcla 3 pestañas en 900 renglones.

## Decisión necesaria de Luis
**¿Un solo sistema de permisos?** Recomiendo que sí: un único conjunto de permisos `módulo.acción`; el menú muestra un módulo si el rol puede "verlo"; "Crear rol" ofrece desde el inicio la matriz completa; y se elimina `role_module_permissions`. Menos código, sin casillas que no hacen nada y sin menús que terminan en "403".

---
# Decisión de Luis (2026-11-10): **un solo sistema de permisos** `módulo.acción`. Un módulo aparece en el menú solo si el rol puede "verlo" (falla cerrada); se elimina `role_module_permissions`; "Crear rol" muestra la matriz completa desde el inicio; el catálogo de módulos y acciones vive en UN archivo del que salen menú, inicio, permisos y límites por plan.

---
# Adenda 3 — panel de superadmin (`admin-frontend`) leído completo + CORRECCIÓN sobre mayúsculas y tildes

## CORRECCIÓN IMPORTANTE (2026-11-10)
Antes dije que la regla de "quitar tildes" solo tocaba los catálogos técnicos y que la ñ no se tocaba. Eso describía **solo la función del servidor** (`stripAccentedVowels`). La regla real, decidida por Luis el 2026-08-06 en `C:\GUATECH\GUATECH\GUATECH_STANDARDS.md` sección 5, es:
- **TODO texto libre** (nombres de clientes, direcciones, notas, colaboradores…) se guarda en **MAYÚSCULAS y SIN tildes ni diacríticos: `Ñ→N`, `Ü→U`** — única excepción: correo, contraseñas, números, fechas y selecciones.
- Se aplica en **tres capas**: (1) un escucha global de teclado en el navegador (`useFormatoTextoGlobal`, 118 renglones que sortean un defecto de React que ya corrompió datos en producción), (2) `api.ts` pone en mayúsculas todo lo que envía, (3) el servidor quita tildes de vocales en los catálogos (esta capa **no** convierte la ñ → inconsistencia).
- Efecto práctico: "PEÑA" se guarda "PENA", "MUÑOZ" → "MUNOZ". Es lo que su estándar pide; lo dejo escrito para que esté a la vista.
**Sistema nuevo:** una sola función en el servidor (`normalizarTexto`) aplicada según el tipo de campo declarado en el esquema (`texto_libre`, `correo`, `secreto`, `codigo`…); el navegador solo muestra y sugiere. Se elimina el escucha global.

## Lo que SÍ se conserva del panel de superadmin (estándar `SUPERADMIN_STANDARD`)
Menú de 4 secciones (Dashboard, Clientes, Usuarios de Plataforma, Audit Logs); Dashboard con los 5 indicadores y "—" cuando no hay cuotas; tabla de clientes con Suspender/Activar, Entrar, Editar; modal de edición con restablecer contraseña y reenviar bienvenida; auditoría paginada de 50; recuperación de contraseña de superadmin; SSO desde el hub; tablas con encabezado gris y orden ascendente/descendente.

## Hallazgos
1. **`Companies.tsx` mide 941 renglones** (25 variables de estado, 2 formularios en línea). Se divide en componentes.
2. **La lista de módulos del panel está desincronizada otra vez**: tiene 11 módulos y el servidor tiene 12: **al panel le falta `proveedores`** y el nombre de "checklists" dice "Mantenimiento (reportes)", que ya no existe. Con la decisión de que los módulos limiten de verdad, esto cierra a un cliente un módulo sin forma de reabrirlo desde la pantalla. Se resuelve con el catálogo único.
3. **Los planes del panel (`basic/professional/enterprise`) no son los planes reales** (`starter/business/pro` de PayPal): la lista de elegir plan no puede mostrar el plan que un cliente realmente tiene.
4. **Cuota en dólares (`$`) fija y la app del taller muestra Quetzales (`Q`) fijo**: la moneda está escrita a mano en las dos.
5. **Ordenar por "Cuota" probablemente no funciona**: la columna pide ordenar por `cuota_mensual` pero el dato se llama `monthly_fee` (no verifiqué `useSortableData`).
6. **Si falla la carga de la lista**, el panel dice "No hay empresas registradas" (el `catch` está vacío): confunde "no hay" con "falló".
7. **"Entrar" desde la fila entra como "el primer usuario activo"**, no necesariamente como un administrador; el estándar habla de un administrador.
8. **`PlatformUsers`**: el botón de un usuario activo dice **"Eliminar"** pero solo lo desactiva (su `title` dice "Desactivar"): etiqueta engañosa. Además la contraseña de otro superadmin la escribe quien lo crea.
9. **Dos copias del cliente de la API** (app del taller y panel) con diferencias (el del panel no maneja archivos ni mayúsculas) y dos `AuthContext`, dos reglas de contraseña distintas (panel: 5 reglas con símbolo; app: 3 reglas sin símbolo), dos `PasswordRequirementsList`. Estándar `ui-guatech` ya existe para compartir; hay que usarlo de verdad.
10. **Detalles**: redirección dura a `/login` en un 401; `catch { throw error }` sin función; tokens en `localStorage` con claves distintas (`admin_token` vs `token`).

## Cierre del módulo 2 — lectura
Leído completo (backend y frontend, app del taller y panel de superadmin) **excepto** los tres textos largos de estándares que quedan por leer ANTES de construir: `GUATECH_STANDARDS.md` (86 KB; leí la sección 5) — contiene reglas obligatorias para el sistema nuevo (control de versiones, Ayuda, Legal, datos maestros, listados, formularios iguales para crear/editar, migraciones, kit `ui-guatech`, navegación, caché, fechas DD/MM/AAAA, botones de fila, pantalla de orden §16, taller §17).

---
# Decisión de Luis (2026-11-10): **confirmado el estándar §5 completo — todo texto libre en MAYÚSCULAS sin tildes, la Ñ se guarda como N.** Una sola función en el servidor según el tipo de campo (`texto_libre`, `correo`, `secreto`, `codigo`…).
