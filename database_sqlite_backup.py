import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "fuelwise.db")

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # 1. Create Bikes Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS bikes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            base_mileage REAL NOT NULL,
            tank_capacity REAL NOT NULL DEFAULT 10.0
        )
    """)
    
    # 2. Create Trips Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS trips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            start_location TEXT,
            end_location TEXT,
            bike_name TEXT,
            speed REAL,
            fuel_input REAL,
            road_type TEXT,
            load_type TEXT,
            predicted_mileage REAL,
            predicted_range REAL,
            distance_km REAL,
            duration_hours REAL,
            status TEXT,
            fuel_needed REAL
        )
    """)
    
    # 3. Create Refueling Logs Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS refuel_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            liters REAL NOT NULL,
            price_per_liter REAL NOT NULL,
            cost REAL NOT NULL,
            odometer REAL NOT NULL,
            notes TEXT
        )
    """)
    
    # 4. Create Users Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            bike_name TEXT DEFAULT 'Hero Splendor',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # 5. Create Group Rides Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS group_rides (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            created_by TEXT NOT NULL,
            status TEXT DEFAULT 'ACTIVE',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # 6. Create Group Riders Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS group_riders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER NOT NULL,
            rider_id TEXT NOT NULL,
            rider_label TEXT NOT NULL,
            rider_name TEXT NOT NULL,
            bike_name TEXT NOT NULL,
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            fuel REAL NOT NULL,
            fuel_range REAL NOT NULL,
            mileage REAL NOT NULL,
            speed REAL NOT NULL,
            status TEXT NOT NULL DEFAULT 'Cruising',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(group_id, rider_id),
            FOREIGN KEY (group_id) REFERENCES group_rides(id) ON DELETE CASCADE
        )
    """)
    
    # Prepopulate default bikes if table is empty
    cursor.execute("SELECT COUNT(*) FROM bikes")
    if cursor.fetchone()[0] == 0:
        default_bikes = [
            ("Hero Splendor", 60.0, 9.8),
            ("Honda Shine", 55.0, 10.5),
            ("Bajaj Pulsar 150", 45.0, 15.0),
            ("TVS Apache", 40.0, 12.0)
        ]
        cursor.executemany(
            "INSERT INTO bikes (name, base_mileage, tank_capacity) VALUES (?, ?, ?)",
            default_bikes
        )
        conn.commit()
        
    conn.close()

# Helper database operation functions
def get_all_bikes():
    conn = get_db_connection()
    bikes = conn.execute("SELECT * FROM bikes ORDER BY name ASC").fetchall()
    conn.close()
    return [dict(b) for b in bikes]

def add_bike(name, base_mileage, tank_capacity):
    conn = get_db_connection()
    try:
        conn.execute(
            "INSERT INTO bikes (name, base_mileage, tank_capacity) VALUES (?, ?, ?)",
            (name, base_mileage, tank_capacity)
        )
        conn.commit()
        success = True
    except sqlite3.IntegrityError:
        success = False
    conn.close()
    return success

def delete_bike(bike_id):
    conn = get_db_connection()
    conn.execute("DELETE FROM bikes WHERE id = ?", (bike_id,))
    conn.commit()
    conn.close()

def get_all_trips():
    conn = get_db_connection()
    trips = conn.execute("SELECT * FROM trips ORDER BY timestamp DESC").fetchall()
    conn.close()
    return [dict(t) for t in trips]

def add_trip(start_location, end_location, bike_name, speed, fuel_input, road_type, load_type,
             predicted_mileage, predicted_range, distance_km, duration_hours, status, fuel_needed):
    conn = get_db_connection()
    conn.execute("""
        INSERT INTO trips (
            start_location, end_location, bike_name, speed, fuel_input, road_type, load_type,
            predicted_mileage, predicted_range, distance_km, duration_hours, status, fuel_needed
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (start_location, end_location, bike_name, speed, fuel_input, road_type, load_type,
          predicted_mileage, predicted_range, distance_km, duration_hours, status, fuel_needed))
    conn.commit()
    conn.close()

def delete_trip(trip_id):
    conn = get_db_connection()
    conn.execute("DELETE FROM trips WHERE id = ?", (trip_id,))
    conn.commit()
    conn.close()

def get_all_refuels():
    conn = get_db_connection()
    refuels = conn.execute("SELECT * FROM refuel_logs ORDER BY date DESC, id DESC").fetchall()
    conn.close()
    return [dict(r) for r in refuels]

def add_refuel(date, liters, price_per_liter, cost, odometer, notes):
    conn = get_db_connection()
    conn.execute("""
        INSERT INTO refuel_logs (date, liters, price_per_liter, cost, odometer, notes)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (date, liters, price_per_liter, cost, odometer, notes))
    conn.commit()
    conn.close()

