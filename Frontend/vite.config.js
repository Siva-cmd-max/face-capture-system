import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function apiManager() {
  let apiProcess = null;

  function startApi() {
    if (apiProcess) return; // already running
    const backendPath = path.resolve(__dirname, '../PyBackend');
    apiProcess = spawn(
      'cmd.exe',
      ['/c', 'call venv310\\Scripts\\activate.bat && uvicorn main:app --host 0.0.0.0 --port 8000'],
      { cwd: backendPath, detached: false }
    );
    apiProcess.on('exit', () => { apiProcess = null; });
    console.log('[FaceVault] FastAPI backend auto-started on http://localhost:8000');
  }

  function stopApi() {
    if (apiProcess) {
      spawn('taskkill', ['/pid', String(apiProcess.pid), '/f', '/t']);
      apiProcess = null;
    }
  }

  return {
    name: 'api-manager',
    // Auto-start backend the moment Vite dev server initialises
    configureServer(server) {
      // AUTO-START: runs immediately when 'npm run dev' is called
      startApi();

      // Keep manual toggle endpoints working for the UI toggle switch
      server.middlewares.use('/api-manager/start', (req, res) => {
        startApi();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
      });

      server.middlewares.use('/api-manager/stop', (req, res) => {
        stopApi();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
      });
    },

    // Clean up backend when Vite dev server closes
    closeBundle() {
      stopApi();
    },
  }
}

export default defineConfig({
  plugins: [react(), apiManager()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api':               'http://localhost:8000',
      '/health':            'http://localhost:8000',
      '/detection-history': 'http://localhost:8000',
      '/capture-image':     'http://localhost:8000',
      '/registered-count':  'http://localhost:8000',
      '/registered-image':  'http://localhost:8000',
      '/clear-registered':  'http://localhost:8000',

    }
  }
})
