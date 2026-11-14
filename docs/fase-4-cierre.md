# Fase 4 — Cierre del MVP

Rama: `producto/fase-4-cierre` · Continúa [`fase-3-computo-de-plazos.md`](fase-3-computo-de-plazos.md).

Esta fase completa el alcance del MVP declarado en el README: lo que en la Fase 3
figuraba como «En desarrollo» en la barra lateral ahora funciona, y el despliegue
quedó resuelto para que la sesión sobreviva en cualquier navegador.

---

## 1. Qué se agregó

| Módulo | Backend | Pantalla |
|---|---|---|
| **Tareas** | `modulos/tareas/` — alta, edición, cambio de estado (pendiente → en curso → completada / cancelada), baja; filtros por persona, estado y prioridad | `/tareas` (arranca en «mis tareas abiertas») y pestaña Tareas del expediente |
| **Calendario judicial** | `modulos/calendario/` — alta de un día o de un rango (la feria), copia de los feriados de fecha fija de un año a otro, edición y baja | `/calendario`, con aviso si el año siguiente está vacío |
| **Alertas y avisos** | `modulos/alertas/` — evaluación multinivel contra `regla_alerta`, en días hábiles; registro idempotente en `alerta` y `notificacion` | Tarjeta de alertas en la Agenda y campana con la bandeja en la barra superior |
| **Documentos** | `modulos/documentos/` — subida binaria con detección del tipo por contenido, almacenamiento en Supabase Storage (o disco en local), descarga, extracción de texto, búsqueda de texto completo | Pestaña Documentos del expediente (arrastrar y soltar) y `/documentos` (búsqueda) |
| **Microservicio PDF** | `pdf-service/` — Python + FastAPI + pdfplumber | — |
| **Costas y cobros** | `modulos/costas/` — alta por expediente, cobros parciales, incobrables, saldo y estado consistentes, exportación CSV | `/costas` con totales y filtros, y pestaña Costas del expediente |
| **Usuarios** | `modulos/usuarios/` — alta, edición, baja, asignación de contraseña; cambio de la propia | `/usuarios` y «Cambiar mi contraseña» en el menú de usuario |
| **Auditoría** | `modulos/auditoria/rutas.ts` — consulta paginada y filtrada | `/auditoria` con el antes y el después de cada operación |
| **Primer administrador** | `src/scripts/crear-admin.ts` (`npm run crear-admin`) | — |

Pruebas: **171** en el backend (eran 145), sumando `modulos-operacion.test.ts`
(integración sobre la base) y `alertas-y-archivos.test.ts` (unitarias).

---

## 2. Decisiones

### 2.1 La cookie de sesión y el proxy de Vercel

El traspaso lo marcaba como bloqueante: con el frontend en Vercel y la API en
Render, la cookie del refresh token era de terceros y Safari (y Chrome en
incógnito) la descartan. Se resolvió con la opción más simple:
`frontend/vercel.json` reenvía `/api/*` a Render y la SPA, en producción, le
habla a su propio dominio. La cookie pasa a ser de primera parte y se emite con
`SameSite=Lax`, que además frena el CSRF.

Detrás del proxy hay dos saltos antes de Express (Vercel y el balanceador de
Render): `SALTOS_PROXY=2` hace que `req.ip` sea la del usuario y no la de Vercel,
o el límite de intentos de login castigaría a todos juntos.

### 2.2 Alertas sin cron

En Render gratis el servicio se duerme, así que un proceso programado interno no
correría. Las alertas se **evalúan al consultarse** (la bandeja se pide al abrir
la aplicación y cada cinco minutos), con un intervalo mínimo entre evaluaciones.
El resultado se guarda en `alerta` y `notificacion`; el índice único
`(plazo_id, regla_alerta_id)` hace que evaluar dos veces no duplique nada, y al
responsable se le manda una sola notificación por evaluación —la más grave—
para que un plazo cargado con un día de margen no genere tres avisos juntos.
`POST /api/alertas/evaluar` queda para un cron externo si se quisiera aviso por
correo a hora fija.

La anticipación se cuenta en **días hábiles** con el mismo calendario del
cómputo: «faltan 3 días» un viernes no sirve si dos son fin de semana.

### 2.3 Documentos: contenido, no extensión

- El archivo viaja como **cuerpo binario** con los metadatos en la query string.
  Sin multipart no hace falta una dependencia de parseo, y `express.raw` corta el
  tamaño antes de que el archivo entre entero a memoria.
- El tipo se decide por los **primeros bytes** (`%PDF-`, PNG, JPEG, ZIP + `.docx`,
  texto UTF-8). Un ejecutable renombrado a `.pdf` se rechaza.
- La clave de almacenamiento es un UUID, nunca el nombre original.
- La descarga sale con `Content-Disposition: attachment` y `nosniff`: el
  navegador nunca interpreta un archivo subido como página.
- El hash SHA-256 evita cargar dos veces el mismo archivo.
- La baja es lógica y el archivo se conserva: un documento de un expediente es
  prueba.
- La extracción corre en segundo plano y nunca hace fallar la subida. Si el
  microservicio no está o falla, el estado queda en `PENDIENTE`/`ERROR` y se
  puede reintentar desde la pantalla.
- La búsqueda normaliza igual que el índice (`fn_sin_acentos` + diccionario
  español) y usa `websearch_to_tsquery`, que acepta lo que escribe una persona.

### 2.4 Costas: dinero sin flotantes

Los importes viajan como texto y se guardan como `NUMERIC`; en ningún momento
pasan por un `number` de JavaScript para operar. El estado de cobro se recalcula
en la **misma transacción** del cobro, con la costa bloqueada (`FOR UPDATE`) para
que dos cobros simultáneos no superen el saldo. El CSV sale con BOM y punto y
coma (lo que Excel en español abre sin asistente) y neutraliza las celdas que
empiezan con `=`, `+`, `-` o `@` para evitar inyección de fórmulas.

### 2.5 Usuarios: no quedarse afuera

Siempre tiene que quedar un Administrador activo, y nadie puede darse de baja ni
quitarse el rol a sí mismo. Una baja o un cambio de contraseña revoca todas las
sesiones en el acto. Para una base de producción sin datos demo, el primer
administrador se crea con `crear-admin`, que lee la contraseña de una variable
de entorno (no queda en el historial) y se niega si ya hay uno.

---

## 3. Qué no se hizo

- **Informes** (más allá del CSV de costas), **plantillas de escritos**,
  **eventos del calendario** (audiencias) y **prórrogas**: siguen sin código.
- **Notificaciones por correo**: solo en la aplicación.
- **OCR**: un PDF escaneado se guarda pero no tiene texto buscable.
- **Pruebas de frontend**: siguen sin existir; las pantallas nuevas se
  verificaron a mano en el navegador.
- La **validación jurídica** de los plazos y el calendario de 2027 siguen siendo
  trabajo de datos pendiente (ver el traspaso, 3.1 y 3.2). El calendario ahora se
  carga desde la pantalla.
