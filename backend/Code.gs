const SHEETS = {
  Students: ["email"],
  Teachers: ["email", "salt", "passwordHash"],
  Exams: ["examID", "subjectName", "moduleName", "teacherEmail", "createdAt"],
  Questions: ["questionID", "questionText", "desiredAnswer", "totalMarks", "teacherEmail", "examID"],
  Responses: ["timestamp", "studentEmail", "questionID", "studentAnswer", "score", "submissionID", "examID", "totalMarks"]
};

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json({ status: "error", message: "Expected a JSON request." });
    }
    const data = JSON.parse(e.postData.contents);
    const secret = PropertiesService.getScriptProperties().getProperty("API_SECRET");
    if (!secret || data.secret !== secret) {
      return json({ status: "error", message: "Unauthorized" });
    }

    switch (data.endpoint) {
      case "studentLogin": return studentLogin(data);
      case "teacherLogin": return teacherLogin(data);
      case "postQuestions": return postQuestions(data);
      case "getExams": return getExams(data);
      case "getQuestions": return getQuestions(data);
      case "submitResponses": return submitResponses(data);
      case "getResults": return getResults(data);
      default: return json({ status: "error", message: "Unknown endpoint." });
    }
  } catch (err) {
    console.error(err);
    return json({ status: "error", message: "Request failed. Check the Apps Script execution log." });
  }
}

function json(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("Open this script from the spreadsheet using Extensions > Apps Script.");

  const headers = SHEETS[name];
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    return sheet;
  }

  const existingCount = sheet.getLastColumn();
  const actual = sheet.getRange(1, 1, 1, existingCount).getValues()[0];
  if (existingCount > headers.length || actual.some((value, i) => value !== headers[i])) {
    throw new Error("Unexpected headers in the " + name + " sheet.");
  }
  if (existingCount < headers.length) {
    sheet.getRange(1, existingCount + 1, 1, headers.length - existingCount)
      .setValues([headers.slice(existingCount)]);
  }
  return sheet;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function findEmailRow(sheet, email) {
  if (sheet.getLastRow() < 2) return -1;
  const emails = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  const index = emails.findIndex(row => normalizeEmail(row[0]) === email);
  return index < 0 ? -1 : index + 2;
}

function studentLogin(data) {
  const email = normalizeEmail(data.email);
  if (findEmailRow(getSheet("Students"), email) < 0) {
    return json({ status: "error", message: "Student email is not registered." });
  }
  return json({ status: "ok" });
}

function teacherLogin(data) {
  const email = normalizeEmail(data.email);
  const sheet = getSheet("Teachers");
  const row = findEmailRow(sheet, email);
  if (row < 0) return json({ status: "error", message: "Invalid credentials." });

  const [, salt, storedHash] = sheet.getRange(row, 1, 1, 3).getValues()[0];
  if (hashPassword(String(data.password || ""), String(salt)) !== storedHash) {
    return json({ status: "error", message: "Invalid credentials." });
  }
  return json({ status: "ok" });
}

function postQuestions(data) {
  const subject = String(data.subjectName || "").trim();
  const moduleName = String(data.moduleName || "").trim();
  const questions = data.questions;
  if (!subject || !moduleName || !Array.isArray(questions) || !questions.length) {
    return json({ status: "error", message: "Subject, module, and questions are required." });
  }

  const examID = Utilities.getUuid();
  const teacherEmail = normalizeEmail(data.teacherEmail);
  const exams = getSheet("Exams");
  const questionSheet = getSheet("Questions");
  const now = new Date();
  const questionRows = questions.map(q => [
    Utilities.getUuid(),
    String(q.questionText || "").trim(),
    String(q.desiredAnswer || "").trim(),
    Number(q.totalMarks),
    teacherEmail,
    examID
  ]);
  exams.appendRow([examID, subject, moduleName, teacherEmail, now]);
  questionSheet.getRange(questionSheet.getLastRow() + 1, 1, questionRows.length, questionRows[0].length)
    .setValues(questionRows);
  return json({ status: "ok", examID: examID });
}

function migrateLegacyQuestions() {
  const questions = getSheet("Questions");
  const exams = getSheet("Exams");
  if (questions.getLastRow() < 2) return;

  const rows = questions.getRange(2, 1, questions.getLastRow() - 1, 6).getValues();
  const legacyRows = rows.map((row, i) => ({ row: row, sheetRow: i + 2 }))
    .filter(item => item.row[0] && !item.row[5]);
  if (!legacyRows.length) return;

  const examID = "legacy-imported";
  const knownIDs = exams.getLastRow() > 1
    ? exams.getRange(2, 1, exams.getLastRow() - 1, 1).getValues().flat()
    : [];
  if (!knownIDs.includes(examID)) {
    exams.appendRow([examID, "General", "Imported questions", normalizeEmail(legacyRows[0].row[4]), new Date()]);
  }
  legacyRows.forEach(item => questions.getRange(item.sheetRow, 6).setValue(examID));
}

