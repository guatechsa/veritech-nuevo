# 01 — Catálogos · backend (`catalogController.ts`, 3.884 renglones, leído completo)

## Qué hace (reglas de negocio que SÍ deben sobrevivir)

**A. Jerarquía técnica de trabajos** (el corazón del catálogo):
`Sistema → Subsistema → Parte → Trabajo`, donde un Trabajo = Parte × Acción × correlativo
(`codigo_trabajo_completo = <parte>-<ACC>-<NN>`). Cada trabajo se asigna a uno o más **tipos de equipo** con
`tiempo_horas` y `costo_estimado` (tabla `cat_trabajos_tiempos`) y, desde V3.089, puede ser propio de un **área de trabajo**.
Los códigos se numeran solos (siguiente número libre, 2 dígitos). El precio de una línea de orden = horas × tarifa por hora
(tarifa del tipo de equipo, o la del área si existe).

**B. Catálogos simples** (todos: código/nombre + activo): tipos de orden (código de 3 letras, uno marcado "por defecto"),
estados de OT (con orden y algunos fijos del sistema que no se editan), etapas, unidades de inventario, unidades de contador
(`aplica_a` INVENTARIO|CONTADOR), tipos de contador, acciones (código de 3 letras), tipos de cliente (3 descuentos 0–100),
puestos de trabajo (flags `requiere_dpi_licencia`, `es_tecnico`), marcas por tipo de equipo.

**C. Tipos de equipo**: tarifa de venta, costo de tarifa, tolerancias de cumplimiento (días / contador), y su lista de marcas.

**Regla de baja en dos pasos (la usan casi todos):** primer "eliminar" = desactivar; segundo "eliminar" (ya inactivo) = borrar
de verdad **solo si nada lo usa**; si algo lo usa, 409 con el conteo. Los padres no se desactivan mientras tengan hijos activos.
La API de listado acepta `search`, `page/limit` (máx. 500) e `include_inactive`.

**Permisos:** leer = cualquier usuario con sesión (los formularios de órdenes lo necesitan); escribir = `crud.configuration.view` (admin/gerente).

## Lo que sobra o está mal hecho (hallazgos concretos)

1. **Copia pegada ×13.** Los 13 catálogos repiten el mismo molde (listar / crear / editar / baja en dos pasos) con ~60–120 renglones
   cada uno. Un solo motor configurable (tabla, campos, validaciones, "quién lo usa") reemplaza ~2.700 de los 3.884 renglones.
2. **Código que se defiende de su propia base de datos (≈600 renglones).** `hasColumn`, `hasTable`, `probeColumnBySelect`,
   `resolveAccionesTable` (¡busca una tabla con el nombre mal escrito `catalg_acciones` y otra `catalog_acciones`!),
   `resolveCatalogTrabajosActionColumns` (la misma columna existe como `codigo_accion` Y como `codigo_trabajo`),
   `getTrabajosTiempos` (prueba **4 variantes de SQL** hasta que una no falla), `updateTipoEquipo` (4 `try/catch` anidados quitando
   columnas). Todo esto existe porque las bases de los talleres no eran idénticas. **Con un esquema único y migraciones
   ordenadas esto desaparece completo.**
3. **Un reporte con tipos de equipo fijos en el código.** `getTrabajosTiemposResumen` arma columnas `tiempo_AU1, SU1, SU2, SU3`
   a mano: cualquier taller con otros tipos de equipo ve el resumen vacío o incompleto. Hay que hacerlo dinámico.
4. **Éxito falso / datos a medias (integridad):**
   - `createTipoEquipo`: si falla guardar las marcas (tabla o columna ausente) responde `success: true` sin ellas.
   - Crear tipo de equipo + marcas, crear trabajo + sus tiempos, mover `es_default` de tipo de orden, y el borrado de tipo de
     equipo (borra el tipo, luego sus dependientes con `.catch(() => undefined)` que **traga el error**) se hacen en varios
     `query` sueltos, **sin transacción**: un corte a mitad deja datos inconsistentes.
   - Los `catch` de casi todos los `delete*` y varios `update*` responden 500 sin registrar el error en el log.
5. **Códigos que son llaves.** Las llaves primarias son textos compuestos (`01-02-03-ACC-01`). Renombrar o mover una parte obliga a
   recalcular y reescribir el código del trabajo y de sus tiempos (`updateTrabajo`, `syncTrabajoTiposEquipo`). Además generar
   "el siguiente número" con `MAX()+1` sin candado puede chocar si dos personas crean a la vez. Diseño nuevo: llave numérica
   interna + código visible calculado.
