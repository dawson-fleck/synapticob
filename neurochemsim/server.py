"""Local single-user server. Scientific computation stays in the model modules."""
from __future__ import annotations
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import mimetypes
import os
from pathlib import Path
import socket
import sys
import threading
from urllib.parse import urlparse, parse_qs

from .controls import control_metadata
from .parameters import SimulationParameters
from .presentation import browser_result
from .simulation import simulate

PROJECT_ROOT = Path(__file__).resolve().parent.parent
UI_ROOT = PROJECT_ROOT / "ui"


def server_identity():
    """Identify the code loaded at startup, not files changed beneath a server."""
    from .reproducibility import model_source_hash
    return {"application": "SynaptiCob", "api_version": 2,
            "model_source_sha256": model_source_hash()}


class ApplicationServer(ThreadingHTTPServer):
    daemon_threads = True
    # HTTPServer's default SO_REUSEADDR permits competing listeners on Windows.
    # Exclusive ownership makes a second launch detect the existing instance.
    allow_reuse_address = not hasattr(socket, "SO_EXCLUSIVEADDRUSE")

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

    def __init__(self, address):
        super().__init__(address, RequestHandler)
        self.results = OrderedDict()
        self.sweeps = OrderedDict()
        self.compute_lock = threading.Lock()
        self.runtime_identity = server_identity()


