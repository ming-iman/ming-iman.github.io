import { useEffect, useState } from 'react';
import { Input } from './ui/Input';
interface NoteSummary {
  id: string; title: string; description: string; category: string;
  tags: string[]; date: string; minutes: number; href: string;
}
const termLink = (kind: string, term: string) => `/${kind}/${encodeURIComponent(term.trim().toLowerCase().replace(/\s+/g, '-'))}/`;
export default function NoteSearch({ notes }: { notes: NoteSummary[] }) {
  const [query, setQuery] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const filtered = notes.filter((note) => {
    const haystack = [note.title, note.description, note.category, ...note.tags].join(' ').toLocaleLowerCase();
    return words.every((word) => haystack.includes(word));
  });
  return <section aria-labelledby="all-notes">
    <div className="list-toolbar">
      <h2 id="all-notes">全部笔记 <span className="count">{notes.length}</span></h2>
      <div className="search-control">
        <label htmlFor="note-search" className="sr-only">搜索标题、摘要、分类或标签</label>
        <span className="search-symbol" aria-hidden="true">⌕</span>
        <Input id="note-search" type="search" placeholder="搜索笔记、分类或标签" value={query} disabled={!ready} onChange={(event) => setQuery(event.target.value)} />
      </div>
    </div>
    <noscript><p className="muted">搜索需要 JavaScript；仍可使用分类、标签和下方文章列表浏览。</p></noscript>
    <p className="search-status" role="status" aria-live="polite">{query ? `找到 ${filtered.length} 篇笔记` : '从一个问题开始，逐步建立理解。'}</p>
    {filtered.length ? <ul className="notes-list">
      {filtered.map((note) => <li className="note-row" key={note.id}>
        <div className="note-meta"><time dateTime={note.date}>{note.date}</time><span aria-hidden="true">·</span><a href={termLink('categories', note.category)}>{note.category}</a><span aria-hidden="true">·</span><span>约 {note.minutes} 分钟</span></div>
        <h3><a href={note.href}>{note.title}<span className="note-arrow" aria-hidden="true">↗</span></a></h3>
        <p>{note.description}</p>
        <div className="tags">{note.tags.map((tag) => <a key={tag} href={termLink('tags', tag)}># {tag}</a>)}</div>
      </li>)}
    </ul> : <div className="empty-state"><h3>没有找到相关笔记</h3><p>试试更短的关键词，或清除搜索查看全部内容。</p><button type="button" onClick={() => setQuery('')}>清除搜索</button></div>}
  </section>;
}
