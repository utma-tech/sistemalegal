# Informe final — Sistema de Gestión Integral para Estudios Jurídicos

**Trabajo Final Integrador** — Tecnicatura Universitaria en Programación a Distancia
**Integrantes:** Martín Maine · Gevont Utmazian — **Tutor:** Sergio Andrés Antonini
**Entrega final:** 14/11/2026 — **Versión:** 1.0.0 (MVP)

> Borrador. Lo marcado **[COMPLETAR]** depende de datos que solo tiene el equipo
> (URLs definitivas del despliegue, enlace al video, capturas).

| | |
|---|---|
| Repositorio | https://github.com/martinmaine/sistemalegal |
| Aplicación desplegada | **[COMPLETAR]** dominio de Vercel |
| API | **[COMPLETAR]** `https://…onrender.com/health` |
| Video | **[COMPLETAR]** |
| Usuarios de demostración | `admin@estudiodemo.test`, `jefe@estudiodemo.test`, `empleado1@estudiodemo.test` — contraseña `Demo1234!` (datos ficticios) |

---

## 1. Resumen

Los estudios jurídicos pequeños y medianos de Córdoba siguen decenas de causas con
planillas, agendas de papel y mensajería informal. El costo de ese desorden tiene
nombre: un **plazo procesal perentorio vencido**, costas que nadie cobra y la
imposibilidad de saber quién hizo qué.

SistemaLegal es una aplicación web que centraliza el trabajo del estudio: los
expedientes con sus partes, movimientos y documentos; **el cómputo automático de
los vencimientos** sobre el calendario judicial, con la explicación de cómo se
llegó a cada fecha; alertas antes de cada vencimiento; las tareas del equipo; las
costas y su cobranza; y un registro de auditoría de cada operación.

El MVP está completo, desplegado en servicios gratuitos (Vercel, Render y
Supabase) y reproducible en local con un solo `docker compose up`.

---

## 2. Objetivos y grado de cumplimiento

Los objetivos son los de la propuesta (sección 6.2).

| # | Objetivo | Estado | Dónde verlo |
|---|---|---|---|
| 1 | Causas: CRUD, partes, carga de PDF con extracción de texto, con pruebas | **Cumplido** | Expedientes → pestañas Partes y Documentos. Pruebas en `causas*.test.ts` y `modulos-operacion.test.ts` |
| 2 | Cómputo de plazos con días hábiles y calendario configurable, ≥ 10 casos de prueba | **Cumplido** (25 casos) | `computo-plazos.test.ts`; Administración → Calendario judicial |
| 3 | Alertas multinivel y calendario compartido | **Cumplido** | Agenda (alertas crítica / importante / informativa) y campana de avisos. La agenda es el calendario compartido de vencimientos |
| 4 | Costas con seguimiento de cobros y reporte exportable | **Cumplido** | Honorarios y costas → Exportar CSV |
| 5 | Autenticación, roles y permisos, auditoría | **Cumplido con un desvío**: 3 roles, no 4 (ver 6.1) | Administración → Usuarios y permisos, Auditoría |
| 6 | Despliegue en la nube y entorno local reproducible | **Cumplido** | Sección 5 |
| 7 | Documentación y video | **Cumplido** | `README.md`, `docs/`, este informe y el video |

### Criterios de éxito (propuesta, 6.8)

| Criterio | Verificación |
|---|---|
| Crear una causa, subir un PDF y recuperar su texto | Prueba de punta a punta: subida → microservicio Python → texto guardado → encontrado por la búsqueda sin tildes («notificación» encuentra «NOTIFICACION») |
| Vencimiento correcto en ≥ 10 casos con fines de semana y feria | 25 casos en `computo-plazos.test.ts` |
| Emitir una alerta antes del vencimiento | `modulos-operacion.test.ts`: un plazo que vence mañana genera una alerta crítica y **una sola** notificación aunque se evalúe dos veces |
| Registrar y consultar costas por causa y exportar | Pestaña Costas del expediente y CSV con filtros |
| Roles con permisos diferenciados y auditoría | Pruebas de 403 por rol en cada módulo; toda escritura queda en `auditoria` con el antes y el después |
| `docker compose up` y un componente online | Ambos |
| Documentación y video | Este informe |

---

## 3. Qué hace el sistema

