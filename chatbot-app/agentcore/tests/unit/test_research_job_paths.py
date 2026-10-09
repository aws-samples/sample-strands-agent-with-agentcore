import hashlib
import json

import pytest

from agent import research_jobs


@pytest.fixture
def local_store(tmp_path, monkeypatch):
    monkeypatch.delenv("DYNAMODB_USERS_TABLE", raising=False)
    monkeypatch.delenv("SESSION_ORCHESTRATION_TABLE", raising=False)
    monkeypatch.setattr(research_jobs, "get_sessions_dir", lambda: tmp_path / "sessions")
    return tmp_path / "sessions"


@pytest.mark.parametrize("invalid", ["../outside", "/tmp/outside", "a/b", "a\\b", "", ".", "a\x00b", "x" * 129])
@pytest.mark.parametrize("field", ["sessionId", "jobId"])
def test_rejects_invalid_ids_without_aliasing_other_jobs(local_store, invalid, field):
    record = {"userId": "user-1", "sessionId": "session-1", "jobId": "job-1"}
    record[field] = invalid
    with pytest.raises(ValueError, match="Invalid local research"):
        research_jobs._save_job(record)
    with pytest.raises(ValueError, match="Invalid local research"):
        research_jobs._get_job(record["userId"], record["sessionId"], record["jobId"])


def test_round_trip_uses_opaque_storage_keys(local_store):
    record = {"userId": "user-1", "sessionId": "session-1", "jobId": "job-1"}
    research_jobs._save_job(record)
    research_jobs._save_report(record, "# Report")
    paths = list(local_store.glob("research_jobs/*/*.json"))
    assert len(paths) == 1
    assert paths[0].stem == hashlib.sha256(b"job-1").hexdigest()
    assert research_jobs._get_job("user-1", "session-1", "job-1") == record
    assert research_jobs._load_report(record) == "# Report"
    assert research_jobs._list_jobs("user-1", "session-1") == [record]
    assert research_jobs._get_job("other-user", "session-1", "job-1") is None


def test_legacy_reads_preserve_files_and_new_records_take_precedence(local_store):
    directory = local_store / "session_session-1/research_jobs"
    directory.mkdir(parents=True)
    record = {"userId": "user-1", "sessionId": "session-1", "jobId": "job-1", "status": "queued"}
    metadata = directory / "job-1.json"
    metadata.write_text(json.dumps(record))
    (directory / "job-1.md").write_text("# Legacy report")
    assert research_jobs._get_job("user-1", "session-1", "job-1") == record
    assert research_jobs._load_report(record) == "# Legacy report"
    assert research_jobs._list_jobs("user-1", "session-1") == [record]
    updated = {**record, "status": "completed"}
    research_jobs._save_job(updated)
    assert research_jobs._get_job("user-1", "session-1", "job-1") == updated
    assert research_jobs._list_jobs("user-1", "session-1") == [updated]
    assert json.loads(metadata.read_text()) == record


@pytest.mark.parametrize("target", ["session", "directory", "metadata", "report"])
@pytest.mark.parametrize("legacy", [False, True])
def test_refuses_symlink_redirection(local_store, tmp_path, target, legacy):
    outside = tmp_path / "outside"
    outside.mkdir()
    if legacy:
        session = local_store / "session_session-1"
        directory = session / "research_jobs"
        job_name = "job-1"
    else:
        session = local_store / "research_jobs"
        directory = session / hashlib.sha256(b"session-1").hexdigest()
        job_name = hashlib.sha256(b"job-1").hexdigest()
    if target == "session":
        local_store.mkdir()
        session.symlink_to(outside, target_is_directory=True)
    elif target == "directory":
        session.mkdir(parents=True)
        directory.symlink_to(outside, target_is_directory=True)
    else:
        directory.mkdir(parents=True)
        suffix = "md" if target == "report" else "json"
        protected = outside / f"{job_name}.{suffix}"
        protected.write_text("protected")
        (directory / f"{job_name}.{suffix}").symlink_to(protected)
    record = {"userId": "user-1", "sessionId": "session-1", "jobId": "job-1"}
    if target == "report":
        with pytest.raises(ValueError, match="escapes"):
            research_jobs._load_report(record)
        if not legacy:
            with pytest.raises(ValueError, match="escapes"):
                research_jobs._save_report(record, "overwrite")
    else:
        with pytest.raises(ValueError, match="escapes"):
            research_jobs._get_job("user-1", "session-1", "job-1")
        if not legacy:
            with pytest.raises(ValueError, match="escapes"):
                research_jobs._save_job(record)
    if target in ("metadata", "report"):
        assert protected.read_text() == "protected"


def test_listing_skips_symlinks_and_mismatched_job_records(local_store, tmp_path):
    directory = research_jobs._local_job_dir("session-1")
    record = {"userId": "user-1", "sessionId": "session-1", "jobId": "job-1"}
    outside = tmp_path / "external.json"
    outside.write_text(json.dumps(record))
    (directory / "linked.json").symlink_to(outside)
    wrong_path = research_jobs._local_job_path("session-1", "job-2")
    wrong_path.write_text(json.dumps(record))
    assert research_jobs._list_jobs("user-1", "session-1") == []
    assert research_jobs._get_job("user-1", "session-1", "job-2") is None
