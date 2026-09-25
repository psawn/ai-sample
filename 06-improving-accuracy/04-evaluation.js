// =======================================================================
// HƯỚNG DẪN: EVALUATION — CHẤM ĐIỂM TỰ ĐỘNG CHO SQL AGENT TRÊN BỘ ĐỀ
// =======================================================================
//
// 1. MỤC ĐÍCH:
//    - Đánh giá năng lực tổng thể của model qua một bộ đề chuẩn (Gold Dataset: `data/gold-test-set.jsonl`).
//
// 2. QUY TRÌNH CHẤM 1 CÂU (`checkOneQuestion`):
//    - Bước 1: Model sinh SQL và thực thi trực tiếp trên PostgreSQL.
//    - Bước 2: Chạy câu SQL chuẩn có sẵn trong bộ đề để lấy đáp án gốc.
//    - Bước 3: Đối chiếu kết quả:
//      + Nếu SQL sinh lỗi -> Tính là SAI.
//      + Nếu kết quả trả về giống hệt nhau -> Tính là ĐÚNG.
//      + Nếu kết quả khác biệt -> Gọi LLM làm "Giám khảo" đối chiếu xem ý nghĩa dữ liệu có tương đương nhau không (VD: khác tên cột `count` và `num_players`).
//
// 3. KẾT QUẢ ĐẦU RA:
//    - Lưu toàn bộ thống kê vào thư mục `data/results/`: `summary.txt`, `sql_results.jsonl`, `sql_errors.jsonl`, `args.json`.
//
// 4. LƯU Ý:
//    - SQL được ép trả về dạng JSON (SQL_OUTPUT_FORMAT) -> điểm thấp hơn so với cho model viết tự do,
//      vì model không có chỗ suy nghĩ trước khi viết SQL (VD câu "highest paid" hay ra ORDER BY salary DESC).
// =======================================================================

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const { Ollama } = require("ollama");
const { Client } = require("pg");

// =======================================================================
// CẤU HÌNH HỆ THỐNG
// =======================================================================

const MODEL = "qwen3:latest";
const DATA_DIR = path.join(__dirname, "data");
const RESULTS_DIR = path.join(DATA_DIR, "results");

// Lưu lại thông số cấu hình chạy để đối chiếu kết quả sau này
const ARGS = {
  sqlModelName: MODEL,
  maxExamples: 100, // Giới hạn số lượng câu hỏi cần chấm từ bộ đề
  goldFileName: "gold-test-set.jsonl",
};

// Dùng 127.0.0.1 thay vì localhost: Tránh lỗi phân giải IPv6 (::1) trên Node 18+ gây mất kết nối Ollama
const ollama = new Ollama({
  host: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
});

// =======================================================================
// HÀM HỖ TRỢ HIỂN THỊ LOG
// =======================================================================

/** In tiêu đề phân cách từng phần trên console */
function section(title) {
  const line = "=".repeat(60);
  console.log(`\n\n${line}\n ${title}\n${line}`);
}

/** In nhãn con cho từng bước thực thi */
function label(name) {
  console.log(`\n--- ${name} ---`);
}

/** Định dạng lại câu lệnh SQL cho dễ đọc (chỉ áp dụng cho phần hiển thị log) */
function formatSql(sql) {
  return sql
    .replace(/\s+/g, " ")
    .replace(/ (FROM|WHERE|GROUP BY|HAVING|ORDER BY|LIMIT|OFFSET|JOIN|UNION)\b/gi, "\n$1")
    .trim();
}

/** Thụt lề nội dung văn bản */
function indent(text, spaces = 4) {
  return text.replace(/^/gm, " ".repeat(spaces));
}

/** In tiêu đề cho từng câu hỏi đang được chấm */
function printQuestionHeader(number, total, question) {
  const line = "-".repeat(60);
  console.log(`\n${line}\n[${number}/${total}] Câu hỏi: ${question}\n${line}`);
}

/** In kết quả chi tiết của 1 câu sau khi chấm */
function printResult(result) {
  const modelOutput = result.modelError ? `LỖI: ${result.modelError}` : JSON.stringify(result.modelRows);

  console.log("SQL model viết:");
  console.log(indent(formatSql(result.modelSql) || "(không có)"));
  console.log(`Kết quả model : ${modelOutput}`);
  console.log(`Kết quả đúng  : ${JSON.stringify(result.correctRows)}`);
  console.log(`=> ${result.isCorrect ? "ĐÚNG" : "SAI"} — ${result.reason}`);
}

