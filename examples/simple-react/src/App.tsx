import {useCallback, useState} from 'react';
import {BrowserRouter, NavLink, Route, Routes, useNavigate} from 'react-router-dom';
import {AgoProvider, ChatWidget, useAgoClient, useAgoFunction, useAgoNavigation,} from '@useago/sdk/react';
import type {CreateFormCollectorOptions} from '@useago/sdk/react';
import {defineFunction} from '@useago/sdk';
import About from './pages/About';
import Features from './pages/Features';
import Products from './pages/Products';
import {getCurrentTime, getPageInfo, showNotification} from './functions';

interface FunctionLog {
  id: number;
  timestamp: string;
  type: 'invoke' | 'result';
  functionName: string;
  detail: string;
}

// Conversational form the agent fills while chatting. Declared at module scope
// so its reference stays stable across renders (the widget reinstalls collectors
// only when name/schema/submit change).
const DEMO_FORMS: CreateFormCollectorOptions[] = [
  {
    name: 'demo_request',
    description: 'A request to book a product demo of AGO.',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Full name of the requester' },
        email: { type: 'string', description: 'Work email address' },
        company: { type: 'string', description: 'Company name' },
        teamSize: { type: 'number', description: 'Number of people on the team' },
      },
      required: ['name', 'email', 'company'],
    },
    // Demo: run the submit in the browser. In production prefer
    // { via: 'backend', destination: 'demo_webhook' } to keep the URL + secret server-side.
    submit: {
      via: 'client',
      handler: async (values) => {
        console.log('Demo request submitted:', values);
        return { ok: true };
      },
    },
  },
];

const APP_ROUTES = [
  { name: 'home', path: '/', description: 'Home page with client function logs' },
  { name: 'about', path: '/about', description: 'About AGO, our mission and values' },
  { name: 'features', path: '/features', description: 'List of AGO SDK features' },
  { name: 'products', path: '/products', description: 'Product catalog page with filters (category, price, status, sort). Filters are set via URL query params.' },
];

function ChatWithFunctions({ onLog }: { onLog: (type: FunctionLog['type'], name: string, detail: string) => void }) {
  const navigate = useNavigate();
  const client = useAgoClient();

  // Declarative navigation — auto-registers/unregisters with component lifecycle
  useAgoNavigation(navigate, APP_ROUTES);

  // Functions defined with defineFunction() — reusable across components and tests
  useAgoFunction(getCurrentTime.name, getCurrentTime);
  useAgoFunction(showNotification.name, showNotification);
  useAgoFunction(getPageInfo.name, getPageInfo);

  // Function that lets the AI set product filters via URL query params
  const setProductFilters = defineFunction({
    name: 'setProductFilters',
    description: 'Set filters on the products page. Navigates to /products and applies the given filters as URL query parameters. Omit a parameter to leave it unchanged, or set it to its default value to clear it.',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Product category. Must be one of: all, electronics, clothing, books, home, sports. Use the exact English value.', enum: ['all', 'electronics', 'clothing', 'books', 'home', 'sports'] },
        status: { type: 'string', description: 'Stock status. Must be one of: all, in-stock, out-of-stock, preorder.', enum: ['all', 'in-stock', 'out-of-stock', 'preorder'] },
        sort: { type: 'string', description: 'Sort order. Must be one of: name, price-asc, price-desc, rating.', enum: ['name', 'price-asc', 'price-desc', 'rating'] },
        search: { type: 'string', description: 'Text search on product name (in English, e.g. "headphones", "jacket")' },
        minPrice: { type: 'number', description: 'Minimum price in euros (default 0)' },
        maxPrice: { type: 'number', description: 'Maximum price in euros (default 999)' },
      },
    },
    handler: async (args) => {
      const params = new URLSearchParams();
      if (args.category && args.category !== 'all') params.set('category', args.category as string);
      if (args.status && args.status !== 'all') params.set('status', args.status as string);
      if (args.sort && args.sort !== 'name') params.set('sort', args.sort as string);
      if (args.search) params.set('search', args.search as string);
      if (args.minPrice && Number(args.minPrice) > 0) params.set('minPrice', String(args.minPrice));
      if (args.maxPrice && Number(args.maxPrice) < 999) params.set('maxPrice', String(args.maxPrice));

      const qs = params.toString();
      navigate(`/products${qs ? `?${qs}` : ''}`);

      return { navigated: true, filters: Object.fromEntries(params) };
    },
  });
  useAgoFunction(setProductFilters.name, setProductFilters);

  // Listen to function events for the log panel
  client.on('function:invoke', (data) => {
    onLog('invoke', data.functionName, JSON.stringify(data.arguments));
  });
  client.on('function:result', (data) => {
    onLog('result', data.invocationId, data.error || JSON.stringify(data.result));
  });

  return (
    <ChatWidget
      title="AGO Assistant"
      logoUrl="/ago-logo.png"
      welcomeMessage="Hello! I can tell you the current time, navigate you to a page, or help you book a demo. Try asking!"
      placeholder="Type your message..."
      height="100%"
      allowFiles={false}
      // Conversational form: the agent fills it as you chat and submits when ready.
      forms={DEMO_FORMS}
      // Suggested replies are clickable by default (they send the reply).
      // onFollowUpClick={(reply) => console.log('Suggested reply clicked:', reply)}
      onMessageSent={(content) => console.log('Message sent:', content)}
      onMessageReceived={(message) => console.log('Message received:', message)}
    />
  );
}

function AppContent() {
  const [logs, setLogs] = useState<FunctionLog[]>([]);

  const addLog = useCallback((type: FunctionLog['type'], functionName: string, detail: string) => {
    setLogs((prev) => [
      {
        id: Date.now(),
        timestamp: new Date().toLocaleTimeString(),
        type,
        functionName,
        detail,
      },
      ...prev,
    ].slice(0, 50));
  }, []);

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>AGO Chat SDK - React Example</h1>
        <nav className="app-nav">
          <NavLink to="/" end>Accueil</NavLink>
          <NavLink to="/about">À propos</NavLink>
          <NavLink to="/features">Fonctionnalités</NavLink>
          <NavLink to="/products">Produits</NavLink>
        </nav>
      </header>

      <main className="app-main">
        <div className="widget-container">
          <ChatWithFunctions onLog={addLog} />
        </div>

        <div className="content-area">
          <Routes>
            <Route path="/" element={
              <div className="log-panel">
                <h3>Client Function Logs</h3>
                <p className="log-hint">
                  Registered functions: <code>navigateToPage</code>, <code>getCurrentTime</code>, <code>showNotification</code>, <code>getPageInfo</code>, <code>setProductFilters</code>
                </p>
                {logs.length === 0 ? (
                  <p className="log-empty">No function calls yet. Try asking "What time is it?" or "Show me the features page"</p>
                ) : (
                  <ul className="log-list">
                    {logs.map((log) => (
                      <li key={log.id} className={`log-entry log-entry--${log.type}`}>
                        <span className="log-time">{log.timestamp}</span>
                        <span className={`log-badge log-badge--${log.type}`}>
                          {log.type === 'invoke' ? 'CALL' : 'RESULT'}
                        </span>
                        <span className="log-name">{log.functionName}</span>
                        <span className="log-detail">{log.detail}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            } />
            <Route path="/about" element={<About />} />
            <Route path="/features" element={<Features />} />
            <Route path="/products" element={<Products />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AgoProvider
        baseUrl="http://localhost:8000"
        debug
      >
        <AppContent />
      </AgoProvider>
    </BrowserRouter>
  );
}
