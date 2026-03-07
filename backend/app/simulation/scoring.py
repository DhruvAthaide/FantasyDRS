QUALI_POINTS = {1: 10, 2: 9, 3: 8, 4: 7, 5: 6, 6: 5, 7: 4, 8: 3, 9: 2, 10: 1}
RACE_POINTS = {1: 25, 2: 18, 3: 15, 4: 12, 5: 10, 6: 8, 7: 6, 8: 4, 9: 2, 10: 1}
SPRINT_POINTS = {1: 8, 2: 7, 3: 6, 4: 5, 5: 4, 6: 3, 7: 2, 8: 1}

Q2_CUTOFF = 15
Q3_CUTOFF = 10


def score_qualifying_driver(position: int) -> int:
    return QUALI_POINTS.get(position, 0)


def score_race_position(position: int) -> int:
    return RACE_POINTS.get(position, 0)


def score_sprint_position(position: int) -> int:
    return SPRINT_POINTS.get(position, 0)


def score_constructor_qualifying_progression(pos1: int, pos2: int) -> int:
    in_q3 = [pos1 <= Q3_CUTOFF, pos2 <= Q3_CUTOFF]
    in_q2 = [pos1 <= Q2_CUTOFF, pos2 <= Q2_CUTOFF]

    if all(in_q3):
        return 10
    if any(in_q3):
        return 5
    if all(in_q2):
        return 3
    if any(in_q2):
        return 1
    return -1


def score_pitstop_time(time_seconds: float) -> int:
    if time_seconds < 2.0:
        return 20
    if time_seconds < 2.2:
        return 10
    if time_seconds < 2.5:
        return 5
    if time_seconds < 3.0:
        return 2
    return 0
