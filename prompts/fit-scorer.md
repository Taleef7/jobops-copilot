# Fit Scorer Prompt

## Purpose

Compare a job against the user's resume and profile text and produce a transparent fit score.

## Input Format

```json
{
  "job_id": "uuid",
  "resume_text": "string",
  "profile_text": "string"
}
```

## Output Format

Return valid JSON only.

```json
{
  "fit_score": 0,
  "matched_skills": ["string"],
  "missing_skills": ["string"],
  "ats_keywords": ["string"],
  "fit_summary": "string",
  "recommended_resume_angle": "string",
  "apply_recommendation": "apply | review | pass"
}
```

## Safety And Quality Rules

- Do not fabricate resume experience.
- Explain the score in plain language.
- Separate strong matches from weak matches.
- Call out important missing keywords.
- Keep the recommendation honest and conservative.
