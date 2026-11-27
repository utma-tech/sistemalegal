-- =============================================================================
-- 014 — Agenda jurídica, recordatorios y cola de notificaciones
-- Sistema de Gestión Integral para Estudios Jurídicos
-- =============================================================================
--
-- Fase 5. Tres piezas, todas sobre PostgreSQL, sin infraestructura nueva:
--
--  1. Agenda: `evento_calendario` (creada en 006 y sin uso hasta ahora) pasa a
--     ser la tabla de audiencias, mediaciones, reuniones y demás compromisos,
--     con estado, responsable, participantes, visibilidad e historial. Los
--     plazos y las tareas NO se copian acá: la agenda los lee de sus tablas.
--
--  2. Recordatorios: `regla_recordatorio` es la política del estudio (cuánto
--     antes se avisa de cada tipo de evento) y `evento_recordatorio` lo que
--     quedó configurado en cada evento.
--
--  3. Entrega: `envio_notificacion` es una cola persistente (patrón outbox).
--     Cada fila es UNA entrega a UN usuario por UN canal, programada para un
--     instante. Un proceso externo la consume; si el servidor se reinicia, la
--     cola sigue en la base. `notificacion` (007) sigue siendo el registro de
--     lo entregado: la campana muestra sus filas IN_APP.
--
-- Nada de esta migración modifica el cómputo de plazos ni las reglas de alerta
-- por días hábiles. Solo se ajusta la clave de idempotencia de `alerta` para
-- que un plazo cuya fecha cambia pueda volver a avisar por la fecha nueva.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Eventos de agenda
-- -----------------------------------------------------------------------------
ALTER TABLE evento_calendario
    ADD COLUMN estado              VARCHAR(12)  NOT NULL DEFAULT 'PENDIENTE',
    ADD COLUMN prioridad           VARCHAR(6)   NOT NULL DEFAULT 'MEDIA',
    ADD COLUMN visibilidad         VARCHAR(14)  NOT NULL DEFAULT 'ESTUDIO',
    ADD COLUMN responsable_id      UUID REFERENCES usuario(id) ON DELETE SET NULL,
    ADD COLUMN persona_id          UUID REFERENCES persona(id) ON DELETE SET NULL,
    ADD COLUMN enlace_virtual      VARCHAR(500),
    ADD COLUMN observaciones       TEXT,
    ADD COLUMN version             INTEGER      NOT NULL DEFAULT 1,
    ADD COLUMN actualizado_por     UUID REFERENCES usuario(id) ON DELETE SET NULL,
    ADD COLUMN completado_en       TIMESTAMPTZ,
    ADD COLUMN cancelado_en        TIMESTAMPTZ,
    ADD COLUMN motivo_cancelacion  VARCHAR(300);

-- Mediación se suma a los tipos. VENCIMIENTO queda para los vencimientos
-- administrativos (un plazo procesal vive en `plazo`, no acá).
ALTER TABLE evento_calendario DROP CONSTRAINT ck_evento_tipo;
ALTER TABLE evento_calendario ADD CONSTRAINT ck_evento_tipo CHECK (
    tipo IN ('AUDIENCIA', 'MEDIACION', 'REUNION', 'VENCIMIENTO', 'OTRO')
);

ALTER TABLE evento_calendario
    ADD CONSTRAINT ck_evento_estado CHECK (
        estado IN ('PENDIENTE', 'CONFIRMADO', 'COMPLETADO', 'CANCELADO')
    ),
    ADD CONSTRAINT ck_evento_prioridad CHECK (prioridad IN ('ALTA', 'MEDIA', 'BAJA')),
    -- PERSONAL: solo quien lo creó y su responsable.
    -- PARTICIPANTES: además, los participantes cargados.
    -- ESTUDIO: todo el que vea la agenda (y, si cuelga de un expediente, lo vea).
    ADD CONSTRAINT ck_evento_visibilidad CHECK (
        visibilidad IN ('PERSONAL', 'PARTICIPANTES', 'ESTUDIO')
    ),
    ADD CONSTRAINT ck_evento_version CHECK (version > 0),
    ADD CONSTRAINT ck_evento_cancelacion CHECK (
        (estado = 'CANCELADO') = (cancelado_en IS NOT NULL)
    ),
    ADD CONSTRAINT ck_evento_completado CHECK (
        (estado = 'COMPLETADO') = (completado_en IS NOT NULL)
    ),
    -- Un enlace de reunión que no es https no se guarda: evita javascript: y
    -- similares en un dato que la interfaz muestra como vínculo.
    ADD CONSTRAINT ck_evento_enlace CHECK (
        enlace_virtual IS NULL OR enlace_virtual ~ '^https://'
    ),
    ADD CONSTRAINT ck_evento_titulo CHECK (length(btrim(titulo)) > 0);

