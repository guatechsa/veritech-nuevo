import { Autenticador, Candado } from './bloqueo';
import { SolicitudDeMaterial } from './dia';
import { itemsDeDespacho, maximoADespachar, mejorBodega, problemasDeDespacho, proponerDespacho } from './despacho';
import { agregarAlCarrito, aLineasDeSolicitud, buscarMateriales, cambiarCantidad, MaterialDelCatalogo, problemasDeSolicitud } from './materiales';
import { RelojFalso } from './pruebas/falsos';

const catalogo: MaterialDelCatalogo[] = [
  { id: 1, codigo: 'ACE-15W40', nombre: 'ACEITE MOTOR 15W40', unidad: 'LT' },
  { id: 2, codigo: 'FIL-ACE', nombre: 'FILTRO DE ACEITE', unidad: 'UN' },
  { id: 3, codigo: 'BAT-12V', nombre: 'BATERÍA 12 VOLTIOS', unidad: 'UN' },
];

describe('pedir material', () => {
  it('se busca por código o nombre, sin importar mayúsculas ni tildes, y cada palabra debe estar', () => {
    expect(buscarMateriales(catalogo, 'aceite').map((m) => m.id)).toEqual([1, 2]);
    expect(buscarMateriales(catalogo, 'filtro aceite').map((m) => m.id)).toEqual([2]);
    expect(buscarMateriales(catalogo, 'bateria').map((m) => m.id)).toEqual([3]);
    expect(buscarMateriales(catalogo, 'ace-15').map((m) => m.id)).toEqual([1]);
    expect(buscarMateriales(catalogo, 'zzz')).toEqual([]);
    expect(buscarMateriales(catalogo, '  ', 2).map((m) => m.id)).toEqual([1, 2]); // sin texto: los primeros, con tope
  });

  it('el carrito suma lo repetido, quita al llegar a cero y solo acepta enteros', () => {
    let c = agregarAlCarrito([], catalogo[0]!, 2);
    c = agregarAlCarrito(c, catalogo[0]!, 3);
    c = agregarAlCarrito(c, catalogo[1]!);
    expect(c.map((l) => [l.material_id, l.cantidad])).toEqual([[1, 5], [2, 1]]);
    expect(agregarAlCarrito(c, catalogo[2]!, 1.5)).toBe(c); // medio no existe: otra unidad
    expect(agregarAlCarrito(c, catalogo[2]!, 0)).toBe(c);
    expect(agregarAlCarrito(c, catalogo[2]!, -2)).toBe(c);
    expect(cambiarCantidad(c, 1, 2.5)).toBe(c);
    expect(cambiarCantidad(c, 1, 7).find((l) => l.material_id === 1)!.cantidad).toBe(7);
    expect(cambiarCantidad(c, 1, 0).map((l) => l.material_id)).toEqual([2]);
    expect(aLineasDeSolicitud(c)).toEqual([{ material_id: 1, cantidad: 5 }, { material_id: 2, cantidad: 1 }]); // al servidor solo va lo necesario
  });

  it('no se envía vacía ni con más de 50 materiales', () => {
    expect(problemasDeSolicitud([])).toEqual(['Agregue al menos un material.']);
    const muchos = Array.from({ length: 51 }, (_, i) => ({ material_id: i + 1, codigo: `M${i}`, nombre: 'X', unidad: 'UN', cantidad: 1 }));
    expect(problemasDeSolicitud(muchos)[0]).toContain('hasta 50');
    expect(problemasDeSolicitud(muchos.slice(0, 3))).toEqual([]);
  });
});

const solicitud = (): SolicitudDeMaterial => ({
  id: 60, numero: 'SOL-000060', orden_id: 5, orden: 'REP-000005', sucursal: 'CENTRAL', solicitante: 'ANA', estado: 'no_despachada',
  lineas: [
    { id: 70, material_id: 1, codigo: 'ACE-1', nombre: 'ACEITE', unidad: 'LT', cantidad_solicitada: 4, cantidad_despachada: 0, pendiente: 4, por_bodega: [{ bodega_id: 1, bodega: 'PRINCIPAL', cantidad: 2 }, { bodega_id: 2, bodega: 'REPUESTOS', cantidad: 9 }] },
    { id: 71, material_id: 2, codigo: 'FIL-1', nombre: 'FILTRO', unidad: 'UN', cantidad_solicitada: 2, cantidad_despachada: 2, pendiente: 0, por_bodega: [{ bodega_id: 1, bodega: 'PRINCIPAL', cantidad: 5 }] },
    { id: 72, material_id: 3, codigo: 'BAT-1', nombre: 'BATERIA', unidad: 'UN', cantidad_solicitada: 1, cantidad_despachada: 0, pendiente: 1, por_bodega: [{ bodega_id: 1, bodega: 'PRINCIPAL', cantidad: 0 }] },
  ],
});

