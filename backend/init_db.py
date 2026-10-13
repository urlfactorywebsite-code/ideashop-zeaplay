from app.database import Base, engine; from app.models import *; from app.seed import seed_database; Base.metadata.create_all(bind=engine); seed_database()
