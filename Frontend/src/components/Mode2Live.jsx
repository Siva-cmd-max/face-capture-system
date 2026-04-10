/**
 * Mode2Live.jsx — Mode 2: Live Detection (Single-Capture Flow)
 *
 * FLOW:
 *  1. Camera shows live preview  →  scanning line animates
 *  2. Auto-detects face OR user clicks "📸 Capture"
 *  3. Camera FREEZES on the captured frame
 *  4. Frame sent to /identify-registered  (target: < 200 ms)
 *  5. Result shown:
 *       Top-Left   → Live cam section → frozen frame with face-box + eye dots drawn on canvas
 *       Bottom-Left → DB matched person card
 *       Bottom-Right → Captured image + verdict + match % + timing
 *  6. "🔄 Try Again" button resets and restarts camera
 */

import React, {
  useState, useRef, useEffect, useCallback
} from 'react';
import Webcam from 'react-webcam';
import axios from 'axios';
import { API_BASE } from '../constants';
import {
  CheckCircle, XCircle, AlertTriangle, Clock,
  Database, Zap, User, AlertCircle, History,
  RefreshCw, Camera, Eye, Download, X,
  Filter
} from 'lucide-react';

/* ────────────────────────────────────────────────────────────
   HELPERS
──────────────────────────────────────────────────────────── */
const fmtDate = iso => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day:'2-digit', month:'short', year:'numeric',
      hour:'2-digit', minute:'2-digit',
    });
  } catch { return iso; }
};


