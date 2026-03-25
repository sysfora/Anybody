/**
 * Static word list for generating random project slugs.
 * Inlined to avoid runtime filesystem access (which causes Turbopack to trace
 * the entire project during build).
 */
const SLUG_WORDS: readonly string[] = [
  'modern', 'minimal', 'clean', 'elegant', 'sleek', 'smooth', 'bright',
  'fresh', 'vibrant', 'dynamic', 'innovative', 'creative', 'smart',
  'intelligent', 'powerful', 'efficient', 'fast', 'quick', 'responsive',
  'adaptive', 'flexible', 'scalable', 'secure', 'reliable', 'stable',
  'robust', 'advanced', 'premium', 'professional', 'enterprise', 'startup',
  'agile', 'streamlined', 'optimized', 'enhanced', 'upgraded', 'digital',
  'cloud', 'mobile', 'platform', 'solution', 'service', 'tool', 'suite',
  'hub', 'center', 'portal', 'gateway', 'connector', 'engine', 'framework',
  'library', 'kit', 'stack', 'ecosystem', 'network', 'community',
  'marketplace', 'studio', 'lab', 'workspace', 'module', 'widget', 'feature',
  'capability', 'resource', 'asset', 'brand', 'team', 'squad', 'crew',
  'division', 'unit', 'venture', 'project', 'initiative', 'campaign',
  'mission', 'vision', 'goal', 'target', 'objective', 'priority', 'strategy',
  'blueprint', 'roadmap', 'methodology', 'workflow', 'pipeline', 'channel',
  'pathway', 'journey', 'experience', 'adventure', 'quest', 'exploration',
  'discovery', 'invention', 'creation', 'development', 'design', 'build',
  'craft', 'forge', 'shape', 'draft', 'outline', 'template', 'pattern',
  'prototype', 'demo', 'showcase', 'presentation', 'performance', 'summit',
  'assembly', 'convention', 'festival', 'celebration', 'program', 'course',
  'tutorial', 'guide', 'manual', 'reference', 'documentation', 'benchmark',
  'metric', 'indicator', 'signal', 'insight', 'analysis', 'research',
  'collaboration', 'partnership', 'alliance', 'integration', 'alignment',
  'coordination', 'orchestration', 'management', 'governance', 'leadership',
  'oversight', 'compliance', 'evaluation', 'transformation', 'evolution',
  'growth', 'expansion', 'acceleration', 'boost', 'surge', 'elevation',
  'reputation', 'identity', 'essence', 'core', 'heart', 'spirit', 'intellect',
  'wisdom', 'knowledge', 'awareness', 'perception', 'reflection', 'reasoning',
  'logic', 'intuition', 'momentum', 'drive', 'motivation', 'inspiration',
  'enthusiasm', 'passion', 'achievement', 'success', 'victory', 'triumph',
  'domain', 'territory', 'realm', 'universe', 'cosmos', 'landscape',
  'panorama', 'perspective', 'foundation', 'architecture', 'structure',
  'matrix', 'cluster', 'bundle', 'package', 'container', 'carrier',
  'conduit', 'corridor', 'entrance', 'bridge', 'tunnel', 'passage',
] as const;

export function loadSlugWords(): string[] {
  return [...SLUG_WORDS];
}

/** Three distinct random words, hyphenated. */
export function randomSlugFromWords(words: string[]): string {
  if (words.length < 3) {
    return `project-${Date.now().toString(36)}`;
  }

  const selected: string[] = [];
  const used = new Set<number>();

  while (selected.length < 3) {
    const idx = Math.floor(Math.random() * words.length);
    if (!used.has(idx)) {
      used.add(idx);
      selected.push(words[idx]!);
    }
  }

  return selected.join('-').toLowerCase();
}
