// Parses tinted-theming style scheme YAML and imports schemes from GitHub URLs on demand.
// Nothing is bundled: the user picks a source and only that is downloaded into IndexedDB.
import type { Scheme } from './types';

const HEX_RE = /^#?([0-9a-fA-F]{6})$/;

function unquote(v: string): string {
  v = v.trim();
  if (!/^["']/.test(v)) {
    const hash = v.search(/\s#/); // trailing YAML comment
    if (hash >= 0) v = v.slice(0, hash).trim();
  } else {
    const q = v[0];
    const end = v.indexOf(q, 1);
    if (end > 0) v = v.slice(1, end);
  }
  return v;
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Parses one scheme YAML file. Supports the current spec (system/name/author/variant/palette:)
 * and the legacy flat format (scheme:/author:/base00: "...").
 */
export function parseSchemeYaml(text: string, fileName: string, systemHint?: 'base16' | 'base24'): Scheme | null {
  const top: Record<string, string> = {};
  const palette: Record<string, string> = {};
  let inPalette = false;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const m = /^(\s*)([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(raw);
    if (!m) continue;
    const [, indent, key, rest] = m;
    if (!indent) {
      inPalette = key === 'palette';
      if (/^base[0-9A-Fa-f]{2}$/.test(key)) palette[normKey(key)] = unquote(rest);
      else if (!inPalette) top[key] = unquote(rest);
    } else if (inPalette) {
      palette[normKey(key)] = unquote(rest);
    }
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(palette)) {
    const hm = HEX_RE.exec(v);
    if (hm) out[k] = '#' + hm[1].toLowerCase();
  }
  for (let i = 0; i < 16; i++) {
    if (!out[`base0${i.toString(16).toUpperCase()}`]) return null;
  }
  const isBase24 = ['base10', 'base11', 'base12', 'base13', 'base14', 'base15', 'base16', 'base17'].every((k) => out[k]);
  const system: 'base16' | 'base24' =
    top.system === 'base24' || top.system === 'base16' ? top.system : systemHint ?? (isBase24 ? 'base24' : 'base16');
  const name = top.name || top.scheme || fileName.replace(/\.ya?ml$/, '');
  const variant = top.variant === 'light' || top.variant === 'dark' ? top.variant : guessVariant(out.base00);
  return {
    id: `${system}-${slugify(name)}`,
    name,
    author: top.author || '',
    system,
    variant,
    palette: out,
    source: 'github',
  };
}

function normKey(k: string): string {
  return 'base' + k.slice(4).toUpperCase();
}

function guessVariant(bg: string): 'dark' | 'light' {
  const n = parseInt(bg.slice(1), 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum > 128 ? 'light' : 'dark';
}

// ---------------------------------------------------------------------------------------------
// GitHub sources

export interface SuggestedSource {
  label: string;
  description: string;
  url: string;
}

const TT = 'https://github.com/tinted-theming/schemes';

export const SUGGESTED_SOURCES: SuggestedSource[] = [
  { label: 'Nord', description: 'tinted-theming · single scheme', url: `${TT}/blob/spec-0.11/base16/nord.yaml` },
  { label: 'Monokai', description: 'tinted-theming · single scheme', url: `${TT}/blob/spec-0.11/base16/monokai.yaml` },
  { label: 'Dracula', description: 'dracula/base16-dracula-scheme · official', url: 'https://github.com/dracula/base16-dracula-scheme/blob/master/dracula.yaml' },
  { label: 'One Dark (Atom)', description: 'tinted-theming · Base24', url: `${TT}/blob/spec-0.11/base24/one-dark.yaml` },
  { label: 'Solarized Dark', description: 'tinted-theming · single scheme', url: `${TT}/blob/spec-0.11/base16/solarized-dark.yaml` },
  { label: 'Solarized Light', description: 'tinted-theming · single scheme', url: `${TT}/blob/spec-0.11/base16/solarized-light.yaml` },
  { label: 'GitHub Dark', description: 'tinted-theming · single scheme', url: `${TT}/blob/spec-0.11/base16/github-dark.yaml` },
  { label: 'GitHub Light', description: 'tinted-theming · single scheme', url: `${TT}/blob/spec-0.11/base16/github.yaml` },
  { label: 'Gruvbox Dark', description: 'tinted-theming · single scheme', url: `${TT}/blob/spec-0.11/base16/gruvbox-dark.yaml` },
  { label: 'Tokyo Night', description: 'tinted-theming · single scheme', url: `${TT}/blob/spec-0.11/base16/tokyo-night-dark.yaml` },
  { label: 'Catppuccin (4 flavors)', description: 'catppuccin/base16 · folder', url: 'https://github.com/catppuccin/base16/tree/main/base16' },
  { label: 'All Base16 schemes (~270)', description: 'tinted-theming · whole folder, ~250 KB', url: `${TT}/tree/spec-0.11/base16` },
  { label: 'All Base24 schemes (~210)', description: 'tinted-theming · whole folder, ~250 KB', url: `${TT}/tree/spec-0.11/base24` },
];

export type ResolvedSource =
  | { type: 'file'; rawUrl: string; fileName: string }
  | { type: 'dir'; owner: string; repo: string; ref?: string; path: string };

/** Understands github.com blob/tree/repo-root URLs and raw.githubusercontent.com file URLs. */
export function resolveSource(input: string): ResolvedSource {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    throw new Error('Not a valid URL');
  }
  const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (u.hostname === 'raw.githubusercontent.com' && parts.length >= 4) {
    return { type: 'file', rawUrl: u.href, fileName: parts[parts.length - 1] };
  }
  if (u.hostname === 'github.com' && parts.length >= 2) {
    const [owner, repo, kind, ref, ...rest] = parts;
    const path = rest.join('/');
    if (kind === 'blob' && ref && path) {
      return {
        type: 'file',
        rawUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`,
        fileName: rest[rest.length - 1],
      };
    }
    if (kind === 'tree' && ref) return { type: 'dir', owner, repo, ref, path };
    if (!kind) return { type: 'dir', owner, repo, path: '' };
  }
  throw new Error('Use a github.com link to a scheme file, a folder, or a repository');
}

export interface ImportProgress {
  done: number;
  total: number;
}

const SYSTEM_FROM_PATH = (p: string) => (/(^|\/)base24(\/|$)/.test(p) ? 'base24' : /(^|\/)base16(\/|$)/.test(p) ? 'base16' : undefined);

async function getText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

/** Downloads every scheme a URL points at. Only the requested files are fetched. */
export async function importFromUrl(input: string, onProgress?: (p: ImportProgress) => void): Promise<Scheme[]> {
  const src = resolveSource(input);
  if (src.type === 'file') {
    onProgress?.({ done: 0, total: 1 });
    const s = parseSchemeYaml(await getText(src.rawUrl), src.fileName, SYSTEM_FROM_PATH(src.rawUrl));
    onProgress?.({ done: 1, total: 1 });
    if (!s) throw new Error('That file is not a Base16/Base24 scheme');
    return [{ ...s, origin: input }];
  }
  const api = `https://api.github.com/repos/${src.owner}/${src.repo}/contents/${src.path}${src.ref ? `?ref=${encodeURIComponent(src.ref)}` : ''}`;
  const listing = JSON.parse(await getText(api)) as { name: string; type: string; download_url: string | null }[];
  if (!Array.isArray(listing)) throw new Error('That link is not a folder');
  const files = listing.filter((f) => f.type === 'file' && /\.ya?ml$/.test(f.name) && f.download_url);
  if (!files.length) throw new Error('No .yaml scheme files in that folder');
  const out: Scheme[] = [];
  let done = 0;
  onProgress?.({ done, total: files.length });
  const queue = [...files];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      try {
        const s = parseSchemeYaml(await getText(f.download_url!), f.name, SYSTEM_FROM_PATH(src.path));
        if (s) out.push({ ...s, origin: input });
      } catch {
        // skip unreadable files; the rest of the folder still imports
      }
      onProgress?.({ done: ++done, total: files.length });
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  if (!out.length) throw new Error('No Base16/Base24 schemes found there');
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
