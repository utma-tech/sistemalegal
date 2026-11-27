# Fase 5 — Agenda jurídica y notificaciones

Rama: `producto/fase-5-agenda-notificaciones` (desde `main`, commit `4cc4a4e`).
Fecha: 27/11/2026.

Cómo leer los estados de este documento:

| Marca | Significa |
|---|---|
| **Implementado** | El código existe en la rama. |
| **Verificado con pruebas** | Lo cubre una prueba automática que se ejecutó y pasó. |
| **Verificado localmente** | Se ejecutó la aplicación completa en local (Docker + Vite) y se inspeccionó en el navegador. |
| **Pendiente de configuración** | Requiere variables o servicios externos que no se tocaron. |
| **Pendiente de autorización** | Requiere una decisión o una acción del equipo (costos, dominio, producción). |
| **Verificado en producción** | Nada de esta fase lo está: no se desplegó. |

---

## 1. Estado inicial (auditoría antes de tocar nada)

- **Rama y cambios locales.** Se trabajaba en `infra/entorno-utma` con cambios sin
  commitear en `README.md`, `docs/informe-final.md` y archivos nuevos del informe.
  La rama de esta fase se creó desde `origin/main` (mismo árbol que esa rama) y
  esos cambios del informe **no se incluyeron en ningún commit de esta fase**.
- **Pruebas de partida.** Backend: 183/183 contra PostgreSQL local (Docker).
  Frontend: 8/8.
- **Lo que ya existía y se reutilizó:**
  - `evento_calendario` (migración 006): tabla de audiencias/reuniones **sin uso
    real**; solo la leía el panel de inicio y la cargaba el seed con 2 filas.
  - `regla_alerta` / `alerta` / `notificacion` (007): política, hecho y entrega
    de avisos de plazos. La tabla `notificacion` ya admitía el canal `EMAIL`.
  - Alcance por expediente (`comun/alcance.ts`) con `sqlCausaOpcionalEnAlcance`,
    cuyo comentario ya preveía "eventos de agenda".
  - Componentes de interfaz: `CabeceraPagina`, `Boton`, `Tarjeta`, `Modal`,
    `Etiqueta`, `Campo*`, `Avisos`, `Estados`. Tokens de diseño en `tokens.css`.
- **Lo que no coincidía con la documentación o era un riesgo:**
  - `hoy()` usaba la zona del **servidor**. En Render (UTC) entre las 21 h y la
    medianoche de Argentina "hoy" ya era mañana: una alerta podía adelantarse
    un día. **Corregido** (sección 6).
  - La clave de idempotencia de `alerta` (plazo + regla) impedía volver a avisar
    si un plazo cambiaba de fecha. **Corregido** (sección 6).
  - El panel de inicio listaba **todos** los eventos del alcance, sin noción de
    eventos personales ni cancelados. **Corregido**.
  - Ruta `/agenda` = listado de plazos ("Agenda y plazos"). Se movió a `/plazos`
    para que `/agenda` sea la agenda jurídica (sección 4).
  - La CSP de Vercel (`style-src 'self'`) impide estilos en línea dentro de un
    iframe: se tuvo en cuenta para la vista previa de correos.
- **Riesgos que siguen vigentes (de auditorías anteriores):** base de Supabase
  compartida con el entorno de Martín y usuarios de demostración con contraseña
  publicada. **Antes de habilitar correos reales hay que resolverlos**: con la
  base compartida, un correo podría salir hacia usuarios del otro entorno.

---

## 2. Funcionalidades