class RequestHandler(BaseHTTPRequestHandler):
    server: ApplicationServer

    def log_message(self, format, *args):
        logging.info(format, *args)

    def send_bytes(self, data: bytes, content_type: str, status=200, filename=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass  # Browser cancelled a response; no model state is changed.

    def send_json(self, data, status=200):
        self.send_bytes(json.dumps(data, allow_nan=False, separators=(",", ":")).encode("utf-8"),
                        "application/json; charset=utf-8", status)

    def valid_origin(self):
        allowed = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
        # Browsers omit HTTP's default port from both Host and Origin. A user
        # selecting --port 80 must still be able to load the local application.
        if self.server.server_port == 80:
            allowed.update({"127.0.0.1", "localhost"})
        if self.headers.get("Host") not in allowed:
            return False
        origin = self.headers.get("Origin")
        return origin is None or origin in {"http://" + value for value in allowed}

    def require_current_code(self):
        """Do not attribute an older loaded model to newly edited source files."""
        try:
            current_identity = server_identity()
        except (OSError, UnicodeError):
            current_identity = None
        if current_identity == self.server.runtime_identity:
            return True
        packaged = getattr(sys, "frozen", False) or os.environ.get("SYNAPTICOB_PORTABLE") == "1"
        launcher = "SynaptiCob.exe" if packaged else "Start_SynaptiCob.bat"
        self.send_json({"error": "The application files were updated while this server was running. "
                        f"Open {launcher} again and use the new browser tab it opens. "
                        "Leave that launcher window open. Your previous result has been preserved."}, 409)
        return False

    def do_GET(self):
        if not self.valid_origin():
            return self.send_json({"error": "Use the local application address."}, 403)
        path = urlparse(self.path).path
        if path == "/api/health":
            return self.send_json({**self.server.runtime_identity, "status": "ok"})
        if path.startswith("/api/") and not self.require_current_code():
            return
        if path == "/api/defaults":
            return self.send_json({"parameters": SimulationParameters.spatial_defaults().to_dict(),
                                   "controls": control_metadata()})
        if path == "/api/presets":
            from .experiments import get_presets
            return self.send_json({"presets": get_presets()})
        if path == "/api/drugs":
            from .drug_experiments import classroom_catalog
            return self.send_json(classroom_catalog())
        parts = path.strip("/").split("/")
        if len(parts) == 4 and parts[:2] in (["api", "export"], ["api", "sweep-export"]):
            identifier, filename = parts[2:]
            is_sweep = parts[1] == "sweep-export"
            saved = (self.server.sweeps if is_sweep else self.server.results).get(identifier)
            if saved is None:
                return self.send_json({"error": "This result is no longer in memory. Run the experiment again to export it."}, 404)
            try:
                from .exports import export_run, sweep_csv, sweep_png, json_bytes
                with self.server.compute_lock:
                    if not is_sweep:
                        data, mime = export_run(saved["result"], filename, saved["provenance"], baseline=saved.get("baseline"))
                    elif filename == "sweep.csv":
                        data, mime = sweep_csv(saved), "text/csv; charset=utf-8"
                    elif filename == "figure.png":
                        metric = parse_qs(urlparse(self.path).query).get("metric", ["spike_count"])[0]
                        data, mime = sweep_png(saved, metric), "image/png"
                    elif filename == "configuration.json":
                        data, mime = json_bytes(saved), "application/json"
                    else:
                        raise ValueError("Unknown sweep export format.")
                    if not self.require_current_code():
                        return
                return self.send_bytes(data, mime, filename="SynaptiCob_" + filename)
            except ValueError as exc:
                return self.send_json({"error": str(exc)}, 400)
            except Exception:
                logging.exception("Export failed")
                return self.send_json({"error": "Could not create the export. Details are in the application log."}, 500)
        allowed_assets = {"/": "index.html", "/index.html": "index.html",
                          "/styles.css": "styles.css", "/app.js": "app.js",
                          "/plots.js": "plots.js", "/neuron.js": "neuron.js",
                          "/animation_state.js": "animation_state.js",
                          "/experiments_ui.js": "experiments_ui.js", "/sweep.js": "sweep.js"}
        allowed_assets["/drugs.js"] = "drugs.js"
        allowed_assets["/workspace.js"] = "workspace.js"
        allowed_assets.update({"/ui/" + name: name for name in tuple(allowed_assets.values())})
        if path not in allowed_assets:
            return self.send_json({"error": "Resource not found."}, 404)
        target = UI_ROOT / allowed_assets[path]
        if not target.is_file():
            return self.send_json({"error": "Interface file is not available."}, 503)
        mime = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if target.suffix == ".js":
            mime = "text/javascript"
        return self.send_bytes(target.read_bytes(), mime + "; charset=utf-8")

    def do_POST(self):
        if not self.valid_origin():
            return self.send_json({"error": "Only the local application may submit runs."}, 403)
        endpoint = urlparse(self.path).path
        if endpoint not in ("/api/simulate", "/api/validate-configuration", "/api/sweep", "/api/drug-sweep"):
            return self.send_json({"error": "Endpoint not found."}, 404)
        if not self.require_current_code():
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 1_000_000:
                raise ValueError("The parameter request must be smaller than 1 MB.")
            if self.headers.get_content_type() != "application/json":
                raise ValueError("Send parameters as JSON.")
            raw = self.rfile.read(length).decode("utf-8")
            if endpoint == "/api/drug-sweep":
                from .drug_experiments import run_drug_sweep
                from .parameters import _unique_json_object
                settings = json.loads(raw, object_pairs_hook=_unique_json_object)
                if not isinstance(settings, dict) or set(settings) != {"parameters", "drug_id", "axis", "values_uM", "agonist_uM"}:
                    raise ValueError("Provide completed parameters, drug_id, axis, values_uM, and agonist_uM.")
                parameters = SimulationParameters.from_dict(settings["parameters"])
                with self.server.compute_lock:
                    response = run_drug_sweep(parameters, settings["drug_id"], settings["axis"], settings["values_uM"], settings["agonist_uM"])
                    if not self.require_current_code():
                        return
                return self.send_json(response)
            if endpoint == "/api/sweep":
                from .experiments import run_sweep
                from .parameters import _unique_json_object
                settings = json.loads(raw, object_pairs_hook=_unique_json_object)
                if not isinstance(settings, dict) or set(settings) != {"parameters", "glutamate_doses_uM_um", "gaba_availabilities"}:
                    raise ValueError("Provide base parameters, glutamate doses, and GABA-A availabilities.")
                parameters = SimulationParameters.from_dict(settings["parameters"])
                with self.server.compute_lock:
                    sweep = run_sweep(parameters, settings["glutamate_doses_uM_um"], settings["gaba_availabilities"])
                    if not self.require_current_code():
                        return
                    self.server.sweeps[sweep["sweep_id"]] = sweep
                    self.server.sweeps.move_to_end(sweep["sweep_id"])
                    while len(self.server.sweeps) > 4:
                        self.server.sweeps.popitem(last=False)
                return self.send_json(sweep)
            parameters = SimulationParameters.from_json(raw)
            if endpoint == "/api/validate-configuration":
                return self.send_json({"parameters": parameters.to_dict()})
            with self.server.compute_lock:
                result = simulate(parameters)
                payload = browser_result(result)
                baseline = None
                if parameters.pharmacology is not None:
                    from .drug_experiments import matched_control
                    baseline = matched_control(result)
                    reference = browser_result(baseline)
                    reference.pop("spatial", None)
                    payload["comparison"] = {"baseline": reference,
                        "label": "Same receptor model, all drugs off",
                        "note": "Only free drug concentrations differ. Transmitter inputs, receptor-model version, conductances and membrane settings are matched."}
                if not self.require_current_code():
                    return
                self.server.results[payload["run_id"]] = {"result": result, "baseline": baseline, "provenance": payload["provenance"]}
                self.server.results.move_to_end(payload["run_id"])
                while len(self.server.results) > 6:
                    self.server.results.popitem(last=False)
            return self.send_json(payload)
        except (ValueError, UnicodeError) as exc:
            return self.send_json({"error": str(exc)}, 400)
        except ArithmeticError as exc:
            return self.send_json({"error": str(exc)}, 422)
        except Exception:
            logging.exception("Simulation request failed")
            return self.send_json({"error": "The simulation failed. Details are recorded in the local application log."}, 500)


def create_server(port=8765):
    return ApplicationServer(("127.0.0.1", port))
