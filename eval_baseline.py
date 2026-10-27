import json
import time
import math
import urllib.request
import urllib.error
from pathlib import Path

URL = (
    "https://campus-maintenance.advising-platform.workers.dev"
    "/api/maintenance-requests/decision"
)

cases = json.loads(Path("eval-cases.json").read_text(encoding="utf-8"))

results = []

for case in cases:
    case_id = case["case_id"]
    expected = case["expected_decision"]
    payload = json.dumps(case["input"]).encode("utf-8")

    request = urllib.request.Request(
        URL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "campus-maintenance-eval/1.0",
        },
        method="POST",
    )

    start = time.perf_counter()
    status = None
    raw = ""
    request_error = None

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            status = response.status
            raw = response.read().decode("utf-8", errors="replace")

    except urllib.error.HTTPError as error:
        status = error.code
        raw = error.read().decode("utf-8", errors="replace")

    except Exception as error:
        request_error = str(error)

    latency = round((time.perf_counter() - start) * 1000, 2)

    # Handle connection, timeout, and other request errors.
    if request_error is not None:
        result = {
            "case_id": case_id,
            "expected": expected,
            "http_status": status,
            "actual": None,
            "latency_ms": latency,
            "pass": False,
            "error": request_error,
        }

        results.append(result)
        print(f"{case_id}: REQUEST ERROR | {latency} ms")
        print("Error:", request_error)
        print()
        continue

    # Parse JSON safely instead of crashing on empty/HTML responses.
    try:
        body = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        result = {
            "case_id": case_id,
            "expected": expected,
            "http_status": status,
            "actual": {"raw_response": raw[:1000]},
            "latency_ms": latency,
            "pass": False,
            "error": "Response was empty or not valid JSON",
        }

        results.append(result)
        print(f"{case_id}: INVALID JSON | HTTP {status} | {latency} ms")
        print("Raw response:", repr(raw[:500]))
        print()
        continue

    # Compare actual output against the fixed expected result.
    if "http_status" in expected:
        passed = (
            status == expected["http_status"]
            and body.get("error") == expected.get("error")
            and body.get("field") == expected.get("field")
        )
    else:
        actual = body.get("recommendation", {})

        passed = (
            status == 200
            and actual.get("category") == expected.get("category")
            and actual.get("urgency_score") == expected.get("urgency_score")
            and actual.get("urgency_level") == expected.get("urgency_level")
            and actual.get("needs_human_review") == expected.get("needs_human_review")
        )

    result = {
        "case_id": case_id,
        "expected": expected,
        "http_status": status,
        "actual": body,
        "latency_ms": latency,
        "pass": passed,
    }

    results.append(result)

    print(
        f"{case_id}: {'PASS' if passed else 'FAIL'}" f" | HTTP {status} | {latency} ms"
    )

    if not passed:
        print("Expected:", json.dumps(expected, ensure_ascii=False))
        print("Actual:", json.dumps(body, ensure_ascii=False))

    print()

# Calculate metrics using successful, completed HTTP requests.
# Invalid JSON and request failures count as failed evaluation cases.
correct = sum(1 for result in results if result["pass"])
total = len(cases)
accuracy = (correct / total * 100) if total else 0.0

latencies = sorted(
    result["latency_ms"] for result in results if result.get("http_status") is not None
)

# Nearest-rank p95. With only 10 observations, treat it as provisional.
p95 = latencies[math.ceil(0.95 * len(latencies)) - 1] if latencies else None

summary = {
    "stage": "baseline",
    "endpoint": URL,
    "total_cases": total,
    "completed_cases": len(results),
    "correct_cases": correct,
    "failed_cases": total - correct,
    "accuracy_percent": round(accuracy, 2),
    "p95_latency_ms": p95,
    "latency_sample_count": len(latencies),
    "latency_method": (
        "Single client-side elapsed-time measurement per case; "
        "includes network and server time. P95 is provisional."
    ),
    "cost_per_task": (
        "N/A: this endpoint uses deterministic rules and "
        "does not call a paid AI API."
    ),
    "results": results,
}

Path("baseline-results.json").write_text(
    json.dumps(summary, indent=2, ensure_ascii=False),
    encoding="utf-8",
)

print("=" * 45)
print(f"BASELINE ACCURACY: {correct}/{total} = {accuracy:.2f}%")
print(f"COMPLETED HTTP REQUESTS: {len(latencies)}/{total}")
print(f"PROVISIONAL P95 LATENCY: {p95} ms")
print("COST PER TASK: N/A (no paid AI API call)")
print("Saved results to baseline-results.json")