def delete_refuel(refuel_id):
    conn = get_db_connection()
    conn.execute("DELETE FROM refuel_logs WHERE id = ?", (refuel_id,))
    conn.commit()
    conn.close()

def get_stats():
    conn = get_db_connection()
    total_trips = conn.execute("SELECT COUNT(*) FROM trips").fetchone()[0]
    total_dist = conn.execute("SELECT SUM(distance_km) FROM trips").fetchone()[0] or 0.0
    total_refuels = conn.execute("SELECT COUNT(*) FROM refuel_logs").fetchone()[0]
    total_spend = conn.execute("SELECT SUM(cost) FROM refuel_logs").fetchone()[0] or 0.0
    total_liters = conn.execute("SELECT SUM(liters) FROM refuel_logs").fetchone()[0] or 0.0
    total_bikes = conn.execute("SELECT COUNT(*) FROM bikes").fetchone()[0]
    conn.close()
    return {
        "total_trips": total_trips,
        "total_distance_km": round(float(total_dist), 2),
        "total_refuels": total_refuels,
        "total_spend": round(float(total_spend), 2),
        "total_liters": round(float(total_liters), 2),
        "total_bikes": total_bikes
    }

# ============================================================================
# USER AUTHENTICATION HELPERS
# ============================================================================

def get_or_create_user(phone, name=None, bike_name="Hero Splendor"):
    phone = str(phone).strip()
    conn = get_db_connection()
    user = conn.execute("SELECT * FROM users WHERE phone = ?", (phone,)).fetchone()
    if user:
        if name and name.strip() and user["name"] != name.strip():
            conn.execute("UPDATE users SET name = ?, bike_name = ? WHERE phone = ?", 
                         (name.strip(), bike_name or user["bike_name"], phone))
            conn.commit()
            user = conn.execute("SELECT * FROM users WHERE phone = ?", (phone,)).fetchone()
        conn.close()
        return dict(user)

    user_name = name.strip() if name and name.strip() else f"Rider {phone[-4:]}"
    conn.execute(
        "INSERT INTO users (phone, name, bike_name) VALUES (?, ?, ?)",
        (phone, user_name, bike_name or "Hero Splendor")
    )
    conn.commit()
    user = conn.execute("SELECT * FROM users WHERE phone = ?", (phone,)).fetchone()
    conn.close()
    return dict(user)

def get_user_by_phone(phone):
    conn = get_db_connection()
    user = conn.execute("SELECT * FROM users WHERE phone = ?", (str(phone).strip(),)).fetchone()
    conn.close()
    return dict(user) if user else None

def update_user_profile(phone, name, bike_name):
    conn = get_db_connection()
    conn.execute(
        "UPDATE users SET name = ?, bike_name = ? WHERE phone = ?",
        (name.strip(), bike_name, str(phone).strip())
    )
    conn.commit()
    user = conn.execute("SELECT * FROM users WHERE phone = ?", (str(phone).strip(),)).fetchone()
    conn.close()
    return dict(user) if user else None

# ============================================================================
# GROUP RIDE HELPERS
# ============================================================================

RIDER_LABELS = ["Rider A", "Rider B", "Rider C", "Rider D", "Rider E", "Rider F", "Rider G", "Rider H"]

def create_group_ride(code, name, created_by):
    code = code.strip().upper()
    conn = get_db_connection()
    try:
        conn.execute(
            "INSERT INTO group_rides (code, name, created_by) VALUES (?, ?, ?)",
            (code, name.strip(), str(created_by).strip())
        )
        conn.commit()
        ride = conn.execute("SELECT * FROM group_rides WHERE code = ?", (code,)).fetchone()
        conn.close()
        return dict(ride) if ride else None
    except sqlite3.IntegrityError:
        conn.close()
        return None

def get_group_ride_by_code(code):
    conn = get_db_connection()
    ride = conn.execute("SELECT * FROM group_rides WHERE code = ?", (code.strip().upper(),)).fetchone()
    conn.close()
    return dict(ride) if ride else None

