# VERI-TECH nuevo — mapa de módulos y avance de lectura

Fecha de inicio: 2026-11-10. Fuente: `C:\GUATECH\veritech` (V3.105). Reglas de trabajo acordadas con Luis:
leer TODO el código; por cada pieza preguntar "¿se necesita?" y "¿se puede mejorar?"; base de datos nueva y limpia
(solo tablas que sirven, nombres en español y consistentes); construir módulo por módulo con pruebas.

Estados: [ ] sin leer · [~] en lectura · [x] leído y analizado

| # | Módulo | Backend (renglones) | Frontend (renglones) | Estado |
|---|--------|---------------------|----------------------|--------|
| 1 | Catálogos (jerarquía técnica, tipos, estados, unidades, puestos…) | catalogController 3.884, routes/catalogs 181, estadoOtService 589, etapaService 139 | Catalogs.tsx 3.498, SucursalesAreasPanel 302, TarifasAreaModal 160 | [x] leído completo (backend + Catalogs.tsx) → ver `01_CATALOGOS_backend.md` |
| 2 | Fundación: acceso, empresas (tenants), permisos, plataforma | authController 1.781, platformController 917, tenantResolver, permissionsService 345, tenantProvisioner 220, middleware/* | Login, Layout, Configuration 908 | [x] leído completo (app del taller + panel superadmin); falta leer GUATECH_STANDARDS.md completo (ver 02_FUNDACION_parcial.md) |
| 3 | Clientes, proveedores, sucursales, áreas | clientController 502, proveedoresController 175, sucursalController 112, areaTrabajoController 159, sucursalAreaService | Clients 489, Proveedores 156, ProveedorFormModal… | [x] leído completo → ver `03_CLIENTES_PROVEEDORES_SUCURSALES.md` |
| 4 | Equipos (ficha, fotos, documentos, QR, historial) | equipmentController 1.371, equipoHistorialService 300, equipoQr, publicEquipo | Equipments 910, EquipmentDetailModal 2.281, QR* | [x] leído completo (backend + frontend) → ver `04_EQUIPOS_backend.md`; ContadoresEditor/EquipmentContadores/condicionUi pasan al módulo 5 y MaterialEquiposSelector al 8 |
| 5 | Contadores (principales + auxiliares/condición) | contadorController 683, contadorAuxiliarController 315, contadorLecturaService 527, condicionService 363 | Contadores* , EquipmentContadores 590, ContadoresAuxiliaresPanel 575 | [x] leído completo (backend + frontend) → ver `05_CONTADORES.md` |
| 6 | Órdenes de trabajo | orderController 3.520, orderItemEstadoService, calculationService, tariffService | Orders 809, OrderDetailModal 2.154, OrderWizard, Board, Calendar | [x] leído completo (backend + frontend) → ver `06_ORDENES_backend.md` |
| 7 | Taller: técnicos, carga, agenda, colaboradores | technicianController 868, colaboradoresController 546 | WorkloadPage, TechnicianWork, Colaboradores 694 | [x] leído completo → ver `07_TALLER.md` (TechnicianChecklists pasa al 9, móvil al 15) |
| 8 | Inventario, bodegas, solicitud de materiales | inventoryController 936, materialRequestController 500, warehouseController | Inventory 2.170, BodegueroBandeja | [x] leído completo → ver `08_INVENTARIO.md` |
| 9 | Checklists e inspecciones | checklistService 1.408, routes/checklists 857, notificaciones | Checklists, ChecklistViewer 885, Inspecciones | [x] |
| 10 | Mantenimiento preventivo (estrategias, paquetes, proyección, alertas) | proyeccionService 677, estrategias*, paquetes*, scheduler | Mantenimiento*, Paquetes*Tab | [x] |
| 11 | Reportes, tablero, búsqueda | reportService 1.224, reports routes 377, dashboard, search 561 | Reports 1.462, Dashboard 361 | [x] |
| 12 | Portal del cliente, citas, enlaces públicos | portal*, share 543, citaConfirmacion | PortalCliente, Public* | [x] |
| 13 | Suscripción, pagos, correos, soporte | billingService 397, subscribe, webhook, emailService 509 | SuscripcionPagos, ayuda/* | [x] |

## Tablas candidatas a eliminar (por confirmar con la lectura de cada módulo)
Corrección 2026-11-10: la primera lista (19 tablas) mezclaba tablas que YA se borraron en V3.087/migración 142
(combustible: `autorizaciones_combustible`, `compras_combustible`, `equipo_cargas_combustible`) y tablas de
plataforma que ya viven en otra base (`demo_*`). Quedan como candidatas reales, sin ninguna referencia en el código:
`catalog_marcas_agricola`, `catalog_marcas_camion`, `catalog_marcas_industrial`, `catalog_rubros`, `insurers`,
`equipment_insurance_policies` (la póliza ahora es un documento más del equipo), `paquetes_mantenimiento`,
`paquete_mantenimiento_niveles` (reemplazados por paquetes de inspección/estrategias), `checklist_type_vehicle_types`,
`equipo_inspeccion_frecuencia`, `tecnico_tipos_trabajo`; y las 4 tablas legadas de la base demo (`tenant_config`,
`tasks`, `report_templates`, `meter_types`).

## Piezas que faltaban en el mapa (agregadas 2026-11-10)
| # | Módulo | Renglones | Estado |
|---|--------|-----------|--------|
| 14 | Panel de superadmin (admin-frontend, 2.904 renglones) | 2.904 | [x] leído con el módulo 2 |
| 15 | App móvil (`mobile/src`) | 2.181 | [x] leído (15_APP_MOVIL.md) |
| 16 | Landing y registro (`landing/`, registro con PayPal) | por medir | [x] leído (16_LANDING_REGISTRO.md) |
