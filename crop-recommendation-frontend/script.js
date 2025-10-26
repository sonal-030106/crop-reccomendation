// --------------------
// 1️⃣ API Gateway URL
// --------------------
const apiUrl = "https://emmnb4eed8.execute-api.us-east-1.amazonaws.com/dev/recommendation"; // <-- Production endpoint

// --------------------
// 2️⃣ Function to call Lambda API
// --------------------
async function getRecommendation(data) {
    const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
    });

    // API Gateway + Lambda sometimes return the Lambda proxy wrapper:
    // { statusCode, headers, body: "{...}" }
    // Parse response text and detect that case so callers always get the inner JSON object.
    const text = await response.text();
    let parsed = null;
    try {
        parsed = text ? JSON.parse(text) : {};
    } catch (e) {
        // Not JSON at all
        parsed = { __raw: text };
    }

    // If the parsed object looks like the Lambda proxy wrapper and has a string `body`, parse it.
    if (parsed && typeof parsed === 'object' && typeof parsed.body === 'string') {
        try {
            const inner = JSON.parse(parsed.body);
            return inner;
        } catch (e) {
            // body not JSON; return wrapper so caller can inspect __raw
            return parsed;
        }
    }

    return parsed;
}

// --------------------
// 3️⃣ Validation rules
// --------------------
const VALIDATION_RULES = {
    ph: { min: 0, max: 14 },
    n: { min: 0, max: 1000 },
    p: { min: 0, max: 1000 },
    k: { min: 0, max: 1000 },
    rain: { min: 0, max: 10000 },
    temp: { min: -20, max: 50 },
    humidity: { min: 0, max: 100 }
};

// --------------------
// History API (save recommendations)
// --------------------
const historyApiUrl = "https://emmnb4eed8.execute-api.us-east-1.amazonaws.com/dev/history"; // set your history endpoint

// store last result so Save button can send it
let lastResult = null;

// --------------------
// 4️⃣ Input validation
// --------------------
function validateInput(input, rules) {
    const value = parseFloat(input.value);
    if (rules[input.name]) {
        const { min, max } = rules[input.name];
        if (value < min || value > max) {
            input.setCustomValidity(`Value must be between ${min} and ${max}`);
            return false;
        }
    }
    input.setCustomValidity('');
    return true;
}

// Add real-time validation
document.querySelectorAll('input[type="number"]').forEach(input => {
    input.addEventListener('input', () => validateInput(input, VALIDATION_RULES));
});

