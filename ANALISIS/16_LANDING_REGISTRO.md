# 16 — Landing y registro (sitio público de VERI-TECH) · LEÍDO COMPLETO

Leído: `landing/` completo — `index.html` (generado, 34 KB), `registro.html` (19 KB, 441 renglones), `registro-exitoso.html`, `recuperar-acceso.html`, `eliminar-cuenta.html`, `privacidad.html` y `terminos.html` (solo redirigen), `LEEME_GENERADO.txt`, fuentes y logo. Se cruzó con `subscribeController`, el `webhookController` y `tenantResolver` (módulo 13). Comprobación en el servidor, **solo lectura**: la copia publicada de `registro.html` es idéntica byte a byte a la del repositorio, y el servidor ejecuta el backend que exige aceptar los Términos. No se hizo ningún registro de prueba ni se tocó nada.

## Qué hace (se conserva)
- **La página principal se genera desde una sola fuente** (`guatech-web/brochures/products.py`): la misma fuente da la landing, el brochure y la versión en inglés. No se edita a mano. Idea buena, se conserva.
- **Español e inglés** con selector (se recuerda la elección), 13 productos enlazados en el pie ("Ecosistema GUATECH"), botón flotante de WhatsApp con mensaje ya escrito, descarga de brochure, tipografía propia (sin depender de servidores externos).
- **Registro en tres pasos** (datos → pago con PayPal → listo) con vista previa de la dirección que tendrá el taller, **comprobación de disponibilidad antes de cobrar**, validación de contraseña (10 caracteres, mayúscula, minúscula y número) y manejo de "pago cancelado".
- **Recuperar acceso** con casilla anti-robots (Turnstile) y respuesta siempre igual.
- **Textos legales unificados:** `privacidad.html` y `terminos.html` solo redirigen al texto único en guatech.lat, así que no pueden desalinearse.

