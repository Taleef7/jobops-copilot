from app.rag.fusion import reciprocal_rank_fusion


def test_rrf_rewards_agreement_across_rankings():
    # "b" is rank-0 in BOTH lists, so it wins unambiguously (no exact tie to depend on
    # insertion order). "a" appears in both but lower; "c"/"d" appear once.
    dense = ["b", "a", "c"]
    lexical = ["b", "a", "d"]
    result = reciprocal_rank_fusion([dense, lexical], top_k=3)
    assert result[0] == "b"
    assert set(result) == {"b", "a", "c"} or set(result) == {"b", "a", "d"}
    assert result.index("a") < result.index(result[-1])  # "a" beats the single-list tail


def test_rrf_handles_empty_and_dedup():
    assert reciprocal_rank_fusion([[], ["x", "x"]], top_k=2) == ["x"]


def test_rrf_top_k_is_required():
    # Refinement: top_k is a required arg so a caller can never silently truncate
    # to a hidden default (production always passes fetch_k explicitly).
    import pytest

    with pytest.raises(TypeError):
        reciprocal_rank_fusion([["a", "b"]])
