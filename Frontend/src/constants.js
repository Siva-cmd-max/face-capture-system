// API base URL — FastAPI backend
export const API_BASE = 'http://localhost:8000';

// Verification result status constants
export const STATUS = {
  VERIFIED: 'verified',
  NOT_MATCHED: 'not_matched',
  NO_FACE: 'no_face',
};

// Webcam scan interval (ms) — 1000ms saves disk space for captures
export const LIVE_SCAN_INTERVAL_MS = 1000;
