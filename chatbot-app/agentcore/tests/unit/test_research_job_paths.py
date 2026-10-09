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


def test_keeps_existing_valid_job_and_report_paths(local_store):
    record = {"userId": "user-1", "sessionId": "session-1", "jobId": "job-1"}
    research_jobs._save_job(record)
    research_jobs._save_report(record, "# Existing report")
    assert (local_store / "session_session-1/research_jobs/job-1.json").exists()
    assert research_jobs._get_job("user-1", "session-1", "job-1") == record
    assert research_jobs._load_report(record) == "# Existing report"
    assert research_jobs._list_jobs("user-1", "session-1") == [record]
    assert research_jobs._get_job("other-user", "session-1", "job-1") is None


@pytest.mark.parametrize("target", ["session", "directory", "metadata", "report"])
def test_refuses_symlink_redirection(local_store, tmp_path, target):
    outside = tmp_path / "outside"
    outside.mkdir()
    session = local_store / "session_session-1"
    directory = session / "research_jobs"
    if target == "session":
        local_store.mkdir()
        session.symlink_to(outside, target_is_directory=True)
    elif target == "directory":
        session.mkdir(parents=True)
        directory.symlink_to(outside, target_is_directory=True)
    else:
        directory.mkdir(parents=True)
        suffix = "md" if target == "report" else "json"
        protected = outside / f"job-1.{suffix}"
        protected.write_text("protected")
        (directory / f"job-1.{suffix}").symlink_to(protected)
    record = {"userId": "user-1", "sessionId": "session-1", "jobId": "job-1"}
    if target == "report":
        with pytest.raises(ValueError, match="escapes"):
            research_jobs._load_report(record)
        with pytest.raises(ValueError, match="escapes"):
            research_jobs._save_report(record, "overwrite")
    else:
        with pytest.raises(ValueError, match="escapes"):
            research_jobs._get_job("user-1", "session-1", "job-1")
        with pytest.raises(ValueError, match="escapes"):
            research_jobs._save_job(record)
    if target in ("metadata", "report"):
        assert protected.read_text() == "protected"


def test_listing_skips_symlinks_and_mismatched_job_records(local_store, tmp_path):
    directory = research_jobs._local_job_dir("session-1")
    record = {"userId": "user-1", "sessionId": "session-1", "jobId": "job-1"}
    outside = tmp_path / "external.json"
    outside.write_text(json.dumps(record))
    (directory / "job-1.json").symlink_to(outside)
    (directory / "job-2.json").write_text(json.dumps(record))
    assert research_jobs._list_jobs("user-1", "session-1") == []
    assert research_jobs._get_job("user-1", "session-1", "job-2") is None
