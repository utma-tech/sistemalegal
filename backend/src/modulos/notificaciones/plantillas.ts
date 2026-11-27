/**
 * Plantillas de los avisos: correo (HTML + texto plano) y aviso interno.
 *
 * Criterio de contenido del correo: lo mínimo para saber que hay algo y
 * cuándo. Un correo sale de la aplicación y puede reenviarse, quedar en un
 * celular perdido o en un buzón compartido, así que NO lleva carátulas,
 * nombres de clientes, títulos de eventos, documentos ni motivos de
 * cancelación. El detalle está detrás del enlace, que exige iniciar sesión.
 *
 * El aviso interno (la campana) sí puede nombrar el evento: se muestra dentro
 * del sistema y su acceso se revalida antes de entregarlo.
 *
 * Diseño del HTML: tabla de una columna, estilos en línea y sin imágenes
 * remotas (muchos clientes de correo bloquean CSS externo e imágenes). Se lee
 * bien en celular porque el ancho es fluido con tope de 560 px.
 */

export type TipoPlantilla =
  | 'RECORDATORIO_AUDIENCIA'
  | 'RECORDATORIO_MEDIACION'
  | 'RECORDATORIO_REUNION'
  | 'RECORDATORIO_OTRO'
  | 'PLAZO_PROXIMO'
  | 'PLAZO_CRITICO'
  | 'EVENTO_ASIGNADO'
  | 'EVENTO_REPROGRAMADO'
  | 'EVENTO_CANCELADO'
  | 'PRUEBA';

export const PLANTILLAS: TipoPlantilla[] = [
  'RECORDATORIO_AUDIENCIA',
  'RECORDATORIO_REUNION',
  'RECORDATORIO_MEDIACION',
  'RECORDATORIO_OTRO',
  'PLAZO_PROXIMO',
  'PLAZO_CRITICO',
  'EVENTO_ASIGNADO',
  'EVENTO_REPROGRAMADO',
  'EVENTO_CANCELADO',
  'PRUEBA',
];

export interface DatosCorreo {
  /** Nombre de pila del destinatario. */
  destinatario: string;
  tipoEvento?: string;
  /** `YYYY-MM-DD`. */
  fecha?: string;
  /** `HH:mm`, o null si es de día completo. */
  hora?: string | null;
  /** "en 24 horas", "en 2 días hábiles"… */
  restante?: string;
  fechaAnterior?: string;
  horaAnterior?: string | null;
  /** URL absoluta dentro de la aplicación. */
  enlace: string;
}

export interface CorreoArmado {
  asunto: string;
  html: string;
  texto: string;
}

const NOMBRE_TIPO: Record<string, string> = {
  AUDIENCIA: 'audiencia',
  MEDIACION: 'mediación',
  REUNION: 'reunión',
  VENCIMIENTO: 'vencimiento administrativo',
  OTRO: 'evento',
};

export function nombreTipo(tipo: string | undefined): string {
  return NOMBRE_TIPO[tipo ?? ''] ?? 'evento';
}

/** Artículo indefinido que concuerda: "una audiencia", "un evento". */
function conArticulo(tipo: string | undefined): string {
  const nombre = nombreTipo(tipo);
  return `${['audiencia', 'mediación', 'reunión'].includes(nombre) ? 'una' : 'un'} ${nombre}`;
}

function mayuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** "jueves 3 de diciembre de 2026". La fecha es civil: se formatea en UTC para no correrla. */
export function fechaLegible(fecha: string | undefined): string {
  if (!fecha) return '';
  const [anio, mes, dia] = fecha.split('-').map(Number);
  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(anio!, mes! - 1, dia!, 12)));
}

/** "jue 3/12". */
function fechaCorta(fecha: string | undefined): string {
  if (!fecha) return '';
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const semana = new Intl.DateTimeFormat('es-AR', { weekday: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(anio!, mes! - 1, dia!, 12)))
    .replace('.', '');
  return `${semana} ${dia}/${mes}`;
}

function cuando(fecha: string | undefined, hora: string | null | undefined): string {
  if (!fecha) return '';
  return hora ? `${fechaLegible(fecha)}, ${hora} h` : `${fechaLegible(fecha)} (todo el día)`;
}

function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface Contenido {
  asunto: string;
  titulo: string;
  parrafo: string;
  datos: [string, string][];
  boton: string;
}

