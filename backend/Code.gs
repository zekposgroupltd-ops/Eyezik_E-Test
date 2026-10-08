// ==================================================
// EYEZIK E-TEST
// ONLINE QUIZ AND EXAMINATION SYSTEM
// Backend: Google Apps Script (this single file)
// Database: Google Sheets
// Designed by Isaac Youdiowei
// ==================================================


// ==================================================
// 1. CONFIGURATION
// ==================================================

// Leave empty when the script was created from the spreadsheet
// (Extensions > Apps Script). Otherwise paste the spreadsheet ID here.
var SPREADSHEET_ID = "";

var SESSION_SECONDS = 21600;               // login sessions last 6 hours
var PASSWORD_SALT = "eyezik-e-test::";     // simple academic salt (not a secret)
var START_KEY_PREFIX = "START|";           // marks an exam that is in progress

var SHEETS = {
  STUDENTS: "Students",
  EXAMS: "Exams",
  QUESTIONS: "Questions",
  RESULTS: "Results",
  LOGS: "ProctoringLogs",
  ADMIN: "Admin"
};

// Column order of every sheet. setupDatabase() writes these headers.
var HEADERS = {
  Students: ["student_id", "full_name", "email", "password", "class", "status", "date_registered"],
  Exams: ["exam_id", "title", "subject", "description", "duration_minutes", "total_questions", "pass_mark", "status", "date_created"],
  Questions: ["question_id", "exam_id", "question", "option_a", "option_b", "option_c", "option_d", "correct_answer", "marks"],
  Results: ["result_id", "student_id", "exam_id", "score", "total_marks", "percentage", "status", "start_time", "submit_time"],
  ProctoringLogs: ["log_id", "student_id", "exam_id", "event_type", "event_description", "timestamp", "severity"],
  Admin: ["admin_id", "username", "password", "name"]
};

// Columns that hold numbers or dates. Every other column is formatted as plain text
// so Google Sheets never converts IDs, passwords or answer options.
var NUMBER_COLUMNS = ["duration_minutes", "total_questions", "pass_mark", "marks", "score", "total_marks", "percentage"];
var DATE_COLUMNS = ["date_registered", "date_created", "start_time", "submit_time", "timestamp"];

// Proctoring event types and their severity.
var EVENT_TYPES = {
  TAB_SWITCH: "high",
  FULLSCREEN_EXIT: "high",
  WINDOW_BLUR: "medium",
  COPY_ATTEMPT: "medium",
  CUT_ATTEMPT: "medium",
  PASTE_ATTEMPT: "medium",
  RIGHT_CLICK: "low",
  KEYBOARD_RESTRICTION: "low",
  MAX_WARNINGS_REACHED: "high"
};

// Actions that change data. They run inside a lock so two requests
// cannot write at the same moment (prevents duplicate IDs and duplicate submissions).
var WRITE_ACTIONS = [
  "registerStudent", "startExam", "submitExam", "logProctoringEvent",
  "adminCreateExam", "adminUpdateExam", "adminSetExamStatus",
  "adminAddQuestion", "adminUpdateQuestion", "adminDeleteQuestion",
  "adminSetStudentStatus"
];


// ==================================================
// 2. HTTP ENTRY POINTS
// ==================================================

// Opening the Web App URL in a browser shows this message (useful to test the deployment).
function doGet(e) {
  return jsonOutput(ok("Eyezik E-Test API is running.", { app: "Eyezik E-Test", time: new Date().toISOString() }));
}

// Every request from the website arrives here as JSON text: { action: "...", ...data }
function doPost(e) {
  var response;
  try {
    var request = parseRequest(e);
    response = handleRequest(request);
  } catch (error) {
    Logger.log("Error: " + error.message);
    response = fail("Server error: " + error.message, "SERVER_ERROR");
  }
  return jsonOutput(response);
}

function parseRequest(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error("The request body is empty.");
  }
  try {
    return JSON.parse(e.postData.contents);
  } catch (parseError) {
    throw new Error("The request body is not valid JSON.");
  }
}

function handleRequest(request) {
  var action = String(request.action || "");
  if (!action) {
    return fail("No action was specified.", "BAD_REQUEST");
  }
  if (WRITE_ACTIONS.indexOf(action) === -1) {
    return routeAction(action, request);
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return routeAction(action, request);
  } finally {
    lock.releaseLock();
  }
}

// Connects each API action name (used in js/api.js) to a backend function.
function routeAction(action, request) {
  switch (action) {
    case "ping": return ok("pong");

    // Authentication
    case "registerStudent": return registerStudent(request);
    case "loginStudent": return loginStudent(request);
    case "loginAdmin": return loginAdmin(request);
    case "logout": return logout(request);

    // Student: examinations
    case "getAvailableExams": return getAvailableExams(request);
    case "getExam": return getExam(request);
    case "startExam": return startExam(request);

    // Student: results and proctoring
    case "submitExam": return submitExam(request);
    case "getStudentResults": return getStudentResults(request);
    case "getResult": return getResult(request);
    case "logProctoringEvent": return logProctoringEvent(request);

    // Admin
    case "adminGetStats": return adminGetStats(request);
    case "adminGetExams": return adminGetExams(request);
    case "adminCreateExam": return adminCreateExam(request);
    case "adminUpdateExam": return adminUpdateExam(request);
    case "adminSetExamStatus": return adminSetExamStatus(request);
    case "adminGetQuestions": return adminGetQuestions(request);
    case "adminAddQuestion": return adminAddQuestion(request);
    case "adminUpdateQuestion": return adminUpdateQuestion(request);
    case "adminDeleteQuestion": return adminDeleteQuestion(request);
    case "adminGetStudents": return adminGetStudents(request);
    case "adminSetStudentStatus": return adminSetStudentStatus(request);
    case "adminGetResults": return adminGetResults(request);
    case "adminGetProctoringLogs": return adminGetProctoringLogs(request);

    default: return fail("Unknown action: " + action, "UNKNOWN_ACTION");
  }
}

// Every response has the same shape: { success, message, code, data }
function ok(message, data) {
  return { success: true, message: message || "OK", code: "OK", data: data === undefined ? null : data };
}

function fail(message, code, data) {
  return { success: false, message: message, code: code || "ERROR", data: data === undefined ? null : data };
}

function authRequired() {
  return fail("Your session has expired. Please log in again.", "AUTH_REQUIRED");
}

