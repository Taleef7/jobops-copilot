"""The parser's seniority rule: what each level means, so the model doesn't fall back to unknown."""

from app.prompts import JOB_PARSER_SYSTEM


def test_seniority_rule_names_each_level():
    for cue in (
        "Take it from the role's own level",
        "Level words about other people or tasks",
        "lead: Lead, Principal, Staff (as in Staff Engineer), Manager, Head of or Director",
        "senior: Senior or Sr., or 6 or more years",
        "junior: Junior, Entry-level, Graduate or Intern, or under 2 years",
        "mid: 2 to 5 years, or neither a level nor years",
        "for a range, its lower end",
        "describes a role but gives no level or years is mid, not unknown",
    ):
        assert cue in JOB_PARSER_SYSTEM, cue
