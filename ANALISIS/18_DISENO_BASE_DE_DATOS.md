# 18 — Diseño de la base de datos nueva · PROPUESTA PARA APROBACIÓN (2026-11-11)

Estado: **diseño a nivel de tablas y campos clave.** Todavía no hay SQL ni código. Se presenta por partes; Luis aprueba cada una antes de pasar a la siguiente y, al final, de todo el conjunto. El SQL completo (con tipos, índices y restricciones) se escribe al construir.

Base de la propuesta: las 16 revisiones de módulos (decisiones en `05`–`16`), los estándares (`17`) y el esquema actual (83 tablas del taller + 11 de plataforma).

## 0. Reglas de diseño (valen para todas las tablas)
1. **Dos bases de datos:** `veritech_plataforma` (global) y una `veritech_<taller>` por taller. La estructura sale solo de la carpeta de migraciones del repositorio (nunca se pregunta "¿existe la columna?" mientras corre el sistema).
2. **Nombres en español**, tablas en plural (`clientes`), columnas en singular, `snake_case`, llaves `<tabla>_id`. Excepción por estándar: `created_at` y `updated_at`.
3. **Estados y tipos por código estable**, nunca por el texto que se ve. Los que la lógica necesita llevan banderas (`es_terminal`, `es_cancelado`, `es_inicial`) para que renombrar un estado no cambie ningún número.
4. **Tiempos en UTC** (fecha y hora) y la **zona horaria del taller** en su configuración; las fechas de calendario sin hora (vencimientos, lecturas) son solo fecha. Pruebas con base real que verifiquen el cambio de día.
5. **Dinero** con 2 decimales; **cantidades de inventario enteras** (decisión de Luis; "medio metro" = unidad centímetros); horas con 2 decimales; contadores con 2 decimales.
6. **Nada se numera con `MAX()+1`:** una tabla `secuencias` con bloqueo entrega cada número (órdenes, solicitudes, compras, cotizaciones, folios).
7. **Integridad en la base, no solo en la pantalla:** llaves foráneas reales, existencia no negativa, un solo checklist abierto por tipo y orden, NIT único excepto "CF", etc. (ver sección 4).
8. **Eliminar = desactivar** (`activo`) cuando hay historia; solo se borra de verdad lo que nunca se usó.
9. **Todo archivo** (foto, documento, firma, PDF) se registra una vez en `archivos` y las demás tablas apuntan a él (adiós rutas sueltas, fotos huérfanas y direcciones que vencen).
10. **Bitácora** (`bitacora`) para lo delicado, siempre con motivo: reaperturas, anulaciones, diferencias de inventario, excepciones de checklist, cambios de reglas de un tipo de equipo, accesos de soporte.
11. **Permisos únicos** `modulo.accion` (una sola tabla), con los módulos habilitados por plan.
12. **Textos libres** se guardan en mayúsculas y sin tildes (estándar §5), excepto el correo; el servidor también lo hace cumplir.

---

# PARTE 1 — Plataforma (`veritech_plataforma`) · 20 tablas

Reemplaza las 11 de hoy. Se eliminan las 6 de "demo" (función que ya no existe); el taller de demostración pasa a ser un taller más, marcado `es_demo`.

| Tabla | Para qué sirve | Campos clave |
|---|---|---|
| `empresas` | Cada taller cliente (antes `companies`) | nombre, slug*, nombre_bd, subdominio, **estado** (`pendiente`, `prueba`, `activa`, `pago_fallido`, `suspendida`, `cancelada_con_acceso`, `solo_exportar`, `cerrada`), plan_id→, cuota_mensual (nulo = "—"), `cobro_por_contrato`, es_demo, paypal_suscripcion_id, prueba_hasta, gracia_hasta, acceso_hasta, cancelacion_solicitada_en, exportable_hasta, borrado_programado_en, contacto_nombre, contacto_correo, version_legal_aceptada, legal_aceptada_en, legal_aceptada_ip, zona_horaria, provisionada_en |
| `planes` | Niveles 30/60/120 | codigo*, nombre, precio_mensual, max_usuarios, max_sucursales (nulo = sin límite), paypal_plan_prueba, paypal_plan_regular (por ambiente), activo |
| `modulos` | Lista de módulos del producto | codigo*, nombre, orden |
| `plan_modulos` | Qué módulos trae cada nivel | plan_id, modulo_codigo |
| `empresa_modulos` | Módulos habilitados por empresa (casillas del panel) | empresa_id, modulo_codigo |
| `pagos` | Historial propio de cobros (sincronizado con PayPal) | empresa_id, paypal_transaccion_id*, fecha, monto, moneda, estado |
| `suscripcion_eventos` | Bitácora de la suscripción; **un evento de PayPal nunca se procesa dos veces** | empresa_id, evento_paypal_id*, tipo, estado_antes, estado_despues, origen (`aviso`, `conciliacion`, `manual`), usuario_plataforma_id, detalle, created_at |
| `altas_pendientes` | Pase firmado del registro (antes la sala de espera era `companies`) | pase_hash*, slug, nombre_taller, admin_nombre, admin_correo, contrasena_hash, plan_id, version_legal, ip, paypal_suscripcion_id, estado (`emitida`, `aprobada`, `usada`, `vencida`), vence_en |
| `subdominios_reservados` | Nombres prohibidos (`api`, `admin`, `www`, ofensivos…) | slug* |
| `usuarios_plataforma` | Personal de GUATECH | nombre, correo*, contrasena_hash, rol (`SUPER_ADMIN`, `ADMIN`, `VIEWER`), activo, ultimo_ingreso |
| `tokens_recuperacion` | Recuperar contraseña (30 min, un uso, guardado como huella) | usuario_plataforma_id, huella*, vence_en, usado_en |
| `tokens_acceso_soporte` | "Entrar" como cliente (60 s, un uso) | huella*, empresa_id, usuario_destino_id, creado_por, vence_en, usado_en, ip |
| `tokens_sso` | Salto desde el hub `admin.guatech.lat` al panel | huella*, usuario_plataforma_id, vence_en, usado_en |
| `auditoria_plataforma` | Toda acción administrativa (estándar superadmin §7) | usuario_plataforma_id, accion, empresa_id, descripcion, ip, user_agent, created_at |
| `directorio_acceso` | **Un correo, varios talleres** (decisión módulo 13): qué talleres tiene cada correo para la página "Entrar" | correo, empresa_id, usuario_id (en el taller), activo |
| `codigos_publicos` | Resuelve a qué taller pertenece un código QR de equipo **sin** que el código muestre el número de empresa (módulo 12) | codigo*, empresa_id |
| `correos_salida` | Cola de correos de la plataforma con reintentos | tipo, destinatarios, asunto, cuerpo, estado (`pendiente`, `enviado`, `error`), intentos, ultimo_error, enviar_despues_de, enviado_en |
| `tickets_soporte` | Tickets con número (módulo 13); el correo a soporte@guatech.lat sigue siendo el canal | numero*, empresa_id, usuario_nombre, usuario_correo, tipo (`problema`, `mejora`), asunto, descripcion, version_app, pantalla, navegador, rol, estado |
| `ticket_adjuntos` | Fotos del ticket (máx. 5) | ticket_id, ruta, nombre, tamano |
| `migraciones_aplicadas` | Qué migración ya corrió | archivo*, aplicada_en |

