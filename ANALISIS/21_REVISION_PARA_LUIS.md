# 21 — Lo que Luis debe revisar o decidir (se va llenando durante la construcción)

Última actualización: 2026-11-12, trabajando de corrido durante la noche (Fase 4). Todo está en **https://pruebas.veritech.lat** (nada de producción).

**Cómo entrar a probar:** desde el panel de administración de pruebas, entrar a un taller con el botón «Entrar» (sesión de soporte); el taller de práctica se llama `prueba1`. Los datos que se siembran para verificar se borran al terminar; si desea ver pantallas con datos, cree usted los suyos (cliente, equipo, trabajo del catálogo).

Cada sección dice **qué probar** y **qué decidí yo mientras usted dormía** (por si desea cambiarlo).

---

## Fase 3e — Cargar y descargar datos
**Qué probar:** Configuración → «Cargar y descargar datos». Descargue la plantilla de equipos, llénela con 3 o 4 equipos de verdad y use «Probar sin guardar»; después «Cargar de verdad». Descargue el libro de Excel y el .zip.
**Decidí yo:**
- «Últimos servicios» no se puede cargar todavía (no existen los servicios hasta la parte 4e/Fase 5).
- La bitácora no sale en la descarga (puede ser enorme): pendiente bajarla aparte en CSV.

## Fase 4a — Órdenes de trabajo
**Qué probar:** menú «Órdenes». Cree una orden (busque un equipo por placa), agregue un trabajo del catálogo (necesita que el trabajo tenga horas para ese tipo de equipo: Equipos → Tipos de equipo / catálogo de trabajos), cambie estados, intente cerrar con un trabajo pendiente, anule una orden.
**Decidí yo:**
- Una orden pertenece a UN equipo (el cliente sale del equipo). Los equipos del propio taller no llevan cliente.
- «Cerrada» y «Anulada» son los estados que bloquean la orden (así lo dicen las banderas de los estados). «Entregada» saca al equipo del taller pero la orden aún se puede tocar.
- Si el trabajo no tiene horas para el tipo de equipo, el sistema pide escribirlas a mano en esa línea.
- Los materiales no se pueden agregar todavía (llegan con Inventario, Fase 5).
- Permisos: técnico y operador solo ven órdenes (sin precios); recepción ve precios y no costos; supervisor ve precios; gerente y administrador ven todo y solo ellos reabren una orden cerrada.

## Fase 4b — Tiempos reales, fotos y «Mis trabajos»
**Qué probar:** entre como un técnico (cree un colaborador con puesto de técnico y acceso, o use un usuario de pruebas), asígnele un trabajo desde la orden, y en «Mis trabajos»: Iniciar → Pausar → Detener por… → Terminar; suba una foto antes y otra después. Ojo: desde el celular la foto se reduce sola.
**Decidí yo:**
- Un técnico no puede tener dos trabajos en proceso a la vez (lo hace cumplir también la base de datos).
- Iniciar un trabajo exige técnico asignado. Un trabajo en proceso no cambia de técnico (primero se pausa).
- La matriz nivel × sistema: un colaborador **sin nivel asignado no tiene restricción**; con nivel, rige la matriz (que hoy viene toda habilitada).
- La recepción puede editar órdenes pero «Mis trabajos» solo existe para quien tiene el permiso `ordenes.trabajar` (administrador, gerente, supervisor y técnico).
- Hasta 20 fotos por trabajo. Terminar no pide confirmación (se puede volver a poner en proceso).
- El estado de la orden **no** cambia solo cuando empieza el primer trabajo: se cambia a mano (decisión pendiente: ¿quiere que pase sola a EN PROCESO?).

## Fase 4c — Citas
**Qué probar:** menú «Citas»: agende una cita para mañana (busque un equipo), reprográmela, cancele otra con motivo; cuando llegue la hora (o cambiando el día), pruebe «Recibir» (abre la orden) y «No se presentó». En Configuración → General, sección «Citas», cambie entre «solo coordinar» y «reservar», y en Configuración → Sucursales ponga un cupo diario para ver la diferencia.
**Decidí yo:**
- Hora de la cita: se escribe en la hora del taller; no se pueden agendar citas en días pasados.
- «Solo coordinar» (por defecto): si el cupo del día está lleno, avisa pero agenda. «Reservar»: rechaza. El cupo es por sucursal.
- «No se presentó» solo se puede marcar cuando ya pasó la hora de la cita.
- «Recibir» pide además el permiso de crear órdenes. El técnico, el operador y el visualizador ven las citas pero no las agendan; el bodeguero no las ve.
- Todavía no hay: planificación de carga por día/7 días/30 días (usa las horas estimadas; llega con los reportes), aviso al cliente de la cita (Fase 7), cita pedida por el cliente desde el portal (Fase 7) ni la cita nacida de un aviso de servicio (parte 4e).