## Hallazgos
1. **El registro público probablemente no funciona hoy (verificado por código en ambos lados).** El backend publicado rechaza la confirmación con *"Debe aceptar los Términos de Uso y la Política de Privacidad"* si no recibe `acceptTerms: true` y la versión de los términos. La página `registro.html` (idéntica en el servidor, subida el 31-oct) **no tiene casilla de aceptación y nunca envía esos dos datos**. Resultado: la persona crea su suscripción en PayPal (queda en prueba de 30 días), pero al confirmar el sistema devuelve error y **no se crea el taller**; la pantalla le dice "contacte a soporte". El enlace "Términos de servicio" del mismo formulario apunta a `#` (no abre nada). El registro de actividad del servidor no muestra altas desde el 9 de julio (puede estar rotado), y no se hizo un alta real para no cobrar ni crear cuentas. Es un fallo de producción que hoy impediría a cualquier cliente nuevo registrarse por esta vía.
2. **El alta depende de que el navegador no falle.** El identificador de la suscripción solo vive en esa pestaña: si se cierra, se cae el internet o el servidor da error justo después de aprobar el pago, queda una suscripción de PayPal sin taller y nadie lo sabe (no se avisa a GUATECH). Los demás productos (BIL, SAFE, QUALI, BUY) ya usan un alta en dos pasos con pase firmado; VERI-TECH no.
3. **La página de "listo" promete sin comprobar.** `registro-exitoso.html` dice que en segundos llegará un correo y que "se está creando tu base de datos" (jerga); no consulta el estado, no tiene botón de entrar ni plan B si el aprovisionamiento falla (solo avisa a GUATECH por correo). Si falla, el cliente espera sin saberlo.
4. **Se pueden registrar nombres reservados.** Ni el formulario ni el servidor rechazan `api`, `admin`, `www`, `app`, `mail`, `cdn`, `smtp`, `demo`…; `tenantResolver` los ignora, y el aprovisionador trata "el subdominio ya existía" como éxito. Un cliente que eligiera uno de esos pagaría por un taller que nunca se abre, y el panel podría pisar el subdominio de la API.
5. **La dirección del taller es una elección permanente y sin guía.** El nombre del subdominio se vuelve la dirección, el nombre de la base de datos y el "código de empresa" que escribe cada técnico en la app. No se avisa que no se puede cambiar, ni hay lista de nombres reservados ni de ofensivos.
6. **Los límites del plan que anuncia la página no existen en el sistema** (módulo 13): "Starter: 2 usuarios, 40 órdenes/mes", "Business: 5 y 100", "Pro: ilimitado" se muestran en dos lugares distintos (la landing y un arreglo escrito dentro de `registro.html`) y ninguna línea del producto los aplica. La landing además afirma **"Todos los módulos incluidos en cada plan"**, que contradice lo aprobado (los niveles se diferencian por usuarios, sucursales y módulos incluidos).
7. **Nombres y precios repetidos:** el nombre del plan aparece como Starter/Business/Pro en la landing y el registro, "Básico/Profesional/Empresarial" dentro de la aplicación y en el correo "Starter ($30/mes)". Un solo catálogo (módulo 13) lo resuelve.
8. **Trato inconsistente:** la landing generada usa "usted" ("Reciba, Ejecute, Pruebe"), pero el registro y la recuperación usan "tú" ("Crear tu cuenta", "Completa tus datos", "Haz clic", "Elige", "recuerdas") y la página de eliminar cuenta usa **voseo** ("Escribí", "usás", "querés", "consultá"). Mezcla "Veritech" y "VERI-TECH".
9. **"Eliminar cuenta" está desactualizada y es un callejón:** fechada el 24 de julio; dice que "no hay auto-registro" (sí lo hay), pide escribir un correo manualmente, promete anonimizar y 30 días de plazo sin enlazar con la Política única ni con el cierre de cuenta decidido (30 días solo-exportar y borrado automático). Google Play exige esta dirección, así que debe seguir existiendo y ser verdadera.
10. **No hay puerta de entrada real.** "Iniciar sesión" en el menú y el pie lleva a *Recuperar acceso*, que pide un correo para enviar la dirección del taller. Quien conoce su subdominio lo escribe a mano; quien no, espera un correo (y solo lo recibe el administrador, módulo 13). No existe una página "Entrar" que busque el taller por correo.
11. **Anti-robots solo en un formulario:** `recuperar-acceso` lleva Turnstile; `registro.html` y su comprobación de disponibilidad no (permite averiguar qué correos y subdominios existen sin límite de intentos).
12. **La landing no muestra el producto:** cero capturas de pantalla, cero video; todo es texto. Los contenidos nuevos (QR del equipo, portal del cliente, sucursales, contadores por condición) ya están en las tarjetas, pero no se ven. La sección "tecnología confiable" muestra logotipos de terceros (GitHub, PayPal, Sentry, Cloudflare, UptimeRobot) como respaldo, lo que no son clientes ni certificaciones.
13. **Posicionamiento en buscadores y medición limitados:** una sola página que cambia de idioma con JavaScript (el inglés no se indexa), solo descripción en español, sin dirección canónica ni etiquetas para compartir en redes, sin mapa del sitio, sin medición de visitas ni de conversión (cuántos llegan a registro, cuántos pagan).
14. **Accesibilidad y presentación:** gris `#A6A6A6` sobre blanco no cumple contraste; botones de idioma pequeños; el formulario no marca los campos con error con texto asociado; el registro fija la barra de pasos sin indicar progreso a lectores de pantalla.
15. **La dirección de la API está escrita en cada página** (`https://api.veritech.lat`), repetida en tres archivos; el plan elegido viaja por la dirección (`?plan=`) sin validar contra el servidor, que luego decide por su cuenta.
16. **La contraseña se elige en la página pública antes del pago** y viaja en el mismo envío que el identificador de la suscripción; el servidor la guarda cifrada en la fila del taller pendiente (módulo 13). Funciona, pero deja una contraseña cifrada en espera si el pago nunca se completa.

## Diseño nuevo (propuesta)
- **Alta en dos pasos (como BIL, SAFE, QUALI y BUY):** (1) datos + casilla de aceptación de Términos y Privacidad (enlaces reales a la versión vigente) + Turnstile → el servidor valida y devuelve un **pase firmado de pocas horas** (no crea nada todavía); (2) PayPal, llevando ese pase como dato de la suscripción; (3) la confirmación **o** el aviso de PayPal crean el taller aunque el navegador se haya cerrado. Una conciliación revisa cada pocas horas las suscripciones aprobadas sin taller y las completa o avisa a GUATECH.
- **Página "Estamos preparando su taller"** que consulta el estado y, cuando el taller ya responde y su certificado está listo, muestra el botón **Entrar** y envía la bienvenida; si algo falla, lo dice con claridad y GUATECH recibe la alerta.
- **Nombre del taller (subdominio):** lista de reservados (los de la plataforma, marcas, ofensivos), comprobación inmediata mientras escribe, aviso de que **es permanente**, y mínimo y máximo de largo.
- **Planes desde el catálogo único** (módulo 13): la landing y el registro leen nombres, precios, límites y módulos de la misma fuente que el producto; se muestran los niveles aprobados por usuarios, sucursales y módulos. Texto "todos los módulos incluidos" fuera.
- **Página "Entrar" real:** el usuario escribe su correo y el sistema encuentra sus talleres (uno o varios) y lo lleva al correcto; recuperar acceso queda como enlace secundario. Aplica a técnicos, operadores y a cualquier usuario, no solo al administrador.
- **Eliminar cuenta como página verdadera y actual:** explica en "usted" el cierre (30 días solo-exportar, borrado automático), enlaza la Política única, y permite pedir la eliminación de un usuario con un formulario protegido que genera un ticket con número (módulo 13). El administrador puede cerrar su taller desde Suscripción y pagos.
- **Landing con el producto a la vista:** capturas reales de 5–6 pantallas clave (tablero, orden, checklist, portal del cliente, QR, app móvil), un video corto, y bloque "para quién" por tipo de operación (taller comercial / flota propia); etiquetas para buscadores y redes, versión en inglés con su propia dirección (`/en/`), mapa del sitio, medición de visitas y de conversión del registro.
- **Todo el texto en "usted"** y la marca escrita siempre "VERI-TECH"; contraste y etiquetas de accesibilidad corregidos; una sola dirección de API configurada en un solo lugar.