Notas de la Parte 1:
- **Estados de la suscripción** = la máquina aprobada en el módulo 13. `acceso_hasta` y todas las fechas de cobro en UTC.
- `directorio_acceso` vive en otra base que los talleres: se actualiza desde la aplicación y una revisión semanal lo reconcilia (riesgo conocido: no hay transacción entre bases).
- El panel de plataforma cumple los 5 indicadores del estándar con estas tablas (`empresas`, `pagos`).

---

# PARTE 2 — Taller (`veritech_<taller>`) · mapa de 109 tablas por área

Resumen por área (tablas nuevas / qué pasa con las 83 de hoy):

| Área | Tablas | Observación |
|---|---|---|
| A. Seguridad y personas | 17 | Colaboradores como base de los usuarios; credenciales, jornadas y ausencias |
| B. Estructura, configuración y soporte técnico | 8 | Sucursales, áreas, bodegas, numeración, bitácora, archivos |
| C. Catálogos de trabajo | 12 | Un solo catálogo de unidades, marcas y motivos |
| D. Clientes, contactos y proveedores | 6 | Contactos con acceso a equipos (portal) |
| E. Equipos | 9 | El **tipo de equipo** es el centro; componentes opcionales |
| F. Contadores | 5 | Principales, auxiliares y todas las lecturas en una tabla |
| G. Servicios programados | 4 | Sustituye estrategias, paquetes e historial de mantenimiento |
| H. Órdenes de trabajo | 7 | Líneas asignables, tiempos reales, ingresos del equipo |
| I. Citas | 1 | Tabla propia |
| J. Checklists | 11 | Plantillas versionadas, fotos múltiples, firmas |
| K. Cotizaciones y documentos | 3 | Nuevo (módulo 9) |
| L. Inventario | 12 | Margen por clasificación, reservas, diferencias |
| M. Canales con el cliente | 4 | Enlaces, bitácora única, portal |
| N. Avisos, tablero y reportes | 7 | Avisos por rol/persona, metas, vistas y envíos programados |
| O. App móvil | 3 | Cambios con identificador único, dispositivos, preferencias |

**Por qué hay más tablas que hoy (83 → 109):** se eliminan ~25 tablas viejas (duplicadas, sin uso o reemplazadas) y se agregan ~50 que corresponden a decisiones ya aprobadas (cotizaciones, citas, reservas, ausencias, bitácora de acceso, firmas, mutaciones del móvil, etc.). Nada se agregó que no responda a una decisión.

## A. Seguridad y personas (17)
```
usuarios(colaborador_id*→, contrasena_hash, activo, ultimo_ingreso, intentos_fallidos, bloqueado_hasta)
roles(nombre*, descripcion, es_sistema, activo)
permisos(codigo* "modulo.accion", modulo, descripcion)
rol_permisos(rol_id, permiso_codigo)                    -- UN solo sistema (antes había dos)
usuario_roles(usuario_id, rol_id)
sesiones(usuario_id, huella_token*, dispositivo, ip, vence_en, revocada_en, es_soporte)   -- listables y revocables
tokens_recuperacion(usuario_id, huella*, vence_en, usado_en)
colaboradores(codigo, nombre_completo, correo* (único si existe), celular, direccion, dpi, sucursal_id, area_trabajo_id, nivel_tecnico_id, activo)
puestos(nombre, es_tecnico, activo)
colaborador_puesto(colaborador_id, puesto_id)
niveles_tecnico(codigo*, nombre, orden)
tipos_credencial(nombre, requiere_vencimiento, dias_aviso)             -- licencia de conducir, certificaciones…
puesto_credenciales(puesto_id, tipo_credencial_id, obligatoria)        -- qué credenciales exige cada puesto (reemplaza requiere_dpi_licencia)
colaborador_credenciales(colaborador_id, tipo_credencial_id, numero, vence, archivo_id)
jornadas(colaborador_id (nulo = general), dia_semana, desde, hasta, pausa_desde, pausa_hasta)
ausencias(colaborador_id, desde, hasta, tipo, notas)
matriz_tecnico_sistema(nivel_tecnico_id, sistema_id)    -- fila ausente = SIN permiso (estándar §17)
```
- El **usuario nace de un colaborador** (decisión módulo 8/colaboradores); nombre, celular y correo se toman de ahí.
- Se eliminan `sessions` (almacén de sesiones de Express), `role_module_permissions` (duplicaba a `role_action_permissions`) y la columna `users.role` (texto viejo).