function jsonOutput(object) {
  return ContentService.createTextOutput(JSON.stringify(object)).setMimeType(ContentService.MimeType.JSON);
}


// ==================================================
// 3. AUTHENTICATION
// ==================================================

function loginStudent(request) {
  var email = cleanText(request.email, 120).toLowerCase();
  var password = String(request.password || "");
  if (!email || !password) {
    return fail("Enter your email and password.", "VALIDATION");
  }
  var student = findStudentByEmail(email);
  if (!student || String(student.password) !== hashPassword(password)) {
    return fail("Incorrect email or password.", "INVALID_LOGIN");
  }
  if (!isActive(student.status)) {
    return fail("Your account is inactive. Contact the administrator.", "ACCOUNT_INACTIVE");
  }
  var token = createSession("student", student.student_id);
  return ok("Login successful.", { token: token, student: publicStudent(student) });
}

function loginAdmin(request) {
  var username = cleanText(request.username, 60).toLowerCase();
  var password = String(request.password || "");
  if (!username || !password) {
    return fail("Enter your username and password.", "VALIDATION");
  }
  var admins = readRows(SHEETS.ADMIN);
  var admin = null;
  for (var i = 0; i < admins.length; i++) {
    if (String(admins[i].username).toLowerCase() === username) {
      admin = admins[i];
      break;
    }
  }
  if (!admin || String(admin.password) !== hashPassword(password)) {
    return fail("Incorrect username or password.", "INVALID_LOGIN");
  }
  var token = createSession("admin", admin.admin_id);
  return ok("Login successful.", {
    token: token,
    admin: { admin_id: admin.admin_id, username: admin.username, name: admin.name }
  });
}

function logout(request) {
  if (request.token) {
    CacheService.getScriptCache().remove("session_" + request.token);
  }
  return ok("Logged out.");
}

// A session token is a random ID stored in the script cache. The browser keeps it
// in sessionStorage and sends it with each request, so the browser never needs
// to tell the server who it is by ID.
function createSession(role, userId) {
  var token = Utilities.getUuid();
  CacheService.getScriptCache().put("session_" + token, role + "|" + userId, SESSION_SECONDS);
  return token;
}

function getSession(token) {
  if (!token) return null;
  var value = CacheService.getScriptCache().get("session_" + token);
  if (!value) return null;
  var parts = String(value).split("|");
  return { role: parts[0], id: parts[1] };
}

// Returns the logged-in student row, or null when the token is missing/expired.
function requireStudent(request) {
  var session = getSession(request.token);
  if (!session || session.role !== "student") return null;
  var student = findStudentById(session.id);
  if (!student || !isActive(student.status)) return null;
  return student;
}

// Returns the logged-in admin row, or null.
function requireAdmin(request) {
  var session = getSession(request.token);
  if (!session || session.role !== "admin") return null;
  return firstWhere(readRows(SHEETS.ADMIN), "admin_id", session.id);
}

function hashPassword(plainPassword) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    PASSWORD_SALT + plainPassword,
    Utilities.Charset.UTF_8
  );
  var hex = "";
  for (var i = 0; i < bytes.length; i++) {
    var value = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
    var part = value.toString(16);
    hex += part.length === 1 ? "0" + part : part;
  }
  return hex;
}


// ==================================================
// 4. STUDENT MANAGEMENT
// ==================================================

function registerStudent(request) {
  var fullName = cleanText(request.full_name, 80);
  var email = cleanText(request.email, 120).toLowerCase();
  var password = String(request.password || "");
  var className = cleanText(request["class"], 60);

  if (fullName.length < 3) return fail("Enter your full name (at least 3 characters).", "VALIDATION");
  if (!isValidEmail(email)) return fail("Enter a valid email address.", "VALIDATION");
  if (password.length < 6 || password.length > 64) return fail("Password must be between 6 and 64 characters.", "VALIDATION");
  if (!className) return fail("Enter your class.", "VALIDATION");

  if (findStudentByEmail(email)) {
    return fail("An account with this email already exists.", "DUPLICATE_EMAIL");
  }

  var studentId = generateId(SHEETS.STUDENTS, "student_id", "STU", 3);
  appendRowObject(SHEETS.STUDENTS, {
    student_id: studentId,
    full_name: fullName,
    email: email,
    password: hashPassword(password),
    "class": className,
    status: "Active",
    date_registered: new Date()
  });
  return ok("Registration successful. You can now log in.", { student_id: studentId });
}

function findStudentById(studentId) {
  return firstWhere(readRows(SHEETS.STUDENTS), "student_id", studentId);
}

function findStudentByEmail(email) {
  var students = readRows(SHEETS.STUDENTS);
  for (var i = 0; i < students.length; i++) {
    if (String(students[i].email).toLowerCase() === String(email).toLowerCase()) {
      return students[i];
    }
  }
  return null;
}

// Student data that is safe to send to the browser (no password).
function publicStudent(student) {
  return {
    student_id: student.student_id,
    full_name: student.full_name,
    email: student.email,
    "class": student["class"],
    status: student.status,
    date_registered: student.date_registered
  };
}


// ==================================================
// 5. EXAMINATION FUNCTIONS
// ==================================================

// Active examinations that have questions, plus this student's attempt (if any).
function getAvailableExams(request) {
  var student = requireStudent(request);
  if (!student) return authRequired();

  var exams = readRows(SHEETS.EXAMS);
  var questions = readRows(SHEETS.QUESTIONS);
  var results = where(readRows(SHEETS.RESULTS), "student_id", student.student_id);

  var list = [];
  for (var i = 0; i < exams.length; i++) {
    if (!isActive(exams[i].status)) continue;
    var examQuestions = where(questions, "exam_id", exams[i].exam_id);
    if (examQuestions.length === 0) continue;
    var info = buildExamInfo(exams[i], examQuestions);
    info.attempt = buildAttempt(firstWhere(results, "exam_id", exams[i].exam_id));
    list.push(info);
  }
  return ok("Examinations loaded.", list);
}

// Details for the instructions page.
function getExam(request) {
  var student = requireStudent(request);
  if (!student) return authRequired();

  var exam = findExamById(request.exam_id);
  if (!exam) return fail("Examination not found.", "NOT_FOUND");
  if (!isActive(exam.status)) return fail("This examination is not active.", "EXAM_INACTIVE");

  var info = buildExamInfo(exam, getQuestionsForExam(exam.exam_id));
  var result = findResult(student.student_id, exam.exam_id);
  info.attempt = buildAttempt(result);
  info.in_progress = !result && !!getStartTime(student.student_id, exam.exam_id);
  return ok("Examination loaded.", info);
}