## Fase 4d — Checklists
**Qué probar:** Configuración → Checklists: mire los tres sembrados (RECEPCIÓN, CALIDAD, ENTREGA), abra «Plantilla», cambie un ítem y guarde (crea la versión 2). En una orden, sección «Checklists» → agregue «Recepción del equipo», llénelo (pruebe un ítem en rojo: pide foto), pida la firma con el dedo (o con el ratón) y complételo. Luego, en «Qué checklists pide cada tipo de orden», pida CALIDAD «antes de cerrar la orden» (bloquear) y pruebe cerrar una orden sin él; si usted es administrador verá el botón para autorizar una excepción con motivo.
**Decidí yo:**
- Los requisitos vienen VACÍOS: ningún tipo de orden exige checklists hasta que usted lo configure (así no se frena el trabajo desde el primer día).
- Un checklist completado no se puede reabrir (candado). Si se equivocan, se abre otro del mismo tipo.
- Para completar RECEPCIÓN/ENTREGA se exige la lectura del medidor (se toma la de la orden si ya existe) y la firma del cliente.
- Solo administrador y gerente configuran tipos y plantillas; administrador, gerente y supervisor autorizan excepciones; técnico, operador, recepción y supervisor llenan.
- La firma y las fotos se guardan como archivos del taller y salen en la descarga de datos.
- Todavía no hay: informe PDF del checklist (Fase 6/7), la cotización que nace de un ítem en rojo (Fase 6) ni plantillas con aplicabilidad por ítem (solo por tipo de equipo, como se decidió).

## Fase 4e — Servicios programados
**Qué probar:** menú «Servicios» → Programas: cree «Servicio de 10 000 km» para un tipo de equipo (contador: odómetro, cada 10 000). Vaya a un equipo de ese tipo → pestaña «Servicios»: verá cómo va el reloj; registre lecturas del odómetro para ver cómo pasa a próximo, urgente y vencido; cargue un servicio ya hecho; agende la cita desde «Servicios → Por atender».
**Decidí yo:**
- El primer servicio de un equipo se cuenta desde el valor INICIAL de su contador (si el odómetro entró con 125 000 km y el servicio es cada 10 000, toca a los 135 000), salvo que se cargue un servicio anterior.
- Avisos sugeridos si no se escriben: kilómetros 1 000 y 200; millas 600 y 120; horas 50 y 10; días 30 y 7.
- Los servicios se definen por TIPO de equipo y todos los equipos de ese tipo los siguen. Un servicio de un contador que el equipo no tiene aparece como «Sin contador».
- Un checklist que respalda un servicio lo registra como realizado al completarse (con el valor del contador de ese momento).
- Solo contadores del equipo (no de componentes) por ahora; la cascada «un servicio incluye a otro» (servicio_incluye) NO se construyó: era opcional y avanzada.
- «Revisar avisos» solo anota qué avisos corresponde mandar; el correo o el aviso al teléfono llegan con la Fase 7 (avisos incluidos). Todavía no corre solo cada noche.
- La planificación de carga y la «lista del servicio» (kit) quedaron fuera a propósito (usted pidió olvidar el kit).

## Fase 5a — Inventario (materiales, compras, traslados, diferencias, márgenes)
**Qué probar:** menú «Inventario». (1) Pestaña Materiales → «Nuevo material»: código, nombre, clasificación (elija «99 Insumos generales» para aceite, trapos, etc.), unidad. (2) Pestaña Compras → «Registrar compra» con 2 materiales: vea que sube la existencia y el costo promedio. Repita con otro costo para ver el promedio ponderado. (3) Abra un material → «Trasladar» a otra bodega (cree una segunda bodega en Configuración → Áreas y bodegas) y «Corregir cantidad». (4) Pestaña Márgenes: defina 50 % para un sistema y 80 % para un material y vea el precio en la ficha. (5) Pestaña Movimientos: todo queda ahí.
**Decidí yo:**
- Las cantidades de inventario son SIEMPRE enteras (para medio metro use centímetros). La unidad de un material no se cambia cuando ya tiene movimientos.
- El margen general por defecto es 30 % y el precio se calcula con el costo promedio (ambos se cambian en Configuración → General, grupo «precios»). Un precio fijo en el material manda sobre todo.
- La clasificación es obligatoria porque de ella sale el margen. Los insumos generales cuelgan de un sistema «99» creado por la migración.
- La compra no se puede anular ni editar (como todo documento): un error se corrige con otra compra o con una diferencia con motivo. Fecha de la factura no puede ser futura.
- Quién hace qué: bodeguero recibe, traslada y corrige cantidades; solo administrador/gerente cambian el catálogo y los márgenes; los costos se ven solo con el permiso «ver costos».
- Todavía no hay (Fase 5b/5c): solicitudes de material y despacho a una orden, devoluciones, reservas, aplicabilidad de materiales a equipos y alertas de mínimo por correo.

