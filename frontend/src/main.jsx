import React from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';

const demo = import.meta.env.VITE_ENABLE_DEMO !== 'false' && new URLSearchParams(window.location.search).get('mode') === 'demo';
import(demo ? './DemoApp.jsx' : './App.jsx').then(({ default: App }) => {
  createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
});
