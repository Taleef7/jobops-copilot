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
- Do not infer aggressively.
- Separate cloud tools, automation tools, programming languages, and soft skills where possible.
- Keep the output grounded in the source text.