// Starts (or resumes) an examination. The server stores the start time, so refreshing
// the page cannot reset the timer. Correct answers are never sent to the browser.
function startExam(request) {
  var student = requireStudent(request);
  if (!student) return authRequired();

  var exam = findExamById(request.exam_id);
  if (!exam) return fail("Examination not found.", "NOT_FOUND");
  if (!isActive(exam.status)) return fail("This examination is not active.", "EXAM_INACTIVE");

  var existing = findResult(student.student_id, exam.exam_id);
  if (existing) {
    return fail("You have already taken this examination.", "ALREADY_SUBMITTED", { result_id: existing.result_id });
  }

  var questions = getQuestionsForExam(exam.exam_id);
  if (questions.length === 0) return fail("This examination has no questions yet.", "NO_QUESTIONS");

  var startedAt = getStartTime(student.student_id, exam.exam_id);
  var resumed = true;
  if (!startedAt) {
    startedAt = new Date().toISOString();
    PropertiesService.getScriptProperties().setProperty(startKey(student.student_id, exam.exam_id), startedAt);
    resumed = false;
  }

  var totalSeconds = Number(exam.duration_minutes) * 60;
  var elapsedSeconds = Math.floor((new Date().getTime() - new Date(startedAt).getTime()) / 1000);
  var remainingSeconds = Math.max(0, totalSeconds - elapsedSeconds);

  var publicQuestions = [];
  for (var i = 0; i < questions.length; i++) {
    publicQuestions.push(publicQuestion(questions[i]));
  }

  return ok("Examination started.", {
    exam: buildExamInfo(exam, questions),
    questions: publicQuestions,
    remaining_seconds: remainingSeconds,
    resumed: resumed
  });
}

function findExamById(examId) {
  return firstWhere(readRows(SHEETS.EXAMS), "exam_id", examId);
}

function buildExamInfo(exam, examQuestions) {
  var totalMarks = 0;
  for (var i = 0; i < examQuestions.length; i++) {
    totalMarks += Number(examQuestions[i].marks) || 0;
  }
  return {
    exam_id: exam.exam_id,
    title: exam.title,
    subject: exam.subject,
    description: exam.description,
    duration_minutes: Number(exam.duration_minutes),
    total_questions: examQuestions.length,
    total_marks: totalMarks,
    pass_mark: Number(exam.pass_mark),
    status: exam.status
  };
}

function buildAttempt(result) {
  if (!result) return null;
  return {
    result_id: result.result_id,
    score: Number(result.score),
    total_marks: Number(result.total_marks),
    percentage: Number(result.percentage),
    status: result.status
  };
}

function startKey(studentId, examId) {
  return START_KEY_PREFIX + studentId + "|" + examId;
}

function getStartTime(studentId, examId) {
  return PropertiesService.getScriptProperties().getProperty(startKey(studentId, examId));
}

function isActive(status) {
  return String(status).toLowerCase() === "active";
}


// ==================================================
// 6. QUESTION MANAGEMENT
// ==================================================

// Questions of one examination, including the correct answer (server side only).
function getQuestionsForExam(examId) {
  var rows = where(readRows(SHEETS.QUESTIONS), "exam_id", examId);
  var questions = [];
  for (var i = 0; i < rows.length; i++) {
    questions.push(cleanQuestionRow(rows[i]));
  }
  return questions;
}

function cleanQuestionRow(row) {
  return {
    question_id: String(row.question_id),
    exam_id: String(row.exam_id),
    question: String(row.question),
    option_a: String(row.option_a),
    option_b: String(row.option_b),
    option_c: String(row.option_c),
    option_d: String(row.option_d),
    correct_answer: String(row.correct_answer).toUpperCase(),
    marks: Number(row.marks) || 0
  };
}

// The version of a question that students receive (no correct answer).
function publicQuestion(question) {
  return {
    question_id: question.question_id,
    question: question.question,
    options: { A: question.option_a, B: question.option_b, C: question.option_c, D: question.option_d },
    marks: question.marks
  };
}

function adminGetQuestions(request) {
  if (!requireAdmin(request)) return authRequired();
  var rows = readRows(SHEETS.QUESTIONS);
  if (request.exam_id) rows = where(rows, "exam_id", request.exam_id);
  var questions = [];
  for (var i = 0; i < rows.length; i++) {
    questions.push(cleanQuestionRow(rows[i]));
  }
  return ok("Questions loaded.", questions);
}

function adminAddQuestion(request) {
  if (!requireAdmin(request)) return authRequired();
  var check = validateQuestionInput(request);
  if (check.error) return check.error;

  var question = check.question;
  question.question_id = generateId(SHEETS.QUESTIONS, "question_id", "Q", 3);
  appendRowObject(SHEETS.QUESTIONS, question);
  syncExamQuestionCount(question.exam_id);
  return ok("Question added.", { question_id: question.question_id });
}

function adminUpdateQuestion(request) {
  if (!requireAdmin(request)) return authRequired();
  var existing = firstWhere(readRows(SHEETS.QUESTIONS), "question_id", request.question_id);
  if (!existing) return fail("Question not found.", "NOT_FOUND");

  var check = validateQuestionInput(request);
  if (check.error) return check.error;

  updateRowById(SHEETS.QUESTIONS, "question_id", existing.question_id, check.question);
  if (String(existing.exam_id) !== check.question.exam_id) {
    syncExamQuestionCount(existing.exam_id);
  }
  syncExamQuestionCount(check.question.exam_id);
  return ok("Question updated.");
}

function adminDeleteQuestion(request) {
  if (!requireAdmin(request)) return authRequired();
  var existing = firstWhere(readRows(SHEETS.QUESTIONS), "question_id", request.question_id);
  if (!existing) return fail("Question not found.", "NOT_FOUND");
  deleteRowById(SHEETS.QUESTIONS, "question_id", existing.question_id);
  syncExamQuestionCount(existing.exam_id);
  return ok("Question deleted.");
}