COMMENT ON COLUMN evento_calendario.plazo_id IS
    'Obsoleto desde 014: la agenda lee los plazos de su propia tabla para no '
    'duplicarlos. La API no lo escribe.';
COMMENT ON COLUMN evento_calendario.version IS
    'Sube cada vez que cambia algo que afecta a los avisos (fecha, responsable, '
    'participantes, recordatorios, estado). Un recordatorio programado para '
    'otra versión no se entrega.';
COMMENT ON COLUMN evento_calendario.fecha_fin IS
    'Inclusiva. En un evento de día completo es el último día a las 23:59:59 '
    'en la zona horaria del estudio.';

CREATE INDEX ix_evento_responsable ON evento_calendario (responsable_id, fecha_inicio);
CREATE INDEX ix_evento_causa       ON evento_calendario (causa_id) WHERE causa_id IS NOT NULL;
CREATE INDEX ix_evento_creador     ON evento_calendario (creado_por);

-- -----------------------------------------------------------------------------
-- evento_participante — integrantes del estudio convocados a un evento.
--
-- Ser participante NO da acceso al expediente: la API rechaza convocar a quien
-- no ve la causa del evento.
-- -----------------------------------------------------------------------------
CREATE TABLE evento_participante (
    evento_id   UUID NOT NULL REFERENCES evento_calendario(id) ON DELETE CASCADE,
    usuario_id  UUID NOT NULL REFERENCES usuario(id)           ON DELETE CASCADE,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (evento_id, usuario_id)
);

CREATE INDEX ix_evento_participante_usuario ON evento_participante (usuario_id);

-- -----------------------------------------------------------------------------
-- evento_historial — qué cambió en el evento, quién y cuándo.
--
-- Se escribe en la misma transacción que el cambio: una reprogramación no
-- puede quedar sin registro. La auditoría general (011) sigue recibiendo su
-- copia con IP y navegador.
-- -----------------------------------------------------------------------------
CREATE TABLE evento_historial (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    evento_id   UUID NOT NULL REFERENCES evento_calendario(id) ON DELETE CASCADE,
    usuario_id  UUID REFERENCES usuario(id) ON DELETE SET NULL,
    accion      VARCHAR(15) NOT NULL,
    detalle     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    motivo      VARCHAR(300),
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ck_evento_historial_accion CHECK (
        accion IN ('CREADO', 'EDITADO', 'REPROGRAMADO', 'CONFIRMADO',
                   'COMPLETADO', 'CANCELADO', 'REABIERTO')
    )
);

CREATE INDEX ix_evento_historial_evento ON evento_historial (evento_id, creado_en DESC);

-- -----------------------------------------------------------------------------
-- 2. Recordatorios
--
-- regla_recordatorio: anticipación por defecto de cada tipo de evento. Se copia
-- al evento al crearlo; después cada evento puede tener las suyas.
-- -----------------------------------------------------------------------------
CREATE TABLE regla_recordatorio (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo_evento    VARCHAR(12) NOT NULL,
    minutos_antes  INTEGER     NOT NULL,
    activa         BOOLEAN     NOT NULL DEFAULT TRUE,
    creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ck_regla_recordatorio_tipo CHECK (
        tipo_evento IN ('AUDIENCIA', 'MEDIACION', 'REUNION', 'VENCIMIENTO', 'OTRO')
    ),
    -- Hasta 30 días antes.
    CONSTRAINT ck_regla_recordatorio_minutos CHECK (minutos_antes BETWEEN 0 AND 43200),
    CONSTRAINT uq_regla_recordatorio UNIQUE (tipo_evento, minutos_antes)
);