## Estado de verificación (2026-11-12)
Probado en navegador real en el taller de práctica: 4c (agendar, reprogramar, recibir → orden), 4d (checklist con firma; bloquea sin foto/firma; queda cerrado), 4e (servicio programado, «urgente», agendar cita desde el servicio), 5a (material, compra, traslado). **Sin probar en pantalla:** cancelar cita y «no se presentó», subir fotos en checklist, «corregir cantidad» y márgenes (las pruebas automáticas sí los cubren). Para probar usted mismo la foto del checklist, hágalo desde un celular.

## Fase 5b — Solicitudes de material, despacho y devoluciones
**Qué probar:** (1) Abra una orden → sección «Materiales» → «Pedir materiales»: busque un material (ya con existencia por una compra) y pida 3. (2) Entre a Inventario → pestaña «Solicitudes» (como bodeguero o administrador): abra la solicitud, elija la bodega y despache 2 (queda DESPACHADA PARCIAL), luego el resto. (3) Vuelva a la orden: el material aparece en la lista de trabajos con su precio, el descuento del cliente y el total ya sumado. (4) En la solicitud, «Devolver» 1: sube la bodega y baja el cobro. (5) Pida otra y anúlela con un motivo.
**Decidí yo:**
- Una línea de material por material pedido: el **precio** se fija en el primer despacho (costo promedio más el margen de ese momento) y no cambia aunque después suba el costo; el **costo** sí se congela despacho por despacho.
- El material despachado se cobra con el **descuento de materiales** del tipo de cliente (el de «trabajos» no se mezcla).
- Despachar solo desde bodegas **de la misma sucursal de la orden**; no se puede despachar más de lo pedido ni más de lo que hay (todo o nada: si una línea falla, no se mueve nada).
- Una orden **con material despachado no se anula**: hay que devolverlo antes (para que el inventario no quede con material «sin dueño»). Al anular la orden, las solicitudes que no se despacharon se anulan solas.
- Una orden **cerrada o anulada** ya no recibe pedidos, despachos ni devoluciones (anular una solicitud pendiente sí se puede).
- La solicitud la anula quien la pidió, o quien tenga el permiso «anular solicitudes»; una despachada completa no se anula (se devuelve el material); una despachada parcial se anula en lo que falta.
- Una devolución no cambia el estado de la solicitud; el material vuelve con el costo con el que salió y el motivo es texto libre.
- Quién hace qué: pide el supervisor y el técnico (y administrador/gerente); despacha, devuelve y anula el bodeguero (y administrador/gerente); los costos del despacho solo los ve quien tiene «ver costos».
- Todavía no hay (5c): reservas, «cargar a la orden» desde una reserva, aplicabilidad de materiales a equipos, alertas de mínimo, el aviso por correo al bodeguero cuando llega una solicitud (Fase 7) ni el tablero del tiempo de despacho (Fase 7; los datos ya se guardan).

**Verificación de 5b (2026-11-12):** probado en navegador real en el taller de práctica: pedir 3 filtros desde la orden, despachar 2 (queda DESPACHADA PARCIAL) y luego 1 (DESPACHADA), devolver 1 con motivo; la orden quedó con 2 unidades a Q 65 = Q 130, costo Q 100 y su IVA. No probé en pantalla: anular una solicitud, despachar desde una segunda bodega ni el bloqueo al anular una orden con material (las pruebas automáticas sí los cubren).