| Funcionalidad | Estado |
|---|---|
| Agenda con vistas **Mes, Semana, Día y Agenda** (lista cronológica) | Implementado · verificado localmente |
| Eventos: alta, consulta, edición, reprogramación, confirmación, finalización, cancelación (con motivo), reapertura | Implementado · verificado con pruebas · verificado localmente |
| Historial de cambios del evento (incluye reprogramaciones con fecha anterior y nueva) | Implementado · verificado con pruebas |
| Día completo, varios días, con horario, cerca de medianoche | Implementado · verificado con pruebas |
| Responsable, participantes, expediente, cliente/parte, lugar, enlace virtual, observaciones, visibilidad, prioridad | Implementado · verificado con pruebas |
| Advertencia de superposición (sin bloquear el alta) | Implementado · verificado con pruebas · verificado localmente |
| Vista unificada: eventos + **plazos** + **tareas** + **días inhábiles**, sin duplicar datos | Implementado · verificado con pruebas |
| Filtros combinables en la URL (tipo, responsable, estado, prioridad, mis eventos, completados, cancelados, expediente) | Implementado · verificado localmente |
| Panel lateral único: próximos compromisos, vencimientos, leyenda; detalle al elegir | Implementado · verificado localmente |
| Alta de evento desde un expediente ("Agendar") | Implementado · verificado localmente |
| Panel de inicio: próximos eventos respetan visibilidad y estado, enlazan al detalle | Implementado · verificado con pruebas (suite existente) |
| Recordatorios configurables por evento (por defecto 24 h y 1 h en audiencias, mediaciones y reuniones) | Implementado · verificado con pruebas |
| Avisos de asignación, reprogramación y cancelación | Implementado · verificado con pruebas |
| Alertas de plazos también por correo (mismas reglas por días hábiles) | Implementado · verificado con pruebas |
| Cola persistente con reintentos, idempotencia y recuperación | Implementado · verificado con pruebas |
| Preferencias de notificación por usuario | Implementado · verificado con pruebas · verificado localmente |
| Administración de notificaciones (estado, cola, fallidos, reintento, correo de prueba, vista previa) | Implementado · verificado con pruebas · verificado localmente |
| Correo real por Resend | Implementado · **pendiente de configuración y autorización** |
| Programador externo (Supabase Cron) | Endpoint implementado y probado · **pendiente de configuración** |

Fuera de alcance, sin tocar: prórrogas, informes, OCR, plantillas de escritos,
recuperación de contraseña por correo, Google Calendar/Outlook, WhatsApp, app
móvil, validación jurídica del calendario 2027.

---

## 3. Arquitectura

```
Navegador ──► Vercel (SPA) ──/api──► Render (Express) ──► PostgreSQL (Supabase)
                                         │   ▲
                       POST /api/interno/programador (CRON_SECRET)
                                         │   │
                              Supabase Cron (pg_cron + pg_net), cada 5 min
                                         │
                                         ▼
                                Resend (correo), vía fetch
```

- **Sin infraestructura nueva.** La cola es una tabla de PostgreSQL
  (`envio_notificacion`); no hay Redis, workers ni microservicios nuevos.
- **Patrón outbox.** Crear o reprogramar un evento y programar sus avisos ocurre
  en la misma transacción. Un proceso aparte entrega.
- **Dos disparadores de entrega:**
  1. El **programador externo** (cada 5 min) evalúa las alertas de plazos y
     entrega todo lo vencido de la cola, incluido el correo.
  2. Al **abrir la bandeja** (la campana), se entregan los avisos *internos*
     vencidos de ese usuario. Así la campana funciona aunque el programador no
     esté configurado. El correo depende solo del programador.
- **No hay `setInterval` en el servidor:** Render gratis duerme a los 15 minutos
  y el temporizador moriría con él justo cuando nadie usa la aplicación.

### Módulos