6. **Inconsistencias pequeñas:** los sistemas empiezan en `00`, los subsistemas en `01`; límites de página por defecto distintos
   (50 vs 100); `createTipoOrden` no distingue "código repetido" (da 500); mezcla de respuestas `{success,data}` y `{success,message}`;
   `stripAccentedVowels` quita tildes de las vocales de **todo** texto guardado (decisión de producto, ver abajo).
7. **Dos catálogos de unidades que se solapan:** `catalog_unidades` (inventario) y `catalog_contador_unidad` (con `aplica_a`
   INVENTARIO|CONTADOR). Probablemente un solo catálogo `unidades` con `aplica_a`. Falta confirmar en inventario/contadores.
8. **Tablas sin uso en este archivo ni en el resto del código:** `catalog_marcas_agricola/camion/industrial`, `catalog_rubros`
   (ver `00_MAPA_DE_MODULOS.md`).

## Cómo quedaría en el sistema nuevo (propuesta)

- **Un motor de catálogos simples** (archivo de configuración por catálogo: nombre, campos, reglas, qué tablas lo referencian)
  + 3 módulos propios: *jerarquía técnica de trabajos*, *tipos de equipo (con marcas y tolerancias)*, *estados de orden (fijos + propios)*.
- La regla "no borrar si algo lo usa" sale de las **llaves foráneas reales** de la base nueva (`ON DELETE RESTRICT`), no de una lista
  de consultas escrita a mano en cada catálogo.
- Transacciones en toda operación de varios pasos. Errores registrados. Validación con Zod. Sin `any`.
- Estimación (no medida): ~600–900 renglones de backend en lugar de 3.884, más pruebas por catálogo.

## Decisiones que necesito de Luis antes de construir este módulo

1. **¿Se siguen quitando las tildes de las vocales** al guardar textos (Acción → Accion)? Es una regla heredada; hoy afecta
   también nombres de clientes, puestos, etc. Recomiendo guardar el texto tal cual lo escribe la persona.
2. **¿Los códigos de la jerarquía (01-02-03-ACC-01) los quiere ver igual** que hoy, o prefiere nombres sin códigos?
3. **¿Un solo catálogo de unidades?** (inventario + contador unidos).

## Pendiente de este módulo
Leer `routes/catalogs.ts` (hecho), `estadoOtService.ts`, `etapaService.ts`, `searchController.searchTrabajosPorTipo`, y en el
frontend `Catalogs.tsx` (3.498), `SucursalesAreasPanel`, `TarifasAreaModal`. Verificar contra el uso real de cada tabla antes de
borrarla del esquema nuevo.

---

# Adenda 2026-11-10 — servicios leídos completos

## `estadoOtService.ts` (589 renglones) — estados de la orden de trabajo

**Reglas que SÍ deben sobrevivir**
- 7 estados del sistema que no se editan ni se borran: Cita programada, Creada, En proceso, En revisión, Terminada, Entregada, Cerrada. Cada taller puede agregar los suyos (con orden y activo).
- Una orden en estado terminal queda **bloqueada** (error 423, ni el administrador la modifica) hasta que alguien la reabra con el registro de auditoría (`order_reopen_log`).
- Cancelar es un estado explícito: nunca se convierte en "Terminada" (corrección V3.085). Si el taller no tiene estado de cancelación, se rechaza con mensaje claro.

**Lo que sobra o está mal**
1. **El sistema adivina el significado de un estado por el texto de su descripción.** `isTerminalStatus` bloquea la orden si la descripción *contiene* "complet", "entreg", "factur", "terminad", "cerrad" o "cancel". Consecuencia real: un estado propio llamado **"Pendiente de entrega"** o **"Incompleta"** dejaría las órdenes bloqueadas como si estuvieran cerradas. Diseño nuevo: cada estado tiene banderas explícitas (`es_terminal`, `es_cancelacion`, `es_inicial`) y el código nunca interpreta texto.
2. **~250 renglones de traducción de valores viejos** (`ESTADO_OT_ALIASES` con '1'…'10', "ABIERTA", "FACTURADA", `inferCodeFromDescription`…): existen por datos históricos del programador original. En una base nueva no hacen falta; los estados se piden por llave.
3. **Cambia la estructura de la base de datos mientras atiende una petición** (`ensureCatalogEstadoOTColumns` ejecuta `ALTER TABLE` si faltan columnas) y **escribe al leer** (`ensureEstadosOTBase` re-escribe los 7 estados fijos cada vez que alguien abre el listado, pisando sus descripciones). Debe desaparecer: el esquema y los 7 estados nacen con la base.
4. Los 7 estados fijos están definidos en tres lugares (código, seed SQL y la lista `ESTADOS_OT_FIJOS_CODES_SQL` armada a mano): una sola fuente.
5. Se consulta la base en cada llamada sin memoria intermedia.

