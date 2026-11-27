-- =============================================================================
-- SEED 002 — Datos de demostración
--
-- TODOS LOS DATOS DE ESTE ARCHIVO SON FICTICIOS.
--
-- Mitigación del riesgo R5 de la propuesta (Ley 25.326 de Protección de Datos
-- Personales): en desarrollo no se usan datos reales de personas ni de causas.
-- Nombres, documentos, CUIT, domicilios y carátulas son inventados; cualquier
-- parecido con expedientes reales es casual.
--
-- NO EJECUTAR EN PRODUCCIÓN.
--
-- Requiere haber ejecutado antes 001_catalogos.sql.
-- =============================================================================

-- Este archivo usa crypt() y gen_salt() de pgcrypto para hashear las
-- contraseñas de demostración. Cada proveedor instala las extensiones en un
-- esquema distinto (public en local, Docker y Neon; extensions en Supabase),
-- así que se nombran ambos en lugar de depender del search_path de la sesión.
SET search_path = public, extensions, pg_catalog;

-- -----------------------------------------------------------------------------
-- Estudio
-- -----------------------------------------------------------------------------
INSERT INTO estudio (razon_social, nombre_fantasia, cuit, email_contacto,
                     telefono, domicilio, jurisdiccion_id)
SELECT 'Estudio Jurídico Demo S.R.L.', 'Estudio Demo', '30-71234567-4',
       'contacto@estudiodemo.test', '351-4000000',
       'Av. Colón 1234, Piso 3', j.id
FROM jurisdiccion j
WHERE j.codigo = 'AR-X'
ON CONFLICT (cuit) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Usuarios
--
-- La contraseña de todos los usuarios de demo es  Demo1234!
-- El hash se genera con pgcrypto (bcrypt, coste 10) en el momento del INSERT,
-- de modo que no queda ninguna contraseña en claro ni un hash fijo en el repo.
-- El formato es compatible con la librería bcrypt de Node.
-- -----------------------------------------------------------------------------

INSERT INTO usuario (rol_id, email, password_hash, nombre, apellido,
                     matricula, telefono)
SELECT r.id, v.email, crypt('Demo1234!', gen_salt('bf', 10)),
       v.nombre, v.apellido, v.matricula, v.telefono
FROM (VALUES
        ('ADMIN',        'admin@estudiodemo.test',    'Laura',  'Gestión',   NULL,        '351-4000001'),
        ('JEFE_ESTUDIO', 'jefe@estudiodemo.test',     'Martín', 'Cordero',   'M.P. 1-12345', '351-4000002'),
        ('EMPLEADO',     'empleado1@estudiodemo.test','Sofía',  'Navarro',   'M.P. 1-23456', '351-4000003'),
        ('EMPLEADO',     'empleado2@estudiodemo.test','Diego',  'Ferreyra',  NULL,        '351-4000004')
     ) AS v(rol_codigo, email, nombre, apellido, matricula, telefono)
JOIN rol r ON r.codigo = v.rol_codigo
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- Personas (partes y clientes) — todas ficticias
-- -----------------------------------------------------------------------------
INSERT INTO persona (tipo_persona, nombre, apellido, razon_social,
                     tipo_documento, numero_documento, cuit_cuil, email,
                     telefono, domicilio, localidad, provincia)
SELECT v.tipo, v.nombre, v.apellido, v.razon_social, v.tipo_doc,
       v.nro_doc, v.cuit, v.email, v.telefono, v.domicilio, 'Córdoba', 'Córdoba'
