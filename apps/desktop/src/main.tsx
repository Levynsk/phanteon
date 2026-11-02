import { createRoot } from 'react-dom/client';
import { Root } from './app/Root';
import { resolveApiUrl } from './lib/config';
import { initTheme } from './app/stores/theme';
import { Toaster } from './components/ui/Toast';
import { TooltipProvider } from './components/ui/Tooltip';
import './styles/index.css';

async function bootstrap() {
  initTheme();
  await resolveApiUrl();

  const container = document.getElementById('root');
  if (!container) throw new Error('Root element missing');

  createRoot(container).render(
    <TooltipProvider delayDuration={150}>
      <Root />
      <Toaster />
    </TooltipProvider>,
  );
}

void bootstrap();