## `etapaService.ts` (139 renglones) — etapas de checklist

Bien pensado y pequeño. Reglas: el código de la etapa es inmutable una vez creado; `requiere_orden` (por defecto sí) decide si un checklist de esa etapa exige una orden de trabajo; no se puede borrar si la usa algún tipo de checklist o checklist; segunda baja = borrado real.
Mejoras: pasa al motor genérico de catálogos (con la bandera `requiere_orden` como campo extra); llave numérica + FK real en vez de texto repetido en `checklist_types.stage` y `checklists.stage`; el "siguiente orden" con `MAX()+1` puede chocar bajo concurrencia.

## `searchController.searchTrabajosPorTipo` — **código muerto y roto**
- El frontend web no lo llama en ningún lado (búsqueda en `frontend/src`: 0 usos). La app móvil no la revisé aún.
- Además pide la columna `ct.codigo_trabajo`, que **no existe** en el esquema canónico (`catalog_trabajos` solo tiene `codigo_accion`): en un taller creado con el esquema oficial respondería error 500. Se elimina.
- Dato extra: `catalog_trabajos` guarda `horas_estimadas` y `costo_estimado` **y** la tabla `cat_trabajos_tiempos` guarda las horas por tipo de equipo. Son dos lugares para lo mismo; en el sistema nuevo solo existe el segundo (horas y costo por trabajo × tipo de equipo).

## Resumen del backend de catálogos
Leído completo: `catalogController` (3.884) + `routes/catalogs` (181) + `estadoOtService` (589) + `etapaService` (139) + `searchTrabajosPorTipo` (~80). Pendiente solo el frontend de catálogos.

---

# Decisiones de Luis (2026-11-10)
1. **Tildes: se sigue quitando la tilde de las vocales** (á é í ó ú → a e i o u; la ñ NO se toca) al guardar. Alcance real hoy (verificado): solo catálogos técnicos (sistemas, partes, trabajos, tipos, etapas, estados), plantillas de checklist, estrategias de mantenimiento y paquetes de inspección — 57 usos en 6 archivos. **No** se aplica a clientes, colaboradores, puestos de usuarios ni a notas. En el sistema nuevo vive en UNA función compartida y se aplica solo a esos mismos campos. (Nota: el origen de la regla fue un error de pantallas que comparan texto exacto; en el sistema nuevo las pantallas comparan por llave numérica, así que la regla queda como convención de datos, no como parche.)
2. `cafe` y `waga` se pueden borrar (con respaldo antes); `enova` se conserva y se migra.

---

# Adenda — frontend de catálogos (`Catalogs.tsx`, 3.498 renglones, leído completo)

## Qué hace la pantalla (se conserva)
- 15 pestañas: Sistemas, Subsistemas, Partes, Trabajos, Acciones, Tipos Equipo, Tipos Orden, Tipos Estado, Tipos Contador, Unidades, Tipos Cliente (solo admin), Bodegas, Puestos, Sucursales, Áreas de trabajo.
- Formulario de **Trabajo** en cascada Sistema → Subsistema → Parte → Acción; el nombre se arma solo ("ACCIÓN - PARTE - SUBSISTEMA"); campo "Variante"; área opcional; hay que marcar al menos un tipo de equipo y poner las horas de cada uno (con equivalencia en minutos). Los códigos (subsistema, parte, trabajo) se generan solos y se muestran en lectura.
- **Tipo de equipo**: debe llevar al menos una marca al crearse; tarifa por hora (valor y costo) y tolerancias de mantenimiento; botón "Ver Marcas".
- **Tipo de orden**: código de 3 letras; una estrella marca el "por defecto" (lo usan las órdenes creadas solas por citas y proyecciones).
- Estados predeterminados bloqueados ("Predeterminado"); baja en dos pasos con confirmación; reactivar.
- Tipo de cliente: tres descuentos 0–100 %.

