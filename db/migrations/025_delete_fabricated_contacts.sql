-- Migration 025: delete the contacts "Scout People" invented (#344).
-- Scout built careers@ and engineering@ addresses from the company name and saved
-- them as "verified". The Python graph's fallback did the same. Contacts the user
-- added themselves are kept. Outreach drafts addressed to these contacts are
-- removed by hand after a dry run (there were none on 2026-09-29).

DELETE FROM job_contacts
WHERE notes LIKE 'Discovered from verified public%'
   OR notes LIKE 'Identified from verified public%'
   OR email LIKE 'careers@%'
   OR email LIKE 'engineering@%';
