import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './index.css';
import './App.css';
import { App } from './App';
import { StormIndexPage } from './pages/StormIndexPage';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/storm-index" element={<StormIndexPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
