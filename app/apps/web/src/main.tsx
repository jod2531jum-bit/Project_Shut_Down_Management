import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { initAuth } from './auth';

const root = createRoot(document.getElementById('root')!);
initAuth()
  .then(() => root.render(<StrictMode><App /></StrictMode>))
  .catch((e: Error) => root.render(<p role="alert" style={{ padding: 24, color: '#991b1b' }}>Could not start: {e.message}</p>));
