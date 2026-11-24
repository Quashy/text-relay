import { createRoot } from 'react-dom/client';

import './coss.css';
const route = location.pathname.startsWith('/manage') ? import('./Manage') : import('./Public');

void route.then(({ default: Page }) => {
  createRoot(document.getElementById('root')!).render(<Page />);
});