## B. Estructura, configuración y soporte técnico (8)
```
sucursales(nombre*, direccion, telefono, es_principal, cupo_diario_citas, activo)
areas_trabajo(nombre*, activo)
bodegas(nombre, sucursal_id, activo)
configuracion(clave*, valor)        -- IVA, precios_incluyen_iva, moneda, zona_horaria, modo_citas, base_costo, umbrales de aviso, portal activo…
secuencias(clave*, ultimo_valor)    -- numeración con bloqueo
bitacora(usuario_id, accion, entidad, entidad_id, motivo, antes, despues, ip, created_at)
archivos(ruta*, nombre_original, tipo_mime, tamano, hash, subido_por, created_at)
migraciones_aplicadas(archivo*, aplicada_en)
```
- Reemplaza `print_config` (llave/valor sin control) por `configuracion` con claves definidas en el código y valores por defecto.
- `bitacora` absorbe `audit_log` y `order_reopen_log`.

## C. Catálogos de trabajo (12)
```
sistemas(codigo*, nombre, es_servicios_programados, es_insumos_generales, activo)   -- grupo 99 sembrado; la bandera NO depende del número
subsistemas(sistema_id, codigo, nombre, activo)
partes(subsistema_id, codigo, nombre, activo)
acciones(codigo*, nombre, activo)
trabajos(sistema_id, subsistema_id, parte_id, accion_codigo, nombre, area_trabajo_id (nulo = general), activo)
trabajo_horas_tipo_equipo(trabajo_id, tipo_equipo_id, horas)   -- horas estándar (antes cat_trabajos_tiempos)
unidades(codigo*, nombre, tipo ['medida','contador'])          -- reemplaza catalog_unidades, catalog_contador_unidad, y el campo unidad de catalog_tipo_contador
marcas(nombre*, tipo_equipo_id (nulo = general))              -- reemplaza 4 tablas de marcas
tipos_orden(codigo*, nombre, es_default, es_pedido_especial, activo)   -- configurables; "MATERIAL PENDIENTE" viene sembrado pero se puede renombrar; la bandera es_pedido_especial (nace sin equipo presente) la puede tener cualquier tipo
estados_orden(codigo*, nombre, orden, es_inicial, es_terminal, es_cancelado, es_sistema, color, activo)   -- 7 de fábrica (no se borran, sí se renombran) + los que cree el taller, que eligen sus banderas
etapas(codigo*, nombre, orden, requiere_orden, color)           -- etapas de checklist
motivos(tipo ['rechazo_cotizacion','cancelacion_cita','anulacion_orden','diferencia_inventario','excepcion_checklist'], nombre, activo)
```
- Se eliminan `catalog_rubros` (sin ningún uso en el código) y las tres tablas de "unidades".

## D. Clientes, contactos y proveedores (6)
```
tipos_cliente(nombre*, descuento_trabajos, descuento_materiales, descuento_otros, activo)
clientes(nombre, nit, nit_unico [generada: NULL si CF]*, contacto_nombre, contacto_email, contacto_telefono, telefono, email, direccion, condicion_pago, dias_credito, limite_credito, notas, tipo_cliente_id, activo, created_at, updated_at)   -- campos exactos de GUATECH §4
departamentos(cliente_id, nombre, activo)                    -- áreas internas DEL CLIENTE
contactos_cliente(cliente_id, nombre, correo, telefono, rol ['aprobador','consulta','piloto'], acceso_todos_equipos, activo)   -- módulo 12
contacto_equipos(contacto_id, equipo_id)                     -- si no tiene acceso a todos
proveedores(nombre, nit, contacto_nombre, contacto_email, contacto_telefono, direccion, condicion_pago, dias_credito, notas, activo, created_at, updated_at)
```

## E. Equipos (9)
```
tipos_equipo(codigo*, nombre, tarifa_venta_hora, costo_hora, tolerancia_dias, tolerancia_contador, tiene_componentes, activo)   -- el tipo manda sobre tarifas, servicios, KPIs
tipo_equipo_componentes(tipo_equipo_id, nombre, tipo_contador_id)   -- plantilla de componentes (solo si el tipo los tiene)
equipos(tipo_equipo_id, codigo_interno, placa, vin, marca_id, modelo, anio, color, motor_marca, motor_modelo, motor_serie, combustible, capacidad_tanque, cliente_id, departamento_id, propiedad ['propio','cliente'], estado, codigo_publico* (QR), activo, notas)
componentes(equipo_id, nombre, tipo_componente_ref, activo)            -- "Componentes" (antes "sub-equipos")
tipos_documento(nombre, requiere_vencimiento, dias_aviso)           -- seguro, tarjeta de circulación… con alerta (funde las pólizas)
equipo_documentos(equipo_id, tipo_documento_id, nombre, vence, archivo_id, subido_por)
equipo_fotos(equipo_id, archivo_id, tipo, descripcion, es_principal)
equipo_notas(equipo_id, nota, tipo, es_importante, creado_por)
asignaciones_operador(colaborador_id, equipo_id, desde, hasta, activo)
```
- El **tipo de equipo no se cambia** si el equipo ya tiene órdenes (se hace cumplir al guardar).
- Se eliminan `equipment_insurance_policies` e `insurers` (sin uso en el código; los seguros pasan a ser un tipo de documento con vencimiento).

