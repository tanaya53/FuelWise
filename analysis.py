import pandas as pd

# Load FuelWise dataset
data = pd.read_csv("fuelwise_data.csv")

print("===== FuelWise Data Analysis =====")

# Total records
print("\nTotal Records:", len(data))

# Basic information
print("\nDataset Information:")
print(data.info())

# Average speed
print("\nAverage Speed:", data["Speed"].mean())

# Average mileage
print("Average Mileage:", data["Mileage"].mean())

# Minimum mileage
print("Minimum Mileage:", data["Mileage"].min())

# Maximum mileage
print("Maximum Mileage:", data["Mileage"].max())

# Average mileage for each bike
print("\nAverage Mileage by Bike:")
print(data.groupby("Bike")["Mileage"].mean())
import matplotlib.pyplot as plt

plt.figure(figsize=(8, 5))

plt.scatter(data["Speed"], data["Mileage"])

plt.xlabel("Speed (km/h)")
plt.ylabel("Mileage (km/litre)")
plt.title("Speed vs Mileage")

plt.grid(True)

plt.show()