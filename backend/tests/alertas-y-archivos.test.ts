import { describe, expect, it } from 'vitest';
import {
  habilesRestantes,
  nivelVigente,
  reglasDe,
  reglasDisparadas,
  type Regla,
} from '../src/modulos/alertas/evaluacion';
import { detectarTipo } from '../src/modulos/documentos/tipos-archivo';

/** Pruebas unitarias: no necesitan base. */

const GENERALES: Regla[] = [
  { id: 'g5', tipo_plazo_id: null, dias_anticipacion: 5, nivel: 'INFORMATIVA' },
  { id: 'g3', tipo_plazo_id: null, dias_anticipacion: 3, nivel: 'IMPORTANTE' },
  { id: 'g1', tipo_plazo_id: null, dias_anticipacion: 1, nivel: 'CRITICA' },
];

describe('días hábiles restantes', () => {
  it('cuenta solo hábiles, sin el día de hoy y con el del vencimiento', () => {
    // Jueves 12/11/2026 → lunes 16/11: viernes y lunes = 2 hábiles.
    expect(habilesRestantes('2026-11-12', '2026-11-16', new Set())).toBe(2);
  });

  it('descuenta los inhábiles del calendario', () => {
    expect(habilesRestantes('2026-11-12', '2026-11-16', new Set(['2026-11-13']))).toBe(1);
  });

  it('vale 0 si vence hoy y es negativo si ya venció', () => {
    expect(habilesRestantes('2026-11-12', '2026-11-12', new Set())).toBe(0);
    expect(habilesRestantes('2026-11-12', '2026-11-10', new Set())).toBe(-2);
  });
});

describe('nivel de alerta', () => {
  it('toma la regla más grave que ya se disparó', () => {
    expect(nivelVigente(6, GENERALES)).toBeUndefined();
    expect(nivelVigente(5, GENERALES)).toBe('INFORMATIVA');
    expect(nivelVigente(3, GENERALES)).toBe('IMPORTANTE');
    expect(nivelVigente(0, GENERALES)).toBe('CRITICA');
  });

  it('un vencido abierto es crítico aunque no haya reglas', () => {
    expect(nivelVigente(-1, [])).toBe('CRITICA');
  });

  it('las reglas de un tipo de plazo reemplazan a las generales', () => {
    const propia: Regla = { id: 't10', tipo_plazo_id: 'tipo', dias_anticipacion: 10, nivel: 'IMPORTANTE' };
    expect(reglasDe('tipo', [...GENERALES, propia])).toEqual([propia]);
    expect(reglasDe('otro', [...GENERALES, propia])).toEqual(GENERALES);
  });

  it('ordena las disparadas de la más grave a la más leve', () => {
    expect(reglasDisparadas(1, GENERALES).map((r) => r.nivel)).toEqual(['CRITICA', 'IMPORTANTE', 'INFORMATIVA']);
  });
});

describe('tipo de archivo por contenido', () => {
  it('reconoce un PDF por su firma y no por el nombre', () => {
    expect(detectarTipo(Buffer.from('%PDF-1.7\n...'), 'escrito.txt')?.extension).toBe('pdf');
  });

  it('rechaza un ejecutable renombrado a .pdf', () => {
    expect(detectarTipo(Buffer.from([0x4d, 0x5a, 0x90, 0x00]), 'demanda.pdf')).toBeUndefined();
  });

  it('acepta un .docx (ZIP) solo con su extensión', () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    expect(detectarTipo(zip, 'escrito.docx')?.extension).toBe('docx');
    expect(detectarTipo(zip, 'paquete.zip')).toBeUndefined();
  });

  it('acepta texto UTF-8 y rechaza binario con extensión de texto', () => {
    expect(detectarTipo(Buffer.from('Notificación de traslado', 'utf8'), 'nota.txt')?.extension).toBe('txt');
    expect(detectarTipo(Buffer.from([0x00, 0x01, 0x02]), 'nota.txt')).toBeUndefined();
  });
});
