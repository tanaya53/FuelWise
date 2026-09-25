from flask import Flask, request, jsonify, render_template
import pandas as pd
import requests
import os
import csv
from sklearn.ensemble import RandomForestRegressor
import database

app = Flask(__name__)

# Initialize database
database.init_db()

# Global variables for AI model
ml_model = None
X_columns = []

# Base mileage mapping for default bikes
DEFAULT_BIKE_MILEAGE = {
    "Hero Splendor": 60.0,
    "Honda Shine": 55.0,
    "Bajaj Pulsar 150": 45.0,
    "TVS Apache": 40.0
}

def get_bike_base_mileage(bike_name):
    # Try mapping
    if bike_name in DEFAULT_BIKE_MILEAGE:
        return DEFAULT_BIKE_MILEAGE[bike_name]

    # Try PostgreSQL database lookup
    conn = database.get_db_connection()
    cursor = conn.cursor()

    try:
        cursor.execute(
            "SELECT base_mileage FROM bikes WHERE name = %s",
            (bike_name,)
        )
        row = cursor.fetchone()
    finally:
        cursor.close()
        conn.close()

    if row:
        return row["base_mileage"]

    return 50.0  # Fallback

def train_model():
    global ml_model, X_columns
    try:
        csv_path = os.path.join(os.path.dirname(__file__), "fuelwise_data.csv")
        if not os.path.exists(csv_path):
            # Create a default CSV if it doesn't exist
            with open(csv_path, mode="w", newline="") as file:
                writer = csv.writer(file)
                writer.writerow(["Bike", "Speed", "Fuel", "Distance", "Road", "Load", "Mileage"])
                writer.writerow(["Hero Splendor", 40, 2.0, 30, "Rural", 1, 62])
                writer.writerow(["Hero Splendor", 50, 2.0, 35, "Highway", 1, 60])
                writer.writerow(["Hero Splendor", 60, 2.5, 50, "Rural", 2, 55])
                writer.writerow(["Honda Shine", 40, 2.0, 35, "Rural", 1, 58])
                writer.writerow(["Honda Shine", 50, 2.5, 45, "Highway", 1, 55])
                writer.writerow(["Bajaj Pulsar 150", 40, 2.0, 35, "Rural", 1, 48])
                writer.writerow(["TVS Apache", 40, 2.0, 30, "Rural", 1, 43])

        data = pd.read_csv(csv_path)
        
        # Dynamically map base mileage for each row
        data["BaseMileage"] = data["Bike"].apply(get_bike_base_mileage)
        
        # One-hot encode Road
        data_encoded = pd.get_dummies(data.drop("Bike", axis=1), columns=["Road"], dtype=int)
        
        # Ensure all training features exist
        for col in ["Road_Highway", "Road_Rural"]:
            if col not in data_encoded.columns:
                data_encoded[col] = 0
                
        # Split features and target
        X = data_encoded.drop("Mileage", axis=1)
        y = data_encoded["Mileage"]
        
        X_columns = X.columns.tolist()
        
        # Train model
        model = RandomForestRegressor(n_estimators=100, random_state=42)
        model.fit(X, y)
        ml_model = model
        print("AI Model trained successfully with columns:", X_columns)
        return True
    except Exception as e:
        print("Error training model:", e)
        return False

# Initial training
train_model()

# =========================================================
# ROUTING CONTROLLER
# =========================================================

def fetch_route(start_lat, start_lon, end_lat, end_lon):
    url = f"https://router.project-osrm.org/route/v1/driving/{start_lon},{start_lat};{end_lon},{end_lat}"
    params = {
        "overview": "full",
        "geometries": "geojson"
    }
    try:
        response = requests.get(url, params=params, headers={"User-Agent": "FuelWise/1.0"}, timeout=15)
        if response.status_code != 200:
            return None
        route_data = response.json()
        if route_data.get("code") != "Ok":
            return None
        
        route = route_data["routes"][0]
        distance_km = route["distance"] / 1000.0
        duration_hours = route["duration"] / 3600.0
        geometry = route["geometry"]["coordinates"]
        
        return {
            "distance": distance_km,
            "duration": duration_hours,
            "geometry": geometry
        }
    except Exception as e:
        print("OSRM routing request failed:", e)
        return None

# =========================================================
# WEB ROUTES & API ENDPOINTS
# =========================================================

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/bikes", methods=["GET"])
def get_bikes():
    return jsonify(database.get_all_bikes())

