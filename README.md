<h1 align="center">⛽ FuelWise — Intelligent Fuel & Route Optimization Platform</h1>

<p align="center">
  A full-stack Python web application that combines machine learning, real-world route planning, fuel analytics, and personalized vehicle profiles to help riders estimate mileage, fuel requirements, travel range, and trip costs.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3776AB?style=flat-square&logo=python&logoColor=white" />
  <img src="https://img.shields.io/badge/Flask-000000?style=flat-square&logo=flask&logoColor=white" />
  <img src="https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white" />
  <img src="https://img.shields.io/badge/Scikit--learn-F7931E?style=flat-square&logo=scikit-learn&logoColor=white" />
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black" />
  <img src="https://img.shields.io/badge/Chart.js-FF6384?style=flat-square&logo=chart.js&logoColor=white" />
  <img src="https://img.shields.io/badge/Leaflet-199900?style=flat-square&logo=leaflet&logoColor=white" />
</p>

---

## 📸 Screenshots

<!-- Add 2-5 screenshots of your application here -->

<!-- Example:
![Dashboard](screenshots/dashboard.png)
![Route Planning](screenshots/route-planning.png)
![Analytics](screenshots/analytics.png)
![Garage](screenshots/garage.png)
-->

---

## ✨ Features

### 🤖 Machine Learning Fuel Prediction

- Predicts expected vehicle mileage based on trip conditions
- Considers factors such as speed, fuel input, road type, load type, and vehicle profile
- Estimates predicted travel range and fuel requirements
- Supports model retraining using actual ride data

### 🗺️ Real-World Route Planning

- Interactive global map using Leaflet.js
- Select starting and destination locations directly on the map
- Supports coordinate-based route calculation using OSRM
- Uses geocoding/reverse-geocoding to identify selected locations
- Calculates route distance and estimated duration

### 🏍️ Custom Vehicle Profiles

- Built-in vehicle profiles including:
  - Hero Splendor
  - Honda Shine
  - Bajaj Pulsar 150
  - TVS Apache
- Create custom bike profiles
- Store base mileage and fuel tank capacity
- Edit and delete custom profiles

### 📊 Interactive Analytics

- Fuel expense tracking
- Mileage trend analysis
- Speed vs. efficiency visualization
- Trip history analytics
- Interactive charts using Chart.js

### ⛽ Refueling Management

- Record fuel refueling transactions
- Track liters purchased
- Store fuel price per liter
- Automatically calculate total fuel cost
- Maintain odometer readings and notes

### 📝 Trip History

- Store analyzed trips locally
- Track route, distance, duration, speed, fuel input, and predicted mileage
- Review previous trips
- Maintain a complete ride history

### 🔄 Machine Learning Retraining

- Actual ride data can be added back to the training dataset
- Retrain the prediction model using newly collected data
- Enables the system to improve its predictions as more ride data becomes available

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Programming Language | Python |
| Backend | Flask |
| Database | SQLite |
| Machine Learning | Scikit-learn |
| Frontend | HTML, CSS, JavaScript |
| Maps | Leaflet.js |
| Routing | OSRM |
| Geocoding | Nominatim |
| Analytics | Chart.js |
| Icons | Font Awesome |
| UI | Glassmorphism / Responsive CSS |

---

## 🏗️ Application Architecture

```text
                         ┌──────────────────────┐
                         │      User / Rider    │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │   React-like SPA UI  │
                         │ HTML / CSS / JS       │
                         └──────────┬───────────┘
                                    │
                              REST API Calls
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │    Flask Backend     │
                         │       app.py         │
                         └──────┬───────┬───────┘
                                │       │
                   ┌────────────┘       └────────────┐
                   ▼                                 ▼
          ┌─────────────────┐              ┌─────────────────┐
          │ Machine Learning│              │ SQLite Database │
          │    Prediction   │              │     Storage     │
          └────────┬────────┘              └─────────────────┘
                   │
                   ▼
          ┌─────────────────┐
          │ Mileage / Range │
          │ Fuel Prediction │
          └─────────────────┘

External Services:
    ├── OSRM → Route calculation
    ├── Nominatim → Geocoding
    └── Leaflet → Interactive maps
