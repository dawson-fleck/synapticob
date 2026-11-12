"""Bounded anonymous-session storage for the hosted service, without pickle."""
from __future__ import annotations

from dataclasses import fields
from contextlib import contextmanager
import hashlib
import io
import json
import os
from pathlib import Path
import secrets
import sqlite3
import threading
import time

import numpy as np

from neurochemsim.parameters import SimulationParameters
from neurochemsim.results import SimulationResult


class StorageFull(RuntimeError):
    pass


def _jsonable(value):
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, dict):
        return {key: _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    return value


def encode_run(result, baseline, provenance):
    arrays, document = {}, {"provenance": provenance, "results": {}}
    for label, item in (("result", result), ("baseline", baseline)):
        if item is None:
            continue
        record = {"parameters": item.parameters.to_dict(), "pharmacology": _jsonable(item.pharmacology),
                  "arrays": [], "receptor_states": None}
        for field in fields(SimulationResult):
            value = getattr(item, field.name)
            if isinstance(value, np.ndarray):
                name = label + "/" + field.name
                arrays[name] = value
                record["arrays"].append(field.name)
        if item.receptor_states is not None:
            record["receptor_states"] = list(item.receptor_states)
            for name, value in item.receptor_states.items():
                arrays[label + "/states/" + name] = value
        document["results"][label] = record
    arrays["metadata_json"] = np.frombuffer(json.dumps(document, allow_nan=False, separators=(",", ":")).encode(), dtype=np.uint8)
    output = io.BytesIO()
    np.savez_compressed(output, **arrays)
    return output.getvalue()


def decode_run(data):
    restored = {}
    with np.load(io.BytesIO(data), allow_pickle=False) as archive:
        document = json.loads(archive["metadata_json"].tobytes())
        for label, record in document["results"].items():
            values = {name: archive[label + "/" + name] for name in record["arrays"]}
            values["parameters"] = SimulationParameters.from_dict(record["parameters"])
            values["pharmacology"] = record["pharmacology"]
            if record["receptor_states"] is not None:
                values["receptor_states"] = {name: archive[label + "/states/" + name]
                                              for name in record["receptor_states"]}
            restored[label] = SimulationResult(**values)
    return restored["result"], restored.get("baseline"), document["provenance"]


class SessionStore:
    """Session-owned rows; quotas never remove another active student's rows."""

    def __init__(self, directory: Path, *, ttl_seconds=14400, max_sessions=128,
                 max_session_bytes=64 * 1024 * 1024, max_total_bytes=1024 * 1024 * 1024,
                 clock=time.time):
        directory = Path(directory)
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.database = directory / "sessions.sqlite3"
        self.ttl_seconds, self.max_sessions = ttl_seconds, max_sessions
        self.max_session_bytes, self.max_total_bytes = max_session_bytes, max_total_bytes
        self.clock = clock
        self.lock = threading.RLock()
        with self._connection() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, touched REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS entries (
                    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                    kind TEXT NOT NULL, identifier TEXT NOT NULL, created REAL NOT NULL,
                    size INTEGER NOT NULL, data BLOB NOT NULL,
                    PRIMARY KEY(session_id, kind, identifier));
            """)
        try:
            os.chmod(self.database, 0o600)
        except OSError:
            pass

    @contextmanager
    def _connection(self):
        connection = sqlite3.connect(self.database, timeout=10)
        try:
            connection.execute("PRAGMA foreign_keys=ON")
            # A second hard ceiling bounds SQLite page allocation, including deleted rows.
            connection.execute(f"PRAGMA max_page_count={max(1024, self.max_total_bytes * 2 // 4096)}")
            with connection:
                yield connection
        finally:
            connection.close()

    @staticmethod
    def _key(token):
        return hashlib.sha256(token.encode("ascii")).hexdigest()

    def acquire(self, token):
        now = self.clock()
        with self.lock, self._connection() as db:
            db.execute("DELETE FROM sessions WHERE touched < ?", (now - self.ttl_seconds,))
            if token and len(token) == 64 and all(c in "0123456789abcdef" for c in token):
                key = self._key(token)
                if db.execute("SELECT 1 FROM sessions WHERE id=?", (key,)).fetchone():
                    db.execute("UPDATE sessions SET touched=? WHERE id=?", (now, key))
                    return token, False
            if db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] >= self.max_sessions:
                raise StorageFull("The classroom server is at its active-session limit. Please try again later; existing students' results have been preserved.")
            token = secrets.token_hex(32)
            db.execute("INSERT INTO sessions VALUES (?, ?)", (self._key(token), now))
            return token, True

    def put(self, token, kind, identifier, data):
        limit = {"run": 6, "sweep": 4}[kind]
        size, key = len(data), self._key(token)
        if size > self.max_session_bytes:
            raise StorageFull("This experiment is too large for the hosted result store. Use a shorter observation or fewer spatial cells; the timestep is never changed automatically.")
        with self.lock, self._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            if not db.execute("SELECT 1 FROM sessions WHERE id=?", (key,)).fetchone():
                raise StorageFull("Your browser session expired. Reload the page and run the experiment again.")
            existing = db.execute("SELECT size FROM entries WHERE session_id=? AND kind=? AND identifier=?", (key, kind, identifier)).fetchone()
            previous = existing[0] if existing else 0
            candidates = db.execute("SELECT identifier, size FROM entries WHERE session_id=? AND kind=? AND identifier<>? ORDER BY created ASC",
                                    (key, kind, identifier)).fetchall()
            evicted = candidates[:max(0, len(candidates) + 1 - limit)]
            own_bytes = db.execute("SELECT COALESCE(SUM(size),0) FROM entries WHERE session_id=?", (key,)).fetchone()[0]
            total_bytes = db.execute("SELECT COALESCE(SUM(size),0) FROM entries").fetchone()[0]
            freed = previous + sum(row[1] for row in evicted)
            if own_bytes - freed + size > self.max_session_bytes or total_bytes - freed + size > self.max_total_bytes:
                raise StorageFull("The hosted result store is full. Your previous saved results are unchanged. Please try later or use a shorter observation.")
            for entry, _ in evicted:
                db.execute("DELETE FROM entries WHERE session_id=? AND kind=? AND identifier=?", (key, kind, entry))
            db.execute("INSERT OR REPLACE INTO entries VALUES (?, ?, ?, ?, ?, ?)",
                       (key, kind, identifier, self.clock(), size, data))
            return len(evicted)

    def get(self, token, kind, identifier):
        with self.lock, self._connection() as db:
            row = db.execute("SELECT data FROM entries WHERE session_id=? AND kind=? AND identifier=?",
                             (self._key(token), kind, identifier)).fetchone()
            return row[0] if row else None