@app.route("/api/bikes", methods=["POST"])
def create_bike():
    req = request.json
    name = req.get("name")
    base_mileage = float(req.get("base_mileage", 50))
    tank_capacity = float(req.get("tank_capacity", 10))
    
    if not name:
        return jsonify({"success": False, "message": "Bike name is required"}), 400
        
    success = database.add_bike(name, base_mileage, tank_capacity)
    if success:
        return jsonify({"success": True, "message": f"Bike '{name}' added successfully"})
    else:
        return jsonify({"success": False, "message": "Bike name must be unique"}), 400

@app.route("/api/bikes/<int:bike_id>", methods=["DELETE"])
def remove_bike(bike_id):
    # Prevent deleting pre-populated base bikes
    conn = database.get_db_connection()
    bike = conn.execute("SELECT name FROM bikes WHERE id = ?", (bike_id,)).fetchone()
    conn.close()
    if bike and bike["name"] in DEFAULT_BIKE_MILEAGE:
        return jsonify({"success": False, "message": "Cannot delete default bikes"}), 403
        
    database.delete_bike(bike_id)
    return jsonify({"success": True, "message": "Bike deleted successfully"})

@app.route("/api/predict", methods=["POST"])
def predict():
    global ml_model, X_columns
    if ml_model is None:
        train_model()
        
    req = request.json
    start_lat = req.get("start_lat")
    start_lon = req.get("start_lon")
    end_lat = req.get("end_lat")
    end_lon = req.get("end_lon")
    start_location = req.get("start_location", "Start Point")
    end_location = req.get("end_location", "Destination")
    
    bike_name = req.get("bike_name")
    fuel = float(req.get("fuel", 1.0))
    speed = float(req.get("speed", 50.0))
    road = req.get("road", "Highway")
    load_type = req.get("load", "Rider Only")
    
    load_val = 1 if load_type == "Rider Only" else 2
    base_mileage = get_bike_base_mileage(bike_name)
    
    # 1. Predict Mileage using AI Model
    new_ride = pd.DataFrame([{
        "Speed": speed,
        "Fuel": fuel,
        "Distance": 0.0,
        "Load": load_val,
        "BaseMileage": base_mileage,
        "Road_Highway": 1 if road == "Highway" else 0,
        "Road_Rural": 1 if road == "Rural" else 0
    }])
    
    # Align features
    new_ride = new_ride.reindex(columns=X_columns, fill_value=0)
    
    try:
        predicted_mileage = ml_model.predict(new_ride)[0]
    except Exception as e:
        # Fallback math if ML fails
        print("ML prediction failed, falling back to base calculation:", e)
        factor = 1.0
        if speed > 60:
            factor = 0.85
        elif speed > 80:
            factor = 0.70
        predicted_mileage = base_mileage * factor
        
    predicted_range = fuel * predicted_mileage
    
    # 2. Get Route Distance using OSRM
    route_details = None
    distance_km = 0.0
    duration_hours = 0.0
    geometry = []
    
    if start_lat and start_lon and end_lat and end_lon:
        route_details = fetch_route(start_lat, start_lon, end_lat, end_lon)
        
    if route_details:
        distance_km = route_details["distance"]
        duration_hours = route_details["duration"]
        geometry = route_details["geometry"]
    else:
        # Simple straight-line fallback distance in km (approx 15 km if not provided)
        distance_km = float(req.get("fallback_distance", 15.0))
        duration_hours = distance_km / max(speed, 10.0)
        geometry = []

    # 3. Analyze Fuel Sufficiency
    fuel_needed = distance_km / max(predicted_mileage, 1.0)
    sufficient = bool(predicted_range >= distance_km)
    
    if sufficient:
        status = "🟢 Sufficient Fuel"
    else:
        status = "🔴 Refuel Required"
        
    # Auto-save trip to database
    database.add_trip(
        start_location=start_location,
        end_location=end_location,
        bike_name=bike_name,
        speed=speed,
        fuel_input=fuel,
        road_type=road,
        load_type=load_type,
        predicted_mileage=float(predicted_mileage),
        predicted_range=float(predicted_range),
        distance_km=float(distance_km),
        duration_hours=float(duration_hours),
        status=status,
        fuel_needed=float(fuel_needed)
    )
    
    # Return details
    return jsonify({
        "success": True,
        "predicted_mileage": float(predicted_mileage),
        "predicted_range": float(predicted_range),
        "distance_km": float(distance_km),
        "duration_hours": float(duration_hours),
        "fuel_needed": float(fuel_needed),
        "status": status,
        "geometry": geometry,
        "sufficient": sufficient
    })

