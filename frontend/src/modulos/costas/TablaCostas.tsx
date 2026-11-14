import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Banknote } from 'lucide-react';
import type { Costa } from '../../tipos/api';
import { aCargoLegible } from '../../lib/vocabulario';
import { fecha, importe } from '../../lib/formato';
import { Vacio } from '../../componentes/ui/Estados';
import { DialogoDetalleCosta, EstadoCobro } from './DialogosCostas';

/** Tabla de costas. Cada fila abre el detalle con los cobros. */
export function TablaCostas({ costas, mostrarExpediente = true }: { costas: Costa[]; mostrarExpediente?: boolean }) {
  const [abierta, setAbierta] = useState<string>();

  if (costas.length === 0) {
    return (
      <Vacio
        titulo="Sin costas"
        texto="Las tasas, aportes y gastos del expediente se registran acá para controlar qué falta cobrar."
        icono={<Banknote size={20} aria-hidden />}
      />
    );
  }

  return (
    <>
      <div className="tabla-envoltorio">
        <table className="tabla tabla--clicable">
          <caption className="solo-lectores">Costas. Cada fila abre el detalle con sus cobros.</caption>
          <thead>
            <tr>
              <th scope="col">Concepto</th>
              {mostrarExpediente && <th scope="col">Expediente</th>}
              <th scope="col" className="columna--opcional">
                Devengada
              </th>
              <th scope="col" className="tabla__numero">
                Monto
              </th>
              <th scope="col" className="tabla__numero">
                Saldo
              </th>
              <th scope="col">Estado</th>
            </tr>
          </thead>
          <tbody>
            {costas.map((costa) => (
              <tr
                key={costa.costa_id}
                onClick={() => setAbierta(costa.costa_id)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setAbierta(costa.costa_id)}
                tabIndex={0}
                aria-label={`Abrir ${costa.descripcion ?? costa.concepto}`}
              >
                <td>
                  <div className="tabla__principal">{costa.descripcion ?? costa.concepto}</div>
                  <div className="tabla__secundario">
                    {costa.concepto} · a cargo de {aCargoLegible(costa.a_cargo_de).toLowerCase()}
                  </div>
                </td>
                {mostrarExpediente && (
                  <td>
                    <Link to={`/expedientes/${costa.causa_id}?pestana=costas`} onClick={(e) => e.stopPropagation()}>
                      {costa.caratula}
                    </Link>
                  </td>
                )}
                <td className="columna--opcional">{fecha(costa.fecha_devengamiento)}</td>
                <td className="tabla__numero numero">{importe(costa.monto, costa.moneda)}</td>
                <td className="tabla__numero numero">
                  {costa.estado_cobro === 'INCOBRABLE' ? '—' : importe(costa.saldo_pendiente, costa.moneda)}
                </td>
                <td>
                  <EstadoCobro estado={costa.estado_cobro} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {abierta && <DialogoDetalleCosta costaId={abierta} alCerrar={() => setAbierta(undefined)} />}
    </>
  );
}
