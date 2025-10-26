import os
import json
import re
from typing import Any, Dict, Optional, List
from huggingface_hub import InferenceClient
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# -----------------------------
# HF Client
# -----------------------------
HF_TOKEN = os.environ.get("HF_TOKEN")
HF_MODEL = os.environ.get("HF_MODEL") or "openai/gpt-oss-120b"

client = InferenceClient(api_key=HF_TOKEN)

# -----------------------------
# Prompt template
# -----------------------------
PROMPT_TEMPLATE = '''You are an agricultural advisor. Given farm parameters, recommend the single best crop and return a JSON object only (no extra text) with these keys:
- recommendation (string),
- explanation (string),
- confidence (0-1 float),
- details (object; optional, may include preferred ranges),
- growing_tips (array of strings; optional).

Return valid JSON only.

Input:
SOIL: {soil}
pH: {ph}
N: {n}
P: {p}
K: {k}
RAINFALL_MM: {rain}
TEMPERATURE_C: {temp}
HUMIDITY_PERCENT: {humidity}
LOCATION: {location}
'''

# -----------------------------
# Simple crop preference DB (fallback)
# -----------------------------
PREFERRED_CONDITIONS = {
    "wheat": {
        "soils": ["loamy", "black", "clay"],
        "ph_min": 6.0, "ph_max": 7.5,
        "temp_min": 10, "temp_max": 25,
        "humidity_min": 40, "humidity_max": 75,
        "rain_min": 300, "rain_max": 900
    },
    "rice": {
        "soils": ["clay", "loamy"],
        "ph_min": 5.0, "ph_max": 6.8,
        "temp_min": 20, "temp_max": 35,
        "humidity_min": 70, "humidity_max": 100,
        "rain_min": 1200, "rain_max": 4000
    },
    "maize": {
        "soils": ["loamy", "sandy"],
        "ph_min": 5.5, "ph_max": 7.5,
        "temp_min": 18, "temp_max": 32,
        "humidity_min": 50, "humidity_max": 85,
        "rain_min": 500, "rain_max": 1500
    },
    "sorghum": {
        "soils": ["loamy", "clay"],
        "ph_min": 5.5, "ph_max": 7.0,
        "temp_min": 20, "temp_max": 35,
        "humidity_min": 40, "humidity_max": 75,
        "rain_min": 300, "rain_max": 1500
    }
}

# -----------------------------
# Helpers
# -----------------------------
def build_prompt(payload: Dict[str, Any]) -> str:
    return PROMPT_TEMPLATE.format(
        soil=payload.get("soil","unknown"),
        ph=payload.get("ph","unknown"),
        n=payload.get("n","unknown"),
        p=payload.get("p","unknown"),
        k=payload.get("k","unknown"),
        rain=payload.get("rain","unknown"),
        temp=payload.get("temp","unknown"),
        humidity=payload.get("humidity","unknown"),
        location=payload.get("location","unknown")
    )

def extract_json_from_text(text: str) -> Optional[Dict[str, Any]]:
    try:
        return json.loads(text)
    except Exception:
        m = re.search(r"(\{[\s\S]*\})", text)
        if m:
            try:
                return json.loads(m.group(1))
            except Exception:
                return None
    return None

def make_cors_response(status: int, body: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "statusCode": status,
        "headers": {"Access-Control-Allow-Origin":"*","Content-Type":"application/json"},
        "body": json.dumps(body)
    }

def _safe_float(val: Any, default: Optional[float]=None) -> Optional[float]:
    try:
        return float(val)
    except Exception:
        return default