## Lo que sobra o está mal (hallazgos)
1. **Un solo componente de ~2.500 renglones con ~80 variables de estado**, y tres formas distintas de hacer el mismo CRUD simple: la tabla genérica (10 catálogos), una pantalla propia para Tipos de Cliente, otra para Bodegas y otra para Puestos (estas dos no pueden eliminar, solo activar/desactivar; las otras sí). Tres comportamientos para lo mismo.
2. **Código muerto confirmado**: la vista "Tiempos Comparativo" y las vistas por tipo de equipo existen en el código, pero el cambio de vista (`_setTrabajoVistaMode`) nunca se conecta a ningún botón, así que **nadie puede abrirlas**. Eso significa que los endpoints `trabajos-tiempos` y `trabajos-tiempos/resumen` del backend (con sus 4 variantes de SQL y las columnas fijas AU1/SU1/SU2/SU3) **no los usa la pantalla web**. Corrijo lo que dije antes: no era un reporte roto a la vista de los talleres, era código muerto. Se elimina junto con `_trabajoSubTabs` y `_fetchTiemposTrabajo`.
3. **El costo estimado de un trabajo nunca se captura**: el formulario siempre envía `costo_estimado: 0`. El precio sale de horas × tarifa del tipo de equipo (o del área). La columna `costo_estimado` (en `catalog_trabajos` y `cat_trabajos_tiempos`) y `horas_estimadas` de `catalog_trabajos` sobran.
4. **Los 7 estados fijos están escritos una tercera vez en el frontend** (además del código del servidor y del seed).
5. **Tres fuentes de "unidades" que no se hablan**:
   - La pestaña "Unidades" edita `catalog_unidades` = unidades de **inventario** (la usa `inventory.unit`). Pero el tipo de datos del frontend dice `ContadorUnidad` con `aplica_a`, que ahí no existe (confuso).
   - `catalog_contador_unidad` (unidades de **contador**, con `aplica_a`) tiene 4 endpoints de crear/editar/borrar, **pero ninguna pantalla los usa**; solo se lee desde la ficha del equipo (`EquipmentContadores.tsx`).
   - La pantalla de Tipos de Contador usa una **lista fija escrita en el código** (KM, MI, HRS, CICL, DIAS, MESES) que no sale de la base de datos.
   Decisión recomendada: **un solo catálogo `unidades`** con un campo "se usa en" (inventario / contador) y una sola pantalla.
6. **Datos repetidos**: `catalog_subsistemas` guarda también el nombre del sistema (columna `sistema`), copiado al crear: si se renombra el sistema, los subsistemas quedan con el nombre viejo. Se elimina esa columna.
7. **Texto técnico a la vista del usuario**: "Ejecuta la migración 045" aparece en pantalla en Tipos de Cliente.
8. **La moneda "Q" está escrita en las etiquetas** (Valor Tarifa (Q/h)): no depende de la empresa. Pendiente decidir si VERI-TECH nuevo será solo para Guatemala (Quetzales) o multimoneda.
9. Tres copias casi idénticas de la función que baja todas las páginas de Sistemas / Subsistemas / Partes de 500 en 500 para llenar listas desplegables; con más datos esto se vuelve lento. Con una búsqueda en el servidor (autocompletar) desaparece.
10. Uso de `confirm()` del navegador y mensajes de error genéricos; búsqueda en el servidor solo en 4 pestañas y en el cliente en las demás (el contador "Mostrando X de Y" queda inconsistente).

## Diseño nuevo (pantalla)
- **Una sola pantalla de catálogo reutilizable** (tabla + formulario + baja en dos pasos + reactivar + búsqueda en el servidor) alimentada por la misma configuración que el motor del backend; las pestañas con lógica propia (Trabajos, Tipos de equipo con marcas, Estados, Tipos de orden con "por defecto") se mantienen como componentes aparte, pequeños.
- Una sola forma de eliminar/desactivar en todos los catálogos.

## Estado de lectura del módulo 1 (Catálogos)
**Completo**: catalogController, rutas, estadoOtService, etapaService, búsqueda de trabajos, Catalogs.tsx. Pendientes menores del módulo, que se leen junto a su dueño: `SucursalesAreasPanel` y `TarifasAreaModal` (módulo 3), `useSucursalesAreas`.

---
# Decisión de Luis (2026-11-10): **unidades unidas**. Un solo catálogo `unidades` con el campo "se usa en" (inventario / contador / ambos) y una sola pantalla. Se eliminan `catalog_contador_unidad`, la lista fija `UNIDADES_CONTADOR` del frontend y sus 4 endpoints sin pantalla.

---
# CORRECCIÓN (2026-11-10): la regla de tildes es más amplia de lo que escribí arriba
La decisión "seguir quitando tildes" corresponde al estándar GUATECH §5 (Luis, 2026-08-06): TODO texto libre → MAYÚSCULAS, sin tildes ni diacríticos, **incluida la Ñ → N**; excepción: correos, contraseñas, números, fechas y selecciones. La función del servidor (que solo toca vocales y respeta la ñ) es una de tres capas y es inconsistente con las otras dos. Ver `02_FUNDACION_parcial.md`, "Adenda 3".