## F. Contadores (5)
```
tipos_contador(nombre, unidad_id, es_calendario, activo)
contadores(equipo_id, componente_id (nulo), tipo_contador_id, nombre, valor_inicial, valor_actual, fecha_inicio, es_principal, activo)   -- nunca se reinicia
lecturas_contador(contador_id, valor, fecha, origen ['inicial','orden','checklist','manual','portal','cita','importacion'], orden_id, checklist_id, registrado_por_usuario_id, registrado_por_contacto_id, archivo_id, notas, estado ['valida','pendiente_revision','anulada'], anulada_en, anulada_por, motivo_anulacion)   -- une ot_contadores_lecturas; una lectura mala se ANULA con motivo, nunca se borra; el contador toma la última válida
contadores_auxiliares(equipo_id, contador_id, grupo, nombre, unidad_id, sentido, limite_precaucion, limite_condenatorio, avisar, activo)
lecturas_auxiliares(contador_auxiliar_id, fecha, valor_principal, valor_auxiliar, reinicia_tendencia, notas, registrado_por)
```

## G. Servicios programados (4)
```
servicios_programados(tipo_equipo_id, trabajo_id, checklist_tipo_id, tipo ['mantenimiento','revision_operativa'], tipo_contador_id, componente_tipo_id (nulo = contador principal), intervalo, aviso_urgente, aviso_proximo (nulos = valores del taller), activo)   -- cada uno con su propio reloj
servicio_incluye(servicio_id, incluido_id)                  -- cascada opcional, avanzada
servicios_realizados(equipo_id, componente_id, servicio_id, contador_valor, fecha, orden_id, checklist_id, origen ['checklist','cierre_orden','historico','excepcion'], motivo, registrado_por, anulado_en, anulado_por, motivo_anulacion)
avisos_servicio(equipo_id, servicio_id, estado_alertado, enviado_en)       -- evita repetir avisos
```
- Sustituye **9 tablas**: estrategias, sus niveles y sus tipos; paquetes de inspección y sus niveles; `maintenance_logs`; `contador_alertas_enviadas`; la asociación de checklists a tipos.
- Un servicio solo cuenta como realizado con checklist completado; la **excepción autorizada** (con motivo) y la carga de histórico quedan en `servicios_realizados` y en `bitacora`.

## H. Órdenes de trabajo (7)
```
ordenes(numero*, cliente_id, equipo_id, sucursal_id, area_trabajo_id (principal), tipo_orden_id, estado_id, prioridad ['baja','media','alta','urgente'], origen ['directo','cita'], cita_id, referencia_factura_externa (opcional: número del sistema de caja del taller), responsable_id, creada_por_id, fecha_estimada_entrega, fecha_cierre, motivo_anulacion_id, motivo_anulacion_texto, notificar_nombre, notificar_correo, notificar_telefono, subtotal, descuento_total, iva, total, created_at, updated_at)
orden_estados_historial(orden_id, estado_id, desde, usuario_id)             -- NUEVO: sin esto no hay "días en taller" ni tiempos de despacho
ingresos_equipo(orden_id, equipo_id, entrada_en, salida_en, recibido_por, lectura_contador_id)   -- presencia física (pedido especial nace sin equipo)
lineas_orden(orden_id, tipo ['servicio','material','tercero'], trabajo_id, material_id, proveedor_id, descripcion, cantidad, precio_unitario, descuento_pct, total_linea, costo, tarifa_hora_aplicada, costo_hora_aplicado (copia del momento: el margen no cambia si luego cambian las tarifas), horas_trabajo (horas estándar del catálogo; **precio = horas_trabajo × tarifa_hora_aplicada**), area_trabajo_id, tecnico_id, estado [8 estados GUATECH §17], inicio_en, pausa_en, fin_en, solicitud_linea_id, cotizacion_linea_id, notas)
registros_tiempo(linea_id, colaborador_id, inicio, fin)                     -- horas realmente trabajadas (eficiencia y utilización)
linea_fotos(linea_id, archivo_id, tipo ['antes','despues','durante'], descripcion)
tarifas_area(area_trabajo_id, tipo_equipo_id, tarifa_venta_hora, costo_hora)
```
- Reemplaza `orders`, `order_items`, `ot_item_fotos`, `tarifas_area_tipo_equipo`, `order_reopen_log` y elimina `tariffs` (tabla vieja que ya no intervenía en los precios) y `work_steps` (pasos sueltos que los checklists y las líneas ya cubren; *avíseme si algún taller los usa*).
- Descuentos, IVA y totales **los calcula el servidor** y quedan guardados al cerrar.
- `ordenes.estado_id` y `lineas_orden.estado` usan códigos; "orden cerrada bloquea todo" se hace cumplir con la bandera `es_terminal`.

## I. Citas (1)
```
citas(equipo_id, cliente_id, sucursal_id, fecha_hora, estado ['programada','se_presento','no_se_presento','cancelada'], origen ['recepcion','aviso','portal'], servicio_programado_id, horas_estimadas, motivo_cancelacion_id, lectura_contador, notas, creada_por)   -- la orden que nace apunta a la cita (ordenes.cita_id); horas_estimadas alimenta la planificación de carga
```

