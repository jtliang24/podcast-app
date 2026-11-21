import { useLayoutEffect, useRef } from 'react';
import type { Episode } from '../types';

export default function DownloadConfirmation({ episode, answer }: {
  episode: Episode | null;
  answer: (allow: boolean) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!episode) {
      if (dialog.open) dialog.close();
      return;
    }
    const open = () => {
      if (document.visibilityState === 'visible' && !document.querySelector('dialog:modal')) dialog.showModal();
    };
    open();
    document.addEventListener('close', open, true);
    return () => document.removeEventListener('close', open, true);
  }, [episode]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="cellular-download-heading"
      aria-describedby="cellular-download-description"
      onCancel={event => {
        event.preventDefault();
        answer(false);
      }}
      className="w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-6 text-white shadow-2xl backdrop:bg-black/70"
    >
      <h2 id="cellular-download-heading" className="text-lg font-bold">Download on Cellular?</h2>
      <p id="cellular-download-description" className="mt-2 break-words text-sm text-slate-300">
        Downloading “{episode?.title}” will use cellular data.
      </p>
      <div className="mt-5 flex justify-end gap-3">
        <button type="button" className="min-h-11 rounded-lg bg-slate-800 px-4 hover:bg-slate-700" onClick={() => answer(false)}>
          Cancel
        </button>
        <button type="button" className="min-h-11 rounded-lg bg-blue-600 px-4 font-semibold hover:bg-blue-700" onClick={() => answer(true)}>
          Download
        </button>
      </div>
    </dialog>
  );
}
