#!/usr/bin/env python3
"""Microsoft Presidio, served on loopback, without Docker.

Exposes the same two endpoints the official containers do — POST /analyze and
POST /anonymize — with the same request and response shapes, so
src/lib/classify/presidio.ts and anonymize.ts cannot tell the difference.
docker-compose.yml remains the equivalent route for anyone who prefers it.

Both services live in one process here. They are separate images upstream
because they scale separately in production; for a single-host deployment one
process means one model load and one thing to start.

Binds 127.0.0.1 only. The analyzer sees every prompt before any routing
decision is made, so it must not be reachable from off-box — same posture as
every other on-prem binding in this project.

    .venv/bin/python tools/presidio_server.py
"""

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from presidio_analyzer import AnalyzerEngine, PatternRecognizer, RecognizerResult
from presidio_analyzer import Pattern
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import OperatorConfig

HOST = "127.0.0.1"
# Both ports docker-compose.yml publishes, so either way of running Presidio
# needs the same configuration from the app: analyzer on 5002, anonymizer on
# 5003. Here one process answers on both.
PORTS = (5002, 5003)

# Recognisers Microsoft does not ship, for the identifiers this deployment
# actually handles. Mirrors the regex detectors in src/lib/classify/detectors.ts
# so one engine owns the question "where is the sensitive text".
#
# Two of those detectors match a keyword rather than a value — "payroll",
# "api key" — which is right for classifying a request and wrong for redacting
# one: replacing the word costs the model the sentence and protects nothing.
# Here the pattern matches the value and the keyword is a context word, which
# is how Presidio is meant to express "this shape, but only near that word".
LOCAL_RECOGNIZERS = [
    PatternRecognizer(
        supported_entity="AE_EMIRATES_ID",
        patterns=[Pattern("emirates id", r"\b784[-\s]?\d{4}[-\s]?\d{7}[-\s]?\d\b", 0.85)],
        context=["emirates", "eid", "identity"],
    ),
    PatternRecognizer(
        supported_entity="AE_PASSPORT",
        # A letter or two then digits is far too common a shape to redact on
        # sight, so it scores below threshold on its own and only clears it
        # when "passport" is nearby.
        patterns=[Pattern("passport number", r"\b[A-Z]{1,2}\d{6,9}\b", 0.3)],
        context=["passport", "travel document"],
    ),
    PatternRecognizer(
        supported_entity="PAYROLL_AMOUNT",
        patterns=[
            Pattern("aed amount", r"\bAED\s?\d[\d,]*(?:\.\d{2})?\b", 0.4),
            Pattern("amount aed", r"\b\d[\d,]*(?:\.\d{2})?\s?AED\b", 0.4),
        ],
        context=["salary", "payroll", "remuneration", "gratuity", "net pay",
                 "gross pay", "compensation", "wage"],
    ),
    PatternRecognizer(
        supported_entity="CREDENTIAL",
        # Policy refuses credential material outright, so this should never be
        # reached in practice. It is here so that if that policy is ever
        # loosened, the key is redacted rather than forwarded in the clear.
        patterns=[
            Pattern("prefixed key", r"\b(?:sk|pk|gsk|ghp|ghs|xox[baprs])[-_][A-Za-z0-9_-]{16,}\b", 0.85),
            Pattern("bearer token", r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b", 0.85),
        ],
        context=["api", "key", "token", "secret", "password"],
    ),
]

print("loading spaCy model (first start takes a few seconds)...", flush=True)
analyzer = AnalyzerEngine()
for rec in LOCAL_RECOGNIZERS:
    analyzer.registry.add_recognizer(rec)
anonymizer = AnonymizerEngine()
print(
    f"presidio ready on http://{HOST}:{PORTS[0]} and :{PORTS[1]}"
    "  (/analyze, /anonymize, /health)",
    flush=True,
)


def analyze(payload: dict) -> list[dict]:
    results = analyzer.analyze(
        text=payload["text"],
        language=payload.get("language", "en"),
        score_threshold=payload.get("score_threshold", 0.0),
    )
    return [
        {"entity_type": r.entity_type, "start": r.start, "end": r.end, "score": r.score}
        for r in results
    ]


def anonymize(payload: dict) -> dict:
    results = [
        RecognizerResult(
            entity_type=r["entity_type"], start=r["start"], end=r["end"], score=r.get("score", 1.0)
        )
        for r in payload.get("analyzer_results", [])
    ]
    # The REST API calls this field "anonymizers"; the Python engine calls the
    # same thing "operators".
    operators = {
        name: OperatorConfig(cfg.pop("type"), cfg)
        for name, cfg in ((k, dict(v)) for k, v in payload.get("anonymizers", {}).items())
    }
    out = anonymizer.anonymize(text=payload["text"], analyzer_results=results, operators=operators)
    return {
        "text": out.text,
        "items": [
            {
                "operator": i.operator,
                "entity_type": i.entity_type,
                "start": i.start,
                "end": i.end,
                "text": i.text,
            }
            for i in out.items
        ],
    }


ROUTES = {"/analyze": analyze, "/anonymize": anonymize}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code: int, body: object) -> None:
        raw = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._send(200, {"status": "ok"})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:
        handler = ROUTES.get(self.path)
        if handler is None:
            self._send(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
            self._send(200, handler(payload))
        except Exception as err:  # noqa: BLE001 — report, never take the server down
            self._send(400, {"error": f"{type(err).__name__}: {err}"})

    def log_message(self, *_args) -> None:
        pass  # one line per prompt inspected is noise, and the text is sensitive


if __name__ == "__main__":
    import threading

    servers = [ThreadingHTTPServer((HOST, p), Handler) for p in PORTS]
    for srv in servers[1:]:
        threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        servers[0].serve_forever()
    except KeyboardInterrupt:
        for srv in servers:
            srv.shutdown()
