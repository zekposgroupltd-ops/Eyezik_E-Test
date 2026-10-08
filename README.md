# Eyezik E-Test

**Design and Implementation of an Online Quiz and Examination System**

Designed by Isaac Youdiowei

Eyezik E-Test is a web-based examination system built as a final-year undergraduate project. Students register, log in, take timed multiple-choice examinations and see their marked result immediately. Administrators manage examinations and questions and review results and monitoring events.

The frontend is plain HTML, CSS and JavaScript hosted on **GitHub Pages**. The backend is a single **Google Apps Script** file, and **Google Sheets** is the database.

> This is an academic project, not an enterprise platform. See [Limitations](#limitations).

---

## Objectives

1. Design and build an online examination system that runs in a web browser.
2. Load questions from a database instead of hard-coding them in the pages.
3. Mark examinations automatically and store the results.
4. Provide a simple admin panel for managing examinations, questions, students and results.
5. Add basic browser-based monitoring that discourages common shortcuts and keeps a log for the examiner.
6. Use only free tools that a student can host and demonstrate without a paid server.

## Features

**Student**
- Landing page, registration, login and logout
- Dashboard with statistics and the examinations that are open
- Instructions page with the monitoring notice
- Multiple-choice examination: countdown timer, previous/next buttons, question-number navigation, answered/unanswered indicators, progress bar
- Submit confirmation, and automatic submission when the timer reaches zero
- Automatic marking on the server
- Result page (score, percentage, pass/fail, date, time spent) and examination history

**Administrator**
- Dashboard: total students, examinations, submissions, average score (plus pass rate and a score chart per examination)
- Examinations: view, create, edit, activate/deactivate
- Questions: view, add, edit, delete
- Students: view registered students (and activate/deactivate accounts)
- Results: view all results and filter by examination
- Monitoring log: view proctoring events with student, examination, event type, timestamp and severity

**Basic Browser-Based Examination Monitoring**: see [Proctoring explanation](#proctoring-explanation).

## Technology stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, vanilla JavaScript (no frameworks, no libraries) |
| Backend | Google Apps Script, one file: `backend/Code.gs` |
| Database | Google Sheets (six sheets) |
| Frontend hosting | GitHub Pages |
| Backend hosting | Google Apps Script Web App |

## System architecture

```
 +------------------------------+          HTTPS (POST, JSON)          +--------------------------+
 |  Browser (GitHub Pages)      |  ----------------------------------> |  Google Apps Script      |
 |                              |                                      |  Web App (Code.gs)       |
 |  HTML   = structure          |  <---------------------------------- |                          |
 |  CSS    = presentation       |        { success, message,           |  - authentication        |
 |  JS     = frontend logic     |          code, data }                |  - validation            |
 |    js/api.js (only place     |                                      |  - marking               |
 |    that calls the backend)   |                                      |  - proctoring log        |
 +------------------------------+                                      +------------+-------------+
                                                                                    |
                                                                         read / write rows
                                                                                    |
                                                                       +------------v-------------+
                                                                       |  Google Sheets           |
                                                                       |  Students   Exams        |
                                                                       |  Questions  Results      |
                                                                       |  ProctoringLogs  Admin   |
                                                                       +--------------------------+
```

**How a request works.** A page calls a method of the `API` object in `js/api.js`, for example `API.submitExam(examId, answers)`. That sends `{ "action": "submitExam", ... }` to the Web App URL. `doPost()` in `Code.gs` checks the session token, runs the matching function, reads or writes the sheets, and returns JSON.

**Key design decisions** (useful for the project defense)
- **Marking happens on the server.** The correct answers are never sent to the browser, so a student cannot read them from the page source or network tab.
- **The server remembers when the exam started.** Refreshing the page cannot reset the timer.
- **One attempt per student per examination.** A second submission is rejected, so double clicks and retries cannot create duplicate results.
- **Session tokens.** After login the server returns a random token. The browser keeps it in `sessionStorage` and sends it with every request. The student ID is read from the token on the server, not trusted from the browser.
- **Passwords are hashed** (SHA-256 with a salt) before they are stored in the sheet.

## Folder structure

```
eyezik-e-test/
├── index.html            Landing page
├── login.html            Student login
├── register.html         Student registration
├── dashboard.html        Student dashboard
├── instructions.html     Examination instructions
├── exam.html             Examination page
├── result.html           Result page
├── history.html          Examination history
│
├── admin/
│   ├── login.html        Admin login
│   ├── dashboard.html    Statistics
│   ├── exams.html        Manage examinations
│   ├── questions.html    Manage questions
│   ├── students.html     View students
│   └── results.html      Results and monitoring log (two tabs)
│
├── css/
│   ├── style.css         Shared styles and landing page
│   ├── auth.css          Login and registration
│   ├── dashboard.css     Dashboard, instructions, history
│   ├── exam.css          Examination page
│   ├── result.css        Result page
│   └── admin.css         Admin panel
│
├── js/
│   ├── config.js         Backend URL (the only place it appears)
│   ├── api.js            API client and shared helpers
│   ├── auth.js           Session handling, login and registration forms
│   ├── dashboard.js      Student dashboard
│   ├── instructions.js   Instructions page
│   ├── exam.js           Examination logic
│   ├── proctoring.js     Browser-based monitoring
│   ├── result.js         Result page
│   ├── history.js        History page
│   └── admin.js          All admin pages
│
├── assets/
│   ├── images/logo.svg
│   └── icons/
│
├── backend/
│   └── Code.gs           The whole backend
│
├── README.md
└── .gitignore
```

`Code.gs` is divided into eleven commented sections: configuration, HTTP entry points, authentication, student management, examination functions, question management, result management, proctoring functions, admin functions, database helpers, and mock data / initialization.

## Google Sheets database structure

`setupDatabase()` creates these six sheets and their headers automatically.

**Students**: `student_id`, `full_name`, `email`, `password`, `class`, `status`, `date_registered`

**Exams**: `exam_id`, `title`, `subject`, `description`, `duration_minutes`, `total_questions`, `pass_mark`, `status`, `date_created`

**Questions**: `question_id`, `exam_id`, `question`, `option_a`, `option_b`, `option_c`, `option_d`, `correct_answer`, `marks`

**Results**: `result_id`, `student_id`, `exam_id`, `score`, `total_marks`, `percentage`, `status`, `start_time`, `submit_time`

**ProctoringLogs**: `log_id`, `student_id`, `exam_id`, `event_type`, `event_description`, `timestamp`, `severity`

**Admin**: `admin_id`, `username`, `password`, `name`

Notes:
- `status` in Students and Exams is `Active` or `Inactive`. Only active examinations that have questions are shown to students.
- `pass_mark` is a percentage. A result is `PASS` when `percentage >= pass_mark`.
- `correct_answer` is one letter: `A`, `B`, `C` or `D`.
- The `password` column holds a hash, not the real password. If you add a student by hand in the sheet, register through the website instead.
- Do not rename or reorder the header cells in row 1.

## How to create the Google Spreadsheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a **blank spreadsheet**.
2. Name it `Eyezik E-Test Database`.
3. Leave it empty. The script creates the sheets for you in the next section.

## How to deploy Code.gs as a Google Apps Script Web App

1. In the spreadsheet, open **Extensions > Apps Script**. This creates a script that is attached to the spreadsheet.
2. Delete the default code. Open `backend/Code.gs` from this project, copy everything and paste it into the editor. Click **Save**.
3. Create the sheets. In the function drop-down at the top, choose `setupDatabase` and click **Run**. Google asks for permission the first time: choose your account, click **Advanced**, then **Go to (project name) (unsafe)** (this is normal for your own script), and **Allow**.
4. Add demo data. Choose `createMockData` and click **Run**. Check the spreadsheet: all six sheets are filled.
5. Click **Deploy > New deployment**.
   - Click the gear icon and select **Web app**.
   - **Description**: `Eyezik E-Test API`
   - **Execute as**: **Me**
   - **Who has access**: **Anyone**
6. Click **Deploy** and copy the **Web app URL**. It ends in `/exec`.
7. Test it: open the URL in a browser tab. You should see `"Eyezik E-Test API is running."`

> **Whenever you change `Code.gs`**, redeploy with **Deploy > Manage deployments > (pencil icon) > Version: New version > Deploy**. The URL stays the same. If you skip this step, the website keeps using the old code.

## How to configure config.js

Open `js/config.js` and replace the placeholder with your Web App URL:

```js
const CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycb.../exec",
  APP_NAME: "Eyezik E-Test"
};
```

This is the only file that contains the URL. The Web App URL is not a secret key, but never put Google account passwords or API keys in the frontend.

## How to run the project using GitHub Pages

1. Create a GitHub account and a new **public** repository, for example `eyezik-e-test`.
2. Upload all project files, keeping the folder structure. The `index.html` file must be in the root of the repository.
3. Make sure `js/config.js` contains your Web App URL.
4. In the repository open **Settings > Pages**. Under **Build and deployment** choose **Deploy from a branch**, select the `main` branch and the `/ (root)` folder, then **Save**.
5. After a minute the site is available at `https://YOUR-USERNAME.github.io/eyezik-e-test/`.

You can also open `index.html` by double-clicking it to try the pages locally, but fullscreen and storage behave most reliably on the hosted site.

All links are relative paths, so the project works in a sub-folder such as `/eyezik-e-test/`.

## Demo credentials

**These accounts are mock/demo accounts created by `createMockData()`. They exist only for demonstration. Delete them or change the passwords before using the system for anything real.**

| Role | Login | Password |
|---|---|---|
| Admin | username `admin` | `Admin@123` |
| Student STU001 | `chidinma.okafor@demo.edu` | `Student@123` |
| Student STU002 | `tamuno.briggs@demo.edu` | `Student@123` |
| Student STU003 | `ebiere.seigha@demo.edu` | `Student@123` |
| Student STU004 | `oluwaseun.adeyemi@demo.edu` | `Student@123` |
| Student STU005 | `fatima.bello@demo.edu` | `Student@123` |

The admin login page is `admin/login.html`.

Each student can take an examination only once. STU001 to STU004 have results for both examinations, and STU005 has a result for ICT Fundamentals, so to demonstrate taking an examination, **register a new student account** on the website, or log in as STU005 and take Computer Applications.

## Mock data explanation

`createMockData()` fills the empty spreadsheet with:

| Sheet | Demo content |
|---|---|
| Students | 5 students (STU001 to STU005), all active |
| Admin | 1 account (`admin`) |
| Exams | `EX001` ICT Fundamentals (15 min), `EX002` Computer Applications (20 min), `EX003` Introduction to Programming (**inactive**, so you can demonstrate activating it) |
| Questions | 25 multiple-choice questions: 10 for EX001, 10 for EX002, 5 for EX003, each worth 2 marks |
| Results | 9 results with a mix of pass and fail, so the dashboard shows real statistics |
| ProctoringLogs | 8 sample monitoring events |

The function refuses to run if any sheet already contains data. To wipe everything and start again, run `resetDatabaseWithMockData()`. **This deletes all rows in all six sheets.**

The pass mark of both active examinations is 50%.

## Proctoring explanation

The system provides **Basic Browser-Based Examination Monitoring**. It is not AI proctoring. It uses only standard browser features in `js/proctoring.js`:

| What it does | Browser feature |
|---|---|
| Requests fullscreen when the exam begins and detects leaving it | Fullscreen API |
| Detects switching tabs or minimising | Page Visibility API (`document.visibilityState === "hidden"`) |
| Detects the window losing focus | `window` `blur` event |
| Blocks copy, cut and paste | `copy`, `cut`, `paste` events |
| Disables the right-click menu | `contextmenu` event |
| Blocks Ctrl+C, Ctrl+X, Ctrl+V, Ctrl+U, Ctrl+S, Ctrl+P, F12 and Ctrl+Shift+I/J/C | `keydown` event |

**Warning system.** `MAX_WARNINGS = 3`. Each violation shows "Warning 1 of 3", "Warning 2 of 3" or "Warning 3 of 3". After the third, the examination is submitted automatically. Warnings survive a page refresh. By default every recorded event counts as a warning. To count only tab switches, fullscreen exits and window blur, set `COUNT_MINOR_EVENTS = false` at the top of `proctoring.js`.

**Event log.** Every violation is sent to the backend and stored in the `ProctoringLogs` sheet with `student_id`, `exam_id`, `event_type`, `event_description`, `timestamp` and `severity`. Event types: `TAB_SWITCH`, `FULLSCREEN_EXIT`, `WINDOW_BLUR`, `COPY_ATTEMPT`, `CUT_ATTEMPT`, `PASTE_ATTEMPT`, `RIGHT_CLICK`, `KEYBOARD_RESTRICTION` and `MAX_WARNINGS_REACHED`. Severity is decided by the server. Administrators view the log under **Results > Monitoring log**.

**Devices without fullscreen.** Some mobile browsers (for example Safari on iPhone) do not support fullscreen. There the fullscreen rule is skipped and the other checks still apply.

## Limitations

- **Browser-based monitoring is limited and cannot completely prevent cheating.** It cannot see a second device, a second person, a phone, or printed notes. A determined student can bypass browser checks, for example with browser extensions or developer tools. A logged event is a reason for the examiner to look closer, not proof of cheating.
- **Authentication is simple academic-project authentication, not enterprise-grade security.** Passwords are hashed with a fixed salt (not a slow password-hashing algorithm), there is no email verification, no password reset and no limit on login attempts.
- Client-side JavaScript can never provide complete security. The important checks (login, marking, one attempt per exam, time of start) are done on the server, but the Web App URL itself is public.
- Google Sheets is not designed for heavy traffic. Apps Script has daily quotas, and the script runs one write at a time. This is fine for a class demonstration, not for thousands of simultaneous students.
- The server records the start and submit time but does not reject a late submission. The timer is enforced in the browser, and the time spent is stored so an examiner can review it.
- Only multiple-choice questions with four options and one correct answer are supported.
- Each student can take each examination once, and there is no way to reset an attempt from the admin panel (delete the row in the `Results` sheet to allow a retake).
- Question order and option order are the same for every student.

## Future improvements

- Randomise question and option order for each student
- Question banks, random question selection and image-based questions
- Other question types (true/false, short answer)
- Password reset by email and stronger password hashing
- Admin option to allow a retake and to export results to PDF or CSV
- Webcam snapshots or other stronger proctoring methods with the student's consent
- Server-side rejection of late submissions
- Detailed result review showing correct answers after the exam closes
- A move to a real database and server for large deployments

---

Designed by Isaac Youdiowei
