"use strict";

document.addEventListener("DOMContentLoaded", () => {
    // =========================================================================
    // 1. STATE & CONSTANTS
    // =========================================================================
    let currentTheme = localStorage.getItem("fuelwise_theme") || "dark";
    let map = null;
    let tileLayer = null;
    let startMarker = null;
    let endMarker = null;
    let bestStationMarker = null;
    let stationMarkers = [];

    let routePolylineDirect = null;
    let routePolylineLeg1 = null;
    let routePolylineLeg2 = null;

    let startCoords = null; // { lat, lon }
    let endCoords = null;   // { lat, lon }
    let pinMode = null;     // 'start', 'end', or null

    let bikesList = [];
    let currentReachableStations = [];
    let currentSelectedStation = null;
    const chartInstances = {};

    // Current user & authentication state (starts in a logged-out state on startup/refresh)
    let currentUser = null;

    // Geolocation state
    let userGpsCoords = null;
    let gpsMarker = null;
    let gpsCircle = null;

    // Group Ride state
    let groupMap = null;
    let groupTileLayer = null;
    let activeRideCode = "CONVOY-5";
    let groupRiders = [];
    let groupMarkers = {};
    let isSimulating = false;
    let groupPollInterval = null;
    let groupSimInterval = null;

    const DEFAULT_CENTER = [19.0760, 72.8777]; // Mumbai default center

    // =========================================================================
    // 2. DOM HELPERS
    // =========================================================================
    const $ = (id) => document.getElementById(id);

    // Apply saved theme
    document.documentElement.setAttribute("data-theme", currentTheme);
    updateThemeToggleIcon();

    // =========================================================================
    // 3. TOAST NOTIFICATION SYSTEM
    // =========================================================================
    function showToast(message, type = "info") {
        const container = $("toast-container");
        if (!container) return;

        const toast = document.createElement("div");
        toast.className = `toast ${type}`;

        let iconClass = "fa-circle-info";
        if (type === "success") iconClass = "fa-circle-check";
        if (type === "error") iconClass = "fa-circle-exclamation";
        if (type === "warning") iconClass = "fa-triangle-exclamation";

        toast.innerHTML = `
            <i class="fa-solid ${iconClass}"></i>
            <span>${message}</span>
        `;

        container.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = "fadeOut 0.4s ease forwards";
            setTimeout(() => {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 400);
        }, 3500);
    }
    window.showToast = showToast;

    // =========================================================================
    // 4. THEME TOGGLE
    // =========================================================================
    function updateThemeToggleIcon() {
        const btn = $("theme-toggle");
        if (!btn) return;
        const icon = btn.querySelector("i");
        if (!icon) return;
        if (currentTheme === "dark") {
            icon.className = "fa-solid fa-moon";
        } else {
            icon.className = "fa-solid fa-sun";
        }
    }

    const themeToggleBtn = $("theme-toggle");
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener("click", () => {
            currentTheme = currentTheme === "dark" ? "light" : "dark";
            document.documentElement.setAttribute("data-theme", currentTheme);
            localStorage.setItem("fuelwise_theme", currentTheme);
            updateThemeToggleIcon();
            updateMapTileTheme();

            const activeTab = document.querySelector(".tab-content.active");
            if (activeTab && activeTab.id === "tab-analytics") {
                loadAnalytics();
            }
        });
    }

    // =========================================================================
    // 5. TAB NAVIGATION
    // =========================================================================
    const tabButtons = document.querySelectorAll(".nav-btn[data-tab]");
    const tabContents = document.querySelectorAll(".tab-content");
    const tabTitle = $("tab-title");
    const tabDesc = $("tab-desc");

    const TAB_INFO = {
        "tab-analyze": {
            title: "Analyze Ride",
            desc: "Input ride conditions to compute predicted mileage, range, and reachable fuel station routes."
        },
        "tab-group": {
            title: "Group Ride Convoy",
            desc: "Real-time convoy telemetry tracking 5 riders (Rider A to E) with live location, fuel reserve, and remaining range."
        },
        "tab-garage": {
            title: "My Garage",
            desc: "Manage motorcycle models, custom specifications, and fuel tank capacities."
        },
        "tab-logs": {
            title: "Refueling Log",
            desc: "Keep track of all fuel receipts, odometer readings, and expenses."
        },
        "tab-history": {
            title: "Trip History",
            desc: "Review past trips, route details, and predicted versus actual outcomes."
        },
        "tab-analytics": {
            title: "Analytics & Insights",
            desc: "Interactive charts showing fuel expenditure trends and bike mileage efficiency."
        }
    };

    tabButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            const targetId = btn.getAttribute("data-tab");
            if (!targetId) return;

            tabButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            tabContents.forEach(tc => tc.classList.remove("active"));
            const targetContent = $(targetId);
            if (targetContent) {
                targetContent.classList.add("active");
            }

            if (TAB_INFO[targetId]) {
                if (tabTitle) tabTitle.textContent = TAB_INFO[targetId].title;
                if (tabDesc) tabDesc.textContent = TAB_INFO[targetId].desc;
            }

            if (targetId === "tab-analyze") {
                setTimeout(() => {
                    if (map) map.invalidateSize();
                }, 200);
            } else if (targetId === "tab-group") {
                setTimeout(() => {
                    initGroupMap();
                    if (groupMap) groupMap.invalidateSize();
                    refreshGroupConvoy();
                }, 200);
            } else if (targetId === "tab-garage") {
                loadBikes();
            } else if (targetId === "tab-logs") {
                loadRefuels();
            } else if (targetId === "tab-history") {
                loadTrips();
            } else if (targetId === "tab-analytics") {
                loadAnalytics();
            }
        });
    });

    // =========================================================================
    // 6. LEAFLET INTERACTIVE MAP
    // =========================================================================
    function createDivIcon(iconClass, bgGradient, shadowColor, size = 30) {
        if (typeof L === "undefined") return null;
        return L.divIcon({
            className: "custom-map-marker",
            html: `<div style="background:${bgGradient}; width:${size}px; height:${size}px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#fff; font-size:${Math.round(size * 0.46)}px; box-shadow:0 0 12px ${shadowColor}; border:2px solid #fff;"><i class="fa-solid ${iconClass}"></i></div>`,
            iconSize: [size, size],
            iconAnchor: [Math.round(size / 2), Math.round(size / 2)]
        });
    }

    function initMap() {
        if (typeof L === "undefined") {
            console.warn("Leaflet library not loaded yet.");
            return;
        }

        const mapContainer = $("route-map");
        if (!mapContainer) return;
        if (map) {
            map.invalidateSize();
            return;
        }

        try {
            map = L.map("route-map", {
                center: DEFAULT_CENTER,
                zoom: 10,
                zoomControl: true
            });

            updateMapTileTheme();

            // Click listener for dropping Start / Destination pins
            map.on("click", async (e) => {
                const lat = e.latlng.lat;
                const lon = e.latlng.lng;

                if (pinMode === "start") {
                    await setStartLocation(lat, lon, true);
                    setPinMode(null);
                    showToast("Start location pinned!", "success");
                    checkAndPreviewDirectRoute();
                } else if (pinMode === "end") {
                    await setEndLocation(lat, lon, true);
                    setPinMode(null);
                    showToast("Destination pinned!", "success");
                    checkAndPreviewDirectRoute();
                }
            });

            setTimeout(() => {
                if (map) map.invalidateSize();
            }, 300);
        } catch (err) {
            console.error("Map initialization error:", err);
        }
    }

    function updateMapTileTheme() {
        if (typeof L === "undefined") return;

        const isDark = currentTheme === "dark";
        const tileUrl = isDark
            ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

        if (map) {
            if (tileLayer) map.removeLayer(tileLayer);
            tileLayer = L.tileLayer(tileUrl, {
                maxZoom: 19,
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            }).addTo(map);
        }

        if (groupMap) {
            if (groupTileLayer) groupMap.removeLayer(groupTileLayer);
            groupTileLayer = L.tileLayer(tileUrl, {
                maxZoom: 19,
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            }).addTo(groupMap);
        }
    }

    async function setStartLocation(lat, lon, reverseGeocodeAddress = false) {
        startCoords = { lat, lon };
        if (!map || typeof L === "undefined") return;

        const startIcon = createDivIcon("fa-flag", "linear-gradient(135deg, #10b981, #059669)", "#10b981", 32);

        if (startMarker) map.removeLayer(startMarker);
        startMarker = L.marker([lat, lon], { icon: startIcon, draggable: true }).addTo(map);
        startMarker.bindPopup("<b><i class='fa-solid fa-flag'></i> Start Point</b><br>Current Location").openPopup();

        startMarker.on("dragend", async (e) => {
            const p = e.target.getLatLng();
            startCoords = { lat: p.lat, lon: p.lng };
            const addr = await reverseGeocode(p.lat, p.lng);
            if ($("start-location")) $("start-location").value = addr;
            checkAndPreviewDirectRoute();
        });

        if (reverseGeocodeAddress) {
            if ($("start-location")) $("start-location").value = "Fetching address...";
            const addr = await reverseGeocode(lat, lon);
            if ($("start-location")) $("start-location").value = addr;
        }
    }

    async function setEndLocation(lat, lon, reverseGeocodeAddress = false) {
        endCoords = { lat, lon };
        if (!map || typeof L === "undefined") return;

        const endIcon = createDivIcon("fa-location-dot", "linear-gradient(135deg, #ef4444, #dc2626)", "#ef4444", 32);

        if (endMarker) map.removeLayer(endMarker);
        endMarker = L.marker([lat, lon], { icon: endIcon, draggable: true }).addTo(map);
        endMarker.bindPopup("<b><i class='fa-solid fa-location-dot'></i> Destination</b>").openPopup();

        endMarker.on("dragend", async (e) => {
            const p = e.target.getLatLng();
            endCoords = { lat: p.lat, lon: p.lng };
            const addr = await reverseGeocode(p.lat, p.lng);
            if ($("end-location")) $("end-location").value = addr;
            checkAndPreviewDirectRoute();
        });

        if (reverseGeocodeAddress) {
            if ($("end-location")) $("end-location").value = "Fetching address...";
            const addr = await reverseGeocode(lat, lon);
            if ($("end-location")) $("end-location").value = addr;
        }
    }

    function setPinMode(mode) {
        pinMode = mode;
        const statusSpan = $("coords-status");
        const btnStart = $("btn-pin-start");
        const btnEnd = $("btn-pin-end");
        const mapContainer = $("route-map");

        if (btnStart) btnStart.classList.toggle("btn-active", mode === "start");
        if (btnEnd) btnEnd.classList.toggle("btn-active", mode === "end");

        if (mapContainer) {
            mapContainer.style.cursor = mode ? "crosshair" : "";
        }

        if (statusSpan) {
            if (mode === "start") {
                statusSpan.textContent = "Click map to drop START pin";
                statusSpan.className = "badge badge-success";
            } else if (mode === "end") {
                statusSpan.textContent = "Click map to drop DESTINATION pin";
                statusSpan.className = "badge badge-danger";
            } else {
                statusSpan.textContent = "Map pin helpers ready";
                statusSpan.className = "badge badge-info";
            }
        }
    }

    const btnPinStart = $("btn-pin-start");
    if (btnPinStart) {
        btnPinStart.addEventListener("click", () => {
            setPinMode(pinMode === "start" ? null : "start");
        });
    }

    const btnPinEnd = $("btn-pin-end");
    if (btnPinEnd) {
        btnPinEnd.addEventListener("click", () => {
            setPinMode(pinMode === "end" ? null : "end");
        });
    }

    // Geocoding helpers via backend API proxy
    async function geocodeLocation(name) {
        try {
            const resp = await fetch(`/api/geocode?q=${encodeURIComponent(name)}`);
            const data = await resp.json();
            if (data.success && data.lat && data.lon) {
                return { lat: data.lat, lon: data.lon, display_name: data.display_name };
            }
        } catch (e) {
            console.error("Geocode lookup error:", e);
        }
        return null;
    }

    async function reverseGeocode(lat, lon) {
        try {
            const resp = await fetch(`/api/reverse-geocode?lat=${lat}&lon=${lon}`);
            const data = await resp.json();
            if (data.success && data.display_name) {
                return data.display_name;
            }
        } catch (e) {
            console.error("Reverse geocode error:", e);
        }
        return `Lat: ${lat.toFixed(4)}, Lon: ${lon.toFixed(4)}`;
    }

    function checkAndPreviewDirectRoute() {
        if (!startCoords || !endCoords || !map || typeof L === "undefined") return;

        const bounds = L.latLngBounds([
            [startCoords.lat, startCoords.lon],
            [endCoords.lat, endCoords.lon]
        ]);
        map.fitBounds(bounds, { padding: [50, 50] });

        fetch("/api/route", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                start_lat: startCoords.lat,
                start_lon: startCoords.lon,
                end_lat: endCoords.lat,
                end_lon: endCoords.lon
            })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success && data.route && data.route.geometry) {
                clearRoutePolylines();
                const coords = data.route.geometry.map(pt => [pt[1], pt[0]]);
                routePolylineDirect = L.polyline(coords, {
                    color: "#00f0ff",
                    weight: 5,
                    opacity: 0.85
                }).addTo(map);

                const fallbackInput = $("fallback-distance");
                if (fallbackInput) fallbackInput.value = data.route.distance_km;
            }
        })
        .catch(err => console.log("Route preview error:", err));
    }

    function clearRoutePolylines() {
        if (!map) return;
        if (routePolylineDirect) {
            map.removeLayer(routePolylineDirect);
            routePolylineDirect = null;
        }
        if (routePolylineLeg1) {
            map.removeLayer(routePolylineLeg1);
            routePolylineLeg1 = null;
        }
        if (routePolylineLeg2) {
            map.removeLayer(routePolylineLeg2);
            routePolylineLeg2 = null;
        }
    }

    function clearStationMarkers() {
        if (!map) return;
        stationMarkers.forEach(m => map.removeLayer(m));
        stationMarkers = [];
        if (bestStationMarker) {
            map.removeLayer(bestStationMarker);
            bestStationMarker = null;
        }
    }

    // Nearby Fuel Stations Manual Button
    const findStationsBtn = $("find-stations-btn");
    if (findStationsBtn) {
        findStationsBtn.addEventListener("click", async () => {
            const center = startCoords || (map ? { lat: map.getCenter().lat, lon: map.getCenter().lng } : { lat: DEFAULT_CENTER[0], lon: DEFAULT_CENTER[1] });
            const lat = center.lat;
            const lon = center.lon || center.lng;

            findStationsBtn.disabled = true;
            findStationsBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Finding Stations...`;

            try {
                let url = `/api/fuel-stations?lat=${lat}&lon=${lon}`;
                if (endCoords) {
                    url += `&end_lat=${endCoords.lat}&end_lon=${endCoords.lon}`;
                }
                const resp = await fetch(url);
                const stations = await resp.json();

                clearStationMarkers();

                const stationListBox = $("fuel-stations-list");
                if (stationListBox) stationListBox.innerHTML = "";

                if (!stations || stations.length === 0) {
                    showToast("No fuel stations found nearby.", "info");
                    if (stationListBox) {
                        stationListBox.innerHTML = `<p style="padding:10px; color:var(--text-muted); font-size:13px;">No fuel stations found in range.</p>`;
                    }
                    return;
                }

                const pumpIcon = createDivIcon("fa-gas-pump", "linear-gradient(135deg, #f59e0b, #d97706)", "#f59e0b", 26);

                let listHtml = `
                    <div style="padding:10px 0; border-top:1px solid var(--border-color); margin-top:10px;">
                        <h4 style="font-size:13px; color:var(--primary-color); margin-bottom:8px;">
                            <i class="fa-solid fa-gas-pump"></i> Available Fuel Stations (${stations.length} found)
                        </h4>
                        <div style="display:flex; flex-direction:column; gap:6px; max-height:160px; overflow-y:auto;">
                `;

                stations.forEach(st => {
                    if (map && pumpIcon) {
                        const marker = L.marker([st.lat, st.lon], { icon: pumpIcon }).addTo(map);
                        marker.bindPopup(`<b>${escapeHTML(st.name)}</b><br>Brand: ${escapeHTML(st.brand)}<br>Distance: ~${st.distance_km} km`);
                        stationMarkers.push(marker);
                    }

                    listHtml += `
                        <div style="background:var(--bg-secondary); padding:8px 12px; border-radius:8px; display:flex; justify-content:space-between; align-items:center; font-size:12px; border:1px solid var(--border-color);">
                            <div>
                                <strong style="color:var(--text-primary);">${escapeHTML(st.name)}</strong>
                                <span style="display:block; color:var(--text-muted); font-size:11px;">${escapeHTML(st.brand)}</span>
                            </div>
                            <span class="badge badge-info">${st.distance_km} km</span>
                        </div>
                    `;
                });

                listHtml += `</div></div>`;
                if (stationListBox) stationListBox.innerHTML = listHtml;
                showToast(`Found ${stations.length} fuel stations!`, "success");
            } catch (err) {
                console.error("Fetch stations error:", err);
                showToast("Could not retrieve fuel stations.", "error");
            } finally {
                findStationsBtn.disabled = false;
                findStationsBtn.innerHTML = `<i class="fa-solid fa-gas-pump"></i> Find Nearby Fuel Stations`;
            }
        });
    }

    // =========================================================================
    // 7. BIKES (MY GARAGE) & SELECTOR POPULATION
    // =========================================================================
    async function loadBikes() {
        try {
            const resp = await fetch("/api/bikes");
            bikesList = await resp.json();

            const bikeSelect = $("bike-select");
            const modalBike = $("modal-bike");

            if (bikeSelect && Array.isArray(bikesList) && bikesList.length > 0) {
                const currentVal = bikeSelect.value;
                bikeSelect.innerHTML = `<option value="">Select bike...</option>`;
                bikesList.forEach(b => {
                    const opt = document.createElement("option");
                    opt.value = b.name;
                    opt.textContent = `${b.name} (${b.base_mileage} km/L)`;
                    bikeSelect.appendChild(opt);
                });
                if (currentVal && bikesList.some(b => b.name === currentVal)) {
                    bikeSelect.value = currentVal;
                } else if (bikesList.length > 0) {
                    bikeSelect.value = bikesList[0].name;
                }
            }

            if (modalBike && Array.isArray(bikesList) && bikesList.length > 0) {
                modalBike.innerHTML = "";
                bikesList.forEach(b => {
                    const opt = document.createElement("option");
                    opt.value = b.name;
                    opt.textContent = b.name;
                    modalBike.appendChild(opt);
                });
            }

            // Populate Garage Table
            const tbody = document.querySelector("#bikes-table tbody");
            if (tbody) {
                if (!bikesList || bikesList.length === 0) {
                    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No custom bikes in garage yet.</td></tr>`;
                } else {
                    tbody.innerHTML = bikesList.map(b => `
                        <tr>
                            <td><strong>${escapeHTML(b.name)}</strong></td>
                            <td>${b.base_mileage} km/L</td>
                            <td>${b.tank_capacity} L</td>
                            <td class="actions-col">
                                <button class="btn-danger btn-xs btn-delete-bike" data-id="${b.id}" title="Delete Bike">
                                    <i class="fa-solid fa-trash"></i>
                                </button>
                            </td>
                        </tr>
                    `).join("");

                    tbody.querySelectorAll(".btn-delete-bike").forEach(btn => {
                        btn.addEventListener("click", async () => {
                            const id = btn.getAttribute("data-id");
                            if (confirm("Are you sure you want to remove this motorcycle?")) {
                                try {
                                    const delResp = await fetch(`/api/bikes/${id}`, { method: "DELETE" });
                                    const res = await delResp.json();
                                    if (res.success) {
                                        showToast(res.message, "success");
                                        loadBikes();
                                    }
                                } catch (e) {
                                    showToast("Failed to delete bike.", "error");
                                }
                            }
                        });
                    });
                }
            }
        } catch (err) {
            console.error("Load bikes error:", err);
        }
    }

    const addBikeForm = $("add-bike-form");
    if (addBikeForm) {
        addBikeForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const name = $("new-bike-name").value.trim();
            const base_mileage = parseFloat($("new-bike-mileage").value);
            const tank_capacity = parseFloat($("new-bike-tank").value);

            if (!name) return;

            try {
                const resp = await fetch("/api/bikes", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name, base_mileage, tank_capacity })
                });
                const res = await resp.json();
                if (res.success) {
                    showToast(res.message, "success");
                    addBikeForm.reset();
                    loadBikes();
                } else {
                    showToast(res.error || "Failed to add bike", "error");
                }
            } catch (err) {
                showToast("Error connecting to server.", "error");
            }
        });
    }

    // =========================================================================
    // 8. RIDE ANALYZER & MACHINE LEARNING PREDICTION
    // =========================================================================
    const fuelInput = $("fuel-input");
    const fuelVal = $("fuel-val");
    if (fuelInput && fuelVal) {
        fuelInput.addEventListener("input", () => {
            fuelVal.textContent = fuelInput.value;
        });
    }

    const speedInput = $("speed-input");
    const speedVal = $("speed-val");
    if (speedInput && speedVal) {
        speedInput.addEventListener("input", () => {
            speedVal.textContent = speedInput.value;
        });
    }

    const analyzeForm = $("analyze-form");
    if (analyzeForm) {
        analyzeForm.addEventListener("submit", async (e) => {
            e.preventDefault();

            const btnSubmit = $("btn-submit-analyze");
            if (btnSubmit) {
                btnSubmit.classList.add("loading");
                btnSubmit.disabled = true;
            }

            const startText = $("start-location").value.trim() || "Mumbai";
            const endText = $("end-location").value.trim() || "Thane";

            // If coordinates not set yet, attempt fast geocode
            if (!startCoords && startText) {
                const geo = await geocodeLocation(startText);
                if (geo) {
                    await setStartLocation(geo.lat, geo.lon, false);
                }
            }
            if (!endCoords && endText) {
                const geo = await geocodeLocation(endText);
                if (geo) {
                    await setEndLocation(geo.lat, geo.lon, false);
                }
            }

            const payload = {
                bike_name: $("bike-select").value || "Hero Splendor",
                road: $("road-select").value || "Highway",
                load: $("load-select").value || "Rider Only",
                fallback_distance: parseFloat($("fallback-distance").value || 15),
                fuel: parseFloat(fuelInput ? fuelInput.value : 2.5),
                speed: parseFloat(speedInput ? speedInput.value : 50),
                start_location: startText,
                end_location: endText,
                optimize_speed: $("optimize-speed-input") ? $("optimize-speed-input").checked : true
            };

            if (startCoords) {
                payload.start_lat = startCoords.lat;
                payload.start_lon = startCoords.lon;
            }
            if (endCoords) {
                payload.end_lat = endCoords.lat;
                payload.end_lon = endCoords.lon;
            }

            try {
                const resp = await fetch("/api/predict", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
                const result = await resp.json();

                if (result.success) {
                    displayAnalysisResults(result);
                    showToast("Ride analysis complete!", "success");
                } else {
                    showToast(result.error || "Analysis failed.", "error");
                }
            } catch (err) {
                console.error("Prediction error:", err);
                showToast("Failed to communicate with prediction engine.", "error");
            } finally {
                if (btnSubmit) {
                    btnSubmit.classList.remove("loading");
                    btnSubmit.disabled = false;
                }
            }
        });
    }

    function displayAnalysisResults(result) {
        // Reveal main results card
        const resultsCard = $("analysis-results-card");
        if (resultsCard) resultsCard.classList.remove("hidden");

        // Primary statistics
        if ($("res-mileage")) $("res-mileage").textContent = `${result.mileage} km/L`;
        if ($("res-range")) $("res-range").textContent = `${result.predicted_range} km`;
        if ($("res-distance")) $("res-distance").textContent = `${result.distance} km`;
        if ($("res-time")) $("res-time").textContent = `${result.travel_time_hours} hrs (${result.travel_time_minutes} min)`;

        // Fuel status indicators
        const resFuelNeeded = $("res-fuel-needed");
        if (resFuelNeeded) {
            resFuelNeeded.textContent = `Fuel Needed: ${result.fuel_needed} L / Available: ${result.fuel_input} L`;
        }

        const statusLabel = $("res-status-label");
        const progressFill = $("fuel-progress-fill");

        const pct = Math.min(100, Math.round((result.fuel_needed / result.fuel_input) * 100));
        if (progressFill) progressFill.style.width = `${pct}%`;

        const guidanceCard = $("station-guidance-card");

        clearRoutePolylines();
        clearStationMarkers();

        // Update Start & Destination Markers on Map
        if (result.start_coords && (!startCoords || startCoords.lat !== result.start_coords.lat)) {
            setStartLocation(result.start_coords.lat, result.start_coords.lon, false);
        }
        if (result.end_coords && (!endCoords || endCoords.lat !== result.end_coords.lat)) {
            setEndLocation(result.end_coords.lat, result.end_coords.lon, false);
        }

        if (result.can_reach) {
            // === SCENARIO 1: DESTINATION CAN BE REACHED ===
            if (statusLabel) {
                statusLabel.textContent = "🟢 Destination Reachable";
                statusLabel.className = "status-badge badge-success";
            }
            if (progressFill) {
                progressFill.className = "progress-fill green";
            }

            // Hide emergency guidance card
            if (guidanceCard) guidanceCard.classList.add("hidden");

            // Recommendation text
            const resRec = $("res-recommendation");
            if (resRec) {
                resRec.innerHTML = `
                    <strong><i class="fa-solid fa-circle-check" style="color:var(--success);"></i> Safe Journey!</strong>
                    You have enough fuel to reach your destination with approximately <strong>${result.fuel_remaining} Litres</strong> remaining in the tank.<br>
                    <small style="color:var(--text-secondary);"><i class="fa-solid fa-leaf" style="color:var(--success);"></i> AI Eco-Speed Recommendation: Cruising at <strong>${result.recommended_speed} km/h</strong> will yield maximum efficiency (~${result.recommended_mileage} km/L).</small>
                `;
            }

            // Draw direct route on Leaflet map
            if (result.geometry && result.geometry.length > 0 && map && typeof L !== "undefined") {
                const coords = result.geometry.map(pt => [pt[1], pt[0]]);
                routePolylineDirect = L.polyline(coords, {
                    color: "#00f0ff",
                    weight: 6,
                    opacity: 0.9
                }).addTo(map);
                map.fitBounds(routePolylineDirect.getBounds(), { padding: [40, 40] });
            }
        } else {
            // === SCENARIO 2: DESTINATION CANNOT BE REACHED (REFUEL REQUIRED) ===
            if (statusLabel) {
                statusLabel.textContent = `🔴 Refuel Required (Deficit: ${result.fuel_deficit} L)`;
                statusLabel.className = "status-badge badge-danger";
            }
            if (progressFill) {
                progressFill.className = "progress-fill red";
            }

            // Recommendation warning
            const resRec = $("res-recommendation");
            if (resRec) {
                resRec.innerHTML = `
                    <strong><i class="fa-solid fa-triangle-exclamation" style="color:var(--danger);"></i> Fuel Deficit Warning:</strong>
                    Available fuel (${result.fuel_input} L) is insufficient for the ${result.distance} km trip. You need at least <strong>${result.fuel_deficit} Litres</strong> more to reach your original destination.
                    <br><strong style="color:#f59e0b;">AI has automatically plotted reachable fuel stations below.</strong>
                `;
            }

            // Show and populate Emergency Guidance Card
            if (guidanceCard) {
                guidanceCard.classList.remove("hidden");
            }

            currentReachableStations = result.reachable_stations || [];
            currentSelectedStation = result.best_station;

            if (result.best_station) {
                applyStationGuidance(result.best_station, result);
            }

            // Render other reachable station chips
            renderReachableChips(currentReachableStations, result);
        }

        // Scroll smoothly to results
        resultsCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    function applyStationGuidance(station, fullResult) {
        if (!station) return;

        if ($("best-station-name")) $("best-station-name").textContent = station.name;
        if ($("best-station-brand")) $("best-station-brand").textContent = station.brand;
        if ($("best-station-distance")) $("best-station-distance").textContent = `${station.distance_km} km`;
        if ($("best-station-speed")) $("best-station-speed").textContent = `${station.ai_recommended_speed} km/h`;
        if ($("best-station-mileage")) $("best-station-mileage").textContent = `${station.predicted_mileage} km/L`;
        if ($("best-station-fuel-req")) $("best-station-fuel-req").textContent = `${station.fuel_required} L`;
        if ($("best-station-remaining-fuel")) $("best-station-remaining-fuel").textContent = `${station.fuel_remaining} L`;
        if ($("best-station-time")) $("best-station-time").textContent = `${station.travel_time_minutes} min`;

        if ($("leg1-station-name")) $("leg1-station-name").textContent = station.name;
        if ($("leg1-meta")) $("leg1-meta").textContent = `${station.distance_km} km | ~${station.travel_time_minutes} min at ${station.ai_recommended_speed} km/h`;
        if ($("leg2-meta")) $("leg2-meta").textContent = `${station.distance_to_dest_km} km (Refuel & Continue to Destination)`;

        // Update Map multi-leg route
        if (map && typeof L !== "undefined") {
            clearRoutePolylines();

            // Highlight Best Station Marker
            if (bestStationMarker) map.removeLayer(bestStationMarker);
            const bestIcon = createDivIcon("fa-gas-pump", "linear-gradient(135deg, #f59e0b, #b45309)", "#f59e0b", 34);
            bestStationMarker = L.marker([station.lat, station.lon], {
                icon: bestIcon,
                zIndexOffset: 1000
            }).addTo(map);

            bestStationMarker.bindPopup(`
                <div style="font-size:13px;">
                    <strong style="color:#f59e0b;"><i class="fa-solid fa-trophy"></i> Best Reachable Station</strong><br>
                    <b>${escapeHTML(station.name)}</b><br>
                    Brand: ${escapeHTML(station.brand)}<br>
                    Distance: <b>${station.distance_km} km</b><br>
                    Recommended Speed: <b>${station.ai_recommended_speed} km/h</b><br>
                    Fuel Needed: <b>${station.fuel_required} L</b> (Remaining: ${station.fuel_remaining} L)<br>
                    Travel Time: ~<b>${station.travel_time_minutes} min</b>
                </div>
            `).openPopup();

            // Leg 1: Current -> Station (Solid Amber)
            if (fullResult.leg1_geometry && fullResult.leg1_geometry.length > 0) {
                const leg1Coords = fullResult.leg1_geometry.map(pt => [pt[1], pt[0]]);
                routePolylineLeg1 = L.polyline(leg1Coords, {
                    color: "#f59e0b",
                    weight: 6,
                    opacity: 0.9
                }).addTo(map);
            } else if (startCoords) {
                routePolylineLeg1 = L.polyline([[startCoords.lat, startCoords.lon], [station.lat, station.lon]], {
                    color: "#f59e0b",
                    weight: 5
                }).addTo(map);
            }

            // Leg 2: Station -> Destination (Dashed Violet)
            if (fullResult.leg2_geometry && fullResult.leg2_geometry.length > 0) {
                const leg2Coords = fullResult.leg2_geometry.map(pt => [pt[1], pt[0]]);
                routePolylineLeg2 = L.polyline(leg2Coords, {
                    color: "#a855f7",
                    weight: 5,
                    opacity: 0.85,
                    dashArray: "8, 8"
                }).addTo(map);
            } else if (endCoords) {
                routePolylineLeg2 = L.polyline([[station.lat, station.lon], [endCoords.lat, endCoords.lon]], {
                    color: "#a855f7",
                    weight: 4,
                    dashArray: "8, 8"
                }).addTo(map);
            }

            // Fit map bounds to contain Start, Station, and Destination
            const allPoints = [];
            if (startCoords) allPoints.push([startCoords.lat, startCoords.lon]);
            allPoints.push([station.lat, station.lon]);
            if (endCoords) allPoints.push([endCoords.lat, endCoords.lon]);
            if (allPoints.length > 1) {
                map.fitBounds(L.latLngBounds(allPoints), { padding: [40, 40] });
            }
        }
    }

    function renderReachableChips(stations, fullResult) {
        const chipsContainer = $("reachable-chips-list");
        if (!chipsContainer) return;

        if (!stations || stations.length === 0) {
            chipsContainer.innerHTML = `<span style="color:var(--text-muted); font-size:12px;">No other reachable stations detected within current fuel range.</span>`;
            return;
        }

        chipsContainer.innerHTML = stations.map(st => {
            const isBest = currentSelectedStation && currentSelectedStation.id === st.id;
            return `
                <button type="button" class="station-chip-btn ${isBest ? 'active' : ''}" data-station-id="${st.id}">
                    <i class="fa-solid fa-gas-pump" style="color:#f59e0b;"></i>
                    <strong>${escapeHTML(st.name.split('(')[0].trim())}</strong>
                    <span class="badge badge-info">${st.distance_km} km</span>
                    <small style="color:var(--success);"><i class="fa-solid fa-leaf"></i> ${st.ai_recommended_speed} km/h</small>
                </button>
            `;
        }).join("");

        // Click on chip dynamically reroutes to that station
        chipsContainer.querySelectorAll(".station-chip-btn").forEach(btn => {
            btn.addEventListener("click", async () => {
                const stId = btn.getAttribute("data-station-id");
                const chosen = stations.find(s => s.id === stId);
                if (chosen) {
                    currentSelectedStation = chosen;
                    chipsContainer.querySelectorAll(".station-chip-btn").forEach(b => b.classList.remove("active"));
                    btn.classList.add("active");

                    // Fetch dynamic multi-leg route for the chosen station
                    if (startCoords && endCoords) {
                        try {
                            const [r1, r2] = await Promise.all([
                                fetch("/api/route", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                        start_lat: startCoords.lat,
                                        start_lon: startCoords.lon,
                                        end_lat: chosen.lat,
                                        end_lon: chosen.lon
                                    })
                                }).then(r => r.json()),
                                fetch("/api/route", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                        start_lat: chosen.lat,
                                        start_lon: chosen.lon,
                                        end_lat: endCoords.lat,
                                        end_lon: endCoords.lon
                                    })
                                }).then(r => r.json())
                            ]);

                            fullResult.leg1_geometry = r1.success && r1.route ? r1.route.geometry : [];
                            fullResult.leg2_geometry = r2.success && r2.route ? r2.route.geometry : [];
                        } catch (e) {
                            console.log("Reroute fetch error:", e);
                        }
                    }

                    applyStationGuidance(chosen, fullResult);
                    showToast(`Rerouted via ${chosen.name}!`, "info");
                }
            });
        });
    }

    // =========================================================================
    // 9. REFUELING LOGS
    // =========================================================================
    const refuelDateInput = $("refuel-date");
    if (refuelDateInput && !refuelDateInput.value) {
        refuelDateInput.value = new Date().toISOString().split("T")[0];
    }

    async function loadRefuels() {
        try {
            const resp = await fetch("/api/refuels");
            const logs = await resp.json();

            const tbody = document.querySelector("#refuels-table tbody");
            if (!tbody) return;

            if (!logs || logs.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No refueling records logged yet.</td></tr>`;
                return;
            }

            tbody.innerHTML = logs.map(r => `
                <tr>
                    <td>${r.date}</td>
                    <td>${r.liters} L</td>
                    <td>₹${Number(r.cost).toFixed(2)}</td>
                    <td>${r.odometer} km</td>
                    <td class="actions-col">
                        <button class="btn-danger btn-xs btn-delete-refuel" data-id="${r.id}" title="Delete Record">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `).join("");

            tbody.querySelectorAll(".btn-delete-refuel").forEach(btn => {
                btn.addEventListener("click", async () => {
                    const id = btn.getAttribute("data-id");
                    if (confirm("Delete this refueling record?")) {
                        try {
                            const res = await (await fetch(`/api/refuels/${id}`, { method: "DELETE" })).json();
                            if (res.success) {
                                showToast(res.message, "success");
                                loadRefuels();
                            }
                        } catch (e) {
                            showToast("Error deleting refuel log.", "error");
                        }
                    }
                });
            });
        } catch (err) {
            console.error("Load refuels error:", err);
        }
    }

    const refuelForm = $("refuel-form");
    if (refuelForm) {
        refuelForm.addEventListener("submit", async (e) => {
            e.preventDefault();

            const date = $("refuel-date").value;
            const liters = parseFloat($("refuel-liters").value);
            const price_per_liter = parseFloat($("refuel-price").value);
            const odometer = parseFloat($("refuel-odometer").value);
            const notes = $("refuel-notes").value.trim();

            const cost = liters * price_per_liter;

            try {
                const resp = await fetch("/api/refuels", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ date, liters, price_per_liter, cost, odometer, notes })
                });
                const res = await resp.json();
                if (res.success) {
                    showToast(res.message, "success");
                    refuelForm.reset();
                    if (refuelDateInput) refuelDateInput.value = new Date().toISOString().split("T")[0];
                    loadRefuels();
                } else {
                    showToast(res.error || "Failed to save record.", "error");
                }
            } catch (err) {
                showToast("Connection error.", "error");
            }
        });
    }

    // =========================================================================
    // 10. TRIP HISTORY
    // =========================================================================
    async function loadTrips() {
        try {
            const resp = await fetch("/api/trips");
            const trips = await resp.json();

            const tbody = document.querySelector("#history-table tbody");
            if (!tbody) return;

            if (!trips || trips.length === 0) {
                tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--text-muted);">No trip records found. Run an analysis to log trips!</td></tr>`;
                return;
            }

            tbody.innerHTML = trips.map(t => {
                const isSufficient = t.status && t.status.toLowerCase().includes("sufficient");
                const badgeClass = isSufficient ? "badge-success" : "badge-danger";
                const displayDate = t.timestamp ? t.timestamp.split(" ")[0] : "Recent";

                return `
                    <tr>
                        <td>${displayDate}</td>
                        <td>${escapeHTML(t.start_location)} &rarr; ${escapeHTML(t.end_location)} (${t.distance_km} km)</td>
                        <td><strong>${escapeHTML(t.bike_name)}</strong></td>
                        <td>${t.speed} km/h</td>
                        <td>${t.road_type}</td>
                        <td>${t.fuel_needed} L</td>
                        <td>${t.predicted_range} km</td>
                        <td><span class="badge ${badgeClass}">${t.status}</span></td>
                        <td class="actions-col">
                            <button class="btn-danger btn-xs btn-delete-trip" data-id="${t.id}" title="Delete Trip Record">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </td>
                    </tr>
                `;
            }).join("");

            tbody.querySelectorAll(".btn-delete-trip").forEach(btn => {
                btn.addEventListener("click", async () => {
                    const id = btn.getAttribute("data-id");
                    if (confirm("Delete this trip record?")) {
                        try {
                            const res = await (await fetch(`/api/trips/${id}`, { method: "DELETE" })).json();
                            if (res.success) {
                                showToast(res.message, "success");
                                loadTrips();
                            }
                        } catch (e) {
                            showToast("Error deleting trip.", "error");
                        }
                    }
                });
            });
        } catch (err) {
            console.error("Load trips error:", err);
        }
    }

    // =========================================================================
    // 11. RETRAINING & ACTUAL RIDE MODAL
    // =========================================================================
    const rideModal = $("ride-modal");
    const btnSyncModel = $("btn-sync-model");
    const btnReportRideModal = $("btn-report-ride-modal");
    const btnCloseModal = $("btn-close-modal");
    const retrainForm = $("retrain-form");

    function openRetrainModal() {
        if (rideModal) rideModal.classList.remove("hidden");
    }

    function closeRetrainModal() {
        if (rideModal) rideModal.classList.add("hidden");
    }

    if (btnSyncModel) btnSyncModel.addEventListener("click", openRetrainModal);
    if (btnReportRideModal) btnReportRideModal.addEventListener("click", openRetrainModal);
    if (btnCloseModal) btnCloseModal.addEventListener("click", closeRetrainModal);

    if (rideModal) {
        rideModal.addEventListener("click", (e) => {
            if (e.target === rideModal) closeRetrainModal();
        });
    }

    if (retrainForm) {
        retrainForm.addEventListener("submit", async (e) => {
            e.preventDefault();

            const payload = {
                bike: $("modal-bike").value,
                road: $("modal-road").value,
                load: parseInt($("modal-load").value),
                speed: parseFloat($("modal-speed").value),
                fuel: parseFloat($("modal-fuel").value),
                distance: parseFloat($("modal-distance").value),
                mileage: parseFloat($("modal-mileage").value)
            };

            try {
                const resp = await fetch("/api/retrain", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
                const res = await resp.json();

                if (res.success) {
                    showToast(res.message, "success");
                    retrainForm.reset();
                    closeRetrainModal();
                } else {
                    showToast(res.error || "Retraining failed.", "error");
                }
            } catch (err) {
                console.error("Retrain error:", err);
                showToast("Server error during retraining.", "error");
            }
        });
    }

    // =========================================================================
    // 12. ANALYTICS & CHARTS (CHART.JS)
    // =========================================================================
    async function loadAnalytics() {
        if (typeof Chart === "undefined") {
            console.warn("Chart.js is not loaded.");
            return;
        }

        try {
            const resp = await fetch("/api/stats");
            const data = await resp.json();

            if (!data.success) {
                showToast("Could not load stats data.", "error");
                return;
            }

            const isDark = currentTheme === "dark";
            const textColor = isDark ? "#f1f5f9" : "#0f172a";
            const gridColor = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)";

            // 1. Refueling Expenditures Line Chart
            const ctxExpenses = $("chart-expenses");
            if (ctxExpenses) {
                if (chartInstances.expenses) chartInstances.expenses.destroy();

                const dates = data.refuel_dates && data.refuel_dates.length > 0 ? data.refuel_dates : ["No Data"];
                const costs = data.refuel_costs && data.refuel_costs.length > 0 ? data.refuel_costs : [0];

                chartInstances.expenses = new Chart(ctxExpenses, {
                    type: "line",
                    data: {
                        labels: dates,
                        datasets: [{
                            label: "Expense (₹)",
                            data: costs,
                            borderColor: "#00f0ff",
                            backgroundColor: "rgba(0, 240, 255, 0.15)",
                            borderWidth: 2,
                            fill: true,
                            tension: 0.35,
                            pointRadius: 4,
                            pointBackgroundColor: "#00f0ff"
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { labels: { color: textColor } }
                        },
                        scales: {
                            x: { grid: { color: gridColor }, ticks: { color: textColor } },
                            y: { grid: { color: gridColor }, ticks: { color: textColor } }
                        }
                    }
                });
            }

            // 2. Bike Mileages Bar Chart
            const ctxMileages = $("chart-mileages");
            if (ctxMileages && data.bike_mileages) {
                if (chartInstances.mileages) chartInstances.mileages.destroy();

                const bikes = Object.keys(data.bike_mileages);
                const mileages = Object.values(data.bike_mileages);

                chartInstances.mileages = new Chart(ctxMileages, {
                    type: "bar",
                    data: {
                        labels: bikes,
                        datasets: [{
                            label: "Avg Mileage (km/L)",
                            data: mileages,
                            backgroundColor: [
                                "rgba(0, 240, 255, 0.8)",
                                "rgba(168, 85, 247, 0.8)",
                                "rgba(16, 185, 129, 0.8)",
                                "rgba(245, 158, 11, 0.8)",
                                "rgba(239, 68, 68, 0.8)"
                            ],
                            borderRadius: 6
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { labels: { color: textColor } }
                        },
                        scales: {
                            x: { grid: { color: gridColor }, ticks: { color: textColor } },
                            y: { grid: { color: gridColor }, ticks: { color: textColor } }
                        }
                    }
                });
            }

            // 3. Dataset Dispersion: Speed vs Mileage Scatter
            const ctxDispersion = $("chart-dispersion");
            if (ctxDispersion) {
                if (chartInstances.dispersion) chartInstances.dispersion.destroy();

                const scatterData = data.scatter || [];

                chartInstances.dispersion = new Chart(ctxDispersion, {
                    type: "scatter",
                    data: {
                        datasets: [{
                            label: "Ride Observations",
                            data: scatterData,
                            backgroundColor: "rgba(168, 85, 247, 0.85)",
                            borderColor: "#a855f7",
                            pointRadius: 6,
                            pointHoverRadius: 8
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { labels: { color: textColor } },
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        const raw = context.raw;
                                        return `${raw.bike || 'Ride'}: ${raw.x} km/h -> ${raw.y} km/L`;
                                    }
                                }
                            }
                        },
                        scales: {
                            x: {
                                title: { display: true, text: "Speed (km/h)", color: textColor },
                                grid: { color: gridColor },
                                ticks: { color: textColor }
                            },
                            y: {
                                title: { display: true, text: "Mileage (km/L)", color: textColor },
                                grid: { color: gridColor },
                                ticks: { color: textColor }
                            }
                        }
                    }
                });
            }
        } catch (err) {
            console.error("Load analytics error:", err);
        }
    }

    function escapeHTML(str) {
        if (!str) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // =========================================================================
    // 13. PHONE LOGIN & USER AUTHENTICATION SYSTEM
    // =========================================================================
    function initAuthSystem() {
        const headerUserBtn = $("header-user-btn");
        const authModal = $("auth-modal");
        const btnCloseAuth = $("btn-close-auth-modal");
        const btnSendOtp = $("btn-send-otp");
        const btnVerifyOtp = $("btn-verify-otp");
        const btnQuickDemo = $("btn-quick-demo-login");
        const btnLogout = $("btn-logout");
        const btnBackPhone = $("btn-back-phone");

        function updateAuthHeaderUI() {
            const nameEl = $("header-user-name");
            const phoneEl = $("header-user-phone");
            if (currentUser) {
                if (nameEl) nameEl.textContent = currentUser.name || "Rider";
                if (phoneEl) phoneEl.textContent = currentUser.phone ? `+91 ${currentUser.phone}` : "Verified";
                
                // Pre-select bike in ride configurator
                const bikeSelect = $("bike-select");
                if (bikeSelect && currentUser.bike_name) {
                    for (let i = 0; i < bikeSelect.options.length; i++) {
                        if (bikeSelect.options[i].value === currentUser.bike_name) {
                            bikeSelect.selectedIndex = i;
                            break;
                        }
                    }
                }
            } else {
                if (nameEl) nameEl.textContent = "Login with Phone";
                if (phoneEl) phoneEl.textContent = "Guest Rider";
            }
        }

        function resetAuthInputs() {
            const phoneInput = $("auth-phone-input");
            const nameInput = $("auth-name-input");
            const otpInput = $("auth-otp-input");
            if (phoneInput) phoneInput.value = "";
            if (nameInput) nameInput.value = "";
            if (otpInput) otpInput.value = "";
        }

        function refreshAuthModalViews() {
            const stepPhone = $("auth-step-phone");
            const stepOtp = $("auth-step-otp");
            const stepLogged = $("auth-step-logged");

            if (currentUser) {
                if (stepPhone) {
                    stepPhone.classList.add("hidden");
                    stepPhone.style.display = "none";
                }
                if (stepOtp) {
                    stepOtp.classList.add("hidden");
                    stepOtp.style.display = "none";
                }
                if (stepLogged) {
                    stepLogged.classList.remove("hidden");
                    stepLogged.style.display = "block";
                    const loggedName = $("logged-user-name");
                    const loggedPhone = $("logged-user-phone");
                    const loggedBike = $("logged-user-bike");
                    if (loggedName) loggedName.textContent = currentUser.name;
                    if (loggedPhone) loggedPhone.textContent = `+91 ${currentUser.phone}`;
                    if (loggedBike) loggedBike.textContent = currentUser.bike_name || "Hero Splendor";
                }
            } else {
                if (stepLogged) {
                    stepLogged.classList.add("hidden");
                    stepLogged.style.display = "none";
                }
                if (stepOtp) {
                    stepOtp.classList.add("hidden");
                    stepOtp.style.display = "none";
                }
                if (stepPhone) {
                    stepPhone.classList.remove("hidden");
                    stepPhone.style.display = "block";
                }
            }
        }

        if (headerUserBtn) {
            headerUserBtn.addEventListener("click", () => {
                refreshAuthModalViews();
                if (authModal) authModal.classList.remove("hidden");
            });
        }

        if (btnCloseAuth && authModal) {
            btnCloseAuth.addEventListener("click", () => {
                authModal.classList.add("hidden");
            });
            authModal.addEventListener("click", (e) => {
                if (e.target === authModal) authModal.classList.add("hidden");
            });
        }

        // 1. Send OTP
        if (btnSendOtp) {
            btnSendOtp.addEventListener("click", async () => {
                const phoneInput = $("auth-phone-input");
                const phone = phoneInput ? phoneInput.value.trim() : "";
                if (!phone || phone.length < 8) {
                    showToast("Please enter a valid 10-digit mobile phone number", "error");
                    return;
                }

                try {
                    btnSendOtp.disabled = true;
                    btnSendOtp.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Sending OTP...`;
                    const res = await fetch("/api/auth/send-otp", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ phone })
                    });
                    const data = await res.json();
                    btnSendOtp.disabled = false;
                    btnSendOtp.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Send Verification Code`;

                    if (data.success) {
                        const stepPhone = $("auth-step-phone");
                        const stepOtp = $("auth-step-otp");
                        if (stepPhone) {
                            stepPhone.classList.add("hidden");
                            stepPhone.style.display = "none";
                        }
                        if (stepOtp) {
                            stepOtp.classList.remove("hidden");
                            stepOtp.style.display = "block";
                        }

                        const targetPhone = $("otp-target-phone");
                        if (targetPhone) targetPhone.textContent = `+91 ${phone}`;

                        const demoOtpEl = $("demo-otp-val");
                        if (demoOtpEl) demoOtpEl.textContent = data.demo_otp || "7788";

                        const otpInput = $("auth-otp-input");
                        if (otpInput) otpInput.value = data.demo_otp || "7788";

                        showToast(`Verification code sent! Demo OTP: ${data.demo_otp || "7788"}`, "success");
                    } else {
                        showToast(data.error || "Failed to send OTP", "error");
                    }
                } catch (err) {
                    btnSendOtp.disabled = false;
                    btnSendOtp.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Send Verification Code`;
                    showToast("Network error sending OTP", "error");
                }
            });
        }

        // 2. Verify OTP
        if (btnVerifyOtp) {
            btnVerifyOtp.addEventListener("click", async () => {
                const phone = $("auth-phone-input") ? $("auth-phone-input").value.trim() : "";
                const otp = $("auth-otp-input") ? $("auth-otp-input").value.trim() : "";
                const name = $("auth-name-input") ? $("auth-name-input").value.trim() : "Rider";
                const bike = $("auth-bike-select") ? $("auth-bike-select").value : "Hero Splendor";

                if (!otp) {
                    showToast("Please enter verification code", "error");
                    return;
                }

                try {
                    btnVerifyOtp.disabled = true;
                    btnVerifyOtp.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Verifying...`;
                    const res = await fetch("/api/auth/verify-otp", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ phone, otp, name, bike_name: bike })
                    });
                    const data = await res.json();
                    btnVerifyOtp.disabled = false;
                    btnVerifyOtp.innerHTML = `<i class="fa-solid fa-circle-check"></i> Verify & Sign In`;

                    if (data.success && data.user) {
                        currentUser = data.user;
                        localStorage.setItem("fuelwise_user", JSON.stringify(currentUser));
                        updateAuthHeaderUI();
                        if (authModal) authModal.classList.add("hidden");
                        showToast(`Welcome back, ${currentUser.name}!`, "success");

                        // If in group ride, update leader info
                        if ($("deck-fuel-slider")) {
                            refreshGroupConvoy();
                        }
                    } else {
                        showToast(data.error || "Invalid OTP code", "error");
                    }
                } catch (err) {
                    btnVerifyOtp.disabled = false;
                    btnVerifyOtp.innerHTML = `<i class="fa-solid fa-circle-check"></i> Verify & Sign In`;
                    showToast("Error verifying OTP", "error");
                }
            });
        }

        // 3. Quick Demo Login
        if (btnQuickDemo) {
            btnQuickDemo.addEventListener("click", async () => {
                try {
                    const res = await fetch("/api/auth/quick-login", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            phone: "9876543210",
                            name: "Ved (Rider A)",
                            bike_name: "Hero Splendor"
                        })
                    });
                    const data = await res.json();
                    if (data.success && data.user) {
                        currentUser = data.user;
                        localStorage.setItem("fuelwise_user", JSON.stringify(currentUser));
                        updateAuthHeaderUI();
                        if (authModal) authModal.classList.add("hidden");
                        showToast("Instant Demo Login active as Ved (Rider A)!", "success");
                    }
                } catch (err) {
                    showToast("Quick login error", "error");
                }
            });
        }

        // 4. Logout
        if (btnLogout) {
            btnLogout.addEventListener("click", () => {
                currentUser = null;
                localStorage.removeItem("fuelwise_user");
                resetAuthInputs();
                updateAuthHeaderUI();
                refreshAuthModalViews();
                showToast("Signed out. Riding in Guest Mode.", "info");
            });
        }

        // 5. Back to phone
        if (btnBackPhone) {
            btnBackPhone.addEventListener("click", () => {
                const stepPhone = $("auth-step-phone");
                const stepOtp = $("auth-step-otp");
                if (stepOtp) {
                    stepOtp.classList.add("hidden");
                    stepOtp.style.display = "none";
                }
                if (stepPhone) {
                    stepPhone.classList.remove("hidden");
                    stepPhone.style.display = "block";
                }
            });
        }

        if (!document.getElementById("auth-hidden-style")) {
            const style = document.createElement("style");
            style.id = "auth-hidden-style";
            style.textContent = ".hidden:not(.modal-overlay) { display: none !important; }";
            document.head.appendChild(style);
        }

        if (!currentUser) {
            resetAuthInputs();
        }
        updateAuthHeaderUI();
        refreshAuthModalViews();
        if (authModal) {
            authModal.classList.remove("hidden");
        }
    }

    // =========================================================================
    // 14. AUTOMATIC MOBILE GPS GEOLOCATION DETECTION SYSTEM
    // =========================================================================
    function initGeolocationSystem() {
        const btnGps = $("btn-gps-current");

        async function detectGpsPosition(isSilent = false) {
            if (!navigator.geolocation) {
                if (!isSilent) showToast("Geolocation is not supported by your browser.", "error");
                return;
            }

            const coordsStatus = $("coords-status");
            if (coordsStatus) {
                coordsStatus.innerHTML = `<i class="fa-solid fa-satellite-dish fa-spin"></i> Acquiring GPS satellites...`;
                coordsStatus.className = "badge badge-info";
            }

            navigator.geolocation.getCurrentPosition(
                async (position) => {
                    const lat = position.coords.latitude;
                    const lon = position.coords.longitude;
                    const accuracy = Math.round(position.coords.accuracy || 10);
                    userGpsCoords = { lat, lon };

                    // 1. Center main map on user's GPS position
                    if (map && typeof L !== "undefined") {
                        map.setView([lat, lon], 14, { animate: true });

                        // Create / update animated GPS pulsing marker
                        if (gpsMarker) map.removeLayer(gpsMarker);
                        if (gpsCircle) map.removeLayer(gpsCircle);

                        const gpsIcon = L.divIcon({
                            className: "gps-custom-icon",
                            html: `<div class="gps-pulse-ring" title="Your Live GPS Location"></div>`,
                            iconSize: [22, 22],
                            iconAnchor: [11, 11]
                        });

                        gpsMarker = L.marker([lat, lon], { icon: gpsIcon, zIndexOffset: 1000 }).addTo(map);
                        gpsCircle = L.circle([lat, lon], {
                            radius: Math.max(accuracy, 25),
                            color: "#00f0ff",
                            fillColor: "#00f0ff",
                            fillOpacity: 0.12,
                            weight: 1
                        }).addTo(map);
                    }

                    // 2. Reverse geocode to get human-readable location name
                    let placeName = `GPS: ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
                    try {
                        const res = await fetch(`/api/reverse-geocode?lat=${lat}&lon=${lon}`);
                        const geo = await res.json();
                        if (geo.success && geo.display_name) {
                            placeName = geo.display_name;
                        }
                    } catch (e) {
                        console.warn("Reverse geocode err:", e);
                    }

                    // 3. Auto-populate Start Location input
                    const startInput = $("start-location");
                    if (startInput) {
                        startInput.value = placeName;
                    }
                    startCoords = { lat, lon };

                    if (startMarker && map) {
                        startMarker.setLatLng([lat, lon]);
                    } else if (map && typeof L !== "undefined") {
                        const startIcon = createDivIcon("fa-flag", "linear-gradient(135deg, #10b981, #059669)", "#10b981", 32);
                        startMarker = L.marker([lat, lon], { icon: startIcon, draggable: true }).addTo(map);
                        startMarker.bindPopup(`<b><i class="fa-solid fa-location-crosshairs"></i> Your Live Location</b><br>${escapeHTML(placeName)}`).openPopup();
                    }

                    if (coordsStatus) {
                        coordsStatus.innerHTML = `<i class="fa-solid fa-circle-check"></i> GPS Locked (±${accuracy}m): ${escapeHTML(placeName)}`;
                        coordsStatus.className = "badge badge-success";
                    }

                    showToast(`📍 Exact GPS location detected: ${placeName}`, "success");

                    // Check if group convoy map is open and update its center
                    if (groupMap && typeof L !== "undefined" && groupRiders.length === 0) {
                        groupMap.setView([lat, lon], 13);
                    }
                },
                (error) => {
                    console.warn("GPS detection warning:", error.message);
                    if (coordsStatus) {
                        coordsStatus.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> GPS unavailable (using map presets)`;
                        coordsStatus.className = "badge badge-warning";
                    }
                    if (!isSilent) {
                        showToast("GPS access denied or unavailable. You can click on the map to pin your location.", "warning");
                    }
                },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
            );
        }

        if (btnGps) {
            btnGps.addEventListener("click", () => {
                detectGpsPosition(false);
            });
        }

        // Automatically detect user GPS location on application load
        setTimeout(() => {
            detectGpsPosition(true);
        }, 600);
    }

    // =========================================================================
    // 15. GROUP RIDE CONVOY SYSTEM (5 RIDERS: RIDERS A, B, C, D, E)
    // =========================================================================
    function initGroupRideSystem() {
        const btnLaunchDemo = $("btn-launch-demo-convoy");
        const btnToggleSim = $("btn-toggle-simulation");
        const btnFitBounds = $("btn-fit-convoy-bounds");
        const btnCustomModal = $("btn-custom-ride-modal");
        const btnQuickOpenConvoy = $("btn-quick-open-convoy");
        const btnBroadcastTelemetry = $("btn-broadcast-telemetry");
        const btnConvoyStation = $("btn-convoy-find-station");

        const fuelSlider = $("deck-fuel-slider");
        const fuelVal = $("deck-fuel-val");
        const speedSlider = $("deck-speed-slider");
        const speedVal = $("deck-speed-val");

        // Live slider visual updates
        if (fuelSlider && fuelVal) {
            fuelSlider.addEventListener("input", (e) => {
                fuelVal.textContent = parseFloat(e.target.value).toFixed(1);
            });
        }
        if (speedSlider && speedVal) {
            speedSlider.addEventListener("input", (e) => {
                speedVal.textContent = e.target.value;
            });
        }

        // Initialize Dedicated Convoy GIS Map
        window.initGroupMap = function() {
            const container = $("group-map");
            if (!container) return;
            if (groupMap) {
                groupMap.invalidateSize();
                return;
            }

            try {
                const center = userGpsCoords ? [userGpsCoords.lat, userGpsCoords.lon] : DEFAULT_CENTER;
                groupMap = L.map("group-map", {
                    center: center,
                    zoom: 12,
                    zoomControl: true
                });

                updateMapTileTheme();

                setTimeout(() => {
                    if (groupMap) groupMap.invalidateSize();
                }, 300);
            } catch (err) {
                console.error("Group map init error:", err);
            }
        };

        // Distinct visual marker palettes for Riders A to E
        const RIDER_PALETTE = {
            "Rider A": { color: "#00f0ff", bg: "linear-gradient(135deg, #00f0ff, #0284c7)", letter: "A", icon: "fa-crown", theme: "theme-rider-a" },
            "Rider B": { color: "#10b981", bg: "linear-gradient(135deg, #10b981, #059669)", letter: "B", icon: "fa-motorcycle", theme: "theme-rider-b" },
            "Rider C": { color: "#f59e0b", bg: "linear-gradient(135deg, #f59e0b, #d97706)", letter: "C", icon: "fa-triangle-exclamation", theme: "theme-rider-c" },
            "Rider D": { color: "#a855f7", bg: "linear-gradient(135deg, #a855f7, #7e22ce)", letter: "D", icon: "fa-motorcycle", theme: "theme-rider-d" },
            "Rider E": { color: "#ec4899", bg: "linear-gradient(135deg, #ec4899, #be185d)", letter: "E", icon: "fa-gas-pump", theme: "theme-rider-e" }
        };

        function getRiderPalette(label) {
            for (let key in RIDER_PALETTE) {
                if (label && label.includes(key)) return RIDER_PALETTE[key];
            }
            return { color: "#38bdf8", bg: "linear-gradient(135deg, #38bdf8, #0284c7)", letter: "R", icon: "fa-motorcycle", theme: "theme-rider-a" };
        }

        // Launch 5-Rider Demo Convoy
        async function launchDemoConvoy() {
            const lat = userGpsCoords ? userGpsCoords.lat : 19.0760;
            const lon = userGpsCoords ? userGpsCoords.lon : 72.8777;
            const leaderName = currentUser ? currentUser.name : "Rider A (You)";
            const leaderPhone = currentUser ? currentUser.phone : "9876543210";
            const leaderBike = currentUser ? currentUser.bike_name : "Hero Splendor";

            try {
                if (btnLaunchDemo) {
                    btnLaunchDemo.disabled = true;
                    btnLaunchDemo.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Spawning Convoy...`;
                }

                const res = await fetch("/api/group/demo-convoy", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        code: activeRideCode,
                        lat: lat,
                        lon: lon,
                        name: leaderName,
                        phone: leaderPhone,
                        bike_name: leaderBike
                    })
                });
                const data = await res.json();
                if (btnLaunchDemo) {
                    btnLaunchDemo.disabled = false;
                    btnLaunchDemo.innerHTML = `<i class="fa-solid fa-bolt"></i> Launch 5-Rider Convoy (A to E)`;
                }

                if (data.success && data.riders) {
                    groupRiders = data.riders;
                    activeRideCode = data.code;
                    const codeEl = $("active-ride-code");
                    if (codeEl) codeEl.textContent = activeRideCode;

                    renderConvoyCards(groupRiders);
                    updateConvoyMarkers(groupRiders);
                    fitConvoyBounds();
                    startGroupPolling();

                    showToast("⚡ 5-Rider Convoy (Rider A to E) is now live on map!", "success");
                }
            } catch (err) {
                if (btnLaunchDemo) {
                    btnLaunchDemo.disabled = false;
                    btnLaunchDemo.innerHTML = `<i class="fa-solid fa-bolt"></i> Launch 5-Rider Convoy (A to E)`;
                }
                showToast("Failed to launch convoy", "error");
            }
        }

        // Fetch latest convoy status from backend
        async function refreshGroupConvoy() {
            if (!activeRideCode) return;
            try {
                const res = await fetch(`/api/group/${activeRideCode}/status`);
                const data = await res.json();
                if (data.success && data.riders) {
                    groupRiders = data.riders;

                    const countEl = $("convoy-riders-count");
                    if (countEl) countEl.innerHTML = `<i class="fa-solid fa-users"></i> ${groupRiders.length} Riders Live`;

                    // Safety alert checking
                    const alertBox = $("convoy-safety-alert");
                    const alertText = $("convoy-alert-text");
                    if (data.alert) {
                        if (alertBox) alertBox.classList.remove("hidden");
                        if (alertText) alertText.textContent = data.alert;
                    } else {
                        if (alertBox) alertBox.classList.add("hidden");
                    }

                    renderConvoyCards(groupRiders);
                    updateConvoyMarkers(groupRiders);
                }
            } catch (err) {
                console.warn("Convoy status refresh err:", err);
            }
        }
        window.refreshGroupConvoy = refreshGroupConvoy;

        // Render 5 interactive telemetry cards
        function renderConvoyCards(riders) {
            const list = $("convoy-riders-list");
            if (!list) return;

            list.innerHTML = "";

            riders.forEach(r => {
                const pal = getRiderPalette(r.rider_label);
                const fuel = parseFloat(r.fuel || 0);
                const range = parseFloat(r.fuel_range || 0);
                const speed = parseFloat(r.speed || 0);
                const mileage = parseFloat(r.mileage || 50);

                // Status pill class
                let statusClass = "status-cruising";
                let statusIcon = "fa-person-biking";
                if (r.status === "Low Fuel Warning" || fuel <= 1.0) {
                    statusClass = "status-low-fuel";
                    statusIcon = "fa-triangle-exclamation";
                } else if (r.status === "Refueling") {
                    statusClass = "status-refueling";
                    statusIcon = "fa-gas-pump";
                } else if (r.status === "Stopped") {
                    statusClass = "status-stopped";
                    statusIcon = "fa-pause";
                }

                // Fuel Tank fill percent
                const tankFillPct = Math.min(100, Math.max(5, (fuel / 10.0) * 100));
                const tankBarClass = fuel <= 1.0 ? "tank-fill-warning" : "tank-fill-normal";

                const card = document.createElement("div");
                card.className = `rider-card ${pal.theme}`;
                card.id = `rider-card-${r.rider_id}`;

                card.innerHTML = `
                    <div class="rider-card-top">
                        <div class="rider-info-left">
                            <span class="rider-label-tag">
                                <i class="fa-solid ${pal.icon}"></i> ${escapeHTML(r.rider_label)}
                            </span>
                            <div>
                                <h4 class="rider-name-title">${escapeHTML(r.rider_name)}</h4>
                                <span class="rider-bike-name">${escapeHTML(r.bike_name)}</span>
                            </div>
                        </div>
                        <span class="rider-status-pill ${statusClass}">
                            <i class="fa-solid ${statusIcon}"></i> ${escapeHTML(r.status)}
                        </span>
                    </div>

                    <!-- 4-Cell Telemetry Grid -->
                    <div class="rider-telemetry-grid">
                        <div class="telemetry-cell">
                            <span class="t-label"><i class="fa-solid fa-droplet"></i> Available Fuel</span>
                            <span class="t-val ${fuel <= 1.0 ? 'danger' : 'highlight'}">${fuel.toFixed(2)} L</span>
                        </div>
                        <div class="telemetry-cell">
                            <span class="t-label"><i class="fa-solid fa-route"></i> Remaining Range</span>
                            <span class="t-val ${range <= 40 ? 'danger' : ''}">${range.toFixed(1)} km</span>
                        </div>
                        <div class="telemetry-cell">
                            <span class="t-label"><i class="fa-solid fa-gauge-high"></i> Live Speed</span>
                            <span class="t-val">${speed.toFixed(0)} km/h</span>
                        </div>
                        <div class="telemetry-cell">
                            <span class="t-label"><i class="fa-solid fa-leaf"></i> AI Mileage</span>
                            <span class="t-val">${mileage.toFixed(1)} km/L</span>
                        </div>
                    </div>

                    <!-- Visual Fuel Tank Meter -->
                    <div class="fuel-tank-meter-wrapper">
                        <div class="meter-header">
                            <span>Fuel Tank Reserve</span>
                            <span>${fuel.toFixed(2)} L left</span>
                        </div>
                        <div class="tank-bar-bg">
                            <div class="tank-fill-bar ${tankBarClass}" style="width: ${tankFillPct}%;"></div>
                        </div>
                    </div>

                    <!-- Footer: Location & Focus Map Button -->
                    <div class="rider-footer-row">
                        <span class="rider-loc-text" title="Coordinates: ${r.lat.toFixed(5)}, ${r.lon.toFixed(5)}">
                            <i class="fa-solid fa-location-dot"></i> Lat: ${r.lat.toFixed(4)}, Lon: ${r.lon.toFixed(4)}
                        </span>
                        <button type="button" class="btn-focus-rider" data-rider-id="${escapeHTML(r.rider_id)}" data-lat="${r.lat}" data-lon="${r.lon}">
                            <i class="fa-solid fa-crosshairs"></i> Focus
                        </button>
                    </div>
                `;

                // Wire Focus button
                const focusBtn = card.querySelector(".btn-focus-rider");
                if (focusBtn) {
                    focusBtn.addEventListener("click", () => {
                        focusRiderOnMap(r.rider_id, r.lat, r.lon);
                    });
                }

                list.appendChild(card);
            });
        }

        // Update markers on Leaflet Group Map
        function updateConvoyMarkers(riders) {
            initGroupMap();
            if (!groupMap || typeof L === "undefined") return;

            riders.forEach(r => {
                const pal = getRiderPalette(r.rider_label);
                const fuel = parseFloat(r.fuel || 0);
                const range = parseFloat(r.fuel_range || 0);

                const iconHtml = `
                    <div class="rider-map-pin" style="background:${pal.bg}; box-shadow:0 0 14px ${pal.color};">
                        <span class="pin-label-letter">${pal.letter}</span>
                        <span class="pin-icon-sub"><i class="fa-solid ${pal.icon}"></i></span>
                    </div>
                `;

                const markerIcon = L.divIcon({
                    className: "custom-rider-div-icon",
                    html: iconHtml,
                    iconSize: [36, 36],
                    iconAnchor: [18, 18]
                });

                const popupHtml = `
                    <div style="font-family:'Inter',sans-serif; min-width:180px;">
                        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
                            <strong style="color:${pal.color}; font-size:14px;">${escapeHTML(r.rider_label)}</strong>
                            <span style="font-size:11px; padding:2px 6px; border-radius:10px; background:rgba(255,255,255,0.1); font-weight:700;">${escapeHTML(r.status)}</span>
                        </div>
                        <div style="font-size:13px; font-weight:600; margin-bottom:4px;">${escapeHTML(r.rider_name)}</div>
                        <div style="font-size:11px; color:#94a3b8; margin-bottom:8px;">${escapeHTML(r.bike_name)}</div>
                        <div style="background:rgba(0,0,0,0.25); border-radius:6px; padding:6px 8px; font-size:12px; line-height:1.6;">
                            <div><i class="fa-solid fa-droplet" style="color:${pal.color}; width:16px;"></i> Fuel: <strong>${fuel.toFixed(2)} L</strong></div>
                            <div><i class="fa-solid fa-route" style="color:#10b981; width:16px;"></i> Range: <strong>${range.toFixed(1)} km</strong></div>
                            <div><i class="fa-solid fa-gauge" style="color:#f59e0b; width:16px;"></i> Speed: <strong>${parseFloat(r.speed).toFixed(0)} km/h</strong></div>
                        </div>
                    </div>
                `;

                if (groupMarkers[r.rider_id]) {
                    groupMarkers[r.rider_id].setLatLng([r.lat, r.lon]);
                    groupMarkers[r.rider_id].setPopupContent(popupHtml);
                } else {
                    const marker = L.marker([r.lat, r.lon], { icon: markerIcon }).addTo(groupMap);
                    marker.bindPopup(popupHtml);
                    groupMarkers[r.rider_id] = marker;
                }
            });
        }

        // Focus map to rider
        function focusRiderOnMap(riderId, lat, lon) {
            initGroupMap();
            if (groupMap) {
                groupMap.setView([lat, lon], 15, { animate: true });
                if (groupMarkers[riderId]) {
                    groupMarkers[riderId].openPopup();
                }
            }
        }

        // Fit map view to include all 5 riders
        function fitConvoyBounds() {
            if (!groupMap || typeof L === "undefined" || groupRiders.length === 0) return;
            const points = groupRiders.map(r => [r.lat, r.lon]);
            const bounds = L.latLngBounds(points);
            groupMap.fitBounds(bounds, { padding: [60, 60] });
        }

        // Start background polling every 3 seconds
        function startGroupPolling() {
            if (groupPollInterval) clearInterval(groupPollInterval);
            groupPollInterval = setInterval(refreshGroupConvoy, 3000);
        }

        // Toggle real-time convoy simulation
        function toggleConvoySimulation() {
            isSimulating = !isSimulating;
            const simText = $("sim-btn-text");
            const simIcon = $("sim-icon");

            if (isSimulating) {
                if (simText) simText.textContent = "Pause Simulation";
                if (simIcon) simIcon.className = "fa-solid fa-pause";
                if (btnToggleSim) btnToggleSim.classList.add("btn-primary");

                showToast("Real-time convoy simulation started (live movement & fuel consumption)", "success");

                if (groupSimInterval) clearInterval(groupSimInterval);
                groupSimInterval = setInterval(async () => {
                    try {
                        const res = await fetch(`/api/group/${activeRideCode}/simulate-step`, { method: "POST" });
                        const data = await res.json();
                        if (data.success && data.riders) {
                            groupRiders = data.riders;
                            renderConvoyCards(groupRiders);
                            updateConvoyMarkers(groupRiders);
                        }
                    } catch (e) {
                        console.warn("Simulation step err:", e);
                    }
                }, 3000);
            } else {
                if (simText) simText.textContent = "Simulate Movement";
                if (simIcon) simIcon.className = "fa-solid fa-play";
                if (btnToggleSim) btnToggleSim.classList.remove("btn-primary");

                if (groupSimInterval) {
                    clearInterval(groupSimInterval);
                    groupSimInterval = null;
                }
                showToast("Convoy simulation paused", "info");
            }
        }

        // Broadcast active user's (Rider A) live telemetry
        async function broadcastTelemetry() {
            const fuel = fuelSlider ? parseFloat(fuelSlider.value) : 2.5;
            const speed = speedSlider ? parseFloat(speedSlider.value) : 52.0;
            const riderId = currentUser ? currentUser.phone : "9876543210";
            const bike = currentUser ? currentUser.bike_name : "Hero Splendor";

            try {
                if (btnBroadcastTelemetry) {
                    btnBroadcastTelemetry.disabled = true;
                    btnBroadcastTelemetry.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Broadcasting...`;
                }

                const res = await fetch(`/api/group/${activeRideCode}/update`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        rider_id: riderId,
                        fuel: fuel,
                        speed: speed,
                        bike_name: bike
                    })
                });
                const data = await res.json();
                if (btnBroadcastTelemetry) {
                    btnBroadcastTelemetry.disabled = false;
                    btnBroadcastTelemetry.innerHTML = `<i class="fa-solid fa-tower-broadcast"></i> Broadcast Live Telemetry to Group`;
                }

                if (data.success) {
                    showToast(`Broadcast sent: ${fuel}L Fuel, ${speed} km/h speed`, "success");
                    refreshGroupConvoy();
                } else {
                    showToast("Failed to broadcast telemetry", "error");
                }
            } catch (err) {
                if (btnBroadcastTelemetry) {
                    btnBroadcastTelemetry.disabled = false;
                    btnBroadcastTelemetry.innerHTML = `<i class="fa-solid fa-tower-broadcast"></i> Broadcast Live Telemetry to Group`;
                }
                showToast("Broadcast network error", "error");
            }
        }

        // Event listeners
        if (btnLaunchDemo) {
            btnLaunchDemo.addEventListener("click", launchDemoConvoy);
        }
        if (btnToggleSim) {
            btnToggleSim.addEventListener("click", toggleConvoySimulation);
        }
        if (btnFitBounds) {
            btnFitBounds.addEventListener("click", fitConvoyBounds);
        }
        if (btnBroadcastTelemetry) {
            btnBroadcastTelemetry.addEventListener("click", broadcastTelemetry);
        }

        // Quick open convoy from analyze tab
        if (btnQuickOpenConvoy) {
            btnQuickOpenConvoy.addEventListener("click", () => {
                const groupTabBtn = $("nav-tab-group");
                if (groupTabBtn) groupTabBtn.click();
                setTimeout(() => {
                    if (groupRiders.length === 0) {
                        launchDemoConvoy();
                    } else {
                        fitConvoyBounds();
                    }
                }, 300);
            });
        }

        // Convoy alert action: route convoy to nearest station
        if (btnConvoyStation) {
            btnConvoyStation.addEventListener("click", () => {
                showToast("Routing convoy to nearest corridor station...", "info");
                const analyzeTabBtn = document.querySelector(".nav-btn[data-tab='tab-analyze']");
                if (analyzeTabBtn) analyzeTabBtn.click();
                const findStBtn = $("find-stations-btn");
                if (findStBtn) findStBtn.click();
            });
        }

        // Custom Ride Modal Wiring
        const customModal = $("custom-ride-modal");
        const btnCloseCustom = $("btn-close-custom-ride-modal");
        const subnavCreate = $("subnav-create");
        const subnavJoin = $("subnav-join");
        const createPane = $("subnav-create-pane");
        const joinPane = $("subnav-join-pane");

        if (btnCustomModal && customModal) {
            btnCustomModal.addEventListener("click", () => {
                customModal.classList.remove("hidden");
            });
        }
        if (btnCloseCustom && customModal) {
            btnCloseCustom.addEventListener("click", () => {
                customModal.classList.add("hidden");
            });
        }

        if (subnavCreate && subnavJoin) {
            subnavCreate.addEventListener("click", () => {
                subnavCreate.classList.add("active");
                subnavJoin.classList.remove("active");
                if (createPane) createPane.classList.remove("hidden");
                if (joinPane) joinPane.classList.add("hidden");
            });
            subnavJoin.addEventListener("click", () => {
                subnavJoin.classList.add("active");
                subnavCreate.classList.remove("active");
                if (joinPane) joinPane.classList.remove("hidden");
                if (createPane) createPane.classList.add("hidden");
            });
        }

        const btnSubmitCreate = $("btn-submit-create-group");
        if (btnSubmitCreate) {
            btnSubmitCreate.addEventListener("click", async () => {
                const name = $("create-ride-name") ? $("create-ride-name").value.trim() : "Convoy";
                const code = $("create-ride-code") ? $("create-ride-code").value.trim() : "";
                const lat = userGpsCoords ? userGpsCoords.lat : 19.0760;
                const lon = userGpsCoords ? userGpsCoords.lon : 72.8777;

                try {
                    const res = await fetch("/api/group/create", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            name,
                            code,
                            lat,
                            lon,
                            phone: currentUser ? currentUser.phone : "9876543210",
                            rider_name: currentUser ? currentUser.name : "Leader",
                            bike_name: currentUser ? currentUser.bike_name : "Hero Splendor"
                        })
                    });
                    const data = await res.json();
                    if (data.success) {
                        activeRideCode = data.code;
                        const codeEl = $("active-ride-code");
                        if (codeEl) codeEl.textContent = activeRideCode;
                        if (customModal) customModal.classList.add("hidden");
                        showToast(`Group ride ${activeRideCode} created!`, "success");
                        refreshGroupConvoy();
                        startGroupPolling();
                    }
                } catch (e) {
                    showToast("Failed to create ride", "error");
                }
            });
        }

        const btnSubmitJoin = $("btn-submit-join-group");
        if (btnSubmitJoin) {
            btnSubmitJoin.addEventListener("click", async () => {
                const code = $("join-ride-code") ? $("join-ride-code").value.trim().toUpperCase() : "";
                const name = $("join-rider-name") ? $("join-rider-name").value.trim() : "Rider";
                const lat = userGpsCoords ? userGpsCoords.lat : 19.0760;
                const lon = userGpsCoords ? userGpsCoords.lon : 72.8777;

                if (!code) {
                    showToast("Please enter group code", "error");
                    return;
                }

                try {
                    const res = await fetch("/api/group/join", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            code,
                            rider_name: name,
                            lat,
                            lon,
                            phone: currentUser ? currentUser.phone : `rider_${Math.floor(Math.random() * 8999 + 1000)}`,
                            bike_name: currentUser ? currentUser.bike_name : "Hero Splendor"
                        })
                    });
                    const data = await res.json();
                    if (data.success) {
                        activeRideCode = data.code;
                        const codeEl = $("active-ride-code");
                        if (codeEl) codeEl.textContent = activeRideCode;
                        if (customModal) customModal.classList.add("hidden");
                        showToast(`Joined convoy ${activeRideCode}!`, "success");
                        refreshGroupConvoy();
                        startGroupPolling();
                    } else {
                        showToast(data.error || "Failed to join group", "error");
                    }
                } catch (e) {
                    showToast("Join group network error", "error");
                }
            });
        }

        // Auto-launch demo convoy on initial visit so user immediately sees all 5 riders
        setTimeout(() => {
            launchDemoConvoy();
        }, 1200);
    }

    // =========================================================================
    // 16. DEFENSIVE APP INITIALIZATION
    // =========================================================================
    try {
        initMap();
    } catch (e) {
        console.error("initMap failure:", e);
    }

    try {
        initAuthSystem();
    } catch (e) {
        console.error("initAuthSystem failure:", e);
    }

    try {
        initGeolocationSystem();
    } catch (e) {
        console.error("initGeolocationSystem failure:", e);
    }

    try {
        initGroupRideSystem();
    } catch (e) {
        console.error("initGroupRideSystem failure:", e);
    }

    try {
        loadBikes();
    } catch (e) {
        console.error("loadBikes failure:", e);
    }

    try {
        loadTrips();
    } catch (e) {
        console.error("loadTrips failure:", e);
    }
});