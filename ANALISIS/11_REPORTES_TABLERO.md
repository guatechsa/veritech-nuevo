# 11 — Reportes, tablero de inicio y búsqueda · LEÍDO COMPLETO

Leído: `reportService` (1.224, incluidos los envíos de alerta y la orden desde proyección ya vistos en el módulo 10), `routes/reports` (377), `dashboardController` (175), `searchController` (561), `Reports.tsx` (1.462), `Dashboard.tsx` (361), `Home.tsx` (68). Los reportes de mantenimiento (Próximas fechas, Ejecución, Inspecciones, Cumplimiento) se analizaron en el módulo 10. El contador de "stock bajo" se analizó en el módulo 8.

## Qué hace (se conserva)
- **Gerencial por tipo de equipo:** órdenes completadas, ticket promedio, días en taller y margen bruto, con gráfica de tendencia por período. Es justo el eje que Luis quiere (el tipo de equipo como familia). Las definiciones de V3.084 (completada = estado terminal sin canceladas, por fecha de cierre; margen como cociente de totales) son correctas y se conservan.
- **Comparativo de sucursales** con ticket por tipo de equipo, **Costos** por tipo de equipo y por sistema-subsistema (con desglose), **Compras por proveedor**, **Operativo** (resumen y detalle de órdenes) y **Auditables** (checklists, semáforo y fotos por orden).
- **Filtros por sucursal y área** (V3.092) y Excel de cada reporte.
- **Tablero de inicio:** órdenes activas, vencidas, sin técnico, stock bajo, mes actual contra el anterior (terminadas e ingresos), próximas citas, cola de órdenes y estado de cada técnico.
- **Fechas locales** (no UTC) en todos los selectores de período.

## Hallazgos
1. **Cada reporte usa su propia base de fechas.** El Gerencial y el tablero cuentan por fecha de **cierre**; Costos, Operativo y Auditables por fecha de **creación** de la orden (Auditables además incluye las canceladas). El mismo mes da cifras distintas en cada pantalla y nadie lo aclara.
2. **El reporte de "Costos" no muestra costos.** Suma lo **cobrado** al cliente en cada línea (`total_price`): la "mano de obra" es lo facturado, no lo que cuesta; los materiales van al costo porque así se cobran (módulo 8). No existe costo real de la mano de obra (sueldo por hora). El único margen real es el del Gerencial, y solo descuenta materiales y terceros.
3. **El tablero decide "abierta / vencida / cerrada" por el texto del estado** (`'complet|terminad|entreg|factur|cerrad|cancel'` sobre la descripción): si una empresa renombra un estado, los números cambian sin aviso.
4. **"OTs vencidas" nunca pasa de 10:** la consulta trae solo 10 filas y la tarjeta cuenta las filas traídas.
5. **El tablero es el mismo para todos y enseña dinero a todos:** ingresos del mes visibles a cualquiera con acceso al tablero (no respeta un permiso de ver precios); las tarjetas llevan a Órdenes sin filtrar; "stock bajo" no distingue bodega ni sucursal; "próximas citas" se arma con las órdenes y no con las citas.
6. **Pantalla de inicio desactualizada:** tarjetas "Inspecciones" y "Contadores" que el menú ya renombró o retiró, "Mantenimiento" que apunta a configuración, y el texto usa "quieres" (tú).
7. **No hay búsqueda global.** El archivo llamado `searchController` no es una búsqueda: contiene la búsqueda de trabajos del catálogo (`LIKE %texto%`, 50 resultados, sin relevancia), el reordenamiento de líneas de la orden y las fotos de los trabajos. El **reordenamiento no revisa si la orden está cerrada** y hace los cambios en paralelo sin transacción, con dos columnas de orden duplicadas (`sort_order` e `item_order`) y un modo "por si falta la columna".
8. **Rendimiento:** filtros como `DATE(o.created_at) BETWEEN …` impiden usar índices; cada reporte recalcula todo en cada visita; Costos manda **todas las líneas** al navegador y las agrupa allí; el Excel se genera en el navegador; las tablas ocultan filas después de 50 o 100; tres sondeos de columnas por consulta de costos.
9. **Formato adivinado por el nombre de la columna:** una expresión regular (`monto|total|cost|…`) decide qué columna se muestra como moneda; una columna nueva con otro nombre sale sin formato.
10. **Lo que no hay en los reportes:** PDF o impresión formal, envío programado por correo, vistas guardadas, comparación contra el período anterior (solo en el tablero), metas con semáforo, y exportación del servidor para volúmenes grandes. Las pantallas importan íconos de impresión que nunca se usan.
11. **Un solo permiso para todos los reportes** (`reports.view`): el que ve operativos ve también ingresos y márgenes; quién puede enviar alertas se decide por nombre de rol.
12. **Faltan los indicadores que más pidió Luis:** tiempo de despacho de bodega, puntualidad de citas, eficiencia y utilización de técnicos (horas vendidas contra horas trabajadas y disponibles), retrabajos, conversión de hallazgos a trabajo, cumplimiento de mantenimiento por tipo, reservas por vencer, diferencias de inventario y, para la flota propia, costo por kilómetro u hora y días fuera de servicio.
13. **Detalles menores:** el período elegido se pierde al cambiar de reporte; el filtro de sucursal/área solo aparece en cuatro secciones; el reporte de cumplimiento de operación ignora la sucursal.

