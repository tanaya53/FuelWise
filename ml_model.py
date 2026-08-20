import pandas as pd

from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error

# Load dataset
data = pd.read_csv("fuelwise_data.csv")

print("===== FuelWise AI Model =====")

# Convert text columns into numbers
data = pd.get_dummies(
    data,
    columns=["Bike", "Road"],
    dtype=int
)

# Features and target
X = data.drop("Mileage", axis=1)
y = data["Mileage"]

# Split dataset
X_train, X_test, y_train, y_test = train_test_split(
    X,
    y,
    test_size=0.2,
    random_state=42
)

print("\nTraining AI model...")

# Create model
model = RandomForestRegressor(
    n_estimators=100,
    random_state=42
)

# Train model
model.fit(X_train, y_train)

# Test model
predictions = model.predict(X_test)

# Calculate error
error = mean_absolute_error(y_test, predictions)

print("\nModel trained successfully! ✅")
print(f"Mean Absolute Error: {error:.2f} km/litre")

print("\nActual vs Predicted:")
for actual, predicted in zip(y_test, predictions):
    print(
        f"Actual: {actual:.2f} | "
        f"Predicted: {predicted:.2f}"
    )
    # -----------------------------
# New Riding Condition Prediction
# -----------------------------

print("\n===== New Ride Prediction =====")

new_ride = pd.DataFrame([{
    "Speed": 50,
    "Fuel": 2.0,
    "Distance": 40,
    "Load": 1,
    "Bike_Bajaj Pulsar 150": 1,
    "Bike_Hero Splendor": 0,
    "Bike_Honda Shine": 0,
    "Bike_TVS Apache": 0,
    "Road_Highway": 0,
    "Road_Rural": 1
}])

# Make sure columns are exactly same as training data
new_ride = new_ride.reindex(columns=X.columns, fill_value=0)

predicted_mileage = model.predict(new_ride)[0]

print(f"Predicted Mileage: {predicted_mileage:.2f} km/litre")

fuel = 2.0

predicted_range = fuel * predicted_mileage

print(f"Current Fuel: {fuel:.2f} litres")
print(f"Predicted Range: {predicted_range:.2f} km")
# =============================
# FuelWise Smart Recommendation
# =============================

print("\n===== FuelWise Smart Recommendation =====")

# User inputs
speed = float(input("Enter current speed (km/h): "))
fuel = float(input("Enter current fuel (litres): "))

print("\nSelect road type:")
print("1. Rural")
print("2. Highway")

road_choice = input("Enter choice (1-2): ")

if road_choice == "1":
    road = "Rural"
else:
    road = "Highway"

load = int(input("Enter load (1 = Rider only, 2 = Rider + Pillion/Luggage): "))

print("\nSelect your bike:")
print("1. Hero Splendor")
print("2. Honda Shine")
print("3. Bajaj Pulsar 150")
print("4. TVS Apache")

bike_choice = input("Enter choice (1-4): ")

if bike_choice == "1":
    bike = "Hero Splendor"
elif bike_choice == "2":
    bike = "Honda Shine"
elif bike_choice == "3":
    bike = "Bajaj Pulsar 150"
else:
    bike = "TVS Apache"


# Create input for AI model
new_ride = pd.DataFrame([{
    "Speed": speed,
    "Fuel": fuel,
    "Distance": 0,
    "Load": load,
    "Bike_Bajaj Pulsar 150": 1 if bike == "Bajaj Pulsar 150" else 0,
    "Bike_Hero Splendor": 1 if bike == "Hero Splendor" else 0,
    "Bike_Honda Shine": 1 if bike == "Honda Shine" else 0,
    "Bike_TVS Apache": 1 if bike == "TVS Apache" else 0,
    "Road_Highway": 1 if road == "Highway" else 0,
    "Road_Rural": 1 if road == "Rural" else 0
}])

# Match training columns
new_ride = new_ride.reindex(columns=X.columns, fill_value=0)

# AI prediction
predicted_mileage = model.predict(new_ride)[0]

# Calculate predicted range
predicted_range = fuel * predicted_mileage

print("\n===== AI Prediction =====")
print("Bike:", bike)
print("Speed:", speed, "km/h")
print("Road:", road)
print("Fuel:", fuel, "litres")

print(f"\n🤖 Predicted Mileage: {predicted_mileage:.2f} km/litre")
print(f"⛽ Predicted Range: {predicted_range:.2f} km")


# Fuel stations
stations = [10, 20, 30, 40, 50, 60, 75, 90]

reachable_stations = []

print("\n===== Fuel Station Analysis =====")

for i, station_distance in enumerate(stations, start=1):

    if station_distance <= predicted_range:
        print(
            f"Station {i}: {station_distance} km → "
            "🟢 Reachable"
        )

        reachable_stations.append(
            (i, station_distance)
        )

    else:
        print(
            f"Station {i}: {station_distance} km → "
            "🔴 Not Reachable"
        )


# Best station
if reachable_stations:

    best_station = min(
        reachable_stations,
        key=lambda x: x[1]
    )

    print("\n===== FuelWise Recommendation =====")
    print(
        f"🟢 Recommended Fuel Station: "
        f"Station {best_station[0]}"
    )

    print(
        f"📍 Distance: "
        f"{best_station[1]} km"
    )

    remaining_range = predicted_range - best_station[1]

    print(
        f"🛣️ Estimated range remaining after reaching station: "
        f"{remaining_range:.2f} km"
    )

else:

    print("\n===== FuelWise Recommendation =====")
    print("🔴 No listed fuel station is reachable.")
    print("⚠️ Please find a nearer fuel station.")