def details_from_pref(crop: Optional[str]) -> Dict[str, Any]:
    """Map PREFERRED_CONDITIONS entry into the details shape expected by frontend."""
    if not crop:
        return {}
    key = crop.strip().lower()
    pref = PREFERRED_CONDITIONS.get(key)
    if not pref:
        return {}
    nutrients = {
        "nitrogen": "80–120 kg/ha",
        "phosphorus": "30–50 kg/ha",
        "potassium": "30–60 kg/ha"
    }
    # Build fields
    soil = ", ".join(pref.get("soils", []))
    ph_range = f"{pref.get('ph_min')}–{pref.get('ph_max')}"
    temp_range = f"{pref.get('temp_min')}–{pref.get('temp_max')} °C"
    humidity_range = f"{pref.get('humidity_min')}–{pref.get('humidity_max')} %"
    rain = f"{pref.get('rain_min')}–{pref.get('rain_max')} mm"
    return {
        "optimal_soil_type": soil,
        "optimal_pH_range": ph_range,
        "nutrient_requirements": nutrients,
        "rainfall_requirement": rain,
        "temperature_range": temp_range,
        "humidity_range": humidity_range
    }

# -----------------------------
# Lambda handler
# -----------------------------
def lambda_handler(event, context):
    # Handle preflight CORS
    if event.get("httpMethod") == "OPTIONS":
        return {
            "statusCode": 200,
            "headers": {
                "Access-Control-Allow-Origin":"*",
                "Access-Control-Allow-Headers":"Content-Type,Authorization",
                "Access-Control-Allow-Methods":"POST,OPTIONS"
            },
            "body": ""
        }

    # Parse input (handle both API Gateway proxy and plain JSON)
    try:
        if "body" in event and event["body"]:
            body = json.loads(event["body"])
        else:
            body = event
    except Exception:
        return make_cors_response(400, {"error":"Invalid JSON in request body"})

    # Validate required fields
    required = ["soil","ph","n","p","k","rain","temp","humidity"]
    for r in required:
        if r not in body:
            return make_cors_response(400, {"error": f"Missing field: {r}"})

    prompt = build_prompt(body)

    # Call Hugging Face chat model
    try:
        completion = client.chat.completions.create(
            model=HF_MODEL,
            messages=[{"role":"user","content": prompt}]
        )
        raw_text = completion.choices[0].message["content"]
    except Exception as exc:
        logger.exception("Model API error")
        return make_cors_response(502, {"error":"Model API error", "detail": str(exc)})

    # Extract JSON
    model_json = extract_json_from_text(raw_text)
    if not model_json:
        short = raw_text if len(raw_text) < 2000 else raw_text[:1900] + "..."
        return make_cors_response(502, {"error":"Could not parse JSON from model output", "model_output": short})

    # Normalize response
    recommendation = model_json.get("recommendation")
    explanation = model_json.get("explanation")
    confidence = model_json.get("confidence")
    details = model_json.get("details", {}) or {}
    model_tips = model_json.get("growing_tips", model_json.get("growingTips", [])) or []

    # If model didn't provide rich details, supplement from fallback DB
    if not details:
        details = details_from_pref(recommendation)

    # Merge model tips + generated tips (avoid duplicates)
    try:
        generated = []
        # simple heuristics similar to earlier helper
        n = _safe_float(body.get("n"))
        p = _safe_float(body.get("p"))
        k = _safe_float(body.get("k"))
        rain = _safe_float(body.get("rain"))
        soil = (body.get("soil") or "").lower()
        if n is not None and n < 50:
            generated.append("Soil nitrogen is low — apply a nitrogen-rich fertilizer or use legume rotations.")
        if p is not None and p < 30:
            generated.append("Phosphorus is low — apply phosphorus fertilizer at planting.")
        if k is not None and k < 80:
            generated.append("Potassium is low — consider potash application.")
        if rain is not None and rain < 300:
            generated.append("Low rainfall — plan supplemental irrigation and mulching.")
        if "sandy" in soil:
            generated.append("Sandy soils drain quickly; add organic matter and irrigate appropriately.")
        generated.append("Rotate crops and monitor pests for integrated pest management.")

        merged = []
        for t in model_tips:
            if t and t not in merged:
                merged.append(t)
        for t in generated:
            if t and t not in merged:
                merged.append(t)
    except Exception:
        merged = model_tips

    response_body = {
        "recommendation": recommendation,
        "explanation": explanation,
        "confidence": confidence,
        "details": details,
        "growing_tips": merged
    }

    return make_cors_response(200, response_body)