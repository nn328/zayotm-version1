"""Knowledge & Document Intelligence Engine (Layer 3-C).

Retrieval-augmented evidence over the policy corpus. TF-IDF passage retrieval
(scikit-learn) with a deterministic keyword-overlap fallback. The engine NEVER
invents evidence: when retrieval returns nothing above threshold it reports an
evidence gap for that finding.
"""

import logging
import re

logger = logging.getLogger("zayotm.knowledge")

try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import linear_kernel

    _SKLEARN = True
except Exception:  # noqa: BLE001 — dependency failed to install
    _SKLEARN = False

STOP = set(
    "a an and are as at be by for from has have in is it its of on or that the to was were will with without this than then".split()
)


def _passages(docs: list[dict]) -> list[dict]:
    out = []
    for doc in docs:
        sections = re.split(r"\n#{2,3}\s*|\n\n+", doc.get("body", ""))
        for idx, passage in enumerate(sections):
            passage = passage.strip()
            if len(passage) < 40:
                continue
            first_line = passage.splitlines()[0][:80]
            out.append(
                {
                    "doc_id": doc["id"],
                    "title": doc.get("title", "Untitled policy"),
                    "section": f"§{idx + 1} {first_line}",
                    "text": passage,
                }
            )
    return out


def _keyword_scores(query: str, passages: list[dict]) -> list[float]:
    q_tokens = {t for t in re.findall(r"[a-z0-9]+", query.lower()) if t not in STOP and len(t) > 2}
    scores = []
    for p in passages:
        tokens = set(re.findall(r"[a-z0-9]+", p["text"].lower()))
        overlap = len(q_tokens & tokens)
        scores.append(overlap / max(len(q_tokens), 1))
    return scores


def retrieve(query: str, docs: list[dict], k: int = 3, min_score: float = 0.05) -> tuple[list[dict], bool]:
    """Returns (evidence_items, gap). Each item: doc ref + snippet + retrieval score."""
    passages = _passages(docs)
    if not passages or not query.strip():
        return [], True

    if _SKLEARN:
        try:
            vectorizer = TfidfVectorizer(stop_words="english")
            matrix = vectorizer.fit_transform([p["text"] for p in passages])
            q_vec = vectorizer.transform([query])
            scores = linear_kernel(q_vec, matrix).flatten().tolist()
        except Exception as exc:  # noqa: BLE001
            logger.warning("TF-IDF retrieval failed, falling back to keywords: %s", exc)
            scores = _keyword_scores(query, passages)
    else:
        scores = _keyword_scores(query, passages)

    ranked = sorted(zip(passages, scores), key=lambda pair: pair[1], reverse=True)[:k]
    evidence = []
    for passage, score in ranked:
        if score < min_score:
            continue
        evidence.append(
            {
                "doc_id": passage["doc_id"],
                "title": passage["title"],
                "section": passage["section"],
                "snippet": passage["text"][:400],
                "score": round(float(score), 3),
                "query": query[:160],
            }
        )
    return evidence, len(evidence) == 0
