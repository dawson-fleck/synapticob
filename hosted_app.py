"""Production WSGI entry for the same SynaptiCob scientific model and interface.

Run one Gunicorn worker with bounded threads. State is anonymous, bounded and
session-owned; persistent personal accounts or classroom identifiers are not used.
"""
from __future__ import annotations

from contextlib import contextmanager
from http.cookies import SimpleCookie
from http import HTTPStatus
import json
import logging
import math
import os
from pathlib import Path
import re
import tempfile
import threading
from urllib.parse import parse_qs, urlsplit

from hosted_storage import SessionStore, StorageFull, encode_run, decode_run
from neurochemsim.controls import control_metadata
from neurochemsim.parameters import SimulationParameters, _unique_json_object
from neurochemsim.presentation import browser_result
from neurochemsim.reproducibility import model_source_hash
from neurochemsim.simulation import simulate

ROOT = Path(__file__).resolve().parent
COOKIE = "__Host-synapticob"
ASSETS = {"/": "index.html", "/index.html": "index.html"}
ASSETS.update({"/" + name: name for name in (
    "styles.css", "app.js", "plots.js", "neuron.js", "animation_state.js",
    "experiments_ui.js", "sweep.js", "drugs.js", "workspace.js")})
ASSETS.update({"/ui/" + name: name for name in tuple(ASSETS.values())})
API_PATHS = {"/api/defaults", "/api/presets", "/api/drugs", "/api/simulate",
             "/api/validate-configuration", "/api/sweep", "/api/drug-sweep"}
EXPORT_PATH = re.compile(r"/api/(export|sweep-export)/([a-f0-9]{20})/([a-zA-Z_.]+)")


class HTTPError(Exception):
    def __init__(self, status, message, headers=()):
        self.status, self.message, self.headers = status, message, list(headers)


def json_bytes(value):
    return json.dumps(value, allow_nan=False, separators=(",", ":")).encode("utf-8")