@app.route("/api/trips", methods=["GET"])
def get_trips():
    return jsonify(database.get_all_trips())

@app.route("/api/trips/<int:trip_id>", methods=["DELETE"])
def remove_trip(trip_id):
    database.delete_trip(trip_id)
    return jsonify({"success": True, "message": "Trip deleted from history"})

@app.route("/api/refuels", methods=["GET"])
def get_refuels():
    return jsonify(database.get_all_refuels())

@app.route("/api/refuels", methods=["POST"])
def add_refuel():
    req = request.json
    date = req.get("date")
    liters = float(req.get("liters", 0))
    price_per_liter = float(req.get("price_per_liter", 0))
    cost = liters * price_per_liter
    odometer = float(req.get("odometer", 0))
    notes = req.get("notes", "")
    
    if not date or liters <= 0 or price_per_liter <= 0:
        return jsonify({"success": False, "message": "Invalid refueling data"}), 400
        
    database.add_refuel(date, liters, price_per_liter, cost, odometer, notes)
    return jsonify({"success": True, "message": "Refuel logged successfully"})

@app.route("/api/refuels/<int:refuel_id>", methods=["DELETE"])
def remove_refuel(refuel_id):
    database.delete_refuel(refuel_id)
    return jsonify({"success": True, "message": "Refuel log deleted"})

@app.route("/api/retrain", methods=["POST"])
def retrain():
    req = request.json
    bike = req.get("bike")
    speed = float(req.get("speed", 50))
    fuel = float(req.get("fuel", 1.0))
    distance = float(req.get("distance", 10.0))
    road = req.get("road", "Highway")
    load = int(req.get("load", 1))
    actual_mileage = float(req.get("mileage"))
    
    if not bike or actual_mileage <= 0:
        return jsonify({"success": False, "message": "Invalid ride training data"}), 400
        
    # Append to CSV file
    csv_path = os.path.join(os.path.dirname(__file__), "fuelwise_data.csv")
    try:
        with open(csv_path, mode="a", newline="") as file:
            writer = csv.writer(file)
            writer.writerow([bike, speed, fuel, distance, road, load, actual_mileage])
        
        # Retrain ML Model
        trained = train_model()
        if trained:
            return jsonify({"success": True, "message": "Dataset updated & AI model successfully retrained!"})
        else:
            return jsonify({"success": False, "message": "Data appended, but retraining failed."}), 500
    except Exception as e:
        return jsonify({"success": False, "message": f"Error writing to dataset: {str(e)}"}), 500

@app.route("/api/stats", methods=["GET"])
def get_stats():
    # Helper endpoint to supply charts with dataset data and database statistics
    try:
        csv_path = os.path.join(os.path.dirname(__file__), "fuelwise_data.csv")
        data = pd.read_csv(csv_path)
        
        # 1. Prepare Speed vs Mileage Scatter Data
        scatter_points = []
        for _, row in data.iterrows():
            scatter_points.append({
                "x": float(row["Speed"]),
                "y": float(row["Mileage"]),
                "bike": row["Bike"]
            })
            
        # 2. Fuel Expenses from Refuel logs
        refuels = database.get_all_refuels()
        refuel_dates = []
        refuel_costs = []
        refuel_liters = []
        # Sort oldest first for chronological chart
        for ref in sorted(refuels, key=lambda x: x["date"]):
            refuel_dates.append(ref["date"])
            refuel_costs.append(ref["cost"])
            refuel_liters.append(ref["liters"])
            
        # 3. Average Predicted vs Actual comparison (summarized from CSV)
        bike_mileages = data.groupby("Bike")["Mileage"].mean().to_dict()
        
        return jsonify({
            "success": True,
            "scatter": scatter_points,
            "refuel_dates": refuel_dates,
            "refuel_costs": refuel_costs,
            "refuel_liters": refuel_liters,
            "bike_mileages": bike_mileages
        })
    except Exception as e:
        return jsonify({"success": False, "message": f"Error loading stats: {str(e)}"}), 500




# ============================================================================
# PHONE / OTP AUTHENTICATION
# ============================================================================

DEMO_OTP = "7788"