## J. Checklists (11)
```
checklist_tipos(codigo*, nombre, descripcion, etapa_codigo, orden, exige_lectura_contador, requiere_firma_cliente, activo)
checklist_tipo_tipos_equipo(checklist_tipo_id, tipo_equipo_id)              -- aplicabilidad solo a nivel de tipo (decisión módulo 9)
checklist_plantillas(checklist_tipo_id, version, vigente, creada_por)       -- versionadas: lo completado nunca cambia
checklist_secciones(plantilla_id, nombre, orden)
checklist_items(plantilla_id, seccion_id, orden, descripcion, tipo_respuesta ['semaforo','si_no','numero','texto','lista'], unidad_id, minimo, maximo)
checklist_item_opciones(item_id, texto, orden)
checklists(tipo_id, plantilla_id, orden_id, equipo_id, estado ['pendiente','en_progreso','completado'], completado_en, completado_por, creado_por, abierto_clave [generada: única])
checklist_respuestas(checklist_id, item_id, orden, seccion, descripcion, semaforo, valor_numero, valor_texto, opcion_id, nota, respondido_por, respondido_en)   -- copia el texto: nunca cambia
checklist_fotos(respuesta_id, archivo_id, orden)                            -- hasta 5 por ítem
checklists_requeridos(tipo_orden_id, checklist_tipo_id, momento ['antes_de_iniciar','antes_de_terminar'], accion ['bloquear','avisar'])
firmas(checklist_id, firmante_nombre, archivo_id, firmado_en, dispositivo)   -- firma del cliente con el dedo
```

## K. Cotizaciones y documentos emitidos (3)
```
cotizaciones(numero*, cliente_id, equipo_id, orden_id, checklist_id, estado ['borrador','enviada','respondida','vencida','reemplazada','anulada'], version, reemplaza_a, autorizador_usuario_id (flota propia), subtotal, descuento_total, iva, total, vence_en, enviada_en, creada_por)
cotizacion_lineas(cotizacion_id, tipo ['servicio','material','tercero'], checklist_respuesta_id (el rojo de origen), trabajo_id, material_id, proveedor_id, descripcion, cantidad, precio_unitario, descuento_pct, total_linea, costo (interno: el cliente no lo ve), horas, estado ['pendiente','autorizada','rechazada','agregada_a_orden','vencida'], motivo_rechazo_id, motivo_rechazo_texto, respondida_en, respondida_por_contacto_id, respondida_por_usuario_id, dispositivo, ip, linea_orden_id)
documentos_emitidos(tipo ['cuenta','informe','cotizacion'], folio*, orden_id, version, contenido (instantánea), archivo_id, emitido_en, emitido_por, reemplaza_a)   -- NO son factura
```
- El **desenlace de cada rojo vive en `cotizacion_lineas`** y se muestra en el checklist, el PDF, el historial del equipo y el portal; las respuestas del checklist no se modifican.
- Con esta tabla salen los indicadores de **% de líneas y de valor autorizado** y de **motivos de rechazo**.

## L. Inventario (12)
```
materiales(codigo*, nombre, descripcion, parte_id (obligatorio), marca_id, codigo_oem, unidad_id, existencia_minima, ubicacion, costo_ultimo, costo_promedio, precio_manual (opcional; vacío = el precio sale del costo más el margen), proveedor_principal_id, activo)
existencias(material_id, bodega_id, cantidad >= 0)                         -- una sola fuente (adiós inventory.quantity duplicada)
movimientos_inventario(material_id, bodega_id, tipo ['compra','despacho','devolucion','traslado_salida','traslado_entrada','diferencia'], cantidad, saldo_resultante, costo_unitario, referencia_tipo, referencia_id, motivo_id, usuario_id, fecha)
compras(numero*, proveedor_id, bodega_id, fecha_documento, numero_factura, estado, creada_por)     -- documento de varias líneas; NO ligada a órdenes
compra_lineas(compra_id, material_id, cantidad, costo_unitario)
solicitudes_material(numero*, orden_id, solicitante_id, estado ['no_despachada','despachada_parcial','despachada','anulada'], solicitada_en, despachada_en, motivo_anulacion)
solicitud_lineas(solicitud_id, material_id, cantidad_solicitada, cantidad_despachada, bodega_id, costo_unitario, movimiento_id)
devoluciones_material(solicitud_linea_id, cantidad, bodega_id, motivo, movimiento_id, registrada_por)
reservas(material_id, bodega_id, cantidad, cliente_id, orden_id (obligatoria), vence_en, estado ['activa','cargada','vencida','cancelada'], extensiones, motivo_extension, creada_por)
margenes(nivel ['sistema','subsistema','parte','material'], referencia_id, porcentaje)   -- gana el más específico
material_aplica_a(material_id, tipo_equipo_id, marca_id, modelo)           -- aplicabilidad manual
material_equipos(material_id, equipo_id, origen ['consumo','manual'])     -- aplicabilidad aprendida por consumo
```
- La **única manera de corregir una cantidad** (fuera de compra, despacho, devolución y traslado) es un movimiento tipo `diferencia`, con motivo, valor y permiso propio.
- Las **reservas protegen unidades** y se asignan primero a las reservas pendientes cuando llega una compra.

