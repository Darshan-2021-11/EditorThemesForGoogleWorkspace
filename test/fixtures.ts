import type { Scheme } from '../src/theme/types';

const keys = ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '0A', '0B', '0C', '0D', '0E', '0F'];

function scheme(id: string, name: string, variant: 'dark' | 'light', hexes: string): Scheme {
  const values = hexes.trim().split(/\s+/);
  return {
    id, name, author: '', system: 'base16', variant, source: 'github',
    palette: Object.fromEntries(keys.map((k, i) => [`base${k}`, values[i]])),
  };
}

export const nord = scheme('base16-nord', 'Nord', 'dark', `
  #2e3440 #3b4252 #434c5e #4c566a #d8dee9 #e5e9f0 #eceff4 #8fbcbb
  #bf616a #d08770 #ebcb8b #a3be8c #88c0d0 #81a1c1 #b48ead #5e81ac`);

export const solarizedLight = scheme('base16-solarized-light', 'Solarized Light', 'light', `
  #fdf6e3 #eee8d5 #93a1a1 #839496 #657b83 #586e75 #073642 #002b36
  #dc322f #cb4b16 #b58900 #859900 #2aa198 #268bd2 #6c71c4 #d33682`);