## Fase 5c — Reservas, aplicabilidad a equipos y alertas
**Qué probar:** (1) En una orden → «Reservar material»: elija un material SIN existencia, cantidad 2, vence en 7 días. Abra la reserva: «Cargar a la orden» da error «no hay suficiente inventario». (2) En Inventario → Compras registre 2 unidades: la reserva muestra «Ya hay material completo» y arriba del Inventario sale el aviso. (3) «Cargar a la orden»: despacha y aparece en la orden. (4) Con otra orden, intente pedir y despachar ese mismo material mientras haya una reserva viva: no deja despachar las reservadas. (5) Abra un material → «A qué equipos les sirve»: ahí quedó anotado el tipo de equipo; pruebe «Agregar» una marca/modelo. (6) Al pedir material en otra orden de ese tipo de equipo, salen «sugeridos».
**Decidí yo:**
- La protección es por **sucursal**: lo reservado por una orden de una sucursal no lo pueden despachar otras órdenes de esa misma sucursal. Una orden **cerrada o anulada ya no protege nada** (anular la orden cancela sus reservas).
- Una reserva **vence al final del día** que usted pone (hora del taller) y se marca sola «vencida»; máximo 365 días. Una reserva vencida no se amplía ni se carga: se hace otra.
- Lo que se despacha **a la propia orden** (con una solicitud normal) cubre su reserva (la más vieja primero); al cubrirse todo, la reserva pasa sola a «cargada».
- «Cargar a la orden» saca el material de las bodegas de la sucursal de la orden (primero la que más tiene), todo o nada; pide el permiso de despachar.
- **Ampliar** lo hace quien tenga el permiso «gestionar reservas» (bodeguero, gerente, administrador), con motivo y una fecha posterior; **cancelar** lo hace quien reservó o quien gestione, con motivo; una reserva ya cargada no se cancela (se devuelve el material).
- Reservan: administrador, gerente, supervisor y recepcionista. Todos los demás roles la ven.
- Aplicabilidad: se anota tipo + marca + modelo del equipo cada vez que se despacha ese material (la marca y el modelo quedan vacíos si el equipo no los tiene, y entonces vale para todo ese tipo de equipo). A mano solo por tipo/marca/modelo (nunca equipo por equipo); un modelo exige la marca.
- Las **alertas** por ahora solo aparecen en pantalla (materiales bajo el mínimo, solicitudes sin despachar, reservas por vencer en 7 días o menos, reservas ya completas). El correo/aviso al teléfono llega con la Fase 7.
- El mínimo es **global por material** (suma de todas las bodegas), como hoy; un mínimo por bodega queda fuera.
- Todavía no hay: las reservas **no** se ven en la ficha del equipo; el aviso al cliente de que su pieza llegó lo manda recepción a mano (botón de correo/WhatsApp llega con la Fase 7).

**Verificación de 5c (2026-11-12):** probado en navegador real: reservar 2 bombas SIN existencia desde la orden; «Cargar a la orden» respondió «no hay suficiente inventario»; al llegar la compra salieron los avisos arriba del Inventario («material bajo el mínimo», «reserva con su material completo», «reserva vence en 7 días») y la reserva mostró «Ya hay material completo»; «Cargar a la orden» despachó y la reserva quedó «Cargada» con su solicitud; el material anotó solo que le sirve a VEHICULO. No probé en pantalla: ampliar/cancelar una reserva ni el bloqueo de despachar lo reservado para otra orden (las pruebas automáticas sí los cubren).

## Fase 6a — Cotizaciones (parte interna)
**Qué probar:** (1) Menú «Cotizaciones» → «Nueva cotización» → «De una orden»: agregue un trabajo del catálogo, un material y un trabajo con terceros; vea precios, descuento del cliente y total con IVA. (2) «Enviar al cliente»: ya no se edita. (3) En cada línea, «Autorizó» / «Rechazó» (el rechazo pide motivo); cuando todas tienen respuesta la cotización pasa a «Respondida». (4) «Agregar lo autorizado a la orden»: los trabajos aparecen en la orden y los materiales como solicitud a bodega. (5) En un checklist con ítems en rojo: «Cotizar los rojos»; después vuelva al checklist y verá qué pasó con cada rojo. (6) «Cambiarla (versión nueva)» en una enviada sin respuestas.
**Decidí yo:**
- Hasta que exista el enlace para el cliente (6b), la respuesta la **registra una persona del taller** a nombre del cliente (llamada, en persona; o la autorización interna de la flota propia): queda su nombre, la fecha y hora y el dispositivo. El permiso «registrar respuesta» lo reciben administrador, gerente, supervisor y recepcionista (la empresa lo reparte como quiera, también para el rol que autoriza en flota propia).
- Una línea respondida **no se cambia**. Una cotización enviada **no se edita**: si nadie respondió, «versión nueva» (queda COT-000001 v2 y la anterior «reemplazada»); si ya hay respuestas, se hace una cotización nueva solo para lo que falte.
- **Vigencia**: 15 días desde que se envía (Configuración → General → «Días de vigencia de una cotización»). Vence al final del día; lo autorizado antes de vencer se conserva y se puede llevar a la orden; lo no respondido queda «vencido».
- Los **precios se congelan al cotizar** (trabajos: horas × tarifa del tipo de equipo y del área; materiales: costo + margen; terceros: los que usted escriba). Lo único que cambia al llevarlo a la orden: los **materiales** se piden a bodega y se cobran con el precio del día en que se despachan (si el costo cambió entre tanto, puede diferir de lo cotizado).
- «Agregar a la orden» pide el permiso de editar órdenes, una orden **abierta** y del **mismo equipo**; una cotización sin orden pide elegir una.
- Un trabajo del catálogo solo se cotiza si la cotización tiene equipo (las horas y la tarifa dependen del tipo de equipo); sin equipo se pueden cotizar materiales y trabajos con terceros.
- Los **costos** (lo que cuesta al taller) solo los ven quienes pueden ver costos en las órdenes.
- Todavía no hay: el enlace público para que el cliente autorice solo, con registro de apertura (6b); los PDF y los documentos emitidos —cuenta, informe, cotización— (6c); el aviso por correo al enviar; la cotización de **revisiones operativas sueltas** (no existen todavía en el taller nuevo).