@app.route("/api/auth/send-otp", methods=["POST"])
def send_otp():
    try:
        data = request.get_json() or {}
        phone = str(data.get("phone", "")).strip()

        # Basic phone validation
        if not phone.isdigit() or len(phone) != 10:
            return jsonify({
                "success": False,
                "message": "Please enter a valid 10-digit phone number"
            }), 400

        # Demo mode: no SMS service required
        return jsonify({
            "success": True,
            "message": "OTP sent successfully",
            "demo_otp": DEMO_OTP
        })

    except Exception as e:
        return jsonify({
            "success": False,
            "message": f"Error sending OTP: {str(e)}"
        }), 500


@app.route("/api/auth/verify-otp", methods=["POST"])
def verify_otp():
    try:
        data = request.get_json() or {}

        phone = str(data.get("phone", "")).strip()
        otp = str(data.get("otp", "")).strip()
        name = str(data.get("name", "")).strip()
        bike_name = str(
            data.get("bike_name", "Hero Splendor")
        ).strip()

        # Validate phone
        if not phone.isdigit() or len(phone) != 10:
            return jsonify({
                "success": False,
                "message": "Please enter a valid 10-digit phone number"
            }), 400

        # Validate OTP
        if otp != DEMO_OTP:
            return jsonify({
                "success": False,
                "message": "Invalid OTP. Please use the demo OTP."
            }), 401

        # Create new user or get existing user
        user = database.get_or_create_user(
            phone=phone,
            name=name if name else None,
            bike_name=bike_name or "Hero Splendor"
        )

        return jsonify({
            "success": True,
            "message": "Login successful",
            "user": user
        })

    except Exception as e:
        return jsonify({
            "success": False,
            "message": f"Error verifying OTP: {str(e)}"
        }), 500


@app.route("/api/auth/quick-login", methods=["POST"])
def quick_login():
    try:
        data = request.get_json() or {}

        phone = str(
            data.get("phone", "9876543210")
        ).strip()

        name = str(
            data.get("name", "Ved (Rider A)")
        ).strip()

        bike_name = str(
            data.get("bike_name", "Hero Splendor")
        ).strip()

        # Create or retrieve demo user
        user = database.get_or_create_user(
            phone=phone,
            name=name,
            bike_name=bike_name
        )

        return jsonify({
            "success": True,
            "message": "Demo login successful",
            "user": user
        })

    except Exception as e:
        return jsonify({
            "success": False,
            "message": f"Error during demo login: {str(e)}"
        }), 500


# ============================================================================
# GROUP RIDE / CONVOY API
# ============================================================================

@app.route("/api/group/demo-convoy", methods=["POST"])
def demo_convoy():
    try:
        data = request.get_json() or {}

        code = str(
            data.get("code", "CONVOY-5")
        ).strip().upper()

        lat = float(data.get("lat", 19.0760))
        lon = float(data.get("lon", 72.8777))

        leader_name = str(
            data.get("name", "Rider A (You)")
        ).strip()

        leader_phone = str(
            data.get("phone", "9876543210")
        ).strip()

        leader_bike = str(
            data.get("bike_name", "Hero Splendor")
        ).strip()

        ride, riders = database.create_demo_5_riders_convoy(
            code=code,
            center_lat=lat,
            center_lon=lon,
            leader_name=leader_name,
            leader_phone=leader_phone,
            leader_bike=leader_bike
        )

        return jsonify({
            "success": True,
            "code": code,
            "ride": ride,
            "riders": riders
        })

    except Exception as e:
        return jsonify({
            "success": False,
            "error": f"Failed to create demo convoy: {str(e)}"
        }), 500


@app.route("/api/group/<code>/status", methods=["GET"])
def group_status(code):
    try:
        state = database.get_group_ride_state(code)

        if not state:
            return jsonify({
                "success": False,
                "error": "Group ride not found"
            }), 404

        riders = state["riders"]

        # Find the first rider with critically low fuel.
        low_fuel_rider = next(
            (
                rider for rider in riders
                if float(rider.get("fuel", 0) or 0) <= 1.0
                and rider.get("status") not in ["Refueling", "Stopped"]
            ),
            None
        )

        alert = None

        if low_fuel_rider:
            alert = (
                f"{low_fuel_rider.get('rider_label', 'Rider')} "
                f"has low fuel ({float(low_fuel_rider.get('fuel', 0)):.2f}L). "
                f"Nearest fuel station recommended."
            )

        return jsonify({
            "success": True,
            "code": code.strip().upper(),
            "ride": state["ride"],
            "riders": riders,
            "alert": alert
        })

    except Exception as e:
        return jsonify({
            "success": False,
            "error": f"Failed to fetch convoy status: {str(e)}"
        }), 500


