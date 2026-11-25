import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { contentApi } from '../services/api';

export default function ContentPage() {
  const { slug } = useParams();
  const [entry, setEntry] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    contentApi.get(slug).then((value) => { if (alive) setEntry(value); }).catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [slug]);
  useEffect(() => {
    if (!entry) return;
    document.title = entry.metaTitle || entry.title;
    let description = document.querySelector('meta[name="description"]');
    if (!description) { description = document.createElement('meta'); description.name = 'description'; document.head.appendChild(description); }
    description.content = entry.metaDescription || entry.excerpt || '';
  }, [entry]);
  if (error) return <main className="grid min-h-dvh place-items-center bg-bg p-6 text-center text-ink"><div><h1 className="text-2xl font-semibold">Page not found</h1><Link to="/" className="mt-4 inline-block text-brand">Back to Pulse</Link></div></main>;
  if (!entry) return <main className="grid min-h-dvh place-items-center bg-bg text-mute">Loading…</main>;
  return <main className="min-h-dvh bg-bg px-5 py-12 text-ink"><article className="mx-auto max-w-3xl"><Link to="/" className="text-sm text-brand">← Pulse</Link><p className="mt-8 text-xs uppercase tracking-widest text-brand">{entry.kind}{entry.category ? ` · ${entry.category}` : ''}</p><h1 className="mt-2 text-3xl font-semibold">{entry.title}</h1>{entry.excerpt && <p className="mt-4 text-lg text-mute">{entry.excerpt}</p>}<div className="mt-8 whitespace-pre-wrap break-words text-[15px] leading-7">{entry.body}</div></article></main>;
}