## Fase 6b — Enlace para que el cliente responda la cotización
**Qué probar:** abra una cotización enviada → «Crear enlace» → copie el enlace y ábralo en el teléfono (o en una ventana privada, sin iniciar sesión): verá la cotización, las fotos, y podrá autorizar o no autorizar cada línea y enviar con su nombre. Vuelva a la cotización: aparece «respondió… (por enlace)», cuántas veces abrieron el enlace y cuándo la primera vez. Pruebe «Crear otro enlace» (el anterior deja de servir) y «Revocar enlaces».
**Decidí yo:**
- **El enlace no se puede volver a ver**: en el sistema solo se guarda una huella (como una contraseña), así que se muestra una vez al crearlo; si se pierde, se crea otro (que anula el anterior).
- Vale **30 días** (Configuración → General → «Días de vigencia de un enlace para el cliente»). Aunque el enlace siga vivo, si la **cotización venció** se ve pero ya no se responde.
- Un enlace malo, vencido o revocado responde **siempre el mismo mensaje** (no se puede adivinar cuáles existen). Hay un tope de intentos por dirección de red.
- El cliente se identifica **escribiendo su nombre** (no hay códigos ni correo todavía): queda con fecha, hora, dispositivo y dirección de red. Si quiere un nivel más de seguridad (código por correo o teléfono), es una mejora de la Fase 7.
- Responde por línea y puede hacerlo **en varias visitas**; una línea respondida no se cambia. La cotización pasa a «respondida» cuando todas las líneas tienen respuesta; el taller sigue agregando lo autorizado a la orden con su botón (no es automático).
- **Primera apertura real**: no cuentan las vistas previas automáticas de WhatsApp, correo o buscadores (se reconocen por el tipo de navegador). El aviso al responsable cuando abren por primera vez llega con la Fase 7 (correo/teléfono): hoy queda registrado y se ve en la cotización.
- Solo hay enlaces de **cotización**; el enlace del checklist, de la cuenta y de la cita llegan con la Fase 7 (portal del cliente).

## Fase 6c — Documentos emitidos en PDF (cuenta, informe, cotización)
**Qué probar:** (1) Abra una orden con trabajos → «Cuenta en PDF» → «Emitir cuenta (PDF)»: se abre el PDF con el folio CTA-000001. Agregue otro trabajo y emita de nuevo: es la versión 2 y la anterior queda disponible. (2) Abra un checklist completado → «Informe en PDF». (3) En una cotización enviada → «Descargar PDF»; cuando el cliente responda, vuelva a descargar: sale una versión nueva con las respuestas.
**Decidí yo:**
- **No son facturas**: cada PDF lo dice abajo. Nunca llevan costos ni técnicos.
- Emitir es **idempotente**: si nada cambió desde la última emisión, no se crea otra versión (sale el mismo PDF). Si cambió algo, nace la versión siguiente con el mismo folio y apunta a la que reemplaza; las anteriores siguen consultables con su contenido original.
- El folio de la cotización es su número (COT-000001; si es una versión nueva de la cotización, COT-000001-V2). Dentro de una misma versión de la cotización, lo que cambia son las respuestas de las líneas y eso genera versiones del documento.
- Para **emitir una cuenta** hace falta poder ver precios de las órdenes; quien solo ve documentos puede verlos y descargarlos pero no emitir.
- El PDF usa las fotos en JPG/PNG (hasta 6 por ítem, pequeñas) y la firma del cliente en el informe.
- Todavía no hay: el **enlace público** del informe y de la cuenta para el cliente (Fase 7, portal), ni el envío por correo; el PDF de la cuenta no distingue «incluye costos» (nunca los lleva); el **logo** de la empresa en el encabezado (hoy sale el nombre, NIT, dirección, teléfono y correo de Configuración → General).

**Verificación de la Fase 6 (2026-11-13):** probado en navegador real en el taller de práctica: 6a (cotización desde una orden con trabajo del catálogo, envío, registro de autorización, «agregar a la orden», y «Cotizar los rojos» desde un checklist), 6b (abrir el enlace sin sesión, autorizar una línea y rechazar otra con motivo y nombre; el taller vio «MARIA LOPEZ» y 1 apertura) y 6c (cuenta en PDF con empresa, folio, hora del taller, detalle y totales). Sin probar a mano: informe en PDF con fotos y firma, la cotización en PDF y ampliar/versiones de documentos (las pruebas automáticas sí los cubren); la página del cliente en un teléfono real (se probó en pantalla de computadora).

