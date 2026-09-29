import { getCollection, type CollectionEntry } from 'astro:content';
export type Note = CollectionEntry<'notes'>;
export const dateLabel = (date: Date) => date.toISOString().slice(0, 10);
export const termSlug = (term: string) => term.trim().toLowerCase().replace(/\s+/g, '-');
export const termUrl = (kind: 'categories' | 'tags', term: string) => `/${kind}/${encodeURIComponent(termSlug(term))}/`;
export const noteUrl = (id: string) => `/notes/${id.split('/').map(encodeURIComponent).join('/')}/`;
export const readingMinutes = (body: string = '') => Math.max(1, Math.ceil(body.length / 500));
export async function publishedNotes() {
  return (await getCollection('notes', ({ data }) => !data.draft))
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf() || a.id.localeCompare(b.id));
}
export function terms(notes: Note[], kind: 'category' | 'tags') {
  const items = new Map<string, { name: string; notes: Note[] }>();
  for (const note of notes) {
    const names = kind === 'category' ? [note.data.category] : note.data.tags;
    for (const name of names) {
      const slug = termSlug(name);
      if (!items.has(slug)) items.set(slug, { name, notes: [] });
      const group = items.get(slug)!;
      if (!group.notes.some((entry) => entry.id === note.id)) group.notes.push(note);
    }
  }
  return [...items.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, 'zh-CN'));
}