def join_group_ride(code, rider_id, rider_name, bike_name, lat, lon, fuel=2.5, speed=50.0, fuel_range=120.0, mileage=50.0, status="Cruising"):
    code = code.strip().upper()
    conn = get_db_connection()
    ride = conn.execute("SELECT * FROM group_rides WHERE code = ?", (code,)).fetchone()
    if not ride:
        conn.close()
        return None, "Group ride not found"

    group_id = ride["id"]
    existing = conn.execute(
        "SELECT * FROM group_riders WHERE group_id = ? AND rider_id = ?", 
        (group_id, str(rider_id))
    ).fetchone()

    if existing:
        label = existing["rider_label"]
        conn.execute("""
            UPDATE group_riders 
            SET rider_name = ?, bike_name = ?, lat = ?, lon = ?, fuel = ?, speed = ?, 
                fuel_range = ?, mileage = ?, status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (rider_name, bike_name, lat, lon, fuel, speed, fuel_range, mileage, status, existing["id"]))
        conn.commit()
        updated = conn.execute("SELECT * FROM group_riders WHERE id = ?", (existing["id"],)).fetchone()
        conn.close()
        return dict(updated), None

    # Assign next available rider label (Rider A, Rider B, Rider C, Rider D, Rider E)
    current_riders = conn.execute(
        "SELECT rider_label FROM group_riders WHERE group_id = ? ORDER BY id ASC", 
        (group_id,)
    ).fetchall()
    used_labels = {r["rider_label"] for r in current_riders}
    
    assigned_label = None
    for lbl in RIDER_LABELS:
        if lbl not in used_labels:
            assigned_label = lbl
            break
    if not assigned_label:
        assigned_label = f"Rider {chr(65 + len(used_labels))}"

    conn.execute("""
        INSERT INTO group_riders (
            group_id, rider_id, rider_label, rider_name, bike_name, lat, lon, fuel,
            fuel_range, mileage, speed, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (group_id, str(rider_id), assigned_label, rider_name, bike_name, lat, lon, fuel,
          fuel_range, mileage, speed, status))
    conn.commit()
    new_rider = conn.execute(
        "SELECT * FROM group_riders WHERE group_id = ? AND rider_id = ?", 
        (group_id, str(rider_id))
    ).fetchone()
    conn.close()
    return dict(new_rider), None

def create_demo_5_riders_convoy(code, center_lat, center_lon, leader_name="Rider A (You)", leader_phone="9876543210", leader_bike="Hero Splendor"):
    code = code.strip().upper()
    conn = get_db_connection()
    
    # Upsert group ride
    ride = conn.execute("SELECT * FROM group_rides WHERE code = ?", (code,)).fetchone()
    if not ride:
        conn.execute(
            "INSERT INTO group_rides (code, name, created_by) VALUES (?, ?, ?)",
            (code, "FuelWise 5-Rider Convoy", leader_phone)
        )
        conn.commit()
        ride = conn.execute("SELECT * FROM group_rides WHERE code = ?", (code,)).fetchone()

    group_id = ride["id"]
    # Clear previous riders for fresh demo
    conn.execute("DELETE FROM group_riders WHERE group_id = ?", (group_id,))
    conn.commit()

    # 5 Riders: Rider A, Rider B, Rider C, Rider D, Rider E
    demo_riders = [
        {
            "rider_id": str(leader_phone),
            "label": "Rider A",
            "name": leader_name,
            "bike": leader_bike,
            "lat": round(center_lat, 6),
            "lon": round(center_lon, 6),
            "fuel": 2.5,
            "fuel_range": 150.0,
            "mileage": 60.0,
            "speed": 52.0,
            "status": "Cruising"
        },
        {
            "rider_id": "demo_rider_b",
            "label": "Rider B",
            "name": "Rider B (Karan)",
            "bike": "Honda Shine",
            "lat": round(center_lat + 0.0125, 6),
            "lon": round(center_lon + 0.0095, 6),
            "fuel": 4.2,
            "fuel_range": 231.0,
            "mileage": 55.0,
            "speed": 50.0,
            "status": "Cruising"
        },
        {
            "rider_id": "demo_rider_c",
            "label": "Rider C",
            "name": "Rider C (Amit)",
            "bike": "Bajaj Pulsar 150",
            "lat": round(center_lat + 0.0245, 6),
            "lon": round(center_lon + 0.0185, 6),
            "fuel": 0.85,
            "fuel_range": 36.5,
            "mileage": 43.0,
            "speed": 40.0,
            "status": "Low Fuel Warning"
        },
        {
            "rider_id": "demo_rider_d",
            "label": "Rider D",
            "name": "Rider D (Rohit)",
            "bike": "TVS Apache",
            "lat": round(center_lat - 0.0095, 6),
            "lon": round(center_lon - 0.0072, 6),
            "fuel": 3.1,
            "fuel_range": 124.0,
            "mileage": 40.0,
            "speed": 48.0,
            "status": "Cruising"
        },
        {
            "rider_id": "demo_rider_e",
            "label": "Rider E",
            "name": "Rider E (Sameer)",
            "bike": "Hero Splendor",
            "lat": round(center_lat + 0.0380, 6),
            "lon": round(center_lon + 0.0270, 6),
            "fuel": 1.6,
            "fuel_range": 96.0,
            "mileage": 60.0,
            "speed": 15.0,
            "status": "Refueling"
        }
    ]

    for r in demo_riders:
        conn.execute("""
            INSERT INTO group_riders (
                group_id, rider_id, rider_label, rider_name, bike_name, lat, lon, fuel,
                fuel_range, mileage, speed, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (group_id, r["rider_id"], r["label"], r["name"], r["bike"], r["lat"], r["lon"],
              r["fuel"], r["fuel_range"], r["mileage"], r["speed"], r["status"]))

    conn.commit()
    riders = conn.execute(
        "SELECT * FROM group_riders WHERE group_id = ? ORDER BY rider_label ASC", 
        (group_id,)
    ).fetchall()
    conn.close()
    return dict(ride), [dict(r) for r in riders]

def update_rider_telemetry(code, rider_id, lat, lon, fuel=None, speed=None, status=None, fuel_range=None, mileage=None):
    code = code.strip().upper()
    conn = get_db_connection()
    ride = conn.execute("SELECT id FROM group_rides WHERE code = ?", (code,)).fetchone()
    if not ride:
        conn.close()
        return None

    group_id = ride["id"]
    rider = conn.execute(
        "SELECT * FROM group_riders WHERE group_id = ? AND rider_id = ?",
        (group_id, str(rider_id))
    ).fetchone()
    if not rider:
        conn.close()
        return None

    # Merge values
    new_lat = float(lat) if lat is not None else rider["lat"]
    new_lon = float(lon) if lon is not None else rider["lon"]
    new_fuel = float(fuel) if fuel is not None else rider["fuel"]
    new_speed = float(speed) if speed is not None else rider["speed"]
    new_status = str(status) if status is not None else rider["status"]
    new_fuel_range = float(fuel_range) if fuel_range is not None else rider["fuel_range"]
    new_mileage = float(mileage) if mileage is not None else rider["mileage"]

    # Auto status update if fuel is critically low
    if new_fuel <= 1.0 and new_status not in ["Refueling", "Stopped"]:
        new_status = "Low Fuel Warning"

    conn.execute("""
        UPDATE group_riders 
        SET lat = ?, lon = ?, fuel = ?, speed = ?, status = ?, fuel_range = ?, mileage = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    """, (new_lat, new_lon, new_fuel, new_speed, new_status, new_fuel_range, new_mileage, rider["id"]))
    conn.commit()
    updated = conn.execute("SELECT * FROM group_riders WHERE id = ?", (rider["id"],)).fetchone()
    conn.close()
    return dict(updated)

def get_group_ride_state(code):
    code = code.strip().upper()
    conn = get_db_connection()
    ride = conn.execute("SELECT * FROM group_rides WHERE code = ?", (code,)).fetchone()
    if not ride:
        conn.close()
        return None
    riders = conn.execute(
        "SELECT * FROM group_riders WHERE group_id = ? ORDER BY rider_label ASC", 
        (ride["id"],)
    ).fetchall()
    conn.close()
    return {
        "ride": dict(ride),
        "riders": [dict(r) for r in riders]
    }

def leave_group_ride(code, rider_id):
    code = code.strip().upper()
    conn = get_db_connection()
    ride = conn.execute("SELECT id FROM group_rides WHERE code = ?", (code,)).fetchone()
    if ride:
        conn.execute(
            "DELETE FROM group_riders WHERE group_id = ? AND rider_id = ?",
            (ride["id"], str(rider_id))
        )
        conn.commit()
    conn.close()
    return True

if __name__ == "__main__":
    init_db()
    print("Database initialized successfully.")