// Checks the question form and returns { error } or { question } ready to be saved.
function validateQuestionInput(request) {
  var examId = cleanText(request.exam_id, 20);
  if (!findExamById(examId)) return { error: fail("Choose a valid examination.", "VALIDATION") };

  var text = cleanText(request.question, 500);
  if (text.length < 5) return { error: fail("Enter the question text (at least 5 characters).", "VALIDATION") };

  var options = [
    cleanText(request.option_a, 200), cleanText(request.option_b, 200),
    cleanText(request.option_c, 200), cleanText(request.option_d, 200)
  ];
  for (var i = 0; i < options.length; i++) {
    if (!options[i]) return { error: fail("All four options are required.", "VALIDATION") };
  }

  var correct = String(request.correct_answer || "").toUpperCase();
  if (["A", "B", "C", "D"].indexOf(correct) === -1) {
    return { error: fail("Choose the correct answer (A, B, C or D).", "VALIDATION") };
  }

  var marks = Number(request.marks);
  if (!isFinite(marks) || marks < 1 || marks > 100 || Math.floor(marks) !== marks) {
    return { error: fail("Marks must be a whole number from 1 to 100.", "VALIDATION") };
  }

  return {
    question: {
      exam_id: examId,
      question: text,
      option_a: options[0],
      option_b: options[1],
      option_c: options[2],
      option_d: options[3],
      correct_answer: correct,
      marks: marks
    }
  };
}

// Keeps the total_questions column of the Exams sheet correct.
function syncExamQuestionCount(examId) {
  var count = getQuestionsForExam(examId).length;
  updateRowById(SHEETS.EXAMS, "exam_id", examId, { total_questions: count });
}


// ==================================================
// 7. RESULT MANAGEMENT
// ==================================================

// Marks the examination on the server and stores the result.
// answers looks like: { "Q001": "A", "Q002": "C" }
function submitExam(request) {
  var student = requireStudent(request);
  if (!student) return authRequired();

  var exam = findExamById(request.exam_id);
  if (!exam) return fail("Examination not found.", "NOT_FOUND");

  var previous = findResult(student.student_id, exam.exam_id);
  if (previous) {
    return fail("This examination has already been submitted.", "ALREADY_SUBMITTED", { result_id: previous.result_id });
  }

  var startedAt = getStartTime(student.student_id, exam.exam_id);
  if (!startedAt) {
    return fail("This examination was not started.", "NOT_STARTED");
  }

  var answers = request.answers;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) answers = {};

  var questions = getQuestionsForExam(exam.exam_id);
  if (questions.length === 0) return fail("This examination has no questions.", "NO_QUESTIONS");

  var marking = calculateScore(questions, answers);
  var percentage = marking.totalMarks > 0 ? Math.round((marking.score / marking.totalMarks) * 10000) / 100 : 0;
  var status = percentage >= Number(exam.pass_mark) ? "PASS" : "FAIL";

  var resultId = generateId(SHEETS.RESULTS, "result_id", "RES", 3);
  var row = {
    result_id: resultId,
    student_id: student.student_id,
    exam_id: exam.exam_id,
    score: marking.score,
    total_marks: marking.totalMarks,
    percentage: percentage,
    status: status,
    start_time: new Date(startedAt),
    submit_time: new Date()
  };
  appendRowObject(SHEETS.RESULTS, row);

  // The attempt is finished, so remove the "in progress" marker.
  PropertiesService.getScriptProperties().deleteProperty(startKey(student.student_id, exam.exam_id));

  return ok("Examination submitted.", formatResult(findResult(student.student_id, exam.exam_id), exam, student));
}

function calculateScore(questions, answers) {
  var score = 0;
  var totalMarks = 0;
  for (var i = 0; i < questions.length; i++) {
    var question = questions[i];
    totalMarks += question.marks;
    var given = String(answers[question.question_id] || "").toUpperCase();
    if (given === question.correct_answer) {
      score += question.marks;
    }
  }
  return { score: score, totalMarks: totalMarks };
}

function findResult(studentId, examId) {
  var results = readRows(SHEETS.RESULTS);
  for (var i = 0; i < results.length; i++) {
    if (String(results[i].student_id) === String(studentId) && String(results[i].exam_id) === String(examId)) {
      return results[i];
    }
  }
  return null;
}

function getStudentResults(request) {
  var student = requireStudent(request);
  if (!student) return authRequired();

  var results = where(readRows(SHEETS.RESULTS), "student_id", student.student_id);
  var examsById = indexBy(readRows(SHEETS.EXAMS), "exam_id");
  var list = [];
  for (var i = 0; i < results.length; i++) {
    list.push(formatResult(results[i], examsById[results[i].exam_id], student));
  }
  list.sort(function (a, b) { return String(b.submit_time).localeCompare(String(a.submit_time)); });
  return ok("Results loaded.", list);
}

function getResult(request) {
  var student = requireStudent(request);
  if (!student) return authRequired();

  var result = firstWhere(readRows(SHEETS.RESULTS), "result_id", request.result_id);
  if (!result || String(result.student_id) !== String(student.student_id)) {
    return fail("Result not found.", "NOT_FOUND");
  }
  return ok("Result loaded.", formatResult(result, findExamById(result.exam_id), student));
}

// Combines a Results row with the exam and student names, and calculates time spent.
function formatResult(result, exam, student) {
  var spent = Math.round((new Date(result.submit_time).getTime() - new Date(result.start_time).getTime()) / 1000);
  return {
    result_id: result.result_id,
    student_id: result.student_id,
    student_name: student ? student.full_name : "Unknown student",
    exam_id: result.exam_id,
    exam_title: exam ? exam.title : "Unknown examination",
    subject: exam ? exam.subject : "",
    pass_mark: exam ? Number(exam.pass_mark) : 0,
    score: Number(result.score),
    total_marks: Number(result.total_marks),
    percentage: Number(result.percentage),
    status: result.status,
    start_time: result.start_time,
    submit_time: result.submit_time,
    time_spent_seconds: isFinite(spent) && spent >= 0 ? spent : null
  };
}


// ==================================================
// 8. PROCTORING FUNCTIONS
// ==================================================

// Stores one monitoring event sent by js/proctoring.js while an exam is in progress.
function logProctoringEvent(request) {
  var student = requireStudent(request);
  if (!student) return authRequired();

  var exam = findExamById(request.exam_id);
  if (!exam) return fail("Examination not found.", "NOT_FOUND");

  var eventType = String(request.event_type || "").toUpperCase();
  if (!EVENT_TYPES.hasOwnProperty(eventType)) {
    return fail("Unknown event type.", "VALIDATION");
  }
  if (!getStartTime(student.student_id, exam.exam_id)) {
    return fail("No examination is in progress.", "NOT_STARTED");
  }

  appendRowObject(SHEETS.LOGS, {
    log_id: generateId(SHEETS.LOGS, "log_id", "LOG", 4),
    student_id: student.student_id,
    exam_id: exam.exam_id,
    event_type: eventType,
    event_description: cleanText(request.event_description, 200),
    timestamp: new Date(),
    severity: EVENT_TYPES[eventType]
  });
  return ok("Event recorded.");
}