## Fase 7a — Tablero de inicio por rol, indicadores y metas
**Qué probar:** entre con roles distintos (administrador, recepcionista, bodeguero, técnico) y vea cómo cambia el inicio. En Reportes → Indicadores elija «Este mes» y compare con «Mes anterior»; ponga una meta (por ejemplo, tiempo de despacho de bodega: meta 2 h, amarillo hasta 4 h) y vea el semáforo. En Reportes → «Motivos de rechazo» vea por qué rechazan las cotizaciones. En «Tablero por rol» quite o agregue tarjetas a un rol y vuelva a entrar con ese rol.
**Decidí yo:**
- **Definiciones** (todas están escritas en cada indicador de la pantalla): ticket promedio = lo vendido por orden completada, con descuentos y sin IVA aparte. Margen = (ventas − costo) ÷ ventas de las líneas de las órdenes completadas; la mano de obra cuesta lo que dice el **tipo de equipo** (como usted decidió), no el técnico. Días en taller = suma de las estadías del equipo por orden. Puntualidad de citas = llegó hasta 15 minutos después de la hora (solo cuentan las citas a las que sí se presentó). **Eficiencia** = horas vendidas ÷ horas realmente trabajadas, **solo en trabajos medidos con el cronómetro** (un trabajo terminado sin cronómetro no cuenta, para no inventar). **Utilización** = horas trabajadas ÷ (técnicos activos × días hábiles de lunes a viernes × 8 horas de jornada; la jornada se puede cambiar en Configuración). Cumplimiento de mantenimiento = servicios al día o por llegar ÷ servicios con reloj. Retrabajo = órdenes reabiertas ÷ órdenes completadas del periodo.
- Un indicador sin datos dice **«Sin dato»** (nunca cero inventado).
- El **periodo** son días del taller (hora de Guatemala): un cierre a las 11 de la noche cuenta ese día, no el siguiente.
- Tarjetas sugeridas: gerencia (dinero, vencidas, cotizaciones sin respuesta), supervisor/jefe de taller (carga, detenidos, sin técnico), recepción (citas, equipos en taller, entregas, reservas por vencer), bodega (solicitudes, despacho, mínimos), técnico (mis trabajos). Un rol que usted creó empieza con «órdenes abiertas» hasta que le elija tarjetas.
- Las **metas** tienen verde (cumple), amarillo (hasta un límite que usted pone) y rojo; si no pone límite, no hay amarillo.
- Todavía no hay (7c): exportar los reportes a Excel/PDF con nombre del reporte, empresa y fecha y hora de emisión, vistas guardadas, envío programado por correo, la búsqueda global ni los reportes de carga y de compras.

**Verificación de la Fase 7a (2026-11-13):** en el sitio de pruebas, con el administrador: el inicio muestra su tablero por rol; Reportes → Indicadores muestra los 12 indicadores con su base de fechas, el filtro de periodo con fechas DD/MM/YYYY y «Sin dato» donde no hay información; al poner una meta de 5 a «Órdenes completadas» el semáforo se puso rojo (0 de 5); «Motivos de rechazo» y «Tablero por rol» abren y muestran sus listas; sin errores en la consola. No pude comprobar con datos reales los números de los indicadores en pantalla porque el taller de práctica estaba vacío (los cálculos sí están probados con 7 pruebas automáticas contra datos armados). Datos de práctica ya limpiados.