## Diseño nuevo (propuesta)
- **Catálogo de indicadores con una sola definición** (nombre, fórmula, base de fechas, unidad, quién lo ve), usado igual por tablero, reportes y alertas. Dos bases de fecha explícitas y rotuladas en pantalla: *por cierre* (dinero y entregas) y *por creación* (carga de trabajo); el filtro lo deja claro.
- **El tipo de equipo como eje de todo reporte** (premisa del módulo 10): ticket promedio, horas, margen, cumplimiento y presupuesto por tipo.
- **Costo real:** costos de materiales según la configuración de la empresa (último o promedio, módulo 8) y, si la empresa lo quiere, **costo por hora de cada colaborador** para ver el margen real de la mano de obra.
- **Tablero por rol:** gerente (dinero, márgenes, tendencias); recepción (citas de hoy, equipos en taller, entregas del día, reservas por vencer); jefe de taller (carga y capacidad, trabajos detenidos); bodeguero (solicitudes pendientes y su tiempo de despacho); técnico (mis trabajos); operador (sus equipos). Estados por **código**, no por texto; las tarjetas abren la lista ya filtrada; cada empresa elige cuáles tarjetas ve cada rol.
- **Reportes generados en el servidor** (paginados, con índices por fecha), con PDF y Excel, vistas guardadas y **envío programado por correo** (por ejemplo, resumen semanal al gerente).
- **Búsqueda global** (atajo de teclado): equipos por placa, código o serie; clientes; órdenes por número; trabajos del catálogo. Respeta permisos y sucursal.
- **Permisos por acción:** ver reportes operativos, ver reportes financieros, exportar, programar envíos.
- **Metas opcionales por indicador** (por ejemplo, despacho en menos de 2 horas) con semáforo en el tablero.
- Texto de la pantalla de inicio en "usted", con los nombres actuales del menú.

## Decisiones necesarias de Luis
1. **Tablero por rol.** Recomiendo un tablero distinto según el rol (gerente, recepción, jefe de taller, bodeguero, técnico, operador) y que el dinero solo lo vea quien tenga el permiso. ¿De acuerdo? ¿Cuáles tarjetas quiere para cada rol?
2. **Base de fechas.** Recomiendo dinero y entregas por fecha de cierre, y carga de trabajo por fecha de creación, y que cada reporte lo diga. ¿De acuerdo?
3. **Costo de la mano de obra.** ¿Cada colaborador tendrá un costo por hora para ver el margen real, o por ahora el margen sigue siendo solo sobre materiales y terceros? Recomiendo que sea opcional por empresa.
4. **Catálogo de indicadores.** Propongo estos 10 como base: órdenes completadas, ticket promedio, margen, días en taller, tiempo de despacho de bodega, puntualidad de citas, utilización y eficiencia de técnicos, cumplimiento de mantenimiento, retrabajos y hallazgos convertidos en trabajo. ¿Cuáles sobran o faltan?
5. **Entrega de reportes.** Recomiendo PDF y Excel desde el servidor, vistas guardadas y envío programado por correo. ¿De acuerdo?
6. **Búsqueda global.** ¿Se incluye (equipos, clientes, órdenes, trabajos)?
7. **Permisos.** Recomiendo separar "ver reportes operativos" de "ver reportes financieros" y de "exportar". ¿De acuerdo?
8. **Metas.** ¿Quiere definir metas por indicador, con semáforo (por ejemplo, tiempo de despacho de bodega menor a 2 horas)?


---
# Decisiones de Luis sobre reportes y tablero (2026-11-11)
1. **Tablero distinto por rol:** sí. Yo propongo un sugerido por rol, pero cada empresa debe poder **configurarlo** (qué tarjetas ve cada rol).
2. **Base de fechas:** de acuerdo (dinero y entregas por fecha de cierre; carga de trabajo por fecha de creación; cada reporte lo rotula).
3. **Costo de la mano de obra: por TIPO DE EQUIPO** (como ya estaba definido), no por técnico ni por nivel. El gerente o administrador del taller calcula su costo por hora (alquiler del espacio, área productiva, horas-hombre disponibles al año, costos directos e indirectos: cálculo ajeno al software) y lo escribe en el tipo de equipo (ejemplo: Q100/hora para autos); luego escribe la **tarifa de venta** (ejemplo: Q150/hora). El margen de mano de obra = (tarifa de venta − costo) × horas. No hay costo por colaborador.
4. **Catálogo de 10 indicadores base:** perfecto (órdenes completadas, ticket promedio, margen, días en taller, tiempo de despacho de bodega, puntualidad de citas, utilización y eficiencia de técnicos, cumplimiento de mantenimiento, retrabajos, hallazgos convertidos en trabajo).
5. **Entrega de reportes** (PDF y Excel desde el servidor, vistas guardadas, envío programado por correo): de acuerdo, con cuidado en **márgenes y formatos**. **Todo reporte debe llevar el nombre del reporte, el nombre de la empresa y la fecha y hora de emisión.**
6. **Búsqueda global:** sí, incluyendo todo (equipos, clientes, órdenes, trabajos del catálogo y el resto de lo que se pueda buscar).
7. **Permisos:** de acuerdo en separar reportes operativos, financieros y exportar.
8. **Metas por indicador con semáforo:** sí.


---
# Cambio al catálogo de indicadores (2026-11-11, por la cotización del módulo 9)
- "Hallazgos convertidos en trabajo" se reemplaza por **"Tasa de autorización de cotizaciones"** (% de líneas y % del valor autorizado sobre lo cotizado), útil para ver el potencial de venta adicional.
- Se agrega el indicador/reporte **"Motivos de rechazo"** (distribución por precio, repuesto no disponible, tiempo, otro), con corte por tipo de equipo, ítem de checklist y cliente.
- Se mantienen metas y semáforo.
