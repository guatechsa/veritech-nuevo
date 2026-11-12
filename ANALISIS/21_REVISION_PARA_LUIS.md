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
