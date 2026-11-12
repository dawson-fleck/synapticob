"""Hosted request isolation and resource limits, through the actual WSGI entry."""
from __future__ import annotations
from dataclasses import replace
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from hosted_app import HostedApplication
from hosted_storage import SessionStore, StorageFull, encode_run, decode_run
from neurochemsim.parameters import SimulationParameters
from neurochemsim.presentation import browser_result
from neurochemsim.simulation import simulate


class Client:
    def __init__(self, application):
        self.application, self.cookie = application, ""

    def request(self, path, data=None, **overrides):
        raw = b"" if data is None else json.dumps(data).encode()
        environ = {"REQUEST_METHOD": "GET" if data is None else "POST", "PATH_INFO": path,
                   "QUERY_STRING": "", "HTTP_HOST": "class.example", "wsgi.url_scheme": "https",
                   "HTTP_COOKIE": self.cookie, "wsgi.input": io.BytesIO(raw),
                   "CONTENT_TYPE": "application/json", "CONTENT_LENGTH": str(len(raw))}
        environ.update(overrides)
        received = {}
        def start_response(status, headers):
            received["status"] = int(status.split()[0])
            received["headers"] = dict(headers)
        received["body"] = b"".join(self.application(environ, start_response))
        if "Set-Cookie" in received["headers"]:
            self.cookie = received["headers"]["Set-Cookie"].split(";", 1)[0]
        if received["headers"]["Content-Type"].startswith("application/json"):
            received["json"] = json.loads(received["body"]) if received["body"] else None
        return received


class HostedTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.app = HostedApplication("https://class.example", store_directory=Path(self.directory.name), acquire_timeout=0)
        self.client = Client(self.app)

    def tearDown(self):
        self.directory.cleanup()

    def test_cookie_html_and_origin_boundaries(self):
        page = self.client.request("/")
        self.assertEqual(page["status"], 200)
        self.assertIn(b'data-deployment="hosted"', page["body"])
        cookie = page["headers"]["Set-Cookie"]
        for flag in ("__Host-synapticob=", "Secure", "HttpOnly", "SameSite=Lax", "Path=/"):
            self.assertIn(flag, cookie)
        self.assertNotIn("Domain", cookie)
        for overrides in ({"HTTP_HOST": "evil.example"}, {"HTTP_ORIGIN": "https://evil.example"}):
            self.assertEqual(self.client.request("/api/defaults", **overrides)["status"], 403)
        self.assertEqual(self.client.request("/api/simulate", {}, HTTP_SEC_FETCH_SITE="cross-site")["status"], 403)
        self.assertEqual(self.client.request("/../requirements.txt")["status"], 404)
        self.assertEqual(self.client.request("/_app/app.py")["status"], 404)
        with self.assertRaises(ValueError):
            HostedApplication("http://class.example", store_directory=Path(self.directory.name))
        with self.assertRaises(ValueError):
            HostedApplication("https://:password@class.example", store_directory=Path(self.directory.name))
        canonical = HostedApplication("https://class.example:443/", store_directory=Path(self.directory.name))
        self.assertEqual(Client(canonical).request("/api/health")["status"], 200)

    def test_default_model_export_and_private_result_ownership(self):
        parameters = SimulationParameters.spatial_defaults()
        response = self.client.request("/api/simulate", parameters.to_dict())
        self.assertEqual(response["status"], 200, response.get("json"))
        result = response["json"]
        expected = browser_result(simulate(parameters))
        self.assertEqual(result["series"], expected["series"])
        self.assertEqual(result["provenance"], expected["provenance"])
        export = "/api/export/" + result["run_id"] + "/parameters.json"
        second_student = Client(self.app)
        second_student.request("/api/defaults")
        self.assertNotEqual(self.client.cookie, second_student.cookie)
        self.assertEqual(second_student.request(export)["status"], 404)
        self.assertEqual(self.client.request(export)["json"], parameters.to_dict())
        self.assertIn("attachment", self.client.request(export)["headers"]["Content-Disposition"])

    def test_busy_request_does_not_compute_or_replace_result(self):
        self.app.compute.acquire()
        try:
            with patch("hosted_app.simulate") as computation:
                response = self.client.request("/api/simulate", SimulationParameters.spatial_defaults().to_dict())
                self.assertEqual(response["status"], 429)
                self.assertEqual(response["headers"]["Retry-After"], "2")
                computation.assert_not_called()
            self.assertEqual(self.client.request("/api/health")["status"], 200)
        finally:
            self.app.compute.release()

    def test_invalid_or_oversized_request_does_not_compute(self):
        with patch("hosted_app.simulate") as computation:
            self.assertEqual(self.client.request("/api/simulate", {}, CONTENT_LENGTH="1000001")["status"], 413)
            self.assertEqual(self.client.request("/api/simulate", {}, CONTENT_TYPE="text/plain")["status"], 415)
            self.assertEqual(self.client.request("/api/simulate", {}, CONTENT_LENGTH="nonsense")["status"], 400)
            params = replace(SimulationParameters(), duration_ms=1500, dt_ms=.05).to_dict()
            self.assertEqual(self.client.request("/api/simulate", params)["status"], 422)
            computation.assert_not_called()

    def test_stale_server_and_mid_run_change_preserve_prior_cache(self):
        parameters = SimulationParameters().to_dict()
        initial = self.client.request("/api/simulate", parameters)["json"]
        with patch("hosted_app.model_source_hash", return_value="updated"):
            self.assertEqual(self.client.request("/api/defaults")["status"], 409)
            self.assertEqual(self.client.request("/api/health")["status"], 200)
        with patch("hosted_app.model_source_hash", side_effect=[self.app.source_identity, "updated"]):
            response = self.client.request("/api/simulate", replace(SimulationParameters(), duration_ms=50).to_dict())
            self.assertEqual(response["status"], 409)
        self.assertEqual(self.client.request(f"/api/export/{initial['run_id']}/parameters.json")["json"], parameters)

    def test_health_creates_no_session_and_head_has_no_body(self):
        response = self.client.request("/api/health")
        self.assertNotIn("Set-Cookie", response["headers"])
        unknown = self.client.request("/api/not-a-real-route")
        self.assertEqual(unknown["status"], 404)
        self.assertNotIn("Set-Cookie", unknown["headers"])
        response = self.client.request("/styles.css", REQUEST_METHOD="HEAD")
        self.assertEqual(response["status"], 200)
        self.assertEqual(response["body"], b"")
        self.assertGreater(int(response["headers"]["Content-Length"]), 0)


class HostedStorageTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.time = [0.0]
        self.store = SessionStore(Path(self.directory.name), ttl_seconds=100, max_sessions=2,
                                  max_session_bytes=1000, max_total_bytes=1500, clock=lambda: self.time[0])

    def tearDown(self):
        self.directory.cleanup()

    def test_quota_failure_keeps_both_students_results(self):
        first, _ = self.store.acquire(None)
        second, _ = self.store.acquire(None)
        self.store.put(first, "run", "a", b"a" * 700)
        self.store.put(second, "run", "b", b"b" * 700)
        with self.assertRaises(StorageFull):
            self.store.put(first, "run", "c", b"c" * 200)
        self.assertEqual(self.store.get(first, "run", "a"), b"a" * 700)
        self.assertEqual(self.store.get(second, "run", "b"), b"b" * 700)
        self.assertIsNone(self.store.get(first, "run", "b"))

    def test_only_own_oldest_run_rotates_and_session_expiry_is_idle(self):
        first, _ = self.store.acquire(None)
        second, _ = self.store.acquire(None)
        self.store.put(second, "run", "other", b"other")
        for index in range(7):
            self.time[0] += 1
            evicted = self.store.put(first, "run", str(index), b"result")
        self.assertEqual(evicted, 1)
        self.assertIsNone(self.store.get(first, "run", "0"))
        self.assertEqual(self.store.get(second, "run", "other"), b"other")
        with self.assertRaises(StorageFull):
            self.store.acquire(None)
        self.time[0] = 80
        self.assertEqual(self.store.acquire(second), (second, False))
        self.time[0] = 101
        replacement, fresh = self.store.acquire(first)
        self.assertTrue(fresh)
        self.assertNotEqual(replacement, first)
        self.assertEqual(self.store.get(second, "run", "other"), b"other")

    def test_forged_tokens_are_replaced(self):
        token, fresh = self.store.acquire("0" * 64)
        self.assertTrue(fresh)
        self.assertNotEqual(token, "0" * 64)
        self.assertEqual(self.store.acquire(token), (token, False))

    def test_npz_roundtrip_retains_every_array_without_pickle(self):
        result = simulate(SimulationParameters.spatial_defaults(duration_ms=20))
        source = browser_result(result)["provenance"]
        data = encode_run(result, None, source)
        restored, baseline, restored_source = decode_run(data)
        self.assertIsNone(baseline)
        self.assertEqual(restored_source, source)
        for name, value in vars(result).items():
            if isinstance(value, np.ndarray):
                np.testing.assert_array_equal(value, getattr(restored, name))
        self.assertEqual(restored.parameters.to_dict(), result.parameters.to_dict())


if __name__ == "__main__":
    unittest.main()