## Decisiones necesarias de Luis
1. **¿Corrijo ya el registro de la versión actual?** Hoy bloquea cualquier alta nueva (hallazgo 1). Es un arreglo pequeño (casilla de aceptación, enlaces a los textos vigentes y enviar la versión aceptada) que sale por la vía normal de despliegue. Mientras el producto nuevo se construye, la versión actual es la que recibiría a un cliente que llegue hoy. Recomiendo corregirlo ahora y dejarlo así hasta el cambio al sistema nuevo.
2. **Alta en dos pasos con pase firmado** para que nunca quede una suscripción sin taller. ¿De acuerdo?
3. **Dirección del taller:** lista de nombres reservados, aviso de que es permanente y mínimo 3 caracteres. ¿De acuerdo? ¿Se permite cambiarla después (con costo de soporte y reenvío de accesos) o es definitiva?
4. **Página "Entrar" por correo** que encuentra el taller (aprobado en el módulo 13) como puerta principal del sitio. ¿Se confirma?
5. **Eliminar cuenta:** página actualizada y cierre de cuenta desde el propio producto, con el plazo de 30 días ya aprobado. ¿De acuerdo?
6. **Landing con capturas y video** del producto nuevo. ¿Las prepara usted cuando el sistema esté listo, o quiere que yo proponga las pantallas y los textos para que usted los apruebe?
7. **Inglés con dirección propia (`/en/`)** y medición de visitas y de conversión. ¿Se incluyen? (Para medir se necesita elegir una herramienta que respete la privacidad.)
8. **Logotipos de terceros en "tecnología confiable":** recomiendo cambiarlos por un texto sobre seguridad (respaldos, cifrado, cobro por PayPal) sin logotipos ajenos. ¿De acuerdo?


---
# Decisiones de Luis sobre el sitio público y el registro (2026-11-11)
Luis respondió "de acuerdo con las recomendaciones de los módulos 15 y 16". Quedan aprobadas las del módulo 16:
1. **Corregir ya el registro de la versión actual:** HECHO el mismo día (commit 79ea816, publicado y verificado en vivo).
2. **Alta en dos pasos con pase firmado** (nunca una suscripción sin taller).
3. **Nombre del taller (subdominio):** lista de nombres reservados, aviso de que es permanente, mínimo 3 caracteres. *Pendiente de dato: si se permite cambiarlo después o es definitivo (se asume definitivo).*
4. **Página "Entrar" por correo** que encuentra el taller, como puerta principal.
5. **Eliminar cuenta:** página actualizada y cierre de cuenta desde el propio producto (30 días solo-exportar y borrado automático).
6. **Landing con capturas y video** del producto nuevo. *Quién prepara las capturas se define cuando el sistema esté listo (se asume: yo propongo pantallas y textos para que Luis los apruebe).*
7. **Inglés con dirección propia (`/en/`)** y medición de visitas y conversión, con una herramienta que respete la privacidad.
8. **Quitar los logotipos de terceros** de "tecnología confiable" y reemplazarlos por un texto sobre seguridad.


---
# Nota (2026-11-11, tras leer GUATECH_STANDARDS.md §21): las decisiones 7 y 8 chocan con un estándar
- **Decisión 8 (quitar los logotipos de terceros del cintillo)** contradice GUATECH §21, donde Luis fijó el 2026-11-01 un cintillo obligatorio con 5 logos (GitHub, PayPal, Sentry, Cloudflare, UptimeRobot) en las 13 landings.
- **Decisión 7 (inglés con dirección propia `/en/`)** contradice §21-B: un solo sitio con selector Español/English y `?lang=en`.
- La landing se **genera** desde `guatech-web/brochures/products.py` (no se edita en el repositorio del producto).
- Pendiente de decisión de Luis: se recomienda **retirar** esas dos recomendaciones y seguir el estándar (conservando la medición de visitas y de conversión). Ver `17_ESTANDARES_QUE_OBLIGAN.md`, choque C1.

**Resuelto 2026-11-11:** Luis aceptó retirar las decisiones 7 (inglés en `/en/`) y 8 (quitar logos): rige GUATECH §21. Queda la medición de visitas y conversión.
