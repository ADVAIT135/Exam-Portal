import { $, h, api, requireRole, mountBar, say, busy, fmt } from "./common.js";

const s = requireRole("student");
if (s) {
  mountBar(s);
  const msg = $("#msg"), form = $("#form"), box = $("#questions"), summary = $("#summary"), dlg = $("#confirm");
  const picker = $("#exam-picker"), pickerForm = $("#exam-picker-form"), examSelect = $("#exam-select");
  const chooseExam = $("#choose-exam");
  let exams = [], questions = [], activeExam = null;

  (async () => {
    try {
      exams = (await api("/api/exams")).exams;
      examSelect.replaceChildren(...exams.map((exam) => h("option", {
        value: exam.examID,
        text: `${exam.subjectName} · ${exam.moduleName} (${exam.questionCount} ${exam.questionCount === 1 ? "question" : "questions"})`,
      })));
      if (!exams.length) {
        picker.hidden = true;
        say(msg, "No exams have been published yet. Check back later.", "info");
      }
    } catch (err) {
      picker.hidden = true;
      say(msg, err.message, "error");
    }
  })();

  pickerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const examID = examSelect.value;
    const btn = $("#open-exam");
    busy(btn, true, "Loading exam…");
    try {
      questions = (await api(`/api/questions?exam_id=${encodeURIComponent(examID)}`)).questions;
      activeExam = exams.find((exam) => exam.examID === examID);
      if (!questions.length || !activeExam) {
        say(msg, "This exam has no available questions. Ask your teacher to check it.", "error");
        return;
      }
      renderQuestions();
      picker.hidden = true;
      form.hidden = false;
      chooseExam.hidden = false;
      $("#title").textContent = `${activeExam.subjectName} · ${activeExam.moduleName}`;
      summary.textContent = `${questions.length} ${questions.length === 1 ? "question" : "questions"} · ${fmt(activeExam.totalMarks)} marks`;
      say(msg, "");
    } catch (err) {
      say(msg, err.message, "error");
    } finally {
      busy(btn, false);
    }
  });

  function renderQuestions() {
    box.replaceChildren();
    questions.forEach((q, i) => {
      const area = h("textarea", { id: "q" + i, maxlength: 4000, "aria-describedby": "c" + i });
      const count = h("div", { class: "count", id: "c" + i, text: "0 / 4000" });
      area.addEventListener("input", () => { count.textContent = `${area.value.length} / 4000`; });
      box.append(h("section", { class: "card" },
        h("div", { class: "qhead" },
          h("span", { class: "qno", text: "Question " + (i + 1) }),
          h("span", { class: "pill", text: fmt(q.totalMarks) + (q.totalMarks === 1 ? " mark" : " marks") })),
        h("label", { for: "q" + i, class: "qtext", text: q.questionText }),
        area, count));
    });
    $("#actions").hidden = false;
  }

  chooseExam.addEventListener("click", () => {
    activeExam = null;
    questions = [];
    form.reset();
    form.hidden = true;
    chooseExam.hidden = true;
    $("#actions").hidden = true;
    box.replaceChildren();
    picker.hidden = false;
    $("#title").textContent = "Exam";
    summary.textContent = "";
    say(msg, "");
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const blank = questions.filter((_, i) => !$("#q" + i).value.trim()).length;
    $("#confirm-text").textContent = (blank ? `${blank} ${blank === 1 ? "question is" : "questions are"} blank and will score 0. ` : "") +
      "You can't change your answers after submitting.";
    dlg.showModal();
  });

  dlg.addEventListener("close", async () => {
    if (dlg.returnValue !== "yes" || !activeExam) return;
    const btn = $("#submit"), fields = [...form.querySelectorAll("textarea")];
    fields.forEach((f) => (f.disabled = true));
    chooseExam.disabled = true;
    busy(btn, true, "Scoring your answers…");
    msg.className = "msg"; msg.textContent = "";
    try {
      const r = await api("/api/submit", { method: "POST",
        body: { examID: activeExam.examID,
          answers: questions.map((q, i) => ({ questionID: q.questionID, answer: $("#q" + i).value })) } });
      show(r);
    } catch (err) {
      fields.forEach((f) => (f.disabled = false));
      chooseExam.disabled = false;
      busy(btn, false);
      say(msg, err.message, "error");
    }
  });

  function show(r) {
    const pct = r.max ? Math.round((r.total / r.max) * 100) : 0;
    form.hidden = true; summary.hidden = true; chooseExam.hidden = true;
    $("#title").textContent = "Your results";
    $("#results").replaceChildren(
      h("div", { class: "card" },
        h("div", { class: "summary" }, h("span", { class: "big", text: `${fmt(r.total)} / ${fmt(r.max)}` }), h("span", { text: pct + "%" })),
        h("p", { class: "muted", text: "Each score reflects how closely your answer's meaning matches the teacher's reference answer." }),
        h("div", { class: "tw" }, h("table", {},
          h("thead", {}, h("tr", {}, h("th", { text: "Question" }), h("th", { text: "Your answer" }), h("th", { class: "n", text: "Score" }), h("th", { class: "n", text: "Out of" }))),
          h("tbody", {}, r.results.map((x) => h("tr", {}, h("td", { text: x.questionText }), h("td", { text: x.answer || "(blank)" }),
            h("td", { class: "n", text: fmt(x.score) }), h("td", { class: "n", text: fmt(x.totalMarks) })))),
          h("tfoot", {}, h("tr", {}, h("th", { colspan: "2", text: "Total" }), h("th", { class: "n", text: fmt(r.total) }), h("th", { class: "n", text: fmt(r.max) })))))));
    window.scrollTo({ top: 0 });
  }
}