FROM (VALUES
        ('FISICA',  'Roberto', 'Giménez', NULL,
         'DNI', '20111222', '20-20111222-3', 'rgimenez@demo.test',
         '351-5000001', 'Belgrano 450'),
        ('FISICA',  'Marta',   'Sosa',    NULL,
         'DNI', '27333444', '27-27333444-9', 'msosa@demo.test',
         '351-5000002', 'Rivadavia 88'),
        ('FISICA',  'Julián',  'Ibarra',  NULL,
         'DNI', '30555666', '20-30555666-1', 'jibarra@demo.test',
         '351-5000003', 'San Jerónimo 2100'),
        ('FISICA',  'Carolina','Ledesma', NULL,
         'DNI', '33777888', '27-33777888-5', 'cledesma@demo.test',
         '351-5000004', 'Obispo Trejo 763'),
        ('JURIDICA', NULL, NULL, 'Transportes del Centro S.A.',
         'CUIT', '30999888', '30-30999888-7', 'legales@transportes.test',
         '351-5000005', 'Ruta 9 Km 12'),
        ('JURIDICA', NULL, NULL, 'Aseguradora del Sur S.A.',
         'CUIT', '30444555', '30-30444555-2', 'siniestros@aseguradora.test',
         '351-5000006', 'Av. Vélez Sarsfield 1500')
     ) AS v(tipo, nombre, apellido, razon_social, tipo_doc, nro_doc, cuit,
            email, telefono, domicilio)
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- Causas
-- -----------------------------------------------------------------------------
INSERT INTO causa (numero_expediente, caratula, tribunal_id, fuero_id,
                   tipo_causa_id, estado_causa_id, fecha_inicio, monto_reclamado,
                   creado_por)
SELECT v.expediente, v.caratula, t.id, f.id, tc.id, ec.id,
       v.fecha_inicio::date, v.monto, u.id
FROM jurisdiccion j
JOIN usuario u ON u.email = 'jefe@estudiodemo.test'
JOIN (VALUES
        ('10234567', 'GIMENEZ, ROBERTO c/ TRANSPORTES DEL CENTRO S.A. - DAÑOS Y PERJUICIOS',
         'CIV_COM', 'DANOS', 'EN_TRAMITE', '2026-03-12', 4500000.00,
         'Juzgado de Primera Instancia Civil y Comercial', '1.ª'),
        ('10298877', 'SOSA, MARTA c/ ASEGURADORA DEL SUR S.A. - ORDINARIO',
         'CIV_COM', 'ORDINARIO', 'PRUEBA', '2026-05-04', 2750000.00,
         'Juzgado de Primera Instancia Civil y Comercial', '2.ª'),
        ('10311204', 'IBARRA, JULIÁN c/ TRANSPORTES DEL CENTRO S.A. - DESPIDO',
         'LABORAL', 'DESPIDO', 'EN_TRAMITE', '2026-07-21', 6200000.00,
         'Juzgado de Conciliación', '1.ª')
     ) AS v(expediente, caratula, fuero_codigo, tipo_codigo, estado_codigo,
            fecha_inicio, monto, tribunal_nombre, tribunal_nom)
  ON TRUE
JOIN fuero f        ON f.jurisdiccion_id = j.id AND f.codigo = v.fuero_codigo
JOIN tipo_causa tc  ON tc.fuero_id = f.id AND tc.codigo = v.tipo_codigo
JOIN estado_causa ec ON ec.codigo = v.estado_codigo
JOIN tribunal t     ON t.fuero_id = f.id
                   AND t.nombre = v.tribunal_nombre
                   AND t.nominacion = v.tribunal_nom
WHERE j.codigo = 'AR-X'
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- Partes de cada causa
-- -----------------------------------------------------------------------------
INSERT INTO parte_causa (causa_id, persona_id, caracter, es_cliente)
SELECT c.id, p.id, v.caracter, v.es_cliente
FROM causa c
JOIN (VALUES
        ('10234567', 'Giménez',                     'ACTOR',     TRUE),
        ('10234567', 'Transportes del Centro S.A.', 'DEMANDADO', FALSE),
        ('10234567', 'Aseguradora del Sur S.A.',    'TERCERO',   FALSE),
        ('10298877', 'Sosa',                        'ACTOR',     TRUE),
        ('10298877', 'Aseguradora del Sur S.A.',    'DEMANDADO', FALSE),
        ('10311204', 'Ibarra',                      'ACTOR',     TRUE),
        ('10311204', 'Transportes del Centro S.A.', 'DEMANDADO', FALSE)
     ) AS v(expediente, identificador, caracter, es_cliente)
  ON v.expediente = c.numero_expediente
