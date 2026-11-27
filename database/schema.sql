-- =============================================================================
-- schema.sql — Esquema consolidado
--
-- Sistema de Gestion Integral para Estudios Juridicos
-- 2.a Entrega — Diseno de base de datos
--
-- Concatenacion en orden de database/migrations/*.sql
--
-- Uso:  psql -d sistemalegal -f database/schema.sql
-- =============================================================================


-- ####  001_extensiones_y_funciones.sql  #############################

-- =============================================================================
-- 001 — Extensiones y funciones compartidas
-- Sistema de Gestión Integral para Estudios Jurídicos
-- =============================================================================

-- gen_random_uuid() es nativo desde PostgreSQL 13; pgcrypto lo provee en versiones
-- anteriores y aporta funciones de hash usadas para tokens.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Búsqueda de texto insensible a tildes sobre el texto extraído de los PDF.
CREATE EXTENSION IF NOT EXISTS unaccent;

-- -----------------------------------------------------------------------------
-- Mantiene actualizado_en en cada UPDATE. Se asocia por trigger a toda tabla
-- que declare esa columna, para no repetir la lógica en la capa de aplicación.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_actualizar_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.actualizado_en := now();
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_actualizar_timestamp() IS
    'Trigger BEFORE UPDATE: refresca la columna actualizado_en.';

-- -----------------------------------------------------------------------------
-- Normaliza texto quitando tildes y diacríticos, para la búsqueda documental.
--
-- Por qué existe esta envoltura: el diccionario español de PostgreSQL reduce
-- 'NOTIFICACIÓN' al lexema 'notif', pero 'NOTIFICACION' sin tilde no la
-- reconoce y la deja entera como 'notificacion'. Son lexemas distintos, así que
-- quien busque sin tildes —lo normal en un buscador— no encontraría el
-- documento. Normalizar ambos lados resuelve el problema.
--
-- No se puede usar unaccent() directamente en un índice: está declarada STABLE.
-- La envoltura fija el diccionario, con lo cual el resultado es determinista y
-- puede declararse IMMUTABLE, que es lo que exige un índice de expresión.
--
-- La cláusula SET search_path resuelve dos cosas:
--   1. Al construir un índice de expresión PostgreSQL restringe el search_path
--      de la sesión; sin esto, no encuentra 'unaccent' y el índice no se crea.
--   2. Portabilidad: Neon instala las extensiones en public y Supabase en
--      extensions. Nombrando ambos esquemas, el mismo DDL corre en los dos.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_sin_acentos(texto TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = public, extensions, pg_catalog
AS $$
    -- El cast a regdictionary es obligatorio: sin él el literal llega como
    -- 'unknown' y PostgreSQL no resuelve la variante de dos argumentos.
    SELECT unaccent('unaccent'::regdictionary, texto);
$$;

COMMENT ON FUNCTION fn_sin_acentos(TEXT) IS
    'Quita tildes y diacríticos. IMMUTABLE para poder usarse en índices. '
    'La aplicación debe aplicarla también al término buscado.';

-- ####  002_catalogos_juridicos.sql  #################################

-- =============================================================================
-- 002 — Catálogos jurídicos (independientes del inquilino)
--
-- Estas tablas modelan la estructura del Poder Judicial y las clasificaciones
-- procesales. Son datos de referencia, no del estudio. Mantenerlos como DATOS
-- y no como constantes en el código
-- es lo que habilita configurar otra provincia sin recompilar (propuesta §3.1).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- jurisdiccion — provincia / ámbito federal. El MVP se valida solo con Córdoba.
-- -----------------------------------------------------------------------------
CREATE TABLE jurisdiccion (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo      VARCHAR(10)  NOT NULL UNIQUE,
    nombre      VARCHAR(100) NOT NULL,
    pais        VARCHAR(50)  NOT NULL DEFAULT 'Argentina',
    activa      BOOLEAN      NOT NULL DEFAULT TRUE,
    creado_en   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE jurisdiccion IS
    'Provincia o ámbito federal. Raíz de la configuración multi-provincia.';
COMMENT ON COLUMN jurisdiccion.codigo IS 'Código ISO 3166-2, p. ej. AR-X para Córdoba.';

-- -----------------------------------------------------------------------------
-- fuero — Civil y Comercial, Laboral, Familia, Penal...
-- -----------------------------------------------------------------------------
CREATE TABLE fuero (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    jurisdiccion_id  UUID NOT NULL REFERENCES jurisdiccion(id) ON DELETE RESTRICT,
    codigo           VARCHAR(20)  NOT NULL,
    nombre           VARCHAR(100) NOT NULL,
    activo           BOOLEAN      NOT NULL DEFAULT TRUE,
    creado_en        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_fuero_jurisdiccion_codigo UNIQUE (jurisdiccion_id, codigo)
);

CREATE INDEX ix_fuero_jurisdiccion ON fuero (jurisdiccion_id);

-- -----------------------------------------------------------------------------
-- tribunal — juzgado o cámara concreta donde tramita la causa.
-- -----------------------------------------------------------------------------
CREATE TABLE tribunal (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    jurisdiccion_id  UUID NOT NULL REFERENCES jurisdiccion(id) ON DELETE RESTRICT,
    fuero_id         UUID NOT NULL REFERENCES fuero(id)        ON DELETE RESTRICT,
    nombre           VARCHAR(200) NOT NULL,
    nominacion       VARCHAR(50),
    circunscripcion  VARCHAR(100),
    sede             VARCHAR(100),
    domicilio        VARCHAR(200),
    activo           BOOLEAN      NOT NULL DEFAULT TRUE,
    creado_en        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_tribunal_identidad
        UNIQUE (jurisdiccion_id, fuero_id, nombre, nominacion)
);

CREATE INDEX ix_tribunal_fuero ON tribunal (fuero_id);

COMMENT ON COLUMN tribunal.nominacion IS
    'Nominación del juzgado (1.ª, 2.ª, ...), tal como la usa el fuero en Córdoba.';

-- -----------------------------------------------------------------------------
-- tipo_causa — materia u objeto del juicio, dependiente del fuero.
-- -----------------------------------------------------------------------------
CREATE TABLE tipo_causa (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fuero_id   UUID NOT NULL REFERENCES fuero(id) ON DELETE RESTRICT,
    codigo     VARCHAR(30)  NOT NULL,
    nombre     VARCHAR(150) NOT NULL,
    activo     BOOLEAN      NOT NULL DEFAULT TRUE,
    creado_en  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_tipo_causa_fuero_codigo UNIQUE (fuero_id, codigo)
);

-- -----------------------------------------------------------------------------
-- estado_causa — ciclo de vida procesal. es_final marca los estados terminales.
-- -----------------------------------------------------------------------------
CREATE TABLE estado_causa (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo     VARCHAR(30)  NOT NULL UNIQUE,
    nombre     VARCHAR(100) NOT NULL,
    es_final   BOOLEAN      NOT NULL DEFAULT FALSE,
    orden      SMALLINT     NOT NULL DEFAULT 0,
    creado_en  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON COLUMN estado_causa.es_final IS
    'TRUE en estados que cierran la causa (archivada, desistida, sentencia firme).';

-- -----------------------------------------------------------------------------
-- tipo_documento — clasificación del repositorio documental.
-- -----------------------------------------------------------------------------
CREATE TABLE tipo_documento (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo     VARCHAR(30)  NOT NULL UNIQUE,
    nombre     VARCHAR(100) NOT NULL,
    activo     BOOLEAN      NOT NULL DEFAULT TRUE,
    creado_en  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- concepto_costa — naturaleza del gasto procesal (tasa, aporte, sellado...).
-- -----------------------------------------------------------------------------
CREATE TABLE concepto_costa (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo       VARCHAR(30)  NOT NULL UNIQUE,
    nombre       VARCHAR(100) NOT NULL,
    descripcion  VARCHAR(300),
    activo       BOOLEAN      NOT NULL DEFAULT TRUE,
    creado_en    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ####  003_tenencia_y_seguridad.sql  ################################

-- =============================================================================
-- 003 — Datos del estudio y seguridad
--
-- El sistema atiende a UN estudio jurídico. La tabla estudio guarda sus datos
-- (razón social, CUIT, domicilio), que se usan para encabezar los escritos, y
-- por eso lleva una sola fila: un índice único lo garantiza.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- estudio — datos del estudio jurídico. Fila única.
-- -----------------------------------------------------------------------------
CREATE TABLE estudio (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    razon_social     VARCHAR(150) NOT NULL,
    nombre_fantasia  VARCHAR(150),
    cuit             VARCHAR(13)  NOT NULL UNIQUE,
    email_contacto   VARCHAR(150),
    telefono         VARCHAR(30),
    domicilio        VARCHAR(200),
    jurisdiccion_id  UUID NOT NULL REFERENCES jurisdiccion(id) ON DELETE RESTRICT,
    activo           BOOLEAN     NOT NULL DEFAULT TRUE,
    creado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_estudio_cuit_formato CHECK (cuit ~ '^[0-9]{2}-[0-9]{8}-[0-9]$')
);

CREATE TRIGGER tg_estudio_actualizado
    BEFORE UPDATE ON estudio
    FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp();

-- Garantiza una sola fila: el índice es sobre una constante, así que un segundo
-- INSERT choca contra la misma clave.
CREATE UNIQUE INDEX uq_estudio_fila_unica ON estudio ((TRUE));

COMMENT ON TABLE estudio IS
    'Datos del estudio jurídico, en una fila única. Su jurisdicción determina '
    'qué calendario de días inhábiles y qué catálogo de tribunales se usa.';

-- -----------------------------------------------------------------------------
-- rol — tres roles jerárquicos.
-- -----------------------------------------------------------------------------
CREATE TABLE rol (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo       VARCHAR(20)  NOT NULL UNIQUE,
    nombre       VARCHAR(60)  NOT NULL,
    descripcion  VARCHAR(300),
    jerarquia    SMALLINT     NOT NULL,
    creado_en    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_rol_codigo CHECK (
        codigo IN ('ADMIN', 'JEFE_ESTUDIO', 'EMPLEADO')
    )
);

COMMENT ON COLUMN rol.jerarquia IS
    'Menor número = más privilegios. Permite comparaciones de nivel sin '
    'codificar los nombres de rol en la aplicación.';

-- -----------------------------------------------------------------------------
-- permiso — unidad granular de autorización, con formato modulo.accion.
-- -----------------------------------------------------------------------------
CREATE TABLE permiso (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo       VARCHAR(60)  NOT NULL UNIQUE,
    modulo       VARCHAR(40)  NOT NULL,
    accion       VARCHAR(40)  NOT NULL,
    descripcion  VARCHAR(300),
    creado_en    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX ix_permiso_modulo ON permiso (modulo);

COMMENT ON COLUMN permiso.codigo IS 'Formato modulo.accion, p. ej. causa.eliminar.';

-- -----------------------------------------------------------------------------
-- rol_permiso — N:M. Es lo que hace granulares los permisos: cambiar qué puede
-- hacer un rol es un INSERT/DELETE, no un cambio de código.
-- -----------------------------------------------------------------------------
CREATE TABLE rol_permiso (
    rol_id      UUID NOT NULL REFERENCES rol(id)     ON DELETE CASCADE,
    permiso_id  UUID NOT NULL REFERENCES permiso(id) ON DELETE CASCADE,
    PRIMARY KEY (rol_id, permiso_id)
);

-- -----------------------------------------------------------------------------
-- usuario — integrante del estudio (o Super Admin de la plataforma).
-- -----------------------------------------------------------------------------
CREATE TABLE usuario (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rol_id            UUID NOT NULL REFERENCES rol(id) ON DELETE RESTRICT,
    email             VARCHAR(150) NOT NULL,
    password_hash     VARCHAR(255) NOT NULL,
    nombre            VARCHAR(80)  NOT NULL,
    apellido          VARCHAR(80)  NOT NULL,
    matricula         VARCHAR(50),
    telefono          VARCHAR(30),
    activo            BOOLEAN      NOT NULL DEFAULT TRUE,
    ultimo_acceso_en  TIMESTAMPTZ,
    creado_en         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    actualizado_en    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_usuario_email_formato CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

-- El login es global, por eso la unicidad del email no se acota al estudio.
CREATE UNIQUE INDEX uq_usuario_email ON usuario (lower(email));

CREATE TRIGGER tg_usuario_actualizado
    BEFORE UPDATE ON usuario
    FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp();

COMMENT ON COLUMN usuario.matricula IS
    'Matrícula profesional. Obligatoria de hecho para abogados, opcional para '
    'personal administrativo, por eso no se restringe en la base.';

-- -----------------------------------------------------------------------------
-- refresh_token — permite revocar sesiones. Se guarda el HASH del token, nunca
-- el token en claro: si se filtra la base, los tokens no son reutilizables.
-- -----------------------------------------------------------------------------
CREATE TABLE refresh_token (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id   UUID NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
    token_hash   CHAR(64)    NOT NULL UNIQUE,
    emitido_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expira_en    TIMESTAMPTZ NOT NULL,
    revocado_en  TIMESTAMPTZ,
    ip           INET,
    user_agent   VARCHAR(300),
    CONSTRAINT ck_refresh_token_vigencia CHECK (expira_en > emitido_en)
);

CREATE INDEX ix_refresh_token_usuario ON refresh_token (usuario_id)
    WHERE revocado_en IS NULL;

COMMENT ON COLUMN refresh_token.token_hash IS 'SHA-256 en hexadecimal del refresh token.';

-- ####  004_causas.sql  ##############################################

-- =============================================================================
-- 004 — Módulo Causas
--
-- Decisión de modelado: persona es una entidad REUTILIZABLE del estudio, no un
-- dato embebido en la causa. La misma persona puede ser demandada en una causa
-- y cliente en otra; el carácter procesal es una propiedad del VÍNCULO
-- (parte_causa), no de la persona.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- persona — física o jurídica. Agenda única de partes y clientes del estudio.
-- -----------------------------------------------------------------------------
CREATE TABLE persona (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo_persona       VARCHAR(10)  NOT NULL,
    nombre             VARCHAR(80),
    apellido           VARCHAR(80),
    razon_social       VARCHAR(150),
    tipo_documento     VARCHAR(10),
    numero_documento   VARCHAR(20),
    cuit_cuil          VARCHAR(13),
    email              VARCHAR(150),
    telefono           VARCHAR(30),
    domicilio          VARCHAR(200),
    localidad          VARCHAR(100),
    provincia          VARCHAR(100),
    observaciones      TEXT,
    eliminado_en       TIMESTAMPTZ,
    creado_en          TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ck_persona_tipo CHECK (tipo_persona IN ('FISICA', 'JURIDICA')),
    CONSTRAINT ck_persona_tipo_documento CHECK (
        tipo_documento IS NULL OR
        tipo_documento IN ('DNI', 'LC', 'LE', 'CI', 'PASAPORTE', 'CUIT', 'CUIL')
    ),
    -- Una persona física necesita nombre y apellido; una jurídica, razón social.
    CONSTRAINT ck_persona_identificacion CHECK (
        (tipo_persona = 'FISICA'   AND nombre IS NOT NULL AND apellido IS NOT NULL)
     OR (tipo_persona = 'JURIDICA' AND razon_social IS NOT NULL)
    )
);

-- Un mismo documento no puede repetirse entre personas vivas.
CREATE UNIQUE INDEX uq_persona_documento
    ON persona (tipo_documento, numero_documento)
    WHERE eliminado_en IS NULL AND numero_documento IS NOT NULL;

CREATE TRIGGER tg_persona_actualizado
    BEFORE UPDATE ON persona
    FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp();

-- -----------------------------------------------------------------------------
-- causa — el expediente. Entidad central del sistema.
-- -----------------------------------------------------------------------------
CREATE TABLE causa (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    numero_expediente  VARCHAR(50),
    caratula           VARCHAR(300) NOT NULL,
    tribunal_id        UUID REFERENCES tribunal(id)              ON DELETE RESTRICT,
    fuero_id           UUID NOT NULL REFERENCES fuero(id)        ON DELETE RESTRICT,
    tipo_causa_id      UUID REFERENCES tipo_causa(id)            ON DELETE RESTRICT,
    estado_causa_id    UUID NOT NULL REFERENCES estado_causa(id) ON DELETE RESTRICT,
    fecha_inicio       DATE NOT NULL,
    fecha_cierre       DATE,
    monto_reclamado    NUMERIC(14,2),
    moneda             CHAR(3) NOT NULL DEFAULT 'ARS',
    observaciones      TEXT,
    creado_por         UUID REFERENCES usuario(id) ON DELETE SET NULL,
    eliminado_en       TIMESTAMPTZ,
    creado_en          TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ck_causa_fechas CHECK (fecha_cierre IS NULL OR fecha_cierre >= fecha_inicio),
    CONSTRAINT ck_causa_monto  CHECK (monto_reclamado IS NULL OR monto_reclamado >= 0)
);

-- El número de expediente es único, pero puede faltar mientras la causa está
-- en preparación (todavía sin radicar).
CREATE UNIQUE INDEX uq_causa_expediente
    ON causa (numero_expediente)
    WHERE eliminado_en IS NULL AND numero_expediente IS NOT NULL;

CREATE INDEX ix_causa_estado ON causa (estado_causa_id)
    WHERE eliminado_en IS NULL;
CREATE INDEX ix_causa_tribunal ON causa (tribunal_id);

CREATE TRIGGER tg_causa_actualizado
    BEFORE UPDATE ON causa
    FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp();

COMMENT ON COLUMN causa.caratula IS
    'Carátula del expediente, tal como la registra el tribunal.';

-- -----------------------------------------------------------------------------
-- parte_causa — vínculo persona <-> causa con su carácter procesal.
-- -----------------------------------------------------------------------------
CREATE TABLE parte_causa (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    causa_id       UUID NOT NULL REFERENCES causa(id)   ON DELETE CASCADE,
    persona_id     UUID NOT NULL REFERENCES persona(id) ON DELETE RESTRICT,
    caracter       VARCHAR(20) NOT NULL,
    es_cliente     BOOLEAN     NOT NULL DEFAULT FALSE,
    fecha_alta     DATE        NOT NULL DEFAULT CURRENT_DATE,
    observaciones  VARCHAR(300),
    creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ck_parte_caracter CHECK (
        caracter IN ('ACTOR', 'DEMANDADO', 'CODEMANDADO', 'TERCERO', 'PERITO', 'TESTIGO')
    ),
    CONSTRAINT uq_parte_causa UNIQUE (causa_id, persona_id, caracter)
);

CREATE INDEX ix_parte_causa_causa   ON parte_causa (causa_id);
CREATE INDEX ix_parte_causa_persona ON parte_causa (persona_id);

COMMENT ON COLUMN parte_causa.es_cliente IS
    'TRUE si esta parte es el cliente del estudio en esta causa. El estudio '
    'puede representar al actor en un expediente y al demandado en otro.';

-- -----------------------------------------------------------------------------
-- profesional_causa — quiénes del estudio trabajan la causa y con qué rol
-- procesal. Es la base del filtro "mis causas" y de la delegación de tareas.
-- -----------------------------------------------------------------------------
CREATE TABLE profesional_causa (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    causa_id           UUID NOT NULL REFERENCES causa(id)   ON DELETE CASCADE,
    usuario_id         UUID NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
    rol_en_causa       VARCHAR(20) NOT NULL,
    fecha_asignacion   DATE        NOT NULL DEFAULT CURRENT_DATE,
    fecha_baja         DATE,
    creado_en          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ck_profesional_rol CHECK (
        rol_en_causa IN ('TITULAR', 'PATROCINANTE', 'APODERADO', 'COLABORADOR')
    ),
    CONSTRAINT ck_profesional_fechas CHECK (
        fecha_baja IS NULL OR fecha_baja >= fecha_asignacion
    )
);

-- Un profesional no puede estar asignado dos veces a la vez en la misma causa.
CREATE UNIQUE INDEX uq_profesional_causa_activo
    ON profesional_causa (causa_id, usuario_id)
    WHERE fecha_baja IS NULL;

CREATE INDEX ix_profesional_causa_usuario ON profesional_causa (usuario_id)
    WHERE fecha_baja IS NULL;

-- -----------------------------------------------------------------------------
-- movimiento_causa — historial procesal del expediente.
--
-- Riesgo R1 de la propuesta: el Poder Judicial de Córdoba no ofrece API pública
-- de lectura, por eso origen distingue la carga manual de una importación.
-- Cuando exista integración automática se agrega el valor 'SINCRONIZACION' al
-- CHECK, sin migrar datos existentes.
-- -----------------------------------------------------------------------------
CREATE TABLE movimiento_causa (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    causa_id             UUID NOT NULL REFERENCES causa(id) ON DELETE CASCADE,
    fecha                DATE NOT NULL,
    tipo                 VARCHAR(100),
    descripcion          TEXT NOT NULL,
    origen               VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    referencia_externa   VARCHAR(100),
    registrado_por       UUID REFERENCES usuario(id) ON DELETE SET NULL,
    creado_en            TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ck_movimiento_origen CHECK (origen IN ('MANUAL', 'IMPORTACION'))
);

CREATE INDEX ix_movimiento_causa_fecha ON movimiento_causa (causa_id, fecha DESC);

-- ####  005_documentos.sql  ##########################################

-- =============================================================================
-- 005 — Módulo Documentos
--
-- Decisión de modelado: el texto extraído del PDF vive en una tabla APARTE
-- (documento_texto) en relación 1:1 con documento. Motivos:
--   1. Es un campo potencialmente de megabytes que casi nunca se necesita al
--      listar documentos; separarlo evita que Postgres lo cargue de más.
--   2. La extracción es asíncrona (la hace el microservicio Python), así que su
--      resultado tiene su propio ciclo de vida y su propio estado de error.
--
-- El archivo binario NO se guarda en la base: en la tabla va la ruta al
-- almacenamiento de objetos. La base guarda metadatos, no blobs.
-- =============================================================================

CREATE TABLE documento (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    causa_id            UUID NOT NULL REFERENCES causa(id)          ON DELETE CASCADE,
    tipo_documento_id   UUID REFERENCES tipo_documento(id)          ON DELETE RESTRICT,
    nombre_archivo      VARCHAR(255) NOT NULL,
    nombre_original     VARCHAR(255) NOT NULL,
    mime_type           VARCHAR(100) NOT NULL,
    tamano_bytes        BIGINT       NOT NULL,
    ruta_almacenamiento VARCHAR(500) NOT NULL,
    hash_sha256         CHAR(64)     NOT NULL,
    estado_extraccion   VARCHAR(20)  NOT NULL DEFAULT 'PENDIENTE',
    descripcion         VARCHAR(300),
    subido_por          UUID REFERENCES usuario(id) ON DELETE SET NULL,
    fecha_subida        TIMESTAMPTZ NOT NULL DEFAULT now(),
    eliminado_en        TIMESTAMPTZ,

    CONSTRAINT ck_documento_tamano CHECK (tamano_bytes > 0),
    CONSTRAINT ck_documento_estado_extraccion CHECK (
        estado_extraccion IN ('NO_APLICA', 'PENDIENTE', 'PROCESANDO', 'COMPLETADA', 'ERROR')
    )
);

-- Evita subir dos veces el mismo archivo: el hash identifica el contenido, no
-- el nombre.
CREATE UNIQUE INDEX uq_documento_hash
    ON documento (hash_sha256)
    WHERE eliminado_en IS NULL;

CREATE INDEX ix_documento_causa ON documento (causa_id) WHERE eliminado_en IS NULL;

-- Índice para que el worker de extracción encuentre su cola de trabajo.
CREATE INDEX ix_documento_pendiente_extraccion
    ON documento (estado_extraccion, fecha_subida)
    WHERE estado_extraccion IN ('PENDIENTE', 'ERROR');

COMMENT ON COLUMN documento.estado_extraccion IS
    'NO_APLICA para archivos que no son PDF. El resto es la cola del '
    'microservicio de extracción.';
COMMENT ON COLUMN documento.ruta_almacenamiento IS
    'Clave del objeto en el almacenamiento de archivos. La base nunca guarda '
    'el binario.';

-- -----------------------------------------------------------------------------
-- documento_texto — resultado de la extracción PDF -> texto.
-- -----------------------------------------------------------------------------
CREATE TABLE documento_texto (
    documento_id       UUID PRIMARY KEY REFERENCES documento(id) ON DELETE CASCADE,
    texto              TEXT,
    cantidad_paginas   INTEGER,
    motor_extraccion   VARCHAR(50) NOT NULL DEFAULT 'pdfplumber',
    fecha_extraccion   TIMESTAMPTZ NOT NULL DEFAULT now(),
    mensaje_error      TEXT,

    CONSTRAINT ck_documento_texto_paginas CHECK (
        cantidad_paginas IS NULL OR cantidad_paginas > 0
    )
);

-- Búsqueda de texto completo en español sobre el contenido de los PDF.
-- Es un índice de expresión: no requiere una columna tsvector materializada.
--
-- El texto se normaliza con fn_sin_acentos (ver migración 001) porque el
-- diccionario español genera lexemas distintos para 'NOTIFICACIÓN' y
-- 'NOTIFICACION', y nadie escribe tildes en un buscador.
--
-- IMPORTANTE para el módulo de documentos: la consulta debe normalizarse igual,
--     WHERE to_tsvector('spanish', fn_sin_acentos(texto))
--           @@ to_tsquery('spanish', fn_sin_acentos(:termino))
-- o el índice no se usa y la búsqueda vuelve a fallar con las tildes.
CREATE INDEX ix_documento_texto_busqueda
    ON documento_texto
    USING GIN (to_tsvector('spanish', fn_sin_acentos(coalesce(texto, ''))));

COMMENT ON TABLE documento_texto IS
    'Texto plano extraído por el microservicio Python. Relación 1:1 con '
    'documento; se separa por tamaño y por tener ciclo de vida asíncrono.';

-- ####  006_plazos_y_calendario.sql  #################################

-- =============================================================================
-- 006 — Módulo Plazos y Calendario
--
-- Núcleo del valor del sistema y objetivo específico n.º 2 de la propuesta.
--
-- Arquitectura del cómputo (mitigación del riesgo R3):
--   * tipo_plazo   = la REGLA (cuántos días, hábiles o corridos, qué artículo).
--   * dia_inhabil  = el CALENDARIO (feriados, feria judicial, asuetos).
--   * plazo        = la INSTANCIA aplicada a una causa concreta.
--
-- El algoritmo de cómputo vive en el backend TypeScript, no en la base: debe
-- ser testeable con los 10+ casos de prueba que exige la propuesta. La base
-- guarda el resultado y los insumos que lo justifican, de modo que un recálculo
-- siempre sea reproducible y auditable.
--
-- Nada de esto está fijo en el código: agregar una provincia es insertar filas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- tipo_plazo — catálogo de reglas procesales, configurable por el estudio.
-- -----------------------------------------------------------------------------
CREATE TABLE tipo_plazo (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    jurisdiccion_id       UUID NOT NULL REFERENCES jurisdiccion(id) ON DELETE RESTRICT,
    fuero_id              UUID REFERENCES fuero(id)        ON DELETE RESTRICT,
    codigo                VARCHAR(50)  NOT NULL,
    nombre                VARCHAR(150) NOT NULL,
    cantidad_dias         SMALLINT     NOT NULL,
    computo               VARCHAR(10)  NOT NULL,
    articulo_referencia   VARCHAR(100),
    prorrogable           BOOLEAN      NOT NULL DEFAULT FALSE,
    activo                BOOLEAN      NOT NULL DEFAULT TRUE,
    creado_en             TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT ck_tipo_plazo_dias    CHECK (cantidad_dias > 0),
    CONSTRAINT ck_tipo_plazo_computo CHECK (computo IN ('HABIL', 'CORRIDO'))
);

CREATE UNIQUE INDEX uq_tipo_plazo_codigo
    ON tipo_plazo (jurisdiccion_id, codigo);

COMMENT ON COLUMN tipo_plazo.articulo_referencia IS
    'Norma que funda el plazo, p. ej. el artículo del CPCC de Córdoba. Permite '
    'justificar el cómputo ante el cliente y ante el tribunal.';
COMMENT ON COLUMN tipo_plazo.computo IS
    'HABIL descuenta sábados, domingos y los dia_inhabil de la jurisdicción. '
    'CORRIDO cuenta todos los días del calendario.';

-- -----------------------------------------------------------------------------
-- dia_inhabil — el calendario configurable. Requisito explícito de la propuesta:
-- "mantener los días inhábiles como dato configurable, nunca fijo en el código".
--
-- La columna tipo distingue el inhábil oficial (feriado, feria judicial) del
-- asueto propio del estudio.
-- -----------------------------------------------------------------------------
CREATE TABLE dia_inhabil (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    jurisdiccion_id   UUID NOT NULL REFERENCES jurisdiccion(id) ON DELETE RESTRICT,
    fecha             DATE         NOT NULL,
    tipo              VARCHAR(25)  NOT NULL,
    motivo            VARCHAR(200) NOT NULL,
    creado_en         TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT ck_dia_inhabil_tipo CHECK (
        tipo IN ('FERIADO_NACIONAL', 'FERIADO_PROVINCIAL', 'FERIA_JUDICIAL',
                 'ASUETO', 'OTRO')
    )
);

CREATE UNIQUE INDEX uq_dia_inhabil_fecha
    ON dia_inhabil (jurisdiccion_id, fecha);

-- El motor de cómputo consulta por rango de fechas dentro de una jurisdicción.
CREATE INDEX ix_dia_inhabil_busqueda ON dia_inhabil (jurisdiccion_id, fecha);

COMMENT ON TABLE dia_inhabil IS
    'Calendario de días no laborables judiciales. La feria judicial se carga '
    'como una fila por día, de modo que el motor de cómputo use una sola regla.';

-- -----------------------------------------------------------------------------
-- plazo — instancia concreta sobre una causa.
--
-- Se guardan a la vez los INSUMOS del cálculo (fecha de notificación, días,
-- tipo de cómputo) y su RESULTADO (fecha_vencimiento). Guardar solo el
-- resultado impediría auditar cómo se llegó a él; guardar solo los insumos
-- obligaría a recalcular en cada consulta y a depender de que el calendario
-- histórico nunca cambie.
-- -----------------------------------------------------------------------------
CREATE TABLE plazo (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    causa_id                    UUID NOT NULL REFERENCES causa(id)     ON DELETE CASCADE,
    tipo_plazo_id               UUID REFERENCES tipo_plazo(id)         ON DELETE RESTRICT,
    descripcion                 VARCHAR(300) NOT NULL,
    fecha_notificacion          DATE     NOT NULL,
    fecha_inicio_computo        DATE     NOT NULL,
    cantidad_dias               SMALLINT NOT NULL,
    computo                     VARCHAR(10) NOT NULL,
    fecha_vencimiento           DATE     NOT NULL,
    fecha_vencimiento_original  DATE     NOT NULL,
    estado                      VARCHAR(15) NOT NULL DEFAULT 'PENDIENTE',
    responsable_id              UUID REFERENCES usuario(id) ON DELETE SET NULL,
    fecha_cumplimiento          DATE,
    observaciones               TEXT,
    creado_por                  UUID REFERENCES usuario(id) ON DELETE SET NULL,
    creado_en                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ck_plazo_dias    CHECK (cantidad_dias > 0),
    CONSTRAINT ck_plazo_computo CHECK (computo IN ('HABIL', 'CORRIDO')),
    CONSTRAINT ck_plazo_estado  CHECK (
        estado IN ('PENDIENTE', 'CUMPLIDO', 'VENCIDO', 'SUSPENDIDO', 'CANCELADO')
    ),
    -- El cómputo empieza el día de la notificación o después, nunca antes.
    CONSTRAINT ck_plazo_inicio_computo CHECK (fecha_inicio_computo >= fecha_notificacion),
    CONSTRAINT ck_plazo_vencimiento    CHECK (fecha_vencimiento >= fecha_inicio_computo),
    -- Un plazo cumplido tiene que decir cuándo se cumplió.
    CONSTRAINT ck_plazo_cumplimiento CHECK (
        (estado = 'CUMPLIDO' AND fecha_cumplimiento IS NOT NULL)
     OR (estado <> 'CUMPLIDO')
    )
);

CREATE INDEX ix_plazo_causa ON plazo (causa_id);

-- Consulta central del sistema: "¿qué vence próximamente?".
CREATE INDEX ix_plazo_vigilancia
    ON plazo (fecha_vencimiento)
    WHERE estado IN ('PENDIENTE', 'SUSPENDIDO');

CREATE INDEX ix_plazo_responsable ON plazo (responsable_id)
    WHERE estado = 'PENDIENTE';

CREATE TRIGGER tg_plazo_actualizado
    BEFORE UPDATE ON plazo
    FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp();

COMMENT ON COLUMN plazo.fecha_inicio_computo IS
    'Primer día que efectivamente cuenta. Suele ser el día hábil siguiente a la '
    'notificación; se persiste porque la regla varía según el acto.';
COMMENT ON COLUMN plazo.fecha_vencimiento_original IS
    'Vencimiento del primer cálculo. Se conserva para poder mostrar el efecto '
    'de prórrogas y suspensiones sin perder el dato inicial.';
COMMENT ON COLUMN plazo.tipo_plazo_id IS
    'NULL cuando el usuario carga un plazo a medida que no responde a ninguna '
    'regla del catálogo.';

-- -----------------------------------------------------------------------------
-- plazo_suspension — tramos en que el plazo no corre (feria, suspensión
-- acordada, incidente). Es 1:N: un plazo puede suspenderse más de una vez.
-- -----------------------------------------------------------------------------
CREATE TABLE plazo_suspension (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plazo_id        UUID NOT NULL REFERENCES plazo(id) ON DELETE CASCADE,
    fecha_desde     DATE NOT NULL,
    fecha_hasta     DATE,
    motivo          VARCHAR(200) NOT NULL,
    registrado_por  UUID REFERENCES usuario(id) ON DELETE SET NULL,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ck_plazo_suspension_fechas CHECK (
        fecha_hasta IS NULL OR fecha_hasta >= fecha_desde
    )
);

CREATE INDEX ix_plazo_suspension_plazo ON plazo_suspension (plazo_id);

COMMENT ON COLUMN plazo_suspension.fecha_hasta IS
    'NULL mientras la suspensión sigue vigente y no tiene fecha de reanudación.';

-- -----------------------------------------------------------------------------
-- evento_calendario — calendario compartido del estudio.
--
-- Un vencimiento de plazo se refleja como evento (plazo_id), pero el calendario
-- también aloja audiencias y reuniones que no son plazos.
-- -----------------------------------------------------------------------------
CREATE TABLE evento_calendario (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    causa_id        UUID REFERENCES causa(id) ON DELETE CASCADE,
    plazo_id        UUID REFERENCES plazo(id) ON DELETE CASCADE,
    titulo          VARCHAR(200) NOT NULL,
    descripcion     TEXT,
    tipo            VARCHAR(20)  NOT NULL,
    fecha_inicio    TIMESTAMPTZ  NOT NULL,
    fecha_fin       TIMESTAMPTZ  NOT NULL,
    todo_el_dia     BOOLEAN      NOT NULL DEFAULT FALSE,
    lugar           VARCHAR(200),
    creado_por      UUID REFERENCES usuario(id) ON DELETE SET NULL,
    creado_en       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    actualizado_en  TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT ck_evento_tipo CHECK (
        tipo IN ('AUDIENCIA', 'VENCIMIENTO', 'REUNION', 'OTRO')
    ),
    CONSTRAINT ck_evento_fechas CHECK (fecha_fin >= fecha_inicio)
);

CREATE INDEX ix_evento_calendario_rango
    ON evento_calendario (fecha_inicio, fecha_fin);

CREATE TRIGGER tg_evento_calendario_actualizado
    BEFORE UPDATE ON evento_calendario
    FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp();

-- ####  007_alertas_y_notificaciones.sql  ############################

-- =============================================================================
-- 007 — Módulo Alertas y Notificaciones
--
-- Decisión de modelado: se separan tres conceptos que suelen confundirse.
--   regla_alerta  = la POLÍTICA   ("avisar 5 días antes, en nivel CRÍTICA").
--   alerta        = el HECHO      ("este plazo concreto dispara ese aviso").
--   notificacion  = la ENTREGA    ("a este usuario, por este canal").
--
-- Fusionarlas impediría avisar a varios responsables del mismo plazo con un
-- solo hecho de negocio, y haría imposible saber si un aviso se entregó pero
-- no se leyó.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- regla_alerta — configuración multinivel de avisos.
--
-- tipo_plazo_id NULL => regla general del estudio, aplica a todo plazo que no
-- tenga una regla específica para su tipo.
-- -----------------------------------------------------------------------------
CREATE TABLE regla_alerta (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo_plazo_id       UUID REFERENCES tipo_plazo(id)          ON DELETE CASCADE,
    dias_anticipacion   SMALLINT    NOT NULL,
    nivel               VARCHAR(12) NOT NULL,
    activa              BOOLEAN     NOT NULL DEFAULT TRUE,
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ck_regla_alerta_dias CHECK (dias_anticipacion >= 0),
    CONSTRAINT ck_regla_alerta_nivel CHECK (
        nivel IN ('CRITICA', 'IMPORTANTE', 'INFORMATIVA')
    )
);

CREATE UNIQUE INDEX uq_regla_alerta_general
    ON regla_alerta (dias_anticipacion)
    WHERE tipo_plazo_id IS NULL;

CREATE UNIQUE INDEX uq_regla_alerta_por_tipo
    ON regla_alerta (tipo_plazo_id, dias_anticipacion)
    WHERE tipo_plazo_id IS NOT NULL;

COMMENT ON COLUMN regla_alerta.dias_anticipacion IS
    'Días hábiles antes del vencimiento en que se dispara el aviso. 0 significa '
    'el mismo día del vencimiento.';

-- -----------------------------------------------------------------------------
-- alerta — instancia programada contra un plazo concreto.
-- -----------------------------------------------------------------------------
CREATE TABLE alerta (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plazo_id           UUID NOT NULL REFERENCES plazo(id)     ON DELETE CASCADE,
    regla_alerta_id    UUID REFERENCES regla_alerta(id)       ON DELETE SET NULL,
    nivel              VARCHAR(12)  NOT NULL,
    fecha_programada   DATE         NOT NULL,
    mensaje            VARCHAR(500) NOT NULL,
    estado             VARCHAR(15)  NOT NULL DEFAULT 'PROGRAMADA',
    disparada_en       TIMESTAMPTZ,
    creado_en          TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT ck_alerta_nivel CHECK (
        nivel IN ('CRITICA', 'IMPORTANTE', 'INFORMATIVA')
    ),
    CONSTRAINT ck_alerta_estado CHECK (
        estado IN ('PROGRAMADA', 'DISPARADA', 'DESCARTADA')
    ),
    CONSTRAINT ck_alerta_disparo CHECK (
        (estado = 'DISPARADA' AND disparada_en IS NOT NULL)
     OR (estado <> 'DISPARADA')
    )
);

-- Una regla no puede generar dos alertas para el mismo plazo: hace idempotente
-- al proceso programado que recorre los vencimientos.
CREATE UNIQUE INDEX uq_alerta_plazo_regla
    ON alerta (plazo_id, regla_alerta_id)
    WHERE regla_alerta_id IS NOT NULL;

-- Cola del proceso programado que dispara los avisos del día.
CREATE INDEX ix_alerta_pendiente
    ON alerta (fecha_programada)
    WHERE estado = 'PROGRAMADA';

-- -----------------------------------------------------------------------------
-- notificacion — entrega concreta a un usuario por un canal.
--
-- alerta_id NULL permite notificaciones que no nacen de un plazo (por ejemplo,
-- "te asignaron una tarea").
-- -----------------------------------------------------------------------------
CREATE TABLE notificacion (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id   UUID NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
    alerta_id    UUID REFERENCES alerta(id) ON DELETE CASCADE,
    titulo       VARCHAR(200) NOT NULL,
    mensaje      VARCHAR(500) NOT NULL,
    canal        VARCHAR(10)  NOT NULL DEFAULT 'IN_APP',
    enviada_en   TIMESTAMPTZ,
    leida_en     TIMESTAMPTZ,
    creado_en    TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT ck_notificacion_canal CHECK (canal IN ('IN_APP', 'EMAIL'))
);

-- Bandeja del usuario: no leídas primero, más recientes arriba.
CREATE INDEX ix_notificacion_bandeja
    ON notificacion (usuario_id, creado_en DESC)
    WHERE leida_en IS NULL;

-- ####  008_costas.sql  ##############################################

-- =============================================================================
-- 008 — Módulo Costas
--
-- Decisión de modelado: costa (lo devengado) y cobro (lo percibido) son tablas
-- distintas en relación 1:N. Una costa puede cobrarse en cuotas, y el saldo
-- pendiente se deriva de la diferencia. Guardar un único campo "monto_cobrado"
-- en costa perdería el detalle de cada pago, que es justamente lo que reclama
-- el objetivo de "control de cobros pendientes".
--
-- Todo importe es NUMERIC, nunca punto flotante: son datos de dinero.
-- =============================================================================

CREATE TABLE costa (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    causa_id                 UUID NOT NULL REFERENCES causa(id)          ON DELETE CASCADE,
    concepto_costa_id        UUID NOT NULL REFERENCES concepto_costa(id) ON DELETE RESTRICT,
    descripcion              VARCHAR(300),
    monto                    NUMERIC(14,2) NOT NULL,
    moneda                   CHAR(3)       NOT NULL DEFAULT 'ARS',
    fecha_devengamiento      DATE          NOT NULL,
    fecha_vencimiento_pago   DATE,
    a_cargo_de               VARCHAR(12)   NOT NULL,
    estado_cobro             VARCHAR(12)   NOT NULL DEFAULT 'PENDIENTE',
    comprobante              VARCHAR(100),
    registrado_por           UUID REFERENCES usuario(id) ON DELETE SET NULL,
    creado_en                TIMESTAMPTZ   NOT NULL DEFAULT now(),
    actualizado_en           TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT ck_costa_monto CHECK (monto > 0),
    CONSTRAINT ck_costa_a_cargo CHECK (
        a_cargo_de IN ('ESTUDIO', 'CLIENTE', 'CONTRARIA')
    ),
    CONSTRAINT ck_costa_estado CHECK (
        estado_cobro IN ('PENDIENTE', 'PARCIAL', 'COBRADO', 'INCOBRABLE')
    ),
    CONSTRAINT ck_costa_fechas CHECK (
        fecha_vencimiento_pago IS NULL OR fecha_vencimiento_pago >= fecha_devengamiento
    )
);

CREATE INDEX ix_costa_causa ON costa (causa_id);

-- Consulta del tablero de cobranza: qué queda por cobrar.
CREATE INDEX ix_costa_pendiente
    ON costa (fecha_vencimiento_pago)
    WHERE estado_cobro IN ('PENDIENTE', 'PARCIAL');

-- Reporte de gastos por período.
CREATE INDEX ix_costa_devengamiento ON costa (fecha_devengamiento);

CREATE TRIGGER tg_costa_actualizado
    BEFORE UPDATE ON costa
    FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp();

COMMENT ON COLUMN costa.a_cargo_de IS
    'Quién soporta el gasto. Distingue el gasto que el estudio adelanta y debe '
    'recuperar del que corre por cuenta del cliente o de la contraria.';
COMMENT ON COLUMN costa.estado_cobro IS
    'Derivable de la suma de cobros, pero se persiste para poder indexar el '
    'tablero de cobranza sin agregar en cada consulta. Lo mantiene el módulo '
    'de costas al registrar cada cobro.';

-- -----------------------------------------------------------------------------
-- cobro — pago (total o parcial) imputado a una costa.
-- -----------------------------------------------------------------------------
CREATE TABLE cobro (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    costa_id         UUID NOT NULL REFERENCES costa(id) ON DELETE CASCADE,
    monto            NUMERIC(14,2) NOT NULL,
    fecha            DATE          NOT NULL DEFAULT CURRENT_DATE,
    medio_pago       VARCHAR(15)   NOT NULL,
    comprobante      VARCHAR(100),
    observaciones    VARCHAR(300),
    registrado_por   UUID REFERENCES usuario(id) ON DELETE SET NULL,
    creado_en        TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT ck_cobro_monto CHECK (monto > 0),
    CONSTRAINT ck_cobro_medio CHECK (
        medio_pago IN ('EFECTIVO', 'TRANSFERENCIA', 'CHEQUE', 'TARJETA', 'OTRO')
    )
);

CREATE INDEX ix_cobro_costa ON cobro (costa_id);
CREATE INDEX ix_cobro_fecha ON cobro (fecha);

-- ####  009_operacion.sql  ###########################################

-- =============================================================================
-- 009 — Módulos Plantillas y Tareas (operación del estudio)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- plantilla_escrito — banco de modelos de escritos por tipo y por tribunal.
--
-- tribunal_id     => plantilla afinada a las exigencias formales de ese tribunal.
-- -----------------------------------------------------------------------------
CREATE TABLE plantilla_escrito (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo_documento_id   UUID REFERENCES tipo_documento(id) ON DELETE RESTRICT,
    fuero_id            UUID REFERENCES fuero(id)          ON DELETE RESTRICT,
    tribunal_id         UUID REFERENCES tribunal(id)       ON DELETE RESTRICT,
    nombre              VARCHAR(150) NOT NULL,
    descripcion         VARCHAR(300),
    contenido           TEXT NOT NULL,
    version             SMALLINT    NOT NULL DEFAULT 1,
    activa              BOOLEAN     NOT NULL DEFAULT TRUE,
    creada_por          UUID REFERENCES usuario(id) ON DELETE SET NULL,
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ck_plantilla_version CHECK (version > 0)
);

CREATE INDEX ix_plantilla_tribunal ON plantilla_escrito (tribunal_id) WHERE activa;

CREATE TRIGGER tg_plantilla_actualizado
    BEFORE UPDATE ON plantilla_escrito
    FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp();

COMMENT ON COLUMN plantilla_escrito.contenido IS
    'Texto del modelo con marcadores sustituibles del tipo {{caratula}}, '
    '{{tribunal}}, {{actor}}. El módulo de plantillas los resuelve contra la causa.';

-- -----------------------------------------------------------------------------
-- tarea — trabajo delegable entre integrantes del estudio.
--
-- causa_id y plazo_id son opcionales: existen tareas administrativas que no
-- cuelgan de ninguna causa, y tareas que nacen de vigilar un plazo concreto.
-- -----------------------------------------------------------------------------
CREATE TABLE tarea (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    causa_id            UUID REFERENCES causa(id) ON DELETE CASCADE,
    plazo_id            UUID REFERENCES plazo(id) ON DELETE SET NULL,
    titulo              VARCHAR(200) NOT NULL,
    descripcion         TEXT,
    asignada_a          UUID REFERENCES usuario(id) ON DELETE SET NULL,
    creada_por          UUID REFERENCES usuario(id) ON DELETE SET NULL,
    prioridad           VARCHAR(6)  NOT NULL DEFAULT 'MEDIA',
    estado              VARCHAR(12) NOT NULL DEFAULT 'PENDIENTE',
    fecha_vencimiento   DATE,
    completada_en       TIMESTAMPTZ,
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ck_tarea_prioridad CHECK (prioridad IN ('ALTA', 'MEDIA', 'BAJA')),
    CONSTRAINT ck_tarea_estado CHECK (
        estado IN ('PENDIENTE', 'EN_CURSO', 'COMPLETADA', 'CANCELADA')
    ),
    CONSTRAINT ck_tarea_completada CHECK (
        (estado = 'COMPLETADA' AND completada_en IS NOT NULL)
     OR (estado <> 'COMPLETADA')
    )
);

-- Tablero personal: "mis tareas abiertas", por vencimiento.
CREATE INDEX ix_tarea_asignada
    ON tarea (asignada_a, fecha_vencimiento)
    WHERE estado IN ('PENDIENTE', 'EN_CURSO');

CREATE INDEX ix_tarea_causa ON tarea (causa_id);

CREATE TRIGGER tg_tarea_actualizado
    BEFORE UPDATE ON tarea
    FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp();

-- ####  010_ia.sql  ##################################################

-- =============================================================================
-- 010 — Módulo IA (opcional)
--
-- La propuesta define la IA como dependencia externa OPCIONAL con degradación
-- elegante: sin clave de API el sistema funciona igual (riesgo R4). Por eso
-- ninguna otra tabla depende de esta, y el estado SIN_SERVICIO deja constancia
-- de las consultas que no se pudieron atender.
--
-- Registrar tokens y costo estimado permite controlar el gasto de la API, que
-- es justamente lo que hace riesgosa la dependencia.
-- =============================================================================

CREATE TABLE consulta_ia (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id        UUID REFERENCES usuario(id)           ON DELETE SET NULL,
    causa_id          UUID REFERENCES causa(id)             ON DELETE SET NULL,
    documento_id      UUID REFERENCES documento(id)         ON DELETE SET NULL,
    tipo              VARCHAR(30) NOT NULL,
    prompt            TEXT        NOT NULL,
    respuesta         TEXT,
    modelo            VARCHAR(80),
    tokens_entrada    INTEGER,
    tokens_salida     INTEGER,
    costo_estimado    NUMERIC(10,4),
    estado            VARCHAR(12) NOT NULL DEFAULT 'OK',
    mensaje_error     TEXT,
    creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ck_consulta_ia_tipo CHECK (
        tipo IN ('ANALISIS_TEXTO', 'BUSQUEDA_JURISPRUDENCIA', 'RESUMEN')
    ),
    CONSTRAINT ck_consulta_ia_estado CHECK (
        estado IN ('OK', 'ERROR', 'SIN_SERVICIO')
    ),
    CONSTRAINT ck_consulta_ia_tokens CHECK (
        (tokens_entrada IS NULL OR tokens_entrada >= 0)
    AND (tokens_salida  IS NULL OR tokens_salida  >= 0)
    )
);

CREATE INDEX ix_consulta_ia_fecha ON consulta_ia (creado_en DESC);
CREATE INDEX ix_consulta_ia_causa   ON consulta_ia (causa_id);

COMMENT ON TABLE consulta_ia IS
    'Historial de uso de la Claude API. Funcionalidad opcional: el sistema '
    'opera completo sin ella.';
COMMENT ON COLUMN consulta_ia.estado IS
    'SIN_SERVICIO registra la degradación elegante: no había clave o créditos, '
    'y la consulta se rechazó sin romper la operación.';

-- ####  011_auditoria.sql  ###########################################

-- =============================================================================
-- 011 — Módulo Auditoría
--
-- Decisión de modelado: UNA tabla genérica en lugar de una tabla de historial
-- por entidad. El requisito es "registro de auditoría de acciones sensibles";
-- una tabla por entidad multiplicaría el esquema por dos y obligaría a tocar
-- la auditoría cada vez que se agrega una tabla de negocio. Con entidad +
-- entidad_id + JSONB, auditar algo nuevo no requiere ninguna migración.
--
-- Excepción deliberada a la convención de claves: aquí la PK es BIGINT de
-- identidad, no UUID. Es una tabla append-only de alto volumen cuyo id nunca
-- aparece en una URL, así que no hay riesgo de enumeración y sí un beneficio
-- claro en tamaño de índice y localidad de escritura.
-- =============================================================================

CREATE TABLE auditoria (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usuario_id     UUID REFERENCES usuario(id) ON DELETE SET NULL,
    entidad        VARCHAR(60) NOT NULL,
    entidad_id     UUID,
    accion         VARCHAR(20) NOT NULL,
    datos_antes    JSONB,
    datos_despues  JSONB,
    ip             INET,
    user_agent     VARCHAR(300),
    ocurrido_en    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ck_auditoria_accion CHECK (
        accion IN ('CREAR', 'ACTUALIZAR', 'ELIMINAR', 'CONSULTAR', 'EXPORTAR',
                   'LOGIN', 'LOGOUT', 'LOGIN_FALLIDO', 'CAMBIO_PERMISOS')
    )
);

-- Vista principal: la actividad reciente del estudio.
CREATE INDEX ix_auditoria_fecha ON auditoria (ocurrido_en DESC);

-- Trazabilidad de un registro concreto: "todo lo que le pasó a esta causa".
CREATE INDEX ix_auditoria_entidad ON auditoria (entidad, entidad_id, ocurrido_en DESC);

-- Auditoría por usuario, para responder "quién hizo qué".
CREATE INDEX ix_auditoria_usuario ON auditoria (usuario_id, ocurrido_en DESC);

COMMENT ON TABLE auditoria IS
    'Registro append-only de acciones sensibles. Nunca se actualiza ni se '
    'borra desde la aplicación.';
COMMENT ON COLUMN auditoria.usuario_id IS
    'ON DELETE SET NULL: dar de baja a un usuario no puede borrar el rastro de '
    'lo que hizo. El nombre queda preservado dentro de datos_antes.';
COMMENT ON COLUMN auditoria.datos_antes IS
    'Estado del registro antes del cambio, en JSONB. NULL en altas.';
COMMENT ON COLUMN auditoria.datos_despues IS
    'Estado del registro después del cambio, en JSONB. NULL en bajas.';

-- ####  012_vistas.sql  ##############################################

-- =============================================================================
-- 012 — Vistas de consulta
--
-- Concentran los JOIN y las agregaciones que el backend repetiría en varios
-- endpoints. No agregan reglas de negocio: solo evitan duplicar SQL entre el
-- listado, el detalle y el reporte exportable.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- vw_plazo_vigente — base del panel "qué vence" y del calendario del estudio.
-- -----------------------------------------------------------------------------
CREATE VIEW vw_plazo_vigente AS
SELECT
    p.id                                  AS plazo_id,
    p.causa_id,
    c.numero_expediente,
    c.caratula,
    p.descripcion,
    tp.nombre                             AS tipo_plazo,
    tp.articulo_referencia,
    p.fecha_notificacion,
    p.fecha_vencimiento,
    p.estado,
    (p.fecha_vencimiento - CURRENT_DATE)  AS dias_corridos_restantes,
    p.responsable_id,
    u.nombre   AS responsable_nombre,
    u.apellido AS responsable_apellido
FROM plazo p
JOIN causa c        ON c.id  = p.causa_id
LEFT JOIN tipo_plazo tp ON tp.id = p.tipo_plazo_id
LEFT JOIN usuario u     ON u.id  = p.responsable_id
WHERE p.estado IN ('PENDIENTE', 'SUSPENDIDO')
  AND c.eliminado_en IS NULL;

COMMENT ON VIEW vw_plazo_vigente IS
    'Plazos abiertos con su causa y responsable. dias_corridos_restantes es '
    'calendario, no hábiles: sirve para ordenar y semaforizar, no para computar.';

-- -----------------------------------------------------------------------------
-- vw_costa_saldo — costas con lo efectivamente cobrado y el saldo pendiente.
-- Es la fuente del control de cobros y del reporte de gastos exportable.
-- -----------------------------------------------------------------------------
CREATE VIEW vw_costa_saldo AS
SELECT
    co.id            AS costa_id,
    co.causa_id,
    c.numero_expediente,
    c.caratula,
    cc.nombre        AS concepto,
    co.descripcion,
    co.monto,
    co.moneda,
    co.fecha_devengamiento,
    co.fecha_vencimiento_pago,
    co.a_cargo_de,
    co.estado_cobro,
    COALESCE(SUM(cb.monto), 0)             AS total_cobrado,
    co.monto - COALESCE(SUM(cb.monto), 0)  AS saldo_pendiente
FROM costa co
JOIN causa c           ON c.id  = co.causa_id
JOIN concepto_costa cc ON cc.id = co.concepto_costa_id
LEFT JOIN cobro cb     ON cb.costa_id = co.id
WHERE c.eliminado_en IS NULL
GROUP BY co.id, c.numero_expediente, c.caratula, cc.nombre;

COMMENT ON VIEW vw_costa_saldo IS
    'Saldo real por costa. Permite contrastar el estado_cobro persistido en '
    'costa contra la suma efectiva de cobros.';

-- -----------------------------------------------------------------------------
-- vw_causa_resumen — tarjeta de la causa en listados, sin N+1 consultas.
-- -----------------------------------------------------------------------------
CREATE VIEW vw_causa_resumen AS
SELECT
    c.id             AS causa_id,
    c.numero_expediente,
    c.caratula,
    f.nombre         AS fuero,
    t.nombre         AS tribunal,
    ec.nombre        AS estado,
    ec.es_final,
    c.fecha_inicio,
    (SELECT count(*) FROM parte_causa pc  WHERE pc.causa_id = c.id)  AS cantidad_partes,
    (SELECT count(*) FROM documento d
       WHERE d.causa_id = c.id AND d.eliminado_en IS NULL)           AS cantidad_documentos,
    (SELECT count(*) FROM plazo p
       WHERE p.causa_id = c.id AND p.estado = 'PENDIENTE')           AS plazos_pendientes,
    (SELECT min(p.fecha_vencimiento) FROM plazo p
       WHERE p.causa_id = c.id AND p.estado = 'PENDIENTE')           AS proximo_vencimiento
FROM causa c
JOIN fuero f            ON f.id  = c.fuero_id
JOIN estado_causa ec    ON ec.id = c.estado_causa_id
LEFT JOIN tribunal t    ON t.id  = c.tribunal_id
WHERE c.eliminado_en IS NULL;

COMMENT ON VIEW vw_causa_resumen IS
    'Causa con sus contadores y el próximo vencimiento, para el listado principal.';


-- ####  013_rls_y_roles_publicos.sql  ###################################

-- =============================================================================
-- 013 — Row Level Security y roles públicos de Supabase
-- Sistema de Gestión Integral para Estudios Jurídicos
-- =============================================================================
--
-- La aplicación nunca expone la base al navegador: todo pasa por la API, que
-- se conecta como dueña de las tablas. Pero Supabase publica el esquema public
-- por su Data API (PostgREST) con los roles `anon` y `authenticated`, y la
-- clave anon no es secreta. Sin esta migración, quien la tenga podría leer o
-- escribir las tablas directamente, salteando la API y todos sus controles.
--
-- Dos barreras, cada una suficiente por sí sola:
--
--  1. RLS activado en todas las tablas y SIN políticas: para cualquier rol que
--     no sea el dueño, cada tabla aparece vacía y no admite escrituras.
--  2. Se quitan los permisos de anon y authenticated sobre el esquema, también
--     para las tablas que se creen en el futuro.
--
-- Al backend no le cambia nada: el dueño de una tabla no está sujeto a sus
-- políticas salvo que se use FORCE ROW LEVEL SECURITY, que acá no se usa. En
-- el PostgreSQL local (docker compose, CI) los roles de Supabase no existen y
-- el bloque 2 no hace nada.
-- =============================================================================

DO $$
DECLARE
    tabla record;
BEGIN
    FOR tabla IN
        SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public'
    LOOP
        EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', tabla.schemaname, tabla.tablename);
    END LOOP;
END;
$$;

DO $$
DECLARE
    rol text;
BEGIN
    FOREACH rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rol) THEN
            EXECUTE format('REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM %I', rol);
            EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', rol);
            EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', rol);
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM %I', rol);
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', rol);
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', rol);
        END IF;
    END LOOP;
END;
$$;


-- ####  014_agenda_y_correo.sql  #######################################

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
