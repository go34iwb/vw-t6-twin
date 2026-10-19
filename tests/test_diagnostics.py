import json
import shutil
import sqlite3
import threading
import unittest
import uuid
from pathlib import Path
from contextlib import closing
from types import SimpleNamespace
from unittest.mock import Mock, patch

from pi import collector
from server import export_json, ingest


class DiagnosticsTests(unittest.TestCase):
    def setUp(self):
        # Keep all test DBs and WAL sidecars inside the project.
        self.root = Path(__file__).resolve().parent / (".runtime-" + uuid.uuid4().hex)
        self.root.mkdir()
        self.addCleanup(shutil.rmtree, self.root)
        self.path = str(self.root / "telemetry.db")
        self.db = collector.open_db(self.path)
        self.addCleanup(self.db.close)

    def snapshot(self, ts=123, status="ok", codes=None, mil=None, error=None):
        collector.store_diagnostics(
            self.db, ts, status, codes=codes, mil=mil, error=error)
        return export_json.fetch_diagnostics(self.db)

    def fake_obd(self, codes, mil=True, supports=True, query_error=None):
        commands = SimpleNamespace(GET_DTC=object(), STATUS=object())
        connection = Mock()
        connection.supports.return_value = supports
        dtc = Mock()
        dtc.is_null.return_value = codes is None
        dtc.value = codes
        status = Mock()
        status.is_null.return_value = False
        status.value = SimpleNamespace(MIL=mil)
        connection.query.side_effect = query_error or [dtc, status]
        return SimpleNamespace(commands=commands), connection

    def test_collector_and_master_migrate_old_database_without_changing_telemetry(self):
        old_path = str(self.root / "old.db")
        with closing(sqlite3.connect(old_path)) as conn, conn:
            conn.execute(ingest.SCHEMA)
            conn.execute(
                "INSERT INTO telemetry (ts, source, rpm) VALUES (1, 'obd', 850)")
        for opener in (collector.open_db, ingest.open_db, collector.open_db):
            conn = opener(old_path)
            try:
                self.assertEqual(conn.execute(
                    "SELECT ts, source, rpm FROM telemetry").fetchall(),
                    [(1, "obd", 850.0)])
                self.assertEqual(conn.execute(
                    "SELECT COUNT(*) FROM diagnostics").fetchone()[0], 0)
                self.assertEqual(conn.execute(
                    "PRAGMA journal_mode").fetchone()[0], "wal")
            finally:
                conn.close()

    def test_legacy_database_exports_unavailable(self):
        conn = sqlite3.connect(":memory:")
        self.addCleanup(conn.close)
        conn.execute(ingest.SCHEMA)
        self.assertEqual(export_json.fetch_diagnostics(conn), {
            "status": "unavailable", "checked_at": None, "mil": None,
            "codes": [], "error": None})

    def test_empty_diagnostics_table_is_not_empty_success(self):
        self.assertEqual(export_json.fetch_diagnostics(self.db)["status"],
                         "unavailable")

    def test_successful_empty_codes_and_false_mil(self):
        result = self.snapshot(codes=[], mil=False)
        self.assertEqual(result, {
            "status": "ok", "checked_at": 123, "mil": False,
            "codes": [], "error": None, "source": "obd"})

    def test_null_codes_never_export_success(self):
        result = self.snapshot(codes=None)
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["checked_at"], 123)
        self.assertEqual(result["codes"], [])

    def test_freshest_failure_is_not_masked_by_older_success(self):
        self.snapshot(ts=120, codes=[{"code": "P0301", "description": "From ECU"}])
        for status in ("unavailable", "error"):
            with self.subTest(status=status):
                result = self.snapshot(ts=123, status=status, error="No response")
                self.assertEqual(result["status"], status)
                self.assertEqual(result["checked_at"], 123)
                self.assertEqual(result["codes"], [])
                self.assertEqual(result["error"], "No response")
                self.assertIsNone(result["mil"])

    def test_descriptions_are_preserved_and_missing_description_is_not_invented(self):
        result = self.snapshot(codes=[
            {"code": "P0301", "description": "Library description"},
            {"code": "P1234", "description": ""}])
        self.assertEqual(result["codes"], [
            {"code": "P0301", "description": "Library description",
             "component": "engine"},
            {"code": "P1234", "description": "", "component": "unknown"}])

    def test_component_mapping_is_conservative(self):
        expected = {
            "P0301": "engine", "P0700": "transmission", "P0171": "fuel",
            "P0118": "cooling", "P0128": "cooling", "P0420": "exhaust",
            "P2002": "exhaust", "P2201": "exhaust", "P0562": "electrical",
            "P1234": "unknown", "P1301": "unknown", "P242F": "unknown",
            "P3001": "unknown", "B0301": "unknown", "C0301": "unknown",
            "U0100": "unknown", "P0480": "unknown", "P0234": "unknown",
            "P0A80": "unknown", "P030A": "unknown", "invalid": "unknown",
        }
        for code, component in expected.items():
            with self.subTest(code=code):
                self.assertEqual(export_json.diagnostic_component(code), component)

    def test_malformed_snapshot_exports_error_with_attempt_timestamp(self):
        for codes in ('not json', '{}', '[{"code": "bad", "description": ""}]'):
            with self.subTest(codes=codes):
                self.db.execute(
                    "INSERT OR REPLACE INTO diagnostics VALUES (?, ?, ?, ?, ?, ?)",
                    (123, "obd", "ok", None, codes, None))
                result = export_json.fetch_diagnostics(self.db)
                self.assertEqual(result["status"], "error")
                self.assertEqual(result["checked_at"], 123)
                self.assertTrue(result["error"])
                self.assertEqual(result["codes"], [])

    def test_collect_reads_only_mode03_and_status(self):
        obd, connection = self.fake_obd([("P0301", "Library description")])
        with patch.object(collector, "obd", obd), patch.object(
                collector.time, "time", return_value=456):
            collector.collect_diagnostics(self.db, connection)
        self.assertEqual(connection.query.call_args_list,
                         [unittest.mock.call(obd.commands.GET_DTC),
                          unittest.mock.call(obd.commands.STATUS)])
        result = export_json.fetch_diagnostics(self.db)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["checked_at"], 456)
        self.assertIs(result["mil"], True)

    def test_collect_confirms_empty_codes(self):
        obd, connection = self.fake_obd([], mil=False)
        with patch.object(collector, "obd", obd):
            collector.collect_diagnostics(self.db, connection)
        result = export_json.fetch_diagnostics(self.db)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["codes"], [])
        self.assertIs(result["mil"], False)

    def test_collect_null_unsupported_errors_and_invalid_data_never_succeed(self):
        cases = [
            (None, True, None, "unavailable"),
            ([], False, None, "unavailable"),
            ([], True, RuntimeError("Adapter timeout"), "error"),
            ("unexpected", True, None, "error"),
            ([("bad", "description")], True, None, "error"),
            ([("P0301", object())], True, None, "error"),
        ]
        for codes, supported, exc, expected in cases:
            with self.subTest(codes=codes, supported=supported, exc=exc):
                obd, connection = self.fake_obd(
                    codes, supports=supported, query_error=exc)
                with patch.object(collector, "obd", obd), self.assertLogs(
                        "collector", level="ERROR"):
                    collector.collect_diagnostics(self.db, connection)
                result = export_json.fetch_diagnostics(self.db)
                self.assertEqual(result["status"], expected)
                self.assertIsInstance(result["checked_at"], int)
                self.assertTrue(result["error"])
                self.assertEqual(result["codes"], [])

    def test_optional_mil_failure_does_not_hide_confirmed_codes(self):
        for failure in ("unsupported", "null", "exception", "invalid"):
            with self.subTest(failure=failure):
                obd, connection = self.fake_obd([], mil=None)
                if failure == "unsupported":
                    connection.supports.side_effect = [True, False]
                elif failure == "null":
                    response = Mock(value=None)
                    response.is_null.return_value = True
                    dtc = Mock(value=[])
                    dtc.is_null.return_value = False
                    connection.query.side_effect = [dtc, response]
                elif failure == "exception":
                    dtc = Mock(value=[])
                    dtc.is_null.return_value = False
                    connection.query.side_effect = [dtc, RuntimeError("STATUS timeout")]
                with patch.object(collector, "obd", obd), self.assertLogs("collector"):
                    collector.collect_diagnostics(self.db, connection)
                result = export_json.fetch_diagnostics(self.db)
                self.assertEqual(result["status"], "ok")
                self.assertIsNone(result["mil"])
                self.assertIsNone(result["error"])

    def test_merge_snapshot_idempotency_and_same_second_failure_update(self):
        self.snapshot(codes=[], mil=True)
        master_path = str(self.root / "master.db")
        with patch.object(ingest, "MASTER", master_path):
            self.assertEqual(ingest.merge(self.path), 1)
            self.assertEqual(ingest.merge(self.path), 0)
            self.snapshot(status="error", error="Disconnected")
            self.assertEqual(ingest.merge(self.path), 1)
            self.assertEqual(ingest.merge(self.path), 0)
        with closing(sqlite3.connect(master_path)) as conn:
            self.assertEqual(conn.execute(
                "SELECT COUNT(*) FROM diagnostics").fetchone()[0], 1)
            self.assertEqual(export_json.fetch_diagnostics(conn)["status"], "error")

    def test_merge_old_source_does_not_mutate_it_or_remove_diagnostics(self):
        incoming = self.root / "legacy.db"
        with closing(sqlite3.connect(incoming)) as conn, conn:
            conn.execute(ingest.SCHEMA)
            conn.execute(
                "INSERT INTO telemetry (ts, source, rpm) VALUES (1, 'obd', 850)")
        before = incoming.read_bytes()
        self.snapshot(codes=[])
        with patch.object(ingest, "MASTER", self.path):
            ingest.merge(str(incoming))
        self.assertEqual(incoming.read_bytes(), before)
        self.assertEqual(export_json.fetch_diagnostics(self.db)["status"], "ok")
        self.assertEqual(self.db.execute(
            "SELECT rpm FROM telemetry WHERE ts=1").fetchone()[0], 850)

    def test_merge_preserves_latest_attempt_across_out_of_order_files(self):
        master_path = str(self.root / "master.db")
        self.snapshot(ts=200, status="error", error="Timeout")
        with patch.object(ingest, "MASTER", master_path):
            ingest.merge(self.path)
            self.db.execute("DELETE FROM diagnostics")
            self.snapshot(ts=100, codes=[])
            ingest.merge(self.path)
        with closing(sqlite3.connect(master_path)) as conn:
            self.assertEqual(export_json.fetch_diagnostics(conn)["checked_at"], 200)
            self.assertEqual(export_json.fetch_diagnostics(conn)["status"], "error")

    def test_worker_connection_is_created_in_its_own_thread(self):
        errors = []

        def worker(conn):
            try:
                collector.store_diagnostics(conn, 777, "ok", codes=[])
            except Exception as exc:
                errors.append(exc)

        with patch.object(collector, "DB_PATH", self.path):
            thread = threading.Thread(target=collector.run_worker, args=(worker,))
            thread.start()
            thread.join(timeout=5)
        self.assertFalse(thread.is_alive())
        self.assertEqual(errors, [])
        self.assertEqual(export_json.fetch_diagnostics(self.db)["checked_at"], 777)

    def test_worker_schedules_diagnostics_independently_of_telemetry_polling(self):
        commands = SimpleNamespace(**{
            name: SimpleNamespace(name=name) for name in
            ("RPM", "SPEED", "COOLANT_TEMP", "ELM_VOLTAGE", "FUEL_LEVEL")})
        connection = Mock()
        connection.is_connected.side_effect = [True, True, True, True, False]
        connection.query.return_value.is_null.return_value = True
        obd = SimpleNamespace(
            commands=commands, OBD=Mock(side_effect=[connection, KeyboardInterrupt]))
        with patch.object(collector, "obd", obd), patch.object(
                collector, "collect_diagnostics") as collect, patch.object(
                collector, "DIAGNOSTIC_INTERVAL_S", 60), patch.object(
                collector.time, "monotonic", side_effect=[0, 0, 59, 60, 60]), patch.object(
                collector.time, "sleep"), self.assertRaises(KeyboardInterrupt):
            collector.obd_worker(self.db)
        self.assertEqual(collect.call_count, 2)
        self.assertEqual(connection.query.call_count, 15)

    def test_invalid_snapshot_timestamp_never_exports_ok(self):
        result = self.snapshot(ts=0, codes=[])
        self.assertEqual(result["status"], "error")
        self.assertIsNone(result["checked_at"])

    def test_export_main_retains_telemetry_fields_and_adds_contract(self):
        self.db.execute(
            "INSERT INTO telemetry (ts, source, rpm) VALUES (?, 'obd', 850)",
            (int(collector.time.time()),))
        self.snapshot(codes=[], mil=False)
        with patch.object(export_json, "MASTER_DB", self.path), patch.object(
                export_json, "DATA_DIR", str(self.root)), patch.object(
                export_json, "GIT_PUSH", False):
            export_json.main()
        payload = json.loads((self.root / "latest.json").read_text())
        self.assertEqual(set(payload), {
            "generated_at", "obd_last_24h", "gps_last_24h",
            "obd_last_7d", "diagnostics"})
        self.assertEqual(set(payload["obd_last_24h"][0]), {
            "ts", "rpm", "speed_kmh", "coolant_c", "battery_v",
            "fuel_pct", "lat", "lon", "alt_m"})
        self.assertEqual(payload["obd_last_24h"][0]["rpm"], 850)
        self.assertEqual(payload["diagnostics"]["status"], "ok")

    def test_collection_to_ingest_to_json_keeps_latest_failure(self):
        obd, connection = self.fake_obd([("P0420", "Library description")])
        with patch.object(collector, "obd", obd), patch.object(
                collector.time, "time", return_value=100):
            collector.collect_diagnostics(self.db, connection)
        obd, connection = self.fake_obd(
            [], query_error=RuntimeError("Adapter timeout"))
        with patch.object(collector, "obd", obd), patch.object(
                collector.time, "time", return_value=200), self.assertLogs("collector"):
            collector.collect_diagnostics(self.db, connection)
        master_path = str(self.root / "master.db")
        with patch.object(ingest, "MASTER", master_path):
            ingest.merge(self.path)
        with patch.object(export_json, "MASTER_DB", master_path), patch.object(
                export_json, "DATA_DIR", str(self.root)), patch.object(
                export_json, "GIT_PUSH", False):
            export_json.main()
        payload = json.loads((self.root / "latest.json").read_text())
        self.assertEqual(payload["diagnostics"], {
            "status": "error", "checked_at": 200, "mil": None,
            "codes": [], "error": "Adapter timeout", "source": "obd"})

    def test_failed_diagnostic_merge_rolls_back_telemetry_too(self):
        incoming = self.root / "invalid.db"
        with closing(sqlite3.connect(incoming)) as conn, conn:
            conn.execute(ingest.SCHEMA)
            conn.execute(
                "INSERT INTO telemetry (ts, source, rpm) VALUES (1, 'obd', 850)")
            conn.execute(
                "CREATE TABLE diagnostics "
                "(ts, source, status, mil, codes_json, error)")
            conn.execute(
                "INSERT INTO diagnostics VALUES (1, 'obd', 'invalid', NULL, NULL, NULL)")
        with patch.object(ingest, "MASTER", self.path):
            with self.assertRaises(sqlite3.IntegrityError):
                ingest.merge(str(incoming))
        self.assertEqual(self.db.execute(
            "SELECT COUNT(*) FROM telemetry").fetchone()[0], 0)
        self.assertEqual(self.db.execute(
            "SELECT COUNT(*) FROM diagnostics").fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main()
