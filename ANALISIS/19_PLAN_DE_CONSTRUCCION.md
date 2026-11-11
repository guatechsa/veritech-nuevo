# 19 — Plan de construcción del VERI-TECH nuevo (PROPUESTA, 2026-11-11)

Estado: **sin aprobar. No se ha construido nada.** Se apoya en el diseño de `18_DISENO_BASE_DE_DATOS.md` (plataforma 20 tablas + taller 109) y en las decisiones de los módulos 1–16.

## Principios de construcción
1. **De abajo hacia arriba y en el orden en que Luis puede ver y probar cada pieza.** Cada fase termina con algo que se abre en un sitio de pruebas.
2. **Pruebas desde el primer día:** cada regla importante tiene su prueba automática contra una base de datos real (MariaDB 10.11, la misma de producción) y el despliegue no sale si fallan (como el gate actual de `jest`). Se prueba como el cliente, **en cada rol** y en ventana limpia (lección de "Entrar").
3. **Un solo estándar:** el kit `ui-guatech`, las fechas, las mayúsculas, los botones, el menú de un nivel (≤ 11 entradas), el detalle de orden y el cache de Apache nacen cumpliendo (`17_ESTANDARES_QUE_OBLIGAN.md`).
4. **Nada toca producción** del sistema actual hasta la fase de salida. El sistema nuevo vive en su propio repositorio y su propio sitio de pruebas.
5. **Versión `4.000`** del sistema (y `2.000` de la app); cada cambio visible sube el contador; `CHANGELOG.md` desde el primer commit.
6. **Cada fase se cierra con:** pruebas verdes, recorrido por roles, nota en `CHANGELOG.md` y la aprobación de Luis antes de la siguiente.

## Fases (de menor a mayor dependencia)
| Fase | Qué se construye | Tamaño | Qué ve Luis al terminar |
|---|---|---|---|
| 0. Cimientos | Repositorio, estructura TypeScript estricta, ejecutor de migraciones, conexión a las dos bases, configuración, kit `ui-guatech`, `/health` con versión, pruebas con base real, flujo de despliegue con compuerta de pruebas, sitio de pruebas | M | Un sitio vacío que responde con su versión 4.000-dev y pruebas verdes |
| 1. Plataforma | Base de plataforma, empresas, planes, módulos, usuarios de plataforma (3 roles), auditoría, recuperación de contraseña, "Entrar" de soporte, salto desde el hub; panel de superadmin con sus 4 secciones y 5 indicadores | M | El panel de administración del sistema nuevo funcionando |
| 2. Alta y cobro | Registro en dos pasos con pase firmado, aprovisionamiento idempotente de un taller (base, subdominio, migraciones, administrador), PayPal (pruebas), suscripción y pagos, conciliación cada 3 h, gracia de 7 días, cierre con 30 días de exportación y reactivación, correos del ciclo de vida, directorio y página "Entrar" por correo | L | Alta de un taller de prueba de punta a punta |
| 3. Taller: acceso y estructura | Sesiones, roles y permisos, colaboradores (credenciales, jornadas, ausencias), sucursales, áreas, bodegas, configuración, archivos, catálogos, clientes, contactos, proveedores, tipos de equipo, equipos, contadores y lecturas (con anulación y revisión), carga masiva en Excel | L | Un taller con su gente, su estructura y su flota cargada |
| 4. Taller: núcleo operativo | Órdenes y líneas (ciclo del técnico, 8 estados, tiempos reales), ingresos del equipo, citas, checklists (plantillas versionadas, fotos, firma, candado de cierre), servicios programados con proyección y avisos | XL | El ciclo completo recepción → trabajo → checklist → cierre |
| 5. Inventario | Materiales, clasificación y márgenes, existencias, compras, solicitudes y despacho, devoluciones, reservas, diferencias, aplicabilidad a equipos; conexión con las órdenes | L | De la solicitud del taller al despacho de bodega |
| 6. Cotizaciones y documentos | Cotizaciones, versiones, enlaces, autorización por línea, "agregar a la orden", cuentas e informes emitidos (PDF del servidor) | L | Cotizar un rojo, enviarlo y que el cliente lo autorice |
| 7. Canales, tablero y reportes | Portal del cliente, enlaces y bitácora de accesos, QR del equipo, avisos incluidos, tablero por rol, indicadores con metas, reportes (PDF y Excel del servidor), búsqueda global, envíos programados | XL | Lo que ve el gerente y lo que ve el cliente |
| 8. App móvil 2.000 | Cinco roles, trabajo sin señal con "Descargar mi día", cambios con identificador, fotos reducidas, QR, firma, avisos al teléfono | XL | La app en un teléfono, sin señal incluida |
| 9. Migración y salida | Migrar `enova` (datos conservados y verificados), respaldo y retiro de `cafe` y `waga`, taller de demostración sintético, landing y registro al estándar, pruebas de seguridad y de carga, Google Play, cambio de dirección | L | El día del cambio, con marcha atrás preparada |

Tamaños relativos (S < M < L < XL), no son plazos: no hay cifras de esfuerzo medidas que los respalden.

## Decisiones técnicas que toma el asistente (no cambian lo que Luis ve)
- Mismo stack del estándar actual: Node + TypeScript estricto + Express + React + Vite + Tailwind + MariaDB; validación con Zod en cada entrada; transacciones en toda operación de varios pasos; sin `any`.
- Consultas escritas a mano pero **tipadas** y agrupadas por módulo (no ORM): es lo que ya usa el producto y lo que el estándar de despliegue conoce.
- Un solo servicio de correo con cola, un solo generador de enlaces (`buildTenantUrl`), un solo servicio de archivos con enlaces firmados y un solo servicio de numeración.

## Lo que hace falta de Luis para arrancar (Fase 0)
1. **Aprobación definitiva** del diseño de la base de datos.
2. **Nombre del repositorio** en GitHub (propuesta: `guatechsa/veritech-nuevo`, privado) y **dirección del sitio de pruebas** (propuesta: `pruebas.veritech.lat`, con su API). Crear el subdominio exige DNS en el VPS (PowerDNS: recargar la zona antes de abrir el nombre).
3. Confirmar que el sitio de pruebas puede vivir en el VPS actual (con su propia base de datos de pruebas), sin tocar los talleres reales.

## Pendientes menores (no bloquean el arranque)
- Plantilla del Excel de carga masiva (columnas): se define en la Fase 3.
- Actualizar `EMAIL_DESIGN_STANDARD.md` (correos del taller a sus clientes): Fase 7.
- Pasos de trabajo (`work_steps`): se elimina salvo que algún taller lo use.
- Moneda: una por taller (quetzales por defecto).
- Publicación en Play: probadores o distribución privada, Fase 9.
- Dato de soporte: quién atiende y con qué plazos, Fase 2.
- Cantidades y módulos por nivel de plan (30/60/120): Fase 1.

## Riesgos conocidos
1. **Directorio de correos entre talleres:** no hay transacción entre bases; se mitiga con reconciliación semanal y pruebas.
2. **Migrar `enova`:** el desfase de 6 h en fechas guardadas y la traducción de tablas viejas; se mide y se valida con cifras antes de abrir.
3. **Tamaño:** 129 tablas y 9 fases; por eso cada fase se aprueba por separado y nada se mezcla.
4. **PayPal real:** solo se prueba en modo de pruebas hasta la Fase 9; el alta real con cobro la hace Luis.
