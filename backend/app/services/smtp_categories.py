CATEGORIES = ("general", "notifications", "otp", "rewards", "system_alerts", "task_updates", "welcome")


def category_for(value):
    value = (value or "notifications").lower()
    if value in CATEGORIES:
        return value
    if value in {"password_reset", "password_changed", "credentials_changed"}:
        return "otp"
    if value == "welcome_password":
        return "welcome"
    if value.startswith(("task", "subtask", "ticket", "project")):
        return "task_updates"
    if value.startswith("reward"):
        return "rewards"
    return "notifications"
