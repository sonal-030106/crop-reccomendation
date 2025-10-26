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

    // return full parsed JSON so caller can read growing_tips and optimal_conditions
    const result = await response.json();
    return result;
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
        
        // Update result section
        document.getElementById('cropName').innerText = json.recommendation || 'No specific crop recommended';
        document.getElementById('explanation').innerText = json.explanation || 'No explanation available';

        // Show optimal condition matches if provided by API
        const oc = json.optimal_conditions || null;

        // Soil: show Yes/No if oc provides boolean, otherwise show the raw soil value
        if (oc && typeof oc.soil !== 'undefined') {
            const soilMatchEl = document.getElementById('soilMatch');
            soilMatchEl.innerText = (oc.soil === true) ? 'Yes' : (oc.soil === false ? 'No' : data.soil);
        } else {
            document.getElementById('soilMatch').innerText = data.soil;
        }

        // pH / temp / humidity: show value and whether it's OK (if oc boolean exists)
        const setCheckText = (elId, value, okFlag) => {
            const el = document.getElementById(elId);
            if (typeof okFlag !== 'undefined' && okFlag !== null) {
                el.innerText = `${value} ${okFlag === true ? '(OK)' : '(Not ideal)'}`;
            } else {
                el.innerText = `${value}`;
            }
        };

        setCheckText('phMatch', data.ph, oc ? oc.ph : null);
        setCheckText('tempMatch', `${data.temp}°C`, oc ? oc.temp : null);
        setCheckText('humidityMatch', `${data.humidity}%`, oc ? oc.humidity : null);

        // Optionally show overall match score (insert a small element above explanation)
        if (oc && typeof oc.overall_match !== 'undefined' && oc.overall_match !== null) {
            let overallEl = document.getElementById('overallMatch');
            if (!overallEl) {
                overallEl = document.createElement('div');
                overallEl.id = 'overallMatch';
                overallEl.className = 'overall-match';
                const explanationEl = document.getElementById('explanation');
                explanationEl.parentNode.insertBefore(overallEl, explanationEl);
            }
            const pct = Math.round(oc.overall_match * 100);
            overallEl.innerText = `Overall match: ${pct}%`;
        }

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