import { useState, useRef, useEffect, useCallback } from 'react';
import Webcam from 'react-webcam';
import axios from 'axios';
import { API_BASE, LIVE_SCAN_INTERVAL_MS } from '../constants';
import {
  Camera, CameraOff, Upload, CheckCircle, XCircle,
  AlertTriangle, Zap, Activity, Clock, Image as ImageIcon
} from 'lucide-react';

// ── Helpers ───────────────────────────────────────────────────────────────────
function MatchBar({ pct, matched }) {
  const color = matched
    ? 'bg-gradient-to-r from-green-500 to-emerald-400'
    : 'bg-gradient-to-r from-red-500 to-rose-400';
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-slate-400">
        <span>Match Score</span>
        <span className="font-mono font-semibold" style={{ color: matched ? '#4ade80' : '#f87171' }}>
          {pct.toFixed(1)}%
        </span>
      </div>
      <div className="match-bar-bg">
        <div className={`match-bar-fill ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ResultCard({ result }) {
  if (!result) return null;
  const verified = result.matched;
  const noFace   = !result.face_detected;

  return (
    <div className={`rounded-xl p-4 border animate-fade-in ${
      verified ? 'bg-green-500/10 border-green-500/25'
      : noFace  ? 'bg-amber-500/10 border-amber-500/25'
      :            'bg-red-500/10 border-red-500/25'
    }`}>
      <div className="flex items-start gap-3">
        {verified ? <CheckCircle className="text-green-400 mt-0.5 shrink-0" size={20} />
          : noFace ? <AlertTriangle className="text-amber-400 mt-0.5 shrink-0" size={20} />
          : <XCircle className="text-red-400 mt-0.5 shrink-0" size={20} />}
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${verified ? 'text-green-300' : noFace ? 'text-amber-300' : 'text-red-300'}`}>
            {verified ? `Verified — ${result.matched_name}` : noFace ? 'No Face Detected' : result.matched_name || 'Not Matched'}
          </p>
          {result.face_detected && (
            <div className="mt-2">
              <MatchBar pct={result.match_pct ?? 0} matched={verified} />
            </div>
          )}
          <div className="mt-2 flex gap-2 flex-wrap">
            <span className="stat-chip text-xs flex items-center gap-1">
              <Clock size={11} />{result.processing_time_ms} ms
            </span>
            {verified && result.matched_id && (
              <span className="stat-chip text-xs">ID #{result.matched_id}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Image upload inside live section ─────────────────────────────────────────
function ImageVerifyPanel() {
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview]   = useState(null);
  const [file, setFile]         = useState(null);
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState(null);
  const fileRef = useRef(null);

  const handleFile = (f) => {
    if (!f) return;
    setFile(f); setResult(null);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target.result);
    reader.readAsDataURL(f);
  };

  const verify = async () => {
    if (!file) return;
    setLoading(true); setResult(null);
    const form = new FormData();
    form.append('file', file);
    try {
      const { data } = await axios.post(`${API_BASE}/compare-image`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(data);
    } catch (err) {
      setResult({ face_detected: false, matched: false, match_pct: 0,
        matched_name: err?.response?.data?.detail || 'Server error', processing_time_ms: 0 });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-card p-5 space-y-4 mt-4">
      <div className="flex items-center gap-2">
        <ImageIcon size={16} className="text-purple-400" />
        <h3 className="text-sm font-semibold grad-text-purple">Upload Image for Verification</h3>
      </div>

      <div
        id="compare-drop-zone"
        className={`drop-zone p-5 text-center ${dragging ? 'drag-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]); }}
        onClick={() => fileRef.current?.click()}
      >
        {preview ? (
          <div className="flex items-center gap-4">
            <img src={preview} alt="preview" className="w-20 h-20 object-cover rounded-lg border border-purple-500/40" />
            <div className="text-left">
              <p className="text-sm text-slate-300 font-medium">{file?.name}</p>
              <p className="text-xs text-slate-500 mt-0.5">{(file?.size / 1024).toFixed(0)} KB</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload size={20} className="text-purple-400" />
            <p className="text-sm text-slate-400">Drop image or click to select</p>
          </div>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" id="compare-file-input"
        onChange={(e) => handleFile(e.target.files?.[0])} />

      <div className="flex gap-2">
        <button id="btn-compare-image" className="btn-primary flex-1" onClick={verify} disabled={!file || loading}>
          {loading
            ? <><span className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Matching…</>
            : <><Zap size={14} /> Compare</>
          }
        </button>
        {preview && (
          <button id="btn-clear-compare" className="btn-secondary px-4"
            onClick={() => { setFile(null); setPreview(null); setResult(null); }}>
            Clear
          </button>
        )}
      </div>

      <ResultCard result={result} />
    </div>
  );
}

// ── Webcam overlay status ─────────────────────────────────────────────────────
function CamOverlay({ result, scanning }) {
  const verified = result?.matched;
  const noFace   = result && !result.face_detected;

  const border = !result ? 'border-indigo-500/50'
    : verified            ? 'border-green-500 glow-green'
    : noFace              ? 'border-amber-500/60'
    :                       'border-red-500 glow-red';

  return (
    <div className={`absolute inset-0 rounded-2xl border-2 pointer-events-none transition-colors duration-300 ${border}`}>
      {/* Corner brackets */}
      {[['top-3 left-3', 'border-t-2 border-l-2'],
        ['top-3 right-3', 'border-t-2 border-r-2'],
        ['bottom-3 left-3', 'border-b-2 border-l-2'],
        ['bottom-3 right-3', 'border-b-2 border-r-2'],
      ].map(([pos, cls], i) => (
        <div key={i} className={`absolute ${pos} w-5 h-5 ${cls} ${
          verified ? 'border-green-400' : noFace ? 'border-amber-400' : 'border-indigo-400'
        }`} />
      ))}

      {/* Scan line when active */}
      {scanning && !result && (
        <div className="absolute left-0 right-0 h-0.5 opacity-70 scanning-overlay" />
      )}

      {/* Status tag */}
      {result && (
        <div className={`absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-bold backdrop-blur-sm ${
          verified ? 'bg-green-500/80 text-white' : noFace ? 'bg-amber-500/80 text-white' : 'bg-red-500/80 text-white'
        }`}>
          {verified ? `✓ ${result.matched_name}` : noFace ? '⚠ No Face' : '✕ Not Matched'}
        </div>
      )}

      {/* Match % bottom */}
      {result?.face_detected && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-mono bg-black/60 backdrop-blur-sm text-white">
          {result.match_pct?.toFixed(1)}% match · {result.processing_time_ms} ms
        </div>
      )}
    </div>
  );
}

// ── Main Live Verification component ─────────────────────────────────────────
export default function LiveVerification() {
  const webcamRef  = useRef(null);
  const intervalRef = useRef(null);
  const [active, setActive]       = useState(false);
  const [camReady, setCamReady]   = useState(false);
  const [result, setResult]       = useState(null);
  const [scanning, setScanning]   = useState(false);
  const [frameMs, setFrameMs]     = useState(null);
  const [fps, setFps]             = useState(0);
  const fpsRef = useRef({ count: 0, last: Date.now() });

  const captureAndVerify = useCallback(async () => {
    const ws = webcamRef.current;
    if (!ws || !camReady) return;

    const imageSrc = ws.getScreenshot({ width: 640, height: 480 });
    if (!imageSrc) return;

    const t0 = performance.now();
    setScanning(true);

    try {
      const { data } = await axios.post(`${API_BASE}/verify-live`, {
        frame_base64: imageSrc,
      });
      setResult(data);
      setFrameMs(data.processing_time_ms);

      // FPS counter
      const now = Date.now();
      fpsRef.current.count++;
      if (now - fpsRef.current.last >= 1000) {
        setFps(fpsRef.current.count);
        fpsRef.current = { count: 0, last: now };
      }
    } catch (_) {
      // Silently swallow network errors during live scan
    } finally {
      setScanning(false);
    }
  }, [camReady]);

  useEffect(() => {
    if (active) {
      intervalRef.current = setInterval(captureAndVerify, LIVE_SCAN_INTERVAL_MS);
    } else {
      clearInterval(intervalRef.current);
      setResult(null); setFrameMs(null); setFps(0);
    }
    return () => clearInterval(intervalRef.current);
  }, [active, captureAndVerify]);

  return (
    <div className="animate-fade-in space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold grad-text mb-1">Live Verification</h2>
          <p className="text-sm text-slate-400">Real-time identity verification via webcam using ArcFace embeddings.</p>
        </div>
        {active && (
          <div className="flex items-center gap-2">
            <div className="pulse-dot" />
            <span className="text-xs text-green-400 font-semibold">LIVE</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* Left — Webcam (3/5) */}
        <div className="xl:col-span-3 space-y-4">
          {/* Camera view */}
          <div className="relative aspect-video bg-black rounded-2xl overflow-hidden border border-white/10">
            {active ? (
              <>
                <Webcam
                  ref={webcamRef}
                  audio={false}
                  screenshotFormat="image/jpeg"
                  screenshotQuality={0.85}
                  videoConstraints={{ width: 1280, height: 720, facingMode: 'user' }}
                  onUserMedia={() => setCamReady(true)}
                  className="w-full h-full object-cover"
                />
                <CamOverlay result={result} scanning={scanning} />
              </>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                <div className="w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
                  <CameraOff size={36} className="text-slate-500" />
                </div>
                <p className="text-slate-500 text-sm">Camera is off</p>
              </div>
            )}

            {/* Stats bar */}
            {active && (
              <div className="absolute top-3 left-3 flex gap-2">
                {frameMs != null && (
                  <span className="text-xs bg-black/60 backdrop-blur-sm text-cyan-400 font-mono px-2 py-1 rounded-md">
                    {frameMs} ms
                  </span>
                )}
                {fps > 0 && (
                  <span className="text-xs bg-black/60 backdrop-blur-sm text-indigo-400 font-mono px-2 py-1 rounded-md">
                    {fps} FPS
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex gap-3">
            <button
              id="btn-toggle-camera"
              className={active ? 'btn-secondary flex-1' : 'btn-primary flex-1'}
              onClick={() => { setActive(v => !v); setCamReady(false); }}
            >
              {active ? <><CameraOff size={15} /> Stop Camera</> : <><Camera size={15} /> Start Camera</>}
            </button>
          </div>
        </div>

        {/* Right — Results (2/5) */}
        <div className="xl:col-span-2 space-y-4">
          <div className="glass-card p-5 min-h-[240px] flex flex-col justify-center">
            {!result && !active && (
              <div className="text-center space-y-3">
                <Activity size={32} className="text-indigo-400/40 mx-auto" />
                <p className="text-slate-500 text-sm">Start the camera to begin verification</p>
              </div>
            )}
            {!result && active && (
              <div className="text-center space-y-3 animate-pulse">
                <div className="w-12 h-12 mx-auto rounded-full border-2 border-indigo-500/40 border-t-indigo-400 animate-spin" />
                <p className="text-slate-400 text-sm">Scanning for faces…</p>
              </div>
            )}
            {result && (
              <div className="space-y-4 animate-fade-in">
                <div className="flex items-center justify-between">
                  <span className={result.matched ? 'badge-green' : !result.face_detected ? 'badge-amber' : 'badge-red'}>
                    {result.matched ? '✓ Verified' : !result.face_detected ? '⚠ No Face' : '✕ Not Matched'}
                  </span>
                  <span className="stat-chip text-xs flex items-center gap-1">
                    <Clock size={11} />{result.processing_time_ms} ms
                  </span>
                </div>

                <div className="flex justify-center py-2">
                  {result.matched
                    ? <CheckCircle size={56} className="text-green-400" strokeWidth={1.5} />
                    : !result.face_detected
                    ? <AlertTriangle size={56} className="text-amber-400" strokeWidth={1.5} />
                    : <XCircle size={56} className="text-red-400" strokeWidth={1.5} />
                  }
                </div>

                {result.matched && (
                  <div className="text-center">
                    <p className="text-lg font-bold text-green-300">{result.matched_name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">ID #{result.matched_id}</p>
                  </div>
                )}

                {result.face_detected && (
                  <MatchBar pct={result.match_pct ?? 0} matched={result.matched} />
                )}

                <p className="text-xs text-slate-500 text-center leading-relaxed">{result.message}</p>
              </div>
            )}
          </div>

          {/* Performance stats */}
          <div className="glass-card p-4 grid grid-cols-2 gap-3">
            {[
              ['Target', '50–150 ms', 'per frame'],
              ['Threshold', '45%', 'cosine sim'],
              ['Model', 'ArcFace', 'buffalo_l'],
              ['Detector', 'RetinaFace', 'ONNX'],
            ].map(([label, val, sub]) => (
              <div key={label} className="bg-white/3 rounded-lg p-3 border border-white/5">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="text-sm font-semibold text-indigo-300 font-mono mt-0.5">{val}</p>
                <p className="text-xs text-slate-500">{sub}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Image upload panel */}
      <ImageVerifyPanel />
    </div>
  );
}
