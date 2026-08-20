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

if __name__ == "__main__":
    init_db()
    print("Database initialized successfully.")