| Archivo | Responsabilidad |
|---|---|
| `backend/src/modulos/agenda/esquemas.ts` | Validación Zod (eventos, filtros, estado, conflictos) |
| `backend/src/modulos/agenda/fechas.ts` | Aritmética de hora de pared (sin zona) |
| `backend/src/modulos/agenda/repositorio.ts` | SQL parametrizado; toda lectura aplica visibilidad + alcance |
| `backend/src/modulos/agenda/servicio.ts` | Reglas de negocio, transacciones, programación de avisos |
| `backend/src/modulos/agenda/rutas.ts` | `/api/agenda` |
| `backend/src/modulos/notificaciones/correo.ts` | Proveedor desacoplado: deshabilitado / simulado / Resend |
| `backend/src/modulos/notificaciones/plantillas.ts` | Correos HTML + texto plano |
| `backend/src/modulos/notificaciones/cola.ts` | Encolado, toma con `SKIP LOCKED`, revalidación, reintentos |
| `backend/src/modulos/notificaciones/preferencias.ts` | Preferencias por usuario |
| `backend/src/modulos/notificaciones/programador.ts` | Corrida programada y verificación del secreto |
| `backend/src/modulos/notificaciones/rutas.ts` | Programador, preferencias, administración |
| `frontend/src/modulos/agenda/*` | Página, vistas, panel, formulario, utilidades de calendario |
| `frontend/src/modulos/notificaciones/*` | Preferencias y administración |
| `frontend/src/servicios/consultasAgenda.ts` | Acceso a datos (TanStack Query) |
| `frontend/src/estilos/agenda.css` | Estilos de la agenda y de notificaciones |

---

## 4. Decisiones de diseño

- **Agenda jurídica ≠ calendario judicial.** `/agenda` es la actividad del
  estudio (menú principal). El calendario judicial (feriados, ferias, asuetos)
  sigue en Administración, intacto: la agenda solo lo **lee** como contexto
  (día rayado y rótulo "Inhábil").
- **El listado de plazos pasó a `/plazos`** ("Plazos"), con el mismo contenido.
  Los enlaces del panel se actualizaron. Un marcador viejo a `/agenda` ahora
  abre la agenda jurídica, que también muestra los plazos.
- **Calendario propio, sin FullCalendar.** Se evaluó: sumaba ~250 KB, inyecta
  estilos en línea (choca con la CSP `style-src 'self'`) y la vista de recursos
  es paga. El calendario propio usa los tokens del sistema y pesa poco.
- **Un solo panel lateral con dos estados** (próximos ↔ detalle), ocultable.
  Evita apilar tarjetas y le deja el ancho al calendario.
- **Colores semánticos moderados** derivados de los tokens: audiencia azul,
  mediación turquesa, reunión violeta, plazo rojo, vencimiento ámbar, tarea
  verde, otro gris. Siempre con ícono y nombre (no depende solo del color).
  Solo lo crítico (plazo vencido o en alerta CRÍTICA) sube de intensidad.
- **Superposiciones en la semana:** cada día es angosto. Con menos de 170 px por
  día se muestra el primer evento a todo el ancho y una pastilla "+N" que abre
  la vista del día, donde caben hasta 6 columnas. Así ningún bloque queda
  ilegible.
- **Móvil:** la vista inicial es la lista cronológica; el panel pasa abajo;
  en el mes, cada celda muestra marcas de tipo en lugar de títulos cortados.
- **Formulario en dos columnas:** a la izquierda qué y cuándo; a la derecha con
  quién y cómo se avisa. Las observaciones internas quedan plegadas.
- **Vista previa de correos sin iframe:** la CSP también rige dentro de un iframe
  `srcdoc`. Se parsea el HTML con `DOMParser`, se descartan scripts y atributos
  `on*`, y los estilos se aplican por CSSOM dentro de un Shadow DOM.

Capturas reales (aplicación local, datos ficticios del seed) en
[`docs/fase-5/capturas/`](fase-5/capturas/):

| # | Pantalla |
|---|---|
| 1 | [Calendario mensual](fase-5/capturas/01-calendario-mensual.png) |
| 2 | [Calendario semanal](fase-5/capturas/02-calendario-semanal.png) (superposición resumida en "+2") |
| 3 | [Calendario diario](fase-5/capturas/03-calendario-diario.png) (cuatro eventos simultáneos en columnas) |
| 4 | [Vista agenda](fase-5/capturas/04-vista-agenda.png) |
| 5 | [Nuevo evento](fase-5/capturas/05-nuevo-evento.png) |
| 6 | [Detalle de evento](fase-5/capturas/06-detalle-evento.png) |
| 7 | [Preferencias de notificación](fase-5/capturas/07-preferencias.png) |
| 8 | [Vista previa de correo](fase-5/capturas/08-vista-previa-correo.png) |
| 9 | [Administración de notificaciones](fase-5/capturas/09-administracion-notificaciones.png) |
| 10 | [Sin panel lateral](fase-5/capturas/10-sin-panel-lateral.png) |
| 11 | [Celular (390 px)](fase-5/capturas/11-movil.png) |
| 12 | [Tablet (820 px)](fase-5/capturas/12-tablet.png) |

