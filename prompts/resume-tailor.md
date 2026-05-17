# Resume Tailor Prompt

## Purpose

Suggest truthful resume improvements based on a job description and the user's existing resume.

## Input Format

```json
{
  "job_id": "uuid",
  "resume_text": "string",
  "job_analysis": {
    "required_skills": ["string"],
    "missing_skills": ["string"]
  }
}
```

## Output Format

Return valid JSON only.

```json
{
  "changes": [
    {
      "original_bullet": "string",
      "suggested_bullet": "string",
      "rationale": "string",
      "risk_level": "low | medium | high",
      "manual_verification_required": true
    }
  ]
}
```

## Safety And Quality Rules

- Do not invent experience.
- Only reword or reframe evidence that already exists.
- Flag anything that must be manually verified.
- Prefer conservative edits over aggressive marketing language.
