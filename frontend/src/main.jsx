import React from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';

import(new URLSearchParams(window.location.search).get('mode') === 'demo' ? './DemoApp.jsx' : './App.jsx').then(({ default: App }) => {
  createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
});
