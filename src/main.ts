import './styles/main.css';
import { createContext, mountApp } from './app';

const root = document.getElementById('app');
if (root) {
  const ctx = createContext();
  mountApp(root, ctx);
}
