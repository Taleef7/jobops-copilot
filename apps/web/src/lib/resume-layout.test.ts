import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TITLES, SECTION_KEYS, layoutRows, moveItem, rowsToSections } from './resume-layout';

describe('resume layout (#415)', () => {
  it("has the API's sections and default headings", () => {
    const api = readFileSync(join(__dirname, '../../../api/src/lib/resume-layout.ts'), 'utf8');
    expect(api).toContain(`export const SECTION_KEYS: ResumeSectionKey[] = [${SECTION_KEYS.map((key) => `'${key}'`).join(', ')}];`);
    for (const key of SECTION_KEYS) expect(api).toContain(`  ${key}: '${DEFAULT_TITLES[key]}',`);
  });

  it('lists every section once, the listed ones first, as the API resolves them', () => {
    const rows = layoutRows({ sections: [{ key: 'skills', title: ' Tools ' }, { key: 'skills' }, { key: 'projects', hidden: true }] });
    expect(rows).toEqual([
      { key: 'skills', title: 'Tools', hidden: false },
      { key: 'projects', title: '', hidden: true },
      { key: 'summary', title: '', hidden: false },
      { key: 'work', title: '', hidden: false },
      { key: 'education', title: '', hidden: false },
      { key: 'certificates', title: '', hidden: false },
    ]);
  });

  it('stores a title only when it differs from the default, and hidden only when set', () => {
    expect(
      rowsToSections([
        { key: 'skills', title: 'Skills', hidden: false },
        { key: 'work', title: 'Professional Experience', hidden: true },
      ]),
    ).toEqual([{ key: 'skills' }, { key: 'work', title: 'Professional Experience', hidden: true }]);
  });

  it('moves an item', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
  });
});
