import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes, useParams } from 'react-router-dom';
import App from './App';
import Panel from './admin/Panel';
import { useFormatoTextoGlobal } from './hooks/useFormatoTextoGlobal';
import Entrar from './publico/Entrar';
import Registro from './publico/Registro';
import { ubicacionDeTaller } from './taller/contexto';
import TallerApp from './taller/TallerApp';
import './index.css';

/** Taller por ruta (/t/<taller>/...), usado por el sitio de pruebas. */
function TallerPorRuta() {
  const { slug } = useParams();
  return <TallerApp ubicacion={{ slug: slug ?? '', base: `/t/${slug ?? ''}` }} />;
}

// Si la dirección es <taller>.<dominio>, la raíz es la aplicación de ese taller.
const porDireccion = ubicacionDeTaller('/', window.location.hostname);

function Raiz() {
  useFormatoTextoGlobal(); // estándar §5: mayúsculas y sin tildes en todo texto libre
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/admin/*" element={<Panel />} />
        <Route path="/registro" element={<Registro />} />
        <Route path="/entrar" element={<Entrar />} />
        <Route path="/t/:slug/*" element={<TallerPorRuta />} />
        <Route path="*" element={porDireccion ? <TallerApp ubicacion={porDireccion} /> : <App />} />
      </Routes>
    </BrowserRouter>
  );
}

const raiz = document.getElementById('raiz');
if (!raiz) throw new Error('No se encontró el elemento raíz');
createRoot(raiz).render(
  <StrictMode>
    <Raiz />
  </StrictMode>
);