JOIN persona p ON (p.apellido = v.identificador OR p.razon_social = v.identificador)
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- Profesionales asignados
-- -----------------------------------------------------------------------------
INSERT INTO profesional_causa (causa_id, usuario_id, rol_en_causa)
SELECT c.id, u.id, v.rol_en_causa
FROM causa c
JOIN (VALUES
        ('10234567', 'jefe@estudiodemo.test',      'TITULAR'),
        ('10234567', 'empleado1@estudiodemo.test', 'COLABORADOR'),
        ('10298877', 'jefe@estudiodemo.test',      'PATROCINANTE'),
        ('10311204', 'empleado1@estudiodemo.test', 'TITULAR'),
        ('10311204', 'empleado2@estudiodemo.test', 'COLABORADOR')
     ) AS v(expediente, email, rol_en_causa)
  ON v.expediente = c.numero_expediente
JOIN usuario u ON u.email = v.email
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- Movimientos procesales
-- -----------------------------------------------------------------------------
INSERT INTO movimiento_causa (causa_id, fecha, tipo, descripcion, origen, registrado_por)
SELECT c.id, v.fecha::date, v.tipo, v.descripcion, 'MANUAL', u.id
FROM causa c
JOIN (VALUES
        ('10234567', '2026-03-12', 'Presentación',  'Se presenta demanda por daños y perjuicios.'),
        ('10234567', '2026-04-08', 'Traslado',      'Se corre traslado de la demanda a la contraria.'),
        ('10234567', '2026-09-10', 'Notificación',  'Se notifica resolución que ordena ofrecer prueba.'),
        ('10298877', '2026-05-04', 'Presentación',  'Se presenta demanda ordinaria.'),
        ('10298877', '2026-08-19', 'Apertura',      'Se abre la causa a prueba.'),
        ('10311204', '2026-07-21', 'Presentación',  'Se inicia reclamo por despido sin causa.')
     ) AS v(expediente, fecha, tipo, descripcion)
  ON v.expediente = c.numero_expediente
JOIN usuario u ON u.email = 'jefe@estudiodemo.test'
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- Documentos y su texto extraído
-- -----------------------------------------------------------------------------
INSERT INTO documento (causa_id, tipo_documento_id, nombre_archivo,
                       nombre_original, mime_type, tamano_bytes,
                       ruta_almacenamiento, hash_sha256, estado_extraccion,
                       descripcion, subido_por)
SELECT c.id, td.id, v.archivo, v.original, 'application/pdf',
       v.tamano, 'demo/' || v.archivo, v.hash, v.estado, v.descripcion, u.id
FROM causa c
JOIN (VALUES
        ('10234567', 'ESCRITO', 'demanda-10234567.pdf', 'Demanda.pdf', 184320,
         repeat('a1', 32), 'COMPLETADA', 'Escrito de demanda presentado.'),
        ('10234567', 'CEDULA',  'cedula-10234567.pdf',  'Cedula traslado.pdf', 65536,
         repeat('b2', 32), 'COMPLETADA', 'Cédula de notificación del traslado.'),
        ('10298877', 'ESCRITO', 'demanda-10298877.pdf', 'Demanda ordinaria.pdf', 221184,
         repeat('c3', 32), 'PENDIENTE', 'Escrito de demanda, pendiente de extracción.')
     ) AS v(expediente, tipo_doc, archivo, original, tamano, hash, estado, descripcion)
  ON v.expediente = c.numero_expediente
JOIN tipo_documento td ON td.codigo = v.tipo_doc
JOIN usuario u ON u.email = 'empleado1@estudiodemo.test'
ON CONFLICT DO NOTHING;

INSERT INTO documento_texto (documento_id, texto, cantidad_paginas, motor_extraccion)
SELECT d.id, v.texto, v.paginas, 'pdfplumber'
FROM documento d
JOIN (VALUES
        ('demanda-10234567.pdf',
         'SEÑOR JUEZ: Roberto Giménez, por derecho propio, con domicilio en Belgrano 450, '
         'viene a promover demanda ordinaria de daños y perjuicios contra Transportes del '
         'Centro S.A., por los hechos y el derecho que a continuación se exponen.', 12),
        ('cedula-10234567.pdf',
         'CÉDULA DE NOTIFICACIÓN. Se hace saber al demandado que se ha corrido traslado de '
         'la demanda por el término de ley, bajo apercibimiento de rebeldía.', 1)
     ) AS v(archivo, texto, paginas)
  ON v.archivo = d.nombre_archivo
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- Plazos
--
-- Cubren los estados relevantes para probar el panel de vencimientos:
-- uno próximo, uno ya vencido y uno cumplido.
-- -----------------------------------------------------------------------------
INSERT INTO plazo (causa_id, tipo_plazo_id, descripcion,
                   fecha_notificacion, fecha_inicio_computo, cantidad_dias,
                   computo, fecha_vencimiento, fecha_vencimiento_original,
                   estado, responsable_id, fecha_cumplimiento, creado_por)
