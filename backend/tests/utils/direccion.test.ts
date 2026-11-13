import { urlBaseDeEmpresa } from '../../src/utils/direccion';

describe('la dirección de un taller', () => {
  const empresa = { slug: 'enova', subdominio: 'enova.veritech.lat' };
  it('con dirección única, cuelga del sitio (app.veritech.lat/t/<taller>)', () => {
    expect(urlBaseDeEmpresa({ TALLER_POR_ENCABEZADO: true, URL_PANEL: 'https://app.veritech.lat/admin' }, empresa)).toBe('https://app.veritech.lat/t/enova');
  });
  it('sin ella, es el subdominio propio del taller', () => {
    expect(urlBaseDeEmpresa({ TALLER_POR_ENCABEZADO: false, URL_PANEL: 'https://app.veritech.lat/admin' }, empresa)).toBe('https://enova.veritech.lat');
  });
});
