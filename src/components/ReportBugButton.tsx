import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Bug, Camera, ExternalLink, X } from 'lucide-react';
import { isAndroid } from '../services/android';
import { canCaptureScreenshot, captureScreenshot, collectPlatformInfo, newIssueUrl, saveAndroidScreenshot } from '../services/bugReport';

const screenshotName = 'podcast-player-screenshot.png';
const fieldClass = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm placeholder:text-slate-500';

export default function ReportBugButton() {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [platform, setPlatform] = useState<string[]>([]);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [screenshotError, setScreenshotError] = useState('');
  const [manualDraft, setManualDraft] = useState<{ url: string; body: string } | null>(null);

  useEffect(() => {
    return () => { if (screenshot) URL.revokeObjectURL(screenshot); };
  }, [screenshot]);

  const openReport = () => {
    setPlatform(collectPlatformInfo());
    dialogRef.current?.showModal();
  };

  const takeScreenshot = async (button: HTMLButtonElement) => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const scrollTop = dialog.scrollTop;
    setCapturing(true);
    setScreenshotError('');
    dialog.close();

    try {
      const image = await captureScreenshot();
      if (dialog.isConnected) setScreenshot(image);
      else URL.revokeObjectURL(image);
    } catch {
      setScreenshotError('No screenshot was captured. You can retry or attach a device screenshot on GitHub.');
    } finally {
      setCapturing(false);
      if (dialog.isConnected) {
        dialog.showModal();
        button.focus();
        dialog.scrollTop = scrollTop;
      }
    }
  };

  const saveScreenshot = async () => {
    if (!screenshot) return;
    setSaving(true);
    setScreenshotError('');
    try {
      await saveAndroidScreenshot(screenshot, screenshotName);
    } catch {
      setScreenshotError('Could not save the screenshot. Try again or attach a device screenshot on GitHub.');
    } finally {
      setSaving(false);
    }
  };

  const submitReport = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const title = String(data.get('title')).trim();
    const description = String(data.get('description')).trim();
    for (const [name, value] of [['title', title], ['description', description]]) {
      if (value) continue;
      const field = event.currentTarget.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement;
      field.setCustomValidity('Enter text for this field.');
      field.reportValidity();
      return;
    }

    const steps = String(data.get('steps')).trim();
    const body = [
      `## What happened\n${description}`,
      steps && `## Steps to reproduce\n${steps}`,
      `## Platform information\n${platform.map(line => `- ${line}`).join('\n')}`,
    ].filter(Boolean).join('\n\n');
    const url = new URL(newIssueUrl);
    url.searchParams.set('title', title);
    url.searchParams.set('body', body);

    // Large percent-encoded reports can exceed GitHub's URL limit.
    if (url.href.length > 7500) {
      url.searchParams.delete('body');
      setManualDraft({ url: url.href, body });
      return;
    }

    const link = document.createElement('a');
    link.href = url.href;
    link.target = isAndroid ? '_self' : '_blank';
    link.rel = 'noopener noreferrer';
    link.click();
  };

  return (
    <>
      <button ref={triggerRef} type="button" aria-haspopup="dialog" onClick={openReport} disabled={capturing}
        className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-blue-300 hover:text-blue-100">
        <Bug size={16} aria-hidden="true" /> Report a Bug
      </button>
      <dialog ref={dialogRef} aria-labelledby="bug-report-heading" onKeyDown={event => event.stopPropagation()}
        onClose={event => { if (!event.currentTarget.open) triggerRef.current?.focus(); }}
        className="bug-report-dialog m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl select-text overflow-y-auto overscroll-contain rounded-2xl border border-slate-700 bg-slate-900 p-5 text-left text-white shadow-2xl backdrop:bg-slate-950/75 md:p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 id="bug-report-heading" className="text-xl font-bold">Report a Bug</h2>
          <button type="button" aria-label="Close bug report" onClick={() => dialogRef.current?.close()}
            className="rounded-lg p-2 text-slate-300 hover:bg-slate-800 hover:text-white">
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={submitReport} onChange={() => setManualDraft(null)} className="space-y-4">
          <label className="block space-y-1 text-sm font-medium">
            <span>Title</span>
            <input name="title" required maxLength={160} className={fieldClass} onChange={event => event.currentTarget.setCustomValidity('')} />
          </label>
          <label className="block space-y-1 text-sm font-medium">
            <span>What happened?</span>
            <textarea name="description" required rows={3} className={fieldClass} onChange={event => event.currentTarget.setCustomValidity('')} />
          </label>
          <label className="block space-y-1 text-sm font-medium">
            <span>Steps to reproduce <span className="font-normal text-slate-400">(optional)</span></span>
            <textarea name="steps" rows={2} className={fieldClass} />
          </label>

          <details className="rounded-lg border border-slate-700 px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium">Included platform information</summary>
            <ul className="mt-2 space-y-1 break-words text-slate-300">
              {platform.map(line => <li key={line}>{line}</li>)}
            </ul>
          </details>

          <div className="space-y-2 rounded-lg border border-slate-700 p-3 text-sm">
            {canCaptureScreenshot() ? (
              <button type="button" onClick={event => void takeScreenshot(event.currentTarget)} disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 hover:bg-slate-700">
                <Camera size={16} aria-hidden="true" /> {screenshot ? 'Retake screenshot' : 'Take screenshot'}
              </button>
            ) : <p className="text-slate-300">Take a screenshot using your device and attach it on GitHub.</p>}
            {screenshot && (
              <>
                <img src={screenshot} alt="Screenshot preview" className="max-h-48 max-w-full rounded-lg object-contain" />
                <div className="flex flex-wrap gap-4">
                  {isAndroid ? (
                    <button type="button" disabled={saving} onClick={() => void saveScreenshot()} className="text-blue-300 underline">Save screenshot</button>
                  ) : (
                    <a href={screenshot} download={screenshotName} className="text-blue-300 underline">Save screenshot</a>
                  )}
                  <button type="button" disabled={saving} onClick={() => { setScreenshot(null); setScreenshotError(''); }} className="text-slate-300 underline">Remove screenshot</button>
                </div>
                <p className="text-slate-300">Save the screenshot, then attach it to your issue on GitHub.</p>
              </>
            )}
            {screenshotError && <p role="status" className="text-amber-300">{screenshotError}</p>}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-400">Review and submit your report on GitHub.</p>
            {!manualDraft && (
              <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500">
                Continue to GitHub <ExternalLink size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        </form>

        {manualDraft && (
          <div className="mt-3 space-y-2">
            <label className="block space-y-2 text-sm">
              <span role="status">This report is too long to prefill. Copy the text below and paste it into the GitHub issue.</span>
              <textarea autoFocus readOnly rows={4} value={manualDraft.body} className={fieldClass} onFocus={event => event.currentTarget.select()} />
            </label>
            <a href={manualDraft.url} target={isAndroid ? '_self' : '_blank'} rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500">
              Continue to GitHub <ExternalLink size={16} aria-hidden="true" />
            </a>
          </div>
        )}
      </dialog>
    </>
  );
}
