# 09 — Checklists e inspecciones (revisiones) · LEÍDO COMPLETO (backend + frontend, salvo móvil)

Leído: `checklistService` (1.408), `routes/checklists` (857), `checklistNotificationService` (420), `paquetesInspeccionService` (192) y su ruta (99), `ChecklistViewer` (885), `OrderChecklistsPanel` (293), `InspeccionesPanel` (219), `ChecklistTypeSelector` (160), `Checklists.tsx` (921, administrador de plantillas), `Inspecciones.tsx` (160, "Revisiones Operativas"), `TechnicianChecklists.tsx` (183). Pendiente para otros módulos: la app móvil (módulo 15), los paquetes/estrategias y su cascada de reinicio (módulo 10), el enlace público del checklist (módulo 12).

## Qué hace (se conserva)
- **Plantillas:** un *tipo de checklist* (código, nombre, etapa, a qué tipos de equipo aplica, qué roles lo llenan) con *ítems* agrupados en secciones.
- **Al crear un checklist** (de una orden o suelto sobre un equipo) se **copian** los ítems de la plantilla a la respuesta; cambiar la plantilla después no cambia el nombre de los ítems ya creados. Es la idea correcta y se conserva.
- **Semáforo por ítem** (verde / amarillo / rojo), nota y foto. **Amarillo o rojo exigen foto**, y esto sí lo exige el servidor al completar.
- **Lectura de contador obligatoria** al abrir un checklist ligado a una estrategia o paquete (km/horas), que alimenta el contador del equipo.
- **Completar** un checklist registra quién y cuándo, deja constancia en el historial de mantenimiento (con reinicio en cascada de los niveles inferiores) y avisa por correo.
- **Un checklist completado ya no se modifica** (candado del servidor desde V3.105).
- **Etapas** (Operación, Recepción, Mantenimiento, QC, Entrega) con la bandera "requiere orden": solo la etapa Operación se puede llenar suelta, sobre el equipo ("Revisiones Operativas").
- **Informe y aviso:** PDF de todos los checklists de una orden, descarga y envío al cliente; correo automático al completar cada checklist (destinatarios configurables).
- **Mis checklists** del técnico: los de las órdenes activas donde tiene trabajos asignados.