## M. Canales con el cliente (4)
```
enlaces_publicos(huella*, tipo ['checklist','cuenta','cotizacion','cita'], entidad_id, incluye_costos, creado_por, vence_en, revocado_en, primera_apertura_en, aperturas)
accesos_cliente(canal ['portal','enlace','qr'], contacto_id, enlace_id, recurso, cuando, ip, agente, es_vista_previa)   -- UNA bitácora de "quién vio qué"
portal_codigos(correo, huella, vence_en, intentos, usado)
portal_sesiones(contacto_id, huella*, vence_en, revocada_en, ip, agente)
```

## N. Avisos, tablero y reportes (7)
```
avisos_config(tipo_aviso*, activo, asunto, cuerpo, umbral_dias, umbral_unidades)
avisos_destinatarios(aviso_config_id, rol_id, usuario_id, correo)           -- por rol o por persona (no existe "jefe de taller" fijo)
correos_salida(tipo, destinatarios, asunto, cuerpo, orden_id, estado, intentos, ultimo_error, enviar_despues_de, enviado_en)   -- cola con reintentos (reemplaza notifications)
kpi_metas(indicador, valor_meta, comparacion, vigente_desde)
tarjetas_tablero(rol_id, tarjeta, orden, visible)                          -- tablero por rol, configurable
vistas_guardadas(usuario_id, reporte, nombre, filtros)
reportes_programados(reporte, filtros, formato, frecuencia, destinatarios, ultimo_envio)
```

## O. App móvil (3)
```
dispositivos(usuario_id, token_push, plataforma, version_app, activo, ultimo_uso)
mutaciones_procesadas(id_cliente*, usuario_id, endpoint, resultado, procesada_en)    -- cada cambio del teléfono lleva su identificador: reenviarlo nunca lo duplica
preferencias_aviso(usuario_id, tipo_aviso, canal ['push','correo'], activo)
```

---

# PARTE 3 — Lo que la base hace cumplir (en vez de la pantalla)
- **Existencia nunca negativa** y **un solo punto de escritura** de movimientos.
- **Un solo checklist abierto** del mismo tipo por orden o equipo (restricción única sobre `abierto_clave`).
- **NIT único** excepto `CF` (`nit_unico`); correo del colaborador único si existe.
- **Una línea de orden en proceso por técnico** (se verifica en la misma operación que inicia el trabajo).
- **Un solo enlace vigente** por entidad y tipo; la confirmación de una cita o cotización se hace en una sola operación (no se puede responder dos veces).
- **Orden cerrada o anulada** no admite cambios (se valida por la bandera del estado, no por el nombre).
- **Reserva** exige orden y vencimiento; **cotización** no crea trabajos por sí sola.
- **Numeración** sin repeticiones ni saltos (bloqueo de `secuencias`).
- **Fechas razonables** (año entre 1980 y hoy+30) en el servidor.

# PARTE 4 — Migración y arranque (resumen; se detalla al construir)
1. **Taller nuevo** nace con las migraciones del repositorio y una verificación semanal en el VPS (estándar §8).
2. **Sin clientes reales:** se respaldan y se borran `cafe` y `waga` al cambiar de sistema; **se conservan los datos de `enova`** (sin cobrarle) con un guion de migración que traduce tablas y valida cifras antes de abrir.
3. **Punto de verificación abierto:** el posible corrimiento de 6 horas en las fechas guardadas (hoy se guardan sin zona); se mide con datos reales de `enova` antes de migrar.
4. El taller de demostración se genera con datos sintéticos desde un guion propio.


---
# Aprobaciones de Luis
- **2026-11-11 — "Aprobado, sigamos":** aprobadas las 12 reglas de diseño, la **Parte 1 (plataforma, ahora 20 tablas con `codigos_publicos`)** y el **mapa general del taller (109 tablas con `puesto_credenciales`)**. La pregunta de la moneda no se contestó expresamente: **se toma por defecto una sola moneda por taller (quetzales), configurable**; precios con o sin IVA es configuración del taller.
- Siguiente: recorrido de las áreas del taller en tres tandas (A–E, F–J, K–O).

---
# TANDA 1 (áreas A–E) — semillas y puntos a confirmar (propuesta, 2026-11-11)
**Lo que nace sembrado en cada taller nuevo** (cada taller lo puede renombrar o ampliar):
- **Roles (8, igual que hoy pero en español):** administrador, gerente, supervisor, recepcionista, técnico, operador, bodeguero, visualizador. Los permisos de cada uno se siembran con las acciones `modulo.accion` que ya existen. El rol administrador no se puede quitar ni dejar sin permisos.
- **Niveles de técnico:** NIVEL 1, 2 y 3 (renombrables); la matriz técnico↔sistema se siembra **100 % permisiva** si no hay política real (estándar §17), con fila ausente = sin permiso.
- **Jornada general del taller:** lunes a sábado, 07:00–12:00 y 13:00–16:00 (las constantes de hoy), editable.
- **Credenciales:** LICENCIA DE CONDUCIR (con vencimiento), CERTIFICACIÓN (con vencimiento); el DPI se queda como dato del colaborador.
- **Grupo de insumos generales:** sistema 99 "INSUMOS GENERALES" (`es_insumos_generales`).
- **Tipos de orden:** REPARACIÓN (por defecto), MANTENIMIENTO, DIAGNÓSTICO, INSPECCIÓN, GARANTÍA y el tipo para repuestos de importación (nombre por confirmar: MATERIAL PENDIENTE). Se elimina "PÚBLICO" como tipo de orden (era un tipo de cliente colado como tipo de orden).
- **Estados de orden:** CREADA, EN PROCESO, EN REVISIÓN, TERMINADA, ENTREGADA, CERRADA y ANULADA. **Desaparece "Cita programada"** (las citas tienen su tabla). Terminada, Entregada, Cerrada y Anulada son terminales: no se edita salvo reapertura con motivo (como hoy).
- **Etapas de checklist:** OPERACIÓN (no requiere orden), RECEPCIÓN, MANTENIMIENTO, CALIDAD, ENTREGA.
- **Estados de línea de trabajo:** los 8 del estándar §17.
- **Estados de equipo:** activo, fuera de servicio, baja. "En taller" no se guarda: se calcula del ingreso físico (`ingresos_equipo`).
- **Tipos de documento de equipo:** tarjeta de circulación, calcomanía, seguro, documento de propiedad, factura, manual de operación, manual de reparación, garantía, contrato, otro (aviso 30 días antes del vencimiento).
- **Motivos:** rechazo de cotización (precio, repuesto no disponible, tiempo, otro), cancelación de cita, anulación de orden, diferencia de inventario, excepción de checklist.
- **Numeración:** se conserva el formato de hoy `<código de tipo de orden>-000001` (REP-000123), `SOL-` (solicitudes), `DEV-` (devoluciones) y se agregan `COT-` (cotizaciones), `COM-` (compras), `CTA-` (cuentas) e `INF-` (informes). Un contador por prefijo, sin año.

