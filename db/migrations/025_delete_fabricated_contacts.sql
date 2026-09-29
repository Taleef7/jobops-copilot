-- Migration 025: delete the contacts "Scout People" invented (#344).
-- Scout built careers@ and engineering@ addresses from the company name and saved
-- them as "verified"; the Python graph's fallback did the same. A row is deleted only
-- when both its address and its note are the generated ones, so a contact the user
-- saved (even careers@company.com) is kept. Drafting outreach appended to the note,
-- hence the prefix match. Outreach drafts addressed to these contacts are removed by
-- hand after a dry run (there were none on 2026-09-29).

DELETE FROM job_contacts
WHERE (email LIKE 'careers@%'
       AND (notes LIKE 'Discovered from verified public careers directory for %'
            OR notes LIKE 'Identified from verified public company career page%'))
   OR (email LIKE 'engineering@%'
       AND notes LIKE 'Discovered from verified public leadership directory for %');