// --------------------
// 5️⃣ Form submission
// --------------------
document.getElementById('cropForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const loadingElement = document.getElementById('loading');
    const resultElement = document.getElementById('result');

    // Validate all inputs
    let isValid = true;
    form.querySelectorAll('input[type="number"]').forEach(input => {
        if (!validateInput(input, VALIDATION_RULES)) {
            isValid = false;
        }
    });

    if (!isValid) {
        alert('Please check the input values and try again.');
        return;
    }

    // Prepare data
    const data = {
        soil: form.soil.value.trim(),
        ph: parseFloat(form.ph.value),
        n: parseFloat(form.n.value),
        p: parseFloat(form.p.value),
        k: parseFloat(form.k.value),
        rain: parseFloat(form.rain.value),
        temp: parseFloat(form.temp.value),
        humidity: parseFloat(form.humidity.value)
    };

    // Show loading state
    loadingElement.style.display = 'block';
    resultElement.style.display = 'none';

    try {
        const json = await getRecommendation(data);
        console.debug('API response JSON:', json);
        // Save last result (for Save to History action)
        lastResult = {
            timestamp: new Date().toISOString(),
            input: data,
            result: json,
            name: form.name ? form.name.value : undefined,
            location: form.location ? form.location.value : undefined
        };

        // expose raw JSON for troubleshooting in the UI (creates #apiResponse if not present)
        try {
            let dbg = document.getElementById('apiResponse');
            if (!dbg) {
                dbg = document.createElement('pre');
                dbg.id = 'apiResponse';
                dbg.style.cssText = 'background:#111;color:#0f0;padding:8px;border-radius:6px;max-height:200px;overflow:auto;margin-top:12px;font-size:12px;';
                const resultContainer = document.getElementById('result');
                resultContainer.parentNode.insertBefore(dbg, resultContainer.nextSibling);
            }
            dbg.textContent = JSON.stringify(json, null, 2);
        } catch (e) {
            console.warn('Failed to render debug output', e);
        }
        
        // Update result section
        document.getElementById('cropName').innerText = json.recommendation || 'No specific crop recommended';
        document.getElementById('explanation').innerText = json.explanation || 'No explanation available';

        // Render `details` object (if provided) in a readable UI block
        // Be defensive: `details` may be an object, a JSON string, or nested differently.
        let details = json.details || null;
        try {
            if (typeof details === 'string') {
                // try to parse stringified JSON
                try { details = JSON.parse(details); } catch (e) { console.debug('details is string but not JSON', e); }
            }
            // sometimes model returns details nested, try common fallbacks
            if (!details && json.details === undefined && json.body) {
                // API wrapper case: body may contain the object
                try {
                    const b = (typeof json.body === 'string') ? JSON.parse(json.body) : json.body;
                    details = b.details || b.result || b.data || null;
                } catch (e) { /* ignore */ }
            }
        } catch (e) {
            console.warn('Error normalizing details', e);
            details = details || null;
        }
        try {
            let detailsEl = document.getElementById('detailsPanel');
            if (!detailsEl) {
                detailsEl = document.createElement('div');
                detailsEl.id = 'detailsPanel';
                detailsEl.className = 'details-panel';
                // insert below the explanation
                const explanationEl = document.getElementById('explanation');
                explanationEl.parentNode.insertBefore(detailsEl, explanationEl.nextSibling);
            }

            if (details) {
                // Build nutrient list if present
                let nutrients = details.nutrient_requirements || details.nutrientRequirements || details.nutrients || {};
                if (typeof nutrients === 'string') {
                    try { nutrients = JSON.parse(nutrients); } catch (e) { /* keep string */ }
                }
                let nutrientsHtml = '';
                const nutrientKeys = Object.keys(nutrients || {});
                if (nutrientKeys.length) {
                    nutrientsHtml = '<ul class="nutrient-list">';
                    nutrientKeys.forEach(k => {
                        nutrientsHtml += `<li><strong>${k.replace(/_/g,' ')}</strong>: ${nutrients[k]}</li>`;
                    });
                    nutrientsHtml += '</ul>';
                }

                const soilType = details.optimal_soil_type || details.optimalSoilType || details.optimal_soil || '—';
                const pHRange = details.optimal_pH_range || details.optimalPHRange || details.optimal_pH || '—';
                const rainReq = details.rainfall_requirement || details.rainfallRequirement || details.rainfall || '—';
                const tempRange = details.temperature_range || details.temperatureRange || details.temp_range || '—';
                const humidityRange = details.humidity_range || details.humidityRange || details.humidity || '—';

                detailsEl.innerHTML = `
                    <div class="details-header"><strong>Recommended Growing Conditions</strong></div>
                    <div class="details-grid">
                        <div class="detail-item"><span class="label">Soil</span><span class="value">${soilType}</span></div>
                        <div class="detail-item"><span class="label">pH Range</span><span class="value">${pHRange}</span></div>
                        <div class="detail-item"><span class="label">Temperature</span><span class="value">${tempRange}</span></div>
                        <div class="detail-item"><span class="label">Humidity</span><span class="value">${humidityRange}</span></div>
                        <div class="detail-item full"><span class="label">Rainfall</span><span class="value">${rainReq}</span></div>
                        <div class="detail-item full nutrients"><span class="label">Nutrient requirements</span><span class="value">${nutrientsHtml}</span></div>
                    </div>
                `;
            } else {
                // remove/clear panel if no details
                detailsEl.innerHTML = '';
            }
        } catch (e) {
            console.warn('Failed to render details panel', e);
        }

        // (Optimal conditions summary removed) 

        // Use growing_tips from API if present; otherwise fall back to client-side example tips
        const tipsContainer = document.getElementById('growingTips');
        tipsContainer.innerHTML = '';

        const apiTips = Array.isArray(json.growing_tips) ? json.growing_tips : (Array.isArray(json.growingTips) ? json.growingTips : []);
        const fallbackTips = [
            `Optimal planting season for ${json.recommendation} in your area`,
            'Recommended irrigation schedule based on your rainfall',
            'Specific fertilizer recommendations for your soil type',
            'Pest management suggestions for your region'
        ];

        const finalTips = apiTips.length ? apiTips : fallbackTips;
        finalTips.forEach(tip => {
            const li = document.createElement('li');
            li.textContent = tip;
            tipsContainer.appendChild(li);
        });
        
        // Hide loading and show result with animation
        loadingElement.style.display = 'none';
        resultElement.style.display = 'block';

    } catch (err) {
        loadingElement.style.display = 'none';
        const errorMessage = `Error: ${err.message}. Please try again later.`;
        alert(errorMessage);
        console.error('API Error:', err);
    }
});