class HostedApplication:
    def __init__(self, public_origin, *, store_directory=None, allow_local_http=False,
                 compute_slots=1, acquire_timeout=1.0, max_intervals=20000, **store_options):
        parsed = urlsplit(public_origin)
        local_http = allow_local_http and parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}
        if (parsed.scheme != "https" and not local_http) or not parsed.hostname or parsed.path not in {"", "/"} or parsed.query or parsed.fragment or parsed.username is not None:
            raise ValueError("PUBLIC_ORIGIN must be the exact HTTPS site origin, without a path, query or credentials.")
        if not re.fullmatch(r"[a-zA-Z0-9.-]+", parsed.hostname):
            raise ValueError("PUBLIC_ORIGIN must use a valid ASCII website hostname.")
        port = parsed.port
        self.authority = parsed.hostname.lower() + (f":{port}" if port and port != {"http": 80, "https": 443}[parsed.scheme] else "")
        self.origin = parsed.scheme + "://" + self.authority
        self.secure = parsed.scheme == "https"
        self.cookie_name = COOKIE if self.secure else "synapticob-local-test"
        if not 1 <= compute_slots <= 4 or not 1000 <= max_intervals <= 40000 or not 0 <= acquire_timeout <= 10:
            raise ValueError("Invalid hosted capacity configuration.")
        self.store = SessionStore(store_directory or Path(tempfile.gettempdir()) / "synapticob-hosted", **store_options)
        self.compute = threading.BoundedSemaphore(compute_slots)
        self.export_lock = threading.Lock()
        self.acquire_timeout, self.max_intervals = acquire_timeout, max_intervals
        self.source_identity = model_source_hash()

    @contextmanager
    def computing(self):
        if not self.compute.acquire(timeout=self.acquire_timeout):
            raise HTTPError(429, "The classroom server is busy. Your current experiment is still displayed. Please try again in a moment.", [("Retry-After", "2")])
        try:
            yield
        finally:
            self.compute.release()

    def current_code(self):
        if model_source_hash() != self.source_identity:
            raise HTTPError(409, "The website was updated while this server was running. Please reload the page and try again shortly. Your displayed experiment has not been replaced.")

    def check_work(self, parameters, *, combinations=1):
        intervals = math.ceil(parameters.duration_ms / parameters.dt_ms) + len(parameters.glutamate.release_times_ms) + len(parameters.gaba.release_times_ms)
        if intervals > self.max_intervals or intervals * combinations > 150000:
            raise HTTPError(422, "This request exceeds the classroom server's calculation limit. Use a shorter observation or fewer sweep values. The timestep is never changed automatically.")

    def _body(self, environ):
        try:
            length = int(environ.get("CONTENT_LENGTH") or 0)
        except ValueError:
            raise HTTPError(400, "Send a valid Content-Length for the parameter request.")
        if not 0 < length <= 1_000_000:
            raise HTTPError(413, "The parameter request must be smaller than 1 MB.")
        if environ.get("CONTENT_TYPE", "").split(";", 1)[0].strip().lower() != "application/json":
            raise HTTPError(415, "Send parameters as JSON.")
        raw = environ["wsgi.input"].read(length)
        if len(raw) != length:
            raise HTTPError(400, "The parameter request was incomplete.")
        def reject(value):
            raise ValueError(f"Non-finite JSON value {value} is not permitted.")
        return json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_json_object, parse_constant=reject)

    def _session(self, environ):
        cookie = SimpleCookie()
        try:
            cookie.load(environ.get("HTTP_COOKIE", ""))
            token = cookie[self.cookie_name].value if self.cookie_name in cookie else None
        except Exception:
            token = None
        return self.store.acquire(token)

    def __call__(self, environ, start_response):
        extra = []
        try:
            host = environ.get("HTTP_HOST", "").lower()
            origin = environ.get("HTTP_ORIGIN")
            if host != self.authority or (origin is not None and origin.rstrip("/") != self.origin):
                raise HTTPError(403, "Use the SynaptiCob website address to make this request.")
            if environ.get("HTTP_SEC_FETCH_SITE") == "cross-site" and environ.get("REQUEST_METHOD") not in {"GET", "HEAD"}:
                raise HTTPError(403, "Only this website may submit experiments.")
            method, path = environ.get("REQUEST_METHOD", "GET"), environ.get("PATH_INFO", "/")
            if method not in {"GET", "HEAD", "POST"}:
                raise HTTPError(405, "This request method is not supported.", [("Allow", "GET, HEAD, POST")])
            token = None
            if path in API_PATHS or EXPORT_PATH.fullmatch(path) or ASSETS.get(path) == "index.html":
                token, _ = self._session(environ)
                value = f"{self.cookie_name}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={self.store.ttl_seconds}"
                if self.secure:
                    value += "; Secure"
                extra.append(("Set-Cookie", value))
            if path.startswith("/api/") and path != "/api/health":
                self.current_code()
            body, mime, headers = self.route(method, path, environ, token)
            extra.extend(headers)
            status = 200
        except HTTPError as error:
            status, body, mime = error.status, json_bytes({"error": error.message}), "application/json"
            extra.extend(error.headers)
        except StorageFull as error:
            status, body, mime = 503, json_bytes({"error": str(error)}), "application/json"
            extra.append(("Retry-After", "10"))
        except (ValueError, UnicodeError, TypeError) as error:
            status, body, mime = 400, json_bytes({"error": str(error)}), "application/json"
        except ArithmeticError as error:
            status, body, mime = 422, json_bytes({"error": str(error)}), "application/json"
        except Exception:
            logging.exception("Hosted request failed")
            status, body, mime = 500, json_bytes({"error": "The website could not finish this request. Your displayed experiment has been preserved. Please try again or contact your instructor."}), "application/json"
        headers = [("Content-Type", mime), ("Content-Length", str(len(body))), ("Cache-Control", "no-store"),
                   ("X-Content-Type-Options", "nosniff"), ("Referrer-Policy", "same-origin"),
                   ("X-Frame-Options", "SAMEORIGIN"), *extra]
        if self.secure:
            headers.append(("Strict-Transport-Security", "max-age=31536000"))
        start_response(f"{status} {HTTPStatus(status).phrase}", headers)
        return [b"" if environ.get("REQUEST_METHOD") == "HEAD" else body]

    def route(self, method, path, environ, token):
        if method in {"GET", "HEAD"}:
            if path == "/api/health":
                return json_bytes({"application": "SynaptiCob", "status": "ok", "api_version": 2,
                                   "deployment": "hosted", "model_source_sha256": self.source_identity}), "application/json", []
            if path == "/api/defaults":
                return json_bytes({"parameters": SimulationParameters.spatial_defaults().to_dict(), "controls": control_metadata()}), "application/json", []
            if path == "/api/presets":
                from neurochemsim.experiments import get_presets
                return json_bytes({"presets": get_presets()}), "application/json", []
            if path == "/api/drugs":
                from neurochemsim.drug_experiments import classroom_catalog
                return json_bytes(classroom_catalog()), "application/json", []
            if path in ASSETS:
                file = ROOT / "ui" / ASSETS[path]
                body = file.read_bytes()
                if file.name == "index.html":
                    body = body.replace(b'data-deployment="local"', b'data-deployment="hosted"', 1)
                mime = {".html": "text/html", ".css": "text/css", ".js": "text/javascript"}[file.suffix]
                return body, mime + "; charset=utf-8", []
            match = EXPORT_PATH.fullmatch(path)
            if match:
                return self.export(token, *match.groups(), environ.get("QUERY_STRING", ""))
            raise HTTPError(404, "Resource not found.")
        if path not in {"/api/simulate", "/api/validate-configuration", "/api/sweep", "/api/drug-sweep"}:
            raise HTTPError(404, "Endpoint not found.")
        data = self._body(environ)
        if path in {"/api/simulate", "/api/validate-configuration"}:
            parameters = SimulationParameters.from_dict(data)
            self.check_work(parameters)
            if path == "/api/validate-configuration":
                return json_bytes({"parameters": parameters.to_dict()}), "application/json", []
            with self.computing():
                result = simulate(parameters)
                payload = browser_result(result)
                baseline = None
                if parameters.pharmacology is not None:
                    from neurochemsim.drug_experiments import matched_control
                    baseline = matched_control(result)
                    reference = browser_result(baseline)
                    reference.pop("spatial", None)
                    payload["comparison"] = {"baseline": reference, "label": "Same receptor model, all drugs off",
                        "note": "Only free drug concentrations differ. Transmitter inputs, receptor-model version, conductances and membrane settings are matched."}
                saved = encode_run(result, baseline, payload["provenance"])
                self.current_code()
                evicted = self.store.put(token, "run", payload["run_id"], saved)
                payload["hosting"] = {"retained_runs": 6, "retained_sweeps": 4,
                                      "session_idle_seconds": self.store.ttl_seconds, "evicted_own_results": evicted}
                body = json_bytes(payload)
            return body, "application/json", []
        if not isinstance(data, dict):
            raise ValueError("Provide an experiment configuration object.")
        fields = ({"parameters", "glutamate_doses_uM_um", "gaba_availabilities"} if path == "/api/sweep"
                  else {"parameters", "drug_id", "axis", "values_uM", "agonist_uM"})
        if set(data) != fields:
            raise ValueError("Provide exactly these experiment fields: " + ", ".join(sorted(fields)))
        parameters = SimulationParameters.from_dict(data["parameters"])
        if path == "/api/sweep":
            axes = (data["glutamate_doses_uM_um"], data["gaba_availabilities"])
            if any(not isinstance(axis, list) or not 2 <= len(axis) <= 7 for axis in axes):
                raise ValueError("Sweep axes must each contain 2 to 7 values.")
            self.check_work(parameters, combinations=len(axes[0]) * len(axes[1]))
            from neurochemsim.experiments import run_sweep
            with self.computing():
                response = run_sweep(parameters, *axes)
                self.current_code()
                self.store.put(token, "sweep", response["sweep_id"], json_bytes(response))
                body = json_bytes(response)
        else:
            from neurochemsim.drug_experiments import run_drug_sweep
            with self.computing():
                response = run_drug_sweep(parameters, data["drug_id"], data["axis"], data["values_uM"], data["agonist_uM"])
                self.current_code()
                body = json_bytes(response)
        return body, "application/json", []

    def export(self, token, kind, identifier, filename, query):
        from neurochemsim.exports import export_run, sweep_csv, sweep_png
        with self.computing(), self.export_lock:
            saved = self.store.get(token, "run" if kind == "export" else "sweep", identifier)
            if saved is None:
                raise HTTPError(404, "This saved result is unavailable in this browser session. Run the experiment again to export it.")
            if kind == "export":
                result, baseline, source = decode_run(saved)
                if source["model_source_sha256"] != self.source_identity:
                    raise HTTPError(409, "The website has been updated since this result was calculated. Run the experiment again before exporting it.")
                body, mime = export_run(result, filename, source, baseline=baseline)
            else:
                sweep = json.loads(saved)
                if sweep["provenance"]["model_source_sha256"] != self.source_identity:
                    raise HTTPError(409, "The website has been updated. Run the sweep again before exporting it.")
                if filename == "sweep.csv":
                    body, mime = sweep_csv(sweep), "text/csv; charset=utf-8"
                elif filename == "figure.png":
                    body, mime = sweep_png(sweep, parse_qs(query).get("metric", ["spike_count"])[0]), "image/png"
                elif filename == "configuration.json":
                    body, mime = json_bytes(sweep), "application/json"
                else:
                    raise ValueError("Unknown sweep export format.")
            self.current_code()
        return body, mime, [("Content-Disposition", f'attachment; filename="SynaptiCob_{filename}"')]