## Fase 7b — Avisos incluidos
**Qué probar:** Configuración → pestaña **Avisos**. Encienda «Resumen diario» para su correo y pulse «Enviarme una prueba» (el correo sale cuando el servidor tenga el correo saliente configurado). Cree una solicitud de material: debe aparecer en «Avisos enviados» con el bodeguero como destinatario. Cambie el texto de un aviso y vea que la prueba usa su texto.
**Decidí yo:**
- Son **12 avisos** (los de la lista aprobada, menos «condición en alerta», porque hoy el sistema todavía no tiene ese concepto): servicio próximo, servicio vencido, recordatorio de cita, repuesto cargado a la orden de material pendiente, solicitud de material nueva, cotización respondida, cotización por vencer, documento de equipo por vencer, reserva por vencer, el cliente abrió su enlace, resumen diario y resumen semanal.
- Nacen **encendidos solo 5** (como usted confirmó): servicio próximo, servicio vencido, solicitud de material nueva, cotización respondida y repuesto cargado a la orden de material pendiente. Los otros 7 nacen apagados.
- **Destinatarios de fábrica** por rol (el taller los cambia): servicios → supervisor y gerente; solicitud de material → bodeguero; cotización respondida → recepcionista y quien hizo la cotización; documento por vencer → supervisor; reserva por vencer → bodeguero y quien reservó; resúmenes → gerente. A un aviso se le puede dar un rol, una persona o un correo suelto. Los avisos al cliente (cita, repuesto) le llegan al correo del cliente (o, si la orden trae uno, al de la orden).
- **Nunca se avisa dos veces lo mismo**: cada hecho tiene una clave (la cotización 15, la cita 8 de tal hora…) y queda en «Avisos enviados». Si una cita se reprograma, es otro hecho y se avisa de nuevo; si una reserva se amplía, igual.
- **Un aviso que falla no estorba**: si el correo no se puede preparar, la solicitud o la cotización se guarda igual y el problema queda en el registro del servidor.
- **Cuándo se detectan**: los avisos «de momento» salen al ocurrir el hecho (nueva solicitud, cotización respondida, primera apertura real del enlace, repuesto cargado). Los demás los revisa el servidor **cada 15 minutos**: servicios que empeoran de estado, citas del día siguiente (los días de anticipación se cambian), cotizaciones, documentos y reservas por vencer, y los resúmenes (a partir de las 7:00 del taller; el semanal solo los lunes).
- **Textos propios**: se guardan tal como se escriben (no en mayúsculas), porque son cartas y no datos del taller; solo pueden usar los {datos} de ese aviso (si escribe uno que no existe, el sistema se lo dice). Todo lo que escribió una persona (nombre de cliente, notas) se escapa para que no entre código al correo.
- **El correo no sale hasta que se configure el correo saliente (SMTP)**: sin eso quedan en la cola, como los demás correos del sistema. Sigue pendiente su decisión de qué cuenta de correo usar.
- Al **encender por primera vez** servicios próximos o vencidos en un taller que ya tiene muchos equipos, llegará un solo correo por cada servicio que ya esté en ese estado (no hay forma de saber cuáles se avisaron antes).
- Los avisos al **teléfono** (push) llegan con la app móvil (Fase 8); las preferencias por persona (correo o teléfono) también.
- Permiso nuevo **«avisos.configurar»** (administrador y gerente): quien tiene «ver configuración» puede ver los avisos y el registro; solo quien tiene este permiso los cambia o manda pruebas.

## Fase 7c — Reportes (Excel y PDF), vistas, envíos programados y búsqueda global
**Qué probar:** (1) Arriba, en la caja de búsqueda (o con Ctrl+K), escriba parte de una placa, de un cliente, de un número de orden o de un material: aparecen los resultados por grupo y al pulsar uno se abre en su pantalla. (2) Reportes → «Carga de trabajo» y «Compras»: cambie el periodo y descargue el Excel y el PDF; revise que arriba diga el nombre del reporte, la empresa y la fecha y hora de emisión, y que impriman bien en hoja horizontal. (3) «Guardar esta vista» y vuelva a elegirla. (4) Reportes → «Envíos programados»: cree uno para su correo y pulse «Enviarme una prueba».
**Decidí yo:**
- La búsqueda solo muestra lo que la persona puede ver (cada grupo exige el permiso de su pantalla); con varias palabras deben aparecer **todas**; pide mínimo 2 letras; muestra hasta 6 resultados por grupo. **Todavía no filtra por sucursal** (el sistema aún no limita a cada persona a una sucursal; cuando se defina, se aplica aquí también).
- Un resultado abre el registro cuando la pantalla sabe abrirlo (equipo, orden, cotización, material); en clientes, proveedores, colaboradores, trabajos y solicitudes lleva a la lista ya filtrada.
- Reportes nuevos: **carga de trabajo** (sin dinero) y **compras** (dinero, solo con reportes financieros). Los de indicadores y motivos de rechazo ahora también se descargan. Todos los reportes se arman en el servidor, así pantalla, Excel, PDF y correo dicen siempre lo mismo.
- **Periodos relativos** (hoy, últimos 7 y 30 días, este mes, mes anterior) se calculan con el día del taller; también hay periodo por fechas. Lo que se descarga es exactamente lo que se ve en pantalla.
- Descargar requiere el permiso «exportar reportes»; queda anotado en la bitácora quién descargó qué; hay un tope de descargas por minuto, como en la descarga de datos.
- **Vistas guardadas**: son de cada persona (no las ve nadie más), hasta 30 por persona, con nombre único por reporte; guardan el periodo relativo, la sucursal y el tipo de equipo.
- **Envíos programados**: a partir de las 7:00 del taller, una sola vez ese día, según su frecuencia (diaria, semanal con el día, mensual con día del 1 al 28). Solo admiten periodos que se mueven solos (un rango de fechas fijo saldría igual cada vez). Se mandan a roles, personas o correos sueltos. Los reportes de dinero solo los programa quien ve dinero. Si quien lo programó deja de tener acceso, su envío deja de salir. Todo queda en «Avisos enviados».
- **El reporte viaja DENTRO del correo (como tablas), no como adjunto.** Un correo con Excel o PDF adjunto necesita ampliar la cola de correos de la plataforma; queda como mejora si lo quiere. Cada correo dice que, para bajarlo completo, se entre a Reportes. Las tablas largas se recortan a 40 filas por sección.
- Si el servidor está apagado el día que le tocaba a un envío, ese día no se recupera (sale en su siguiente turno).
- Permiso nuevo **«reportes.programar»** (administrador y gerente). El gerente y el administrador ya tenían exportar y financieros.
- Todavía no hay (7d): portal del cliente, enlaces del checklist, de la cuenta y de la cita, y el QR del equipo.

