import { useEffect, useState } from 'react';
import { AndroidConnectivity, isAndroid } from '../services/android';
import type { DownloadConnection } from '../services/android';

function browserConnection() {
  return (navigator as Navigator & { connection?: EventTarget & { type?: string } }).connection;
}

function browserStatus(): DownloadConnection {
  const type = browserConnection()?.type;
  if (!navigator.onLine || type === 'none') return { transport: 'offline', id: '' };
  if (!type || type === 'unknown') return { transport: 'unknown', id: '' };
  return { transport: type === 'cellular' ? 'cellular' : 'other', id: type };
}

export function useDownloadConnection() {
  const [connection, setConnection] = useState(() => isAndroid ? null : browserStatus());

  useEffect(() => {
    let active = true;
    const publish = (next: DownloadConnection) => {
      if (active) setConnection(previous => previous?.transport === next.transport && previous.id === next.id ? previous : next);
    };
    if (isAndroid) {
      const listener = AndroidConnectivity.addListener('connectionChange', publish);
      void listener.then(() => AndroidConnectivity.getStatus()).then(publish).catch(() => {
        publish(browserStatus());
      });
      return () => {
        active = false;
        void listener.then(handle => handle.remove()).catch(() => {});
      };
    }

    const refresh = () => publish(browserStatus());
    const network = browserConnection();
    network?.addEventListener('change', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    refresh();
    return () => {
      active = false;
      network?.removeEventListener('change', refresh);
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
    };
  }, []);

  return connection;
}
