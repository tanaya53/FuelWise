print("===== FuelWise =====")

print("Select your bike:")
print("1. Hero Splendor")
print("2. Honda Shine")
print("3. Bajaj Pulsar 150")
print("4. TVS Apache")
print("5. Other")

choice = input("Enter your choice (1-5): ")

if choice == "1":
    bike = "Hero Splendor"
    mileage = 60
elif choice == "2":
    bike = "Honda Shine"
    mileage = 55
elif choice == "3":
    bike = "Bajaj Pulsar 150"
    mileage = 45
elif choice == "4":
    bike = "TVS Apache"
    mileage = 40
else:
    bike = "Other"
    mileage = float(input("Enter your bike mileage (km/litre): "))

print("\nSelected Bike:", bike)
print("Base Mileage:", mileage, "km/litre")

fuel = float(input("Enter current fuel (litres): "))
distance = float(input("Enter distance to next fuel station (km): "))

print("\n----- Speed Analysis -----")

speeds = [40, 50, 60, 70, 80]

for speed in speeds:

    if speed <= 50:
        efficiency_factor = 1.00
    elif speed <= 60:
        efficiency_factor = 0.95
    elif speed <= 70:
        efficiency_factor = 0.88
    else:
        efficiency_factor = 0.80

    estimated_mileage = mileage * efficiency_factor
    estimated_range = fuel * estimated_mileage

    print(
        f"{speed} km/h → "
        f"Estimated Mileage: {estimated_mileage:.2f} km/l → "
        f"Estimated Range: {estimated_range:.2f} km"
    )

print("\n----- FuelWise Analysis -----")

if distance <= fuel * mileage:
    print("🟢 The station is within your basic estimated range.")
else:
    print("🔴 The station may be too far with the current fuel.")

print("\n⚠️ Speed analysis is an estimate for project demonstration.")
import pandas as pd

data = pd.read_csv("fuelwise_data.csv")

print("\n===== FuelWise Dataset =====")
print(data)
print("\n===== FuelWise Data Analysis =====")

print("Total Records:", len(data))

print("\nAverage Speed:")
print(data["Speed"].mean())

print("\nAverage Mileage:")
print(data["Mileage"].mean())

print("\nMinimum Mileage:")
print(data["Mileage"].min())

print("\nMaximum Mileage:")
print(data["Mileage"].max())

print("\nAverage Mileage by Bike:")
print(data.groupby("Bike")["Mileage"].mean())