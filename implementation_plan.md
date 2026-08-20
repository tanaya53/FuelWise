# Implementation Plan - Complete FuelWise Web Application

This plan details the transition of the FuelWise CLI / basic web prototype into a highly polished, responsive Single Page Application (SPA) with local data storage (`sqlite3`), real-world map-based route planning, interactive analytics, and machine learning retraining.

## User Review Required

> [!IMPORTANT]
> The app will transition from a simple form-submit template to a modern Single Page Application (SPA) powered by a Flask JSON API on the backend and dynamic JavaScript on the frontend. This allows us to implement rich features (like interactive maps, graphing, and local logging) without annoying full-page refreshes.
>
> **Key Enhancements**:
> - **SQLite Database (`fuelwise.db`)**: Real local storage for trip history, custom bike profiles, and refueling logs.
> - **Global Map-Based Routing**: Instead of being locked into Palghar, Nashik, Mumbai, etc., users can search or click anywhere on the world map to drop pin points for the routing calculation.
> - **Interactive Dashboard**: Features interactive analytics charts (using Chart.js) tracking fuel costs, mileage trends, and mileage vs speed scatter plots.

---

## Proposed Changes

We will restructure the project to follow clean web development practices:
- **`app.py`** will act as a RESTful Flask API server and serve static files.
- **`database.py`** will handle SQLite local database creation and queries.
- **`templates/index.html`** will hold the SPA structure with modern Google Fonts, Leaflet.js, and Chart.js.
- **`static/css/style.css`** will implement a high-fidelity glassmorphism design with a dark mode option.
- **`static/js/main.js`** will handle routing, map interaction, geocoding, API calls, and chart generation.

---

### Backend API & Database

#### [NEW] [database.py](file:///c:/Users/ved/OneDrive/Desktop/Tanaya/PDS/FuelWise%20-%20Copy/database.py)
- Create SQLite tables for:
  - `bikes` (id, name, base_mileage, tank_capacity)
  - `trips` (id, timestamp, start_location, end_location, start_lat, start_lon, end_lat, end_lon, bike_name, speed, fuel_input, road_type, load_type, predicted_mileage, predicted_range, distance_km, duration_hours, status, fuel_needed)
  - `refuel_logs` (id, date, liters, price_per_liter, cost, odometer, notes)
- Prepopulate `bikes` table with initial models: Hero Splendor, Honda Shine, Bajaj Pulsar 150, TVS Apache.

#### [MODIFY] [app.py](file:///c:/Users/ved/OneDrive/Desktop/Tanaya/PDS/FuelWise%20-%20Copy/app.py)
- Refactor routing from full-page returns to RESTful endpoints:
  - `GET /`: Serves the HTML dashboard.
  - `POST /api/predict`: Integrates machine learning predictions with custom bike options.
  - `POST /api/route`: Contacts OSRM using coordinates rather than pre-defined text locations.
  - `GET/POST/DELETE /api/bikes`: Standard endpoints to customize bike profiles.
  - `GET/POST/DELETE /api/trips`: Track ride histories.
  - `GET/POST/DELETE /api/refuels`: Record fuel expenses and odometer logs.
  - `POST /api/retrain`: Appends actual ride data back to the training dataset and retrains the model.

---

### Frontend SPA Interface

#### [NEW] [templates/index.html](file:///c:/Users/ved/OneDrive/Desktop/Tanaya/PDS/FuelWise%20-%20Copy/templates/index.html)
- Create index page layout containing the main side navigation and glassmorphic dashboards.
- Embed FontAwesome icons, Google Fonts (Inter, Outfit), Leaflet maps, and Chart.js dashboards.

#### [NEW] [static/css/style.css](file:///c:/Users/ved/OneDrive/Desktop/Tanaya/PDS/FuelWise%20-%20Copy/static/css/style.css)
- Implement UI Design:
  - Dark mode by default, utilizing rich blue-greys, cyan accents, and glowing borders.
  - Glassmorphic card styling (`backdrop-filter`, thin borders, translucent backgrounds).
  - High-impact visual feedback (pulsing AI status, color-coded fuel gauge gauges, and smooth transit animations).

#### [NEW] [static/js/main.js](file:///c:/Users/ved/OneDrive/Desktop/Tanaya/PDS/FuelWise%20-%20Copy/static/js/main.js)
- Build the frontend logic:
  - **Dynamic Tab Switching**: Smooth animations between Dashboard/Analyze, Garage, Refueling Logs, and History tabs.
  - **Click-to-Pin Route Selection**: Add start and destination markers by clicking on the map. Use free Nominatim API to reverse-geocode addresses.
  - **Chart Rendering**: Initialize Chart.js diagrams for fuel expenses, mileage averages, and speed versus efficiency.
  - **Form Validation & AJAX Submissions**: Submit variables seamlessly without reloading the main frame.

---

## Verification Plan

### Automated Tests
- Test API routes using python test requests.
- Verify machine learning model coefficients remain stable when retraining.

### Manual Verification
1. Launch `python app.py` and access the dashboard.
2. Toggle between Dark and Light mode.
3. Test map route selection:
   - Click "Start Pin" button, click a point on the map. Verify Nominatim auto-fills address.
   - Click "Destination Pin" button, click another point. Verify Nominatim auto-fills destination.
4. Input speed, fuel volume, and select a bike, then click "Analyze". Check route polyline and predicted ranges.
5. Create a new bike in "My Garage" and check if it instantly appears in the analyzer dropdown.
6. Submit a refuel log and check if the analytics graph updates instantly.
7. Verify all entries persist upon refreshing the application.