def create_app():
    origin = os.environ.get("PUBLIC_ORIGIN") or os.environ.get("RENDER_EXTERNAL_URL")
    if not origin:
        raise RuntimeError("Set PUBLIC_ORIGIN to the hosted HTTPS website address.")
    cache = os.environ.get("SYNAPTICOB_CACHE_DIR") or str(Path(tempfile.gettempdir()) / "synapticob-hosted")
    def integer(name, default, minimum, maximum):
        value = int(os.environ.get(name, default))
        if not minimum <= value <= maximum:
            raise ValueError(f"{name} must be between {minimum} and {maximum}.")
        return value
    return HostedApplication(origin, store_directory=cache,
        compute_slots=integer("SYNAPTICOB_COMPUTE_SLOTS", 1, 1, 4),
        max_intervals=integer("SYNAPTICOB_MAX_INTERVALS", 20000, 1000, 40000),
        max_sessions=integer("SYNAPTICOB_MAX_SESSIONS", 128, 1, 1024),
        ttl_seconds=integer("SYNAPTICOB_SESSION_TTL_SECONDS", 14400, 300, 86400),
        max_session_bytes=integer("SYNAPTICOB_SESSION_BYTES", 64 * 1024 * 1024, 1024 * 1024, 256 * 1024 * 1024),
        max_total_bytes=integer("SYNAPTICOB_CACHE_BYTES", 1024 * 1024 * 1024, 1024 * 1024, 4 * 1024 * 1024 * 1024))


class _LazyApplication:
    def __init__(self):
        self.instance = None
        self.lock = threading.Lock()

    def __call__(self, environ, start_response):
        if self.instance is None:
            with self.lock:
                if self.instance is None:
                    self.instance = create_app()
        return self.instance(environ, start_response)


application = _LazyApplication()