describe('despachar', () => {
  it('propone la bodega que más tiene y lo más que se puede; lo ya despachado o sin existencia no se propone', () => {
    const s = solicitud();
    expect(mejorBodega(s.lineas[0]!)).toBe(2);
    expect(mejorBodega(s.lineas[2]!)).toBeNull();
    expect(proponerDespacho(s)).toEqual({ 70: { bodega_id: 2, cantidad: 4 } });
    expect(maximoADespachar(s.lineas[0]!, 1)).toBe(2); // la bodega 1 solo tiene 2 aunque falten 4
    expect(maximoADespachar(s.lineas[1]!, 1)).toBe(0); // ya está completo
  });

  it('se revisa antes de enviar: no más de lo que falta, no más de lo que hay, solo enteros, algo elegido', () => {
    const s = solicitud();
    expect(problemasDeDespacho(s, {})).toEqual(['Elija qué despachar.']);
    expect(problemasDeDespacho(s, { 70: { bodega_id: 2, cantidad: 4 } })).toEqual([]);
    expect(problemasDeDespacho(s, { 70: { bodega_id: 2, cantidad: 5 } })[0]).toContain('solo faltan 4');
    expect(problemasDeDespacho(s, { 70: { bodega_id: 1, cantidad: 3 } })[0]).toContain('solo tiene 2');
    expect(problemasDeDespacho(s, { 70: { bodega_id: 2, cantidad: 1.5 } })[0]).toContain('entero');
    expect(problemasDeDespacho(s, { 70: { bodega_id: 2, cantidad: 0 } })[0]).toContain('entero');
    expect(problemasDeDespacho({ ...s, estado: 'anulada' }, { 70: { bodega_id: 2, cantidad: 1 } })).toEqual(['La solicitud está anulada.']);
    expect(problemasDeDespacho({ ...s, estado: 'despachada' }, {})).toEqual(['La solicitud ya se despachó completa.']);
  });

  it('manda al servidor exactamente lo elegido (una línea puede salir de otra bodega que otra)', () => {
    const s = solicitud();
    expect(itemsDeDespacho(s, { 70: { bodega_id: 1, cantidad: 2 }, 72: { bodega_id: 1, cantidad: 1 } })).toEqual([
      { linea_id: 70, bodega_id: 1, cantidad: 2 },
      { linea_id: 72, bodega_id: 1, cantidad: 1 },
    ]);
  });
});

class AutenticadorFalso implements Autenticador {
  tieneBloqueo = true;
  acepta = true;
  pedidos: string[] = [];
  async disponible(): Promise<boolean> {
    return this.tieneBloqueo;
  }
  async pedir(motivo: string): Promise<boolean> {
    this.pedidos.push(motivo);
    return this.acepta;
  }
}

describe('el candado de la app (huella o PIN del teléfono)', () => {
  const montar = (activo = true) => {
    const aut = new AutenticadorFalso();
    const reloj = new RelojFalso();
    const candado = new Candado({ autenticador: aut, reloj, activo });
    return { aut, reloj, candado };
  };

  it('al abrir la app de cero queda bloqueada; se desbloquea con la huella o el PIN y si se cancela sigue bloqueada', async () => {
    const { aut, candado } = montar();
    await candado.iniciar();
    expect(candado.bloqueado).toBe(true);
    aut.acepta = false;
    expect(await candado.desbloquear()).toBe(false);
    expect(candado.bloqueado).toBe(true);
    aut.acepta = true;
    expect(await candado.desbloquear()).toBe(true);
    expect(candado.bloqueado).toBe(false);
  });

  it('al volver de otra app: antes de 5 minutos no pide nada; pasados los 5 minutos, sí', async () => {
    const { reloj, candado } = montar();
    await candado.iniciar();
    await candado.desbloquear();
    candado.alSegundoPlano();
    reloj.avanzar(4 * 60000 + 59000);
    await candado.alVolver();
    expect(candado.bloqueado).toBe(false);
    candado.alSegundoPlano();
    reloj.avanzar(5 * 60000);
    await candado.alVolver();
    expect(candado.bloqueado).toBe(true);
  });

  it('el reloj corre desde la PRIMERA salida: avisos repetidos de «segundo plano» no lo reinician', async () => {
    const { reloj, candado } = montar();
    await candado.iniciar();
    await candado.desbloquear();
    candado.alSegundoPlano();
    reloj.avanzar(3 * 60000);
    candado.alSegundoPlano(); // el sistema avisa otra vez
    reloj.avanzar(3 * 60000);
    await candado.alVolver();
    expect(candado.bloqueado).toBe(true);
  });

  it('si el teléfono no tiene bloqueo de pantalla NO se deja a nadie afuera: se avisa y se sigue', async () => {
    const { aut, reloj, candado } = montar();
    aut.tieneBloqueo = false;
    await candado.iniciar();
    expect(candado.bloqueado).toBe(false);
    expect(candado.sinProteccion).toBe(true);
    candado.alSegundoPlano();
    reloj.avanzar(60 * 60000);
    await candado.alVolver();
    expect(candado.bloqueado).toBe(false);
  });

  it('apagado, nunca bloquea; activarlo exige confirmar con la huella/PIN y no se activa sin bloqueo de pantalla', async () => {
    const { aut, reloj, candado } = montar(false);
    await candado.iniciar();
    candado.alSegundoPlano();
    reloj.avanzar(60 * 60000);
    await candado.alVolver();
    expect(candado.bloqueado).toBe(false);
    aut.acepta = false;
    expect(await candado.cambiarActivo(true)).toBe(false); // no confirmó: no se activa
    expect(candado.activo).toBe(false);
    aut.acepta = true;
    expect(await candado.cambiarActivo(true)).toBe(true);
    expect(candado.activo).toBe(true);
    aut.tieneBloqueo = false;
    expect(await candado.cambiarActivo(true)).toBe(false);
    expect(candado.activo).toBe(false);
    expect(candado.sinProteccion).toBe(true);
  });

  it('apagarlo desbloquea y se puede apagar sin pedir nada', async () => {
    const { aut, candado } = montar();
    await candado.iniciar();
    expect(candado.bloqueado).toBe(true);
    aut.pedidos = [];
    expect(await candado.cambiarActivo(false)).toBe(true);
    expect(candado.bloqueado).toBe(false);
    expect(aut.pedidos).toEqual([]);
  });
});
