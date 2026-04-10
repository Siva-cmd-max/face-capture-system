import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { API_BASE } from '../constants';
import { Trash2, RefreshCw, Image, AlertCircle, Eye, X } from 'lucide-react';

const REASON_ICONS = {
  'No face': '👤',
  'Blurry': '🌫️',
  'multiple': '👥',
  'too small': '🔍',
  'Low lighting': '🌑',
  'Low light': '🌑',
  'resolution': '📐',
  'dark': '🌑',
  'blur': '🌫️',
};

function reasonIcon(reason = '') {
  const r = reason.toLowerCase();
  for (const [key, icon] of Object.entries(REASON_ICONS)) {
    if (r.includes(key.toLowerCase())) return icon;
  }
  return '⚠️';
}

// ── Image Preview Modal ───────────────────────────────────────────────────────
function ImageModal({ item, onClose }) {
  if (!item) return null;
  const imgUrl = `${API_BASE}/rejected-images/${item.id}/image`;

  return (
    <div
      id="rejected-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="glass-card p-6 max-w-lg w-full space-y-4 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <span className="badge-red text-xs uppercase">Rejected</span>
            <p className="text-xs text-slate-500 mt-1.5 font-mono">ID #{item.id}</p>
          </div>
          <button
            id="btn-close-modal"
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        {/* Image */}
        <div className="aspect-video bg-black/50 rounded-xl overflow-hidden flex items-center justify-center border border-white/10">
          <img
            src={imgUrl}
            alt="rejected face"
            className="max-h-full max-w-full object-contain"
            onError={(e) => {
              e.target.style.display = 'none';
              e.target.nextSibling.style.display = 'flex';
            }}
          />
          <div className="hidden flex-col items-center gap-2 text-slate-500" aria-label="image unavailable">
            <Image size={32} strokeWidth={1} />
            <p className="text-sm">Image file not found</p>
          </div>
        </div>

        {/* Reason */}
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertCircle size={18} className="text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-red-300 uppercase tracking-wider mb-1">Rejection Reason</p>
              <p className="text-sm text-red-200/90">{item.rejection_reason}</p>
            </div>
          </div>
        </div>

        <p className="text-xs text-slate-500 text-right font-mono">
          {new Date(item.created_at).toLocaleString()}
        </p>
      </div>
    </div>
  );
}

// ── Rejected Images Panel ─────────────────────────────────────────────────────
export default function RejectedPanel() {
  const [records, setRecords]     = useState([]);
  const [loading, setLoading]     = useState(false);
  const [selected, setSelected]   = useState(null);
  const [filter, setFilter]       = useState('');
  const [error, setError]         = useState(null);

  const fetchRecords = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data } = await axios.get(`${API_BASE}/rejected-images`);
      setRecords(data.data || []);
    } catch (err) {
      setError('Could not load rejected images. Ensure the backend is running.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const filtered = records.filter((r) =>
    filter === '' || r.rejection_reason.toLowerCase().includes(filter.toLowerCase())
  );

  // Reason summary counts
  const reasons = records.reduce((acc, r) => {
    const key = r.rejection_reason.split('—')[0].split(' — ')[0].trim();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <div className="animate-fade-in space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold grad-text-purple mb-1">Rejected Images</h2>
            <p className="text-sm text-slate-400">
              {records.length} total rejection{records.length !== 1 ? 's' : ''} with explainable reasons.
            </p>
          </div>
          <button
            id="btn-refresh-rejected"
            className="btn-secondary"
            onClick={fetchRecords}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {/* Summary chips */}
        {Object.keys(reasons).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(reasons).map(([reason, count]) => (
              <button
                key={reason}
                onClick={() => setFilter(filter === reason ? '' : reason)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  filter === reason
                    ? 'bg-purple-500/20 border-purple-500/50 text-purple-300'
                    : 'bg-white/5 border-white/10 text-slate-400 hover:border-purple-500/30 hover:text-slate-300'
                }`}
              >
                {reasonIcon(reason)} {reason.split(' ').slice(0, 3).join(' ')}
                <span className="ml-1.5 bg-white/10 px-1.5 py-0.5 rounded-full">{count}</span>
              </button>
            ))}
            {filter && (
              <button
                className="px-3 py-1.5 rounded-lg text-xs border border-white/10 text-slate-500 hover:text-slate-300 transition-colors"
                onClick={() => setFilter('')}
              >
                Clear filter
              </button>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/25 rounded-xl p-4">
            <AlertCircle size={18} className="text-red-400 shrink-0" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <div key={n} className="glass-card p-4 space-y-3 animate-pulse">
                <div className="aspect-video bg-white/5 rounded-lg" />
                <div className="h-3 bg-white/5 rounded w-3/4" />
                <div className="h-3 bg-white/5 rounded w-1/2" />
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && filtered.length === 0 && (
          <div className="glass-card p-12 text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mb-4">
              <Trash2 size={28} className="text-green-400/50" />
            </div>
            <p className="text-slate-400 font-medium">
              {filter ? 'No records match this filter' : 'No rejected images yet'}
            </p>
            <p className="text-slate-600 text-sm mt-1">
              {filter ? 'Try a different category' : 'All uploads have been accepted'}
            </p>
          </div>
        )}

        {/* Grid */}
        {!loading && filtered.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((item) => (
              <button
                key={item.id}
                id={`rejected-card-${item.id}`}
                className="glass-card p-4 text-left hover:border-purple-500/40 transition-all group hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-purple-500/40 space-y-3"
                onClick={() => setSelected(item)}
              >
                {/* Thumbnail */}
                <div className="aspect-video bg-black/40 rounded-lg overflow-hidden flex items-center justify-center relative border border-white/5">
                  <img
                    src={`${API_BASE}/rejected-images/${item.id}/image`}
                    alt={`rejected-${item.id}`}
                    className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.nextSibling.style.display = 'flex';
                    }}
                  />
                  <div className="hidden w-full h-full items-center justify-center" aria-label="no image">
                    <Image size={28} className="text-slate-600" />
                  </div>

                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-purple-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Eye size={20} className="text-white" />
                  </div>

                  <div className="absolute top-2 right-2">
                    <span className="badge-red text-xs">#{ item.id}</span>
                  </div>
                </div>

                {/* Reason */}
                <div className="space-y-1">
                  <div className="flex items-start gap-2">
                    <span className="text-base leading-none mt-0.5">{reasonIcon(item.rejection_reason)}</span>
                    <p className="text-xs text-slate-300 leading-relaxed line-clamp-2">{item.rejection_reason}</p>
                  </div>
                  <p className="text-xs text-slate-600 font-mono pl-6">
                    {new Date(item.created_at).toLocaleDateString()} {new Date(item.created_at).toLocaleTimeString()}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {selected && <ImageModal item={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
