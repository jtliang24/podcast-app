import { version } from '../../package.json';
import { AndroidFiles, isAndroid } from './android';

export const newIssueUrl = 'https://github.com/jtliang24/podcast-app/issues/new';

export function collectPlatformInfo() {
  const platform = isAndroid ? 'Android app'
    : window.matchMedia('(display-mode: standalone)').matches ? 'Installed web app' : 'Browser';

  return [
    `App version: ${version}`,
    `Platform: ${platform}`,
    `Viewport: ${window.innerWidth} × ${window.innerHeight} CSS px`,
    `User agent: ${navigator.userAgent}`,
  ];
}

export function canCaptureScreenshot() {
  return isAndroid || typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

export async function captureScreenshot(): Promise<string> {
  if (isAndroid) {
    // Let the app repaint without the report dialog before copying the window.
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const { base64 } = await AndroidFiles.captureScreenshot();
    return `data:image/png;base64,${base64}`;
  }

  const options = {
    video: { displaySurface: 'browser' },
    audio: false,
    preferCurrentTab: true,
    monitorTypeSurfaces: 'exclude',
  };
  const stream = await navigator.mediaDevices.getDisplayMedia(options);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  let timeout: number | undefined;

  try {
    await Promise.race([
      video.play(),
      new Promise<never>((_, reject) => {
        timeout = window.setTimeout(() => reject(new Error('No screen capture frame received')), 5000);
      }),
    ]);

    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d');
    if (!context || !video.videoWidth || !video.videoHeight) throw new Error('No screen capture frame');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode screenshot')), 'image/png');
    });
    return URL.createObjectURL(png);
  } finally {
    window.clearTimeout(timeout);
    stream.getTracks().forEach(track => track.stop());
    video.srcObject = null;
  }
}

export function saveAndroidScreenshot(source: string, name: string) {
  return AndroidFiles.exportFile({
    name,
    mimeType: 'image/png',
    content: source.slice('data:image/png;base64,'.length),
    encoding: 'base64',
  });
}
