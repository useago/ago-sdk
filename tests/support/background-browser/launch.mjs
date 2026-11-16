import { createServer } from 'vite';
import { mkdir } from 'node:fs/promises';
import { createSimulator } from './server.mjs';

export const outputDir = process.env.AGO_SCREENSHOT_DIR || '.context/background-agent-screenshots';
export async function launchHarness(widget, options = {}) {
  const simulator = createSimulator({ caseName: options.caseName });
  let vite;
  try {
    const backend = await simulator.start();
    vite = await createServer({
      configFile: false,
      optimizeDeps: { entries: [`tests/support/background-browser/${widget}.html`], ...(widget === 'react' ? { include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] } : {}) },
      plugins: options.plugins || [],
      server: { host: '127.0.0.1', port: 0, proxy: { '/api': backend, '/fixture-files': backend } },
    });
    await new Promise((resolve, reject) => {
      vite.httpServer.once('error', reject);
      vite.httpServer.listen(0, '127.0.0.1', () => { vite.httpServer.off('error', reject); resolve(); });
    });
    const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
    return { simulator, origin, url: `${origin}/tests/support/background-browser/${widget}.html`, async close() { try { await vite.close(); } finally { await simulator.close(); } } };
  } catch (error) {
    try { if (vite) await vite.close(); } finally { await simulator.close(); }
    throw error;
  }
}

export async function launchBrowser() {
  await mkdir(outputDir, { recursive: true });
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  return chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
}