/** In danh sách tổng kết cuối chương trình */
function printSummaryList(results) {
  for (const [index, result] of results.entries()) {
    let verdict = result.isCorrect ? "ĐÚNG" : "SAI";
    if (result.modelError) verdict = "SAI - SQL lỗi";

    console.log(`\n${index + 1}. [${verdict}] ${result.question}`);
    console.log(indent(formatSql(result.modelSql) || "(không có)"));
  }
  console.log("");
}

// =======================================================================
// GỌI MODEL & XỬ LÝ DỮ LIỆU
// =======================================================================

/** Ghép prompt theo chuẩn template ChatML của Qwen3 */
function makeQwenPrompt(user, system = "") {
  const systemBlock = system ? `<|im_start|>system\n${system}<|im_end|>\n` : "";
  return (
    systemBlock +
    `<|im_start|>user\n${user}<|im_end|>\n` +
    `<|im_start|>assistant\n<think>\n\n</think>\n\n`
  );
}

/** Gửi prompt tới Ollama, hỗ trợ ép kiểu kết quả trả về theo JSON Schema (`format`) */
async function generate(prompt, { maxNewTokens = 300, format } = {}) {
  const res = await ollama.generate({
    model: MODEL,
    prompt,
    raw: true, // Tắt template tự động của Ollama
    format,
    options: { num_predict: maxNewTokens },
  });
  return format ? JSON.parse(res.response) : res.response.trim();
}

// =======================================================================
// KHUÔN MẪU PROMPT & SCHEMA SQL
// =======================================================================

function getUpdatedSchema() {
  return `\
0|team|TEXT eg. "Toronto Raptors"
1|name|TEXT eg. "Otto Porter Jr."
2|jersey|TEXT eg. "0" and when null has a value "NA"
3|pos|TEXT eg. "PF"
4|age|INT eg. "22" in years
5|ht|TEXT eg. \`6' 7"\` or \`6' 10"\`
6|wt|TEXT eg. "232 lbs"
7|college|TEXT eg. "Michigan" and when null has a value "--"
8|salary|TEXT eg. "$9,945,830" and when null has a value "--"
`;
}

function makeSqlSystemPrompt() {
  return `You are an NBA analyst with 15 years of experience writing complex SQL queries. Consider the nba_roster table with the following schema:
${getUpdatedSchema()}
Write a PostgreSQL query to answer the following question. Follow instructions exactly`;
}

// Khuôn JSON cấu trúc đầu ra bắt buộc cho SQL: { sql_query: "..." }
// Ép JSON thì dễ lấy SQL, nhưng model phải viết SQL ngay, không có chỗ suy nghĩ trước
// -> dễ sai hơn viết tự do (xem phần STRUCTURED OUTPUT trong 02-sql-agent.js)
const SQL_OUTPUT_FORMAT = {
  type: "object",
  properties: { sql_query: { type: "string" } },
  required: ["sql_query"],
};

/** Yêu cầu model viết SQL dựa trên câu hỏi */
async function askForSql(question) {
  const prompt = makeQwenPrompt(question, makeSqlSystemPrompt());
  const json = await generate(prompt, { format: SQL_OUTPUT_FORMAT });
  return json.sql_query;
}

/** Thực thi câu lệnh SQL, trả về kết quả hoặc bắt lỗi an toàn */
async function tryQuery(db, sql) {
  try {
    const { rows } = await db.query(sql);
    return { rows };
  } catch (err) {
    return { error: err.message };
  }
}

/** Chuẩn hóa kết quả rows thành chuỗi chữ thường để so sánh */
function rowsToText(rows) {
  return rows ? JSON.stringify(rows).toLowerCase() : "none";
}

// =======================================================================
// CƠ CHẾ GIÁM KHẢO (LLM JUDGE)
// =======================================================================

const JUDGE_SYSTEM_PROMPT =
  "Compare the following two query results. They are similar if they are almost identical, " +
  "or if they convey the same information about the nba_roster dataset. " +
  "Respond with valid JSON {'explanation' : str, 'similar' : bool}";

const JUDGE_OUTPUT_FORMAT = {
  type: "object",
  properties: { explanation: { type: "string" }, similar: { type: "boolean" } },
  required: ["explanation", "similar"],
};

function makeJudgeUserPrompt(modelRows, correctRows) {
  return (
    `========== Result 1 =========\n${rowsToText(modelRows)}\n\n` +
    `========== Result 2 =========\n${rowsToText(correctRows)}\n\n` +
    "Can you tell me if these results are similar?"
  );
}

/** Sử dụng mô hình LLM làm giám khảo đối chiếu độ tương đồng của hai tập kết quả */
async function askJudge(modelRows, correctRows) {
  try {
    const prompt = makeQwenPrompt(makeJudgeUserPrompt(modelRows, correctRows), JUDGE_SYSTEM_PROMPT);
    const { explanation, similar } = await generate(prompt, { format: JUDGE_OUTPUT_FORMAT });
    return { isCorrect: similar, reason: `Giám khảo: ${explanation}` };
  } catch (err) {
    return { isCorrect: false, reason: `Giám khảo trả về JSON hỏng: ${err.message}` };
  }
}

