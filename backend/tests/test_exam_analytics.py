import os
import sys

os.environ.update(
    APPS_SCRIPT_URL="http://sheets.test/exec",
    SECRET_KEY="analytics-test",
    APPS_SCRIPT_SECRET="analytics-secret",
    WARMUP="0",
)
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import pytest
import app as A


EXAM_QUESTIONS = [
    {"questionID": "q1", "questionText": "Question one", "desiredAnswer": "Reference one", "totalMarks": 5},
    {"questionID": "q2", "questionText": "Question two", "desiredAnswer": "Reference two", "totalMarks": 5},
]


class FakeResponse:
    def __init__(self, data):
        self.data = data

    def json(self):
        return self.data


@pytest.fixture
def client(monkeypatch):
    calls = []

    def fake_post(url, params=None, json=None, timeout=None):
        calls.append(json)
        endpoint = json["endpoint"]
        if endpoint == "getExams":
            return FakeResponse({"status": "ok", "exams": [
                {"examID": "exam-1", "subjectName": "Science", "moduleName": "Plants",
                 "questionCount": 2, "totalMarks": 10, "createdAt": "2026-01-01T10:00:00Z"}
            ]})
        if endpoint == "getQuestions":
            return FakeResponse({"status": "ok", "questions": EXAM_QUESTIONS})
        if endpoint == "postQuestions":
            return FakeResponse({"status": "ok", "examID": "new-exam"})
        if endpoint == "getResults":
            return FakeResponse({
                "status": "ok",
                "exam": {"examID": "exam-1", "subjectName": "Science", "moduleName": "Plants"},
                "questions": [
                    {"questionID": "q1", "questionText": "Question one", "totalMarks": 5},
                    {"questionID": "q2", "questionText": "Question two", "totalMarks": 5},
                ],
                "submissions": [
                    {"submissionID": "low", "studentEmail": "low@example.com",
                     "submittedAt": "2026-01-02T10:00:00Z", "answers": [
                         {"questionID": "q1", "questionText": "Question one", "answer": "partial",
                          "score": 2, "totalMarks": 5},
                         {"questionID": "q2", "questionText": "Question two", "answer": "",
                          "score": 0, "totalMarks": 5},
                     ]},
                    {"submissionID": "high", "studentEmail": "high@example.com",
                     "submittedAt": "2026-01-02T11:00:00Z", "answers": [
                         {"questionID": "q1", "questionText": "Question one", "answer": "full",
                          "score": 5, "totalMarks": 5},
                         {"questionID": "q2", "questionText": "Question two", "answer": "partial",
                          "score": 3, "totalMarks": 5},
                     ]},
                ],
            })
        return FakeResponse({"status": "ok"})

    monkeypatch.setattr(A.requests, "post", fake_post)
    monkeypatch.setattr(A, "score_answers", lambda pairs: [round(pair[2] / 2, 2) for pair in pairs])
    A._hits.clear()
    A._used.clear()
    test_client = A.app.test_client()
    test_client.calls = calls
    return test_client


def auth(client, role):
    body = {"email": "teacher@example.com" if role == "teacher" else "student@example.com"}
    if role == "teacher":
        body["password"] = "pw"
    response = client.post(f"/api/{role}/login", json=body)
    assert response.status_code == 200
    return {"Authorization": "Bearer " + response.get_json()["token"]}


def test_question_setup_stores_subject_and_module(client):
    headers = auth(client, "teacher")
    response = client.post("/api/questions", headers=headers, json={
        "subjectName": "Science",
        "moduleName": "Plants",
        "questions": [{"questionText": "Q", "desiredAnswer": "A", "totalMarks": 4}],
    })
    assert response.status_code == 200
    assert response.get_json()["examID"] == "new-exam"
    saved = next(call for call in client.calls if call["endpoint"] == "postQuestions")
    assert saved["subjectName"] == "Science"
    assert saved["moduleName"] == "Plants"


def test_students_receive_exam_list_and_questions_without_references(client):
    headers = auth(client, "student")
    exams = client.get("/api/exams", headers=headers)
    assert exams.get_json()["exams"][0]["moduleName"] == "Plants"
    response = client.get("/api/questions?exam_id=exam-1", headers=headers)
    assert response.status_code == 200
    assert "desiredAnswer" not in response.get_data(as_text=True)
    assert len(response.get_json()["questions"]) == 2


def test_submission_is_scoped_to_exam_and_saved_with_reporting_fields(client):
    headers = auth(client, "student")
    response = client.post("/api/submit", headers=headers, json={
        "examID": "exam-1", "answers": [{"questionID": "q1", "answer": "student answer"}],
    })
    assert response.status_code == 200
    payload = next(call for call in client.calls if call["endpoint"] == "submitResponses")
    assert payload["examID"] == "exam-1"
    assert payload["submissionID"] == response.get_json()["submissionID"]
    assert [answer["totalMarks"] for answer in payload["responses"]] == [5, 5]
    assert client.post("/api/submit", headers=headers, json={
        "examID": "exam-1", "answers": [],
    }).status_code == 409


def test_teacher_report_ranks_and_analyzes_question_scores(client):
    response = client.get("/api/teacher/reports?exam_id=exam-1", headers=auth(client, "teacher"))
    assert response.status_code == 200
    report = response.get_json()
    assert report["summary"] == {
        "submissionCount": 2, "averagePercent": 50.0,
        "highestPercent": 80.0, "lowestPercent": 20.0,
    }
    assert report["submissions"][0]["studentEmail"] == "high@example.com"
    assert report["submissions"][0]["rank"] == 1
    assert report["submissions"][1]["studentEmail"] == "low@example.com"
    assert report["questions"][0]["average"] == 3.5
    assert report["questions"][0]["full"] == 1
    assert report["questions"][1]["zero"] == 1


def test_students_cannot_read_teacher_reports(client):
    response = client.get("/api/teacher/reports?exam_id=exam-1", headers=auth(client, "student"))
    assert response.status_code == 403