// Monitoring events for the admin panel. Optional filters: exam_id, event_type.
function adminGetProctoringLogs(request) {
  if (!requireAdmin(request)) return authRequired();

  var logs = readRows(SHEETS.LOGS);
  if (request.exam_id) logs = where(logs, "exam_id", request.exam_id);
  if (request.event_type) logs = where(logs, "event_type", request.event_type);

  var studentsById = indexBy(readRows(SHEETS.STUDENTS), "student_id");
  var examsById = indexBy(readRows(SHEETS.EXAMS), "exam_id");

  var list = [];
  for (var i = 0; i < logs.length; i++) {
    var student = studentsById[logs[i].student_id];
    var exam = examsById[logs[i].exam_id];
    list.push({
      log_id: logs[i].log_id,
      student_id: logs[i].student_id,
      student_name: student ? student.full_name : "Unknown student",
      exam_id: logs[i].exam_id,
      exam_title: exam ? exam.title : "Unknown examination",
      event_type: logs[i].event_type,
      event_description: logs[i].event_description,
      timestamp: logs[i].timestamp,
      severity: logs[i].severity
    });
  }
  list.sort(function (a, b) { return String(b.timestamp).localeCompare(String(a.timestamp)); });
  return ok("Monitoring events loaded.", list.slice(0, 500));
}


// ==================================================
// 9. ADMIN FUNCTIONS
// ==================================================

function adminGetStats(request) {
  if (!requireAdmin(request)) return authRequired();

  var students = readRows(SHEETS.STUDENTS);
  var exams = readRows(SHEETS.EXAMS);
  var results = readRows(SHEETS.RESULTS);
  var logs = readRows(SHEETS.LOGS);

  var total = 0;
  var passed = 0;
  for (var i = 0; i < results.length; i++) {
    total += Number(results[i].percentage) || 0;
    if (String(results[i].status) === "PASS") passed++;
  }

  var examStats = [];
  for (var e = 0; e < exams.length; e++) {
    var examResults = where(results, "exam_id", exams[e].exam_id);
    var examTotal = 0;
    var examPassed = 0;
    for (var r = 0; r < examResults.length; r++) {
      examTotal += Number(examResults[r].percentage) || 0;
      if (String(examResults[r].status) === "PASS") examPassed++;
    }
    examStats.push({
      exam_id: exams[e].exam_id,
      title: exams[e].title,
      submissions: examResults.length,
      average: examResults.length ? round1(examTotal / examResults.length) : 0,
      pass_rate: examResults.length ? Math.round((examPassed / examResults.length) * 100) : 0
    });
  }

  var studentsById = indexBy(students, "student_id");
  var examsById = indexBy(exams, "exam_id");
  var sorted = results.slice().sort(function (a, b) { return String(b.submit_time).localeCompare(String(a.submit_time)); });
  var recent = [];
  for (var k = 0; k < Math.min(5, sorted.length); k++) {
    recent.push(formatResult(sorted[k], examsById[sorted[k].exam_id], studentsById[sorted[k].student_id]));
  }

  return ok("Statistics loaded.", {
    total_students: students.length,
    total_exams: exams.length,
    total_submissions: results.length,
    average_score: results.length ? round1(total / results.length) : 0,
    pass_rate: results.length ? Math.round((passed / results.length) * 100) : 0,
    total_events: logs.length,
    exam_stats: examStats,
    recent_results: recent
  });
}

function adminGetExams(request) {
  if (!requireAdmin(request)) return authRequired();

  var exams = readRows(SHEETS.EXAMS);
  var questions = readRows(SHEETS.QUESTIONS);
  var results = readRows(SHEETS.RESULTS);

  var list = [];
  for (var i = 0; i < exams.length; i++) {
    var info = buildExamInfo(exams[i], where(questions, "exam_id", exams[i].exam_id));
    info.submissions = where(results, "exam_id", exams[i].exam_id).length;
    info.date_created = exams[i].date_created;
    list.push(info);
  }
  return ok("Examinations loaded.", list);
}

function adminCreateExam(request) {
  if (!requireAdmin(request)) return authRequired();
  var check = validateExamInput(request);
  if (check.error) return check.error;

  var exam = check.exam;
  exam.exam_id = generateId(SHEETS.EXAMS, "exam_id", "EX", 3);
  exam.total_questions = 0;
  exam.date_created = new Date();
  appendRowObject(SHEETS.EXAMS, exam);
  return ok("Examination created.", { exam_id: exam.exam_id });
}

function adminUpdateExam(request) {
  if (!requireAdmin(request)) return authRequired();
  var existing = findExamById(request.exam_id);
  if (!existing) return fail("Examination not found.", "NOT_FOUND");

  var check = validateExamInput(request);
  if (check.error) return check.error;

  updateRowById(SHEETS.EXAMS, "exam_id", existing.exam_id, check.exam);
  return ok("Examination updated.");
}

function adminSetExamStatus(request) {
  if (!requireAdmin(request)) return authRequired();
  var existing = findExamById(request.exam_id);
  if (!existing) return fail("Examination not found.", "NOT_FOUND");

  var status = String(request.status || "");
  if (status !== "Active" && status !== "Inactive") {
    return fail("Status must be Active or Inactive.", "VALIDATION");
  }
  if (status === "Active" && getQuestionsForExam(existing.exam_id).length === 0) {
    return fail("Add at least one question before activating this examination.", "NO_QUESTIONS");
  }
  updateRowById(SHEETS.EXAMS, "exam_id", existing.exam_id, { status: status });
  return ok("Examination is now " + status.toLowerCase() + ".");
}