@app.route("/api/group/<code>/update", methods=["POST"])
def update_group_rider(code):
    try:
        data = request.get_json() or {}

        rider_id = str(
            data.get("rider_id", "")
        ).strip()

        if not rider_id:
            return jsonify({
                "success": False,
                "error": "rider_id is required"
            }), 400

        state = database.get_group_ride_state(code)

        if not state:
            return jsonify({
                "success": False,
                "error": "Group ride not found"
            }), 404

        # Make sure this rider actually belongs to this convoy.
        rider_exists = any(
            str(rider.get("rider_id")) == rider_id
            for rider in state["riders"]
        )

        if not rider_exists:
            return jsonify({
                "success": False,
                "error": "Rider is not a member of this group"
            }), 404

        updated = database.update_rider_telemetry(
            code=code,
            rider_id=rider_id,
            lat=data.get("lat"),
            lon=data.get("lon"),
            fuel=data.get("fuel"),
            speed=data.get("speed"),
            status=data.get("status"),
            fuel_range=data.get("fuel_range"),
            mileage=data.get("mileage")
        )

        if not updated:
            return jsonify({
                "success": False,
                "error": "Unable to update rider telemetry"
            }), 400

        return jsonify({
            "success": True,
            "rider": updated
        })

    except (TypeError, ValueError) as e:
        return jsonify({
            "success": False,
            "error": f"Invalid telemetry value: {str(e)}"
        }), 400

    except Exception as e:
        return jsonify({
            "success": False,
            "error": f"Failed to update telemetry: {str(e)}"
        }), 500


@app.route("/api/group/<code>/simulate-step", methods=["POST"])
def simulate_group_step(code):
    try:
        state = database.get_group_ride_state(code)

        if not state:
            return jsonify({
                "success": False,
                "error": "Group ride not found"
            }), 404

        riders = state["riders"]

        for index, rider in enumerate(riders):
            rider_id = str(rider.get("rider_id"))

            try:
                current_lat = float(rider.get("lat") or 19.0760)
                current_lon = float(rider.get("lon") or 72.8777)
                current_fuel = float(rider.get("fuel") or 0)
                current_speed = float(rider.get("speed") or 0)
                current_range = float(rider.get("fuel_range") or 0)
                mileage = float(rider.get("mileage") or 50)

                # Small movement so the convoy visibly moves on the map.
                movement_lat = 0.00035 + (index * 0.00003)
                movement_lon = 0.00025 + (index * 0.00002)

                new_lat = current_lat + movement_lat
                new_lon = current_lon + movement_lon

                # Simulate small fuel consumption.
                fuel_consumption = 0.015 + (current_speed / 10000)

                new_fuel = max(
                    0.0,
                    current_fuel - fuel_consumption
                )

                # Recalculate approximate remaining range.
                new_range = max(
                    0.0,
                    new_fuel * mileage
                )

                if new_fuel <= 1.0:
                    new_status = "Low Fuel Warning"
                elif rider.get("status") == "Refueling":
                    new_status = "Refueling"
                else:
                    new_status = "Cruising"

                database.update_rider_telemetry(
                    code=code,
                    rider_id=rider_id,
                    lat=new_lat,
                    lon=new_lon,
                    fuel=new_fuel,
                    speed=current_speed,
                    status=new_status,
                    fuel_range=new_range,
                    mileage=mileage
                )

            except (TypeError, ValueError):
                # Ignore malformed individual rider data and continue
                # simulating the remaining riders.
                continue

        updated_state = database.get_group_ride_state(code)

        return jsonify({
            "success": True,
            "code": code.strip().upper(),
            "riders": updated_state["riders"] if updated_state else []
        })

    except Exception as e:
        return jsonify({
            "success": False,
            "error": f"Simulation step failed: {str(e)}"
        }), 500