## Hallazgos
1. **Un ítem en rojo o amarillo no genera nada.** Se marca, se pide foto y se completa el checklist, pero no nace ningún aviso, trabajo, orden ni seguimiento: solo cuenta en el correo. Una inspección que encuentra un freno malo y no crea el trabajo para repararlo no cierra el ciclo.
2. **La lectura de contador "obligatoria" solo se exige en pantalla.** El servidor deja responder ítems y completar el checklist sin haberla registrado. Y en "Mis checklists" del técnico ni siquiera se pide, porque esa pantalla abre el checklist sin el equipo (el visor sale de su carga de contador cuando no recibe `equipoId`).
3. **Completar no tiene protección contra repetirse.** `PUT /:id/complete` no revisa si ya estaba completado: un doble clic o reintento vuelve a escribir la fecha de cierre y **duplica los reinicios en cascada** del historial de mantenimiento (las filas de niveles inferiores no tienen `checklist_id`, así que nada las detiene). Además el proceso (estado + historial + cascada) no es una sola transacción: si falla a la mitad queda completado sin historial.
4. **El aviso por correo se puede repetir.** Evita duplicados buscando `[CHK-n]` en el asunto, pero si la empresa configuró su propio asunto ese texto no está, y cada completado envía otra vez.
5. **Los datos de tipo de equipo vienen del navegador, no del equipo.** Al crear un checklist, qué ítems se copian depende del `tipo_equipo_codigo` que mande el cliente; si no lo manda, se copian **todos** los ítems de la plantilla, incluidos los de otros tipos de equipo. El servidor tampoco comprueba que el tipo de checklist aplique a ese equipo ni que el rol del usuario pueda llenarlo (eso solo filtra la lista en pantalla).
6. **Se puede crear un checklist vacío** (plantilla sin ítems) y completarlo de inmediato. Crear el checklist y sus ítems no es atómico (un ítem por consulta, sin transacción) y la revisión "ya existe uno pendiente" no tiene candado: dos clics a la vez crean dos.
7. **La sección y la descripción del ítem no se congelan.** El nombre sí se copia, pero la sección y la descripción se leen en vivo de la plantilla: editar una sección cambia cómo se ven checklists ya completados (aunque la tabla de respuestas tiene la columna `section`, no se llena).
8. **Roles escritos a mano.** La lista de roles que pueden llenar un checklist es fija (5 roles, sin supervisor ni bodeguero), el servidor restringe al "operador" con una lista de rutas permitidas según el nombre del rol, y los destinatarios del aviso se buscan por el campo viejo `users.role`. Un rol nuevo no se puede usar.
9. **El informe al cliente se arma en el navegador.** El PDF (texto plano, sin fotos) lo genera el navegador de quien pulsa el botón y se envía al servidor como archivo; el servidor lo adjunta **sin revisarlo**, a **cualquier correo** que se escriba en el campo, con el nombre de la empresa. Es un canal para mandar cualquier archivo a cualquier persona desde el correo de la empresa. Además el cuerpo HTML del correo inserta nombre del cliente y número de orden sin escapar.
10. **Mensajes de éxito mostrados como error:** "Checklist completado exitosamente" y "Cliente notificado correctamente…" se muestran con `toast.error` (rojo).
11. **La frecuencia de las revisiones no se ve nunca.** El servidor devuelve `frecuencia_intervalo`, la pantalla lee `frecuencia_intervalo_dias`: siempre dice "Sin frecuencia asignada". Además, la consulta de checklists de un equipo une con todos los paquetes donde aparece el tipo, así que si un tipo está en dos paquetes **duplica los ítems contados** (total y completados).
12. **Una sola foto por ítem.** Subir otra reemplaza la ruta y deja el archivo anterior huérfano en el servidor; solo JPG/PNG (no WebP ni las fotos de iPhone) y no se revisa el contenido real del archivo (a diferencia de las fotos de los trabajos, que sí).
13. **Aplicabilidad por ítem a medias:** existe la tabla `checklist_template_tipos_equipo` y la consulta la usa, pero ninguna pantalla ni ruta la escribe: es código a medio construir. `frecuencia_default` del tipo se acepta y se guarda, pero nadie la usa.
14. **Etapas fijas en la pantalla, configurables en el catálogo.** Colores, íconos, orden (`FIELD(..., 'Operacion', 'Recepcion', …)`) y el panel de progreso general suponen exactamente las 5 etapas; una etapa nueva del catálogo no tendría color ni orden.
15. **Nada obliga a hacer los checklists.** Una orden se puede cerrar sin haber hecho la recepción ni el control de calidad: no hay checklists requeridos por tipo de orden o por etapa.
16. **El técnico/operador no queda ligado a su trabajo.** Cualquiera con permiso de editar puede llenar o completar cualquier checklist de cualquier equipo; "completado por" solo registra quién fue. No se pide que el checklist lo llene el técnico asignado ni que un operador solo vea sus equipos.
17. **Administrador de plantillas:** carga los ítems de cada tipo con una consulta por tipo (40 tipos = 40 consultas); los ítems no se pueden reordenar ni copiar una plantilla; la sección es texto libre (un error de dedo crea otra sección); los formularios de crear y editar están repetidos; "Eliminar tipo" dice que borra los ítems pero solo lo desactiva, y no revisa si un paquete o estrategia lo usa.
18. **Sondeo de columnas en cada petición** (`information_schema` para `semaforo`, `year`, `color`, `vin`, `equipo_id`, `notify_email`) en el informe y en el aviso; la lista de tipos tiene un modo "por si falta una tabla" (migraciones viejas). Código muerto: `completeChecklistItem`, `completeChecklist`, `getOrderChecklists`, `getChecklistByOrderAndStage`, y el endpoint `orden-sugerida` (sin quien lo llame desde V3.051).
19. **Los datos del paquete de inspección duplican a la estrategia de mantenimiento:** `paquetes_inspeccion` + `paquete_inspeccion_niveles` repiten el mismo mecanismo (niveles múltiplos exactos, cascada de reinicio) que `estrategias_mantenimiento`. Se resuelve en el módulo 10.
20. **Lo que no hay:** otro tipo de respuesta (sí/no, número con unidad y rango, texto, selección), firma del responsable, ni hora/ubicación de la revisión; el semáforo es lo único. Tampoco hay modo sin conexión en el visor web (la app móvil es otro módulo).

