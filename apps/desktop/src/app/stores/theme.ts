import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Registry of available themes. Adding one means adding a `[data-theme='<id>']`
 * block to `styles/index.css` and an entry here — the settings screen builds
 * its list from this array, so no other change is needed.
 */
export const THEMES = [
  {
    id: 'oled',
    name: 'OLED',
    description: 'Preto puro, ideal para telas OLED. O padrão do app.',
    palette: { app: '#000000', sidebar: '#000000', chat: '#000000', elevated: '#141416', divider: '#1c1c1f', text: '#e4e4e7', brand: '#fbbf24' },
    dark: true,
  },
  {
    id: 'dark',
    name: 'Escuro',
    description: 'O escuro do Discord, com painéis cinza-escuros.',
    palette: { app: '#1e1f22', sidebar: '#2b2d31', chat: '#313338', elevated: '#383a40', divider: '#26272b', text: '#dbdee1', brand: '#fbbf24' },
    dark: true,
  },
  {
    id: 'light',
    name: 'Claro',
    description: 'Fundo claro com contraste confortável.',
    palette: { app: '#dbdee2', sidebar: '#f2f3f5', chat: '#ffffff', elevated: '#ffffff', divider: '#dcdee1', text: '#2e3338', brand: '#eab308' },
    dark: false,
  },
  {
    id: 'gruvbox',
    name: 'Gruvbox',
    description: 'Marrom quente, texto creme e o verde-água da paleta.',
    palette: { app: '#1d2021', sidebar: '#282828', chat: '#32302f', elevated: '#3c3836', divider: '#3c3836', text: '#ebdbb2', brand: '#83a598' },
    dark: true,
  },
  {
    id: 'bloody',
    name: 'Sangue',
    description: 'Vermelho-sangue sobre tons de vinho e osso.',
    palette: { app: '#0a0708', sidebar: '#140c0e', chat: '#120a0c', elevated: '#241316', divider: '#26151a', text: '#e8d6d2', brand: '#e0212f' },
    dark: true,
  },
  {
    id: 'forest',
    name: 'Floresta',
    description: 'Verdes de musgo e casca, com âmbar para destaque.',
    palette: { app: '#131a14', sidebar: '#18211a', chat: '#1f2a21', elevated: '#263227', divider: '#2a362c', text: '#d5ddcd', brand: '#a8c48a' },
    dark: true,
  },
] as const;

/**
 * Ids the inline script in `index.html` accepts. It runs before the bundle, so
 * it cannot import this array; keep the two in step when adding a theme.
 */
export const PREPAINT_THEME_IDS = ['oled', 'dark', 'light', 'gruvbox', 'bloody', 'forest'] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

export const DEFAULT_THEME: ThemeId = 'oled';

function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}

function apply(theme: ThemeId): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = THEMES.find((item) => item.id === theme)?.dark ? 'dark' : 'light';
}

interface ThemeState {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: DEFAULT_THEME,
      setTheme: (theme) => {
        if (!isThemeId(theme)) return;
        apply(theme);
        set({ theme });
      },
    }),
    {
      name: 'phanteon-theme',
      // keeps the first paint on the saved theme instead of flashing the default
      onRehydrateStorage: () => (state) => {
        apply(state?.theme && isThemeId(state.theme) ? state.theme : DEFAULT_THEME);
      },
    },
  ),
);

/** Applies the stored theme as soon as the module loads. */
export function initTheme(): void {
  const current = useThemeStore.getState().theme;
  apply(isThemeId(current) ? current : DEFAULT_THEME);
}