## Fase 7d — Portal del cliente, enlaces a cuenta e informe, QR del equipo y bitácora de accesos
**Qué probar:** (1) En el equipo, botón «Código QR»: imprímalo, escanéelo con un teléfono y revise que se vea la ficha, los servicios y lo que se le ha hecho, sin precios. (2) En una orden con la cuenta emitida, «Enlace de la cuenta» (y «Enlace del informe» en un checklist completado): copie el enlace, ábralo en otro navegador y vea cómo queda en «Enlaces para el cliente». (3) En un cliente, ponga a un contacto con correo y rol «aprobador»; abra `/portal` de su taller, pida el código y entre; mire sus equipos, abra una cotización y pida una cita; vea la cita «por confirmar» en Citas y confírmela. (4) En la ficha del cliente, pestaña «Portal y accesos»: lo que ha visto y las sesiones abiertas.
**Decidí yo:**
- **Entrada al portal:** correo + código de 6 números que se manda al correo de la persona de contacto (vale 15 minutos, se usa una vez, se prueba como máximo 5 veces, máximo 3 códigos por hora por correo). La respuesta es siempre la misma exista o no el correo (no se puede averiguar qué correos hay). La sesión dura 8 horas y el taller puede cerrarla. Si el contacto se desactiva o pierde el correo, pierde el acceso al instante. Queda pendiente la protección anti-robot (Turnstile) al pedir el código: ya está conectada y se activa cuando se configure.
- **Contactos:** se usan los que ya existen en cada cliente (rol aprobador / consulta / piloto; «todos los equipos» o solo los asignados). Una persona con el mismo correo en dos clientes ve los de ambos.
- **Qué ve:** sus equipos, el estado de cada orden con el nombre de estado que el taller configuró, avance ponderado por horas (un trabajo largo pesa más; uno sin horas pesa como una hora), fecha estimada de entrega, trabajos (hecho / pendiente), servicios programados, y las cuentas e informes vigentes con su PDF. **Nunca** costos, precios internos, técnicos ni tiempos de trabajo. Las fotos del informe se ven dentro de su PDF (aún no hay galería de fotos antes/después en la pantalla del portal).
- **Cotizaciones:** solo un contacto «aprobador» con acceso al equipo autoriza o rechaza; queda su nombre con «(PORTAL)», fecha, hora, dispositivo y red, y el taller se entera igual que por el enlace.
- **Citas:** desde el portal se pide día, hora y, si quiere, kilómetros u horas actuales (lectura) y una nota. La cita nace «por confirmar» (con insignia en Citas y botón «Confirmar»); si el taller usa «reservar», se respeta el cupo del día. Se avisa a la recepción por correo (aviso nuevo «Un cliente pidió una cita», encendido de fábrica: sin él nadie se enteraría).
- **Enlaces a cuenta e informe:** sirven siempre la versión **vigente** del documento (si se emite una nueva, el mismo enlace la muestra y avisa que reemplaza a la anterior); se ven una sola vez al crearlos, duran 30 días, uno nuevo anula el anterior y hay «revocar todos los de la orden» (cuenta, informes y cotizaciones). La primera apertura real avisa a quien lo creó (el aviso «El cliente abrió su enlace», apagado de fábrica).
- **QR del equipo:** lleva solo una clave al azar del equipo (sin número de empresa ni id); la empresa sale del nombre en la dirección. Quien escanea ve: ficha del equipo (placa, serie/VIN, marca…), servicios programados y lo que se le ha hecho (como usted decidió: todo lo del vehículo, menos costos y datos internos). Se puede cambiar el código si se filtra (el impreso deja de servir).
- **Bitácora única:** cada apertura real de un enlace, escaneo de QR o entrada al portal queda con cuándo, qué, quién (si se sabe), dispositivo y red; no cuentan las vistas previas automáticas de WhatsApp o del correo. Se ve en la ficha del cliente y se descarga con los datos.
- Todavía no hay: el botón de WhatsApp «directo al teléfono del cliente» (hoy abre WhatsApp para elegir contacto), el enlace del checklist para llenarlo desde el teléfono del cliente, recibir mensajes del cliente, ni avisos al teléfono (app móvil, Fase 8).