SELECT c.id, tp.id, v.descripcion,
       v.notificacion::date, v.inicio::date, v.dias, v.computo,
       v.vencimiento::date, v.vencimiento::date, v.estado, u.id,
       v.cumplimiento::date, u.id
FROM causa c
JOIN (VALUES
        ('10234567', 'OFRECER_PRUEBA', 'Ofrecer prueba en los términos de la resolución notificada',
         '2026-09-10', '2026-09-11', 10, 'HABIL', '2026-09-25', 'PENDIENTE',
         'jefe@estudiodemo.test', NULL),
        ('10298877', 'RECURSO_REPOSICION', 'Recurso de reposición contra el proveído del 14/09',
         '2026-09-14', '2026-09-15', 3, 'HABIL', '2026-09-17', 'VENCIDO',
         'jefe@estudiodemo.test', NULL),
        ('10311204', 'CONTESTAR_DEMANDA_LAB', 'Contestar traslado conferido por el juzgado',
         '2026-08-03', '2026-08-04', 10, 'HABIL', '2026-08-18', 'CUMPLIDO',
         'empleado1@estudiodemo.test', '2026-08-17')
     ) AS v(expediente, tipo_codigo, descripcion, notificacion, inicio, dias,
            computo, vencimiento, estado, email_responsable, cumplimiento)
  ON v.expediente = c.numero_expediente
JOIN tipo_plazo tp ON tp.codigo = v.tipo_codigo
JOIN usuario u ON u.email = v.email_responsable
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- Reglas de alerta del estudio (multinivel)
-- -----------------------------------------------------------------------------
INSERT INTO regla_alerta (tipo_plazo_id, dias_anticipacion, nivel)
SELECT NULL, v.dias, v.nivel
FROM (VALUES (5, 'INFORMATIVA'), (3, 'IMPORTANTE'), (1, 'CRITICA')) AS v(dias, nivel)
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- Costas y cobros
-- -----------------------------------------------------------------------------
INSERT INTO costa (causa_id, concepto_costa_id, descripcion, monto,
                   fecha_devengamiento, fecha_vencimiento_pago, a_cargo_de,
                   estado_cobro, registrado_por)
SELECT c.id, cc.id, v.descripcion, v.monto,
       v.devengamiento::date, v.vencimiento::date, v.a_cargo, v.estado, u.id
FROM causa c
JOIN (VALUES
        ('10234567', 'TASA_JUSTICIA', 'Tasa de justicia por iniciación',  90000.00,
         '2026-03-12', '2026-04-12', 'CLIENTE', 'COBRADO'),
        ('10234567', 'NOTIFICACION',  'Cédulas de notificación',          18500.00,
         '2026-04-08', '2026-05-08', 'CLIENTE', 'PARCIAL'),
        ('10234567', 'APORTE_LEY',    'Aporte a la caja de abogados',     35000.00,
         '2026-03-12', '2026-04-12', 'CLIENTE', 'PENDIENTE'),
        ('10298877', 'TASA_JUSTICIA', 'Tasa de justicia por iniciación',  55000.00,
         '2026-05-04', '2026-06-04', 'CLIENTE', 'COBRADO'),
        ('10298877', 'HONORARIO_PERITO', 'Anticipo de gastos del perito', 120000.00,
         '2026-08-19', '2026-09-19', 'ESTUDIO', 'PENDIENTE'),
        ('10311204', 'MOVILIDAD',     'Diligencias en el juzgado',        12000.00,
         '2026-07-21', NULL,          'ESTUDIO', 'INCOBRABLE')
     ) AS v(expediente, concepto, descripcion, monto, devengamiento,
            vencimiento, a_cargo, estado)
  ON v.expediente = c.numero_expediente
