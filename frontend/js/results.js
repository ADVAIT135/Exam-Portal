import { $, h, api, requireRole, mountBar, say, busy, fmt } from "./common.js";

const s = requireRole("teacher");
if (s) {
  mountBar(s);
  const msg = $("#msg"), form = $("#report-form"), select = $("#exam-select"), report = $("#report");

  (async () => {
    try {
      const exams = (await api("/api/teacher/exams")).exams;
      select.replaceChildren(...exams.map((exam) => h("option", {
        value: exam.examID,
        text: `${exam.subjectName} · ${exam.moduleName}`,
      })));
      if (!exams.length) {
        form.hidden = true;
        say(msg, "No exams have been created yet.", "info");
      }
    } catch (err) {
      form.hidden = true;
      say(msg, err.message, "error");
    }
  })();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#load-report");
    busy(btn, true, "Loading…");
    report.hidden = true;
    try {
      const data = await api(`/api/teacher/reports?exam_id=${encodeURIComponent(select.value)}`);
      render(data);
      say(msg, "");
    } catch (err) {
      say(msg, err.message, "error");
    } finally {
      busy(btn, false);
    }
  });

  function render(data) {
    const submissions = data.submissions;
    const summary = data.summary;
    $("#report-title").textContent = `${data.exam.subjectName} · ${data.exam.moduleName}`;

    const highest = submissions[0];
    const lowest = submissions[submissions.length - 1];
    $("#summary").replaceChildren(
      stat("Submissions", summary.submissionCount),
      stat("Class average", `${fmt(summary.averagePercent)}%`),
      stat("Highest", highest ? `${highest.studentEmail} · ${fmt(highest.percent)}%` : "—"),
      stat("Lowest", lowest ? `${lowest.studentEmail} · ${fmt(lowest.percent)}%` : "—"));

    $("#submissions").replaceChildren(submissions.length
      ? h("table", {},
        h("thead", {}, h("tr", {},
          h("th", { text: "Rank" }), h("th", { text: "Student" }), h("th", { text: "Submitted" }),
          h("th", { class: "n", text: "Score" }), h("th", { class: "n", text: "%" }), h("th", { text: "Answers" }))),
        h("tbody", {}, submissions.map((submission) => h("tr", {},
          h("td", { text: submission.rank }),
          h("td", { text: submission.studentEmail }),
          h("td", { text: dateLabel(submission.submittedAt) }),
          h("td", { class: "n", text: `${fmt(submission.total)} / ${fmt(submission.max)}` }),
          h("td", { class: "n", text: `${fmt(submission.percent)}%` }),
          h("td", {}, answerDetails(submission.answers)))))) :
      h("p", { class: "muted", text: "No student submissions for this exam yet." }));

    $("#questions").replaceChildren(data.questions.length
      ? h("table", {},
        h("thead", {}, h("tr", {},
          h("th", { text: "Question" }), h("th", { class: "n", text: "Average" }),
          h("th", { class: "n", text: "Zero" }), h("th", { class: "n", text: "Partial" }),
          h("th", { class: "n", text: "Full" }))),
        h("tbody", {}, data.questions.map((question) => h("tr", {},
          h("td", { text: question.questionText }),
          h("td", { class: "n", text: `${fmt(question.average)} / ${fmt(question.totalMarks)}` }),
          h("td", { class: "n", text: question.zero }),
          h("td", { class: "n", text: question.partial }),
          h("td", { class: "n", text: question.full }))))):
      h("p", { class: "muted", text: "There are no questions in this exam." }));

    report.hidden = false;
  }

  function stat(label, value) {
    return h("section", { class: "card stat" },
      h("div", { class: "muted", text: label }),
      h("strong", { text: value }));
  }

  function answerDetails(answers) {
    return h("details", {},
      h("summary", { text: "View answers" }),
      h("div", { class: "tw answer-table" }, h("table", {},
        h("thead", {}, h("tr", {},
          h("th", { text: "Question" }), h("th", { text: "Student answer" }),
          h("th", { class: "n", text: "Score" }))),
        h("tbody", {}, answers.map((answer) => h("tr", {},
          h("td", { text: answer.questionText }),
          h("td", { text: answer.answer || "(blank)" }),
          h("td", { class: "n", text: `${fmt(answer.score)} / ${fmt(answer.totalMarks)}` }))))));
  }

  function dateLabel(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium", timeStyle: "short",
    }).format(date);
  }
}
