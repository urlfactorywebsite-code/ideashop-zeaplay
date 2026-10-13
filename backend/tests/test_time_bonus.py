import math

import pytest

from backend.app.services.time_bonus import BONUS, NONE, PENALTY, evaluate_time_bonus


def test_exact_bonus_threshold():
    duration = 3 * 3600
    bonus_threshold = duration * (5 / 6)
    assert evaluate_time_bonus(duration, bonus_threshold) == BONUS


def test_exact_late_threshold():
    duration = 3 * 3600
    late_threshold = duration * (4 / 3)
    assert evaluate_time_bonus(duration, late_threshold) == NONE


@pytest.mark.parametrize(
    ("duration", "completion", "expected"),
    [
        (3 * 3600, 2 * 3600, BONUS),
        (3 * 3600, 3 * 3600, NONE),
        (3 * 3600, 4 * 3600, NONE),
        (3 * 3600, 4 * 3600 + 1, PENALTY),
    ],
)
def test_example_cases(duration, completion, expected):
    assert evaluate_time_bonus(duration, completion) == expected


@pytest.mark.parametrize(
    ("duration", "completion", "expected"),
    [
        (1e-6, 0.0, BONUS),
        (1e-6, 1e-6, NONE),
        (1e12, 0.0, BONUS),
        (1e12, 1e12, NONE),
        (1e12, 1e12 * 2, PENALTY),
    ],
)
def test_small_and_large_values(duration, completion, expected):
    assert evaluate_time_bonus(duration, completion) == expected


@pytest.mark.parametrize(
    ("duration", "completion"),
    [
        (0, 1),
        (-1, 1),
        (1, -1),
        (math.nan, 1),
        (1, math.nan),
        (math.inf, 1),
        (1, math.inf),
    ],
)
def test_invalid_inputs(duration, completion):
    with pytest.raises(ValueError):
        evaluate_time_bonus(duration, completion)