function validateExamInput(request) {
  var title = cleanText(request.title, 120);
  if (title.length < 3) return { error: fail("Enter an examination title (at least 3 characters).", "VALIDATION") };

  var subject = cleanText(request.subject, 80);
  if (!subject) return { error: fail("Enter the subject.", "VALIDATION") };

  var duration = Number(request.duration_minutes);
  if (!isFinite(duration) || duration < 1 || duration > 300 || Math.floor(duration) !== duration) {
    return { error: fail("Duration must be a whole number of minutes from 1 to 300.", "VALIDATION") };
  }

  var passMark = Number(request.pass_mark);
  if (!isFinite(passMark) || passMark < 0 || passMark > 100) {
    return { error: fail("Pass mark must be a percentage from 0 to 100.", "VALIDATION") };
  }

  var status = String(request.status || "Inactive");
  if (status !== "Active" && status !== "Inactive") status = "Inactive";

  return {
    exam: {
      title: title,
      subject: subject,
      description: cleanText(request.description, 300),
      duration_minutes: duration,
      pass_mark: passMark,
      status: status
    }
  };
}

function adminGetStudents(request) {
  if (!requireAdmin(request)) return authRequired();

  var students = readRows(SHEETS.STUDENTS);
  var results = readRows(SHEETS.RESULTS);
  var list = [];
  for (var i = 0; i < students.length; i++) {
    var student = publicStudent(students[i]);
    student.exams_taken = where(results, "student_id", students[i].student_id).length;
    list.push(student);
  }
  return ok("Students loaded.", list);
}

function adminSetStudentStatus(request) {
  if (!requireAdmin(request)) return authRequired();
  var student = findStudentById(request.student_id);
  if (!student) return fail("Student not found.", "NOT_FOUND");

  var status = String(request.status || "");
  if (status !== "Active" && status !== "Inactive") {
    return fail("Status must be Active or Inactive.", "VALIDATION");
  }
  updateRowById(SHEETS.STUDENTS, "student_id", student.student_id, { status: status });
  return ok("Student account is now " + status.toLowerCase() + ".");
}

// Results for the admin panel. Optional filter: exam_id.
function adminGetResults(request) {
  if (!requireAdmin(request)) return authRequired();

  var results = readRows(SHEETS.RESULTS);
  if (request.exam_id) results = where(results, "exam_id", request.exam_id);

  var studentsById = indexBy(readRows(SHEETS.STUDENTS), "student_id");
  var examsById = indexBy(readRows(SHEETS.EXAMS), "exam_id");
  var list = [];
  for (var i = 0; i < results.length; i++) {
    list.push(formatResult(results[i], examsById[results[i].exam_id], studentsById[results[i].student_id]));
  }
  list.sort(function (a, b) { return String(b.submit_time).localeCompare(String(a.submit_time)); });
  return ok("Results loaded.", list);
}


// ==================================================
// 10. DATABASE HELPERS
// ==================================================

function getSpreadsheet() {
  if (SPREADSHEET_ID) return SpreadsheetApp.openById(SPREADSHEET_ID);
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error("No spreadsheet found. Create the script from the spreadsheet (Extensions > Apps Script) or set SPREADSHEET_ID.");
  }
  return spreadsheet;
}

function getSheet(sheetName) {
  var sheet = getSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('The sheet "' + sheetName + '" is missing. Run setupDatabase() in the Apps Script editor.');
  }
  return sheet;
}

function getSheetHeaders(sheet) {
  var values = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var headers = [];
  for (var i = 0; i < values.length; i++) headers.push(String(values[i]));
  return headers;
}

// Reads every data row of a sheet as an object, e.g. { student_id: "STU001", ... }.
// Dates are converted to ISO text so they can be sent to the browser.
function readRows(sheetName) {
  var sheet = getSheet(sheetName);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var headers = getSheetHeaders(sheet);
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var rows = [];
  for (var r = 0; r < values.length; r++) {
    if (String(values[r][0]).trim() === "") continue;   // skip blank rows
    var row = { _row: r + 2 };
    for (var c = 0; c < headers.length; c++) {
      var cell = values[r][c];
      row[headers[c]] = (cell instanceof Date) ? cell.toISOString() : cell;
    }
    rows.push(row);
  }
  return rows;
}

function appendRowObject(sheetName, object) {
  appendRowObjects(sheetName, [object]);
}

// Writes several rows in one operation (the keys of each object must match the headers).
function appendRowObjects(sheetName, objects) {
  if (objects.length === 0) return;
  var sheet = getSheet(sheetName);
  var headers = getSheetHeaders(sheet);

  var rows = [];
  for (var i = 0; i < objects.length; i++) {
    var line = [];
    for (var c = 0; c < headers.length; c++) {
      var value = objects[i][headers[c]];
      line.push(value === undefined ? "" : value);
    }
    rows.push(line);
  }

  var startRow = sheet.getLastRow() + 1;
  var lastNeeded = startRow + rows.length - 1;
  if (lastNeeded > sheet.getMaxRows()) {
    sheet.insertRowsAfter(sheet.getMaxRows(), lastNeeded - sheet.getMaxRows() + 200);
  }
  sheet.getRange(startRow, 1, rows.length, headers.length).setValues(rows);
}

// Changes some columns of the row whose ID column matches.
function updateRowById(sheetName, idField, id, updates) {
  var row = firstWhere(readRows(sheetName), idField, id);
  if (!row) return false;
  var sheet = getSheet(sheetName);
  var headers = getSheetHeaders(sheet);
  for (var key in updates) {
    if (!updates.hasOwnProperty(key)) continue;
    var column = headers.indexOf(key);
    if (column === -1) continue;
    sheet.getRange(row._row, column + 1).setValue(updates[key]);
  }
  return true;
}

function deleteRowById(sheetName, idField, id) {
  var row = firstWhere(readRows(sheetName), idField, id);
  if (!row) return false;
  getSheet(sheetName).deleteRow(row._row);
  return true;
}

// Creates the next ID, for example STU006 (prefix "STU", 3 digits).
function generateId(sheetName, idField, prefix, digits) {
  var rows = readRows(sheetName);
  var highest = 0;
  for (var i = 0; i < rows.length; i++) {
    var id = String(rows[i][idField]);
    if (id.indexOf(prefix) === 0) {
      var number = parseInt(id.substring(prefix.length), 10);
      if (!isNaN(number) && number > highest) highest = number;
    }
  }
  var next = String(highest + 1);
  while (next.length < digits) next = "0" + next;
  return prefix + next;
}

// All rows whose field equals the value.
function where(rows, field, value) {
  var matches = [];
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][field]) === String(value)) matches.push(rows[i]);
  }
  return matches;
}

function firstWhere(rows, field, value) {
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][field]) === String(value)) return rows[i];
  }
  return null;
}

// Turns an array of rows into a lookup object: { STU001: row, STU002: row }
function indexBy(rows, field) {
  var lookup = {};
  for (var i = 0; i < rows.length; i++) lookup[String(rows[i][field])] = rows[i];
  return lookup;
}

