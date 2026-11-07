import React from 'react';
import ReactDOM from 'react-dom/client';

import MobileApp from './MobileApp';
import './mobile.css';
import {initializeMobileTheme} from './theme';

const viewport=document.querySelector('meta[name="viewport"]');
if(viewport && !viewport.getAttribute('content')?.includes('viewport-fit'))viewport.setAttribute('content',viewport.getAttribute('content')+', viewport-fit=cover');
initializeMobileTheme();
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><MobileApp /></React.StrictMode>);