// =======================================================================
// QUY TRÌNH CHẤM ĐIỂM
// =======================================================================

/** Đọc danh sách câu hỏi từ bộ đề mẫu (Gold Dataset) */
function loadGoldDataset() {
  const text = fs.readFileSync(path.join(DATA_DIR, ARGS.goldFileName), "utf8");
  const lines = text.split("\n").filter((line) => line.trim());
  return lines.map((line) => JSON.parse(line)).slice(0, ARGS.maxExamples);
}

/** Model sinh SQL và chạy thử nghiệm */
async function runModelSql(db, question) {
  let sql;
  try {
    sql = await askForSql(question);
  } catch (err) {
    return { sql: "", rows: undefined, error: `Model trả về JSON hỏng: ${err.message}` };
  }
  const { rows, error } = await tryQuery(db, sql);
  return { sql, rows, error };
}

/** Chấm điểm kết quả của model so với đáp án chuẩn */
async function grade(modelRun, correctRows) {
  if (modelRun.error) {
    return { isCorrect: false, reason: "SQL lỗi" };
  }

  if (rowsToText(modelRun.rows) === rowsToText(correctRows)) {
    return { isCorrect: true, reason: "Giống hệt kết quả đúng" };
  }

  return askJudge(modelRun.rows, correctRows);
}

/** Thực hiện chấm điểm hoàn chỉnh cho 1 câu hỏi */
async function checkOneQuestion(db, testCase) {
  const modelRun = await runModelSql(db, testCase.question);
  const correctRows = (await db.query(testCase.sql)).rows;
  const { isCorrect, reason } = await grade(modelRun, correctRows);

  return {
    question: testCase.question,
    modelSql: modelRun.sql,
    modelRows: modelRun.rows,
    modelError: modelRun.error,
    correctSql: testCase.sql,
    correctRows,
    isCorrect,
    reason,
  };
}

// =======================================================================
// LƯU KẾT QUẢ ĐÁNH GIÁ
// =======================================================================

function writeJsonl(fileName, results) {
  const lines = results.map((result) => JSON.stringify(result) + "\n");
  fs.writeFileSync(path.join(RESULTS_DIR, fileName), lines.join(""));
}

/** Lưu toàn bộ báo cáo tổng kết và chi tiết vào thư mục kết quả */
function saveResults(results) {
  const correct = results.filter((result) => result.isCorrect);
  const wrong = results.filter((result) => !result.isCorrect);
  const sqlRan = results.filter((result) => !result.modelError);
  const percent = (list) => ((list.length / results.length) * 100).toFixed(1);

  const summary = [
    `Số câu trong bộ đề : ${results.length}`,
    `SQL chạy được      : ${sqlRan.length} câu (${percent(sqlRan)}%)`,
    `SQL đúng           : ${correct.length} câu (${percent(correct)}%)`,
  ];

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, "args.json"), JSON.stringify(ARGS, null, 2));
  writeJsonl("sql_results.jsonl", correct);
  writeJsonl("sql_errors.jsonl", wrong);
  fs.writeFileSync(path.join(RESULTS_DIR, "summary.txt"), summary.join("\n") + "\n");

  return summary;
}

// =======================================================================
// LUỒNG CHẠY CHÍNH (MAIN)
// =======================================================================

async function main() {
  const db = new Client({ connectionString: process.env.POSTGRES_URI });
  await db.connect();
  
  // Thiết lập chế độ chỉ đọc để đảm bảo an toàn tuyệt đối cho cơ sở dữ liệu
  await db.query("SET default_transaction_read_only = on");

  try {
    const dataset = loadGoldDataset();

    section(`1. Tiến hành chấm điểm tự động (${dataset.length} câu)`);
    label("System prompt viết SQL");
    console.log(makeSqlSystemPrompt());
    label("System prompt Giám khảo");
    console.log(JUDGE_SYSTEM_PROMPT);

    const results = [];
    for (const [index, testCase] of dataset.entries()) {
      printQuestionHeader(index + 1, dataset.length, testCase.question);

      const result = await checkOneQuestion(db, testCase);
      printResult(result);
      results.push(result);
    }

    section("2. Tổng kết toàn bộ kết quả");
    printSummaryList(results);

    const summary = saveResults(results);
    console.log(summary.join("\n"));
    console.log(`\nĐã ghi toàn bộ kết quả vào thư mục: ${RESULTS_DIR}`);
  } finally {
    await db.end();
  }
}

main().catch(console.error);