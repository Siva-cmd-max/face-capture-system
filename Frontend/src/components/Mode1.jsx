import React, { useState, useRef, useEffect, useCallback } from 'react';
import Webcam from 'react-webcam';
import axios from 'axios';
import { API_BASE, LIVE_SCAN_INTERVAL_MS } from '../constants';
import {
  Upload, CheckCircle, XCircle, AlertTriangle,
  Fingerprint, Database, Clock, AlertCircle, Zap
} from 'lucide-react';

/* ── Helpers ─────────────────────────────────────────────────────────────────── */
const fmtTime = () => new Date().toLocaleTimeString('en-GB', { hour12: false });
const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
};

/* ── Candidate details card (left panel) ───────────────────────────────────── */
function CandidateCard({ data }) {
  if (!data) return null;
  if (data.error) return (
    <div className="glass-panel p-4 border-rose-200 bg-rose-50 rounded-2xl text-sm text-rose-700 flex gap-2 items-start">
      <XCircle size={16} className="mt-0.5 shrink-0" />
      <span className="font-medium">{data.error}</span>
    </div>
  );

  const isDupe = data.already_exists;
  const preview = Array.isArray(data.embedding_preview)
    ? data.embedding_preview.map(v => v.toFixed(4)).join(', ') + ' …'
    : '—';

  return (
    <div className={`glass-panel p-4 rounded-2xl border text-sm flex flex-col gap-2 ${isDupe ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
      {isDupe && (
        <div className="flex items-center gap-2 mb-1">
          <AlertCircle size={15} className="text-amber-600 shrink-0" />
          <span className="text-amber-700 font-bold text-xs">
             {data.is_search_match ? 'Identity confirmed from Live DB Search.' : 'This candidate is already on record — using stored identity.'}
          </span>
        </div>
      )}
      <div className="flex justify-between items-center">
        <span className="text-slate-500 font-medium">Image Name</span>
        <span className="font-mono font-bold text-slate-800 truncate max-w-[160px]" title={data.image_name}>{data.image_name}</span>
      </div>
      <div className="flex justify-between items-center">
        <span className="text-slate-500 font-medium">Status</span>
        <span className={`px-2 py-0.5 rounded-md text-xs font-bold uppercase tracking-wider ${isDupe ? 'bg-amber-200 text-amber-800' : 'bg-emerald-200 text-emerald-800'}`}>
          {isDupe ? 'Already on record' : 'New upload'}
        </span>
      </div>
      <div className="flex justify-between items-center">
        <span className="text-slate-500 font-medium">Uploaded at</span>
        <span className="font-mono text-slate-700 text-xs">{fmtDate(data.uploaded_at) || '—'}</span>
      </div>
      <div className="flex justify-between items-center">
        <span className="text-slate-500 font-medium">Scan Time</span>
        <span className="font-mono text-indigo-600 font-bold">{data.scan_time_ms} ms</span>
      </div>
      <div className="flex justify-between items-center">
        <span className="text-slate-500 font-medium">Face Box</span>
        <span className="font-mono text-slate-600 text-xs">
          {data.box ? `x:${Math.round(data.box.x)} y:${Math.round(data.box.y)} w:${Math.round(data.box.w)} h:${Math.round(data.box.h)}` : '—'}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-slate-500 font-medium">Embedding Preview</span>
        <span className="font-mono text-slate-600 text-xs break-all">[{preview}]</span>
      </div>
    </div>
  );
}

/* ── Live history table (right panel) ──────────────────────────────────────── */
function HistoryTable({ rows }) {
  if (!rows.length) return (
    <div className="glass-panel rounded-2xl p-5 text-center text-slate-400 text-sm">
      <Database size={20} className="mx-auto mb-2 opacity-40" />
      Live results will appear here…
    </div>
  );
  return (
    <div className="glass-panel rounded-2xl overflow-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            {['#', 'Time', 'Scan ms', 'Total ms', 'Match %', 'Result'].map(h => (
              <th key={h} className="px-3 py-2 text-left text-slate-500 font-bold uppercase tracking-wider">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
              <td className="px-3 py-2 font-mono text-slate-500">{r.num}</td>
              <td className="px-3 py-2 font-mono text-slate-600">{r.time}</td>
              <td className="px-3 py-2 font-mono text-indigo-600">{r.scan_ms}</td>
              <td className="px-3 py-2 font-mono text-violet-600">{r.total_ms}</td>
              <td className="px-3 py-2 font-mono font-bold text-slate-800">{typeof r.pct === 'number' ? r.pct.toFixed(1) : r.pct}%</td>
              <td className="px-3 py-2">
                {r.matched
                  ? <span className="badge-green px-2 py-0.5 text-[10px]">Matched</span>
                  : <span className="badge-red px-2 py-0.5 text-[10px]">No match</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Warmup overlay ─────────────────────────────────────────────────────────── */
function WarmupOverlay() {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setSecs(s => s + 1), 1000);
    return () => clearInterval(iv);
  }, []);
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="w-14 h-14 border-4 border-amber-400 border-t-transparent rounded-full animate-spin" />
      <span className="text-amber-600 font-bold text-sm tracking-wide uppercase">AI Engine Warming Up…</span>
      <span className="font-mono text-amber-500 font-bold text-lg">{secs}s elapsed</span>
      <span className="text-slate-400 text-xs text-center max-w-[220px]">
        Loading Facenet neural network into RAM.<br />
        <strong>This only happens once after server start.</strong>
      </span>
    </div>
  );
}


export default function Mode1({ modelReady = false }) {
  const [refPreview,    setRefPreview]    = useState(null);
  const [sessionId,     setSessionId]     = useState(null);
  const [refLoading,    setRefLoading]    = useState(false);
  const [candidateData, setCandidateData] = useState(null);
  const [refBoxData,    setRefBoxData]    = useState(null);

  const webcamRef     = useRef(null);
  const [camActive,   setCamActive]   = useState(false);
  const [camReady,    setCamReady]    = useState(false);
  const [liveResult,  setLiveResult]  = useState(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [activeSearch,setActiveSearch]= useState(false);
  const [history,     setHistory]     = useState([]);

  useEffect(() => {
    if (sessionId || activeSearch) setCamActive(true);
    else           setCamActive(false);
  }, [sessionId, activeSearch]);

  const handleRefUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setRefPreview(URL.createObjectURL(file));
    setSessionId(null); setCandidateData(null); setActiveSearch(false);
    setRefBoxData(null); setLiveResult(null); setHistory([]);
    setRefLoading(true);

    const form = new FormData();
    form.append('file', file);

    try {
      const { data } = await axios.post(`${API_BASE}/upload-face`, form);
      if (data.status === 'success') {
        setSessionId(data.session_id);
        setCandidateData(data);
        setRefBoxData({ box: data.box, dims: data.img_dims });
      } else {
        setCandidateData({ error: data.message });
      }
    } catch {
      setCandidateData({ error: 'Failed to connect to server' });
    } finally {
      setRefLoading(false);
    }
  };

  const captureAndVerify = useCallback(async () => {
    if ((!sessionId && !activeSearch) || !camActive || !camReady || isVerifying) return;
    const ws = webcamRef.current;
    if (!ws) return;

    const imageSrc = ws.getScreenshot({ width: 320, height: 240 });
    if (!imageSrc) return;

    setIsVerifying(true);
    try {
      if (sessionId) {
        const { data } = await axios.post(`${API_BASE}/verify-live`, {
          session_id:   sessionId,
          frame_base64: imageSrc,
        });
        setLiveResult(data);

        setHistory(prev => [{
          num:      prev.length + 1,
          time:     fmtTime(),
          scan_ms:  data.detection_time_ms ?? '—',
          total_ms: data.total_time_ms    ?? '—',
          pct:      data.match_pct        ?? 0,
          matched:  data.matched          ?? false,
        }, ...prev].slice(0, 10));

        if (data.status === 'success' && data.matched) {
          setCamActive(false);
        }
      } else if (activeSearch) {
        const { data } = await axios.post(`${API_BASE}/identify-live`, {
          frame_base64: imageSrc,
        });
        setLiveResult(data);
        
        if (data.status === 'success' && data.matched && data.candidate) {
          // Found someone! Lock it in.
          setSessionId(data.candidate.image_name); // use name as a fake session lock
          setActiveSearch(false);
          const cand = data.candidate;
          cand.already_exists = true;
          cand.is_search_match = true;
          setCandidateData(cand);
          setRefPreview(cand.photo_base64);
          setRefBoxData({ box: cand.box, dims: cand.img_dims });
          setCamActive(false);

          setHistory(prev => [{
            num:      prev.length + 1,
            time:     fmtTime(),
            scan_ms:  data.detection_time_ms ?? '—',
            total_ms: data.total_time_ms    ?? '—',
            pct:      data.match_pct        ?? 0,
            matched:  true,
          }, ...prev].slice(0, 10));
        }
      }
    } catch { /* swallow */ } finally {
      setIsVerifying(false);
    }
  }, [sessionId, activeSearch, camActive, camReady, isVerifying]);

  useEffect(() => {
    let iv;
    if (camActive) iv = setInterval(captureAndVerify, LIVE_SCAN_INTERVAL_MS || 800);
    return () => clearInterval(iv);
  }, [camActive, captureAndVerify]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

      {/* ── LEFT: Core Identity ─────────────────────────────────────────── */}
      <div className="minimal-card p-8 flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-100 p-2.5 rounded-xl border border-indigo-200">
            <Fingerprint className="text-indigo-600" size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800">1. Core Identity</h2>
            <p className="text-sm text-slate-500 font-medium">Upload primary face trace</p>
          </div>
        </div>

        <label className={`drop-zone p-8 group ${modelReady ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
          <input type="file" className="hidden" accept="image/*" onChange={modelReady ? handleRefUpload : undefined} disabled={!modelReady} />
          {!modelReady ? (
            <WarmupOverlay />
          ) : refPreview ? (
            <div className="relative inline-block mx-auto rounded-xl shadow-md border border-slate-200 overflow-hidden" style={{ maxHeight: '13rem' }}>
              <img src={refPreview} alt="Reference" style={{ maxHeight: '13rem', width: 'auto', display: 'block' }} />
              {refBoxData?.box && refBoxData?.dims && (
                <div className="absolute border-[2px] border-blue-600 z-10 box-border pointer-events-none" style={{
                  left:   `${(refBoxData.box.x / refBoxData.dims.w) * 100}%`,
                  top:    `${(refBoxData.box.y / refBoxData.dims.h) * 100}%`,
                  width:  `${(refBoxData.box.w / refBoxData.dims.w) * 100}%`,
                  height: `${(refBoxData.box.h / refBoxData.dims.h) * 100}%`,
                }}>
                  <span className="absolute -top-6 left-[-2px] bg-blue-600 text-white text-[11px] font-bold px-1.5 py-0.5 tracking-wider whitespace-nowrap">
                    {candidateData?.scan_time_ms} ms
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <div className="bg-white p-4 rounded-full mb-4 shadow-sm group-hover:bg-indigo-50 transition-colors border border-slate-100">
                <Upload size={32} className="text-slate-400 group-hover:text-indigo-500" />
              </div>
              <span className="text-slate-700 font-bold tracking-wide mb-1">Select Reference</span>
              <span className="text-slate-400 text-sm font-medium">JPG, PNG accepted</span>
            </div>
          )}
        </label>

        {refLoading && (
          <div className="flex items-center justify-center gap-3 py-4">
            <div className="w-6 h-6 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-indigo-600 text-sm font-bold tracking-wider uppercase">Extracting Bio-Metrics…</span>
          </div>
        )}

        <CandidateCard data={candidateData} />
      </div>

      {/* ── RIGHT: Live Verification ────────────────────────────────────── */}
      <div className="minimal-card p-8 flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <div className="bg-violet-100 p-2.5 rounded-xl border border-violet-200">
            <ScanLine className="text-violet-600" size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800">2. Live Verification</h2>
            <p className="text-sm text-slate-500 font-medium">Autonomous bio-tracking</p>
          </div>
        </div>

        {/* Webcam feed */}
        <div className={`relative aspect-video bg-slate-100 border border-slate-200 rounded-2xl flex items-center justify-center overflow-hidden shadow-inner ${camActive && !liveResult?.matched ? 'scanning-overlay' : ''}`}>
          {camActive ? (
            <Webcam
              ref={webcamRef}
              audio={false}
              screenshotFormat="image/jpeg"
              screenshotQuality={0.7}
              videoConstraints={{ facingMode: 'user' }}
              onUserMedia={() => setCamReady(true)}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="flex flex-col items-center">
              <CameraOff size={36} className="text-slate-300 mb-3" />
              <span className="text-slate-400 text-sm font-bold tracking-wide uppercase mb-4">
                {sessionId ? 'Verified / Offline' : 'Awaiting Core Identity'}
              </span>
              {!sessionId && modelReady && (
                <button 
                  onClick={() => { setActiveSearch(true); setHistory([]); setLiveResult(null); }} 
                  className="btn-primary px-4 py-2 text-sm shadow-md"
                >
                  <Database size={16} /> Start Live DB Search
                </button>
              )}
            </div>
          )}
          {camActive && !liveResult?.matched && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur-md px-5 py-2.5 rounded-xl text-xs font-bold border border-indigo-200 text-indigo-600 uppercase tracking-widest shadow-lg">
              Acquiring Target…
            </div>
          )}
        </div>

        {/* Live result summary */}
        <div className="glass-panel p-4 flex flex-col gap-2">
          <div className="flex items-center gap-3">
            {liveResult?.matched
              ? <CheckCircle className="text-emerald-500" size={24} />
              : liveResult?.face_detected === false
              ? <AlertTriangle className="text-amber-500" size={24} />
              : <XCircle className="text-rose-500" size={24} />}
            <span className={`font-bold tracking-wide ${liveResult?.matched ? 'text-emerald-600' : liveResult?.face_detected === false ? 'text-amber-600' : 'text-rose-600'}`}>
              {liveResult ? liveResult.message : 'Awaiting Telemetry'}
            </span>
            {liveResult?.match_pct != null && (
              <span className="ml-auto font-mono font-extrabold text-slate-800 text-lg">{liveResult.match_pct}%</span>
            )}
          </div>
          {liveResult?.detection_time_ms != null && (
            <div className="flex gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1"><Clock size={11} /> Scan: <strong className="text-indigo-600">{liveResult.detection_time_ms} ms</strong></span>
              <span className="flex items-center gap-1"><Clock size={11} /> Total: <strong className="text-violet-600">{liveResult.total_time_ms ?? '—'} ms</strong></span>
            </div>
          )}
        </div>

        {/* History table */}
        <HistoryTable rows={history} />
      </div>
    </div>
  );
}

const CameraOff = (props) => (
  <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="2" y1="2" x2="22" y2="22"/><path d="M7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16"/><path d="M9.5 4h5L17 7h3a2 2 0 0 1 2 2v7.5"/><path d="M14.121 15.121A3 3 0 1 1 9.88 10.88"/>
  </svg>
);
const ScanLine = (props) => (
  <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/>
    <path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>
    <line x1="7" y1="12" x2="17" y2="12"/>
  </svg>
);
