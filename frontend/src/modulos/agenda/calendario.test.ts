import { describe, expect, it } from 'vitest';
import type { ItemAgenda } from '../../tipos/api';
import {
  diaSemana,
  disponerDia,
  etiquetaPeriodo,
  navegar,
  ocupaDia,
  rangoVista,
  semanasDelMes,
  sumarMeses,
  textoAnticipacion,
} from './calendario';

function item(inicio: string, fin: string, extra: Partial<ItemAgenda> = {}): ItemAgenda {
  return {
    clave: `EVENTO:${inicio}`,
    origen: 'EVENTO',
    id: inicio,
    tipo: 'REUNION',
    titulo: 'Reunión',
    inicio,
    fin,
    todo_el_dia: inicio.length === 10,
    estado: 'PENDIENTE',
    prioridad: 'MEDIA',
    responsable_id: null,
    responsable: null,
    causa_id: null,
    caratula: null,
    numero_expediente: null,
    lugar: null,
    nivel: null,
    ruta: '',
    editable: true,
    ...extra,
  };
}

describe('calendario', () => {
  it('la semana empieza el lunes', () => {
    expect(diaSemana('2026-11-23')).toBe(0); // lunes
    expect(diaSemana('2026-11-29')).toBe(6); // domingo
  });

  it('el mes se dibuja en semanas completas de lunes a domingo', () => {
    const semanas = semanasDelMes('2026-11-15');
    expect(semanas[0]![0]).toBe('2026-10-26');
    expect(semanas.at(-1)![6]).toBe('2026-12-06');
    expect(semanas.every((s) => s.length === 7)).toBe(true);
    expect(rangoVista('mes', '2026-11-15')).toEqual({ desde: '2026-10-26', hasta: '2026-12-06' });
  });

  it('navega sin saltar meses cortos', () => {
    expect(sumarMeses('2026-01-31', 1)).toBe('2026-02-28');
    expect(navegar('mes', '2026-11-27', 1)).toBe('2026-12-01');
    expect(navegar('semana', '2026-11-27', -1)).toBe('2026-11-20');
    expect(navegar('dia', '2026-12-31', 1)).toBe('2027-01-01');
  });

  it('rotula el período', () => {
    expect(etiquetaPeriodo('mes', '2026-11-27')).toMatch(/^Noviembre/);
    expect(rangoVista('semana', '2026-11-27')).toEqual({ desde: '2026-11-23', hasta: '2026-11-29' });
  });

  it('un evento que termina a las 00:00 no ocupa el día siguiente', () => {
    const tarde = item('2026-11-27T23:00', '2026-11-28T00:00');
    expect(ocupaDia(tarde, '2026-11-27')).toBe(true);
    expect(ocupaDia(tarde, '2026-11-28')).toBe(false);
    const variosDias = item('2026-11-27', '2026-11-29');
    expect(ocupaDia(variosDias, '2026-11-28')).toBe(true);
  });

  it('reparte en columnas solo lo que se superpone', () => {
    const bloques = disponerDia(
      [
        item('2026-11-27T09:00', '2026-11-27T10:00', { id: 'a' }),
        item('2026-11-27T09:30', '2026-11-27T11:00', { id: 'b' }),
        item('2026-11-27T15:00', '2026-11-27T16:00', { id: 'c' }),
      ],
      '2026-11-27',
    );
    const porId = Object.fromEntries(bloques.map((b) => [b.item.id, b]));
    expect(porId.a).toMatchObject({ columna: 0, columnas: 2, desde: 540, hasta: 600 });
    expect(porId.b).toMatchObject({ columna: 1, columnas: 2 });
    // El de la tarde no choca con nadie: ocupa todo el ancho.
    expect(porId.c).toMatchObject({ columna: 0, columnas: 1 });
  });

  it('describe la anticipación de un recordatorio', () => {
    expect(textoAnticipacion(1440)).toBe('1 día antes');
    expect(textoAnticipacion(60)).toBe('1 h antes');
    expect(textoAnticipacion(10080)).toBe('1 semana antes');
    expect(textoAnticipacion(15)).toBe('15 min antes');
  });
});
