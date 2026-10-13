from __future__ import annotations

import math


BONUS = "BONUS"
PENALTY = "PENALTY"
NONE = "NONE"


def evaluate_time_bonus(task_duration: float, completion_time: float) -> str:
    if not math.isfinite(task_duration) or not math.isfinite(completion_time):
        raise ValueError("Duration values must be finite.")
    if task_duration <= 0:
        raise ValueError("allowed_time must be > 0.")
    if completion_time < 0:
        raise ValueError("completion_time cannot be negative.")

    bonus_threshold = task_duration * (5 / 6)
    late_penalty_threshold = task_duration * (4 / 3)

    if completion_time > late_penalty_threshold:
        return PENALTY
    if completion_time <= bonus_threshold:
        return BONUS
    return NONE
