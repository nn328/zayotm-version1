"""tscheck: Data Workspace — CSV upload (valid) and invalid/empty upload rejection (422 bad_csv)."""

import io

H = {"x-acting-user-id": "u-analyst-1"}


def test_upload_valid_csv_creates_dataset(client):
    csv_text = (
        "po_id,supplier_id,amount\n"
        "tscheck-po-1,tscheck-sup-1,100\n"
        "tscheck-po-2,tscheck-sup-2,200\n"
    )
    files = [("files", ("tscheck_upload.csv", io.BytesIO(csv_text.encode("utf-8")), "text/csv"))]
    res = client.post("/datasets/upload", headers=H, files=files)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["source"] == "upload"
    assert body["total_rows"] >= 2
    assert any("tscheck_upload" in f["file"] for f in body["files"])


def test_upload_empty_headerless_csv_returns_422_bad_csv(client):
    files = [("files", ("tscheck_bad.csv", io.BytesIO(b""), "text/csv"))]
    res = client.post("/datasets/upload", headers=H, files=files)
    assert res.status_code == 422, res.text
    err = res.json()["error"]
    assert err["code"] == "bad_csv"
