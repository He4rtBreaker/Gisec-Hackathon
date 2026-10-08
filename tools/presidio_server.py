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

from presidio_analyzer import AnalyzerEngine, RecognizerResult
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import OperatorConfig

HOST = "127.0.0.1"
# Both ports docker-compose.yml publishes, so either way of running Presidio
# needs the same configuration from the app: analyzer on 5002, anonymizer on
# 5003. Here one process answers on both.
PORTS = (5002, 5003)

print("loading spaCy model (first start takes a few seconds)...", flush=True)
analyzer = AnalyzerEngine()
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