**Campos viejos que se eliminan por estándar o por duplicados:** ciudad, país y teléfono 2 del cliente (estándar §4; los contactos adicionales van en `contactos_cliente`); odómetro, horas y kilometraje dentro del equipo (viven en `contadores`); tipo de cobertura del equipo (sin uso comprobado); texto "nivel" y "cliente_texto" del colaborador.

**Puntos a confirmar con Luis:** (1) roles y niveles sembrados; (2) mostrar el código jerárquico de sistema/subsistema/parte junto al nombre o solo el nombre; (3) nombre del tipo de orden para repuestos de importación; (4) lista de estados de orden; (5) estados del equipo; (6) numeración.


---
# Tanda 1 (A–E): respuestas de Luis (2026-11-11)
1. Roles y niveles sembrados: **está bien.**
2. Códigos de sistema/subsistema/parte junto al nombre (letra pequeña) y búsqueda por ambos: **está bien.**
3. **Los tipos de orden son configurables**, incluido el sugerido "MATERIAL PENDIENTE" (viene sembrado pero se renombra o desactiva; la bandera `es_pedido_especial` la puede tener cualquier tipo).
4. **7 estados de orden por defecto y capacidad de crear estados adicionales:** los 7 de fábrica no se borran (sí se renombran); el taller crea más y elige sus banderas (inicial, terminal, cancelado); la lógica del sistema solo mira las banderas, nunca el nombre. Se agrega `es_sistema` a `estados_orden`.
5. Estados del equipo (activo, fuera de servicio, baja; "en taller" calculado): **está bien.**
6. Numeración (`<tipo>-000001`, SOL, DEV, COT, COM, CTA, INF): **está bien.**
**Tanda 1 aprobada.**

---
# TANDA 2 (áreas F–J) — cambios hechos al diseño y puntos a confirmar (propuesta, 2026-11-11)
**Ajustes ya aplicados arriba al revisar F–J:**
- **Lecturas de contador:** una lectura equivocada se **anula con motivo y permiso** (estado `anulada`), nunca se borra; el contador toma la última lectura válida; la lectura ingresada por el cliente puede quedar `pendiente_revision`.
- **Servicios programados:** pueden apuntar a un componente (`componente_tipo_id`) y llevar umbrales propios de aviso (`aviso_urgente`, `aviso_proximo`); si van vacíos rige el valor del taller.
- **Líneas de orden:** guardan `descuento_pct`, `total_linea` y **una copia de la tarifa y del costo por hora del momento** (`tarifa_hora_aplicada`, `costo_hora_aplicado`) para que el margen no cambie si después se modifican las tarifas.
- **Órdenes:** `origen` (directo o cita) y `cita_id` reemplazan a `modo_recepcion`; prioridades baja, media, alta, urgente; campo opcional `referencia_factura_externa` (número del sistema de caja del taller; el sistema no factura).
- **Citas:** ya no repiten la orden (la orden apunta a la cita) y llevan `horas_estimadas` para la planificación de carga.
- **Tipos de checklist:** `exige_lectura_contador` y `requiere_firma_cliente` (firma activable por tipo).

**Semillas de F–J:** unidades de contador KM, MI, HR y DÍAS; unidades de medida UNIDAD, LITRO, GALÓN, METRO, CENTÍMETRO, KILOGRAMO, LIBRA, JUEGO; tipos de contador ODÓMETRO (km), HORÓMETRO (horas) y CALENDARIO (días, automático, sin lecturas).

**Puntos a confirmar con Luis:** (1) lecturas del cliente: cuentan de inmediato, marcadas "ingresada por el cliente", y quedan por revisar si retroceden o implican un uso diario fuera de lo normal; (2) primer servicio de un equipo nuevo: la fecha base es el valor inicial del contador y el histórico se puede cargar a mano; (3) campo opcional con el número de factura del sistema de caja del taller; (4) plantillas básicas sembradas (RECEPCIÓN, CALIDAD, ENTREGA), editables; (5) prioridades de orden; (6) copia de tarifa y costo en cada línea.


