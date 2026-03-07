import json
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

from app.models import Base, Driver, Constructor, Circuit, Race, FantasyPrice

DATABASE_URL = "sqlite:///./f1fantasy.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    Base.metadata.create_all(bind=engine)


def seed_db():
    db = SessionLocal()
    if db.query(Driver).count() > 0:
        db.close()
        return

    data_path = Path(__file__).parent.parent / "data" / "seed_data.json"
    with open(data_path) as f:
        data = json.load(f)

    constructors_map = {}
    for c in data["constructors"]:
        constructor = Constructor(
            ref_id=c["id"],
            name=c["name"],
            color=c["color"],
        )
        db.add(constructor)
        db.flush()
        constructors_map[c["id"]] = constructor

        db.add(FantasyPrice(
            asset_type="constructor",
            asset_id=constructor.id,
            price=c["price"],
        ))

    for d in data["drivers"]:
        constructor = constructors_map[d["team_id"]]
        driver = Driver(
            code=d["code"],
            first_name=d["first_name"],
            last_name=d["last_name"],
            number=d["number"],
            constructor_id=constructor.id,
            country=d["country"],
        )
        db.add(driver)
        db.flush()

        db.add(FantasyPrice(
            asset_type="driver",
            asset_id=driver.id,
            price=d["price"],
        ))

    for r in data["calendar"]:
        circuit = Circuit(
            name=r["circuit"],
            country=r["country"],
            overtake_difficulty=r["overtake_difficulty"],
        )
        db.add(circuit)
        db.flush()

        race = Race(
            round=r["round"],
            name=r["name"],
            circuit_id=circuit.id,
            date=r["date"],
            has_sprint=r["sprint"],
        )
        db.add(race)

    db.commit()
    db.close()
