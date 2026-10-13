"""Regression coverage for the redesigned workspace's export contract."""
import os
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

_data = tempfile.TemporaryDirectory(prefix="clipline-export-contract-")
os.environ.update(CLIPLINE_DATA=_data.name, CLIPLINE_DB=str(Path(_data.name) / "test.db"))

from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import select
from app.db import SessionLocal, init_db
from app.models import Source, VideoSegment, ExportJob
from app.schemas import ExportCreate
from app.services.exports import create_export_job, run_export_job, run_ffmpeg, mark_interrupted_exports
from app.services.timeline import indexed_segments_for_range


class WorkspaceExports(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        with SessionLocal() as db:
            db.add(Source(id="source", name="Test", path=_data.name, created_at="2026-10-08", updated_at="2026-10-08"))
            for index in range(3):
                db.add(VideoSegment(id=f"segment-{index}", source_id="source", filename=f"{index}.mp4", path=str(Path(_data.name) / f"{index}.mp4"), size_bytes=100, start_time=f"2026-10-08T09:{index:02d}:00+08:00", end_time=f"2026-10-08T09:{index:02d}:10+08:00", duration_seconds=10, scan_status="indexed", created_at="2026-10-08", updated_at="2026-10-08"))
            db.add(VideoSegment(id="utc-midnight", source_id="source", filename="midnight.mp4", path="midnight.mp4", size_bytes=100, start_time="2026-10-07T16:30:00+00:00", end_time="2026-10-07T16:30:10+00:00", duration_seconds=10, scan_status="indexed", created_at="2026-10-08", updated_at="2026-10-08"))
            db.commit()

    def payload(self, **overrides):
        return ExportCreate(**({"sourceId": "source", "startTime": "2026-10-08T01:00:00+00:00", "endTime": "2026-10-08T01:02:10+00:00", "fileName": "选择的录像.mp4", "segmentIds": ["segment-0", "segment-2"]} | overrides))

    def test_equivalent_timezone_ranges(self):
        with SessionLocal() as db:
            items = indexed_segments_for_range(db, "source", datetime.fromisoformat("2026-10-08T01:00:05+00:00"), datetime.fromisoformat("2026-10-08T01:00:08+00:00"))
            self.assertEqual([item.id for item in items], ["segment-0"])
            items = indexed_segments_for_range(db, "source", datetime.fromisoformat("2026-10-08T09:00:05+08:00"), datetime.fromisoformat("2026-10-08T09:00:08+08:00"))
            self.assertEqual([item.id for item in items], ["segment-0"])

    def test_selected_segments_and_safe_filename(self):
        tasks = BackgroundTasks()
        with SessionLocal() as db:
            job = create_export_job(db, self.payload(), tasks)
            export_id = job.id
            self.assertEqual(Path(job.output_path).name, "选择的录像.mp4")
            self.assertEqual(job.gap_duration_seconds, 110)
            self.assertEqual(tasks.tasks[0].args, (export_id, ["segment-0", "segment-2"]))
        calls = []
        def trim(input_path, output, offset, duration, mode):
            calls.append(input_path.name)
            output.write_bytes(b"test-part")
        def concat(_list, output, _mode):
            output.write_bytes(b"test-export")
        with patch("app.services.exports.trim_segment", side_effect=trim), patch("app.services.exports.concat_segments", side_effect=concat):
            run_export_job(export_id, ["segment-0", "segment-2"])
        self.assertEqual(calls, ["0.mp4", "2.mp4"])
        with SessionLocal() as db:
            self.assertEqual(db.get(ExportJob, export_id).status, "completed")

    def test_local_day_includes_utc_recording_from_previous_calendar_day(self):
        with SessionLocal() as db:
            items = indexed_segments_for_range(db, "source", datetime.fromisoformat("2026-10-08T00:00:00+08:00"), datetime.fromisoformat("2026-10-09T00:00:00+08:00"))
            self.assertEqual([item.id for item in items], ["utc-midnight", "segment-0", "segment-1", "segment-2"])

    def test_reject_path_traversal_and_invalid_selection(self):
        for overrides in [{"fileName": "../escape.mp4"}, {"fileName": "bad/name"}, {"fileName": ""}, {"segmentIds": []}, {"segmentIds": ["unknown"]}]:
            with self.subTest(overrides=overrides), SessionLocal() as db:
                with self.assertRaises(HTTPException) as error:
                    create_export_job(db, self.payload(**overrides), BackgroundTasks())
                self.assertEqual(error.exception.status_code, 400)

    def test_legacy_export_and_unique_names(self):
        with SessionLocal() as db:
            legacy = create_export_job(db, self.payload(fileName=None, segmentIds=None), BackgroundTasks())
            self.assertIsNone(legacy.output_path)
            a = create_export_job(db, self.payload(), BackgroundTasks())
            b = create_export_job(db, self.payload(), BackgroundTasks())
            self.assertNotEqual(a.output_path, b.output_path)

    def test_restart_marks_only_interrupted_jobs_failed(self):
        with SessionLocal() as db:
            for status in ['queued', 'running', 'completed', 'failed']:
                db.add(ExportJob(id=f'restart-{status}', source_id='source', start_time='2026-10-08T09:00:00+08:00', end_time='2026-10-08T09:00:08+08:00', mode='accurate', status=status, progress=0, has_gaps=0, gap_duration_seconds=0, created_at='2026-10-08', updated_at='2026-10-08'))
            db.commit()
        self.assertGreaterEqual(mark_interrupted_exports(), 2)
        with SessionLocal() as db:
            for status in ['queued', 'running']:
                job = db.get(ExportJob, f'restart-{status}')
                self.assertEqual(job.status, 'failed')
                self.assertIn('服务重启', job.error_message)
            self.assertEqual(db.get(ExportJob, 'restart-completed').status, 'completed')
            self.assertEqual(db.get(ExportJob, 'restart-failed').status, 'failed')

    def test_ffmpeg_bounds_decode_filter_and_encode_threads(self):
        with patch('app.services.exports.subprocess.run') as run:
            run.return_value.returncode = 0
            run_ffmpeg(['ffmpeg', '-y', '-i', 'original.mp4', '-c:v', 'libx264', 'export.mp4'])
        command = run.call_args.args[0]
        self.assertEqual(command[-1], 'export.mp4')
        self.assertEqual(command[:5], ['ffmpeg', '-threads', '2', '-filter_threads', '2'])
        self.assertEqual(command[-3:-1], ['-threads', '2'])


if __name__ == "__main__":
    unittest.main()