JOIN concepto_costa cc ON cc.codigo = v.concepto
JOIN usuario u ON u.email = 'admin@estudiodemo.test'
ON CONFLICT DO NOTHING;

-- Cobro total de una costa y cobro parcial de otra, para ejercitar vw_costa_saldo.
INSERT INTO cobro (costa_id, monto, fecha, medio_pago, comprobante, registrado_por)
SELECT co.id, v.monto, v.fecha::date, v.medio, v.comprobante, u.id
FROM costa co
JOIN causa c ON c.id = co.causa_id
JOIN (VALUES
        ('10234567', 'Tasa de justicia por iniciación', 90000.00, '2026-04-10',
         'TRANSFERENCIA', 'REC-0001'),
        ('10234567', 'Cédulas de notificación',          10000.00, '2026-05-06',
         'EFECTIVO',      'REC-0002'),
        ('10298877', 'Tasa de justicia por iniciación',  55000.00, '2026-06-02',
         'TRANSFERENCIA', 'REC-0003')
     ) AS v(expediente, descripcion, monto, fecha, medio, comprobante)
  ON v.expediente = c.numero_expediente AND v.descripcion = co.descripcion
JOIN usuario u ON u.email = 'admin@estudiodemo.test'
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- Tareas
-- -----------------------------------------------------------------------------
INSERT INTO tarea (causa_id, titulo, descripcion, asignada_a,
                   creada_por, prioridad, estado, fecha_vencimiento, completada_en)
SELECT c.id, v.titulo, v.descripcion, ua.id, uc.id,
       v.prioridad, v.estado, v.vencimiento::date, v.completada::timestamptz
FROM causa c
JOIN (VALUES
        ('10234567', 'Preparar ofrecimiento de prueba',
         'Armar el listado de testigos y la pericia mecánica.',
         'empleado1@estudiodemo.test', 'ALTA', 'EN_CURSO', '2026-09-23', NULL),
        ('10234567', 'Pedir informe al registro automotor',
         'Solicitar titularidad del vehículo al momento del hecho.',
         'empleado2@estudiodemo.test', 'MEDIA', 'PENDIENTE', '2026-09-30', NULL),
        ('10298877', 'Diligenciar oficio a la aseguradora',
         'Retirar y diligenciar el oficio ordenado en la apertura a prueba.',
         'empleado1@estudiodemo.test', 'ALTA', 'PENDIENTE', '2026-09-22', NULL),
        ('10311204', 'Cargar contestación al expediente digital',
         'Subir el escrito presentado y su cargo.',
         'empleado2@estudiodemo.test', 'BAJA', 'COMPLETADA', '2026-08-18',
         '2026-08-17 16:40:00-03')
     ) AS v(expediente, titulo, descripcion, email_asignada, prioridad,
            estado, vencimiento, completada)
  ON v.expediente = c.numero_expediente
JOIN usuario ua ON ua.email = v.email_asignada
JOIN usuario uc ON uc.email = 'jefe@estudiodemo.test'
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- Eventos del calendario compartido
-- -----------------------------------------------------------------------------
INSERT INTO evento_calendario (causa_id, titulo, descripcion, tipo,
                               fecha_inicio, fecha_fin, todo_el_dia, lugar, creado_por)
SELECT c.id, v.titulo, v.descripcion, v.tipo,
       v.inicio::timestamptz, v.fin::timestamptz, v.todo_el_dia, v.lugar, u.id
FROM causa c
JOIN (VALUES
        ('10311204', 'Audiencia de conciliación',
         'Audiencia ante el Juzgado de Conciliación.', 'AUDIENCIA',
         '2026-09-29 09:30:00-03', '2026-09-29 11:00:00-03', FALSE,
         'Tribunales II, Córdoba'),
        ('10234567', 'Vencimiento: ofrecer prueba',
         'Último día para ofrecer prueba.', 'VENCIMIENTO',
         '2026-09-25 00:00:00-03', '2026-09-25 23:59:00-03', TRUE, NULL)
     ) AS v(expediente, titulo, descripcion, tipo, inicio, fin, todo_el_dia, lugar)
  ON v.expediente = c.numero_expediente
