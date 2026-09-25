// =======================================================================
// HƯỚNG DẪN: SINH DỮ LIỆU TRAIN (SYNTHETIC DATA) CHO TEXT-TO-SQL
// =======================================================================
//
// ----- MỤC ĐÍCH -----
// Fine-tune cần nhiều cặp { question, sql }, viết tay thì rất lâu.
// -> Nhờ LLM sinh thêm từ vài ví dụ có sẵn trong bộ đề (synthetic data = dữ liệu do máy tạo ra).
//
// ----- Ý TƯỞNG: ĐI NGƯỢC — SINH SQL TRƯỚC, CÂU HỎI SAU -----
// Bước 1: Đưa model schema + 3 ví dụ ngẫu nhiên trong bộ đề -> model viết 2 câu SQL mới "na ná nhưng khác".
// Bước 2: Chạy thử từng SQL trên Postgres -> SQL lỗi thì bỏ.
// Bước 3: Với mỗi SQL chạy được, hỏi model "SQL này trả lời câu hỏi gì?" -> được 1 cặp { question, sql }.
// Vì sao không sinh câu hỏi trước? SQL kiểm tra tự động được (chạy thử là biết), câu hỏi thì không.
//
// ----- CHAIN OF THOUGHT (COT) -----
// Bắt model viết `explanation` (giải thích) trước, rồi mới viết SQL / câu hỏi
// -> model có chỗ "nghĩ thành lời" trước khi trả lời, nên ít sai hơn.
// Key `explanation` đặt đầu JSON Schema để model viết nó trước.
//
// ----- LƯU Ý -----
// - SQL chạy được chưa chắc đúng ý, câu hỏi sinh ra có thể lệch với SQL -> cần lọc tiếp ở 06-filter-data.js.
// - Không ghép bộ đề vào file train (APPEND_GOLD_EXAMPLES = false): bộ đề dùng để chấm ở 04-evaluation.js,
//   model đã thấy đề lúc train thì điểm chấm bị ảo (data leakage = rò dữ liệu test vào train).
//
// ----- CÁCH CHẠY -----
//   node 06-improving-accuracy/05-generate-data.js        -> 10 lượt (mặc định)
//   node 06-improving-accuracy/05-generate-data.js 3      -> 3 lượt (chạy thử cho nhanh)
// Mỗi lượt cho tối đa 2 cặp. Kết quả: data/training_data/generated_queries.jsonl
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
const GOLD_FILE = path.join(DATA_DIR, "gold-test-set.jsonl");
const OUTPUT_FILE = path.join(DATA_DIR, "training_data", "generated_queries.jsonl");

const NUM_TO_GENERATE = Number(process.argv[2]) || 10; // Số lượt sinh
const SAMPLE_SIZE = 3; // Mỗi lượt lấy ngẫu nhiên 3 ví dụ trong bộ đề làm mẫu
const RANDOM_SEED = 42; // Cố định seed -> lần chạy nào cũng chọn cùng các ví dụ, dễ so sánh
const APPEND_GOLD_EXAMPLES = false; // true = ghép cả bộ đề vào file train (bị rò đề, xem LƯU Ý ở đầu file)

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

// =======================================================================
// GỌI MODEL & DATABASE
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

/** Gửi prompt tới Ollama, ép kết quả trả về theo JSON Schema (`format`) */
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

/** Thực thi câu lệnh SQL, trả về `{ rows }` hoặc `{ error }` (không làm crash app) */
async function tryQuery(db, sql) {
  try {
    const { rows } = await db.query(sql);
    return { rows };
  } catch (err) {
    return { error: err.message };
  }
}

// =======================================================================
// CHỌN VÍ DỤ NGẪU NHIÊN (CÓ SEED)
// =======================================================================

/**
 * Tạo hàm random có seed (thuật toán mulberry32).
 * Khác Math.random: cùng seed -> luôn ra cùng một dãy số -> chạy lại vẫn chọn đúng các ví dụ cũ.
 */