function contenido(tipo: TipoPlantilla, d: DatosCorreo): Contenido {
  const fechaHora = cuando(d.fecha, d.hora);
  const corto = `${fechaCorta(d.fecha)}${d.hora ? ` ${d.hora}` : ''}`;

  switch (tipo) {
    case 'RECORDATORIO_AUDIENCIA':
    case 'RECORDATORIO_MEDIACION':
    case 'RECORDATORIO_REUNION':
    case 'RECORDATORIO_OTRO': {
      const nombre = nombreTipo(d.tipoEvento);
      return {
        asunto: `Recordatorio de ${nombre}: ${corto}`,
        titulo: `Tenés ${conArticulo(d.tipoEvento)} ${d.restante ?? 'próximamente'}`,
        parrafo: `Te escribimos para recordarte ${conArticulo(d.tipoEvento)} a tu cargo o en la que participás. El detalle, la ubicación y el expediente están en SistemaLegal.`,
        datos: [
          ['Tipo', mayuscula(nombre)],
          ['Cuándo', fechaHora],
          ...(d.restante ? ([['Falta', d.restante]] as [string, string][]) : []),
        ],
        boton: 'Ver en la agenda',
      };
    }
    case 'PLAZO_PROXIMO':
    case 'PLAZO_CRITICO': {
      const critico = tipo === 'PLAZO_CRITICO';
      return {
        asunto: `${critico ? 'Vencimiento crítico' : 'Vencimiento próximo'}: ${fechaCorta(d.fecha)}`,
        titulo: critico ? 'Un plazo a tu cargo está por vencer' : 'Se acerca un vencimiento a tu cargo',
        parrafo:
          'Un plazo procesal del que sos responsable vence pronto. Revisalo en SistemaLegal, donde está el expediente y la explicación del cómputo.',
        datos: [
          ['Vence', fechaLegible(d.fecha)],
          ...(d.restante ? ([['Falta', d.restante]] as [string, string][]) : []),
        ],
        boton: 'Ver el plazo',
      };
    }
    case 'EVENTO_ASIGNADO':
      return {
        asunto: `Te sumaron a ${conArticulo(d.tipoEvento)}: ${corto}`,
        titulo: `Te sumaron a ${conArticulo(d.tipoEvento)}`,
        parrafo: `Alguien del estudio te asignó ${conArticulo(d.tipoEvento)} o te agregó como participante.`,
        datos: [
          ['Tipo', mayuscula(nombreTipo(d.tipoEvento))],
          ['Cuándo', fechaHora],
        ],
        boton: 'Ver el evento',
      };
    case 'EVENTO_REPROGRAMADO':
      return {
        asunto: `Se reprogramó ${conArticulo(d.tipoEvento)}: ahora ${corto}`,
        titulo: `Cambió la fecha de ${conArticulo(d.tipoEvento)}`,
        parrafo: 'Un evento en el que participás tiene una fecha u hora nueva. Los recordatorios ya se ajustaron.',
        datos: [
          ['Nueva fecha', fechaHora],
          ...(d.fechaAnterior
            ? ([['Fecha anterior', cuando(d.fechaAnterior, d.horaAnterior)]] as [string, string][])
            : []),
        ],
        boton: 'Ver el evento',
      };
    case 'EVENTO_CANCELADO':
      return {
        asunto: `Se canceló ${conArticulo(d.tipoEvento)} del ${fechaCorta(d.fecha)}`,
        titulo: `Se canceló ${conArticulo(d.tipoEvento)}`,
        parrafo: 'Un evento en el que participabas se canceló. Ya no vas a recibir recordatorios sobre él.',
        datos: [['Era', fechaHora]],
        boton: 'Ver el evento',
      };
    case 'PRUEBA':
      return {
        asunto: 'Correo de prueba de SistemaLegal',
        titulo: 'El correo del estudio funciona',
        parrafo:
          'Este es un correo de prueba enviado desde la administración de notificaciones. Si lo recibiste, la configuración del proveedor y del remitente es correcta.',
        datos: [],
        boton: 'Abrir SistemaLegal',
      };
  }
}

const PIE =
  'Correo automático de SistemaLegal: no respondas a este mensaje. Este aviso es una ayuda y no certifica ningún vencimiento ni reemplaza la revisión profesional del calendario procesal. Podés elegir qué avisos recibir en Mi cuenta → Notificaciones.';

