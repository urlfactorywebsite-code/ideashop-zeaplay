"""Validation shared by self-service and administrative profile updates."""
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

FRAMES = {'classic', 'aurora', 'solar', 'emerald', 'role-ring', 'achievement-glow', 'minimal'}
EMPLOYEE_FIELD_LIMITS = {
    'employer_id': 255, 'title': 255, 'manager_email': 255, 'shift_name': 255,
    'department_id': 36, 'manager_id': 36, 'avatar_asset_id': 36, 'timezone': 64,
    **{name: 16 for name in ('shift_start', 'shift_end', 'morning_break_start', 'morning_break_end',
                            'lunch_break_start', 'lunch_break_end', 'evening_break_start', 'evening_break_end')},
}


def validate_employee_fields(value):
    """Match existing database limits without imposing new employment formats."""
    for field, limit in EMPLOYEE_FIELD_LIMITS.items():
        text = getattr(value, field, None)
        if text is not None and len(text) > limit:
            raise ValueError(f'{field} must contain at most {limit} characters')
    return value


def normalize_skills(value):
    if value is None:
        return []
    if len(value) > 30:
        raise ValueError('At most 30 skills are allowed')
    result, seen = [], set()
    for item in value:
        label = ' '.join(item.split())
        if not label or len(label) > 60:
            raise ValueError('Each skill must contain 1 to 60 characters')
        if label.casefold() not in seen:
            result.append(label)
            seen.add(label.casefold())
    return result


def validate_frame(value):
    if value is not None and value not in FRAMES:
        raise ValueError('Unknown avatar frame')
    return value


def validate_timezone(value):
    if value:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError('Use an IANA timezone, such as Asia/Kolkata') from exc
    return value
