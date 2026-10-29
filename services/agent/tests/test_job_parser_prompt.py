"""The parser's seniority rule: what each level means, so the model doesn't fall back to unknown."""

from app.prompts import JOB_PARSER_SYSTEM


def test_seniority_rule_names_each_level():
    for cue in (
        "lead: lead, principal, staff",
        "senior: senior or Sr., or 6 or more years",
        "junior: junior, entry-level, graduate, intern, or under 2 years",
        "mid: 2 to 5 years, or a role that states neither a level nor years",
        "for a range, its lower end",
    ):
        assert cue in JOB_PARSER_SYSTEM, cue
