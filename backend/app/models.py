from sqlalchemy import Column, Integer, String, Float, Boolean, ForeignKey, DateTime
from sqlalchemy.orm import DeclarativeBase, relationship
from datetime import datetime


class Base(DeclarativeBase):
    pass


class Driver(Base):
    __tablename__ = "drivers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    code = Column(String(3), unique=True, nullable=False)
    first_name = Column(String, nullable=False)
    last_name = Column(String, nullable=False)
    number = Column(Integer)
    constructor_id = Column(Integer, ForeignKey("constructors.id"))
    country = Column(String)

    constructor = relationship("Constructor", back_populates="drivers")
    scores = relationship("FantasyScore", foreign_keys="FantasyScore.asset_id",
                          primaryjoin="and_(Driver.id==FantasyScore.asset_id, FantasyScore.asset_type=='driver')",
                          viewonly=True)


class Constructor(Base):
    __tablename__ = "constructors"

    id = Column(Integer, primary_key=True, autoincrement=True)
    ref_id = Column(String, unique=True, nullable=False)
    name = Column(String, nullable=False)
    color = Column(String)

    drivers = relationship("Driver", back_populates="constructor")


class Circuit(Base):
    __tablename__ = "circuits"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    country = Column(String)
    overtake_difficulty = Column(Float, default=0.5)
    high_speed = Column(Float, default=0.5)
    street_circuit = Column(Boolean, default=False)
    altitude = Column(Integer, default=0)
    avg_degradation = Column(Float, default=0.5)


class Race(Base):
    __tablename__ = "races"

    id = Column(Integer, primary_key=True, autoincrement=True)
    round = Column(Integer, nullable=False)
    name = Column(String, nullable=False)
    circuit_id = Column(Integer, ForeignKey("circuits.id"))
    date = Column(String)
    has_sprint = Column(Boolean, default=False)

    circuit = relationship("Circuit")


class FantasyPrice(Base):
    __tablename__ = "fantasy_prices"

    id = Column(Integer, primary_key=True, autoincrement=True)
    asset_type = Column(String, nullable=False)
    asset_id = Column(Integer, nullable=False)
    race_id = Column(Integer, ForeignKey("races.id"), nullable=True)
    price = Column(Float, nullable=False)
    price_change = Column(Float, default=0)
    recorded_at = Column(DateTime, default=datetime.utcnow)


class FantasyScore(Base):
    __tablename__ = "fantasy_scores"

    id = Column(Integer, primary_key=True, autoincrement=True)
    asset_type = Column(String, nullable=False)
    asset_id = Column(Integer, nullable=False)
    race_id = Column(Integer, ForeignKey("races.id"))
    session_type = Column(String)
    qualifying_pts = Column(Float, default=0)
    race_position_pts = Column(Float, default=0)
    positions_gained_pts = Column(Float, default=0)
    overtake_pts = Column(Float, default=0)
    fastest_lap_pts = Column(Float, default=0)
    dotd_pts = Column(Float, default=0)
    dnf_penalty = Column(Float, default=0)
    pitstop_pts = Column(Float, default=0)
    total_pts = Column(Float, default=0)


class PitstopResult(Base):
    __tablename__ = "pitstop_results"

    id = Column(Integer, primary_key=True, autoincrement=True)
    constructor_id = Column(Integer, ForeignKey("constructors.id"))
    race_id = Column(Integer, ForeignKey("races.id"))
    stop_number = Column(Integer, default=1)
    time_seconds = Column(Float, nullable=False)
    points_scored = Column(Float, default=0)
    is_fastest = Column(Boolean, default=False)

    constructor = relationship("Constructor")
    race = relationship("Race")


class PowerUnitAllocation(Base):
    __tablename__ = "power_unit_allocations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    driver_id = Column(Integer, ForeignKey("drivers.id"))
    component_type = Column(String, nullable=False)  # ICE, TC, MGU-K, MGU-H, ES, CE, Gearbox
    race_id = Column(Integer, ForeignKey("races.id"))
    is_new = Column(Boolean, default=True)
    total_used = Column(Integer, default=1)

    driver = relationship("Driver")
    race = relationship("Race")


class SimulationResult(Base):
    __tablename__ = "simulation_results"

    id = Column(Integer, primary_key=True, autoincrement=True)
    race_id = Column(Integer, ForeignKey("races.id"))
    asset_type = Column(String, nullable=False)
    asset_id = Column(Integer, nullable=False)
    expected_pts_mean = Column(Float)
    expected_pts_median = Column(Float)
    expected_pts_std = Column(Float)
    expected_pts_p10 = Column(Float)
    expected_pts_p90 = Column(Float)
    qpace_mean = Column(Float)
    qpace_std = Column(Float)
    rpace_mean = Column(Float)
    rpace_std = Column(Float)
    dnf_probability = Column(Float)
    fl_probability = Column(Float)
    simulated_at = Column(DateTime, default=datetime.utcnow)
