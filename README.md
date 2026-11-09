# Exam Portal

An online exam portal for creating subject- and module-based exams, collecting student answers, and reviewing automatically scored results.

[![Live demo](https://img.shields.io/badge/Live%20demo-Open%20Exam%20Portal-4f46e5?style=for-the-badge)](https://advait2901-exam-portal.static.hf.space/)

> **Demo note:** The live service may take a little time to wake up after inactivity. Use sample data for demonstrations; this free-tier project is not intended for high-stakes exams.

## What it does

### For teachers
- Sign in to a protected teacher area.
- Create exams by entering a subject, module, question, reference answer, and mark value.
- Review results for each exam, ranked by percentage and submission time.
- See submission timestamps, student answers, class average, highest and lowest scores, and question-level score summaries.

### For students
- Sign in to the student area and choose an available subject and module.
- Answer exam questions in their own words and submit their work.
- Receive automatically calculated marks.

### How scoring works
The API compares the meaning of each student answer with the teacher's reference answer using a MiniLM sentence-embedding model. Similarity scores are mapped to marks using a configurable linear scale. Blank answers receive zero.

Semantic similarity is an estimate: it may not detect negation or subject-specific nuances. Teachers should review borderline scores and student responses.

## Architecture

```text
Student or teacher browser
          │
          ▼
Static frontend (Hugging Face Spaces or Netlify)
          │ HTTPS API requests
          ▼
Flask API (Render)
  ├── Authentication and exam workflows
  ├── MiniLM-based answer scoring
  └── Google Apps Script integration
          │
          ▼
Google Apps Script ── Google Sheets
```

Reference answers and scoring stay on the API side; the frontend does not receive reference answers. Google Sheets stores users, questions, exams, and submissions.

## Technology

- **Frontend:** HTML, CSS, and JavaScript modules
- **API:** Python, Flask, and Gunicorn
- **Answer scoring:** MiniLM embeddings through FastEmbed/ONNX
- **Data storage:** Google Sheets accessed through Google Apps Script
- **Hosting:** Hugging Face Static Spaces or Netlify for the frontend; Render for the API

## Try the live demo

Open the [Exam Portal](https://advait2901-exam-portal.static.hf.space/). Teacher and student accounts are configured through the Google Sheet and Apps Script setup; the demo does not publish credentials.

## Deploy your own copy

This project uses separate frontend and API hosting. You will need a Google account, a Google Sheet, a Hugging Face or Netlify account, and a Render account.

### 1. Configure Google Sheets and Apps Script

1. Open your spreadsheet and select **Extensions → Apps Script**.
2. Replace the Apps Script editor contents with [`backend/Code.gs`](backend/Code.gs), then save.
3. In **Project Settings → Script Properties**, add `API_SECRET`. You will use the same value as Render's `APPS_SCRIPT_SECRET`.
4. Run `setTeacherPassword` from the function menu and follow its prompts. Add student email addresses under the `email` header in the `Students` sheet. The script creates the required sheets and headers when needed.
5. Select **Deploy → New deployment → Web app**. Choose **Execute as: Me** and set access to **Anyone**. Authorize the script, deploy it, and copy the Web app URL ending in `/exec`.
6. Whenever you change `Code.gs`, deploy a new version of the web app.

### 2. Deploy the API to Render

1. Push the project to a GitHub repository.
2. In Render, create a **Blueprint** from the repository to use [`render.yaml`](render.yaml), or create a Docker web service with `backend` as its root directory.
3. Configure these environment variables for the API:

   | Variable | Value |
   | --- | --- |
   | `APPS_SCRIPT_URL` | Your Apps Script Web app URL ending in `/exec` |
   | `APPS_SCRIPT_SECRET` | The same secret as Apps Script's `API_SECRET` |
   | `ALLOWED_ORIGINS` | Your deployed frontend origin, without a trailing slash |
   | `SECRET_KEY` | A long, random value used to sign login sessions |

4. After deployment, check `https://YOUR-SERVICE.onrender.com/api/health`. A healthy service responds with `"ok": true`.

### 3. Deploy the frontend

1. Create a **Static** Space on Hugging Face.
2. Upload the **contents** of `frontend/` (including its Space `README.md`) to the Space root. Keep the `js/` and `css/` directories in place.
3. Set `API_BASE` in [`frontend/js/config.js`](frontend/js/config.js) to your Render service address, with no trailing slash; for example, `https://your-exam-api.onrender.com`.
4. Set Render's `ALLOWED_ORIGINS` to the exact origin shown in the browser address bar for your deployed frontend, with no trailing slash.

Alternatively, deploy the contents of `frontend/` to Netlify and allow that site's origin in `ALLOWED_ORIGINS`.

## Run locally

Install the backend dependencies, configure the Apps Script connection, and start Flask:

```bash
cd backend
pip install -r requirements.txt
```

Set the environment variables from [`backend/.env.example`](backend/.env.example), including `APPS_SCRIPT_URL` and a long `SECRET_KEY`, then run:

```bash
python app.py
```

Open `http://localhost:8000`. Leave `API_BASE` empty in `frontend/js/config.js` when the Flask app serves the pages locally.

Run the backend tests from the project root:

```bash
python -m pip install pytest
python -m pytest backend/tests
```

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `APPS_SCRIPT_URL` | Required | Google Apps Script web app endpoint |
| `APPS_SCRIPT_SECRET` | Required for protected Apps Script requests | Shared secret; must match Apps Script's `API_SECRET` |
| `SECRET_KEY` | Generated if unset | Secret used to sign sessions; set a stable random value for deployments |
| `ALLOWED_ORIGINS` | Empty | Comma-separated frontend origins allowed to call the API |
| `TOKEN_TTL_SECONDS` | `14400` | Login session lifetime in seconds |
| `SIM_LOW` / `SIM_HIGH` | `0.25` / `0.80` | Similarity thresholds for zero and full marks |

## Data and deployment notes

- Exams are grouped by subject and module.
- Existing questions without an exam are imported into a `General · Imported questions` exam.
- Older response rows without submission and exam IDs are not included in the new exam reports.
- The one-submission-per-exam restriction is held in API memory and resets when the API restarts.
- Free hosting may sleep when idle and can be slow to wake. Warm up the API before a planned session.
- Review the deployment provider's current free-tier limits before relying on the service.

## Project layout

```text
backend/
  app.py                 Flask API and scoring
  Code.gs                Google Apps Script / Sheets integration
  Dockerfile             API container
  tests/                 API and analytics tests
frontend/
  index.html             Portal entry page
  teacher_dashboard.html Teacher exam creation
  teacher_results.html   Teacher analytics
  student_exam.html      Student exam workflow
  js/                    Frontend modules and API configuration
  css/                   Portal styles
render.yaml              Render deployment blueprint
```
