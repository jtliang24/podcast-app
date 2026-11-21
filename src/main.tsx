import React from 'react'
import { createRoot } from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { registerSW } from 'virtual:pwa-register'
import { isAndroid } from './services/android'
import './index.css'
import App from './App'

// Register service worker for PWA support
if (!isAndroid) registerSW({ immediate: true })

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      {isAndroid ? <App /> : (
        <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID || 'dummy_client_id_for_dev'}>
          <App />
        </GoogleOAuthProvider>
      )}
    </React.StrictMode>
  );
}
