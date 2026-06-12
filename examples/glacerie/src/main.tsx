import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AgoProvider } from '@useago/sdk/react';
import App from './App';
import './App.css';

// The provider builds and shares one AgoClient. It defaults to the public demo
// backend so the example answers out of the box; point VITE_AGO_BASE_URL at your
// own domain (e.g. https://YOUR-DOMAIN.api.useago.com) to use your own agents.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AgoProvider
      baseUrl={import.meta.env.VITE_AGO_BASE_URL ?? 'https://playground.api.useago.com'}
      defaultAgentId="glacerie"
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AgoProvider>
  </React.StrictMode>,
);
