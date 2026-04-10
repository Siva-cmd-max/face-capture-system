import React, { useState } from 'react';
import axios from 'axios';
import { API_BASE } from '../constants';
import { Upload, CheckCircle, XCircle, Zap, FileCode2, ScanFace } from 'lucide-react';

/* ── Bounding-box + status overlay ─────────────────────────────────────────── */
function BoxOverlay({ box, dims, matched }) {
  if (!box || !dims) return null;
  const color = matched === true ? '#22c55e' : matched === false ? '#ef4444' : '#6366f1';
  return (
    <div className="absolute z-10 pointer-events-none box-border" style={{
      left:   `${(box.x / dims.w) * 100}%`,
      top:    `${(box.y / dims.h) * 100}%`,
      width:  `${(box.w / dims.w) * 100}%`,
      height: `${(box.h / dims.h) * 100}%`,
      border: `2px solid ${color}`, borderRadius: 4,
    }}>
      <span style={{
        position: 'absolute', top: -22, left: -2,
        background: color, color: '#fff',
        fontSize: 11, fontWeight: 700, padding: '2px 6px',
        borderRadius: 3, whiteSpace: 'nowrap',
      }}>
        {matched === true ? '✓ MATCHED' : matched === false ? '✗ NO MATCH' : '● DETECTED'}
      </span>
    </div>
  );
}

/* ── Progress bar ───────────────────────────────────────────────────────────── */
function MatchBar({ pct, matched }) {
  const color = matched ? '#22c55e' : '#ef4444';
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12, color: '#64748b' }}>
        <span>Match %</span>
        <span style={{ fontWeight: 800, fontFamily: 'monospace', color }}>{pct}%</span>
      </div>
      <div style={{ height: 10, background: '#e2e8f0', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 99, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  );
}

