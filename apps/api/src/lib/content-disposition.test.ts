import assert from 'node:assert/strict';
import { ServerResponse, IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import test from 'node:test';
import { attachmentDisposition } from './content-disposition';

test('any file name makes a header Node accepts, with the name kept in UTF-8', () => {
  const response = new ServerResponse(new IncomingMessage(new Socket()));
  for (const name of ['Jordan_Lee.pdf', 'Łukasz_Żółć.pdf', '李明.pdf', 'Zoë "Q" O\'Neil (CV).pdf', 'résumé\\final.pdf']) {
    const header = attachmentDisposition(name);
    assert.doesNotThrow(() => response.setHeader('Content-Disposition', header), name);
    assert.match(header, /^attachment; filename="[\x20-\x7e]*"; filename\*=UTF-8''[A-Za-z0-9%._~!$&+,;=:@-]+$/, header);
    assert.equal(decodeURIComponent(header.split("UTF-8''")[1]!), name);
  }
  assert.equal(attachmentDisposition('Jordan_Lee.pdf'), 'attachment; filename="Jordan_Lee.pdf"; filename*=UTF-8\'\'Jordan_Lee.pdf');
  assert.match(attachmentDisposition('李明.pdf'), /^attachment; filename="\.pdf"/);
  // Dashes keep their place in the plain name: "Jordan Lee – Acme – Cover letter.pdf" (#416).
  assert.match(attachmentDisposition('Jordan Lee – Acme — Cover letter.pdf'), /^attachment; filename="Jordan Lee - Acme - Cover letter\.pdf"/);
  // A broken UTF-16 name (a lone surrogate) still makes a header, without the broken part.
  assert.doesNotThrow(() => response.setHeader('Content-Disposition', attachmentDisposition('Jo\ud800_1.pdf')));
});
