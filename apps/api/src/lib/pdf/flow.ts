import { PDFString, rgb, type PDFDocument } from 'pdf-lib';
import type { FontName, Fonts } from './fonts';

/**
 * A small text flow for the API's PDFs (#352): runs of styled text, measured with the embedded
 * font, wrapped to the page, and carried onto a new page at the bottom margin. It only lays
 * out (so a résumé can be tried at several sizes); draw() writes the chosen layout.
 */

export interface Run {
  text: string;
  font: FontName;
  size: number;
  /** Makes the run a link (a URI annotation over it). */
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

// Control characters and line separators never reach a line; tabs are spaces.
const clean = (text: string) => text.replace(/\t/g, ' ').replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, '');

export class Flow {
  private readonly texts: TextOp[] = [];
  private readonly rules: RuleOp[] = [];
  private page = 0;
  /** The top of the next line. */
  private y: number;

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

  widthOf(runs: Run[]): number {
    return runs.reduce((sum, run) => sum + this.fonts[run.font].widthOfTextAtSize(run.text, run.size), 0);
  }

  lineHeight(runs: Run[]): number {
    return Math.max(...runs.map((run) => run.size), 1) * this.leading;
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

  /**
   * Runs wrapped to `width`, word by word, keeping each run's style. A word too long for a line
   * is broken across lines.
   */
  wrap(runs: Run[], width: number, firstWidth = width): Run[][] {
    const lines: Run[][] = [];
    let line: Run[] = [];
    let used = 0;
    let space: Run | null = null;
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
      space = null;
    };
    for (const run of runs) {
      for (const token of clean(run.text).split(/(\s+)/)) {
        if (!token) continue;
        const piece = { ...run, text: token };
        if (/^\s+$/.test(token)) {
          if (line.length > 0) space = { ...run, text: ' ' };
          continue;
        }
        const spaceWidth = space ? this.widthOf([space]) : 0;
        const tokenWidth = this.widthOf([piece]);
        if (used + spaceWidth + tokenWidth <= max()) {
          if (space) push(space);
          push(piece);
          used += spaceWidth + tokenWidth;
          space = null;
          continue;
        }
        if (line.length > 0) breakLine();
        // Too long for any line: break it by characters.
        let rest = token;
        while (this.widthOf([{ ...run, text: rest }]) > max()) {
          let cut = 1;
          while (cut < rest.length && this.widthOf([{ ...run, text: rest.slice(0, cut + 1) }]) <= max()) cut += 1;
          push({ ...run, text: rest.slice(0, cut) });
          breakLine();
          rest = rest.slice(cut);
        }
        push({ ...run, text: rest });
        used = this.widthOf([{ ...run, text: rest }]);
      }
    }
    if (line.length > 0) lines.push(line);
    return lines;
  }

  /**
   * Runs as wrapped lines from `indent`. `right` goes right-aligned on the first line; `marker`
   * (a bullet) sits at `indent` with the text hanging after it; `center` centres each line.
   */
  write(runs: Run[], options: { indent?: number; right?: Run[]; marker?: Run; hang?: number; center?: boolean } = {}) {
    const { indent = 0, right = [], marker, hang = 0, center = false } = options;
    const textLeft = this.left + indent + hang;
    const width = this.width - indent - hang;
    const rightWidth = right.length > 0 ? this.widthOf(right) + 8 : 0;
    const lines = this.wrap(runs, width, width - rightWidth);
    if (lines.length === 0 && right.length > 0) lines.push([]);
    lines.forEach((line, index) => {
      const height = this.lineHeight([...line, ...(index === 0 ? right : []), ...(index === 0 && marker ? [marker] : [])]);
      this.need(height);
      const size = Math.max(...line.map((run) => run.size), ...(index === 0 ? right.map((run) => run.size) : []), 1);
      const baseline = this.y - size * 0.92;
      let x = center ? this.left + (this.width - this.widthOf(line)) / 2 : textLeft;
      if (index === 0 && marker) this.put(marker, this.left + indent, baseline);
      for (const run of line) x = this.put(run, x, baseline);
      if (index === 0 && right.length > 0) {
        let rx = this.left + this.width - this.widthOf(right);
        for (const run of right) rx = this.put(run, rx, baseline);
      }
      this.y -= height;
    });
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
          A: { Type: 'Action', S: 'URI', URI: PDFString.of(op.link) },
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
