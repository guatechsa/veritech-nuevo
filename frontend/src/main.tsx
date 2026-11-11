import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import App from './App';
import Panel from './admin/Panel';
import { useFormatoTextoGlobal } from './hooks/useFormatoTextoGlobal';
import './index.css';

function Raiz() {
  useFormatoTextoGlobal(); // estándar §5: mayúsculas y sin tildes en todo texto libre
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/admin/*" element={<Panel />} />
        <Route path="*" element={<App />} />
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
