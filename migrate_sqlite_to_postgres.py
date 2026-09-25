import sqlite3
from database_postgres import get_db_connection


SQLITE_DB = "fuelwise.db"


def get_sqlite_connection():
    conn = sqlite3.connect(SQLITE_DB)
    conn.row_factory = sqlite3.Row
    return conn


def migrate_table(sqlite_conn, pg_conn, table_name, columns):
    sqlite_cursor = sqlite_conn.cursor()
    pg_cursor = pg_conn.cursor()

    sqlite_cursor.execute(
        f"SELECT {', '.join(columns)} FROM {table_name}"
    )

    rows = sqlite_cursor.fetchall()

    if not rows:
        print(f"{table_name}: no data to migrate")
        return 0

    placeholders = ", ".join(["%s"] * len(columns))

    query = f"""
        INSERT INTO {table_name} ({', '.join(columns)})
        VALUES ({placeholders})
    """

    count = 0

    for row in rows:
        values = [row[column] for column in columns]

        try:
            pg_cursor.execute(query, values)
            count += 1
        except Exception as e:
            print(f"Error migrating {table_name} row: {e}")
            pg_conn.rollback()
            raise

    pg_conn.commit()

    print(f"{table_name}: migrated {count} rows")

    return count


def reset_postgres_tables(pg_conn):
    cursor = pg_conn.cursor()

    print("Clearing existing PostgreSQL data...")

    cursor.execute("""
        TRUNCATE TABLE
            group_riders,
            group_rides,
            refuel_logs,
            trips,
            users,
            bikes
        RESTART IDENTITY CASCADE
    """)

    pg_conn.commit()
    cursor.close()


def reset_sequences(pg_conn):
    cursor = pg_conn.cursor()

    tables = [
        "bikes",
        "trips",
        "refuel_logs",
        "users",
        "group_rides",
        "group_riders"
    ]

    for table in tables:
        cursor.execute(
            f"""
            SELECT setval(
                pg_get_serial_sequence('{table}', 'id'),
                COALESCE((SELECT MAX(id) FROM {table}), 1),
                EXISTS (SELECT 1 FROM {table})
            )
            """
        )

    pg_conn.commit()
    cursor.close()


def main():

    print("Connecting to SQLite...")
    sqlite_conn = get_sqlite_connection()

    print("Connecting to Neon PostgreSQL...")
    pg_conn = get_db_connection()

    try:

        # Make sure PostgreSQL tables exist
        from database_postgres import init_db
        init_db()

        # Clear the PostgreSQL tables before migration.
        # This is safe because the PostgreSQL database currently
        # contains only the default bikes created during initialization.
        reset_postgres_tables(pg_conn)

        print("\nStarting migration...\n")

        # IMPORTANT:
        # Migrate parent tables before group_riders because
        # group_riders references group_rides.

        migrate_table(
            sqlite_conn,
            pg_conn,
            "bikes",
            [
                "id",
                "name",
                "base_mileage",
                "tank_capacity"
            ]
        )

        migrate_table(
            sqlite_conn,
            pg_conn,
            "trips",
            [
                "id",
                "timestamp",
                "start_location",
                "end_location",
                "bike_name",
                "speed",
                "fuel_input",
                "road_type",
                "load_type",
                "predicted_mileage",
                "predicted_range",
                "distance_km",
                "duration_hours",
                "status",
                "fuel_needed"
            ]
        )

        migrate_table(
            sqlite_conn,
            pg_conn,
            "refuel_logs",
            [
                "id",
                "date",
                "liters",
                "price_per_liter",
                "cost",
                "odometer",
                "notes"
            ]
        )

        migrate_table(
            sqlite_conn,
            pg_conn,
            "users",
            [
                "id",
                "phone",
                "name",
                "bike_name",
                "created_at"
            ]
        )

        migrate_table(
            sqlite_conn,
            pg_conn,
            "group_rides",
            [
                "id",
                "code",
                "name",
                "created_by",
                "status",
                "created_at"
            ]
        )

        migrate_table(
            sqlite_conn,
            pg_conn,
            "group_riders",
            [
                "id",
                "group_id",
                "rider_id",
                "rider_label",
                "rider_name",
                "bike_name",
                "lat",
                "lon",
                "fuel",
                "fuel_range",
                "mileage",
                "speed",
                "status",
                "updated_at"
            ]
        )

        reset_sequences(pg_conn)

        print("\nMigration completed successfully!")

    finally:
        sqlite_conn.close()
        pg_conn.close()


if __name__ == "__main__":
    main()