function createRandom(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lấy ngẫu nhiên `count` phần tử không trùng nhau (xáo trộn kiểu Fisher-Yates rồi cắt lấy phần đầu) */
function pickRandom(items, count, random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

// =======================================================================
// KHUÔN MẪU PROMPT & SCHEMA
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

const ANALYST_INTRO =
  "You are an NBA analyst with 15 years of experience writing complex SQL queries.\n" +
  "Consider a table called 'nba_roster' with the following schema (columns)\n";

/**
 * Bước 1 — Prompt nhờ model viết 2 SQL mới, dựa trên các ví dụ { question, sql }.
 * Mẹo: chọn ví dụ giống những câu model hay sai -> data sinh ra dạy đúng chỗ model yếu.
 */
function makeQueryPrompt(examples) {
  let system = ANALYST_INTRO + getUpdatedSchema();
  system += "Consider the following questions, and queries used to answer them:\n";
  for (const example of examples) {
    system += `Question: ${example.question}\nQuery: ${example.sql}\n`;
  }

  const user =
    "Write two queries that are similar but different to those above.\n" +
    "Format the queries as a JSON object, i.e.\n" +
    '{ "explanation": str, "sql_query_1" : str, "sql_query_2": str }.\n' +
    "First write an explanation of why you decided to write these new queries in about 3-5 sentences, " +
    "then write valid PostgreSQL queries for each of the 2 new queries. " +
    "Make sure each query is complete and ends with a ;\n";

  return makeQwenPrompt(user, system);
}

/** Bước 3 — Prompt nhờ model đặt câu hỏi cho 1 SQL (ví dụ mẫu đảo thứ tự: Query trước, Question sau) */
function makeQuestionPrompt(examples, sql) {
  let system = ANALYST_INTRO + getUpdatedSchema() + "\n";
  system += "Queries, and questions that they are used to answer:\n";
  for (const example of examples) {
    system += `Query: ${example.sql}\nQuestion: ${example.question}\n`;
  }

  const user =
    "Now consider the following query.\n" +
    `Query: ${sql}\n` +
    "Write a question that this query could be used to answer.\n" +
    "Format your response as a JSON object, i.e.\n" +
    '{ "explanation": str, "question": str }.\n' +
    "First write an explanation in about 3-5 sentences, then write a one sentence question.\n";

  return makeQwenPrompt(user, system);
}

const QUERY_OUTPUT_FORMAT = {
  type: "object",
  properties: {
    explanation: { type: "string" },
    sql_query_1: { type: "string" },
    sql_query_2: { type: "string" },
  },
  required: ["explanation", "sql_query_1", "sql_query_2"],
};

const QUESTION_OUTPUT_FORMAT = {
  type: "object",
  properties: { explanation: { type: "string" }, question: { type: "string" } },
  required: ["explanation", "question"],
};

// maxNewTokens để dư: JSON bị cắt giữa chừng thì JSON.parse báo lỗi, mất cả lượt
async function generateQueries(examples) {
  return generate(makeQueryPrompt(examples), { maxNewTokens: 600, format: QUERY_OUTPUT_FORMAT });
}

async function generateQuestion(examples, sql) {
  return generate(makeQuestionPrompt(examples, sql), {
    maxNewTokens: 300,
    format: QUESTION_OUTPUT_FORMAT,
  });
}

// =======================================================================
// QUY TRÌNH SINH DỮ LIỆU
// =======================================================================

/** Đọc toàn bộ bộ đề mẫu (Gold Dataset) */
function loadGoldDataset() {
  const lines = fs
    .readFileSync(GOLD_FILE, "utf8")
    .split("\n")
    .filter((line) => line.trim());
  return lines.map((line) => JSON.parse(line));
}

/**
 * Chạy 1 lượt đủ 3 bước với một nhóm ví dụ.
 * Trả về danh sách cặp { question, sql } hợp lệ (0–2 cặp).
 */
async function runOneRound(db, examples) {
  const { explanation, sql_query_1, sql_query_2 } = await generateQueries(examples);
  console.log(`Giải thích: ${explanation}`);

  const pairs = [];
  for (const sql of [sql_query_1, sql_query_2]) {
    console.log(`\nSQL mới:\n${indent(formatSql(sql))}`);

    const { error } = await tryQuery(db, sql);
    if (error) {
      console.log(`=> BỎ — SQL lỗi: ${error}`);
      continue;
    }

    const { question } = await generateQuestion(examples, sql);
    console.log(`=> GIỮ — Câu hỏi: ${question}`);
    pairs.push({ question, sql });
  }
  return pairs;
}

/** Ghi thêm 1 dòng JSON vào file output (ghi dần từng lượt -> chạy lỗi giữa chừng vẫn giữ được phần đã sinh) */
function appendJsonl(record) {
  fs.appendFileSync(OUTPUT_FILE, JSON.stringify(record) + "\n");
}

// =======================================================================
// LUỒNG CHẠY CHÍNH (MAIN)
// =======================================================================

async function main() {
  const db = new Client({ connectionString: process.env.POSTGRES_URI });
  await db.connect();

  // Chỉ đọc: SQL do model viết được chạy thật, chặn trước mọi lệnh ghi/xóa dữ liệu
  await db.query("SET default_transaction_read_only = on");

  try {
    const goldExamples = loadGoldDataset();

    // ---------- 1. Xem thử 1 lượt với 1 ví dụ, in đầy đủ prompt ----------
    section("1. Demo bước 1: Từ 1 ví dụ, model viết 2 SQL mới");
    const demoExamples = goldExamples.slice(0, 1);
    const queryPrompt = makeQueryPrompt(demoExamples);
    label("Prompt (raw, gồm cả template ChatML)");
    console.log(queryPrompt);

    const demo = await generateQueries(demoExamples);
    label("Model trả về");
    console.log(`Giải thích: ${demo.explanation}`);

    let demoValidSql;
    for (const sql of [demo.sql_query_1, demo.sql_query_2]) {
      const { error } = await tryQuery(db, sql);
      console.log(`\n${indent(formatSql(sql))}`);
      console.log(error ? `=> SQL lỗi: ${error}` : "=> Chạy được");
      if (!error && !demoValidSql) demoValidSql = sql;
    }

    section("2. Demo bước 3: Model đặt câu hỏi cho SQL vừa sinh");
    if (!demoValidSql) {
      console.log("Cả 2 SQL đều lỗi -> bỏ qua demo này (phần 3 vẫn chạy bình thường).");
    } else {
      label("Prompt (raw)");
      console.log(makeQuestionPrompt(demoExamples, demoValidSql));
      const { explanation, question } = await generateQuestion(demoExamples, demoValidSql);
      label("Model trả về");
      console.log(`Giải thích: ${explanation}`);
      console.log(`Câu hỏi   : ${question}`);
    }

    // ---------- 3. Chạy thật: nhiều lượt, mỗi lượt 3 ví dụ ngẫu nhiên ----------
    section(`3. Sinh dữ liệu: ${NUM_TO_GENERATE} lượt × ${SAMPLE_SIZE} ví dụ mẫu`);
    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, ""); // Xóa kết quả lần chạy trước

    const random = createRandom(RANDOM_SEED);
    let savedCount = 0;

    // Chạy tuần tự: Ollama local xử lý lần lượt từng request, chạy song song cũng không nhanh hơn
    for (let round = 1; round <= NUM_TO_GENERATE; round++) {
      const examples = pickRandom(goldExamples, SAMPLE_SIZE, random);
      label(`Lượt ${round}/${NUM_TO_GENERATE} — ví dụ mẫu: ${examples.map((e) => `"${e.question}"`).join(", ")}`);

      try {
        const pairs = await runOneRound(db, examples);
        pairs.forEach(appendJsonl);
        savedCount += pairs.length;
      } catch (err) {
        // Thường do JSON trả về bị hỏng -> bỏ lượt này, chạy tiếp lượt sau
        console.log(`=> BỎ CẢ LƯỢT — lỗi: ${err.message}`);
      }
    }

    if (APPEND_GOLD_EXAMPLES) {
      goldExamples.forEach(({ question, sql }) => appendJsonl({ question, sql }));
      savedCount += goldExamples.length;
    }

    section("4. Tổng kết");
    console.log(`Đã lưu ${savedCount} cặp { question, sql } vào: ${OUTPUT_FILE}`);
    console.log("Bước tiếp theo: node 06-improving-accuracy/06-filter-data.js");
  } finally {
    await db.end();
  }
}

main().catch(console.error);
