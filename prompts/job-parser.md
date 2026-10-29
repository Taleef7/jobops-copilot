# Job Parser Prompt

## Purpose

Convert a raw job description into structured, auditable JSON.

## Input Format

```json
{
  "job_id": "uuid",
  "description_text": "full job description text"
}
```

## Output Format

Return valid JSON only.

```json
{
  "company": "string or null",
  "title": "string or null",
  "location": "string or null",
  "workplace_type": "remote | hybrid | onsite | null",
  "required_skills": ["string"],
  "preferred_skills": ["string"],
  "responsibilities": ["string"],
  "seniority": "junior | mid | senior | lead | unknown",
  "cloud_tools": ["string"],
  "automation_tools": ["string"],
  "summary": "string"
}
```

## Safety And Quality Rules

- Return valid JSON only.
- Use `null` when a field is unknown.
- `location` and `workplace_type` come only from what the posting says; never default to remote.
- Do not infer aggressively.
- `seniority` comes from the role's own level: in its title, or where the posting states it ("this is an entry-level role"). Level words about other people or tasks ("work with senior engineers", "lead the migration") don't count. Without a level, use the years of experience asked for, however they are written ("3+ years", "a minimum of seven years", "4-6 yrs"; for a range, its lower end):
  - `lead`: Lead, Principal, Staff (as in Staff Engineer), or a title that manages people (Engineering Manager, Head of, Director); a Product, Project or Account Manager isn't one;
  - `senior`: Senior or Sr., or 6 or more years;
  - `junior`: Junior, Entry-level, Graduate or Intern, or under 2 years;
  - `mid`: 2 to 5 years, or neither a level nor years;
  - `unknown` only when the text describes no role at all. A posting that describes a role but gives no level or years is `mid`, not `unknown`.
- Separate cloud tools, automation tools, programming languages, and soft skills where possible.
- Keep the output grounded in the source text.
