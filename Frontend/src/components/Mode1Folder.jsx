/**
 * Mode1Folder.jsx — Mode 1: Bulk Folder Registration
 *
 * Features:
 *  • Folder picker → batch-processes all images
 *  • Real-time results table WITH thumbnail column
 *  • Image Gallery view after scan (filter: All / Registered / Duplicate / Failed)
 *  • Click any image card → full preview modal
 *  • Emergency Upload: drag-drop + browse + CLIPBOARD PASTE (Ctrl+V)
 *  • Emergency upload shows image thumbnails in its results table
 *  • Copy image path / name button on each card
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import axios from 'axios';
import { API_BASE } from '../constants';
import {
  FolderOpen, CheckCircle, XCircle, AlertCircle, Clock,
  Upload, Zap, BarChart2, RefreshCw, AlertTriangle,
  Images, List, X, Copy, Check, Download, Image
} from 'lucide-react';

/* ─────────────────────────────────────────────
   STATUS CONFIG
───────────────────────────────────────────── */
const STATUS_META = {
  registered: { icon: '✅', label: 'Registered', cls: 'badge-green',
                border:'#bbf7d0', bg:'rgba(16,185,129,0.05)', text:'#15803d' },
  duplicate:  { icon: '⚠️', label: 'Duplicate',  cls: 'badge-amber',
                border:'#fde68a', bg:'rgba(245,158,11,0.05)', text:'#d97706' },
  failed:     { icon: '❌', label: 'Face Failed',cls: 'badge-red',
                border:'#fecaca', bg:'rgba(239,68,68,0.05)',  text:'#dc2626' },
  processing: { icon: '🔄', label: 'Processing…',cls: 'badge-neutral',
                border:'#e2e8f0', bg:'rgba(0,0,0,0.02)',      text:'#64748b' },
};

/* ─────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────── */
function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
const fmtMs  = ms  => ms  == null ? '—' : `${ms} ms`;
const fmtSec = s   => s   == null ? '—' : `${Number(s).toFixed(1)}s`;

/* ─────────────────────────────────────────────
   COPY BUTTON (with ✓ feedback)
───────────────────────────────────────────── */
function CopyBtn({ text, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);
  const doCopy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <button
      onClick={doCopy}
      title={`Copy: ${text}`}
      style={{ display:'inline-flex', alignItems:'center', gap:4,
               padding:'3px 8px', borderRadius:6, border:'1px solid #e2e8f0',
               background:'#f8fafc', cursor:'pointer', fontSize:11, color:'#6366f1',
               fontWeight:700, flexShrink:0 }}
    >
      {copied ? <><Check size={11} /> Copied!</> : <><Copy size={11} /> {label}</>}
    </button>
  );
}

/* ─────────────────────────────────────────────
   PROGRESS BAR
───────────────────────────────────────────── */
function ProgressBar({ done, total }) {
  const pct = total > 0 ? Math.floor((done / total) * 100) : 0;
  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6,
                    fontSize:13, fontWeight:700, color:'#475569' }}>
        <span>{done} / {total} images processed</span>
        <span style={{ color:'#6366f1', fontFamily:'monospace' }}>{pct}%</span>
      </div>
      <div style={{ height:10, background:'#e2e8f0', borderRadius:99, overflow:'hidden' }}>
        <div style={{
          height:'100%', width:`${pct}%`,
          background:'linear-gradient(90deg,#6366f1,#8b5cf6)',
          borderRadius:99, transition:'width 0.25s ease',
          boxShadow:'0 0 8px rgba(99,102,241,0.4)',
        }} />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   IMAGE PREVIEW MODAL