## Diseño nuevo (propuesta)
- **Plantilla versionada.** Al editar una plantilla se crea una versión; los checklists nuevos usan la última y los ya creados conservan la suya (nombre, sección, descripción y orden copiados). Secciones como una lista propia de la plantilla (no texto libre por ítem), ítems ordenables, "duplicar plantilla".
- **Tipos de respuesta por ítem:** semáforo (por defecto, como hoy) y, si Luis lo aprueba, sí/no, número (con unidad y rango aceptable), texto y elegir de una lista. Un número fuera de rango marca el ítem en rojo solo.
- **Hallazgos con seguimiento.** Cada ítem rojo o amarillo genera un *hallazgo* (equipo, checklist, ítem, gravedad, foto). Un hallazgo se **atiende** (se convierte en un trabajo de la orden abierta, o abre una orden nueva) o se **descarta con motivo**; queda en el historial del equipo y en un tablero de "hallazgos abiertos". El semáforo amarillo puede configurarse como "vigilar" (seguimiento sin trabajo inmediato).
- **Reglas en el servidor, no en la pantalla:** lectura de contador exigida antes de responder y de completar; aplicabilidad (tipo de equipo, rol/permiso) validada al crear; ítems tomados del tipo real del equipo; no se crea un checklist sin ítems; no se completa dos veces; crear y completar en una transacción; un solo checklist abierto del mismo tipo por orden/equipo con restricción única.
- **Permisos por acción** (ver, crear, llenar, completar, administrar plantillas, enviar informe) asignables a cualquier rol; la lista de roles de la plantilla sale de los roles reales de la empresa.
- **Checklists requeridos configurables:** por tipo de orden y etapa ("Recepción antes de iniciar trabajos", "Control de calidad antes de terminar"), con aviso o bloqueo según decida la empresa.
- **Varias fotos por ítem** (límite configurable), tipos JPG/PNG/WEBP/HEIC con revisión del contenido, y la clasificación antes/después ya acordada para las fotos del trabajo.
- **Informe al cliente generado por el servidor**: PDF con la marca de la empresa, semáforo y fotos, enviado solo al correo del cliente/contacto de la orden (o uno escrito, avisando) y también como enlace público (módulo 12). Un solo informe, no dos.
- **Aviso por correo único** (restricción en base de datos por checklist y evento), plantilla del correo con sus textos propios, destinatarios por rol real.
- **Etapas:** lista de etapas configurable (nombre, color, orden, "requiere orden") sin suposiciones fijas en pantalla.
- **Una sola pantalla de lista y de llenado** para técnico, operador y escritorio (el visor es el mismo), con la lectura de contador siempre disponible; frecuencia visible y correcta.

## Decisiones necesarias de Luis
1. **Hallazgos.** Recomiendo que cada ítem rojo/amarillo cree un hallazgo con seguimiento (convertir en trabajo de una orden, abrir orden nueva o descartar con motivo), con tablero de hallazgos abiertos por equipo y cliente. ¿De acuerdo? ¿El amarillo también crea hallazgo, o solo el rojo (y el amarillo queda como "vigilar")?
2. **Checklists requeridos.** Recomiendo que cada empresa decida, por tipo de orden y etapa, qué checklists son obligatorios y si faltar bloquea el avance de la orden o solo avisa. ¿Lo hacemos así, o por ahora todo queda opcional como hoy?
3. **Tipos de respuesta.** Hoy solo hay semáforo. Recomiendo agregar sí/no, número (con unidad y rango aceptable) y texto, para revisiones como "presión de llantas" o "nivel de aceite". ¿Se agregan o se mantiene solo el semáforo?
4. **Informe al cliente.** Recomiendo que lo arme el servidor (PDF con fotos y marca) y se envíe por correo al contacto de la orden o por enlace público, y que se elimine el PDF armado en el navegador. ¿De acuerdo?
5. **Fotos.** Recomiendo varias fotos por ítem (por ejemplo hasta 5, configurable) con tipos JPG/PNG/WEBP/HEIC. ¿De acuerdo, o una sola es suficiente?
6. **Quién llena.** Hoy cualquiera con permiso llena cualquier checklist. Recomiendo: permiso por acción; el técnico ve y llena los checklists de las órdenes donde tiene trabajos asignados; el operador ve y llena solo los de los equipos que tiene asignados (las revisiones operativas diarias). ¿De acuerdo? ¿Otra persona (supervisor, jefe de taller) puede llenar el checklist de otro?
7. **Plantillas.** Recomiendo plantillas versionadas (lo ya completado nunca cambia), secciones propias, ítems ordenables y duplicar plantilla. ¿Se conserva también la aplicabilidad por tipo de equipo **a nivel de ítem** (un ítem que solo sale para ciertos equipos) o basta con aplicar el checklist completo a un tipo de equipo, como hoy en la pantalla?
8. **Firma.** ¿Debe poder firmarse el checklist (técnico y, en recepción/entrega, el cliente en pantalla)? Hoy no existe.