---

## 5. Modelo de datos — migración `014_agenda_y_correo.sql`

Incremental: no modifica migraciones anteriores. `schema.sql` se actualizó
(concatenación). Probada sobre la base local existente **y** sobre una base
nueva (`schema.sql` + seeds) en un contenedor descartable.

| Objeto | Cambio |
|---|---|
| `evento_calendario` | + `estado`, `prioridad`, `visibilidad`, `responsable_id`, `persona_id`, `enlace_virtual`, `observaciones`, `version`, `actualizado_por`, `completado_en`, `cancelado_en`, `motivo_cancelacion`. Tipo `MEDIACION`. CHECK de estado, prioridad, visibilidad, coherencia de cancelación/finalización, enlace `https://`, título no vacío. Índices por responsable, causa y creador. `plazo_id` queda obsoleto (la agenda no copia plazos). |
| `evento_participante` | N:M evento–usuario. |
| `evento_historial` | Cambios del evento, escritos en la misma transacción. |
| `regla_recordatorio` | Anticipación por defecto de cada tipo (24 h y 1 h para audiencia, mediación y reunión). Configurable sin tocar código. |
| `evento_recordatorio` | Anticipaciones de cada evento. |
| `preferencia_notificacion` | Preferencias de correo por usuario. Sin fila = todo activado. |
| `envio_notificacion` | Cola persistente (ver sección 7). |
| `ejecucion_programador` | Cada corrida del proceso de avisos. |
| `notificacion` | + `evento_id`; índice de bandeja solo `IN_APP`. |
| `alerta` | + `fecha_vencimiento_ref` (completado desde el plazo); la clave única pasa a ser plazo + regla + fecha. |
| Permisos | `agenda.ver/crear/editar/cancelar` (los tres roles) y `configuracion.notificaciones` (solo Administrador). |
| Supabase | RLS activado sin políticas en las 7 tablas nuevas; se revocan permisos a `anon`/`authenticated` (misma estrategia que 013). |

Fechas: los instantes reales son `TIMESTAMPTZ`; la API trabaja en **hora de
pared del estudio** (`ZONA_HORARIA`) y la base convierte con `AT TIME ZONE`. Un
evento de día completo se guarda de 00:00:00 a 23:59:59 locales y la API lo
devuelve como fechas (`YYYY-MM-DD`). Los plazos siguen siendo `DATE`: **no se
inventa una hora de vencimiento**.

Seed de demostración (`002_datos_demo.sql`): 12 eventos con fechas **relativas a
la fecha de carga** (corridas al lunes si caen en fin de semana), con
superpuestos, de varios días, completado, cancelado y personal.

---

## 6. Integración con plazos, tareas y alertas existentes

- **Plazos y tareas se leen de sus tablas**, con el mismo alcance que sus
  módulos (`plazo.ver` / `tarea.ver`). En la agenda no son editables: el
  detalle lleva a su flujo (`/expedientes/:id?pestana=plazos`, `/tareas`).
  Una prueba verifica que no se crea ninguna fila en `evento_calendario`.
- **Gravedad de un plazo** en la agenda: la de la alerta vigente calculada por
  `vigentes()` (días hábiles, reglas del estudio). No se usan días corridos.
- **Alertas por correo:** `evaluarYRegistrar` (sin cambios en sus reglas)
  además encola **un** correo por plazo y evaluación, el del nivel más grave,
  igual que la notificación interna. Solo nace de alertas **nuevas**: habilitar
  el correo no reenvía avisos viejos.