───────────────────────────────────────────── */
function PreviewModal({ item, onClose }) {
  if (!item) return null;
  const meta = STATUS_META[item.status] || STATUS_META.processing;
  return (
    <div
      style={{ position:'fixed', inset:0, zIndex:2000,
               background:'rgba(15,23,42,0.8)', backdropFilter:'blur(8px)',
               display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}
      onClick={onClose}
    >
      <div
        style={{ background:'#fff', borderRadius:24, maxWidth:540, width:'100%',
                 boxShadow:'0 32px 80px rgba(0,0,0,0.3)', overflow:'hidden' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding:'18px 22px', borderBottom:'1px solid #e2e8f0',
                      display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:800, fontSize:15, color:'#1e293b',
                          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}
                 title={item.image_name}>
              {item.image_name}
            </div>
            <div style={{ fontSize:11, color:'#94a3b8', marginTop:2, fontFamily:'monospace' }}>
              Status: <strong style={{ color: meta.text }}>{meta.label}</strong>
            </div>
          </div>
          <CopyBtn text={item.image_name} label="Copy Name" />
          <button onClick={onClose} style={{ background:'#f1f5f9', border:'none',
                                             borderRadius:8, padding:'6px 8px', cursor:'pointer' }}>
            <X size={16} color="#64748b" />
          </button>
        </div>

        {/* Image */}
        <div style={{ background:'#0f172a', display:'flex', alignItems:'center',
                      justifyContent:'center', minHeight:200, maxHeight:360, overflow:'hidden' }}>
          {item.preview ? (
            <img src={item.preview} alt={item.image_name}
                 style={{ maxWidth:'100%', maxHeight:360, objectFit:'contain', display:'block' }} />
          ) : (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8 }}>
              <Image size={40} color="#334155" />
              <span style={{ color:'#475569', fontSize:12 }}>Preview not available</span>
            </div>
          )}
        </div>

        {/* Info */}
        <div style={{ padding:20, display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:13 }}>
            <span style={{ color:'#94a3b8', fontWeight:600 }}>Status</span>
            <span className={meta.cls} style={{ fontSize:11 }}>{meta.icon} {meta.label}</span>
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:13 }}>
            <span style={{ color:'#94a3b8', fontWeight:600 }}>Scan Time</span>
            <span style={{ fontFamily:'monospace', fontWeight:700,
                           color: (item.time_ms || 999) <= 200 ? '#6366f1' : '#f59e0b' }}>
              {fmtMs(item.time_ms)}
            </span>
          </div>
          {item.reason && (
            <div style={{ background:'#f8fafc', borderRadius:12, padding:'10px 14px',
                          border:'1px solid #e2e8f0', fontSize:12, color:'#475569',
                          wordBreak:'break-word' }}>
              <span style={{ fontWeight:700, color:'#334155' }}>Details: </span>
              {item.reason}
            </div>
          )}

          {/* Download button (only if we have a preview) */}
          {item.preview && (
            <a
              href={item.preview}
              download={item.image_name}
              style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:6,
                       padding:'10px 16px', borderRadius:12, textDecoration:'none',
                       background:'linear-gradient(90deg,#6366f1,#8b5cf6)',
                       color:'#fff', fontWeight:700, fontSize:13 }}
            >
              <Download size={14} /> Download Image
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   RESULTS TABLE (with thumbnail + copy btn)
───────────────────────────────────────────── */
function ResultsTable({ rows, caption, onClickRow }) {
  if (!rows.length) return null;
  return (
    <div className="minimal-card" style={{ overflow:'hidden', marginTop:16 }}>
      {caption && (
        <div style={{ padding:'12px 20px', borderBottom:'1px solid #e2e8f0',
                      fontSize:12, fontWeight:700, color:'#64748b',
                      textTransform:'uppercase', letterSpacing:1 }}>
          {caption}
        </div>
      )}
      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          <thead>
            <tr style={{ background:'#f8fafc', borderBottom:'1px solid #e2e8f0' }}>
              {['#', 'Preview', 'Image Name', 'Face', 'Status', 'Time', 'Similarity', 'Details', ''].map(h => (
                <th key={h} style={{ padding:'10px 14px', textAlign:'left',
                                     fontWeight:700, color:'#64748b',
                                     textTransform:'uppercase', fontSize:10,
                                     letterSpacing:'0.8px', whiteSpace:'nowrap' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const meta = STATUS_META[r.status] || STATUS_META.processing;
              const faceDetected = r.face_detected;
              return (
                <tr key={i}
                    onClick={() => onClickRow && onClickRow(r)}
                    style={{
                      borderBottom: i < rows.length - 1 ? '1px solid #f1f5f9' : 'none',
                      background: r.status === 'processing' ? '#fafbff' : 'transparent',
                      transition:'background 0.15s',
                      cursor: onClickRow ? 'pointer' : 'default',
                    }}
                    onMouseEnter={e => { if (onClickRow) e.currentTarget.style.background='#f8faff'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = r.status === 'processing' ? '#fafbff' : 'transparent'; }}
                >
                  {/* # */}
                  <td style={{ padding:'8px 14px', fontFamily:'monospace',
                               color:'#94a3b8', fontWeight:600, fontSize:11 }}>{i + 1}</td>

                  {/* Thumbnail */}
                  <td style={{ padding:'6px 14px' }}>
                    {r.preview ? (
                      <div style={{ width:40, height:40, borderRadius:8, overflow:'hidden',
                                    border:`1.5px solid ${meta.border}`,
                                    background:'#f1f5f9', flexShrink:0 }}>
                        <img src={r.preview} alt=""
                             style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />
                      </div>
                    ) : (
                      <div style={{ width:40, height:40, borderRadius:8, background:'#f1f5f9',
                                    border:'1.5px solid #e2e8f0',
                                    display:'flex', alignItems:'center', justifyContent:'center' }}>
                        {r.status === 'processing'
                          ? <div style={{ width:16, height:16, borderRadius:'50%',
                                          border:'2px solid rgba(99,102,241,0.3)',
                                          borderTop:'2px solid #6366f1',
                                          animation:'spin 0.8s linear infinite' }} />
                          : <Image size={16} color="#cbd5e1" />}
                      </div>
                    )}
                  </td>

                  {/* Name */}
                  <td style={{ padding:'8px 14px', maxWidth:160 }}>
                    <span style={{ fontFamily:'monospace', fontSize:11,
                                   color:'#334155', fontWeight:600,
                                   overflow:'hidden', textOverflow:'ellipsis',
                                   whiteSpace:'nowrap', display:'block' }}
                          title={r.image_name}>
                      {r.image_name}
                    </span>
                  </td>

                  {/* Face detected */}
                  <td style={{ padding:'8px 14px' }}>
                    {r.status === 'processing' ? (
                      <span style={{ fontSize:11, color:'#94a3b8' }}>…</span>
                    ) : faceDetected === false ? (
                      <span title="No face detected"
                            style={{ fontSize:18, lineHeight:1 }}>🚫</span>
                    ) : faceDetected === true ? (
                      <span title="Face detected"
                            style={{ fontSize:18, lineHeight:1 }}>✅</span>
                    ) : (
                      <span style={{ fontSize:11, color:'#cbd5e1' }}>—</span>
                    )}
                  </td>

                  {/* Status */}
                  <td style={{ padding:'8px 14px' }}>
                    <span className={meta.cls}
                          style={{ display:'inline-flex', alignItems:'center', gap:4,
                                   fontSize:10, fontWeight:700, padding:'3px 8px',
                                   borderRadius:6, whiteSpace:'nowrap' }}>
                      {meta.icon} {meta.label}
                    </span>
                  </td>

                  {/* Time */}
                  <td style={{ padding:'8px 14px', fontFamily:'monospace', fontWeight:700,
                               fontSize:11,
                               color: r.time_ms <= 200 ? '#6366f1' : '#f59e0b' }}>
                    {fmtMs(r.time_ms)}
                  </td>

                  {/* Similarity */}
                  <td style={{ padding:'8px 14px', fontFamily:'monospace', fontSize:11 }}>
                    {r.similarity != null ? (
                      <span style={{
                        fontWeight:800,
                        color: r.similarity >= 95
                          ? '#dc2626'   // red — very high similar → duplicate
                          : r.similarity >= 80
                          ? '#f59e0b'   // amber — similar
                          : '#22c55e',  // green — different person — good
                      }}>
                        {r.similarity.toFixed(1)}%
                      </span>
                    ) : (
                      <span style={{ color:'#cbd5e1' }}>—</span>
                    )}
                  </td>

                  {/* Details */}
                  <td style={{ padding:'8px 14px', fontSize:11, color:'#64748b', maxWidth:200 }}>
                    <span style={{ overflow:'hidden', textOverflow:'ellipsis',
                                   whiteSpace:'nowrap', display:'block' }}
                          title={r.reason}>
                      {r.reason || '—'}
                    </span>
                  </td>

                  {/* Copy name button */}
                  <td style={{ padding:'8px 14px' }}>
                    <CopyBtn text={r.image_name} label="Copy" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   GALLERY VIEW  (cards by status)
───────────────────────────────────────────── */

function GalleryView({ rows, onClickItem }) {
  const [filter, setFilter] = useState('all');

  const counts = {
    all:        rows.length,
    registered: rows.filter(r => r.status === 'registered').length,
    duplicate:  rows.filter(r => r.status === 'duplicate').length,
    failed:     rows.filter(r => r.status === 'failed').length,
  };

  const filtered = filter === 'all' ? rows : rows.filter(r => r.status === filter);
  const TABS = [
    { key:'all',        label:'All',        color:'#6366f1' },
    { key:'registered', label:'✅ Registered',color:'#15803d' },
    { key:'duplicate',  label:'⚠️ Duplicate', color:'#d97706' },
    { key:'failed',     label:'❌ Failed',    color:'#dc2626' },
  ];

  return (
    <div style={{ marginTop:20 }}>
      {/* Filter tabs */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16 }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            style={{
              padding:'7px 16px', borderRadius:99, fontSize:12, fontWeight:700,
              cursor:'pointer', border:'1.5px solid',
              borderColor: filter === t.key ? t.color : '#e2e8f0',
              background:  filter === t.key ? t.color : '#fff',
              color:       filter === t.key ? '#fff' : '#475569',
              transition:'all 0.18s',
            }}
          >
            {t.label}
            <span style={{ marginLeft:6, opacity:0.75, fontSize:11 }}>({counts[t.key]})</span>
          </button>
        ))}
      </div>

      {/* Cards */}
      {filtered.length === 0 ? (
        <div style={{ textAlign:'center', padding:40, color:'#94a3b8', fontSize:13 }}>
          No images in this category
        </div>
      ) : (
        <div style={{
          display:'grid',
          gridTemplateColumns:'repeat(auto-fill, minmax(160px, 1fr))',
          gap:14,
        }}>
          {filtered.map((item, i) => {
            const meta = STATUS_META[item.status] || STATUS_META.processing;
            return (
              <div
                key={i}
                onClick={() => onClickItem && onClickItem(item)}
                style={{
                  borderRadius:16, overflow:'hidden',
                  border:`1.5px solid ${meta.border}`,
                  background: meta.bg,
                  cursor:'pointer',
                  transition:'transform 0.15s, box-shadow 0.15s',
                  boxShadow:'0 2px 8px rgba(0,0,0,0.06)',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.transform = 'translateY(-3px)';
                  e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.1)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)';
                }}
              >
                {/* Image */}
                <div style={{ position:'relative', background:'#e2e8f0',
                              aspectRatio:'1/1', overflow:'hidden' }}>
                  {item.preview ? (
                    <img src={item.preview} alt={item.image_name}
                         style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />
                  ) : (
                    <div style={{ width:'100%', height:'100%', display:'flex',
                                  alignItems:'center', justifyContent:'center', background:'#f1f5f9' }}>
                      <Image size={28} color="#cbd5e1" />
                    </div>
                  )}

                  {/* Status badge on image */}
                  <div style={{
                    position:'absolute', top:7, left:7,
                    background: meta.text, color:'#fff',
                    fontWeight:800, fontSize:9, padding:'2px 7px',
                    borderRadius:99,
                  }}>
                    {meta.label.toUpperCase()}
                  </div>
                </div>

                {/* Info */}
                <div style={{ padding:'10px 12px', display:'flex', flexDirection:'column', gap:5 }}>
                  <p style={{ margin:0, fontSize:11, fontWeight:700, color:'#1e293b',
                              overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}
                     title={item.image_name}>
                    {item.image_name}
                  </p>
                  <p style={{ margin:0, fontSize:10, fontFamily:'monospace',
                              color: (item.time_ms || 999) <= 200 ? '#6366f1' : '#f59e0b',
                              fontWeight:700 }}>
                    {fmtMs(item.time_ms)}
                  </p>
                  {item.reason && (
                    <p style={{ margin:0, fontSize:10, color:'#94a3b8',
                                overflow:'hidden', textOverflow:'ellipsis',
                                whiteSpace:'nowrap', lineHeight:'1.3' }}
                       title={item.reason}>
                      {item.reason}
                    </p>
                  )}
                  <CopyBtn text={item.image_name} label="Copy Name" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   SUMMARY CARD (with clickable status chips)
───────────────────────────────────────────── */
function SummaryCard({ summary, onGoLive, onFilterGallery }) {
  if (!summary) return null;
  const { total, registered, duplicate, failed,
          total_time_sec, avg_time_ms, folder_name } = summary;

  return (
    <div className="minimal-card" style={{
      padding:28, marginTop:20,
      border:'2px solid #c7d2fe',
      background:'linear-gradient(135deg,#eef2ff 0%,#f5f3ff 100%)',
      borderRadius:24,
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
        <div style={{ background:'#6366f1', borderRadius:12, padding:8 }}>
          <BarChart2 size={20} color="#fff" />
        </div>
        <div>
          <div style={{ fontWeight:800, fontSize:16, color:'#1e293b' }}>
            Folder Processing Complete
          </div>
          <div style={{ fontSize:12, color:'#64748b', fontFamily:'monospace' }}>{folder_name}</div>
        </div>
      </div>

      {/* Stat tiles — each is clickable to filter the gallery */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:20 }}>
        {[
          { label:'Total Images',  value:total,      color:'#6366f1', filter:null        },
          { label:'✅ Registered', value:registered, color:'#10b981', filter:'registered'},
          { label:'⚠️ Duplicate',  value:duplicate,  color:'#f59e0b', filter:'duplicate' },
          { label:'❌ Failed',     value:failed,     color:'#ef4444', filter:'failed'    },
          { label:'⏱️ Total Time', value:fmtSec(total_time_sec), color:'#6366f1', filter:null },
          { label:'⚡ Avg/image',  value:fmtMs(avg_time_ms),    color:'#8b5cf6', filter:null },
        ].map(({ label, value, color, filter }) => (
          <div
            key={label}
            onClick={() => filter && onFilterGallery && onFilterGallery(filter)}
            style={{
              background:'#fff', borderRadius:16, padding:'14px 16px',
              border:'1px solid #e2e8f0', textAlign:'center',
              cursor: filter ? 'pointer' : 'default',
              transition:'transform 0.15s, box-shadow 0.15s',
            }}
            onMouseEnter={e => { if (filter) {
              e.currentTarget.style.transform='translateY(-2px)';
              e.currentTarget.style.boxShadow='0 6px 20px rgba(0,0,0,0.08)';
            }}}
            onMouseLeave={e => {
              e.currentTarget.style.transform='translateY(0)';
              e.currentTarget.style.boxShadow='none';
            }}
          >
            <div style={{ fontSize:22, fontWeight:900, color, fontFamily:'monospace' }}>{value}</div>
            <div style={{ fontSize:11, color:'#94a3b8', marginTop:4, fontWeight:600 }}>{label}</div>
            {filter && <div style={{ fontSize:9, color, marginTop:3, fontWeight:700 }}>
              Click to view →
            </div>}
          </div>
        ))}
      </div>

      <button
        className="btn-primary"
        style={{ width:'100%', padding:'14px 24px', fontSize:14, borderRadius:16 }}
        onClick={onGoLive}
      >
        <Zap size={16} />
        → Go to Live Detection (Mode 2)
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────
   EMERGENCY SINGLE UPLOAD
   – drag-drop  – browse  – CLIPBOARD PASTE
───────────────────────────────────────────── */
function EmergencyUpload() {
  const [dragging,  setDragging]  = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [rows,      setRows]      = useState([]);
  const [preview,   setPreview]   = useState(null); // preview modal item
  const [pasteHint, setPasteHint] = useState(false);
  const fileRef     = useRef(null);
  const zoneRef     = useRef(null);

  /* ── paste from clipboard ── */
  useEffect(() => {
    const handlePaste = async (e) => {
      const items = e.clipboardData?.items || [];
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            const named = new File([file], `pasted_${Date.now()}.png`, { type: file.type });
            await processFile(named);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []); // eslint-disable-line

  const processFile = useCallback(async (file) => {
    if (!file) return;
    const name    = file.name;
    const b64     = await fileToBase64(file);   // keep for thumbnail

    setRows(prev => [...prev, {
      image_name: name, status: 'processing',
      time_ms: null, reason: '', preview: b64,
    }]);
    setLoading(true);

    const form = new FormData();
    form.append('file', file);

    try {
      const { data } = await axios.post(`${API_BASE}/single-register`, form);
      setRows(prev => prev.map(r =>
        r.image_name === name
          ? { ...r, status: data.status, time_ms: data.time_ms,
              reason: data.reason || '' }
          : r
      ));
    } catch {
      setRows(prev => prev.map(r =>
        r.image_name === name
          ? { ...r, status:'failed', time_ms:null, reason:'Server error' }
          : r
      ));
    } finally {
      setLoading(false);
    }
  }, []);

  const onDrop = useCallback(e => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  return (
    <div className="minimal-card" style={{ padding:28, marginTop:32 }}>
      {/* Heading */}
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:16 }}>
        <div style={{ background:'#fef3c7', borderRadius:12, padding:10,
                      border:'1px solid #fde68a' }}>
          <AlertTriangle size={20} color="#d97706" />
        </div>
        <div style={{ flex:1 }}>
          <h3 style={{ margin:0, fontSize:17, fontWeight:800, color:'#1e293b' }}>
            Emergency Single Image Upload
          </h3>
          <p style={{ margin:0, fontSize:12, color:'#94a3b8', marginTop:3 }}>
            Use for images that failed in the folder scan.
            Use this for images that failed in the folder scan.
            <strong style={{ color:'#6366f1' }}>&nbsp;Ctrl+V</strong> to paste from clipboard!
          </p>
        </div>
        {/* Paste hint button */}
        <button
          onClick={() => { setPasteHint(p => !p); zoneRef.current?.focus(); }}
          style={{ padding:'8px 14px', borderRadius:10, border:'1.5px solid #c7d2fe',
                   background:'#eef2ff', color:'#6366f1', fontWeight:700,
                   fontSize:12, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}
        >
          📋 Paste Image
        </button>
      </div>

      {/* Paste hint */}
      {pasteHint && (
        <div style={{ marginBottom:12, padding:'10px 16px', borderRadius:12,
                      background:'#fef9c3', border:'1px solid #fef08a',
                      fontSize:12, color:'#854d0e', fontWeight:600 }}>
          ⌨️ Press <strong>Ctrl+V</strong> (or ⌘+V on Mac) anywhere on this page to paste a copied image directly!
        </div>
      )}

      {/* Drop zone */}
      <div
        ref={zoneRef}
        tabIndex={0}
        className={`drop-zone ${dragging ? 'drag-over' : ''}`}
        style={{ padding:32, cursor:'pointer', outline:'none' }}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
      >
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:10 }}>
          {loading ? (
            <div style={{ width:40, height:40, borderRadius:'50%',
                          border:'3px solid rgba(99,102,241,0.3)',
                          borderTop:'3px solid #6366f1',
                          animation:'spin 0.8s linear infinite' }} />
          ) : (
            <div style={{ background:'#fff', padding:14, borderRadius:'50%',
                          border:'1px solid #e2e8f0',
                          boxShadow:'0 2px 8px rgba(99,102,241,0.12)' }}>
              <Upload size={26} color="#6366f1" />
            </div>
          )}
          <div style={{ textAlign:'center' }}>
            <p style={{ margin:0, fontSize:14, fontWeight:700, color:'#334155' }}>
              {loading ? 'Processing image…' : 'Drop image • Click to browse • Ctrl+V to paste'}
            </p>
            <p style={{ margin:'4px 0 0', fontSize:12, color:'#94a3b8' }}>
              JPG, PNG, WEBP — auto-processes immediately
            </p>
          </div>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display:'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f); e.target.value=''; }}
      />

      {/* Results table */}
      {rows.length > 0 && (
        <ResultsTable
          rows={rows}
          caption={`Emergency Upload Results — ${rows.length} image${rows.length > 1 ? 's' : ''}`}
          onClickRow={setPreview}
        />
      )}

      {/* Preview modal */}
      {preview && <PreviewModal item={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

/* ─────────────────────────────────────────────
   MAIN MODE 1 FOLDER COMPONENT
───────────────────────────────────────────── */
const BATCH_SIZE = 1;  // Send one image at a time — prevents network timeouts, updates UI in real-time

export default function Mode1Folder({ onNavigateToMode2 }) {
  const [scanning,    setScanning]    = useState(false);
  const [rows,        setRows]        = useState([]);   // {image_name,status,time_ms,reason,preview}
  const [summary,     setSummary]     = useState(null);
  const [elapsed,     setElapsed]     = useState(0);
  const [totalFiles,  setTotalFiles]  = useState(0);
  const [done,        setDone]        = useState(0);
  const [viewMode,    setViewMode]    = useState('table'); // 'table' | 'gallery'
  const [galleryFilter, setGalleryFilter] = useState('all');
  const [previewItem, setPreviewItem] = useState(null);
  const [backendStatus, setBackendStatus] = useState('');  // warming up message

  const timerRef      = useRef(null);
  const folderInputRef = useRef(null);

  // Elapsed timer
  useEffect(() => {
    if (scanning) {
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [scanning]);

  const eta = done > 0 && totalFiles > done
    ? Math.ceil((elapsed / done) * (totalFiles - done))
    : null;

  const processFolder = useCallback(async (files) => {
    if (!files || files.length === 0) return;

    const imgFiles = Array.from(files).filter(f =>
      f.type.startsWith('image/') || /\.(jpe?g|png|webp|bmp|gif)$/i.test(f.name)
    );
    if (imgFiles.length === 0) return;

    setScanning(true);
    setSummary(null);
    setElapsed(0);
    setDone(0);
    setTotalFiles(imgFiles.length);
    setViewMode('table');
    setGalleryFilter('all');

    // Build a preview map {name -> base64} and seed rows
    const previewMap = {};
    const seededRows = await Promise.all(imgFiles.map(async f => {
      const b64 = await fileToBase64(f);
      previewMap[f.name] = b64;
      return { image_name: f.name, status: 'processing', time_ms: null, reason: '', preview: b64 };
    }));
    setRows(seededRows);

    const folderName = (() => {
      const p = imgFiles[0]?.webkitRelativePath || '';
      return p.split('/')[0] || 'selected_folder';
    })();

    let allResults = [];

    // ── Backend health check + warmup wait ─────────────────────────────────
    // Without this, if the backend is still loading (model warmup ~15s),
    // every image gets "Network error" immediately.
    try {
      let ready = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        try {
          setBackendStatus(attempt === 0 ? '🔌 Connecting to backend...' : `⏳ AI engine warming up... (${attempt * 2}s)`);
          const { data: health } = await axios.get(`${API_BASE}/health`, { timeout: 5000 });
          if (health?.model_ready === true || health?.status === 'ok') {
            ready = true;
            setBackendStatus('');
            break;
          }
          // Model still warming up — wait and retry
          await new Promise(r => setTimeout(r, 2000));
        } catch {
          // Backend not running yet — wait and retry
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      if (!ready) {
        // After 60s still not ready — abort with clear message
        setBackendStatus('❌ Backend not running. Start start_backend.bat first.');
        setRows(prev => prev.map(r => ({
          ...r, status: 'failed',
          reason: '❌ Backend not running. Please start start_backend.bat first.'
        })));
        setScanning(false);
        return;
      }
    } catch {
      // ignore — proceed anyway
      setBackendStatus('');
    }


    for (let start = 0; start < imgFiles.length; start += BATCH_SIZE) {
      const batch = imgFiles.slice(start, start + BATCH_SIZE);

      const batchItems = batch.map(f => ({
        image_name:   f.name,
        image_base64: previewMap[f.name],
      }));

      try {
        const { data } = await axios.post(`${API_BASE}/bulk-register`, {
          folder_name: folderName,
          images: batchItems,
        }, {
          timeout: 60000,  // 60s per single image — more than enough
        });

        const batchResults = data.results || [];
        allResults = [...allResults, ...batchResults];

        setRows(prev => {
          const updated = [...prev];
          batchResults.forEach(br => {
            const idx = updated.findIndex(r => r.image_name === br.image_name);
            if (idx !== -1) {
              updated[idx] = {
                image_name: br.image_name,
                status:     br.status,
                time_ms:    br.time_ms,
                reason:     br.reason || '',
                preview:    previewMap[br.image_name] || null,
              };
            }
          });
          return updated;
        });

        setDone(prev => prev + batchResults.length);

      } catch (err) {
        // Show exact server error so issue is immediately visible in UI
        const serverMsg  = err?.response?.data?.message || err?.response?.data?.detail || '';
        const httpStatus = err?.response?.status ? `HTTP ${err.response.status}` : '';
        const netMsg     = err?.code === 'ECONNREFUSED' ? '❌ Backend not running — start start_backend.bat'
                         : err?.code === 'ETIMEDOUT'   ? '⏱ Backend timeout — restart backend'
                         : err?.message || 'Network error';
        const errMsg = serverMsg || `${httpStatus} ${netMsg}`.trim();

        setRows(prev => {
          const updated = [...prev];
          batch.forEach(f => {
            const idx = updated.findIndex(r => r.image_name === f.name);
            if (idx !== -1) {
              updated[idx] = { ...updated[idx], status:'failed', reason: `❌ ${errMsg}` };
            }
          });
          return updated;
        });
        setDone(prev => prev + batch.length);
      }
    }

    // Summary
    const reg  = allResults.filter(r => r.status === 'registered').length;
    const dup  = allResults.filter(r => r.status === 'duplicate').length;
    const fail = allResults.filter(r => r.status === 'failed').length;
    const timings = allResults.filter(r => r.time_ms != null).map(r => r.time_ms);
    const avgMs = timings.length > 0
      ? Math.round(timings.reduce((a,b) => a+b, 0) / timings.length)
      : 0;

    setSummary({
      total: imgFiles.length, registered: reg, duplicate: dup, failed: fail,
      total_time_sec: elapsed + 1, avg_time_ms: avgMs, folder_name: folderName,
    });
    setScanning(false);
  }, [elapsed]);

  const handleFolderChange = useCallback(e => {
    processFolder(e.target.files);
    e.target.value = '';
  }, [processFolder]);

  // When user clicks a stat tile in summary card → switch to gallery with that filter
  const handleSummaryFilter = (filter) => {
    setGalleryFilter(filter);
    setViewMode('gallery');
    // Scroll to gallery
    setTimeout(() => {
      document.getElementById('scan-results-section')?.scrollIntoView({ behavior:'smooth' });
    }, 100);
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:0 }}>

      {/* ── HEADER ── */}
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:24 }}>
        <div style={{ background:'linear-gradient(135deg,#6366f1,#8b5cf6)',
                      borderRadius:14, padding:'10px 12px' }}>
          <FolderOpen size={24} color="#fff" />
        </div>
        <div>
          <h2 style={{ margin:0, fontSize:22, fontWeight:800, color:'#1e293b' }}>
            Mode 1 — Folder Upload (Bulk Register)
          </h2>
          <p style={{ margin:'3px 0 0', fontSize:13, color:'#64748b' }}>
            Select a folder to bulk-register all faces. Duplicate detection: hash + face embedding.
          </p>
        </div>
      </div>

      {/* ── CONTROLS CARD ── */}
      <div className="minimal-card" style={{ padding:28 }}>
        <div style={{ display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
          <button
            className="btn-primary"
            style={{ padding:'13px 28px', fontSize:14, borderRadius:14,
                     opacity: scanning ? 0.6 : 1 }}
            onClick={() => !scanning && folderInputRef.current?.click()}
            disabled={scanning}
          >
            {scanning ? (
              <>
                <div style={{ width:16, height:16, borderRadius:'50%',
                              border:'2.5px solid rgba(255,255,255,0.4)',
                              borderTop:'2.5px solid white',
                              animation:'spin 0.8s linear infinite' }} />
                Scanning Folder…
              </>
            ) : (
              <><FolderOpen size={17} /> Select Folder</>
            )}
          </button>
          <input
            ref={folderInputRef}
            type="file"
            // @ts-ignore
            webkitdirectory="true"
            directory="true"
            multiple
            accept="image/*"
            style={{ display:'none' }}
            onChange={handleFolderChange}
          />

          {/* View toggle — only when results exist */}
          {rows.length > 0 && !scanning && (
            <div style={{ display:'flex', border:'1.5px solid #e2e8f0', borderRadius:12,
                          overflow:'hidden', background:'#f8fafc' }}>
              {[
                { k:'table',   label:'☰ Table',   icon:<List size={14} /> },
                { k:'gallery', label:'⊞ Gallery',  icon:<Images size={14} /> },
              ].map(v => (
                <button
                  key={v.k}
                  onClick={() => setViewMode(v.k)}
                  style={{
                    padding:'8px 16px', border:'none', cursor:'pointer',
                    fontSize:12, fontWeight:700,
                    display:'flex', alignItems:'center', gap:6,
                    background: viewMode === v.k
                      ? 'linear-gradient(90deg,#6366f1,#8b5cf6)' : 'transparent',
                    color: viewMode === v.k ? '#fff' : '#64748b',
                    transition:'all 0.2s',
                  }}
                >
                  {v.icon} {v.label}
                </button>
              ))}
            </div>
          )}

          {/* Timer */}
          {scanning && (
            <div style={{ display:'flex', gap:20, flexWrap:'wrap' }}>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <Clock size={14} color="#6366f1" />
                <span style={{ fontSize:13, fontWeight:700, color:'#6366f1',
                               fontFamily:'monospace' }}>
                  {elapsed}s elapsed
                </span>
              </div>
              {eta != null && (
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <RefreshCw size={14} color="#94a3b8" />
                  <span style={{ fontSize:13, color:'#94a3b8', fontFamily:'monospace' }}>
                    ~{eta}s remaining
                  </span>
                </div>
              )}
            </div>
          )}

          {!scanning && totalFiles > 0 && (
            <span style={{ fontSize:13, color:'#94a3b8' }}>
              {totalFiles} images processed
            </span>
          )}
        </div>

        {totalFiles > 0 && (
          <div style={{ marginTop:20 }}>
            <ProgressBar done={done} total={totalFiles} />
          </div>
        )}
      </div>

      {/* ── RESULTS (TABLE or GALLERY) ── */}
      {rows.length > 0 && (
        <div id="scan-results-section">
          {viewMode === 'table' ? (
            <ResultsTable
              rows={rows}
              caption={`Scan Results — ${rows.length} images (click row to preview)`}
              onClickRow={setPreviewItem}
            />
          ) : (
            <div className="minimal-card" style={{ padding:24, marginTop:16 }}>
              <div style={{ fontSize:12, fontWeight:700, color:'#64748b',
                            textTransform:'uppercase', letterSpacing:1, marginBottom:4 }}>
                Image Gallery — click any photo to preview
              </div>
              <GalleryView
                rows={rows}
                onClickItem={setPreviewItem}
              />
            </div>
          )}
        </div>
      )}

      {/* ── SUMMARY ── */}
      {summary && (
        <SummaryCard
          summary={summary}
          onGoLive={() => onNavigateToMode2 && onNavigateToMode2()}
          onFilterGallery={handleSummaryFilter}
        />
      )}

      {/* ── EMERGENCY UPLOAD ── */}
      <EmergencyUpload />

      {/* ── PREVIEW MODAL ── */}
      {previewItem && (
        <PreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .badge-amber {
          background:#fef3c7; color:#d97706;
          border:1px solid #fde68a;
          padding:3px 8px; border-radius:6px;
          font-size:10px; font-weight:700;
          text-transform:uppercase; letter-spacing:0.5px;
        }
      `}</style>
    </div>
  );
}
