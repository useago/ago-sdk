import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AgoProvider } from '@useago/sdk/react';
import App from './App';
import './App.css';

// The provider builds and shares one AgoClient. It defaults to the AGO
// playground backend; point VITE_AGO_BASE_URL elsewhere (e.g. https://YOUR-DOMAIN.api.useago.com)
// to use your own agents. The default clientFunctionsMode ("pause") makes the
// agent stop on client function calls and resume the SAME turn once their
// results are in — "va sur la page parfums et montre les parfums sans lactose"
// pauses on the navigation, waits for the destination page, then finishes with
// real results (the agent needs reasoning_iterations >= 2 for navigate-then-fill
// chains).
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AgoProvider
      baseUrl={import.meta.env.VITE_AGO_BASE_URL ?? 'https://playground.api.useago.com'}
      defaultAgentId="glacier"
      // ?dev mounts the dev panel (see App.tsx) and turns on the SDK logger,
      // so warnings like the function result-size guard show in the console.
      debug={new URLSearchParams(window.location.search).has('dev')}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AgoProvider>
  </React.StrictMode>,
);