/* ────────────────────────────────────────────────────────────
   SCAN OVERLAY  (animated scanning line over live cam)
──────────────────────────────────────────────────────────── */
function ScanOverlay({ scanning }) {
  return (
    <div style={{
      position:'absolute', inset:0, borderRadius:20,
      border: `2.5px solid ${scanning ? '#6366f1' : 'transparent'}`,
      pointerEvents:'none',
      transition:'border-color 0.4s',
      boxShadow: scanning ? '0 0 16px rgba(99,102,241,0.25)' : 'none',
    }}>
      {/* Corner brackets */}
      {[
        { top:10, left:10,  borderTop:'3px solid',    borderLeft:'3px solid'   },
        { top:10, right:10, borderTop:'3px solid',    borderRight:'3px solid'  },
        { bottom:10, left:10,  borderBottom:'3px solid', borderLeft:'3px solid'  },
        { bottom:10, right:10, borderBottom:'3px solid', borderRight:'3px solid' },
      ].map((s, i) => (
        <div key={i} style={{ position:'absolute', width:22, height:22,
                              borderColor:'#6366f1', ...s }} />
      ))}
      {/* Scanning line */}
      {scanning && (
        <div className="scanning-overlay"
             style={{ position:'absolute', left:0, right:0, top:0 }} />
      )}
      {/* Acquiring badge */}
      {scanning && (
        <div style={{
          position:'absolute', bottom:14, left:'50%',
          transform:'translateX(-50%)',
          background:'rgba(99,102,241,0.9)', backdropFilter:'blur(4px)',
          color:'#fff', fontWeight:700, fontSize:11,
          padding:'5px 18px', borderRadius:99, whiteSpace:'nowrap',
          textTransform:'uppercase', letterSpacing:'1.5px',
        }}>
          👁 Detecting Face…
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   RESULT CARD  (bottom-right)
──────────────────────────────────────────────────────────── */
function ResultCard({ result, capturedFrame, onTryAgain }) {
  if (!result && !capturedFrame) {
    return (
      <div className="minimal-card" style={{
        padding:28, display:'flex', flexDirection:'column',
        alignItems:'center', justifyContent:'center',
        minHeight:220, gap:12, textAlign:'center',
      }}>
        <div style={{ width:56, height:56, borderRadius:'50%',
                      background:'#f1f5f9', border:'2px dashed #cbd5e1',
                      display:'flex', alignItems:'center', justifyContent:'center' }}>
          <Camera size={24} color="#cbd5e1" />
        </div>
        <p style={{ margin:0, fontSize:13, color:'#94a3b8', fontWeight:600 }}>
          Captured frame & result will appear here
        </p>
        <p style={{ margin:0, fontSize:11, color:'#cbd5e1' }}>
          Face detected → auto-captures → freezes → processes
        </p>
      </div>
    );
  }

  const ok     = result?.matched;
  const noFace = result?.face_detected === false;
  const pct    = result?.match_pct ?? 0;
  const barClr = ok ? '#22c55e' : '#ef4444';

  return (
    <div className="minimal-card" style={{
      padding:20, display:'flex', flexDirection:'column', gap:14,
      border: ok     ? '2px solid #bbf7d0'
            : noFace ? '2px solid #fde68a'
            : result ? '2px solid #fecaca'
            : '1px solid #e2e8f0',
      background: ok     ? 'rgba(34,197,94,0.04)'
                : noFace ? 'rgba(245,158,11,0.03)'
                : result ? 'rgba(239,68,68,0.03)'
                : 'transparent',
    }}>

      {/* Captured frame - clean without drawing overlay */}
      {capturedFrame && (
        <img src={capturedFrame} alt="Captured"
             style={{ width:'100%', borderRadius:12, objectFit:'cover', display:'block' }} />
      )}

      {/* Verdict */}
      {result && (
        <>
          <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            {ok     ? <CheckCircle size={22} color="#22c55e" />
             : noFace ? <AlertTriangle size={22} color="#f59e0b" />
             :          <XCircle size={22} color="#ef4444" />}
            <span style={{ fontWeight:800, fontSize:15,
                           color: ok ? '#15803d' : noFace ? '#d97706' : '#dc2626' }}>
              {ok ? 'Identity Verified ✓' : noFace ? 'No Face Detected' : 'Not Registered'}
            </span>
            {pct > 0 && (
              <span style={{ marginLeft:'auto', fontFamily:'monospace',
                             fontSize:20, fontWeight:900, color:'#1e293b' }}>
                {pct.toFixed(1)}%
              </span>
            )}
          </div>

          {/* Match bar */}
          {result.face_detected && (
            <div>
              <div style={{ height:8, background:'#e2e8f0', borderRadius:99, overflow:'hidden' }}>
                <div style={{ height:'100%', width:`${pct}%`,
                              background:`linear-gradient(90deg,${barClr},${barClr}bb)`,
                              borderRadius:99, transition:'width 0.5s ease' }} />
              </div>
              <div style={{ display:'flex', justifyContent:'space-between',
                            marginTop:3, fontSize:10, color:'#94a3b8' }}>
                <span>0%</span>
                <span style={{ color:'#6366f1', fontWeight:700 }}>Threshold: 72.5%</span>
                <span>100%</span>
              </div>
            </div>
          )}

          {/* Timing row */}
          <div style={{ display:'flex', gap:14, flexWrap:'wrap', alignItems:'center' }}>
            {result.detection_time_ms != null && (
              <span style={{ display:'flex', alignItems:'center', gap:4,
                             fontSize:12, color:'#94a3b8' }}>
                <Eye size={12} />
                Face detect:&nbsp;
                <strong style={{ color:'#6366f1', fontFamily:'monospace' }}>
                  {result.detection_time_ms} ms
                </strong>
              </span>
            )}
            {result.total_time_ms != null && (
              <span style={{ display:'flex', alignItems:'center', gap:4,
                             fontSize:12, color:'#94a3b8' }}>
                <Clock size={12} />
                Total:&nbsp;
                <strong style={{ color:'#8b5cf6', fontFamily:'monospace' }}>
                  {result.total_time_ms} ms
                </strong>
              </span>
            )}
            {result.cosine_raw != null && (
              <span style={{ fontSize:11, color:'#94a3b8', fontFamily:'monospace' }}>
                cos:{result.cosine_raw}
              </span>
            )}
            {result.detection_level != null && (
              <span style={{
                fontSize:10, fontWeight:700, padding:'2px 8px',
                borderRadius:99, border:'1px solid',
                borderColor: result.detection_level <= 2 ? '#bbf7d0'
                           : result.detection_level === 3 ? '#c7d2fe'
                           : result.detection_level === 4 ? '#fde68a'
                           : '#e2e8f0',
                background:  result.detection_level <= 2 ? '#f0fdf4'
                           : result.detection_level === 3 ? '#eef2ff'
                           : result.detection_level === 4 ? '#fffbeb'
                           : '#f8fafc',
                color:       result.detection_level <= 2 ? '#15803d'
                           : result.detection_level === 3 ? '#4f46e5'
                           : result.detection_level === 4 ? '#d97706'
                           : '#64748b',
              }}>
                {result.detection_level <= 2 ? `L${result.detection_level} Haar (fastest)`
                 : result.detection_level === 3 ? 'L3 DeepFace-DNN'
                 : result.detection_level === 4 ? 'L4 DeepFace-SSD'
                 : 'L5 Full-image'}
              </span>
            )}
          </div>


          {result.message && (
            <p style={{ margin:0, fontSize:12, color:'#94a3b8' }}>{result.message}</p>
          )}
        </>
      )}

      {/* Try Again button */}
      {onTryAgain && (
        <button
          onClick={onTryAgain}
          style={{
            marginTop:4, display:'flex', alignItems:'center',
            justifyContent:'center', gap:8,
            padding:'12px 20px', borderRadius:14, border:'none', cursor:'pointer',
            background:'linear-gradient(90deg,#6366f1,#8b5cf6)',
            color:'#fff', fontWeight:800, fontSize:14,
            boxShadow:'0 4px 16px rgba(99,102,241,0.35)',
            transition:'transform 0.15s, box-shadow 0.15s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 8px 24px rgba(99,102,241,0.45)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 4px 16px rgba(99,102,241,0.35)';
          }}
        >
          <RefreshCw size={16} /> 🔄 Try Again
        </button>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   MATCHED PERSON CARD  (bottom-left)
──────────────────────────────────────────────────────────── */
function MatchedPersonCard({ matchedFace, scanCount, processing }) {
  const [imgError, setImgError] = useState(false);

  // Reset image error when matched face changes
  useEffect(() => { setImgError(false); }, [matchedFace?.id]);

  if (processing) {
    return (
      <div className="minimal-card" style={{
        padding:28, display:'flex', flexDirection:'column',
        alignItems:'center', justifyContent:'center',
        minHeight:220, gap:14,
      }}>
        <div style={{ width:48, height:48, borderRadius:'50%',
                      border:'3px solid rgba(99,102,241,0.2)',
                      borderTop:'3px solid #6366f1',
                      animation:'spin 0.7s linear infinite' }} />
        <p style={{ margin:0, fontSize:13, color:'#6366f1', fontWeight:700 }}>
          Matching face against database…
        </p>
        <p style={{ margin:0, fontSize:11, color:'#94a3b8' }}>
          Target: &lt; 200 ms
        </p>
      </div>
    );
  }

  if (!matchedFace) {
    return (
      <div className="minimal-card" style={{
        padding:28, display:'flex', flexDirection:'column',
        alignItems:'center', justifyContent:'center',
        minHeight:220, gap:12, textAlign:'center',
      }}>
        <div style={{ width:64, height:64, borderRadius:'50%',
                      background:'#f1f5f9', border:'2px dashed #cbd5e1',
                      display:'flex', alignItems:'center', justifyContent:'center' }}>
          <Database size={28} color="#cbd5e1" />
        </div>
        <p style={{ margin:0, fontSize:13, color:'#94a3b8', fontWeight:600 }}>
          Matched identity will appear here
        </p>
        {scanCount > 0 && (
          <p style={{ margin:0, fontSize:11, color:'#cbd5e1', fontFamily:'monospace' }}>
            {scanCount} attempt{scanCount > 1 ? 's' : ''} made
          </p>
        )}
      </div>
    );
  }

  const photoUrl = matchedFace.image_url
    ? matchedFace.image_url
    : matchedFace.id
      ? `/registered-image/${matchedFace.id}`
      : null;

  const hasPhoto = photoUrl && !imgError;

  return (
    <div className="minimal-card" style={{
      overflow:'hidden',
      border:'2px solid #bbf7d0',
      background:'linear-gradient(135deg,rgba(34,197,94,0.05),rgba(16,185,129,0.02))',
    }}>

      {/* ── Photo section ── */}
      <div style={{
        position:'relative',
        background:'#0f172a',
        display:'flex', alignItems:'center', justifyContent:'center',
        minHeight:200, overflow:'hidden',
      }}>
        {hasPhoto ? (
          <img
            src={photoUrl}
            alt={matchedFace.image_name}
            onError={() => setImgError(true)}
            style={{
              width:'100%', maxHeight:260,
              objectFit:'cover', display:'block',
            }}
          />
        ) : (
          /* Fallback avatar */
          <div style={{
            width:100, height:100, borderRadius:'50%',
            background:'linear-gradient(135deg,#6366f1,#8b5cf6)',
            display:'flex', alignItems:'center', justifyContent:'center',
            boxShadow:'0 8px 32px rgba(99,102,241,0.4)',
          }}>
            <User size={48} color="#fff" />
          </div>
        )}

        {/* Verified badge overlay */}
        <div style={{
          position:'absolute', top:10, left:10,
          background:'rgba(22,163,74,0.92)', backdropFilter:'blur(4px)',
          color:'#fff', fontWeight:800, fontSize:11,
          padding:'4px 12px', borderRadius:99,
          display:'flex', alignItems:'center', gap:5,
          boxShadow:'0 2px 10px rgba(0,0,0,0.2)',
        }}>
          <CheckCircle size={12} /> IDENTITY VERIFIED
        </div>

        {/* Face ID badge */}
        <div style={{
          position:'absolute', top:10, right:10,
          background:'rgba(0,0,0,0.65)', backdropFilter:'blur(4px)',
          color:'#a5f3fc', fontFamily:'monospace', fontWeight:800,
          fontSize:11, padding:'4px 10px', borderRadius:99,
        }}>
          ID #{matchedFace.id}
        </div>
      </div>

      {/* ── Info section ── */}
      <div style={{ padding:'16px 20px', display:'flex', flexDirection:'column', gap:10 }}>

        {/* Name */}
        <div style={{ textAlign:'center' }}>
          <p style={{ margin:0, fontSize:18, fontWeight:800, color:'#1e293b' }}>
            {matchedFace.image_name}
          </p>
          <p style={{ margin:'3px 0 0', fontSize:11, color:'#6366f1',
                      fontFamily:'monospace', fontWeight:700 }}>
            Face ID #{matchedFace.id} · DB Record
          </p>
        </div>

        {/* Metadata */}
        <div style={{
          background:'#f8fafc', borderRadius:12, padding:'10px 14px',
          border:'1px solid #e2e8f0', display:'flex', flexDirection:'column', gap:6,
        }}>
          {[
            { label:'Registered',  value: fmtDate(matchedFace.registered_at) },
            { label:'Source',      value: 'Folder Upload',  color:'#6366f1' },
            { label:'Status',      value: '✓ Active',       color:'#15803d' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ display:'flex', justifyContent:'space-between',
                                      fontSize:12, alignItems:'center' }}>
              <span style={{ color:'#94a3b8', fontWeight:600 }}>{label}</span>
              <span style={{ color: color || '#334155', fontWeight:700,
                             fontFamily: color ? 'inherit' : 'monospace',
                             fontSize:11 }}>
                {value}
              </span>
            </div>
          ))}
        </div>

        {/* Download registered photo */}
        {photoUrl && (
          <a
            href={`${photoUrl}?download=true`}
            download
            style={{
              display:'flex', alignItems:'center', justifyContent:'center', gap:6,
              padding:'9px 16px', borderRadius:12, textDecoration:'none',
              background:'linear-gradient(90deg,#6366f1,#8b5cf6)',
              color:'#fff', fontWeight:700, fontSize:12,
            }}
          >
            <Download size={13} /> Download Registered Photo
          </a>
        )}
      </div>
    </div>
  );
}


/* ────────────────────────────────────────────────────────────
   HISTORY MODAL
──────────────────────────────────────────────────────────── */
const STATUS_COLOR = {
  MATCHED:     { bg:'#dcfce7', text:'#15803d', border:'#bbf7d0', label:'✓ Matched'     },
  NOT_MATCHED: { bg:'#fee2e2', text:'#dc2626', border:'#fecaca', label:'✗ Not Matched' },
  NO_FACE:     { bg:'#fef9c3', text:'#854d0e', border:'#fef08a', label:'⚠ No Face'     },
  EMPTY_DB:    { bg:'#f1f5f9', text:'#64748b', border:'#e2e8f0', label:'— Empty DB'    },
};

function HistoryModal({ onClose }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    setLoading(true);
    axios.get(`${API_BASE}/detection-history`, {
      params: { limit:200, status_filter: filter }
    })
      .then(r => setRecords(r.data.records || []))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, [filter, refresh]);

  const stats = {
    total:   records.length,
    matched: records.filter(r => r.match_status === 'MATCHED').length,
    not:     records.filter(r => r.match_status === 'NOT_MATCHED').length,
    noFace:  records.filter(r => r.match_status === 'NO_FACE').length,
  };

  return (
    <div style={{ position:'fixed', inset:0, zIndex:1000,
                  background:'rgba(15,23,42,0.75)', backdropFilter:'blur(8px)',
                  display:'flex', alignItems:'flex-start', justifyContent:'center',
                  padding:'24px 16px', overflowY:'auto' }}
         onClick={onClose}>
      <div style={{ background:'#fff', borderRadius:24, width:'100%', maxWidth:1100,
                    boxShadow:'0 32px 80px rgba(0,0,0,0.25)',
                    display:'flex', flexDirection:'column', maxHeight:'90vh' }}
           onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding:'20px 28px', borderBottom:'1px solid #e2e8f0',
                      display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ background:'linear-gradient(135deg,#6366f1,#8b5cf6)',
                        borderRadius:12, padding:10 }}>
            <History size={20} color="#fff" />
          </div>
          <div style={{ flex:1 }}>
            <h2 style={{ margin:0, fontWeight:800, fontSize:18, color:'#1e293b' }}>
              Detection History Gallery
            </h2>
            <p style={{ margin:0, fontSize:12, color:'#64748b' }}>
              All live camera captures — with face images, match scores, download
            </p>
          </div>
          <button onClick={() => setRefresh(r=>r+1)}
                  style={{ background:'#f1f5f9', border:'none', borderRadius:10,
                           padding:'8px 14px', cursor:'pointer', fontSize:12,
                           fontWeight:700, color:'#475569',
                           display:'flex', alignItems:'center', gap:6 }}>
            <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            Refresh
          </button>
          <button onClick={onClose}
                  style={{ background:'#f1f5f9', border:'none', borderRadius:10,
                           padding:'8px 12px', cursor:'pointer' }}>
            <X size={18} color="#64748b" />
          </button>
        </div>

        {/* Stats strip */}
        <div style={{ padding:'12px 28px', borderBottom:'1px solid #f1f5f9',
                      display:'flex', gap:14, flexWrap:'wrap' }}>
          {[
            { label:'Total',       value: stats.total,   color:'#6366f1' },
            { label:'✓ Verified',  value: stats.matched, color:'#15803d' },
            { label:'✗ Not Match', value: stats.not,     color:'#dc2626' },
            { label:'⚠ No Face',  value: stats.noFace,  color:'#d97706' },
          ].map(s => (
            <div key={s.label} style={{ background:'#f8fafc', borderRadius:10,
                                        padding:'7px 16px', border:'1px solid #e2e8f0',
                                        textAlign:'center', minWidth:72 }}>
              <div style={{ fontWeight:900, fontSize:18, color:s.color,
                            fontFamily:'monospace' }}>{s.value}</div>
              <div style={{ fontSize:10, color:'#94a3b8', fontWeight:600 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filter tabs */}
        <div style={{ padding:'10px 28px', borderBottom:'1px solid #f1f5f9',
                      display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
          <Filter size={13} color="#94a3b8" />
          {[
            { v:'',            l:`All (${stats.total})`        },
            { v:'MATCHED',     l:`✓ Verified (${stats.matched})` },
            { v:'NOT_MATCHED', l:`✗ Not Match (${stats.not})`  },
            { v:'NO_FACE',     l:`⚠ No Face (${stats.noFace})` },
          ].map(f => (
            <button key={f.v} onClick={() => setFilter(f.v)}
                    style={{ padding:'6px 14px', borderRadius:99, fontSize:11, fontWeight:700,
                             cursor:'pointer', border:'1.5px solid',
                             borderColor: filter===f.v ? '#6366f1':'#e2e8f0',
                             background:  filter===f.v ? '#6366f1':'#fff',
                             color:       filter===f.v ? '#fff':'#475569' }}>
              {f.l}
            </button>
          ))}
        </div>

        {/* Gallery */}
        <div style={{ padding:28, overflowY:'auto', flex:1 }}>
          {loading ? (
            <div style={{ textAlign:'center', padding:48 }}>
              <div style={{ width:32, height:32, borderRadius:'50%',
                            border:'3px solid rgba(99,102,241,0.2)',
                            borderTop:'3px solid #6366f1',
                            animation:'spin 0.8s linear infinite',
                            margin:'0 auto 12px' }} />
              <p style={{ color:'#64748b', fontWeight:600 }}>Loading…</p>
            </div>
          ) : records.length === 0 ? (
            <div style={{ textAlign:'center', padding:48 }}>
              <History size={48} color="#e2e8f0" style={{ margin:'0 auto 12px' }} />
              <p style={{ color:'#94a3b8', fontWeight:600 }}>No records found</p>
            </div>
          ) : (
            <div style={{ display:'grid',
                          gridTemplateColumns:'repeat(auto-fill,minmax(190px,1fr))', gap:14 }}>
              {records.map(item => {
                const meta = STATUS_COLOR[item.match_status] || STATUS_COLOR.EMPTY_DB;
                const imgUrl = item.capture_url ? `${API_BASE}${item.capture_url}` : null;
                return (
                  <div key={item.id} style={{
                    borderRadius:14, overflow:'hidden',
                    border:`1.5px solid ${meta.border}`, background:'#fff',
                    boxShadow:'0 2px 10px rgba(0,0,0,0.06)',
                  }}>
                    <div style={{ position:'relative', background:'#0f172a',
                                  aspectRatio:'4/3',
                                  display:'flex', alignItems:'center', justifyContent:'center' }}>
                      {imgUrl ? (
                        <img src={imgUrl} alt={`cap-${item.id}`}
                             style={{ width:'100%', height:'100%',
                                      objectFit:'cover', display:'block' }}
                             onError={e => { e.target.style.display='none'; }} />
                      ) : (
                        <Camera size={28} color="#334155" />
                      )}
                      <div style={{ position:'absolute', top:6, left:6,
                                    background: meta.text, color:'#fff',
                                    fontWeight:800, fontSize:9, padding:'2px 8px',
                                    borderRadius:99 }}>
                        {meta.label}
                      </div>
                      <div style={{ position:'absolute', top:6, right:6,
                                    background:'rgba(0,0,0,0.65)', color:'#fff',
                                    fontFamily:'monospace', fontSize:9, padding:'2px 8px',
                                    borderRadius:99 }}>
                        #{item.id}
                      </div>
                    </div>
                    <div style={{ padding:'10px 12px', display:'flex',
                                  flexDirection:'column', gap:5 }}>
                      {item.matched_face_name && (
                        <p style={{ margin:0, fontWeight:800, fontSize:12, color:'#1e293b',
                                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {item.matched_face_name}
                        </p>
                      )}
                      {item.matched_face_id && (
                        <p style={{ margin:0, fontSize:10, color:'#6366f1',
                                    fontFamily:'monospace', fontWeight:700 }}>
                          Face ID #{item.matched_face_id}
                        </p>
                      )}
                      <div style={{ display:'flex', justifyContent:'space-between', fontSize:10 }}>
                        <span style={{ color:'#94a3b8' }}>Match</span>
                        <span style={{ fontWeight:800, fontFamily:'monospace',
                                       color: item.match_status==='MATCHED' ? '#15803d' : '#dc2626' }}>
                          {item.match_score != null ? `${Number(item.match_score).toFixed(1)}%` : '—'}
                        </span>
                      </div>
                      <div style={{ display:'flex', justifyContent:'space-between', fontSize:10 }}>
                        <span style={{ color:'#94a3b8' }}>Scan time</span>
                        <span style={{ fontWeight:700, fontFamily:'monospace', color:'#6366f1' }}>
                          {item.detection_time_ms ? `${item.detection_time_ms} ms` : '—'}
                        </span>
                      </div>
                      {imgUrl && (
                        <a href={`${API_BASE}/capture-image/${item.id}?download=true`} download
                           style={{ display:'flex', alignItems:'center', justifyContent:'center',
                                    gap:5, padding:'6px', borderRadius:8, textDecoration:'none',
                                    background:'linear-gradient(90deg,#6366f1,#8b5cf6)',
                                    color:'#fff', fontWeight:700, fontSize:10, marginTop:2 }}>
                          <Download size={10} /> Download
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   MAIN — MODE 2 LIVE DETECTION
──────────────────────────────────────────────────────────── */
// States: 'preview' | 'processing' | 'result'

export default function Mode2Live({ modelReady = false }) {
  const webcamRef     = useRef(null);
  const scanningRef   = useRef(false);   // prevent double-capture
  const autoTimerRef  = useRef(null);

  const [phase,         setPhase]         = useState('preview');  // preview|processing|result
  const [camReady,      setCamReady]      = useState(false);
  const [capturedFrame, setCapturedFrame] = useState(null);  // base64 frozen frame
  const [result,        setResult]        = useState(null);
  const [matchedFace,   setMatchedFace]   = useState(null);
  const [scanCount,     setScanCount]     = useState(0);
  const [emptyDb,       setEmptyDb]       = useState(false);
  const [showHistory,   setShowHistory]   = useState(false);
  const [errMsg,        setErrMsg]        = useState('');

  // Check DB
  useEffect(() => {
    axios.get(`${API_BASE}/registered-count`)
      .then(r => setEmptyDb(r.data.count === 0))
      .catch(() => {});
  }, []);

  /* ── Core: capture ONE frame, freeze, process ── */
  const doCapture = useCallback(async () => {
    if (scanningRef.current || phase !== 'preview') return;
    if (!camReady || !webcamRef.current) return;

    const frame = webcamRef.current.getScreenshot({ width: 320, height: 240 });
    if (!frame) return;

    scanningRef.current = true;
    // 1. Freeze camera
    setCapturedFrame(frame);
    setPhase('processing');
    setErrMsg('');
    setResult(null);
    setMatchedFace(null);

    try {
      const { data } = await axios.post(`${API_BASE}/identify-registered`, {
        frame_base64: frame,
      });

      setScanCount(p => p + 1);
      setResult(data);
      setEmptyDb(data.message?.includes('No registered faces') || false);

      if (data.matched && data.matched_face) {
        setMatchedFace(data.matched_face);
      }

      if (!data.face_detected) {
        setErrMsg(data.message || 'No face detected — please try again with a clearer frontal photo');
      }

      setPhase('result');
    } catch (e) {
      setErrMsg('Network error — please check the backend is running');
      setPhase('result');
    } finally {
      scanningRef.current = false;
    }
  }, [phase, camReady]);

  /* ── Auto-detect: probe every 800 ms in preview phase ── */
  useEffect(() => {
    if (phase !== 'preview' || !camReady || !modelReady) return;

    // Lightweight probe: getScreenshot and do a quick face-presence check
    // (just call the full endpoint — it's fast enough at < 200ms)
    autoTimerRef.current = setInterval(() => {
      if (!scanningRef.current && webcamRef.current) {
        // Only auto-trigger if webcam has data
        const frame = webcamRef.current.getScreenshot({ width: 160, height: 120 });
        if (frame) doCapture();
      }
    }, 900);

    return () => clearInterval(autoTimerRef.current);
  }, [phase, camReady, modelReady, doCapture]);

  /* ── Try Again: reset to preview ── */
  const handleTryAgain = useCallback(() => {
    clearInterval(autoTimerRef.current);
    setCapturedFrame(null);
    setResult(null);
    setMatchedFace(null);
    setErrMsg('');
    setPhase('preview');
    scanningRef.current = false;
  }, []);

  const isPreview    = phase === 'preview';
  const isProcessing = phase === 'processing';
  const isDone       = phase === 'result';

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>

      {/* ── HEADER ── */}
      <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
        <div style={{ background:'linear-gradient(135deg,#8b5cf6,#6366f1)',
                      borderRadius:14, padding:'10px 12px' }}>
          <Zap size={22} color="#fff" />
        </div>
        <div style={{ flex:1 }}>
          <h2 style={{ margin:0, fontSize:22, fontWeight:800, color:'#1e293b' }}>
            Mode 2 — Live Detection
          </h2>
          <p style={{ margin:'3px 0 0', fontSize:13, color:'#64748b' }}>
            Face auto-detected → single capture → frozen → matched against DB
            &nbsp;·&nbsp;Target: &lt;200 ms
          </p>
        </div>

        {/* History button */}
        <button onClick={() => setShowHistory(true)}
                className="btn-primary"
                style={{ padding:'10px 20px', fontSize:13, borderRadius:14,
                         display:'flex', alignItems:'center', gap:7 }}>
          <History size={15} /> Detection History
        </button>

        {/* AI status */}
        {!modelReady ? (
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 14px',
                        background:'#fef3c7', borderRadius:12, border:'1px solid #fde68a' }}>
            <div style={{ width:12, height:12, borderRadius:'50%',
                          border:'2px solid #f59e0b', borderTop:'2px solid transparent',
                          animation:'spin 1s linear infinite' }} />
            <span style={{ fontSize:12, fontWeight:700, color:'#d97706' }}>AI Warming…</span>
          </div>
        ) : (
          <div style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 14px',
                        background:'#dcfce7', borderRadius:12, border:'1px solid #bbf7d0' }}>
            <div style={{ width:8, height:8, borderRadius:'50%', background:'#22c55e',
                          boxShadow:'0 0 8px rgba(34,197,94,0.6)' }} />
            <span style={{ fontSize:12, fontWeight:700, color:'#15803d' }}>
              AI Ready{scanCount > 0 ? ` · ${scanCount} capture${scanCount > 1 ? 's' : ''}` : ''}
            </span>
          </div>
        )}
      </div>

      {/* ── EMPTY DB WARNING ── */}
      {emptyDb && (
        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 20px',
                      background:'#fef3c7', border:'1.5px solid #fde68a', borderRadius:16 }}>
          <AlertCircle size={18} color="#d97706" />
          <span style={{ fontWeight:700, color:'#d97706', fontSize:13 }}>
            No Registered Faces —&nbsp;
          </span>
          <span style={{ fontSize:12, color:'#92400e' }}>
            Run Mode 1 (Folder Upload) first to register faces.
          </span>
        </div>
      )}

      {/* ── ERROR MESSAGE ── */}
      {errMsg && isDone && (
        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 20px',
                      background:'#fef9c3', border:'1.5px solid #fef08a', borderRadius:16 }}>
          <AlertTriangle size={18} color="#d97706" />
          <span style={{ fontSize:13, color:'#92400e', fontWeight:600 }}>{errMsg}</span>
          <button onClick={handleTryAgain}
                  style={{ marginLeft:'auto', padding:'6px 14px', borderRadius:10,
                           background:'#6366f1', color:'#fff', border:'none',
                           fontWeight:700, fontSize:12, cursor:'pointer',
                           display:'flex', alignItems:'center', gap:5 }}>
            <RefreshCw size={12} /> Try Again
          </button>
        </div>
      )}

      {/* ── TOP: CAMERA SECTION ── */}
      <div className="minimal-card" style={{ overflow:'hidden', borderRadius:24 }}>
        <div style={{ position:'relative', aspectRatio:'16/7', background:'#0f172a',
                      display:'flex', alignItems:'center', justifyContent:'center', minHeight:280 }}>

          {/* Live webcam (only visible in preview phase) */}
          <Webcam
            ref={webcamRef}
            audio={false}
            screenshotFormat="image/jpeg"
            screenshotQuality={0.8}
            videoConstraints={{ facingMode:'user', width:1280, height:720 }}
            onUserMedia={() => setCamReady(true)}
            style={{
              width:'100%', height:'100%', objectFit:'cover',
              display: isPreview ? 'block' : 'none',
            }}
          />

          {/* Frozen frame shown when processing/result */}
          {capturedFrame && !isPreview && (
            <img src={capturedFrame} alt="Frozen frame"
                 style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />
          )}

          {/* Scan overlay (only in preview) */}
          {isPreview && <ScanOverlay scanning={camReady && modelReady} />}

          {/* Processing spinner overlay */}
          {isProcessing && (
            <div style={{
              position:'absolute', inset:0,
              background:'rgba(15,23,42,0.55)', backdropFilter:'blur(2px)',
              display:'flex', flexDirection:'column',
              alignItems:'center', justifyContent:'center', gap:14,
            }}>
              <div style={{ width:52, height:52, borderRadius:'50%',
                            border:'3px solid rgba(99,102,241,0.2)',
                            borderTop:'3px solid #a5f3fc',
                            animation:'spin 0.6s linear infinite' }} />
              <div style={{ color:'#a5f3fc', fontWeight:700, fontSize:13,
                            textTransform:'uppercase', letterSpacing:'1.5px' }}>
                Matching… &lt;200 ms
              </div>
            </div>
          )}

          {/* Latency badge */}
          {result?.total_time_ms && (
            <div style={{ position:'absolute', top:12, left:12,
                          background:'rgba(0,0,0,0.7)', backdropFilter:'blur(6px)',
                          color: result.total_time_ms <= 200 ? '#a5f3fc' : '#fbbf24',
                          padding:'4px 12px', borderRadius:99,
                          fontFamily:'monospace', fontSize:12, fontWeight:700 }}>
              {result.total_time_ms} ms
            </div>
          )}

          {/* Manual capture button (preview phase) */}
          {isPreview && camReady && modelReady && (
            <button
              onClick={doCapture}
              style={{
                position:'absolute', bottom:16, right:16,
                background:'linear-gradient(90deg,#6366f1,#8b5cf6)',
                border:'none', borderRadius:99, cursor:'pointer',
                color:'#fff', fontWeight:800, fontSize:13,
                padding:'10px 22px',
                display:'flex', alignItems:'center', gap:8,
                boxShadow:'0 4px 20px rgba(99,102,241,0.5)',
                transition:'transform 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.transform='scale(1.04)'}
              onMouseLeave={e => e.currentTarget.style.transform='scale(1)'}
            >
              <Camera size={16} /> 📸 Capture Now
            </button>
          )}

          {/* Try Again button in camera view (result phase without error) */}
          {isDone && !errMsg && (
            <button
              onClick={handleTryAgain}
              style={{
                position:'absolute', bottom:16, left:'50%',
                transform:'translateX(-50%)',
                background:'linear-gradient(90deg,#6366f1,#8b5cf6)',
                border:'none', borderRadius:99, cursor:'pointer',
                color:'#fff', fontWeight:800, fontSize:13,
                padding:'10px 24px',
                display:'flex', alignItems:'center', gap:8,
                boxShadow:'0 4px 20px rgba(99,102,241,0.5)',
              }}
            >
              <RefreshCw size={15} /> 🔄 Try Again
            </button>
          )}
        </div>
      </div>

      {/* ── BOTTOM: TWO PANELS ── */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>
        {/* LEFT — DB matched person */}
        <div>
          <div style={{ fontSize:11, fontWeight:700, color:'#94a3b8',
                        textTransform:'uppercase', letterSpacing:'0.8px', marginBottom:8 }}>
            📁 Registered Identity (DB Match)
          </div>
          <MatchedPersonCard
            matchedFace={matchedFace}
            scanCount={scanCount}
            processing={isProcessing}
          />
        </div>

        {/* RIGHT — captured frame + result */}
        <div>
          <div style={{ fontSize:11, fontWeight:700, color:'#94a3b8',
                        textTransform:'uppercase', letterSpacing:'0.8px', marginBottom:8 }}>
            📷 Captured Frame & Verdict
          </div>
          <ResultCard
            result={result}
            capturedFrame={capturedFrame}
            onTryAgain={isDone ? handleTryAgain : null}
          />
        </div>
      </div>

      {/* History Modal */}
      {showHistory && <HistoryModal onClose={() => setShowHistory(false)} />}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
