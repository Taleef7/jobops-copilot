# Weekly Report Prompt

## Purpose

Summarize CRM activity and recommend the next best actions for the week.

## Input Format

```json
{
  "week_start": "YYYY-MM-DD",
  "week_end": "YYYY-MM-DD",
  "jobs": [],
  "outreach": [],
  "responses": [],
  "interviews": []
}
```

## Output Format

Return valid JSON only.

```json
{
  "summary": "string",
  "metrics": {},
  "common_missing_skills": ["string"],
  "recommended_next_actions": ["string"],
  "report_markdown": "string"
}
```

## Safety And Quality Rules

- Keep the tone direct and strategic.
- Summarize the actual CRM data.
- Highlight bottlenecks and repeated skill gaps.
- Recommend concrete next steps.
