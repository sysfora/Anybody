import { NextResponse } from 'next/server';
import { loadSlugWords, randomSlugFromWords } from '@/lib/slug-words';

export async function GET() {
  const words = loadSlugWords();
  const name = randomSlugFromWords(words);
  return NextResponse.json({ name });
}
