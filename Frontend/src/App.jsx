import { useState, useEffect } from 'react';
import axios from 'axios';
import { API_BASE } from './constants';
import Mode1Folder from './components/Mode1Folder';
import Mode2Live   from './components/Mode2Live';
import Mode3       from './components/Mode2';           // original Mode2 = new Mode3
import { ShieldCheck, Zap, ZapOff } from 'lucide-react';

export default function App() {
  const [mode,       setMode]       = useState('mode1');
  const [backendOk,  setBackendOk]  = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [starting,   setStarting]   = useState(false);

  const checkHealth = async () => {
    try {
      const res = await axios.get(`${API_BASE}/health`);
      setBackendOk(true);
      setModelReady(res.data.model_ready === true);
      setStarting(false);
    } catch {
      setBackendOk(false);
      setModelReady(false);
    }
  };

  useEffect(() => {
    checkHealth();
    const id = setInterval(checkHealth, 1000);
    return () => clearInterval(id);
  }, []);

  const toggleApi = async (turnOn) => {
    try {
      if (turnOn) {
        setStarting(true);
        await axios.get(`/api-manager/start`);
      } else {
        await axios.get(`/api-manager/stop`);
        setBackendOk(false);
        setStarting(false);
      }
    } catch (e) {
      console.error(e);
      setStarting(false);
    }
  };

  // Called by Mode1Folder's "Go to Live Detection" button
  const goToMode2 = () => setMode('mode2');

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 relative overflow-hidden">
      {/* Subtle background blobs */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-indigo-500/10 blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-violet-500/10 blur-[100px] pointer-events-none" />

      {/* ── Top Navbar ── */}
      <header className="border-b border-slate-200 bg-white/70 backdrop-blur-lg sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">

          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-xl shadow-md">
              <ShieldCheck size={24} className="text-white" />
            </div>
            <div>
              <span style={{ fontWeight:800, fontSize:16, color:'#1e293b', fontFamily:'Outfit,sans-serif' }}>
                FaceVault
              </span>
              <span style={{ fontSize:11, color:'#94a3b8', display:'block', fontWeight:600 }}>
                Biometric Verification System
              </span>
            </div>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-4">

            {/* Mode dropdown */}
            <div className="relative">
              <select
                value={mode}
                onChange={e => setMode(e.target.value)}
                className="appearance-none bg-white border-2 border-slate-200 text-slate-800 font-bold text-sm rounded-xl focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 block p-2.5 pr-8 transition-colors cursor-pointer shadow-sm hover:border-slate-300"
                style={{ minWidth:220 }}
              >
                <option value="mode1">Mode 1 : Upload Folder (Bulk Register)</option>
                <option value="mode2">Mode 2 : Live Detection</option>
                <option value="mode3">Mode 3 : Image vs Image</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-500">
                <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                  <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                </svg>
              </div>
            </div>

            {/* API Manager Controls */}
            <div className="flex items-center gap-3 bg-white border border-slate-200 px-4 py-2 rounded-xl shadow-sm">
              <span className={`text-sm font-bold ${backendOk ? 'text-emerald-600' : 'text-slate-400'}`}>
                {backendOk ? 'API Online' : 'API Offline'}
              </span>

              {backendOk && !modelReady && (
                <span className="flex items-center gap-1.5 text-xs font-bold text-amber-600">
                  <span className="w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin inline-block" />
                  AI Warming Up…
                </span>
              )}
              {backendOk && modelReady && (
                <span className="text-xs font-bold text-emerald-600">⚡ AI Ready</span>
              )}

              <button
                onClick={() => toggleApi(!backendOk)}
                disabled={starting}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${backendOk ? 'bg-emerald-500' : 'bg-slate-300'}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${backendOk ? 'translate-x-6' : 'translate-x-1'}`}
                />
              </button>
            </div>

          </div>
        </div>
      </header>

      {/* ── Main content ── */}
      <main className="max-w-7xl mx-auto px-6 py-10 relative z-10">
        {mode === 'mode1' && <Mode1Folder onNavigateToMode2={goToMode2} />}
        {mode === 'mode2' && <Mode2Live   modelReady={modelReady} />}
        {mode === 'mode3' && <Mode3 />}
      </main>
    </div>
  );
}
