import { useState, useRef, useCallback } from 'react';
import axios from 'axios';
import { API_BASE } from '../constants';
import { Upload, User, CheckCircle, XCircle, Clock, Scan, Image } from 'lucide-react';

const MAX_FILE_MB = 10;

export default function UploadSection({ onRegistered }) {
  const [dragging, setDragging]       = useState(false);
  const [preview, setPreview]         = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [name, setName]               = useState('');
  const [loading, setLoading]         = useState(false);
  const [result, setResult]           = useState(null); // { status, message, scan_time_ms, id }
  const fileRef = useRef(null);

  const reset = () => { setPreview(null); setSelectedFile(null); setResult(null); setName(''); };

  const handleFile = useCallback((file) => {
    if (!file) return;
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setResult({ status: 'error', message: `File too large. Max ${MAX_FILE_MB} MB allowed.` });
      return;
    }
    setSelectedFile(file);
    setResult(null);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target.result);
    reader.readAsDataURL(file);
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false);
    handleFile(e.dataTransfer.files?.[0]);
  }, [handleFile]);

  const onInputChange = (e) => handleFile(e.target.files?.[0]);

  const handleSubmit = async () => {
    if (!selectedFile) return;
    setLoading(true); setResult(null);

    const form = new FormData();
    form.append('file', selectedFile);
    form.append('name', name.trim() || 'Unknown');

    try {
      const { data } = await axios.post(`${API_BASE}/upload-face`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(data);
      if (data.status === 'accepted' && onRegistered) onRegistered();
    } catch (err) {
      setResult({
        status: 'error',
        message: err?.response?.data?.detail || 'Server error — is the backend running?',
      });
    } finally {
      setLoading(false);
    }
  };

  const scanTimeBadge = result?.scan_time_ms != null && (
    <span className="stat-chip flex items-center gap-1.5">
      <Clock size={13} /> Scan: {result.scan_time_ms} ms
    </span>
  );

  return (
    <div className="animate-fade-in space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold grad-text mb-1">Face Registration</h2>
        <p className="text-sm text-slate-400">Upload a photo to register an identity in the biometric database.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left — Upload form */}
        <div className="space-y-4">
          {/* Name input */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">
              Person Name
            </label>
            <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-4 py-3">
              <User size={16} className="text-indigo-400 shrink-0" />
              <input
                id="register-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter full name (optional)"
                className="bg-transparent outline-none w-full text-sm text-slate-200 placeholder-slate-500"
              />
            </div>
          </div>

          {/* Drop zone */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">
              Face Image
            </label>
            <div
              id="upload-drop-zone"
              className={`drop-zone p-8 text-center transition-all ${dragging ? 'drag-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
            >
              {preview ? (
                <div className="relative">
                  <img src={preview} alt="preview" className="w-40 h-40 object-cover rounded-xl mx-auto border-2 border-indigo-500/50" />
                  <div className="mt-3 text-xs text-slate-400">{selectedFile?.name}</div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="w-14 h-14 mx-auto rounded-full bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center">
                    <Upload size={24} className="text-indigo-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-300">Drop image here or click to browse</p>
                    <p className="text-xs text-slate-500 mt-1">JPG, PNG, WEBP — max {MAX_FILE_MB} MB</p>
                  </div>
                </div>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onInputChange} id="upload-file-input" />
          </div>

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              id="btn-register-face"
              className="btn-primary flex-1"
              onClick={handleSubmit}
              disabled={!selectedFile || loading}
            >
              {loading ? (
                <><span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Processing…</>
              ) : (
                <><Scan size={15} /> Register Face</>
              )}
            </button>
            {preview && (
              <button id="btn-clear-upload" className="btn-secondary px-4" onClick={reset}>
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Right — Result panel */}
        <div className="glass-card p-5 min-h-[280px] flex flex-col justify-center items-center relative overflow-hidden">
          {/* BG glow */}
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: 'radial-gradient(ellipse at 50% 50%, rgba(99,102,241,0.06) 0%, transparent 70%)' }} />

          {!result && !loading && (
            <div className="text-center space-y-3 relative z-10">
              <div className="w-16 h-16 mx-auto rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                <Image size={28} className="text-indigo-400/60" />
              </div>
              <p className="text-slate-500 text-sm">Upload a face photo to see results here</p>
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center gap-4 relative z-10">
              <div className="w-16 h-16 rounded-full border-2 border-indigo-500/30 border-t-indigo-400 animate-spin" />
              <div className="text-center">
                <p className="text-sm font-medium text-indigo-300">Analysing face…</p>
                <p className="text-xs text-slate-500 mt-1">Running RetinaFace + ArcFace</p>
              </div>
            </div>
          )}

          {result && !loading && (
            <div className="w-full space-y-4 animate-fade-in relative z-10">
              {/* Status */}
              <div className="flex items-center justify-between">
                <span className={result.status === 'accepted' ? 'badge-green' : 'badge-red'}>
                  {result.status === 'accepted' ? '✓ Accepted' : result.status === 'rejected' ? '✕ Rejected' : '⚠ Error'}
                </span>
                {scanTimeBadge}
              </div>

              {/* Icon */}
              <div className="flex justify-center">
                {result.status === 'accepted'
                  ? <CheckCircle size={48} className="text-green-400" strokeWidth={1.5} />
                  : <XCircle size={48} className="text-red-400" strokeWidth={1.5} />
                }
              </div>

              {/* Message */}
              <div className={`rounded-xl p-4 text-sm ${
                result.status === 'accepted'
                  ? 'bg-green-500/10 border border-green-500/20 text-green-300'
                  : 'bg-red-500/10 border border-red-500/20 text-red-300'
              }`}>
                {result.message}
              </div>

              {result.status === 'accepted' && result.id && (
                <p className="text-xs text-slate-500 text-center font-mono">ID #{result.id} · {result.name}</p>
              )}

              <button className="btn-secondary w-full text-sm" onClick={reset}>
                Register Another
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tips */}
      <div className="glass-card p-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Registration Tips</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            ['👤', 'Single face', 'One person per photo'],
            ['💡', 'Good lighting', 'Avoid harsh shadows'],
            ['🎯', 'Face centred', 'Fill ≥ 20% of frame'],
            ['📸', 'Sharp image', 'Avoid motion blur'],
          ].map(([icon, title, desc]) => (
            <div key={title} className="bg-white/3 rounded-lg p-3 text-center border border-white/5">
              <div className="text-xl mb-1">{icon}</div>
              <div className="text-xs font-medium text-slate-300">{title}</div>
              <div className="text-xs text-slate-500 mt-0.5">{desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