// Add sample data function (for testing)
function fillSampleData() {
    const sampleData = {
        soil: 'Clay Loam',
        ph: 6.5,
        n: 120,
        p: 80,
        k: 200,
        rain: 1200,
        temp: 25,
        humidity: 65
    };

    Object.keys(sampleData).forEach(key => {
        const input = document.querySelector(`input[name="${key}"]`);
        if (input) {
            input.value = sampleData[key];
        }
    });
}

// Mobile Navigation Toggle
const navToggle = document.querySelector('.nav-toggle');
const navLinks = document.querySelector('.nav-links');

navToggle.addEventListener('click', () => {
    navLinks.classList.toggle('active');
});

// Close mobile menu when clicking outside
document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768 && 
        !e.target.closest('.nav-links') && 
        !e.target.closest('.nav-toggle') && 
        navLinks.classList.contains('active')) {
        navLinks.classList.remove('active');
    }
});

// Optional: Add keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + Enter to submit form
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        document.querySelector('button[type="submit"]').click();
    }
});

// --------------------
// Save to History (called by Save button in UI)
// --------------------
async function saveToHistory() {
    if (!lastResult) {
        alert('No recommendation to save yet. Please get a recommendation first.');
        return;
    }

    const btn = document.querySelector('.secondary-btn[onclick="saveToHistory()"]');
    if (btn) btn.disabled = true;

    try {
        const payload = {
            timestamp: lastResult.timestamp,
            name: lastResult.name,
            location: lastResult.location,
            input: lastResult.input,
            recommendation: lastResult.result.recommendation,
            explanation: lastResult.result.explanation,
            details: lastResult.result.details || {},
            growing_tips: lastResult.result.growing_tips || lastResult.result.growingTips || []
        };

        const res = await fetch(historyApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        // Read response text and handle both direct JSON and API Gateway proxy wrapper
        const text = await res.text();
        let parsed = null;
        try {
            parsed = text ? JSON.parse(text) : {};
        } catch (e) {
            parsed = { __raw: text };
        }

        // If API Gateway proxy wrapper, the useful payload is often in parsed.body
        let bodyObj = parsed;
        if (parsed && typeof parsed === 'object' && typeof parsed.body === 'string') {
            try {
                bodyObj = JSON.parse(parsed.body);
            } catch (e) {
                bodyObj = { message: parsed.body };
            }
        }

        if (!res.ok) {
            throw new Error(`History API error: ${res.status} ${JSON.stringify(bodyObj)}`);
        }

        const savedId = bodyObj.id || bodyObj.insertId || bodyObj.message || null;
        alert('Saved to history' + (savedId ? ` (id: ${savedId})` : ''));
    } catch (err) {
        console.error('Save history failed', err);
        alert('Failed to save history: ' + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}