// Trims text, removes control characters and limits the length.
function cleanText(value, maxLength) {
  var text = String(value === undefined || value === null ? "" : value);
  text = text.replace(/[\u0000-\u001F\u007F]/g, " ").trim();
  return text.substring(0, maxLength);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 120;
}

function round1(number) {
  return Math.round(number * 10) / 10;
}


// ==================================================
// 11. MOCK DATA / INITIALIZATION
// ==================================================

// Run this once from the Apps Script editor. It creates the six sheets and their headers.
function setupDatabase() {
  var spreadsheet = getSpreadsheet();
  var names = Object.keys(HEADERS);

  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var headers = HEADERS[name];
    var sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);

    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#12303a").setFontColor("#ffffff");
      sheet.setFrozenRows(1);
    }
    applyColumnFormats(sheet, headers);
  }

  // Remove the empty default sheet if it is still there.
  var defaultSheet = spreadsheet.getSheetByName("Sheet1");
  if (defaultSheet && spreadsheet.getSheets().length > 1 && defaultSheet.getLastRow() === 0) {
    spreadsheet.deleteSheet(defaultSheet);
  }
  Logger.log("Database ready: " + names.join(", "));
}

function applyColumnFormats(sheet, headers) {
  var rowCount = sheet.getMaxRows() - 1;
  if (rowCount < 1) return;
  for (var c = 0; c < headers.length; c++) {
    var format = "@";                                        // plain text
    if (NUMBER_COLUMNS.indexOf(headers[c]) !== -1) continue;  // keep numbers as numbers
    if (DATE_COLUMNS.indexOf(headers[c]) !== -1) format = "yyyy-mm-dd hh:mm:ss";
    sheet.getRange(2, c + 1, rowCount, 1).setNumberFormat(format);
  }
}

// Adds demonstration data. It only runs when every sheet is empty,
// so it can never overwrite real data by accident.
function createMockData() {
  setupDatabase();
  var names = Object.keys(HEADERS);
  for (var i = 0; i < names.length; i++) {
    if (getSheet(names[i]).getLastRow() > 1) {
      var message = 'The sheet "' + names[i] + '" already contains data. Use resetDatabaseWithMockData() to replace everything with demo data.';
      Logger.log(message);
      return message;
    }
  }
  insertMockData();
  Logger.log("Mock data created. Demo logins are listed in README.md.");
  return "Mock data created.";
}

// WARNING: deletes every data row in all six sheets, then adds the demo data again.
function resetDatabaseWithMockData() {
  setupDatabase();
  var names = Object.keys(HEADERS);
  for (var i = 0; i < names.length; i++) {
    var sheet = getSheet(names[i]);
    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
    }
  }
  PropertiesService.getScriptProperties().deleteAllProperties();
  insertMockData();
  Logger.log("Database reset with mock data.");
  return "Database reset with mock data.";
}