- **Cambio de fecha de un plazo:** con la nueva clave (plazo + regla + fecha) una
  regla puede volver a avisar por la fecha nueva; por la misma fecha, nunca dos
  veces. El correo pendiente de una fecha vieja se cancela al revalidar (`OBSOLETO`).
- **Suspensión, cumplimiento o cancelación de un plazo:** el correo pendiente se
  cancela al revalidar (`PLAZO_CERRADO`). La evaluación ya excluía plazos no
  pendientes.
- **Cambio de responsable de un plazo:** el correo se revalida contra el acceso
  actual del destinatario. *No* se agregó un aviso de "te asignaron un plazo"
  (fuera de lo pedido para eventos; queda como mejora).
- **`hoy()`** ahora usa `ZONA_HORARIA` (por defecto `America/Argentina/Buenos_Aires`).
  No cambia ninguna regla de cómputo: corrige qué día es hoy.

---

## 7. Cola, reintentos e idempotencia

Cada fila de `envio_notificacion` es una entrega a un usuario por un canal.

| Estado | Significado |
|---|---|
| `PENDIENTE` | Espera su instante o un reintento. |
| `PROCESANDO` | Tomada por un proceso, con vencimiento (`bloqueado_hasta`, 5 min). |
| `ACEPTADO` | Entregada en la campana, o **aceptada por el proveedor**. No implica que llegó al buzón ni que se leyó. |
| `FALLIDO` | Agotó 5 intentos o el proveedor la rechazó de forma definitiva (4xx). |
| `CANCELADO` | Dejó de tener sentido: `OBSOLETO`, `EVENTO_CANCELADO`, `EVENTO_COMPLETADO`, `EVENTO_INICIADO`, `SIN_ACCESO`, `USUARIO_INACTIVO`, `PREFERENCIA`, `CORREO_DESHABILITADO`, `DESACTUALIZADO`, `PLAZO_CERRADO`. |

- **Toma concurrente:** un único `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)`.
  Dos procesos nunca toman la misma fila. Ninguna transacción queda abierta
  durante la llamada al proveedor.
- **Reintentos:** 1 min, 5 min, 30 min, 2 h; al quinto intento, `FALLIDO`. Un
  administrador puede reintentar un fallido.
- **Recuperación:** una fila `PROCESANDO` con el bloqueo vencido (proceso caído)
  se vuelve a tomar.
- **Ventana proveedor-acepta / base-no-registra:** la `clave_idempotencia` viaja
  como `Idempotency-Key` a Resend; un reintento no genera un segundo correo.
- **Antes de cada entrega se revalida:** usuario activo, acceso actual al evento
  o expediente, versión y estado del evento, preferencias, correo habilitado,
  vigencia (un aviso inmediato con más de 24 h de atraso se descarta; un
  recordatorio de algo que ya empezó también).
- **Reprogramar** sube la `version` del evento, cancela los recordatorios
  pendientes y programa los nuevos, en la misma transacción.

---

## 8. Endpoints