export function armarCorreo(tipo: TipoPlantilla, datos: DatosCorreo): CorreoArmado {
  const c = contenido(tipo, datos);
  const filas = c.datos
    .map(
      ([etiqueta, valor]) => `
          <tr>
            <td style="padding:6px 0;color:#5d6d82;font-size:13px;width:110px;vertical-align:top;">${escapar(etiqueta)}</td>
            <td style="padding:6px 0;color:#1b2936;font-size:14px;font-weight:600;">${escapar(valor)}</td>
          </tr>`,
    )
    .join('');

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapar(c.asunto)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f7f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7f9;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;">
          <tr>
            <td style="padding:20px 28px;border-bottom:1px solid #e2e8f0;">
              <span style="font-size:15px;font-weight:700;color:#142b3b;letter-spacing:-0.01em;">SistemaLegal</span>
              <span style="display:inline-block;width:6px;height:6px;margin-left:6px;border-radius:50%;background:#c09a61;vertical-align:middle;"></span>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 28px 8px;">
              <p style="margin:0 0 6px;font-size:14px;color:#5d6d82;">Hola, ${escapar(datos.destinatario)}:</p>
              <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#1b2936;font-weight:700;">${escapar(c.titulo)}</h1>
              <p style="margin:0 0 18px;font-size:14px;line-height:1.55;color:#334155;">${escapar(c.parrafo)}</p>
              ${
                filas
                  ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eef2f6;border-bottom:1px solid #eef2f6;margin:0 0 22px;">${filas}
              </table>`
                  : ''
              }
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                <tr>
                  <td style="border-radius:8px;background:#256a78;">
                    <a href="${escapar(datos.enlace)}" style="display:inline-block;padding:11px 20px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${escapar(c.boton)}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 22px;border-top:1px solid #eef2f6;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#5d6d82;">${escapar(PIE)}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const texto = [
    `Hola, ${datos.destinatario}:`,
    '',
    c.titulo,
    '',
    c.parrafo,
    '',
    ...c.datos.map(([etiqueta, valor]) => `${etiqueta}: ${valor}`),
    ...(c.datos.length ? [''] : []),
    `${c.boton}: ${datos.enlace}`,
    '',
    '—',
    PIE,
  ].join('\n');

  return { asunto: c.asunto, html, texto };
}

/** Datos de ejemplo para previsualizar una plantilla sin tocar información real. */
export function datosDeEjemplo(tipo: TipoPlantilla, urlBase: string): DatosCorreo {
  const base: DatosCorreo = { destinatario: 'Laura', enlace: `${urlBase}/agenda` };
  switch (tipo) {
    case 'RECORDATORIO_AUDIENCIA':
      return { ...base, tipoEvento: 'AUDIENCIA', fecha: '2026-12-03', hora: '09:30', restante: 'mañana, en 24 horas' };
    case 'RECORDATORIO_MEDIACION':
      return { ...base, tipoEvento: 'MEDIACION', fecha: '2026-12-04', hora: '11:00', restante: 'en 1 hora' };
    case 'RECORDATORIO_REUNION':
      return { ...base, tipoEvento: 'REUNION', fecha: '2026-12-02', hora: '17:00', restante: 'en 24 horas' };
    case 'RECORDATORIO_OTRO':
      return { ...base, tipoEvento: 'OTRO', fecha: '2026-12-07', hora: null, restante: 'en 24 horas' };
    case 'PLAZO_PROXIMO':
      return { ...base, fecha: '2026-12-09', restante: '5 días hábiles', enlace: `${urlBase}/plazos` };
    case 'PLAZO_CRITICO':
      return { ...base, fecha: '2026-12-02', restante: '1 día hábil', enlace: `${urlBase}/plazos` };
    case 'EVENTO_ASIGNADO':
      return { ...base, tipoEvento: 'AUDIENCIA', fecha: '2026-12-10', hora: '10:00' };
    case 'EVENTO_REPROGRAMADO':
      return {
        ...base,
        tipoEvento: 'MEDIACION',
        fecha: '2026-12-15',
        hora: '12:00',
        fechaAnterior: '2026-12-11',
        horaAnterior: '10:30',
      };
    case 'EVENTO_CANCELADO':
      return { ...base, tipoEvento: 'REUNION', fecha: '2026-12-05', hora: '16:00' };
    case 'PRUEBA':
      return { ...base, enlace: urlBase };
  }
}
