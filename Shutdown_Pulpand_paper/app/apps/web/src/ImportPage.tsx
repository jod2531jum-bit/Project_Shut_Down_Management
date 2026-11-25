import { useRef, useState } from 'react';
import { ApiError, api, type Review } from './api';
import { ReviewPanel } from './ReviewPanel';

export function ImportPage({ onCommitted }: { onCommitted: () => void }) {
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function send(file: File | undefined) {
    if (!file) return;
    setError(null); setBusy(true);
    try { setReview(await api.upload(file)); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Upload failed'); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  }

  if (review) return <ReviewPanel review={review} onChange={setReview} onDone={(committed) => { setReview(null); if (committed) onCommitted(); }} />;

  return (
    <section aria-label="Upload Shutdown Form">
      <h2 className="text-lg font-extrabold mb-1">Upload the Shutdown Form</h2>
      <p className="text-sm text-slate-600 mb-4 max-w-2xl">
        Use the workbook exactly as your team prepares it (.xlsx). Nothing goes live until you review the result and commit.
      </p>
      <label
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); send(e.dataTransfer.files[0]); }}
        className={`flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-16 cursor-pointer transition ${drag ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-white hover:border-slate-400'}`}
      >
        <span className="text-sm font-semibold text-slate-800">{busy ? 'Reading workbook…' : 'Drop the .xlsx here, or click to choose'}</span>
        <span className="text-xs text-slate-500">Max 25 MB · macro-enabled (.xlsm) and legacy (.xls) files are not accepted</span>
        <input ref={input} data-testid="file-input" type="file" accept=".xlsx" className="sr-only" disabled={busy} onChange={(e) => send(e.target.files?.[0])} />
      </label>
      {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
    </section>
  );
}
