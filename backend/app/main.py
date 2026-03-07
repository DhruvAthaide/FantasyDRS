from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db, seed_db
from app.routers import drivers, constructors, races, simulation, budget, statistics, fixtures, chips, penalties, transfers, league

app = FastAPI(title="F1 Fantasy Prediction API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(drivers.router)
app.include_router(constructors.router)
app.include_router(races.router)
app.include_router(simulation.router)
app.include_router(budget.router)
app.include_router(statistics.router)
app.include_router(fixtures.router)
app.include_router(chips.router)
app.include_router(penalties.router)
app.include_router(transfers.router)
app.include_router(league.router)


@app.on_event("startup")
def startup():
    init_db()
    seed_db()


@app.get("/")
def root():
    return {"message": "F1 Fantasy Prediction API", "version": "1.0.0"}
