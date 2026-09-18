export interface Segment { i: number; chapter: string; text: string; }

const CHAPTER_RE = /^\s*(CHAPTER|Chapter|LETTER|Letter)\s+([IVXLC]+|\d+|[A-Z][a-z]+)\b\.?\s*(.*)$/;

// Strip Project Gutenberg boilerplate if present, then split into ~target-word paragraphs
// grouped so Jev gets a coherent beat of narrative per request.
export function segmentBook(raw: string, targetWords = 90): Segment[] {
  let body = raw.replace(/\r/g, '');
  const start = body.search(/\*\*\* START OF THE PROJECT GUTENBERG EBOOK[^\n]*\*\*\*/);
  const end = body.search(/\*\*\* END OF THE PROJECT GUTENBERG EBOOK/);
  if (start >= 0) body = body.slice(body.indexOf('\n', start) + 1);
  if (end >= 0) body = body.slice(0, body.indexOf('*** END OF THE PROJECT GUTENBERG EBOOK'));
  body = body.replace(/\n\s*THE END\s*$/i, '');

  const paras = body.split(/\n\s*\n/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out: Segment[] = [];
  let chapter = '';
  let seenFirstChapter = false;
  let buf: string[] = [], words = 0;
  const flush = () => { if (words > 0) { out.push({ i: out.length, chapter, text: buf.join(' ') }); buf = []; words = 0; } };

  for (const p of paras) {
    const m = p.match(CHAPTER_RE);
    if (m && p.split(' ').length <= 14) {
      // Table-of-contents lines appear before the first real chapter heading; skip them.
      if (!seenFirstChapter && out.length === 0 && buf.length === 0) {
        // If the very next paragraphs are also chapter lines, this is the TOC. Peek by heuristic:
      }
      flush();
      chapter = p.replace(/\s+/g, ' ');
      seenFirstChapter = true;
      continue;
    }
    if (!seenFirstChapter) continue; // front matter
    const n = p.split(' ').length;
    if (words > 0 && words + n > targetWords * 1.4) flush();
    buf.push(p); words += n;
    if (words >= targetWords) flush();
  }
  flush();
  // Drop any chapter groups that contained no prose (TOC artefacts).
  return out.filter(s => s.text.length > 40).map((s, i) => ({ ...s, i }));
}
