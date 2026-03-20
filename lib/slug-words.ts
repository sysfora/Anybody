import { readFileSync } from 'fs';
import { join } from 'path';

const FALLBACK_WORDS = [
  'modern',
  'minimal',
  'clean',
  'elegant',
  'sleek',
  'smart',
  'fast',
  'secure',
  'reliable',
  'innovative',
  'dynamic',
  'creative',
  'powerful',
  'efficient',
  'responsive',
  'adaptive',
  'flexible',
  'scalable',
  'advanced',
  'premium',
] as const;

let cachedWords: string[] | null = null;

/**
 * Lines from `Slug-Words.txt` at the repo root (server-only).
 */
export function loadSlugWords(): string[] {
  if (cachedWords) {
    return cachedWords;
  }

  const possiblePaths = [
    join(process.cwd(), 'Slug-Words.txt'),
    join(process.cwd(), 'Anybody-Frontend', 'Slug-Words.txt'),
    join(process.cwd(), '..', 'Anybody-Frontend', 'Slug-Words.txt'),
  ];

  for (const filePath of possiblePaths) {
    try {
      const fileContent = readFileSync(filePath, 'utf-8');
      const words = fileContent
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      if (words.length >= 3) {
        cachedWords = words;
        return cachedWords;
      }
    } catch {
      continue;
    }
  }

  console.warn('Slug-Words.txt not found, using fallback words');
  cachedWords = [...FALLBACK_WORDS];
  return cachedWords;
}

/** Three distinct random words, hyphenated (same scheme as `/api/project/generate-name`). */
export function randomSlugFromWords(words: string[]): string {
  if (words.length < 3) {
    return `project-${Date.now().toString(36)}`;
  }

  const selectedWords: string[] = [];
  const usedIndices = new Set<number>();

  while (selectedWords.length < 3) {
    const randomIndex = Math.floor(Math.random() * words.length);
    if (!usedIndices.has(randomIndex)) {
      usedIndices.add(randomIndex);
      selectedWords.push(words[randomIndex]!);
    }
  }

  return selectedWords.join('-').toLowerCase();
}