INSERT INTO regla_recordatorio (tipo_evento, minutos_antes) VALUES
    ('AUDIENCIA', 1440), ('AUDIENCIA', 60),
    ('MEDIACION', 1440), ('MEDIACION', 60),
    ('REUNION',   1440), ('REUNION',   60)
ON CONFLICT (tipo_evento, minutos_antes) DO NOTHING;

CREATE TABLE evento_recordatorio (
    evento_id      UUID    NOT NULL REFERENCES evento_calendario(id) ON DELETE CASCADE,
    minutos_antes  INTEGER NOT NULL,
    PRIMARY KEY (evento_id, minutos_antes),

    CONSTRAINT ck_evento_recordatorio_minutos CHECK (minutos_antes BETWEEN 0 AND 43200)
);

-- -----------------------------------------------------------------------------
-- preferencia_notificacion — qué avisos quiere cada integrante por correo.
--
-- Sin fila, valen los valores por defecto. Dentro del sistema los avisos se
-- muestran siempre: estas preferencias gobiernan solo el correo, para que
-- apagarlo nunca esconda un vencimiento crítico.
-- -----------------------------------------------------------------------------
CREATE TABLE preferencia_notificacion (
    usuario_id               UUID PRIMARY KEY REFERENCES usuario(id) ON DELETE CASCADE,
    correo_habilitado        BOOLEAN     NOT NULL DEFAULT TRUE,
    recordatorio_audiencia   BOOLEAN     NOT NULL DEFAULT TRUE,
    recordatorio_mediacion   BOOLEAN     NOT NULL DEFAULT TRUE,
    recordatorio_reunion     BOOLEAN     NOT NULL DEFAULT TRUE,
    recordatorio_otros       BOOLEAN     NOT NULL DEFAULT TRUE,
    aviso_plazos             BOOLEAN     NOT NULL DEFAULT TRUE,
    aviso_asignaciones       BOOLEAN     NOT NULL DEFAULT TRUE,
    aviso_reprogramaciones   BOOLEAN     NOT NULL DEFAULT TRUE,
    aviso_cancelaciones      BOOLEAN     NOT NULL DEFAULT TRUE,
    actualizado_en           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER tg_preferencia_notificacion_actualizado
    BEFORE UPDATE ON preferencia_notificacion
    FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp();

-- -----------------------------------------------------------------------------
-- 3. Cola persistente de entregas (outbox)
--
-- Estados:
--   PENDIENTE   espera su instante (programado_para) o un reintento.
--   PROCESANDO  tomada por un proceso; si ese proceso muere, al vencer
--               bloqueado_hasta otro la vuelve a tomar.
--   ACEPTADO    entregada en la bandeja (IN_APP) o ACEPTADA por el proveedor de
--               correo. Aceptada no significa leída ni recibida en el buzón.
--   FALLIDO     agotó los reintentos o el proveedor la rechazó en forma
--               definitiva. Un administrador puede reintentarla.
--   CANCELADO   dejó de tener sentido antes de entregarse (evento
--               reprogramado o cancelado, usuario dado de baja, sin acceso,
--               preferencia apagada, correo deshabilitado, aviso viejo).
--
-- clave_idempotencia es única: programar dos veces lo mismo no duplica, y es
-- la que viaja al proveedor de correo para que un reintento tras una caída no
-- mande el mensaje dos veces.
-- -----------------------------------------------------------------------------
CREATE TABLE envio_notificacion (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id          UUID NOT NULL REFERENCES usuario(id)           ON DELETE CASCADE,
    canal               VARCHAR(10)  NOT NULL,
    tipo                VARCHAR(25)  NOT NULL,
    evento_id           UUID REFERENCES evento_calendario(id)          ON DELETE CASCADE,
    alerta_id           UUID REFERENCES alerta(id)                     ON DELETE CASCADE,
    plazo_id            UUID REFERENCES plazo(id)                      ON DELETE CASCADE,
    version_origen      INTEGER,
    minutos_antes       INTEGER,
    datos               JSONB        NOT NULL DEFAULT '{}'::jsonb,
    programado_para     TIMESTAMPTZ  NOT NULL,
    estado              VARCHAR(12)  NOT NULL DEFAULT 'PENDIENTE',
    intentos            SMALLINT     NOT NULL DEFAULT 0,
    proximo_intento     TIMESTAMPTZ  NOT NULL,
    bloqueado_hasta     TIMESTAMPTZ,
    procesado_en        TIMESTAMPTZ,
    aceptado_en         TIMESTAMPTZ,
    id_externo          VARCHAR(200),
    ultimo_error        VARCHAR(300),
    motivo_cancelacion  VARCHAR(30),
    notificacion_id     UUID REFERENCES notificacion(id) ON DELETE SET NULL,
    clave_idempotencia  VARCHAR(200) NOT NULL,
    creado_en           TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT uq_envio_idempotencia UNIQUE (clave_idempotencia),
    CONSTRAINT ck_envio_canal CHECK (canal IN ('IN_APP', 'EMAIL')),
    CONSTRAINT ck_envio_tipo CHECK (
        tipo IN ('RECORDATORIO_EVENTO', 'EVENTO_ASIGNADO', 'EVENTO_REPROGRAMADO',
                 'EVENTO_CANCELADO', 'PLAZO_ALERTA', 'PRUEBA')
    ),
    CONSTRAINT ck_envio_estado CHECK (
        estado IN ('PENDIENTE', 'PROCESANDO', 'ACEPTADO', 'FALLIDO', 'CANCELADO')
    ),
    CONSTRAINT ck_envio_intentos CHECK (intentos >= 0),
    CONSTRAINT ck_envio_aceptado CHECK ((estado = 'ACEPTADO') = (aceptado_en IS NOT NULL)),
    CONSTRAINT ck_envio_procesando CHECK (estado <> 'PROCESANDO' OR bloqueado_hasta IS NOT NULL),
    CONSTRAINT ck_envio_origen CHECK (
        (tipo = 'PRUEBA')
     OR (tipo = 'PLAZO_ALERTA' AND plazo_id IS NOT NULL)
     OR (tipo LIKE '%EVENTO%' AND evento_id IS NOT NULL)
    )
);

-- La cola que recorre el proceso: solo lo que todavía puede entregarse.
CREATE INDEX ix_envio_cola
    ON envio_notificacion (proximo_intento)
    WHERE estado IN ('PENDIENTE', 'PROCESANDO');

CREATE INDEX ix_envio_evento
    ON envio_notificacion (evento_id)
    WHERE evento_id IS NOT NULL AND estado = 'PENDIENTE';

CREATE INDEX ix_envio_usuario_pendiente
    ON envio_notificacion (usuario_id, proximo_intento)
    WHERE estado = 'PENDIENTE' AND canal = 'IN_APP';

CREATE INDEX ix_envio_estado_fecha ON envio_notificacion (estado, creado_en DESC);

-- -----------------------------------------------------------------------------
-- ejecucion_programador — cada corrida del proceso de avisos.
--
-- Sirve para el panel de administración (última ejecución, última exitosa) y
-- para detectar que el programador externo dejó de llamar.
-- -----------------------------------------------------------------------------
CREATE TABLE ejecucion_programador (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    origen             VARCHAR(12) NOT NULL,
    iniciado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
    finalizado_en      TIMESTAMPTZ,
    alertas_creadas    INTEGER     NOT NULL DEFAULT 0,
    procesados         INTEGER     NOT NULL DEFAULT 0,
    aceptados          INTEGER     NOT NULL DEFAULT 0,
    fallidos           INTEGER     NOT NULL DEFAULT 0,
    cancelados         INTEGER     NOT NULL DEFAULT 0,
    reintentos         INTEGER     NOT NULL DEFAULT 0,
    error              VARCHAR(300),

    CONSTRAINT ck_ejecucion_origen CHECK (origen IN ('PROGRAMADOR', 'MANUAL'))
);

CREATE INDEX ix_ejecucion_programador_fecha ON ejecucion_programador (iniciado_en DESC);

-- -----------------------------------------------------------------------------
-- 4. Ajustes a notificaciones y alertas (007)
-- -----------------------------------------------------------------------------

-- Una notificación nacida de un evento enlaza a él (la campana abre el detalle).
ALTER TABLE notificacion
    ADD COLUMN evento_id UUID REFERENCES evento_calendario(id) ON DELETE CASCADE;

-- La campana cuenta solo IN_APP: un correo enviado no es un aviso sin leer.
CREATE INDEX ix_notificacion_bandeja_in_app
    ON notificacion (usuario_id, creado_en DESC)
    WHERE leida_en IS NULL AND canal = 'IN_APP';

-- Idempotencia de alertas por fecha de vencimiento.
--
-- Antes: una regla avisaba una sola vez por plazo. Si el plazo se recomputaba
-- (suspensión, reanudación, corrección) y la fecha se movía, la regla ya
-- "había disparado" y la fecha nueva quedaba sin aviso. Ahora la clave incluye
-- la fecha a la que se refería el aviso: la misma fecha no se avisa dos veces,
-- una fecha nueva sí.
ALTER TABLE alerta ADD COLUMN fecha_vencimiento_ref DATE;

UPDATE alerta a
   SET fecha_vencimiento_ref = p.fecha_vencimiento
  FROM plazo p
 WHERE p.id = a.plazo_id
   AND a.fecha_vencimiento_ref IS NULL;

ALTER TABLE alerta ALTER COLUMN fecha_vencimiento_ref SET NOT NULL;

DROP INDEX IF EXISTS uq_alerta_plazo_regla;

CREATE UNIQUE INDEX uq_alerta_plazo_regla_vencimiento
    ON alerta (plazo_id, regla_alerta_id, fecha_vencimiento_ref)
    WHERE regla_alerta_id IS NOT NULL;

COMMENT ON COLUMN alerta.fecha_vencimiento_ref IS
    'Vencimiento del plazo al momento de disparar el aviso. Forma parte de la '
    'clave de idempotencia: si el plazo cambia de fecha, la regla puede volver '
    'a avisar por la fecha nueva.';

-- -----------------------------------------------------------------------------
-- 5. Permisos
--
-- En una base nueva los roles todavía no existen cuando corre esta migración:
-- el seed 001_catalogos.sql asigna los permisos (ADMIN todos; JEFE_ESTUDIO y
-- EMPLEADO los de agenda, porque no son de usuario ni configuración). En una
-- base existente, los INSERT de abajo los asignan.
-- -----------------------------------------------------------------------------
INSERT INTO permiso (codigo, modulo, accion, descripcion) VALUES
    ('agenda.ver',      'agenda', 'ver',      'Ver la agenda jurídica del estudio'),
    ('agenda.crear',    'agenda', 'crear',    'Crear eventos de agenda'),
    ('agenda.editar',   'agenda', 'editar',   'Editar y reprogramar eventos de agenda'),
    ('agenda.cancelar', 'agenda', 'cancelar', 'Cancelar eventos de agenda'),
    ('configuracion.notificaciones', 'configuracion', 'notificaciones',
     'Ver el estado del correo y de la cola de avisos, y enviar un correo de prueba')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM rol r
  JOIN permiso p ON p.modulo = 'agenda'
 WHERE r.codigo IN ('ADMIN', 'JEFE_ESTUDIO', 'EMPLEADO')
ON CONFLICT DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM rol r
  JOIN permiso p ON p.codigo = 'configuracion.notificaciones'
 WHERE r.codigo = 'ADMIN'
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 6. Protección de Supabase (misma estrategia que 013)
--
-- Las tablas nuevas nacen con RLS activado y sin políticas: para anon y
-- authenticated aparecen vacías. Los privilegios por defecto que revocó 013
-- ya alcanzan a las tablas creadas después.
-- -----------------------------------------------------------------------------
ALTER TABLE evento_participante       ENABLE ROW LEVEL SECURITY;
ALTER TABLE evento_historial          ENABLE ROW LEVEL SECURITY;
ALTER TABLE regla_recordatorio        ENABLE ROW LEVEL SECURITY;
ALTER TABLE evento_recordatorio       ENABLE ROW LEVEL SECURITY;
ALTER TABLE preferencia_notificacion  ENABLE ROW LEVEL SECURITY;
ALTER TABLE envio_notificacion        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ejecucion_programador     ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    rol text;
BEGIN
    FOREACH rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rol) THEN
            EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', rol);
        END IF;
    END LOOP;
END;
$$;