| Método y ruta | Permiso | Descripción |
|---|---|---|
| `GET /api/agenda?desde&hasta&tipos&responsable&causa&estado&prioridad&alcance&completados&cancelados` | `agenda.ver` | Vista unificada. Rango máximo: 100 días. |
| `GET /api/agenda/conflictos` | `agenda.ver` | Superposiciones (de las que no se ven, solo la cantidad). |
| `GET /api/agenda/recordatorios` | `agenda.ver` | Anticipaciones por defecto por tipo. |
| `POST /api/agenda/eventos` | `agenda.crear` | Alta. Devuelve el evento y las superposiciones. |
| `GET /api/agenda/eventos/:id` | `agenda.ver` | Detalle (404 si no es visible). |
| `PUT /api/agenda/eventos/:id` | `agenda.editar` | Edición / reprogramación. |
| `PATCH /api/agenda/eventos/:id/estado` | `agenda.editar` (+ `agenda.cancelar` para cancelar) | Confirmar, completar, cancelar (motivo obligatorio), reabrir. |
| `GET /api/agenda/eventos/:id/historial` | `agenda.ver` | Historial. |
| `GET/PUT /api/cuenta/notificaciones` | sesión | Preferencias propias. |
| `GET /api/notificaciones/administracion` | `configuracion.notificaciones` | Estado de correo, programador y cola. |
| `POST /api/notificaciones/administracion/procesar` | ídem | Corrida manual. |
| `POST /api/notificaciones/administracion/prueba` | ídem | Correo de prueba **solo a la propia dirección**, 3 por hora. |
| `POST /api/notificaciones/administracion/envios/:id/reintentar` | ídem | Reintenta un fallido. |
| `GET /api/notificaciones/administracion/plantillas/:plantilla` | ídem | Vista previa con datos de ejemplo. |
| `POST /api/interno/programador` | secreto `CRON_SECRET` | Corrida del programador externo. |

Todos los cambios se registran además en la auditoría general.

---

## 9. Seguridad

- **Permiso (qué) + alcance (sobre qué)** en listados, detalle, alta, edición,
  cancelación, conflictos, historial, panel, bandeja y entregas.
- **Visibilidad del evento:** `ESTUDIO`, `PARTICIPANTES` o `PERSONAL`. Un evento
  sin expediente **no** es público por defecto. Ni Administrador ni Jefe de
  Estudio ven los eventos personales de otros.
- **Ser participante no abre un expediente:** no se puede convocar ni asignar
  como responsable a quien no tiene acceso a la causa del evento; se valida la
  causa nueva al cambiar la vinculación.
- **Quién modifica:** creador, responsable o Administrador/Jefe de Estudio. Un
  participante ve pero no edita. Lo no visible responde **404** (no revela ids).
- **Persona vinculada:** tiene que ser parte de la causa elegida.
- **Programador:** secreto exclusivo en `Authorization: Bearer`, nunca en la URL;
  comparación en tiempo constante (hash + `timingSafeEqual`); 503 sin secreto
  configurado; límite de 6 corridas por minuto; respuesta solo con contadores.
  Un token de usuario no sirve como secreto (probado).
- **Correo:** sin carátulas, nombres de clientes, títulos de eventos ni motivos.
  Los enlaces exigen iniciar sesión. Pie: "no certifica ningún vencimiento".
  Destinatarios: solo integrantes del estudio; nunca clientes externos.
- **Bandeja:** cuenta y marca solo `IN_APP`; un aviso viejo sobre un expediente
  o evento al que ya no se tiene acceso se muestra sin el detalle.
- **Administración:** nunca expone la clave de Resend ni el secreto; solo si
  están configurados. Errores del proveedor saneados (sin destinatario ni cuerpo).
- **Pruebas:** nunca envían correo real; en `NODE_ENV=test` el modo `real` se
  degrada a `simulado`.

---

## 10. Configuración externa pendiente (no se ejecutó nada)

**Pendiente de autorización** antes de cualquier envío real:

1. Separar la base y el `JWT_SECRET` del entorno de Martín (riesgo ya conocido)
   y desactivar los usuarios de demostración (`database/mantenimiento/desactivar-usuarios-demo.sql`).
2. Aplicar la migración `014` en Supabase (`psql -f database/migrations/014_agenda_y_correo.sql`,
   conexión de modo sesión, puerto 5432).
3. Decidir el dominio remitente y verificarlo en Resend (registros SPF/DKIM).

**Pendiente de configuración** (Render → Environment):

| Variable | Valor |
|---|---|
| `ZONA_HORARIA` | `America/Argentina/Buenos_Aires` (ya en `render.yaml`) |
| `APP_URL` | `https://sistemalegal-henna.vercel.app` |
| `CRON_SECRET` | 48+ caracteres, generado como `JWT_SECRET`, distinto |
| `CORREO_MODO` | `simulado` primero; `real` recién después de validar |
| `CORREO_REMITENTE` | `SistemaLegal <avisos@dominio-verificado>` |
| `RESEND_API_KEY` | clave de Resend |