function getExams(data) {
  migrateLegacyQuestions();
  const exams = getSheet("Exams");
  const questions = getSheet("Questions");
  const teacherEmail = normalizeEmail(data.teacherEmail);
  const result = [];
  const counts = {};
  const marks = {};

  if (questions.getLastRow() > 1) {
    questions.getRange(2, 1, questions.getLastRow() - 1, 6).getValues().forEach(row => {
      const examID = String(row[5] || "");
      if (!examID) return;
      counts[examID] = (counts[examID] || 0) + 1;
      marks[examID] = (marks[examID] || 0) + Number(row[3] || 0);
    });
  }
  if (exams.getLastRow() > 1) {
    exams.getRange(2, 1, exams.getLastRow() - 1, 5).getValues().forEach(row => {
      const examID = String(row[0] || "");
      if (!examID || !counts[examID]) return;
      if (teacherEmail && normalizeEmail(row[3]) !== teacherEmail) return;
      result.push({
        examID: examID,
        subjectName: String(row[1] || ""),
        moduleName: String(row[2] || ""),
        questionCount: counts[examID],
        totalMarks: marks[examID],
        createdAt: row[4] instanceof Date ? row[4].toISOString() : String(row[4] || "")
      });
    });
  }
  return json({ status: "ok", exams: result });
}

function getQuestions(data) {
  migrateLegacyQuestions();
  const examID = String(data.examID || "");
  const sheet = getSheet("Questions");
  const questions = [];
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues().forEach(row => {
      if (String(row[5]) !== examID) return;
      questions.push({
        questionID: String(row[0]),
        questionText: String(row[1] || ""),
        desiredAnswer: String(row[2] || ""),
        totalMarks: Number(row[3] || 0)
      });
    });
  }
  return json({ status: "ok", questions: questions });
}

function submitResponses(data) {
  const responses = data.responses;
  if (!Array.isArray(responses) || !data.examID || !data.submissionID) {
    return json({ status: "error", message: "Exam and submission details are required." });
  }
  const sheet = getSheet("Responses");
  const timestamp = new Date();
  const email = normalizeEmail(data.studentEmail);
  const rows = responses.map(response => [
    timestamp,
    email,
    String(response.questionID),
    String(response.studentAnswer || ""),
    Number(response.score),
    String(data.submissionID),
    String(data.examID),
    Number(response.totalMarks)
  ]);
  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }
  return json({ status: "ok" });
}

function getResults(data) {
  const examID = String(data.examID || "");
  migrateLegacyQuestions();
  const examSheet = getSheet("Exams");
  const questionSheet = getSheet("Questions");
  const responseSheet = getSheet("Responses");
  let exam = null;
  if (examSheet.getLastRow() > 1) {
    const rows = examSheet.getRange(2, 1, examSheet.getLastRow() - 1, 5).getValues();
    const row = rows.find(item => String(item[0]) === examID);
    if (row && normalizeEmail(row[3]) === normalizeEmail(data.teacherEmail)) {
      exam = { examID: examID, subjectName: String(row[1] || ""), moduleName: String(row[2] || "") };
    }
  }
  if (!exam) return json({ status: "error", message: "Exam not found." });

  const questionMap = {};
  const reportQuestions = [];
  if (questionSheet.getLastRow() > 1) {
    questionSheet.getRange(2, 1, questionSheet.getLastRow() - 1, 6).getValues().forEach(row => {
      if (String(row[5]) === examID) {
        const questionID = String(row[0]);
        const question = { questionID: questionID, questionText: String(row[1] || ""), totalMarks: Number(row[3] || 0) };
        questionMap[questionID] = question;
        reportQuestions.push(question);
      }
    });
  }

  const grouped = {};
  if (responseSheet.getLastRow() > 1) {
    responseSheet.getRange(2, 1, responseSheet.getLastRow() - 1, 8).getValues().forEach(row => {
      if (String(row[6]) !== examID || !row[5]) return;
      const submissionID = String(row[5]);
      if (!grouped[submissionID]) {
        grouped[submissionID] = {
          submissionID: submissionID,
          studentEmail: normalizeEmail(row[1]),
          submittedAt: row[0] instanceof Date ? row[0].toISOString() : String(row[0] || ""),
          answers: []
        };
      }
      const questionID = String(row[2]);
      grouped[submissionID].answers.push({
        questionID: questionID,
        questionText: questionMap[questionID] ? questionMap[questionID].questionText : "",
        answer: String(row[3] || ""),
        score: Number(row[4] || 0),
        totalMarks: Number(row[7] || 0)
      });
    });
  }
  return json({ status: "ok", exam: exam, questions: reportQuestions, submissions: Object.values(grouped) });
}

function hashPassword(password, salt) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    salt + ":" + password,
    Utilities.Charset.UTF_8
  );
  return Utilities.base64Encode(digest);
}

function setTeacherPassword() {
  const ui = SpreadsheetApp.getUi();
  const emailPrompt = ui.prompt("Add teacher", "Enter the teacher's email:", ui.ButtonSet.OK_CANCEL);
  if (emailPrompt.getSelectedButton() !== ui.Button.OK) return;
  const passwordPrompt = ui.prompt("Add teacher", "Enter a strong teacher password:", ui.ButtonSet.OK_CANCEL);
  if (passwordPrompt.getSelectedButton() !== ui.Button.OK) return;

  const email = normalizeEmail(emailPrompt.getResponseText());
  const password = passwordPrompt.getResponseText();
  if (!email || !password) throw new Error("Email and password are required.");

  const sheet = getSheet("Teachers");
  const row = findEmailRow(sheet, email);
  const salt = Utilities.getUuid();
  const values = [email, salt, hashPassword(password, salt)];
  if (row < 0) sheet.appendRow(values);
  else sheet.getRange(row, 1, 1, values.length).setValues([values]);
  ui.alert("Teacher login saved.");
}