@app.route("/api/group/create", methods=["POST"])
def create_group():
    try:
        data = request.get_json() or {}

        name = str(
            data.get("name", "Weekend Highway Ride")
        ).strip()

        code = str(
            data.get("code", "")
        ).strip().upper()

        phone = str(
            data.get("phone", "9876543210")
        ).strip()

        rider_name = str(
            data.get("rider_name", "Leader")
        ).strip()

        bike_name = str(
            data.get("bike_name", "Hero Splendor")
        ).strip()

        lat = float(data.get("lat", 19.0760))
        lon = float(data.get("lon", 72.8777))

        if not name:
            name = "Weekend Highway Ride"

        if not code:
            return jsonify({
                "success": False,
                "error": "Please enter a group ride code"
            }), 400

        ride = database.create_group_ride(
            code=code,
            name=name,
            created_by=phone
        )

        if not ride:
            return jsonify({
                "success": False,
                "error": "This group ride code already exists"
            }), 409

        rider, join_error = database.join_group_ride(
            code=code,
            rider_id=phone,
            rider_name=rider_name,
            bike_name=bike_name,
            lat=lat,
            lon=lon,
            fuel=2.5,
            speed=50.0,
            fuel_range=120.0,
            mileage=database.get_bike_base_mileage(bike_name)
            if hasattr(database, "get_bike_base_mileage")
            else 50.0,
            status="Cruising"
        )

        if join_error:
            return jsonify({
                "success": False,
                "error": join_error
            }), 400

        return jsonify({
            "success": True,
            "code": code,
            "ride": ride,
            "rider": rider
        })

    except ValueError as e:
        return jsonify({
            "success": False,
            "error": f"Invalid location value: {str(e)}"
        }), 400

    except Exception as e:
        return jsonify({
            "success": False,
            "error": f"Failed to create group ride: {str(e)}"
        }), 500


@app.route("/api/group/join", methods=["POST"])
def join_group():
    try:
        data = request.get_json() or {}

        code = str(
            data.get("code", "")
        ).strip().upper()

        rider_name = str(
            data.get("rider_name", "Rider")
        ).strip()

        phone = str(
            data.get("phone", "")
        ).strip()

        bike_name = str(
            data.get("bike_name", "Hero Splendor")
        ).strip()

        lat = float(data.get("lat", 19.0760))
        lon = float(data.get("lon", 72.8777))

        if not code:
            return jsonify({
                "success": False,
                "error": "Group ride code is required"
            }), 400

        if not phone:
            return jsonify({
                "success": False,
                "error": "Rider phone/id is required"
            }), 400

        mileage = 50.0

        if bike_name in DEFAULT_BIKE_MILEAGE:
            mileage = DEFAULT_BIKE_MILEAGE[bike_name]

        rider, join_error = database.join_group_ride(
            code=code,
            rider_id=phone,
            rider_name=rider_name or "Rider",
            bike_name=bike_name,
            lat=lat,
            lon=lon,
            fuel=2.5,
            speed=50.0,
            fuel_range=120.0,
            mileage=mileage,
            status="Cruising"
        )

        if join_error:
            return jsonify({
                "success": False,
                "error": join_error
            }), 404

        return jsonify({
            "success": True,
            "code": code,
            "rider": rider
        })

    except ValueError as e:
        return jsonify({
            "success": False,
            "error": f"Invalid location value: {str(e)}"
        }), 400

    except Exception as e:
        return jsonify({
            "success": False,
            "error": f"Failed to join group ride: {str(e)}"
        }), 500


@app.route("/api/fuel-stations", methods=["GET"])
def get_fuel_stations():
    try:
        lat = float(request.args.get("lat", 19.0760))
        lon = float(request.args.get("lon", 72.8777))

        stations = [
            {
                "name": "Indian Oil",
                "brand": "IndianOil",
                "lat": lat + 0.0080,
                "lon": lon + 0.0060,
                "distance_km": 1.1
            },
            {
                "name": "Bharat Petroleum",
                "brand": "BPCL",
                "lat": lat - 0.0060,
                "lon": lon + 0.0090,
                "distance_km": 1.3
            },
            {
                "name": "Hindustan Petroleum",
                "brand": "HP",
                "lat": lat + 0.0110,
                "lon": lon - 0.0070,
                "distance_km": 1.6
            },
            {
                "name": "Reliance Fuel Station",
                "brand": "Reliance",
                "lat": lat - 0.0100,
                "lon": lon - 0.0050,
                "distance_km": 1.8
            },
            {
                "name": "Nayara Energy",
                "brand": "Nayara",
                "lat": lat + 0.0140,
                "lon": lon + 0.0100,
                "distance_km": 2.1
            }
        ]

        end_lat = request.args.get("end_lat")
        end_lon = request.args.get("end_lon")

        return jsonify(stations)

    except (TypeError, ValueError):
        return jsonify({
            "error": "Invalid latitude or longitude"
        }), 400


if __name__ == "__main__":
    app.run(debug=True, port=5000)