| Módulo | Qué resuelve |
|---|---|
| **Inicio** | Indicadores del día: causas activas, plazos por vencer y vencidos, tareas, saldo por cobrar |
| **Expedientes** | Alta, edición y baja lógica; partes (actor, demandado…), profesionales a cargo, movimientos procesales, plazos, documentos, tareas y costas en pestañas |
| **Clientes y partes** | Agenda única de personas físicas y jurídicas, reutilizable entre causas |
| **Agenda y plazos** | Qué vence y cuándo, agrupado por urgencia; alertas multinivel |
| **Cómputo de plazos** | Calcula el vencimiento en días hábiles o corridos, salteando fines de semana, feriados y feria, con suspensiones; muestra el detalle día por día |
| **Tareas** | Delegación entre integrantes con prioridad, vencimiento y estado |
| **Documentos** | Carga por arrastrar y soltar, descarga, texto extraído de los PDF y búsqueda de texto completo en todo el estudio |
| **Honorarios y costas** | Gastos del proceso, quién los soporta, cobros parciales, saldo y reporte CSV |
| **Calendario judicial** | Feriados, feria y asuetos por año; copia de feriados fijos entre años |
| **Usuarios y permisos** | Alta, rol, baja y contraseñas; cada uno cambia la propia |
| **Auditoría** | Quién hizo qué, cuándo y desde dónde, con el antes y el después |

---

## 4. Arquitectura

```
Navegador ──▶ Vercel (SPA React + TypeScript; /api/* reenviado a Render)
                 └─▶ Render: API Node + Express + TypeScript
                        ├─▶ Supabase PostgreSQL (esquema versionado, 34 tablas, 3 vistas)
                        ├─▶ Supabase Storage (documentos, bucket privado)
                        └─▶ Render: microservicio Python + FastAPI + pdfplumber
```

**Backend por módulos** (`rutas → controlador → servicio → repositorio`), con el
SQL solo en el repositorio y todos los valores como parámetros. Validación con Zod
en el borde: los errores vuelven por campo y el formulario los muestra bajo cada
control.

**El algoritmo está en el código; las reglas, en la base.** El cómputo de plazos
(`backend/src/modulos/plazos/computo.ts`) es una función pura que recibe la
notificación, la regla y el calendario. Cuántos días tiene un plazo y qué días son
inhábiles son filas de `tipo_plazo` y `dia_inhabil`: agregar una provincia es
cargar datos, no programar. Es la mitigación del riesgo R3 de la propuesta.

**Seguridad.** Contraseñas con bcrypt; access token de 15 minutos en memoria y
refresh token opaco en cookie `httpOnly` con rotación y detección de reutilización
(si alguien reusa un token ya consumido, se cierran todas las sesiones de la
cuenta). Permisos granulares por fila de `rol_permiso`, verificados en el servidor
en cada petición. Límite de intentos de login. Archivos validados por contenido y
servidos como descarga. TLS verificado contra la CA de Supabase (sin desactivar la
verificación). CSV protegido contra inyección de fórmulas.

**Dinero sin flotantes.** Los importes son `NUMERIC` en la base y texto en el
transporte; el estado de cobro se recalcula en la misma transacción del cobro,
con la fila bloqueada.

---

## 5. Despliegue

| Componente | Plataforma | Notas |
|---|---|---|
| SPA | Vercel | Proxy de `/api/*` hacia Render: la cookie de sesión es de primera parte y ningún navegador la bloquea |
| API | Render (Blueprint `render.yaml`) | `JWT_SECRET` obligatorio; no arranca sin él |
| Microservicio PDF | Render (mismo Blueprint) | Token compartido con la API |
| Base y archivos | Supabase | Pooler IPv4 en modo transacción; bucket privado |
| Local | Docker Compose | Base, API, microservicio y SPA con un comando |

La guía paso a paso y los problemas conocidos de la capa gratuita están en
[`despliegue.md`](despliegue.md).

---

## 6. Desvíos respecto de la propuesta

Se documentan para que la diferencia entre lo prometido y lo entregado sea
explícita y justificada.

### 6.1 Tres roles en lugar de cuatro

La propuesta preveía un cuarto rol de Super Admin de la plataforma, pensado para
un modelo multiestudio. Durante el diseño de la base, y con la aprobación del tutor,
se simplificó a **un estudio por instalación** (commit `40606a0`): cada estudio tiene su propia base, lo que
aísla los datos personales de cada uno (Ley 25.326) sin la complejidad de filtrar
por estudio en cada consulta. Sin multiestudio, el Super Admin no tiene función.
Quedan Administrador, Jefe de Estudio y Empleado.

### 6.2 JWT sin Passport.js

La propuesta y la arquitectura mencionan «JWT + Passport.js». Se implementó con
`jsonwebtoken` y `bcryptjs` directamente: para una sola estrategia (correo y
contraseña) Passport agrega una capa de abstracción sin aportar nada, y el manejo
propio permitió la rotación del refresh token con detección de reutilización. El
README se corrigió; los documentos de las entregas anteriores se conservan como se
presentaron.

### 6.3 Alertas evaluadas al consultar

Se preveía un proceso programado. En la capa gratuita de Render el servicio se
duerme y un cron interno no correría; las alertas se evalúan al abrir la
aplicación (y cada cinco minutos) y se registran de forma idempotente. Queda un
endpoint para un cron externo si se agregan avisos por correo.