**Programador:** correr una vez, en el SQL Editor de Supabase,
[`database/mantenimiento/programador-supabase.sql`](../database/mantenimiento/programador-supabase.sql)
(reemplazando URL y secreto). Verificar en **Administración → Notificaciones**
que la "última ejecución" se actualiza cada 5 minutos, y enviar un correo de
prueba.

### Programador: alternativas evaluadas

| Opción | Costo | Confiabilidad | Decisión |
|---|---|---|---|
| **Supabase Cron** (pg_cron + pg_net) | Incluido en el plan | Precisión de 1 min. Se detiene si el proyecto gratuito se pausa (7 días sin uso). El secreto queda legible en `net.http_request_queue` hasta enviarse. | **Elegida** para esta etapa: no suma servicios. |
| **Render Cron Job** (`curl` al endpoint) | Mínimo US$ 1/mes por cron job, se factura por minuto | Independiente de la base | Alternativa de respaldo. |
| **GitHub Actions** (`schedule`) | Gratis | Puede atrasarse varios minutos o saltearse corridas | **Descartada** como garantía para avisos jurídicos. |

Limitaciones de la capa gratuita: Render duerme el servicio (primer pedido
~50 s; por eso el timeout de 60 s en el job); si el job no llega a tiempo, la
corrida siguiente recupera lo atrasado. Los recordatorios de eventos que ya
empezaron se descartan en lugar de llegar tarde.

### Costos estimados

| Servicio | Plan | Costo |
|---|---|---|
| Resend | Free: 3.000 correos/mes, 100/día, 3 dominios | US$ 0 |
| Resend | Pro: 50.000 correos/mes | US$ 20/mes |
| Supabase Cron | Incluido | US$ 0 |
| Render Cron Job (si se usa) | Mínimo | US$ 1/mes |

Para un estudio chico, 100 correos por día alcanzan (unos 10 integrantes con
varios eventos diarios). Para producción real, además, conviene que Render y
Supabase estén en planes pagos (sin siesta ni pausa).

---

## 11. Pruebas

| Conjunto | Resultado |
|---|---|
| Backend (Vitest + Supertest + PostgreSQL local) | **223 pruebas**: 183 existentes + 40 nuevas (`agenda.test.ts`, `notificaciones.test.ts`). Pasaron 223/223 en la corrida de las 13:2x. En la corrida final, una prueba **existente** (`el admin da de alta a alguien…`) excedió su límite de 5 s porque la CPU de la máquina estaba al 100 % por un proceso ajeno (un hash bcrypt tardaba ~1 s en lugar de ~0,25 s). Ver sección 13. |
| Frontend (Vitest) | **15/15** (8 existentes + 7 de `calendario.test.ts`). |
| Typecheck backend y frontend | Sin errores. |
| Build backend y frontend | Correcto (el aviso de chunk > 500 kB del frontend es previo). |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilidades en backend y frontend. |
| Migración | Aplicada sobre la base existente y sobre una base nueva (schema + seeds). |
| Validación visual | App completa en local; revisión con capturas en 1440×900, 1280×720, 820×1180 y 390×844; dos rondas de corrección. |

