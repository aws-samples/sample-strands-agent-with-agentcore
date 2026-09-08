from streaming.agui_event_processor import ensure_unique_document_names


def _document(name: str) -> dict:
    return {
        "document": {
            "format": "pdf",
            "name": name,
            "source": {"bytes": b"pdf"},
        }
    }


def test_renames_document_reuploaded_in_later_turn():
    messages = [
        {"role": "user", "content": [{"text": "first"}, _document("report")]},
        {"role": "assistant", "content": [{"text": "done"}]},
    ]
    current_message = [{"text": "updated"}, _document("report")]

    renamed = ensure_unique_document_names(messages, current_message)

    assert renamed == 1
    assert messages[0]["content"][1]["document"]["name"] == "report"
    assert current_message[1]["document"]["name"] == "report-2"


def test_renames_duplicates_already_present_in_history():
    messages = [
        {"role": "user", "content": [_document("report")]},
        {"role": "user", "content": [_document("report")]},
    ]

    renamed = ensure_unique_document_names(messages, "no attachment")

    assert renamed == 1
    assert messages[1]["content"][0]["document"]["name"] == "report-2"


def test_avoids_existing_suffixes_and_case_insensitive_collisions():
    messages = [
        {"role": "user", "content": [_document("Report")]},
        {"role": "user", "content": [_document("report-2")]},
    ]
    current_message = [_document("report")]

    renamed = ensure_unique_document_names(messages, current_message)

    assert renamed == 1
    assert current_message[0]["document"]["name"] == "report-3"


def test_leaves_unique_documents_unchanged():
    messages = [{"role": "user", "content": [_document("first")]}]
    current_message = [_document("second")]

    renamed = ensure_unique_document_names(messages, current_message)

    assert renamed == 0
    assert current_message[0]["document"]["name"] == "second"
