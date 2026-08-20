/* ==========================================================================
   FUELWISE JAVASCRIPT: CLIENT-SIDE CONTROLLER & PERSISTENCE ENGINE
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
    // ----------------------------------------------------------------------
    // 1. STATE VARIABLES
    // ----------------------------------------------------------------------
    let currentTheme = localStorage.getItem("theme") || "dark";
    let map = null;
    let startMarker = null;
    let endMarker = null;
    let routePolyline = null;
    
    let startCoords = null; // { lat, lon }
    let endCoords = null;   // { lat, lon }
    
    let isPinningStart = false;
    let isPinningEnd = false;
    
    // Chart instances
    let expenseChart = null;
    let mileageChart = null;
    let dispersionChart = null;

    // ----------------------------------------------------------------------
    // 2. TOAST SYSTEM
    // ----------------------------------------------------------------------
    function showToast(message, type = "success") {
        const container = document.getElementById("toast-container");
        const toast = document.createElement("div");
        toast.className = `toast ${type}`;
        
        let icon = "fa-circle-check";
        if (type === "error") icon = "fa-circle-xmark";
        else if (type === "info") icon = "fa-circle-info";
        
        toast.innerHTML = `
            <i class="fa-solid ${icon}"></i>
            <span>${message}</span>
        `;
        container.appendChild(toast);
        
        // Auto remove toast
        setTimeout(() => {
            toast.remove();
        }, 5000);
    }

    // ----------------------------------------------------------------------
    // 3. THEME TOGGLER
    // ----------------------------------------------------------------------
    const themeBtn = document.getElementById("theme-toggle");
    
    function applyTheme(theme) {
        document.documentElement.setAttribute("data-theme", theme);
        localStorage.setItem("theme", theme);
        currentTheme = theme;
        
        // Update button icon
        const icon = themeBtn.querySelector("i");
        if (theme === "light") {
            icon.className = "fa-solid fa-sun";
        } else {
            icon.className = "fa-solid fa-moon";
        }
        
        // Reload map tile theme if map initialized
        if (map) {
            updateMapTiles();
        }
    }
    
    applyTheme(currentTheme);
    themeBtn.addEventListener("click", () => {
        applyTheme(currentTheme === "dark" ? "light" : "dark");
    });

    // ----------------------------------------------------------------------
    // 4. TAB CONTROLLER
    // ----------------------------------------------------------------------
    const navButtons = document.querySelectorAll(".nav-btn");
    const tabContents = document.querySelectorAll(".tab-content");
    const tabTitleEl = document.getElementById("tab-title");
    const tabDescEl = document.getElementById("tab-desc");
    
    const tabMetadata = {
        "tab-analyze": {
            title: "Analyze Ride",
            desc: "Input ride conditions to compute predicted mileage and range with smart maps."
        },
        "tab-garage": {
            title: "My Garage",
            desc: "Manage and customize your stable of motorcycles for range estimations."
        },
        "tab-logs": {
            title: "Refueling Log",
            desc: "Track petrol expenses, cost changes, and odometer mileage values."
        },
        "tab-history": {
            title: "Trip History",
            desc: "View log summaries of all previously computed rides."
        },
        "tab-analytics": {
            title: "Analytics Dashboard",
            desc: "Visualize trends in fuel costs, mileage efficiencies, and model dispersion."
        }
    };
    
    function switchTab(tabId) {
        navButtons.forEach(btn => {
            if (btn.getAttribute("data-tab") === tabId) {
                btn.classList.add("active");
            } else {
                btn.classList.remove("active");
            }
        });
        
        tabContents.forEach(tab => {
            if (tab.id === tabId) {
                tab.classList.add("active");
            } else {
                tab.classList.remove("active");
            }
        });
        
        // Update header texts
        const meta = tabMetadata[tabId];
        if (meta) {
            tabTitleEl.innerText = meta.title;
            tabDescEl.innerText = meta.desc;
        }
        
        // Load data specific to tabs
        if (tabId === "tab-analyze") {
            loadBikesSelector();
            setTimeout(() => { if (map) map.invalidateSize(); }, 200);
        } else if (tabId === "tab-garage") {
            loadBikesTable();
        } else if (tabId === "tab-logs") {
            loadRefuelsTable();
        } else if (tabId === "tab-history") {
            loadHistoryTable();
        } else if (tabId === "tab-analytics") {
            renderAnalyticsCharts();
        }
    }
    
    navButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            switchTab(btn.getAttribute("data-tab"));
        });
    });

    // ----------------------------------------------------------------------
    // 5. SLIDERS DATA BINDING
    // ----------------------------------------------------------------------
    const fuelInput = document.getElementById("fuel-input");
    const fuelVal = document.getElementById("fuel-val");
    fuelInput.addEventListener("input", () => fuelVal.innerText = fuelInput.value);
    
    const speedInput = document.getElementById("speed-input");
    const speedVal = document.getElementById("speed-val");
    speedInput.addEventListener("input", () => speedVal.innerText = speedInput.value);

    // ----------------------------------------------------------------------
    // 6. MAP INTEGRATION & PINNING
    // ----------------------------------------------------------------------
    const btnPinStart = document.getElementById("btn-pin-start");
    const btnPinEnd = document.getElementById("btn-pin-end");
    const coordsStatus = document.getElementById("coords-status");
    
    let tileLayerInstance = null;
    
    function initMap() {
        // Default center near Mumbai/Palghar region
        map = L.map("route-map", {
            center: [19.35, 73.0],
            zoom: 8,
            zoomControl: true
        });
        
        updateMapTiles();
        
        // Handle Map Clicks for Pinning
        map.on("click", (e) => {
            const { lat, lng } = e.latlng;
            
            if (isPinningStart) {
                setStartPin(lat, lng, true);
                stopPinningMode();
            } else if (isPinningEnd) {
                setEndPin(lat, lng, true);
                stopPinningMode();
            }
        });
    }
    
    function updateMapTiles() {
        if (!map) return;
        
        if (tileLayerInstance) {
            map.removeLayer(tileLayerInstance);
        }
        
        let tileUrl = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
        let attribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
        
        if (currentTheme === "dark") {
            // Sleek CartoDB Dark Matter tiles
            tileUrl = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
            attribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';
        }
        
        tileLayerInstance = L.tileLayer(tileUrl, { attribution }).addTo(map);
    }
    
    async function reverseGeocode(lat, lon) {
        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`);
            const data = await response.json();
            if (data && data.display_name) {
                // Shorten display name (take first few parts)
                const parts = data.display_name.split(",");
                return parts.slice(0, 3).join(", ").trim();
            }
        } catch (e) {
            console.error("Reverse geocoding failed", e);
        }
        return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    }
    
    async function setStartPin(lat, lon, fetchAddress = false) {
        startCoords = { lat, lon };
        if (startMarker) map.removeLayer(startMarker);
        
        startMarker = L.marker([lat, lon], {
            draggable: true
        }).addTo(map).bindPopup("📍 Start Point").openPopup();
        
        // Listen to drag events
        startMarker.on("dragend", async (event) => {
            const position = event.target.getLatLng();
            startCoords = { lat: position.lat, lon: position.lng };
            const address = await reverseGeocode(position.lat, position.lng);
            document.getElementById("start-location").value = address;
            updateCoordsBadge();
        });

        if (fetchAddress) {
            document.getElementById("start-location").value = "Fetching location...";
            const address = await reverseGeocode(lat, lon);
            document.getElementById("start-location").value = address;
        }
        updateCoordsBadge();
    }
    
    async function setEndPin(lat, lon, fetchAddress = false) {
        endCoords = { lat, lon };
        if (endMarker) map.removeLayer(endMarker);
        
        endMarker = L.marker([lat, lon], {
            draggable: true
        }).addTo(map).bindPopup("🎯 Destination").openPopup();
        
        // Listen to drag events
        endMarker.on("dragend", async (event) => {
            const position = event.target.getLatLng();
            endCoords = { lat: position.lat, lon: position.lng };
            const address = await reverseGeocode(position.lat, position.lng);
            document.getElementById("end-location").value = address;
            updateCoordsBadge();
        });

        if (fetchAddress) {
            document.getElementById("end-location").value = "Fetching location...";
            const address = await reverseGeocode(lat, lon);
            document.getElementById("end-location").value = address;
        }
        updateCoordsBadge();
    }
    
    function updateCoordsBadge() {
        if (startCoords && endCoords) {
            coordsStatus.className = "badge badge-success";
            coordsStatus.innerText = "Pins ready: Route is drawable";
        } else if (startCoords || endCoords) {
            coordsStatus.className = "badge badge-info";
            coordsStatus.innerText = "One pin set. Drop the other!";
        } else {
            coordsStatus.className = "badge badge-info";
            coordsStatus.innerText = "Map pins ready";
        }
    }
    
    function stopPinningMode() {
        isPinningStart = false;
        isPinningEnd = false;
        btnPinStart.classList.remove("pinning-active");
        btnPinEnd.classList.remove("pinning-active");
        document.getElementById("route-map").style.cursor = "";
    }
    
    btnPinStart.addEventListener("click", () => {
        isPinningStart = true;
        isPinningEnd = false;
        btnPinStart.classList.add("pinning-active");
        btnPinEnd.classList.remove("pinning-active");
        document.getElementById("route-map").style.cursor = "crosshair";
        showToast("Click on the map to pin your START location", "info");
    });
    
    btnPinEnd.addEventListener("click", () => {
        isPinningEnd = true;
        isPinningStart = false;
        btnPinEnd.classList.add("pinning-active");
        btnPinStart.classList.remove("pinning-active");
        document.getElementById("route-map").style.cursor = "crosshair";
        showToast("Click on the map to pin your DESTINATION", "info");
    });
    
    // Direct Nominatim geocoder helper for manual typing
    async function searchGeocode(query) {
        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
            const data = await response.json();
            if (data && data.length > 0) {
                return {
                    lat: parseFloat(data[0].lat),
                    lon: parseFloat(data[0].lon)
                };
            }
        } catch (e) {
            console.error("Geocoding query error", e);
        }
        return null;
    }

    // ----------------------------------------------------------------------
    // 7. REST ENDPOINT API HANDLERS
    // ----------------------------------------------------------------------

    // A. Load bikes list into selectors (forms)
    async function loadBikesSelector() {
        try {
            const response = await fetch("/api/bikes");
            const bikes = await response.json();
            
            const bikeSelect = document.getElementById("bike-select");
            const modalBike = document.getElementById("modal-bike");
            
            // Retain placeholder
            bikeSelect.innerHTML = '<option value="">Select bike...</option>';
            modalBike.innerHTML = '<option value="">Select bike...</option>';
            
            bikes.forEach(bike => {
                const opt1 = `<option value="${bike.name}">${bike.name} (${bike.base_mileage} km/L)</option>`;
                const opt2 = `<option value="${bike.name}">${bike.name}</option>`;
                bikeSelect.innerHTML += opt1;
                modalBike.innerHTML += opt2;
            });
        } catch (e) {
            showToast("Failed to load motorcycles data", "error");
        }
    }

    // B. Load Garage list table
    async function loadBikesTable() {
        try {
            const response = await fetch("/api/bikes");
            const bikes = await response.json();
            const tbody = document.querySelector("#bikes-table tbody");
            tbody.innerHTML = "";
            
            bikes.forEach(bike => {
                const tr = document.createElement("tr");
                const isDefault = ["Hero Splendor", "Honda Shine", "Bajaj Pulsar 150", "TVS Apache"].includes(bike.name);
                
                tr.innerHTML = `
                    <td><b>${bike.name}</b></td>
                    <td>${bike.base_mileage} km/L</td>
                    <td>${bike.tank_capacity} L</td>
                    <td class="actions-col">
                        ${isDefault ? '<span class="badge badge-info">Default</span>' : 
                        `<button class="btn-danger-icon btn-delete-bike" data-id="${bike.id}"><i class="fa-solid fa-trash"></i></button>`}
                    </td>
                `;
                tbody.appendChild(tr);
            });
            
            // Delete bike handler
            document.querySelectorAll(".btn-delete-bike").forEach(btn => {
                btn.addEventListener("click", async () => {
                    const id = btn.getAttribute("data-id");
                    if (confirm("Are you sure you want to delete this custom bike?")) {
                        const res = await fetch(`/api/bikes/${id}`, { method: "DELETE" });
                        const result = await res.json();
                        if (result.success) {
                            showToast(result.message);
                            loadBikesTable();
                        } else {
                            showToast(result.message, "error");
                        }
                    }
                });
            });
        } catch (e) {
            showToast("Error reading garage list", "error");
        }
    }

    // C. Add custom bike to garage
    document.getElementById("add-bike-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = document.getElementById("new-bike-name").value.trim();
        const base_mileage = parseFloat(document.getElementById("new-bike-mileage").value);
        const tank_capacity = parseFloat(document.getElementById("new-bike-tank").value);
        
        try {
            const res = await fetch("/api/bikes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, base_mileage, tank_capacity })
            });
            const result = await res.json();
            if (result.success) {
                showToast(result.message);
                document.getElementById("add-bike-form").reset();
                loadBikesTable();
            } else {
                showToast(result.message, "error");
            }
        } catch (err) {
            showToast("Failed to create custom motorcycle profile", "error");
        }
    });

    // D. Load refuel entries table
    async function loadRefuelsTable() {
        try {
            const response = await fetch("/api/refuels");
            const refuels = await response.json();
            const tbody = document.querySelector("#refuels-table tbody");
            tbody.innerHTML = "";
            
            if (refuels.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No refueling records saved yet.</td></tr>';
                return;
            }
            
            refuels.forEach(ref => {
                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td>${ref.date}</td>
                    <td>${ref.liters.toFixed(2)} L</td>
                    <td><b>₹${ref.cost.toFixed(2)}</b> <small>(${ref.price_per_liter.toFixed(2)}/L)</small></td>
                    <td>${ref.odometer} km</td>
                    <td class="actions-col">
                        <button class="btn-danger-icon btn-delete-refuel" data-id="${ref.id}"><i class="fa-solid fa-trash"></i></button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
            
            // Delete refuel handler
            document.querySelectorAll(".btn-delete-refuel").forEach(btn => {
                btn.addEventListener("click", async () => {
                    const id = btn.getAttribute("data-id");
                    if (confirm("Delete this refueling receipt?")) {
                        const res = await fetch(`/api/refuels/${id}`, { method: "DELETE" });
                        const result = await res.json();
                        if (result.success) {
                            showToast(result.message);
                            loadRefuelsTable();
                        }
                    }
                });
            });
        } catch (e) {
            showToast("Failed to fetch refuels", "error");
        }
    }

    // E. Add Refuel record
    document.getElementById("refuel-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const date = document.getElementById("refuel-date").value;
        const liters = parseFloat(document.getElementById("refuel-liters").value);
        const price_per_liter = parseFloat(document.getElementById("refuel-price").value);
        const odometer = parseFloat(document.getElementById("refuel-odometer").value);
        const notes = document.getElementById("refuel-notes").value;
        
        try {
            const res = await fetch("/api/refuels", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ date, liters, price_per_liter, odometer, notes })
            });
            const result = await res.json();
            if (result.success) {
                showToast(result.message);
                document.getElementById("refuel-form").reset();
                loadRefuelsTable();
            } else {
                showToast(result.message, "error");
            }
        } catch (err) {
            showToast("Failed to save fuel purchase", "error");
        }
    });

    // F. Load Trip History table
    async function loadHistoryTable() {
        try {
            const response = await fetch("/api/trips");
            const trips = await response.json();
            const tbody = document.querySelector("#history-table tbody");
            tbody.innerHTML = "";
            
            if (trips.length === 0) {
                tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--text-muted);">No computed trips saved. Try analyzing a ride!</td></tr>';
                return;
            }
            
            trips.forEach(trip => {
                const tr = document.createElement("tr");
                const timestampStr = new Date(trip.timestamp).toLocaleDateString(undefined, {month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'});
                const statusClass = trip.status.includes("Sufficient") ? "badge-success" : "badge-danger";
                
                tr.innerHTML = `
                    <td><small>${timestampStr}</small></td>
                    <td><span class="route-span">📍 ${trip.start_location} → 🎯 ${trip.end_location}</span><br><small>(${trip.distance_km.toFixed(1)} km | ${trip.duration_hours.toFixed(1)} hrs)</small></td>
                    <td><b>${trip.bike_name}</b></td>
                    <td>${trip.speed} km/h</td>
                    <td>${trip.road_type} (${trip.load_type})</td>
                    <td>${trip.fuel_needed.toFixed(2)} L</td>
                    <td>${trip.predicted_range.toFixed(1)} km <br><small>(${trip.predicted_mileage.toFixed(1)} km/L)</small></td>
                    <td><span class="badge ${statusClass}">${trip.status}</span></td>
                    <td class="actions-col">
                        <button class="btn-danger-icon btn-delete-trip" data-id="${trip.id}"><i class="fa-solid fa-trash"></i></button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
            
            // Delete trip history
            document.querySelectorAll(".btn-delete-trip").forEach(btn => {
                btn.addEventListener("click", async () => {
                    const id = btn.getAttribute("data-id");
                    if (confirm("Delete this trip from history?")) {
                        const res = await fetch(`/api/trips/${id}`, { method: "DELETE" });
                        const result = await res.json();
                        if (result.success) {
                            showToast(result.message);
                            loadHistoryTable();
                        }
                    }
                });
            });
        } catch (e) {
            showToast("Failed to load historical trip registers", "error");
        }
    }

    // ----------------------------------------------------------------------
    // 8. RIDE ANALYZER COMPUTE
    // ----------------------------------------------------------------------
    const analyzeForm = document.getElementById("analyze-form");
    const btnSubmitAnalyze = document.getElementById("btn-submit-analyze");
    const resultCard = document.getElementById("analysis-results-card");
    
    analyzeForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        btnSubmitAnalyze.classList.add("loading");
        
        let startName = document.getElementById("start-location").value.trim();
        let endName = document.getElementById("end-location").value.trim();
        
        const bike_name = document.getElementById("bike-select").value;
        const road = document.getElementById("road-select").value;
        const load = document.getElementById("load-select").value;
        const fuel = parseFloat(fuelInput.value);
        const speed = parseFloat(speedInput.value);
        const fallback_distance = parseFloat(document.getElementById("fallback-distance").value || 15);
        
        // 1. Geocode locations if typing was done without pinning
        if (!startCoords && startName) {
            showToast("Geocoding start point...", "info");
            const coords = await searchGeocode(startName);
            if (coords) {
                await setStartPin(coords.lat, coords.lon, false);
            }
        }
        
        if (!endCoords && endName) {
            showToast("Geocoding destination...", "info");
            const coords = await searchGeocode(endName);
            if (coords) {
                await setEndPin(coords.lat, coords.lon, false);
            }
        }
        
        // 2. Build JSON Request
        const payload = {
            bike_name,
            fuel,
            speed,
            road,
            load,
            fallback_distance,
            start_location: startName,
            end_location: endName,
            start_lat: startCoords ? startCoords.lat : null,
            start_lon: startCoords ? startCoords.lon : null,
            end_lat: endCoords ? endCoords.lat : null,
            end_lon: endCoords ? endCoords.lon : null
        };
        
        try {
            const res = await fetch("/api/predict", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const result = await res.json();
            
            if (result.success) {
                showToast("Calculated ride metrics using AI!");
                
                // Show result panel
                resultCard.classList.remove("hidden");
                
                // Update elements
                document.getElementById("res-mileage").innerText = `${result.predicted_mileage.toFixed(1)} km/L`;
                document.getElementById("res-range").innerText = `${result.predicted_range.toFixed(1)} km`;
                document.getElementById("res-distance").innerText = `${result.distance_km.toFixed(1)} km`;
                document.getElementById("res-time").innerText = `${result.duration_hours.toFixed(1)} hrs`;
                document.getElementById("res-fuel-needed").innerText = `Fuel Needed: ${result.fuel_needed.toFixed(2)} L`;
                
                // Set badges & progress bars
                const statusBadge = document.getElementById("res-status-label");
                const progressFill = document.getElementById("fuel-progress-fill");
                
                if (result.sufficient) {
                    statusBadge.innerText = "🟢 Sufficient Fuel";
                    statusBadge.className = "status-badge green";
                    progressFill.className = "progress-fill green";
                    
                    const pct = Math.min((result.distance_km / result.predicted_range) * 100, 100);
                    progressFill.style.width = `${pct}%`;
                    
                    const remaining = fuel - result.fuel_needed;
                    document.getElementById("res-recommendation").innerHTML = `
                        <b>Ride status: OK.</b> You will easily reach your destination with approx. <b>${remaining.toFixed(2)} Litres</b> left in the tank. Cruise safely!
                    `;
                } else {
                    statusBadge.innerText = "🔴 Refuel Required";
                    statusBadge.className = "status-badge red";
                    progressFill.className = "progress-fill red";
                    progressFill.style.width = "100%";
                    
                    const deficit = result.fuel_needed - fuel;
                    document.getElementById("res-recommendation").innerHTML = `
                        <b>Warning: Insufficient fuel.</b> You will run dry approx <b>${(result.distance_km - result.predicted_range).toFixed(1)} km</b> before arrival. You need to add at least <b>${deficit.toFixed(2)} Litres</b>.
                    `;
                }
                
                // Draw route line on Leaflet map if coords are present
                if (routePolyline) map.removeLayer(routePolyline);
                
                if (result.geometry && result.geometry.length > 0) {
                    // Leaflet expects [lat, lon], OSRM gives [lon, lat]
                    const pathCoords = result.geometry.map(point => [point[1], point[0]]);
                    routePolyline = L.polyline(pathCoords, {
                        color: result.sufficient ? "#00f0ff" : "#ef4444",
                        weight: 6,
                        opacity: 0.8
                    }).addTo(map);
                    
                    map.fitBounds(routePolyline.getBounds(), { padding: [30, 30] });
                } else {
                    // If no road geometry, draw straight dotted line between start and end pins if exists
                    if (startCoords && endCoords) {
                        routePolyline = L.polyline([[startCoords.lat, startCoords.lon], [endCoords.lat, endCoords.lon]], {
                            color: "#ffc107",
                            weight: 4,
                            dashArray: "10, 10"
                        }).addTo(map);
                        map.fitBounds(routePolyline.getBounds(), { padding: [30, 30] });
                    }
                }
                
                // Smooth scroll to results
                resultCard.scrollIntoView({ behavior: "smooth" });
            } else {
                showToast("Server refused prediction calculation", "error");
            }
        } catch (err) {
            console.error(err);
            showToast("Error processing route calculator", "error");
        } finally {
            btnSubmitAnalyze.classList.remove("loading");
        }
    });

    // ----------------------------------------------------------------------
    // 9. RETRAINING & INJECT REAL DATA MODAL
    // ----------------------------------------------------------------------
    const btnOpenModal = document.getElementById("btn-report-ride-modal");
    const btnCloseModal = document.getElementById("btn-close-modal");
    const rideModal = document.getElementById("ride-modal");
    const retrainForm = document.getElementById("retrain-form");
    const btnSyncModel = document.getElementById("btn-sync-model");
    
    function openModal() {
        loadBikesSelector();
        rideModal.classList.remove("hidden");
    }
    
    function closeModal() {
        rideModal.classList.add("hidden");
        retrainForm.reset();
    }
    
    btnOpenModal.addEventListener("click", openModal);
    btnCloseModal.addEventListener("click", closeModal);
    
    // Close on background click
    rideModal.addEventListener("click", (e) => {
        if (e.target === rideModal) closeModal();
    });
    
    retrainForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const bike = document.getElementById("modal-bike").value;
        const road = document.getElementById("modal-road").value;
        const load = parseInt(document.getElementById("modal-load").value);
        const speed = parseFloat(document.getElementById("modal-speed").value);
        const fuel = parseFloat(document.getElementById("modal-fuel").value);
        const distance = parseFloat(document.getElementById("modal-distance").value);
        const mileage = parseFloat(document.getElementById("modal-mileage").value);
        
        try {
            const res = await fetch("/api/retrain", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ bike, road, load, speed, fuel, distance, mileage })
            });
            const result = await res.json();
            if (result.success) {
                showToast(result.message);
                closeModal();
                // If on analytics page, redraw charts
                if (document.getElementById("tab-analytics").classList.contains("active")) {
                    renderAnalyticsCharts();
                }
            } else {
                showToast(result.message, "error");
            }
        } catch (err) {
            showToast("Failed to retrain model", "error");
        }
    });

    btnSyncModel.addEventListener("click", async () => {
        btnSyncModel.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin"></i> Syncing Engine...';
        try {
            // Simply call retrain with empty object to force train
            const res = await fetch("/api/retrain", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ bike: "Hero Splendor", mileage: 60.0, force_only: true })
            });
            const result = await res.json();
            showToast("AI Model weight parameters retrained!");
        } catch (e) {
            showToast("Failed to refresh weights", "error");
        } finally {
            btnSyncModel.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Retrain Model';
        }
    });

    // ----------------------------------------------------------------------
    // 10. CHART.JS ANALYTICS DASHBOARD RENDERING
    // ----------------------------------------------------------------------
    async function renderAnalyticsCharts() {
        try {
            const res = await fetch("/api/stats");
            const data = await res.json();
            if (!data.success) return;
            
            const isDark = document.documentElement.getAttribute("data-theme") === "dark";
            const textThemeColor = isDark ? "#94a3b8" : "#475569";
            const borderGridColor = isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.06)";
            
            // A. Refuel Expenses Chart
            if (expenseChart) expenseChart.destroy();
            const ctx1 = document.getElementById("chart-expenses").getContext("2d");
            expenseChart = new Chart(ctx1, {
                type: "line",
                data: {
                    labels: data.refuel_dates,
                    datasets: [{
                        label: "Refuel Cost (₹)",
                        data: data.refuel_costs,
                        borderColor: "#a855f7",
                        backgroundColor: "rgba(168, 85, 247, 0.1)",
                        borderWidth: 3,
                        fill: true,
                        tension: 0.3
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { labels: { color: textThemeColor } }
                    },
                    scales: {
                        x: { grid: { color: borderGridColor }, ticks: { color: textThemeColor } },
                        y: { grid: { color: borderGridColor }, ticks: { color: textThemeColor } }
                    }
                }
            });
            
            // B. Average Bike Mileage
            if (mileageChart) mileageChart.destroy();
            const ctx2 = document.getElementById("chart-mileages").getContext("2d");
            
            const labels2 = Object.keys(data.bike_mileages);
            const values2 = Object.values(data.bike_mileages);
            
            mileageChart = new Chart(ctx2, {
                type: "bar",
                data: {
                    labels: labels2,
                    datasets: [{
                        label: "Avg Mileage (km/L)",
                        data: values2,
                        backgroundColor: [
                            "rgba(0, 240, 255, 0.6)",
                            "rgba(168, 85, 247, 0.6)",
                            "rgba(16, 185, 129, 0.6)",
                            "rgba(245, 158, 11, 0.6)"
                        ],
                        borderColor: [
                            "#00f0ff",
                            "#a855f7",
                            "#10b981",
                            "#f59e0b"
                        ],
                        borderWidth: 1.5,
                        borderRadius: 8
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false }
                    },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: textThemeColor } },
                        y: { grid: { color: borderGridColor }, ticks: { color: textThemeColor } }
                    }
                }
            });
            
            // C. Scatter Plot Dispersion
            if (dispersionChart) dispersionChart.destroy();
            const ctx3 = document.getElementById("chart-dispersion").getContext("2d");
            
            // Group scatter points by bike to color them nicely
            const bikeGroups = {};
            data.scatter.forEach(point => {
                if (!bikeGroups[point.bike]) {
                    bikeGroups[point.bike] = [];
                }
                bikeGroups[point.bike].push({ x: point.x, y: point.y });
            });
            
            const datasets3 = Object.keys(bikeGroups).map((bike, idx) => {
                const colors = ["#00f0ff", "#a855f7", "#10b981", "#f59e0b", "#ef4444"];
                const color = colors[idx % colors.length];
                return {
                    label: bike,
                    data: bikeGroups[bike],
                    backgroundColor: color,
                    pointRadius: 6,
                    pointHoverRadius: 8
                };
            });
            
            dispersionChart = new Chart(ctx3, {
                type: "scatter",
                data: { datasets: datasets3 },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { labels: { color: textThemeColor } },
                        tooltip: {
                            callbacks: {
                                label: (context) => {
                                    return `${context.dataset.label}: Speed ${context.raw.x} km/h, Mileage ${context.raw.y} km/l`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            title: { display: true, text: "Speed (km/h)", color: textThemeColor },
                            grid: { color: borderGridColor },
                            ticks: { color: textThemeColor }
                        },
                        y: {
                            title: { display: true, text: "Mileage (km/L)", color: textThemeColor },
                            grid: { color: borderGridColor },
                            ticks: { color: textThemeColor }
                        }
                    }
                }
            });
            
        } catch (e) {
            console.error("Charts loading error", e);
        }
    }

    // ----------------------------------------------------------------------
    // 11. INITIALIZATION ON READY
    // ----------------------------------------------------------------------
    initMap();
    loadBikesSelector();
});
