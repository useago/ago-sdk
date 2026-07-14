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
      // Proactive mode: the agent watches friction signals (idle, dwell, rage
      // clicks…) and offers help through a small dismissable nudge (<AgoNudge>
      // in App.tsx). Thresholds are demo-short so each trigger is easy to see.
      proactive={{
        // Demo ONLY: bypasses the remote kill-switch (GET /config → proactive.enabled),
        // which the playground backend doesn't expose yet. Never set in production —
        // leave the tenant admin in control.
        enabledOverride: true,
        frequencyCap: { perSession: 5 },
        // Demo-forgiving rage-click detection: 3 clicks within 2s in a 60px
        // radius (defaults: 1s / 24px). Clicks that change page state or
        // navigate still never count — a working control is not rage.
        signals: { rageClickWindowMs: 2_000, rageClickRadiusPx: 60 },
        triggers: [
          {
            // Browse the flavors page without touching anything for ~10s.
            id: 'parfums-hesitation',
            when: { route: '/parfums', dwellMs: 10_000, idleMs: 8_000 },
            cooldownMs: 60_000,
            intervene: {
              type: 'static',
              message:
                'Vous hésitez ? Les parfums se filtrent par régime : sans lactose, sans gluten, sans fruits à coque.',
              action: {
                label: 'Masquer le lactose',
                setPageState: { dietaryFilter: 'sans-lactose' },
              },
            },
          },
          {
            // Sit on the shop page ~20s without composing anything: ask the
            // backend's fast-LLM second filter whether (and how) to help.
            // Needs a backend with the proactive endpoints — silently stays
            // quiet otherwise (evaluate errors are treated as "don't intervene").
            id: 'composition-au-point-mort',
            when: { route: '/', dwellMs: 20_000, idleMs: 15_000 },
            cooldownMs: 120_000,
            intervene: 'agent',
            goal:
              "Le client est sur la boutique sans avancer : l'aider à composer une glace (proposer un parfum populaire, un contenant) ou à finaliser son panier.",
            kickoff: 'Oui, conseillez-moi !',
          },
          {
            // Click 4+ times in under a second on something inert (a heading,
            // the ice-cream drawing…) to see it instantly.
            id: 'rage-clics',
            when: { rageClicks: 1 },
            cooldownMs: 60_000,
            intervene: {
              type: 'static',
              message:
                'Quelque chose ne répond pas ? Dites-le-moi dans le chat : je peux composer, filtrer et commander à votre place.',
            },
            goal:
              "Le client a cliqué frénétiquement sans effet : comprendre ce qu'il essayait de faire et le faire pour lui.",
            kickoff: 'Quelque chose ne marche pas, aidez-moi.',
          },
        ],
      }}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AgoProvider>
  </React.StrictMode>,
);