JOIN usuario u ON u.email = 'jefe@estudiodemo.test'
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- Agenda jurídica (fase 5)
--
-- Fechas RELATIVAS a la fecha de carga (CURRENT_DATE), a diferencia del resto
-- del seed: una agenda de demostración con todo en el pasado no muestra nada.
-- Horas de pared de Argentina. Incluye eventos superpuestos, de varios días,
-- uno completado, uno cancelado y uno personal, para ver todas las vistas.
-- -----------------------------------------------------------------------------
INSERT INTO evento_calendario (causa_id, titulo, descripcion, tipo, estado, prioridad, visibilidad,
                               fecha_inicio, fecha_fin, todo_el_dia, lugar, enlace_virtual,
                               responsable_id, creado_por, actualizado_por,
                               completado_en, cancelado_en, motivo_cancelacion)
SELECT c.id, v.titulo, v.descripcion, v.tipo, v.estado, v.prioridad, v.visibilidad,
       ((d.dia) + v.desde::time) AT TIME ZONE 'America/Argentina/Buenos_Aires',
       ((d.dia + v.dias_fin) + v.hasta::time) AT TIME ZONE 'America/Argentina/Buenos_Aires',
       v.todo_el_dia, v.lugar, v.enlace, ur.id, uc.id, uc.id,
       CASE WHEN v.estado = 'COMPLETADO' THEN now() END,
       CASE WHEN v.estado = 'CANCELADO' THEN now() END,
       CASE WHEN v.estado = 'CANCELADO' THEN 'El juzgado suspendió la audiencia por feria administrativa.' END
FROM (VALUES
  ('10311204', 'Audiencia de conciliación laboral', 'Llevar la propuesta de acuerdo y la documental original.', 'AUDIENCIA', 'CONFIRMADO', 'ALTA', 'ESTUDIO',
   1, 0, '09:30', '11:00', FALSE, 'Tribunales II, sala 4', NULL, 'jefe@estudiodemo.test'),
  ('10234567', 'Mediación prejudicial', 'Primera audiencia de mediación con la aseguradora.', 'MEDIACION', 'PENDIENTE', 'MEDIA', 'ESTUDIO',
   2, 0, '11:00', '12:30', FALSE, 'Centro Judicial de Mediación', 'https://meet.example.com/mediacion-gimenez', 'empleado1@estudiodemo.test'),
  (NULL, 'Reunión con cliente nuevo', 'Consulta inicial por un reclamo laboral.', 'REUNION', 'PENDIENTE', 'MEDIA', 'ESTUDIO',
   0, 0, '17:00', '18:00', FALSE, 'Oficina del estudio', NULL, 'jefe@estudiodemo.test'),
  (NULL, 'Reunión de equipo semanal', 'Repaso de vencimientos y audiencias de la semana.', 'REUNION', 'PENDIENTE', 'BAJA', 'PARTICIPANTES',
   3, 0, '10:00', '11:00', FALSE, 'Sala de reuniones', NULL, 'admin@estudiodemo.test'),
  ('10298877', 'Audiencia testimonial', 'Declaran dos testigos de la parte actora.', 'AUDIENCIA', 'PENDIENTE', 'ALTA', 'ESTUDIO',
   3, 0, '10:30', '12:00', FALSE, 'Juzgado Civil N.º 12', NULL, 'jefe@estudiodemo.test'),
  (NULL, 'Pago de tasa de justicia', 'Vence el plazo administrativo para abonar la tasa.', 'VENCIMIENTO', 'PENDIENTE', 'ALTA', 'ESTUDIO',
   5, 0, '00:00', '23:59:59', TRUE, NULL, NULL, 'empleado2@estudiodemo.test'),
  ('10311204', 'Audiencia preliminar', NULL, 'AUDIENCIA', 'PENDIENTE', 'MEDIA', 'ESTUDIO',
   8, 0, '09:00', '10:30', FALSE, 'Tribunales II, sala 2', NULL, 'jefe@estudiodemo.test'),
  ('10298877', 'Mediación con la aseguradora', NULL, 'MEDIACION', 'PENDIENTE', 'MEDIA', 'ESTUDIO',
   10, 0, '15:00', '16:30', FALSE, NULL, 'https://meet.example.com/mediacion-sosa', 'empleado1@estudiodemo.test'),
  (NULL, 'Jornada de actualización procesal', 'Capacitación del Colegio de Abogados.', 'OTRO', 'PENDIENTE', 'BAJA', 'ESTUDIO',
   12, 1, '00:00', '23:59:59', TRUE, 'Colegio de Abogados', NULL, 'admin@estudiodemo.test'),
  ('10234567', 'Reunión con el perito contable', NULL, 'REUNION', 'COMPLETADO', 'MEDIA', 'ESTUDIO',
   -2, 0, '10:00', '11:00', FALSE, 'Oficina del estudio', NULL, 'empleado1@estudiodemo.test'),
  ('10311204', 'Audiencia de vista de causa', NULL, 'AUDIENCIA', 'CANCELADO', 'MEDIA', 'ESTUDIO',
   6, 0, '09:00', '10:00', FALSE, 'Tribunales II', NULL, 'jefe@estudiodemo.test'),
  (NULL, 'Turno médico', NULL, 'OTRO', 'PENDIENTE', 'BAJA', 'PERSONAL',
   4, 0, '08:00', '09:00', FALSE, NULL, NULL, 'jefe@estudiodemo.test')
) AS v(expediente, titulo, descripcion, tipo, estado, prioridad, visibilidad,
       dias, dias_fin, desde, hasta, todo_el_dia, lugar, enlace, responsable)