/* ── Result card ────────────────────────────────────────────────────────────── */
function ResultCard({ result }) {
  if (!result) return null;
  const ok    = result.matched;
  const color = ok ? '#22c55e' : '#ef4444';
  const bg    = ok ? 'rgba(34,197,94,0.07)' : 'rgba(239,68,68,0.07)';
  const border= ok ? '#bbf7d0' : '#fecaca';

  const rows = [
    ['Left image',       result.left_image_name  || '—'],
    ['Right image',      result.right_image_name || '—'],
    ['Left scan time',   `${result.left_scan_ms}  ms`],
    ['Right scan time',  `${result.right_scan_ms} ms`],
    ['Comparison time',  `${result.comparison_ms} ms`],
    ['Total time',       `${result.total_time_ms} ms`],
    ['Cosine similarity',result.cosine_raw?.toFixed(4) ?? '—'],
    ['Match threshold',  '0.68'],
    ['Verdict',          ok ? 'Matched ✓' : 'Not matched ✗'],
    ['Compared at',      new Date().toLocaleString('en-GB')],
  ];

  return (
    <div style={{ background: bg, border: `2px solid ${border}`, borderRadius: 20, overflow: 'hidden',
                  boxShadow: `0 8px 40px ${ok ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)'}` }}>
      {/* Header */}
      <div style={{ background: color, padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
        {ok ? <CheckCircle size={26} color="#fff" /> : <XCircle size={26} color="#fff" />}
        <span style={{ color: '#fff', fontWeight: 900, fontSize: 18, letterSpacing: 0.4 }}>
          {ok ? '✓ Identity Verified — Same Person' : '✗ Not Matched — Different Person'}
        </span>
      </div>

      <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Match bar */}
        <MatchBar pct={result.match_pct} matched={ok} />

        {/* Comparison details table */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              {rows.map(([label, value], i) => (
                <tr key={label} style={{ borderBottom: i < rows.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                  <td style={{ padding: '9px 16px', color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</td>
                  <td style={{ padding: '9px 16px', color: '#1e293b', fontWeight: 700, fontFamily: 'monospace', textAlign: 'right' }}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ── Image drop panel ───────────────────────────────────────────────────────── */
function ImagePanel({ label, icon: Icon, accentBg, accentBorder, accentColor,
                      preview, onUpload, result, side }) {
  const box  = result ? (side === 'left' ? result.left_box  : result.right_box)  : null;
  const dims = result ? (side === 'left' ? result.left_dims : result.right_dims) : null;
  const name = result ? (side === 'left' ? result.left_image_name : result.right_image_name) : null;

  return (
    <div className="minimal-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ background: accentBg, padding: 10, borderRadius: 12, border: `1px solid ${accentBorder}` }}>
          <Icon size={22} color={accentColor} />
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#1e293b' }}>{label}</h2>
          <p style={{ margin: 0, fontSize: 12, color: '#94a3b8', fontWeight: 500 }}>
            {side === 'left' ? 'Load base structural parameters' : 'Target image to cross-reference'}
          </p>
        </div>
      </div>

      <label className="drop-zone" style={{ padding: 20, cursor: 'pointer', flex: 1 }}>
        <input type="file" style={{ display: 'none' }} accept="image/*" onChange={onUpload} />
        {preview ? (
          <div style={{ position: 'relative', display: 'inline-block', margin: '0 auto',
                        borderRadius: 12, overflow: 'hidden', maxHeight: 240,
                        boxShadow: '0 2px 12px rgba(0,0,0,0.10)' }}>
            <img src={preview} alt={label} style={{ maxHeight: 240, width: 'auto', display: 'block' }} />
            {box && <BoxOverlay box={box} dims={dims} matched={result?.matched} />}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ background: '#fff', padding: 14, borderRadius: '50%', marginBottom: 10, border: '1px solid #e2e8f0' }}>
              <Upload size={28} color="#cbd5e1" />
            </div>
            <span style={{ color: '#64748b', fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>
              Select {label}
            </span>
          </div>
        )}
      </label>
      {name && <p style={{ margin: 0, fontSize: 11, color: '#94a3b8', fontFamily: 'monospace', textAlign: 'center' }}>{name}</p>}
    </div>
  );
}

/* ── Main Mode2 component ───────────────────────────────────────────────────── */
export default function Mode2() {
  const [leftFile,    setLeftFile]    = useState(null);
  const [leftPreview, setLeftPreview] = useState(null);
  const [rightFile,   setRightFile]   = useState(null);
  const [rightPreview,setRightPreview]= useState(null);
  const [comparing,   setComparing]   = useState(false);
  const [result,      setResult]      = useState(null);
  const [errorMsg,    setErrorMsg]    = useState('');

  const handleLeft = (e) => {
    const f = e.target.files?.[0];
    if (f) { setLeftFile(f); setLeftPreview(URL.createObjectURL(f)); setResult(null); setErrorMsg(''); }
  };
  const handleRight = (e) => {
    const f = e.target.files?.[0];
    if (f) { setRightFile(f); setRightPreview(URL.createObjectURL(f)); setResult(null); setErrorMsg(''); }
  };

  const handleCompare = async () => {
    if (!leftFile || !rightFile) return;
    setComparing(true); setResult(null); setErrorMsg('');

    const form = new FormData();
    form.append('left_image',  leftFile);
    form.append('right_image', rightFile);

    try {
      const { data } = await axios.post(`${API_BASE}/compare-photos`, form);
      if (data.success === false) {
        setErrorMsg(data.error || 'Comparison failed.');
      } else {
        setResult(data);
      }
    } catch (err) {
      setErrorMsg(err.response?.data?.detail || 'Server error — check backend.');
    } finally {
      setComparing(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

      {/* Upload row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <ImagePanel
          label="Source Node" side="left"
          icon={FileCode2}
          accentBg="#eef2ff" accentBorder="#c7d2fe" accentColor="#4f46e5"
          preview={leftPreview} onUpload={handleLeft}
          result={result}
        />
        <ImagePanel
          label="Candidate Node" side="right"
          icon={ScanFace}
          accentBg="#f5f3ff" accentBorder="#ddd6fe" accentColor="#7c3aed"
          preview={rightPreview} onUpload={handleRight}
          result={result}
        />
      </div>

      {/* Compare button */}
      {leftFile && rightFile && (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <button
            onClick={handleCompare}
            disabled={comparing}
            className="btn-primary"
            style={{ padding: '14px 48px', fontSize: 16, borderRadius: 16, display: 'flex', alignItems: 'center', gap: 10 }}
          >
            {comparing ? (
              <>
                <div style={{ width: 20, height: 20, borderRadius: '50%',
                              border: '2.5px solid rgba(255,255,255,0.4)',
                              borderTop: '2.5px solid white',
                              animation: 'spin 0.7s linear infinite' }} />
                Scanning Face Structure…
              </>
            ) : (
              <><Zap size={20} /> Execute Deep Comparison</>
            )}
          </button>
        </div>
      )}

      {/* Error */}
      {errorMsg && (
        <div style={{ maxWidth: 700, margin: '0 auto', width: '100%',
                      background: '#fff1f2', border: '1.5px solid #fecaca',
                      borderRadius: 16, padding: '18px 24px',
                      display: 'flex', alignItems: 'center', gap: 12 }}>
          <XCircle size={24} color="#ef4444" />
          <div>
            <div style={{ fontWeight: 800, color: '#dc2626', fontSize: 14 }}>Scan Error</div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 2 }}>{errorMsg}</div>
          </div>
        </div>
      )}

      {/* Result card (full-width, replaces on each comparison) */}
      {result && <ResultCard result={result} />}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
