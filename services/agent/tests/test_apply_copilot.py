from app.graph.apply_copilot import assemble_application_pack, normalize_and_hash_question


def test_normalize_and_hash_question():
    h1 = normalize_and_hash_question("Are you authorized to work in the US?")
    h2 = normalize_and_hash_question("  are you AUTHORIZED to work in the US:  ")
    assert h1 == h2
    assert len(h1) == 64

def test_assemble_application_pack_qa_memory_priority():
    q_text = "Are you legally authorized to work in the United States?"
    q_hash = normalize_and_hash_question(q_text)

    pack = assemble_application_pack(
        job_id="job-1",
        company="Acme Corp",
        title="Software Engineer",
        qa_memory=[
            {
                "questionText": q_text,
                "questionHash": q_hash,
                "answer": "Yes, US Citizen permanent resident",
            }
        ],
        preferences={"sponsorship_required": True},
    )

    q1 = next((a for a in pack.answers if a.question_hash == q_hash), None)
    assert q1 is not None
    # Q&A memory should take precedence over default preferences
    assert q1.answer == "Yes, US Citizen permanent resident"
    assert q1.source == "qa_memory"

def test_assemble_application_pack_with_resume_and_preferences():
    base_resume = {
        "basics": {
            "name": "Jane Doe",
            "email": "jane@example.com",
            "phone": "555-0199",
            "location": {"city": "San Francisco", "region": "CA"},
            "profiles": [{"network": "LinkedIn", "url": "https://linkedin.com/in/janedoe"}],
            "summary": "Full stack engineer specializing in TypeScript and distributed systems."
        },
        "work": [
            {
                "company": "Tech Corp",
                "position": "Senior Engineer",
                "highlights": ["Designed streaming pipeline processing 10M events/day"]
            }
        ]
    }

    pack = assemble_application_pack(
        job_id="job-2",
        company="Northwind Labs",
        title="AI Engineer",
        base_resume=base_resume,
        preferences={"salary_floor": 160000, "sponsorship_required": False}
    )

    # Contact block
    assert pack.contact_block.name == "Jane Doe"
    assert pack.contact_block.email == "jane@example.com"
    assert pack.contact_block.linkedin == "https://linkedin.com/in/janedoe"

    # Salary answer
    salary_answer = next((a for a in pack.answers if a.category == "salary"), None)
    assert salary_answer is not None
    assert "$160,000" in salary_answer.answer
    assert salary_answer.source == "preferences"

    # Behavioral answer
    behav_answer = next((a for a in pack.answers if a.category == "behavioral"), None)
    assert behav_answer is not None
    assert "Tech Corp" in behav_answer.answer
    assert "Senior Engineer" in behav_answer.answer

    # Why Us answer
    why_answer = next((a for a in pack.answers if a.category == "why_us"), None)
    assert why_answer is not None
    assert "Northwind Labs" in why_answer.answer
