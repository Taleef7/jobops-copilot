import { PDFString, rgb, type PDFDocument } from 'pdf-lib';
import type { FontName, Fonts } from './fonts';

/**
 * A small text flow for the API's PDFs (#352): runs of styled text, measured with the embedded
 * font, wrapped to the page at spaces, and carried onto a new page at the bottom margin. It
 * only lays out (so a résumé can be tried at several sizes); draw() writes the chosen layout.
 */

export interface Run {
  text: string;
  font: FontName;
  size: number;
  /** Makes the run a link (a URI annotation over it). Use safeLink() to make one. */
  link?: string;
}

export interface Box {
  width: number;
  height: number;
  margin: number;
}

interface TextOp extends Run {
  page: number;
  x: number;
  y: number;
}

interface RuleOp {
  page: number;
  x1: number;
  x2: number;
  y: number;
}

/** A word: the pieces between two spaces (a bold "40%" and its ")," stay together). */
interface Word {
  pieces: Run[];
  /** The space before it, in the style it was typed in. */
  space: Run | null;
}

// A line break inside a field is a space, as is a no-break or other wide space (so a line can
// break there); other control and zero-width characters go.
const clean = (text: string) =>
  text.replace(/[\t\n\v\f\r\u0085\u2028\u2029\p{Zs}]/gu, ' ').replace(/[\p{Cc}\p{Cf}]/gu, '');

/**
 * A link a PDF reader can follow safely: http, https or mailto only, as an ASCII URI (an
 * international domain in punycode). Anything else is shown as plain text, without a link.
 */