-- Sábado o domingo se corre al lunes: una audiencia de fin de semana no es creíble.
CROSS JOIN LATERAL (
    SELECT (CURRENT_DATE + v.dias)
         + CASE extract(isodow FROM CURRENT_DATE + v.dias) WHEN 6 THEN 2 WHEN 7 THEN 1 ELSE 0 END AS dia
) AS d
LEFT JOIN causa c ON c.numero_expediente = v.expediente
JOIN usuario ur ON ur.email = v.responsable
JOIN usuario uc ON uc.email = 'jefe@estudiodemo.test'
WHERE NOT EXISTS (SELECT 1 FROM evento_calendario e WHERE e.titulo = v.titulo);

-- Participantes: la reunión de equipo convoca a todos; la conciliación laboral, a Sofía.
INSERT INTO evento_participante (evento_id, usuario_id)
SELECT e.id, u.id
FROM evento_calendario e
JOIN usuario u ON u.email IN ('jefe@estudiodemo.test', 'empleado1@estudiodemo.test', 'empleado2@estudiodemo.test')
WHERE e.titulo = 'Reunión de equipo semanal'
UNION ALL
SELECT e.id, u.id
FROM evento_calendario e
JOIN usuario u ON u.email = 'empleado1@estudiodemo.test'
WHERE e.titulo = 'Audiencia de conciliación laboral'
ON CONFLICT DO NOTHING;

-- Recordatorios por defecto del tipo, como si se hubieran cargado desde la aplicación.
INSERT INTO evento_recordatorio (evento_id, minutos_antes)
SELECT e.id, r.minutos_antes
FROM evento_calendario e
JOIN regla_recordatorio r ON r.tipo_evento = e.tipo AND r.activa
ON CONFLICT DO NOTHING;

INSERT INTO evento_historial (evento_id, usuario_id, accion, detalle)
SELECT e.id, e.creado_por, 'CREADO', jsonb_build_object('tipo', e.tipo)
FROM evento_calendario e
WHERE NOT EXISTS (SELECT 1 FROM evento_historial h WHERE h.evento_id = e.id);

-- -----------------------------------------------------------------------------
-- Auditoría de ejemplo
-- -----------------------------------------------------------------------------
INSERT INTO auditoria (usuario_id, entidad, entidad_id, accion,
                       datos_despues, ip, user_agent)
SELECT u.id, 'causa', c.id, 'CREAR',
       jsonb_build_object('caratula', c.caratula,
                          'numero_expediente', c.numero_expediente),
       '190.51.0.10'::inet, 'Mozilla/5.0 (demo)'
FROM causa c
JOIN usuario u ON u.email = 'jefe@estudiodemo.test';