---
# Tanda 2 (F–J): respuestas de Luis (2026-11-11)
1. **Las lecturas que da el cliente quedan SIEMPRE por revisar** (`pendiente_revision`) hasta que el personal del taller las valide o rechace; no cuentan para proyectar servicios mientras no estén validadas (el personal las ve como dato de apoyo en la cita y al recibir el equipo).
2. **El contador sí lleva valor desde que se crea el equipo** (no hay que esperar a que llegue al taller): al crear el equipo se agregan sus contadores con su valor inicial y fecha (queda como lectura de origen `inicial`), y también se puede cargar el **último servicio de cada tipo** (histórico). Esto cubre la carga inicial de una flota completa. *Propuesta derivada (por confirmar): plantilla de carga masiva en Excel para equipos, contadores y últimos servicios.*
3. Número de factura externa opcional en la orden: de acuerdo.
4. Plantillas básicas sembradas (RECEPCIÓN, CALIDAD, ENTREGA): de acuerdo.
5. Prioridades baja, media, alta, urgente: de acuerdo.
6. **Terminología:** lo que lleva cada trabajo es el **PRECIO**: horas de trabajo × tarifa horaria (la tarifa de venta del tipo de equipo, o de su área). "Costo" solo se usa para lo que le cuesta al taller (costo por hora del tipo de equipo, materiales, trabajos con terceros) y es interno: el cliente nunca lo ve. En la línea quedan: `horas_trabajo`, `tarifa_hora_aplicada` (copia, para que el precio ya fijado no cambie si luego se modifica la tarifa) y `precio`; el costo por hora (`costo_hora_aplicado`) se guarda aparte solo para calcular el margen.
**Tanda 2 aprobada**, con los ajustes 1, 2 y 6 ya aplicados al diseño.

---
# TANDA 3 (áreas K–O) — cambios hechos y puntos a confirmar (propuesta, 2026-11-11)
**Ajustes ya aplicados arriba:** cotizaciones con estado `reemplazada` (una cotización editada tras enviarla nace como versión nueva y la anterior queda reemplazada); líneas de cotización con `descuento_pct`, `total_linea` y `costo` (interno); firmas ligadas solo a checklists (Recepción y Entrega); en materiales, `precio_manual` opcional (vacío = precio por costo + margen).

**Avisos de fábrica (`avisos_config`), todos activables y con destinatarios por rol o persona:** servicio próximo, servicio vencido, condición en alerta, recordatorio de cita, repuesto cargado a la orden de MATERIAL PENDIENTE (al cliente), solicitud de material nueva (a bodegueros), cotización respondida (a quien cotizó y a recepción), cotización por vencer, documento de equipo por vencer, reserva por vencer, primera apertura de un enlace, resumen diario o semanal del taller.

**Puntos a confirmar con Luis:** (1) lista de avisos de fábrica y cuáles nacen activos; (2) vigencia por defecto de una cotización: 15 días, configurable (los enlaces de checklist y cuenta, 30); (3) cotización editada tras enviarla = versión nueva que reemplaza (el enlace anterior avisa que fue reemplazado); (4) precio de venta del material = costo (último o promedio, según configuración del taller) más el margen por clasificación, o un precio manual por material; (5) despacho de materiales solo desde bodegas de la misma sucursal que la orden (regla de hoy); (6) plantilla de carga masiva en Excel para equipos, contadores y últimos servicios.


---
# Tanda 3 (K–O): respuestas de Luis (2026-11-11)
1. **Avisos:** Luis no entendió el término "avisos de fábrica". Aclarado: son los avisos automáticos (correo, o aviso al teléfono) que el sistema **trae ya configurados** al crear un taller; cada taller los activa, apaga, cambia de destinatarios o de texto. Se reformula como **"avisos incluidos"**. *Pendiente: que confirme cuáles nacen activos.*
2. **Vigencia de una cotización: 15 días, configurable.** Aprobado.
3. Cotización editada tras enviarla: Luis preguntó si es el caso de rehacerla con un descuento adicional después de un rechazo. **Sí**, y también cualquier cambio de precios o de líneas. Mecánica propuesta: lo que el cliente ya vio no se edita; se pulsa "Crear nueva versión"; la anterior queda `reemplazada` y su enlace dice "esta cotización fue reemplazada" con botón a la vigente; las líneas ya **autorizadas** pasan a la versión nueva ya autorizadas y las rechazadas o cambiadas vuelven a quedar pendientes; el indicador de aprobación se mide sobre la última versión de cada cotización y se conserva la marca "se renegoció" (rechazo inicial → autorizada tras descuento). *Pendiente: que confirme esta mecánica.*
4. **Precio de venta del material** (costo, último o promedio según configuración, más margen por clasificación; o precio manual): **confirmado.**
5. **Despacho de materiales solo desde bodegas de la misma sucursal de la orden:** **confirmado.**
6. **Carga masiva en Excel** de equipos, contadores y últimos servicios: **confirmada.**


---
# Tanda 3 (K–O): confirmaciones finales (2026-11-11)
Luis respondió "Confirmados":
- **Avisos incluidos** (antes "de fábrica"): nacen **activos** solo servicio próximo, servicio vencido, solicitud de material nueva, cotización respondida y repuesto cargado a la orden de material pendiente; el resto nace apagado y cada taller lo enciende.
- **Nueva versión de una cotización:** como se explicó (lo autorizado pasa autorizado, lo rechazado o cambiado vuelve a pendiente, el enlace viejo avisa del reemplazo, el indicador se mide sobre la última versión con la marca "se renegoció").

**TANDA 3 APROBADA. Las tres tandas del taller (A–E, F–J, K–O) y la plataforma quedan aprobadas; falta solo la aprobación definitiva del conjunto.**
