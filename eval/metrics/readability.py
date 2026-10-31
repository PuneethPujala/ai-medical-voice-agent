"""
MedVoice Clinical Response Evaluation Framework
Readability, Word Count, and Length Covariate Calculator

Enforces:
1. Response-length ratio (W_agent / W_physician) calculation with zero-division protection.
2. Standard Flesch-Kincaid Grade Level (FKGL) calculation for clinical communication difficulty.
3. Delta FKGL covariate calculation.
"""

import re
from typing import List


def count_words(text: str) -> int:
    """Counts whitespace-delimited words in a string."""
    if not text or not text.strip():
        return 0
    return len(text.strip().split())


def count_syllables_in_word(word: str) -> int:
    """
    Estimates syllable count for an English word using standard heuristic rules.
    """
    cleaned = re.sub(r'[^a-zA-Z]', '', word).lower()
    if not cleaned:
        return 0
    if len(cleaned) <= 3:
        return 1

    # Remove silent 'e' at end of word
    if cleaned.endswith('e') and not cleaned.endswith('le') and not cleaned.endswith('ee'):
        cleaned = cleaned[:-1]

    # Count vowel groups
    vowel_groups = re.findall(r'[aeiouy]+', cleaned)
    return max(1, len(vowel_groups))


def count_sentences(text: str) -> int:
    """Estimates sentence count from sentence boundary punctuation."""
    if not text or not text.strip():
        return 0
    sentences = re.split(r'[.!?]+', text.strip())
    non_empty = [s.strip() for s in sentences if s.strip()]
    return max(1, len(non_empty))


def calculate_fkgl(text: str) -> float:
    """
    Calculates Flesch-Kincaid Grade Level (FKGL).
    Formula: 0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59
    """
    if not text or not text.strip():
        return 0.0

    words = text.strip().split()
    total_words = len(words)
    if total_words == 0:
        return 0.0

    total_sentences = count_sentences(text)
    total_syllables = sum(count_syllables_in_word(w) for w in words)

    asl = total_words / total_sentences
    asw = total_syllables / total_words

    fkgl = (0.39 * asl) + (11.8 * asw) - 15.59
    return round(max(0.0, fkgl), 2)


def calculate_response_length_ratio(agent_word_count: int, physician_word_count: int) -> float:
    """
    Calculates the response-length ratio: W_agent / W_physician.
    Explicitly labeled response-length ratio (not 'spoken conciseness ratio').

    Raises:
        ValueError: If physician_word_count is <= 0 to prevent division by zero.
    """
    if physician_word_count <= 0:
        raise ValueError(
            f"Physician word count must be greater than zero for response-length ratio calculation (got {physician_word_count})."
        )
    return round(agent_word_count / physician_word_count, 4)


def calculate_delta_fkgl(agent_fkgl: float, physician_fkgl: float) -> float:
    """
    Calculates the difference in reading grade level: agent_fkgl - physician_fkgl.
    Negative value indicates agent response is simpler / more accessible than physician reference.
    """
    return round(agent_fkgl - physician_fkgl, 2)