### 6.4 Neon → Supabase

La base de producción pasó de Neon a Supabase (commit `4537f65`). En la Fase 4
eso además permitió usar Supabase Storage para los documentos, en la misma
plataforma. De Supabase se usa PostgreSQL y Storage; la autenticación sigue
siendo propia del backend.

### 6.5 Cifrado de datos sensibles

Las contraseñas se guardan con hash bcrypt y los tokens con SHA-256; la conexión
viaja cifrada y Supabase cifra el disco en reposo. **No** se implementó cifrado a
nivel de columna de datos personales (DNI, domicilio): queda como mejora.

---

## 7. Calidad y pruebas

- **171 pruebas automatizadas** en el backend (Vitest + Supertest): 25 casos del
  motor de cómputo, integración de cada módulo contra PostgreSQL real, permisos por
  rol, CORS, conexión TLS y reglas de negocio (no quedarse sin administrador, no
  cobrar de más, no duplicar alertas, rechazar archivos disfrazados).
- Las pruebas de escritura **releen de la base** lo que guardaron en lugar de
  confiar en la respuesta, y limpian sus propios datos.
- Integración continua en GitHub Actions sobre una base limpia en cada pull request.
- El frontend se verifica con el compilador de TypeScript y el build; **no tiene
  pruebas automatizadas** (limitación conocida).

---

## 8. Limitaciones y trabajo futuro

| Qué | Estado |
|---|---|
| **Validación jurídica de las reglas de plazos** | Los días y el tipo de cómputo de los 10 tipos de plazo vienen del seed y no los validó un abogado; `articulo_referencia` está vacío. La interfaz lo advierte: el cómputo es una ayuda, no un dictamen |
| Calendario 2027 | Hay que cargarlo (la pantalla avisa y permite copiar los feriados fijos) |
| Informes, plantillas de escritos, audiencias, prórrogas | Sin implementar; las tablas existen |
| Avisos por correo, OCR de PDF escaneados | Sin implementar |
| Pruebas de frontend, auditoría de accesibilidad | Pendientes |
| IA (análisis de textos, jurisprudencia) | Fuera del MVP, como preveía la propuesta |

---

## 9. Conclusiones

**[COMPLETAR por el equipo]** — Sugerencia de puntos: qué aprendieron del dominio
jurídico (los plazos son datos, no código), la decisión de priorizar el cómputo
explicable por sobre la cantidad de módulos, el valor de las pruebas contra una
base real, y cómo se resolvieron los obstáculos de la capa gratuita (IPv6 de
Supabase, cookies entre dominios, servicios que se duermen).

---

## Anexo A — Guion del video (≈ 5 minutos, en inglés)

> La consigna pide el video preferentemente en inglés. Antes de grabar: despertar
> la API (`/health`), revisar que Supabase no esté pausado y tener un PDF de
> ejemplo a mano. Si algo falla en vivo, `docker compose up` es el respaldo.

**0:00 — The problem (30 s).** *Small law firms in Córdoba track dozens of cases
with spreadsheets and paper diaries. Missing a procedural deadline can lose a
case. SistemaLegal puts cases, deadlines, documents, tasks and costs in one place.*

**0:30 — Login and dashboard (30 s).** Entrar como `jefe@estudiodemo.test`.
*Each role sees only what it is allowed to; permissions are checked on the server.*
Mostrar los indicadores del inicio.

**1:00 — A case (60 s).** Abrir un expediente: partes, profesionales, movimientos.
Pestaña Documentos: arrastrar un PDF; mostrar «Texto extraído» y abrir el texto.
*A separate Python microservice extracts the text with pdfplumber.*

**2:00 — The core: deadline computation (75 s).** Pestaña Plazos → nuevo plazo, 5
días hábiles, notificación un viernes antes de un feriado. Mostrar la explicación
día por día. *The algorithm is code; the rules are data. Holidays and the judicial
recess live in the database, so supporting another province means loading data,
not rewriting code.* Mostrar Calendario judicial.

**3:15 — Alerts (30 s).** Agenda: alertas crítica / importante / informativa y la
campana. *Alerts are counted in business days, the same way the deadline is.*

**3:45 — Costs and tasks (40 s).** Registrar un cobro parcial; el saldo y el estado
se actualizan. Exportar el CSV. Crear una tarea para otro integrante.

**4:25 — Audit and security (20 s).** Auditoría: abrir un evento con el antes y el
después. *Every write is audited; passwords and tokens never are.*

**4:45 — Architecture and closing (15 s).** Diagrama de la sección 4. *React on
Vercel, Node on Render, PostgreSQL and storage on Supabase, 171 automated tests,
and the whole system runs locally with one command.*
