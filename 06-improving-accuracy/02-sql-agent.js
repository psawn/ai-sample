// =======================================================================
// HƯỚNG DẪN: SQL AGENT — HỎI BẰNG TIẾNG ANH, MODEL VIẾT SQL, CHẠY TRÊN DB THẬT
// =======================================================================
//
// 1. LUỒNG HOẠT ĐỘNG:
//    - Cung cấp schema (cột, kiểu dữ liệu) và câu hỏi -> Model tự viết câu lệnh SQL.
//    - Schema chỉ có tên + kiểu dữ liệu thường dễ khiến model đoán sai -> Cần kèm ví dụ giá trị thực tế.
//
// 2. KỸ THUẬT STRUCTURED OUTPUT:
//    - Ép model trả về kết quả dưới dạng JSON chuẩn (VD: { sql_query: "..." }).
//    - Giúp trích xuất SQL dễ dàng trực tiếp mà không cần cắt gọt các ký tự thừa trong đoạn chat.
//    - Đổi lại: model phải viết SQL ngay từ chữ đầu, không có chỗ giải thích trước -> SQL dễ sai hơn.
//      VD câu ở file này: viết tự do (phần 2) model tự nhắc "phải bỏ $ và , rồi đổi sang số" rồi mới viết SQL;
//      ép JSON (phần 3) model hay viết luôn ORDER BY salary DESC (sắp theo chữ -> ra sai người).
//
// 3. BẪY DỮ LIỆU & HALLUCINATION (MODEL BỊA CÚ PHÁP):
//    - Cột `salary` lưu dạng chuỗi ký tự chứa tiền tệ (VD: "$9,945,830", rỗng ghi "--").
//    - Cần xử lý loại bỏ dấu "$", dấu "," và lọc giá trị "--" trước khi ép kiểu sang dạng số.
//    - Đáp án đúng thực tế: Stephen Curry, $51,915,615.
//
// 4. LƯU Ý KHI CHẠY MODEL NHỎ (như Qwen3 8B):
//    - Model nhỏ rất dễ viết SQL sai ngữ cảnh -> Phải thực thi trên Database thật để kiểm chứng đúng sai.
// =======================================================================

require("dotenv").config();

const { Ollama } = require("ollama");
const { Client } = require("pg");

const MODEL = "qwen3:latest";

// Dùng 127.0.0.1 thay vì localhost: Tránh lỗi phân giải IPv6 (::1) trên Node 18+ gây mất kết nối Ollama
const ollama = new Ollama({
  host: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
});

/** In tiêu đề phân cách từng phần trong console */
function section(title) {
  const line = "=".repeat(60);
  console.log(`\n\n${line}\n ${title}\n${line}`);
}

/** In nhãn con trong một phần (Câu hỏi, Model trả lời, SQL, Kết quả...) */
function label(name) {
  console.log(`\n--- ${name} ---`);
}

/** Ghép prompt theo chuẩn template ChatML của Qwen3 */
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
 * Nếu có truyền tham số `format`, ép model trả về đúng JSON Schema quy định.
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

/** Thực thi câu lệnh SQL trên Postgres và in kết quả dạng bảng */
async function runSql(db, sql) {
  label("SQL");
  console.log(sql);
  label("Kết quả");
  try {
    const { rows } = await db.query(sql);
    console.table(rows);
  } catch (err) {
    console.log(`LỖI: ${err.message}`);
  }
}

// =======================================================================
// KHỞI TẠO SCHEMA
// =======================================================================

/** Bản schema sơ sài: Chỉ có tên cột và kiểu dữ liệu */
function getSchema() {
  return `\
0|team|TEXT
1|name|TEXT
2|jersey|TEXT
3|pos|TEXT
4|age|INT
5|ht|TEXT
6|wt|TEXT
7|college|TEXT
8|salary|TEXT
`;
}

/** Bản schema chi tiết: Kèm theo ví dụ giá trị mẫu và giá trị khi dữ liệu trống */
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

/** Tạo System Prompt định hình vai trò chuyên gia phân tích SQL */
function makeSystemPrompt(schema) {
  return `You are an NBA analyst with 15 years of experience writing complex SQL queries. Consider the nba_roster table with the following schema:
${schema}
Write a PostgreSQL query to answer the following question. Follow instructions exactly`;
}

// Định nghĩa khuôn JSON mẫu cho Structured Output: { sql_query: "..." }
const SQL_OUTPUT_FORMAT = {
  type: "object",
  properties: { sql_query: { type: "string" } },
  required: ["sql_query"],
};

const user = "Who is the highest paid NBA player?";

async function main() {
  const db = new Client({ connectionString: process.env.POSTGRES_URI });
  await db.connect();

  try {
    section("1. Schema sơ sài (Chỉ có tên cột & kiểu dữ liệu)");
    const system = makeSystemPrompt(getSchema());
    label("System prompt");
    console.log(system);
    label("Câu hỏi");
    console.log(user);
    label("Model trả lời");
    console.log(await generate(makeQwenPrompt(user, system)));

    section("2. Schema chi tiết (Có kèm ví dụ giá trị thực tế)");
    const updatedSystem = makeSystemPrompt(getUpdatedSchema());
    const prompt = makeQwenPrompt(user, updatedSystem);
    label("System prompt");
    console.log(updatedSystem);
    label("Câu hỏi");
    console.log(user);
    label("Model trả lời");
    console.log(await generate(prompt));

    section("3. Structured Output: Ép model trả về kết quả dạng JSON chuẩn");
    label("System prompt");
    console.log(updatedSystem);
    label("Câu hỏi");
    console.log(user);
    const result = await generate(prompt, { format: SQL_OUTPUT_FORMAT });
    label("Model trả về (JSON)");
    console.log(result);

    section("4. Thực thi câu lệnh SQL vừa sinh ra trên Database thật");
    await runSql(db, result.sql_query);
  } finally {
    await db.end();
  }
}

main().catch(console.error);
