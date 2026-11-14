/**
 * Evaluación de alertas de vencimiento. Funciones puras: no tocan la base.
 *
 * Las reglas (`regla_alerta`) dicen "avisá con nivel X cuando falten N días
 * hábiles". La anticipación se cuenta en hábiles, igual que el plazo: a un
 * abogado no le sirve que le avisen "faltan 3 días" un viernes si dos de esos
 * días son el fin de semana.
 */

export type Nivel = 'CRITICA' | 'IMPORTANTE' | 'INFORMATIVA';

export interface Regla {
  id: string;
  tipo_plazo_id: string | null;
  dias_anticipacion: number;
  nivel: Nivel;
}

const GRAVEDAD: Record<Nivel, number> = { CRITICA: 0, IMPORTANTE: 1, INFORMATIVA: 2 };

/** Suma días a una fecha `YYYY-MM-DD` sin pasar por la zona horaria local. */
export function sumarDias(fecha: string, dias: number): string {
  const [anio, mes, dia] = fecha.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(anio, mes - 1, dia + dias)).toISOString().slice(0, 10);
}

function esFinDeSemana(fecha: string): boolean {
  const [anio, mes, dia] = fecha.split('-').map(Number) as [number, number, number];
  const diaSemana = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();
  return diaSemana === 0 || diaSemana === 6;
}

/**
 * Días hábiles que quedan entre hoy (excluido) y el vencimiento (incluido).
 *
 * 0 = vence hoy. Negativo = ya venció; en ese caso se devuelven días corridos
 * con signo, porque lo único que importa de un vencido es que lo está.
 */
export function habilesRestantes(hoy: string, vencimiento: string, inhabiles: ReadonlySet<string>): number {
  if (vencimiento < hoy) {
    const [a1, m1, d1] = hoy.split('-').map(Number) as [number, number, number];
    const [a2, m2, d2] = vencimiento.split('-').map(Number) as [number, number, number];
    return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000);
  }

  let cuenta = 0;
  let fecha = hoy;
  // Tope de seguridad: más de dos años de anticipación no le interesa a ninguna regla.
  for (let i = 0; i < 800 && fecha < vencimiento; i += 1) {
    fecha = sumarDias(fecha, 1);
    if (!esFinDeSemana(fecha) && !inhabiles.has(fecha)) cuenta += 1;
  }
  return cuenta;
}

/**
 * Reglas aplicables a un plazo.
 *
 * Si el estudio definió reglas para ese tipo de plazo, reemplazan a las
 * generales; si no, valen las generales (las de `tipo_plazo_id` nulo).
 */
export function reglasDe(tipoPlazoId: string | null, reglas: readonly Regla[]): Regla[] {
  const propias = tipoPlazoId ? reglas.filter((r) => r.tipo_plazo_id === tipoPlazoId) : [];
  return propias.length > 0 ? propias : reglas.filter((r) => r.tipo_plazo_id === null);
}

/** Reglas que ya se dispararon, de la más grave a la más leve. */
export function reglasDisparadas(habiles: number, reglas: readonly Regla[]): Regla[] {
  return reglas
    .filter((regla) => habiles <= regla.dias_anticipacion)
    .sort((a, b) => GRAVEDAD[a.nivel] - GRAVEDAD[b.nivel] || a.dias_anticipacion - b.dias_anticipacion);
}

/**
 * Nivel vigente de un plazo: el de la regla más grave que ya se disparó.
 * Un plazo vencido y abierto es siempre crítico, haya o no reglas.
 */
export function nivelVigente(habiles: number, reglas: readonly Regla[]): Nivel | undefined {
  if (habiles < 0) return 'CRITICA';
  return reglasDisparadas(habiles, reglas)[0]?.nivel;
}

export function mensajeAlerta(descripcion: string, caratula: string, habiles: number): string {
  const cuando =
    habiles < 0
      ? `venció hace ${Math.abs(habiles)} ${Math.abs(habiles) === 1 ? 'día' : 'días'}`
      : habiles === 0
        ? 'vence hoy'
        : `vence en ${habiles} ${habiles === 1 ? 'día hábil' : 'días hábiles'}`;
  return `«${descripcion}» ${cuando} — ${caratula}`.slice(0, 500);
}
