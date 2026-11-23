import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Pruebas del cliente de la API (servicios/api.ts).
 *
 * Es la pieza del frontend donde un error se paga caro: si la renovación de la
 * sesión falla o se dispara dos veces, el backend detecta la reutilización del
 * refresh token y corta todas las sesiones del usuario.
 *
 * El módulo guarda estado (el access token, la renovación en curso), así que
 * cada prueba lo importa de nuevo.
 */

type ModuloApi = typeof import('./api');

function respuesta(estado: number, cuerpo?: unknown): Response {
  return new Response(cuerpo === undefined ? null : JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json' },
  });
}

const SESION = {
  accessToken: 'token-nuevo',
  expiraEnMinutos: 15,
  usuario: { id: 'u1', email: 'a@b.test', nombre: 'A', apellido: 'B', rol: 'ADMIN', permisos: [] },
};

let fetchFalso: ReturnType<typeof vi.fn>;
let modulo: ModuloApi;

beforeEach(async () => {
  vi.resetModules();
  fetchFalso = vi.fn();
  vi.stubGlobal('fetch', fetchFalso);
  modulo = await import('./api');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Cabecera Authorization de la llamada número `n` a fetch. */
function autorizacionDe(n: number): string | undefined {
  const init = fetchFalso.mock.calls[n]?.[1] as RequestInit | undefined;
  return (init?.headers as Record<string, string> | undefined)?.Authorization;
}

describe('cliente de la API', () => {
  it('manda el access token en la cabecera Authorization y la cookie con credentials', async () => {
    modulo.guardarAccessToken('token-viejo');
    fetchFalso.mockResolvedValueOnce(respuesta(200, { ok: true }));

    await modulo.api.obtener('/api/causas');

    expect(autorizacionDe(0)).toBe('Bearer token-viejo');
    expect((fetchFalso.mock.calls[0]?.[1] as RequestInit).credentials).toBe('include');
  });

  it('ante un 401 renueva la sesión una vez y reintenta con el token nuevo', async () => {
    modulo.guardarAccessToken('token-viejo');
    fetchFalso
      .mockResolvedValueOnce(respuesta(401, { error: 'expiró' }))
      .mockResolvedValueOnce(respuesta(200, SESION))
      .mockResolvedValueOnce(respuesta(200, { datos: [1] }));

    const resultado = await modulo.api.obtener<{ datos: number[] }>('/api/causas');

    expect(resultado.datos).toEqual([1]);
    expect(String(fetchFalso.mock.calls[1]?.[0])).toContain('/api/auth/refrescar');
    expect(autorizacionDe(2)).toBe('Bearer token-nuevo');
  });

  it('varios 401 simultáneos comparten un solo refresco', async () => {
    modulo.guardarAccessToken('token-viejo');
    fetchFalso.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/auth/refrescar')) return respuesta(200, SESION);
      const auth = (init?.headers as Record<string, string>).Authorization;
      return auth === 'Bearer token-nuevo' ? respuesta(200, { ok: true }) : respuesta(401, {});
    });

    await Promise.all([
      modulo.api.obtener('/api/a'),
      modulo.api.obtener('/api/b'),
      modulo.api.obtener('/api/c'),
    ]);

    const refrescos = fetchFalso.mock.calls.filter(([url]) => String(url).endsWith('/api/auth/refrescar'));
    expect(refrescos).toHaveLength(1);
  });

  it('si la renovación falla, avisa que se perdió la sesión y devuelve el 401', async () => {
    const alPerder = vi.fn();
    modulo.alCaerLaSesion(alPerder);
    modulo.guardarAccessToken('token-viejo');
    fetchFalso
      .mockResolvedValueOnce(respuesta(401, { error: 'Tu sesión expiró.', codigo: 'NO_AUTENTICADO' }))
      .mockResolvedValueOnce(respuesta(401, {}));

    const error = await modulo.api.obtener('/api/causas').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(modulo.ErrorApi);
    expect((error as InstanceType<ModuloApi['ErrorApi']>).esDeSesion).toBe(true);
    expect(alPerder).toHaveBeenCalledOnce();
    expect(modulo.hayAccessToken()).toBe(false);
  });

  it('el login no intenta renovar la sesión ante credenciales inválidas', async () => {
    fetchFalso.mockResolvedValueOnce(respuesta(401, { error: 'El correo o la contraseña no son correctos.' }));

    await expect(modulo.api.sesion.login('a@b.test', 'x')).rejects.toThrow('no son correctos');
    expect(fetchFalso).toHaveBeenCalledOnce();
  });

  it('convierte el error del backend en ErrorApi con código y errores por campo', async () => {
    fetchFalso.mockResolvedValueOnce(
      respuesta(400, {
        error: 'Revisá los datos del formulario.',
        codigo: 'SOLICITUD_INVALIDA',
        detalles: { caratula: ['Indicá la carátula.'] },
      }),
    );

    const error = (await modulo.api.enviar('/api/causas', {}).catch((e: unknown) => e)) as InstanceType<
      ModuloApi['ErrorApi']
    >;

    expect(error.estado).toBe(400);
    expect(error.codigo).toBe('SOLICITUD_INVALIDA');
    expect(error.detalles).toEqual({ caratula: ['Indicá la carátula.'] });
  });

  it('informa sin conexión cuando fetch no llega al servidor', async () => {
    fetchFalso.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const error = (await modulo.api.obtener('/api/causas').catch((e: unknown) => e)) as InstanceType<
      ModuloApi['ErrorApi']
    >;
    expect(error.codigo).toBe('SIN_CONEXION');
  });
});

describe('consulta()', () => {
  it('omite los filtros vacíos y codifica los valores', () => {
    expect(modulo.consulta({ q: 'pérez & cía', pagina: 2, causa: '', estado: undefined, x: null })).toBe(
      '?q=p%C3%A9rez+%26+c%C3%ADa&pagina=2',
    );
    expect(modulo.consulta({})).toBe('');
  });
});