---
# Decisiones de Luis sobre checklists (2026-11-10)
1. **Hallazgos:** cada ítem en rojo DEBERÍA crear trabajo nuevo (es para eso que se inspecciona: generar trabajo en el taller de servicio, o corregir fallas en la flota propia), pero NO necesariamente termina en trabajo: el cliente puede no autorizar por precio, disponibilidad de partes o tiempo de reparación. **Problema real (35 años de experiencia en talleres de Guatemala):** si el repuesto no está en el mercado o hay que importarlo, el vehículo se va con el defecto; el pedido al extranjero se controla fuera del sistema (Excel) como "pedido especial"; cuando llega la pieza (1 semana a 1 mes) depende del criterio del bodeguero y el recepcionista avisarse y avisar al cliente; el cliente vuelve 3 meses después y nadie se acuerda o ya vendieron la pieza. **Solución pedida:** generar una ORDEN DE TRABAJO con ese pedido/solicitud de material que quede abierta hasta que el cliente regrese; el control/auditoría semanal de órdenes abiertas vs vehículos en el taller crea el seguimiento. **En una flota propia**, si no se obliga a reparar lo que está malo, las fallas se acumulan y el piloto se acostumbra a andar así.
2. **Checklists requeridos** por tipo de orden y etapa: de acuerdo (cada empresa decide cuáles y si bloquea o solo avisa).
3. **Otros tipos de respuesta** (sí/no, número con unidad y rango, texto, lista): de acuerdo.
4. **Informe al cliente** generado por el servidor (PDF con fotos y marca, por correo al contacto o enlace público): de acuerdo.
5. **Fotos:** máximo 5 por ítem, NO configurable; más tipos de imagen (WEBP, HEIC): de acuerdo.
6. **Quién llena:** además de técnicos y operadores, SOLO un supervisor o gerente puede llenar checklists.
7. **Plantillas con versiones:** de acuerdo. Los ítems son libres, SIN aplicabilidad por tipo de equipo a nivel de ítem (se elimina esa tabla a medias).
8. **Firma:** Luis pregunta cómo sería (¿con el dedo en un campo libre?). Respuesta/propuesta: sí, dibujada con dedo o lápiz en pantalla, solo del CLIENTE en Recepción y Entrega, activable por tipo de checklist; el técnico no firma (queda registrado quién lo completó). Por confirmar.

## Diseño de hallazgos que deriva de la decisión 1 (propuesta por confirmar)
- Estados del hallazgo: **abierto → autorizado (se convierte en trabajo de la orden o en orden nueva) / en espera de repuesto (pedido especial, ligado a solicitud de material y a una orden que queda abierta) / no autorizado (motivo: precio, partes, tiempo, otro) / resuelto / descartado (motivo, solo gerente)**.
- **Orden "en espera"**: la orden de seguimiento queda abierta con un estado propio (esperando repuesto / esperando al cliente) y el equipo marcado FUERA del taller. Esto relaja la regla anterior "toda orden nace con el equipo presente": se registra entrada y salida física del equipo.
- **Pedido especial ligado a la orden**: la compra al extranjero se registra como compra con línea "pedido especial para la orden X"; al recibirla en bodega el material queda **reservado** a esa orden (no se puede vender ni despachar a otra) y el sistema avisa al recepcionista y al bodeguero, y manda aviso al cliente (correo/WhatsApp); recordatorios si el cliente no responde.
- **Auditoría semanal**: reporte de órdenes abiertas vs equipos que físicamente están en el taller: (a) en taller con orden abierta; (b) con orden abierta pero fuera del taller (espera de repuesto/cliente) con antigüedad y dato de pieza; (c) en taller sin orden abierta; (d) piezas recibidas sin que el cliente haya regresado (días de espera).
- **Flota propia**: los hallazgos rojos no se pueden descartar sin autorización de gerente, y se ve la acumulación de hallazgos abiertos por equipo y por piloto/operador.


> **Actualización 2026-11-10 (aclaración de Luis):** los estados "en espera de repuesto" y la compra ligada a la orden quedan SIN EFECTO; ver el bloque "Aclaración de Luis: solicitudes de material, pedido especial y reservas" al final de 08_INVENTARIO.md. El hallazgo se resuelve con: abierto, autorizado, no autorizado, resuelto, descartado.


