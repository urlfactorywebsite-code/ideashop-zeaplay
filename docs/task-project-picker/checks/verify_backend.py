"""Run the legacy project suite with navigation storage in its isolated DB."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

import pytest


class NavigationTestSchema:
    def pytest_collection_modifyitems(self, items):
        from backend.app.models import NavigationPolicy

        for module in {item.module for item in items}:
            if not module.__name__.endswith("test_projects_phase4"):
                continue
            engine = module.engine
            assert engine.dialect.name == "sqlite" and engine.url.database in (None, "", ":memory:")
            NavigationPolicy.__table__.create(bind=engine, checkfirst=True)


raise SystemExit(pytest.main(["backend/tests/test_projects_phase4.py", "-q", "--tb=short"], plugins=[NavigationTestSchema()]))
