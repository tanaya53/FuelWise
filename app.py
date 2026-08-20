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
    # Try database lookup
    conn = database.get_db_connection()
    row = conn.execute("SELECT base_mileage FROM bikes WHERE name = ?", (bike_name,)).fetchone()
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

if __name__ == "__main__":
    app.run(debug=True, port=5000)