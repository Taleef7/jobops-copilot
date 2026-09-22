"""Tests for StructuredResume and ResumeChangeDetail schemas."""

from app.schemas import (
    ResumeBasics,
    ResumeChangeDetail,
    ResumeEducation,
    ResumeLocation,
    ResumeProfile,
    ResumeProject,
    ResumeSkill,
    ResumeWorkExperience,
    StructuredResume,
)


def test_structured_resume_validation_and_roundtrip():
    resume = StructuredResume(
        basics=ResumeBasics(
            name="Alex Doe",
            label="Senior Backend Engineer",
            email="alex@example.com",
            phone="+1-555-0199",
            url="https://alexdoe.dev",
            summary="Experienced cloud backend engineer.",
            location=ResumeLocation(city="San Francisco", region="CA", country_code="US"),
            profiles=[
                ResumeProfile(network="GitHub", username="alexdoe", url="https://github.com/alexdoe"),
                ResumeProfile(network="LinkedIn", url="https://linkedin.com/in/alexdoe"),
            ],
        ),
        work=[
            ResumeWorkExperience(
                company="TechCorp",
                position="Senior Engineer",
                location="Remote",
                start_date="2022-01",
                end_date="Present",
                current=True,
                summary="Lead distributed teams.",
                highlights=["Reduced latency by 40%", "Migrated legacy monolith to Go services"],
            )
        ],
        education=[
            ResumeEducation(
                institution="UC Berkeley",
                area="Computer Science",
                study_type="B.S.",
                start_date="2016",
                end_date="2020",
                gpa="3.8",
                highlights=["Dean's Honor List"],
            )
        ],
        skills=[
            ResumeSkill(category="Languages", skills=["Python", "TypeScript", "Go"]),
            ResumeSkill(category="Cloud", skills=["AWS", "Docker", "Kubernetes"]),
        ],
        projects=[
            ResumeProject(
                name="Open Source Workflow Engine",
                description="High throughput event processing.",
                highlights=["1,000+ GitHub stars"],
                keywords=["Python", "Redis"],
                url="https://github.com/alexdoe/engine",
            )
        ],
    )

    data = resume.model_dump()
    reconstructed = StructuredResume.model_validate(data)

    assert reconstructed.basics.name == "Alex Doe"
    assert reconstructed.basics.label == "Senior Backend Engineer"
    assert reconstructed.basics.location is not None
    assert reconstructed.basics.location.city == "San Francisco"
    assert len(reconstructed.work) == 1
    assert reconstructed.work[0].highlights[0] == "Reduced latency by 40%"
    assert len(reconstructed.skills) == 2
    assert reconstructed.skills[0].skills == ["Python", "TypeScript", "Go"]


def test_resume_change_detail():
    change = ResumeChangeDetail(
        section="work[0].highlights[0]",
        old_text="Worked on latency",
        new_text="Reduced latency by 40% using Redis caching",
        rationale="Quantified achievement with measurable impact",
    )
    assert change.section == "work[0].highlights[0]"
    assert change.new_text.startswith("Reduced latency")
    assert change.rationale != ""