---
# Decisiones de Luis (2026-11-11): rojo = cotización, amarillo = solo foto (REEMPLAZA el diseño de hallazgos anterior)
- **Solo el ítem ROJO genera una COTIZACIÓN**, que puede convertirse en trabajo **si el cliente la autoriza** (con cuidado: la conversión NO es automática).
- **El ítem AMARILLO solo obliga a tomar foto.** No genera hallazgo ni cotización ni seguimiento (se descarta el "amarillo = vigilar" propuesto).
- **La cotización debe configurarse bien:** incluye **trabajos, materiales y posibles trabajos con talleres terceros.**
- **Se envía al cliente por un enlace.** Al abrirlo aparecen los hallazgos (ítems en rojo), las fotos, los precios y, para **cada línea de la cotización, el campo AUTORIZADO o RECHAZADO.**
- **La respuesta del cliente cambia el estado del ítem, pero NO genera una orden de trabajo ni trabajos en la orden de manera automática.**
- Quedan sin efecto los estados de hallazgo propuestos antes (abierto / autorizado / no autorizado / resuelto / descartado) y el tablero de hallazgos: el seguimiento ahora es por **cotización y por estado de sus líneas.**
- Consecuencia: el indicador "hallazgos convertidos en trabajo" del catálogo de 10 KPI (módulo 11) pasa a ser "**cotizaciones autorizadas sobre cotizaciones emitidas**" (y valor cotizado contra valor autorizado).
- Consistencia con el módulo 12 (autorización por el cliente con motivo y registro de fecha, hora y dispositivo; enlaces con vigencia configurable): la cotización es el instrumento de esa autorización.
- **Firma del cliente:** cerrada por la decisión 4 del módulo 15 (con el dedo, en recepción y entrega).


---
# Aclaraciones de Luis sobre la cotización (2026-11-11, segunda ronda)
- **El checklist también debe mostrar el desenlace de cada ítem rojo** (autorizado o rechazado), "para referencia futura": si dentro de un año se abre una segunda orden, nadie sabría qué pasó con solo mirar el checklist. Al revisar un checklist se ven los rojos **y si se aprobaron o no.**
  - *Cómo se cumple sin tocar lo ya completado:* las respuestas del checklist (semáforo, foto, notas, quién y cuándo) no cambian nunca. El desenlace se guarda de forma permanente en la **línea de la cotización ligada a ese ítem** y se muestra junto a cada rojo en el checklist, en el informe PDF al cliente, en el historial del equipo y en el portal. Valores del desenlace: sin cotizar / cotizado sin respuesta / autorizado / rechazado (con motivo) / agregado a la orden N (con fechas).
  - *Propuesta (por confirmar):* en la siguiente revisión del mismo equipo se muestran los rojos anteriores que fueron rechazados o quedaron sin responder, para que se vea si el defecto persiste.
- **Botón "Agregar a la orden"**: de acuerdo. Lleva a la orden, sin escribirlos a mano, los trabajos y materiales de las líneas autorizadas; lo pulsa una persona con permiso (no es automático).
- **KPI de aprobación (para conclusiones de venta adicional):** % de trabajos aprobados (por líneas y por valor); y **KPI de rechazo** con la distribución de motivos. Se pueden ver por tipo de equipo, por ítem de checklist, por cliente y por período; con meta y semáforo como los demás indicadores.
- **"Reemplazo" (aclarado):** el diseño anterior de *hallazgos* con estados propios (abierto, autorizado, no autorizado, resuelto, descartado) y su tablero se descartó porque la cotización con el desenlace por línea ya cubre ese seguimiento. No hay nada que hacer.
- **Trabajos adicionales:** pregunta de Luis (¿menú propio, botón dentro de la orden o dentro de cada trabajo?). Respuesta propuesta: documento único "Cotización" con **menú propio para el seguimiento** y **botón dentro de la orden** (pestaña Cotizaciones); no por trabajo. Pendiente de confirmar.


---
# Confirmación de Luis (2026-11-11): cotización
Luis respondió "de acuerdo con todas". Quedan aprobados:
1. **La cotización es un documento único con un solo enlace**, con dos puertas: (a) **pestaña "Cotizaciones" dentro de la orden** con el botón "Nueva cotización" (ya trae equipo, cliente y orden; recibe como borrador los rojos de los checklists de esa orden; sirve para trabajos adicionales); (b) **menú propio "Cotizaciones"** para seguimiento (borradores, enviadas sin respuesta, autorizadas, rechazadas), cotizar sin orden y recibir los rojos de las revisiones operativas sueltas. No se cotiza por trabajo individual.
2. **Permiso "cotizar"** asignable a los roles que la empresa elija: el rojo crea un borrador con el ítem y sus fotos y alguien completa las líneas (trabajos del catálogo con precio por horas, materiales del inventario, trabajos con terceros) y lo envía.
3. **Flota propia:** los rojos también generan cotización, con costos internos, y la autoriza el rol que la empresa defina en lugar del cliente.
4. **Rojos anteriores:** en la siguiente revisión del mismo equipo se muestran los rojos previos rechazados o sin respuesta.
5. **Motivos de rechazo:** precio, repuesto no disponible, tiempo, otro; con fecha y hora.
