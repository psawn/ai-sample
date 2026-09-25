// =======================================================================
// HƯỚNG DẪN: REFLECTION — TỰ ĐỘNG SỬA LỖI SQL DỰA TRÊN THÔNG BÁO THỰC TẾ
// =======================================================================
//
// 1. CƠ CHẾ REFLECTION:
//    - Model sinh SQL cho câu hỏi khó: "What is the median weight in the NBA?" (Median = giá trị trung vị).
//    - Cột `wt` lưu dạng chuỗi (VD: "232 lbs") -> Model phải biết bóc tách số liệu mới tính toán được.
//    - Nếu SQL chạy phát sinh lỗi từ PostgreSQL, ta gửi trả lại model: [Câu hỏi + SQL hỏng + Thông báo lỗi].
//    - Việc nhận đúng lỗi thực tế giúp model nhận diện sai sót và sửa lại chính xác hơn ở lượt sau.
//
// 2. LƯU Ý QUAN TRỌNG:
//    - SQL chạy không lỗi chưa chắc đã ra đúng ý nghĩa nghiệp vụ -> So sánh với kết quả gốc (Gold dataset) ở phần 3.
//    - Model nhỏ có thể sinh SQL khác nhau ở mỗi lần chạy (nếu lần 1 chạy ngon lành thì phần 2 sẽ tự động bỏ qua).
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
const QUESTION = "What is the median weight in the NBA?";

// Bộ đề chuẩn chứa câu hỏi và câu SQL chính xác (dùng để đối chiếu kết quả)
const GOLD_FILE = path.join(__dirname, "data", "gold-test-set.jsonl");

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

/**
 * Định dạng lại chuỗi SQL cho dễ đọc (xuống dòng ở các mệnh đề chính).
 * Chỉ dùng cho mục đích hiển thị log, không làm ảnh hưởng đến câu lệnh chạy thật.
 */
function formatSql(sql) {
  return sql
    .replace(/\s+/g, " ")
    .replace(
      / (FROM|WHERE|GROUP BY|HAVING|ORDER BY|LIMIT|OFFSET|JOIN|UNION)\b/gi,
      "\n$1",
    )
    .trim();
}

// =======================================================================
// GỌI MODEL & XỬ LÝ CƠ SỞ DỮ LIỆU
// =======================================================================

/** Ghép prompt theo tiêu chuẩn template ChatML của Qwen3 */
function makeQwenPrompt(user, system = "") {
  const systemBlock = system ? `<|im_start|>system\n${system}<|im_end|>\n` : "";
  return (
    systemBlock +
    `<|im_start|>user\n${user}<|im_end|>\n` +
    `<|im_start|>assistant\n<think>\n\n</think>\n\n`
  );
}

/**
 * Gửi prompt tới Ollama.
 * Ép buộc trả kết quả về dạng JSON chuẩn theo schema `format`.
 */
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

/** Yêu cầu model viết SQL và trích xuất chuỗi SQL từ JSON trả về */
async function askForSql(user, system) {
  const json = await generate(makeQwenPrompt(user, system), {
    format: SQL_OUTPUT_FORMAT,
  });
  return json.sql_query;
}

/**
 * Thực thi câu lệnh SQL.
 * Trả về object `{ rows }` nếu thành công, hoặc `{ error }` nếu có lỗi (không làm crash app).
 */
async function tryQuery(db, sql) {
  try {
    const { rows } = await db.query(sql);
    return { rows };
  } catch (err) {
    return { error: err.message };
  }
}

/** Hiển thị kết quả truy vấn hoặc in lỗi chi tiết */
function printQueryResult({ rows, error }) {
  if (error) console.log(`LỖI: ${error}`);
  else console.table(rows);
}

/** Lấy câu SQL chuẩn xác từ bộ đề mẫu (Gold Dataset) */
function findCorrectSql(question) {
  const lines = fs
    .readFileSync(GOLD_FILE, "utf8")
    .split("\n")
    .filter((line) => line.trim());
  const testCase = lines
    .map((line) => JSON.parse(line))
    .find((item) => item.question === question);
  return testCase.sql;
}

// =======================================================================
// KHUÔN MẪU PROMPT & SCHEMA
// =======================================================================

/** Khai báo cấu trúc schema đính kèm ví dụ dữ liệu thực tế cho cột `wt` */
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

/** Khởi tạo system prompt định hình vai trò chuyên gia phân tích dữ liệu */
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

// =======================================================================
// LUỒNG CHẠY CHÍNH (MAIN)
// =======================================================================

async function main() {
  const db = new Client({ connectionString: process.env.POSTGRES_URI });
  await db.connect();

  // Thiết lập chế độ chỉ đọc để đảm bảo an toàn tuyệt đối cho Database
  await db.query("SET default_transaction_read_only = on");

  try {
    const system = makeSqlSystemPrompt();

    section("1. Model tự viết SQL và chạy thử nghiệm lần đầu");
    label("System prompt");
    console.log(system);
    label("Câu hỏi");
    console.log(QUESTION);

    const firstSql = await askForSql(QUESTION, system);
    label("SQL do model viết");
    console.log(formatSql(firstSql));

    const firstResult = await tryQuery(db, firstSql);
    label("Kết quả thực thi");
    printQueryResult(firstResult);

    section("2. Cơ chế Reflection: Phản hồi lỗi thực tế để model tự sửa");
    if (!firstResult.error) {
      console.log(
        "SQL ở lần 1 chạy thành công -> Bỏ qua bước Reflection (Lưu ý: Chạy được chưa chắc đã đúng logic, hãy xem phần 3).",
      );
    } else {
      // Đóng gói thông tin lỗi thực tế từ Postgres để cung cấp ngữ cảnh sửa lỗi cho model
      const reflection =
        `Question: ${QUESTION}. Query: ${firstSql}. ` +
        `This query is invalid (gets the error ${firstResult.error}), so it cannot answer the question. ` +
        "Write a corrected PostgreSQL query.";

      label("System prompt");
      console.log("(Giữ nguyên như phần 1)");
      label("Câu hỏi phản hồi (Bao gồm SQL hỏng + Lỗi từ Database)");
      console.log(reflection);

      const fixedSql = await askForSql(reflection, system);
      label("SQL sau khi model được sửa lỗi (Reflection)");
      console.log(formatSql(fixedSql));

      label("Kết quả thực thi sau khi sửa");
      printQueryResult(await tryQuery(db, fixedSql));
    }

    // Đối chiếu với đáp án chuẩn (Cắt bỏ chữ "lbs", ép kiểu số, sắp xếp và lấy trung vị)
    section("3. Đối chiếu với Đáp án Chuẩn (Gold Dataset)");
    const correctSql = findCorrectSql(QUESTION);
    label("SQL chuẩn (lấy từ gold-test-set.jsonl)");
    console.log(formatSql(correctSql));
    label("Kết quả chính xác");
    printQueryResult(await tryQuery(db, correctSql));
  } finally {
    await db.end();
  }
}

main().catch(console.error);