function insertMockData() {
  var demoStudentPassword = hashPassword("Student@123");

  // ---- Admin (demo account: admin / Admin@123) ----
  appendRowObjects(SHEETS.ADMIN, [
    { admin_id: "ADM001", username: "admin", password: hashPassword("Admin@123"), name: "System Administrator" }
  ]);

  // ---- Students (demo password for all: Student@123) ----
  var studentData = [
    ["STU001", "Chidinma Okafor", "chidinma.okafor@demo.edu", "Computer Science 400L", 60],
    ["STU002", "Tamuno Briggs", "tamuno.briggs@demo.edu", "Computer Science 400L", 55],
    ["STU003", "Ebiere Seigha", "ebiere.seigha@demo.edu", "Information Technology 300L", 48],
    ["STU004", "Oluwaseun Adeyemi", "oluwaseun.adeyemi@demo.edu", "Information Technology 300L", 40],
    ["STU005", "Fatima Bello", "fatima.bello@demo.edu", "Computer Science 400L", 35]
  ];
  var students = [];
  for (var s = 0; s < studentData.length; s++) {
    students.push({
      student_id: studentData[s][0],
      full_name: studentData[s][1],
      email: studentData[s][2],
      password: demoStudentPassword,
      "class": studentData[s][3],
      status: "Active",
      date_registered: daysAgo(studentData[s][4], 9, 0)
    });
  }
  appendRowObjects(SHEETS.STUDENTS, students);

  // ---- Questions: [exam_id, question, A, B, C, D, correct, marks] ----
  var questionData = [
    // EX001 ICT Fundamentals
    ["EX001", "Which of the following is an input device?", "Monitor", "Keyboard", "Printer", "Speaker", "B"],
    ["EX001", "What does CPU stand for?", "Central Processing Unit", "Computer Personal Unit", "Central Program Utility", "Core Processing Unit", "A"],
    ["EX001", "Which device connects a network to the Internet and directs data between them?", "Scanner", "Projector", "Router", "Plotter", "C"],
    ["EX001", "Which type of memory loses its content when the computer is switched off?", "ROM", "Hard disk", "Flash drive", "RAM", "D"],
    ["EX001", "How many bits are there in one byte?", "4", "8", "16", "32", "B"],
    ["EX001", "Which of the following is system software?", "Microsoft Word", "Google Sheets", "Windows operating system", "Adobe Photoshop", "C"],
    ["EX001", "What does URL stand for?", "Uniform Resource Locator", "Universal Reference Link", "United Resource Language", "Uniform Reference Locator", "A"],
    ["EX001", "Which of the following is a web browser?", "Linux", "Excel", "Python", "Google Chrome", "D"],
    ["EX001", "Which of the following is an output device?", "Mouse", "Microphone", "Monitor", "Scanner", "C"],
    ["EX001", "What is the main purpose of antivirus software?", "To speed up the Internet connection", "To increase screen brightness", "To store files online", "To detect and remove malicious software", "D"],
    // EX002 Computer Applications
    ["EX002", "In Microsoft Excel, which function adds the values in a range of cells?", "COUNT()", "AVERAGE()", "SUM()", "MAX()", "C"],
    ["EX002", "What is the default file extension of a modern Microsoft Word document?", ".xlsx", ".docx", ".pptx", ".txt", "B"],
    ["EX002", "Which keyboard shortcut is normally used to save a document?", "Ctrl + S", "Ctrl + P", "Ctrl + Z", "Ctrl + N", "A"],
    ["EX002", "In PowerPoint, what is a single page of a presentation called?", "Sheet", "Slide", "Frame", "Tab", "B"],
    ["EX002", "Which Excel cell reference points to column B, row 3?", "B3", "3B", "B-3", "R3C2", "A"],
    ["EX002", "Which application is mainly used to create spreadsheets?", "Microsoft Word", "Microsoft PowerPoint", "Microsoft Paint", "Microsoft Excel", "D"],
    ["EX002", "Which word processor feature helps find spelling mistakes?", "Thesaurus", "Spell Check", "Mail Merge", "Header and Footer", "B"],
    ["EX002", "What does the shortcut Ctrl + Z do in most applications?", "Redo the last action", "Close the window", "Undo the last action", "Zoom in", "C"],
    ["EX002", "Which of the following is a database management application?", "Microsoft Access", "Microsoft Outlook", "Notepad", "Windows Media Player", "A"],
    ["EX002", "What is a table used for in a word processor?", "To play audio", "To scan for viruses", "To change the font colour", "To organise data in rows and columns", "D"],
    // EX003 Introduction to Programming (inactive demo exam)
    ["EX003", "Which symbol starts a single-line comment in JavaScript?", "#", "//", "--", "<!--", "B"],
    ["EX003", "Which of the following is a programming language?", "Python", "Photoshop", "Chrome", "Excel", "A"],
    ["EX003", "What is a variable?", "A type of keyboard", "A kind of loop", "A named place that stores a value", "A web browser", "C"],
    ["EX003", "Which statement repeats code while a condition is true?", "if", "switch", "while", "return", "C"],
    ["EX003", "What does HTML stand for?", "Hyper Trainer Marking Language", "High Text Machine Language", "Hyper Transfer Markup Logic", "HyperText Markup Language", "D"]
  ];
  var questions = [];
  for (var q = 0; q < questionData.length; q++) {
    var item = questionData[q];
    questions.push({
      question_id: "Q" + pad(q + 1, 3),
      exam_id: item[0],
      question: item[1],
      option_a: item[2],
      option_b: item[3],
      option_c: item[4],
      option_d: item[5],
      correct_answer: item[6],
      marks: 2
    });
  }
  appendRowObjects(SHEETS.QUESTIONS, questions);

  // ---- Exams ----
  appendRowObjects(SHEETS.EXAMS, [
    {
      exam_id: "EX001", title: "ICT Fundamentals", subject: "Information and Communication Technology",
      description: "Basic computer hardware, software and Internet concepts.",
      duration_minutes: 15, total_questions: 10, pass_mark: 50, status: "Active", date_created: daysAgo(50, 10, 0)
    },
    {
      exam_id: "EX002", title: "Computer Applications", subject: "Office Productivity Software",
      description: "Word processing, spreadsheets and presentation software.",
      duration_minutes: 20, total_questions: 10, pass_mark: 50, status: "Active", date_created: daysAgo(45, 10, 0)
    },
    {
      exam_id: "EX003", title: "Introduction to Programming", subject: "Programming Basics",
      description: "Demo examination that is inactive. Activate it from the admin panel.",
      duration_minutes: 10, total_questions: 5, pass_mark: 50, status: "Inactive", date_created: daysAgo(10, 10, 0)
    }
  ]);

  // ---- Results: [student, exam, score, days ago, hour, minute, minutes spent] ----
  var resultData = [
    ["STU001", "EX001", 16, 30, 10, 5, 11],
    ["STU002", "EX001", 12, 29, 11, 20, 13],
    ["STU003", "EX001", 8, 28, 9, 40, 14],
    ["STU004", "EX001", 18, 28, 14, 10, 9],
    ["STU005", "EX001", 10, 27, 15, 30, 12],
    ["STU001", "EX002", 14, 20, 10, 15, 16],
    ["STU002", "EX002", 18, 19, 13, 0, 15],
    ["STU003", "EX002", 10, 18, 9, 30, 19],
    ["STU004", "EX002", 6, 18, 16, 45, 17]
  ];
  var results = [];
  for (var r = 0; r < resultData.length; r++) {
    var row = resultData[r];
    var totalMarks = 20;
    var percentage = Math.round((row[2] / totalMarks) * 10000) / 100;
    var started = daysAgo(row[3], row[4], row[5]);
    results.push({
      result_id: "RES" + pad(r + 1, 3),
      student_id: row[0],
      exam_id: row[1],
      score: row[2],
      total_marks: totalMarks,
      percentage: percentage,
      status: percentage >= 50 ? "PASS" : "FAIL",
      start_time: started,
      submit_time: new Date(started.getTime() + row[6] * 60000)
    });
  }
  appendRowObjects(SHEETS.RESULTS, results);

  // ---- Proctoring logs: [student, exam, type, description, days ago, hour, minute] ----
  var logData = [
    ["STU003", "EX001", "TAB_SWITCH", "The student switched to another browser tab.", 28, 9, 47],
    ["STU003", "EX001", "WINDOW_BLUR", "The examination window lost focus.", 28, 9, 52],
    ["STU002", "EX001", "FULLSCREEN_EXIT", "The student exited fullscreen mode.", 29, 11, 28],
    ["STU005", "EX001", "RIGHT_CLICK", "Right-click was attempted during the examination.", 27, 15, 38],
    ["STU004", "EX002", "COPY_ATTEMPT", "The student tried to copy examination content.", 18, 16, 52],
    ["STU004", "EX002", "KEYBOARD_RESTRICTION", "Restricted keyboard shortcut used: Ctrl+U.", 18, 16, 58],
    ["STU003", "EX002", "PASTE_ATTEMPT", "The student tried to paste into the examination.", 18, 9, 41],
    ["STU003", "EX002", "TAB_SWITCH", "The student switched to another browser tab.", 18, 9, 47]
  ];
  var logs = [];
  for (var l = 0; l < logData.length; l++) {
    var entry = logData[l];
    logs.push({
      log_id: "LOG" + pad(l + 1, 4),
      student_id: entry[0],
      exam_id: entry[1],
      event_type: entry[2],
      event_description: entry[3],
      timestamp: daysAgo(entry[4], entry[5], entry[6]),
      severity: EVENT_TYPES[entry[2]]
    });
  }
  appendRowObjects(SHEETS.LOGS, logs);
}

function daysAgo(days, hour, minute) {
  var date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function pad(number, digits) {
  var text = String(number);
  while (text.length < digits) text = "0" + text;
  return text;
}