export function safeLink(url: string): string | undefined {
  const text = url.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^mailto:/i.test(text) ? text : `https://${text}`;
  try {
    const parsed = new URL(withScheme);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

export class Flow {
  private readonly texts: TextOp[] = [];
  private readonly rules: RuleOp[] = [];
  private readonly widths = new Map<string, number>();
  private readonly glyphs = new Map<FontName, Set<number>>();
  private page = 0;
  /** The top of the next line. */
  private y: number;
  /** Characters the font has no glyph for, printed as "?". */
  unsupported = 0;

  constructor(
    private readonly fonts: Fonts,
    readonly box: Box,
    /** Line height as a multiple of the text size. */
    private readonly leading = 1.2,
  ) {
    this.y = box.height - box.margin;
  }

  get pages() {
    return this.page + 1;
  }

  get left() {
    return this.box.margin;
  }

  get width() {
    return this.box.width - 2 * this.box.margin;
  }

  /** Each width measured once: a résumé repeats words, and is laid out at several sizes. */
  private measure(font: FontName, size: number, text: string): number {
    const key = `${font}\u0000${size}\u0000${text}`;
    let width = this.widths.get(key);
    if (width === undefined) {
      width = this.fonts[font].widthOfTextAtSize(text, size);
      this.widths.set(key, width);
    }
    return width;
  }

  widthOf(runs: Run[]): number {
    return runs.reduce((sum, run) => sum + this.measure(run.font, run.size, run.text), 0);
  }

  lineHeight(runs: Run[]): number {
    return Math.max(...runs.map((run) => run.size), 1) * this.leading;
  }

  /**
   * The text as the font can print it. A character it has no glyph for (CJK, emoji) would
   * print as an empty box drawn wider than measured, so it becomes "?" and is counted.
   */
  private printable(font: FontName, text: string): string {
    let glyphs = this.glyphs.get(font);
    if (!glyphs) {
      glyphs = new Set(this.fonts[font].getCharacterSet());
      this.glyphs.set(font, glyphs);
    }
    let out = '';
    for (const char of clean(text)) {
      if (char === ' ' || glyphs.has(char.codePointAt(0)!)) out += char;
      else {
        out += '?';
        this.unsupported += 1;
      }
    }
    return out;
  }

  /** Room for `height` more points on this page, else the next page. */
  need(height: number) {
    const top = this.box.height - this.box.margin;
    if (this.y - height < this.box.margin && this.y < top) {
      this.page += 1;
      this.y = top;
    }
  }

  /** Vertical space, not carried over a page break. */
  space(points: number) {
    if (this.y < this.box.height - this.box.margin) this.y -= points;
  }

  /** A thin rule across the text width, just under the last line. */
  rule(gap = 2) {
    this.rules.push({ page: this.page, x1: this.left, x2: this.left + this.width, y: this.y + gap });
  }

  private words(runs: Run[]): Word[] {
    const words: Word[] = [];
    let space: Run | null = null;
    let glued = false;
    for (const run of runs) {
      for (const token of this.printable(run.font, run.text).split(/( +)/)) {
        if (!token) continue;
        if (token.startsWith(' ')) {
          space = { ...run, text: ' ' };
          glued = false;
          continue;
        }
        const piece = { ...run, text: token };
        if (glued && words.length > 0) words[words.length - 1]!.pieces.push(piece);
        else words.push({ pieces: [piece], space: words.length > 0 ? space : null });
        space = null;
        glued = true;
      }
    }
    return words;
  }

  /**
   * Runs wrapped to `width` at spaces, keeping each run's style. The first line can be narrower
   * (beside a right-aligned text); a word that doesn't fit there starts on the next line. Only a
   * word too long for any line is broken, by characters.
   */
  wrap(runs: Run[], width: number, firstWidth = width): Run[][] {
    const lines: Run[][] = [];
    let line: Run[] = [];
    let used = 0;
    const max = () => (lines.length === 0 ? firstWidth : width);
    const push = (piece: Run) => {
      const last = line[line.length - 1];
      if (last && last.font === piece.font && last.size === piece.size && last.link === piece.link) last.text += piece.text;
      else line.push({ ...piece });
    };
    const breakLine = () => {
      lines.push(line);
      line = [];
      used = 0;
    };
    for (const word of this.words(runs)) {
      const wordWidth = this.widthOf(word.pieces);
      const spaceWidth = line.length > 0 && word.space ? this.widthOf([word.space]) : 0;
      if (used + spaceWidth + wordWidth <= max()) {
        if (spaceWidth > 0) push(word.space!);
        word.pieces.forEach(push);
        used += spaceWidth + wordWidth;
        continue;
      }
      if (line.length > 0) breakLine();
      if (lines.length === 0 && wordWidth > max() && wordWidth <= width) breakLine();
      if (wordWidth <= max()) {
        word.pieces.forEach(push);
        used = wordWidth;
        continue;
      }
      // Too long for any line: character by character, each measured once (linear, however long).
      for (const piece of word.pieces) {
        for (const char of piece.text) {
          const charWidth = this.measure(piece.font, piece.size, char);
          if (used > 0 && used + charWidth > max() - 0.5) breakLine();
          push({ ...piece, text: char });
          used += charWidth;
        }
      }
    }
    if (line.length > 0) lines.push(line);
    return lines;
  }

  /**
   * Runs as wrapped lines from `indent`. `right` goes right-aligned on the first line, or on a
   * line of its own when it's too wide to share one; `marker` (a bullet) sits at `indent` with
   * the text hanging after it; `align` centres or right-aligns each line.
   */
  write(
    runs: Run[],
    options: { indent?: number; right?: Run[]; marker?: Run; hang?: number; align?: 'left' | 'center' | 'right' } = {},
  ) {
    const { indent = 0, hang = 0, align = 'left' } = options;
    // Right-hand text and the marker are drawn as they are, not wrapped: printable, one line.
    const printable = (run: Run): Run => ({ ...run, text: this.printable(run.font, run.text) });
    const marker = options.marker ? printable(options.marker) : undefined;
    const fullRight = (options.right ?? []).map(printable);
    let right = fullRight;
    const width = this.width - indent - hang;
    const rightWidth = right.length > 0 ? this.widthOf(right) + 8 : 0;
    const ownLine = rightWidth > width * 0.45;
    if (ownLine) right = [];
    const lines = this.wrap(runs, width, width - (ownLine ? 0 : rightWidth));
    if (lines.length === 0 && right.length > 0) lines.push([]);
    lines.forEach((line, index) => {
      const first = index === 0;
      const shared = first ? [...right, ...(marker ? [marker] : [])] : [];
      const height = this.lineHeight([...line, ...shared]);
      this.need(height);
      const size = Math.max(...[...line, ...shared].map((run) => run.size), 1);
      const baseline = this.y - size * 0.92;
      const lineWidth = this.widthOf(line);
      let x =
        align === 'center'
          ? this.left + (this.width - lineWidth) / 2
          : align === 'right'
            ? this.left + this.width - lineWidth
            : this.left + indent + hang;
      if (first && marker) this.put(marker, this.left + indent, baseline);
      for (const run of line) x = this.put(run, x, baseline);
      if (first && right.length > 0) {
        let rx = this.left + this.width - this.widthOf(right);
        for (const run of right) rx = this.put(run, rx, baseline);
      }
      this.y -= height;
    });
    if (ownLine) this.write(fullRight, { align: 'right' });
  }

  /**
   * Items on as few lines as they fit, joined by `separator` and centred: a line breaks only
   * between items, so no item is split and no line ends with a separator.
   */
  items(items: Run[][], separator: Run) {
    const lines: Run[][] = [];
    let line: Run[] = [];
    for (const item of items) {
      const candidate = line.length > 0 ? [...line, separator, ...item] : item;
      if (line.length > 0 && this.widthOf(candidate) > this.width) {
        lines.push(line);
        line = item;
      } else line = candidate;
    }
    if (line.length > 0) lines.push(line);
    for (const runs of lines) this.write(runs, { align: 'center' });
  }

  private put(run: Run, x: number, y: number): number {
    if (run.text) this.texts.push({ ...run, page: this.page, x, y });
    return x + this.widthOf([run]);
  }

  /** Writes the layout into `doc`, one page per page used. */
  draw(doc: PDFDocument) {
    const pages = Array.from({ length: this.pages }, () => doc.addPage([this.box.width, this.box.height]));
    const black = rgb(0, 0, 0);
    for (const op of this.texts) {
      const page = pages[op.page]!;
      page.drawText(op.text, { x: op.x, y: op.y, size: op.size, font: this.fonts[op.font], color: black });
      if (op.link) {
        const width = this.widthOf([op]);
        const annotation = doc.context.obj({
          Type: 'Annot',
          Subtype: 'Link',
          Rect: [op.x, op.y - op.size * 0.25, op.x + width, op.y + op.size * 0.8],
          Border: [0, 0, 0],
          // A PDF string: its backslashes and parentheses escaped, so ")" can't end it early.
          A: { Type: 'Action', S: 'URI', URI: PDFString.of(op.link.replace(/[\\()]/g, (char) => `\\${char}`)) },
        });
        page.node.addAnnot(doc.context.register(annotation));
      }
    }
    for (const rule of this.rules) {
      pages[rule.page]!.drawLine({ start: { x: rule.x1, y: rule.y }, end: { x: rule.x2, y: rule.y }, thickness: 0.5, color: black });
    }
  }
}

export const PAGE_SIZES = {
  letter: { width: 612, height: 792 },
  a4: { width: 595.28, height: 841.89 },
} as const;