Casos cubiertos por las pruebas nuevas, entre otros: audiencia con horario y
recordatorios por defecto; validaciones; día completo de varios días; evento a
las 23:30; reprogramación (recordatorios viejos `OBSOLETO`, nuevos programados,
aviso al participante y no a quien edita, historial); cancelación con y sin
motivo, filtros de cancelados, edición de un cerrado (409), reapertura;
finalización; superposiciones; evento personal invisible para todos los demás
(incluida la dirección); evento de participantes; evento de estudio vinculado a
causa no asignada; vincular causa ajena / convocar sin acceso / cambiar la
vinculación (400); empleado que intenta modificar uno ajeno (403); ids
inválidos y ajenos; vista unificada sin duplicados; plazo no copiado a eventos;
días inhábiles; "mis eventos"; límite de rango; calendario judicial intacto;
entrega interna y por correo con la campana contando solo lo interno; correo
sin datos sensibles; preferencias; correo deshabilitado; reintentos hasta
`FALLIDO`; falla definitiva; dos procesos concurrentes sin duplicar; retoma de
una entrega abandonada sin segundo correo; acceso revocado antes del envío;
usuario dado de baja; recordatorio de un evento ya iniciado; clave repetida;
programador sin secreto (503), con secreto incorrecto o token de usuario (401),
correcto (200, solo contadores); administración solo para Administrador; correo
de prueba solo a la propia dirección; reintento solo de fallidos; alerta de
plazo que programa un único correo; "hoy" según la zona del estudio.

**No cubierto por pruebas automáticas:** las vistas de React (no hay pruebas de
componentes en el proyecto; se verificaron en el navegador) y el envío real por
Resend (requiere clave y dominio).

---

## 12. Despliegue y reversión

**Despliegue** (cuando se autorice): revisar y mergear la rama a `main` (Render y
Vercel despliegan desde `main`); aplicar `014` en Supabase **antes** de que
Render arranque el código nuevo; cargar las variables de la sección 10 con
`CORREO_MODO=simulado`; programar el cron; validar en Administración; recién
entonces `CORREO_MODO=real`.

**Reversión:**
- Correo: `CORREO_MODO=deshabilitado` en Render (inmediato; lo pendiente por
  correo se cancela al procesarse, no queda para después).
- Programador: `select cron.unschedule('sistemalegal-avisos');`.
- Código: revertir el merge en `main`. La migración `014` es aditiva y el código
  anterior funciona con ella aplicada, **salvo** el `INSERT … ON CONFLICT` de
  `alerta`, que en el código anterior apunta al índice que 014 reemplaza. Si se
  revierte el código, recrear el índice viejo:
  `CREATE UNIQUE INDEX uq_alerta_plazo_regla ON alerta (plazo_id, regla_alerta_id) WHERE regla_alerta_id IS NOT NULL;`
  (puede fallar si ya hay dos alertas del mismo plazo y regla por fechas
  distintas; en ese caso, borrar las más viejas).

---

## 13. Limitaciones y riesgos pendientes

- **Base compartida con el entorno de Martín**: bloqueante para correos reales.
- **Usuarios de demostración** con contraseña publicada: desactivarlos antes de
  usar el entorno con datos reales.
- **Programador** no configurado: hasta entonces los correos no salen solos (la
  campana sí funciona).
- **Prueba existente sensible a la carga de CPU** (`modulos-operacion.test.ts`,
  alta y cambio de contraseña con bcrypt costo 12 y límite de 5 s). No es una
  regresión de esta fase; conviene subirle el timeout.
- **Selector de expediente del formulario**: lista las primeras 100 causas
  activas. Para estudios grandes hace falta un buscador.
- **Participantes**: el formulario ofrece a todo el equipo; si se elige a alguien
  sin acceso a la causa, la API lo rechaza con un mensaje claro.
- **Sin aviso de "te asignaron un plazo"** ni de reprogramación de plazos (las
  alertas de plazos siguen sus reglas de siempre).
- **Recordatorios de eventos de día completo** se anclan a las 8:00 del día.
- **El correo "aceptado"** significa aceptado por Resend; no hay webhook de
  entrega (Resend lo ofrece; se puede sumar como estado `ENTREGADO`).

## 14. Próximos pasos recomendados

1. Separar la base de Martín y desactivar usuarios demo.
2. Configurar `CRON_SECRET`, aplicar `014` y el cron en modo `simulado`; validar.
3. Verificar dominio en Resend, `CORREO_MODO=real`, correo de prueba.
4. Buscador de expedientes en el formulario de eventos.
5. Webhook de Resend para el estado `ENTREGADO`.
6. Avisos de asignación y reprogramación de plazos.
