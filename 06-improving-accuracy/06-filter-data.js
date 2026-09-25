// =======================================================================
// HƯỚNG DẪN: LỌC DỮ LIỆU TRAIN — BỎ CÁC CẶP { question, sql } KÉM CHẤT LƯỢNG
// =======================================================================
//
// ----- VÌ SAO PHẢI LỌC -----
// Data do LLM sinh (05-generate-data.js) có lẫn rác: trùng lặp, SQL chạy ra rỗng, SQL dùng sai cột...
// Model học y hệt những gì có trong data -> train trên rác thì model viết ra rác ("garbage in, garbage out").
//
// ----- CÁC LUẬT LỌC -----
//   Luật                          | Bỏ khi
//   ------------------------------|-----------------------------------------------------------
//   Trùng lặp                     | Câu hỏi hoặc SQL đã xuất hiện ở cặp trước
//   SQL lỗi                       | Không chạy được trên Postgres
//   Có chữ "null"                 | Bảng ghi "NA" / "--" thay cho null -> SQL tìm null là hiểu sai dữ liệu
//   Kết quả rỗng / có ô null      | SQL chạy được nhưng không trả lời được gì
//   AVG trên cột chữ (ht, salary) | ht là `6' 7"`, salary là "$9,945,830" -> phải bóc số ra trước khi tính
// Thêm luật mới: viết 1 hàm nhận { question, sql, result }, trả true nếu cần bỏ, rồi thêm vào FILTER_RULES.
//
// ----- CHUẨN HÓA -----
// SQL nào thiếu dấu ; ở cuối thì thêm vào -> mọi câu train cùng một kiểu, model học luôn kết thúc bằng ;
//
// ----- SAU KHI LỌC -----
// Luật tự động không bắt được SQL chạy được nhưng sai ý (VD hỏi trung vị mà SQL tính trung bình)
// -> nên mở file output đọc lướt và sửa tay những cặp sai.
//
// Input : data/training_data/generated_queries.jsonl
// Output: data/training_data/generated_queries_filtered.jsonl
// =======================================================================

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const { Client } = require("pg");

// =======================================================================
// CẤU HÌNH HỆ THỐNG
// =======================================================================

const TRAINING_DIR = path.join(__dirname, "data", "training_data");
const INPUT_FILE = path.join(TRAINING_DIR, "generated_queries.jsonl");
const OUTPUT_FILE = path.join(TRAINING_DIR, "generated_queries_filtered.jsonl");

// =======================================================================
// HÀM HỖ TRỢ HIỂN THỊ LOG
// =======================================================================

/** In tiêu đề phân cách từng phần trên console */
function section(title) {
  const line = "=".repeat(60);
  console.log(`\n\n${line}\n ${title}\n${line}`);
}

// =======================================================================
// DATABASE & FILE
// =======================================================================

/** Thực thi câu lệnh SQL, trả về `{ rows }` hoặc `{ error }` (không làm crash app) */
async function tryQuery(db, sql) {
  try {
    const { rows } = await db.query(sql);
    return { rows };
  } catch (err) {
    return { error: err.message };
  }
}

/** Đọc file JSONL (mỗi dòng 1 object JSON) */
function readJsonl(filePath) {
  const lines = fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => line.trim());
  return lines.map((line) => JSON.parse(line));
}

// =======================================================================
// CÁC LUẬT LỌC
// =======================================================================

/** true nếu có ít nhất 1 ô giá trị null trong kết quả */
function hasNullCell(rows) {
  return rows.some((row) => Object.values(row).some((value) => value === null));
}

// Mỗi luật: `test` trả true -> bỏ cặp đó. `result` là kết quả chạy SQL ({ rows } hoặc { error })
const FILTER_RULES = [
  {
    name: "SQL lỗi",
    test: ({ result }) => Boolean(result.error),
  },
  {
    name: 'Có chữ "null"',
    test: ({ question, sql }) => /null/i.test(sql) || /null/i.test(question),
  },
  {
    name: "Kết quả rỗng / có ô null",
    test: ({ result }) => !result.error && (result.rows.length === 0 || hasNullCell(result.rows)),
  },
  {
    // Postgres thường đã báo lỗi ở luật "SQL lỗi"; luật này bắt thêm cho chắc
    name: "AVG trên cột chữ",
    test: ({ sql }) => /avg\(\s*ht\s*\)|avg\(\s*salary/i.test(sql),
  },
];

/** Thêm dấu ; vào cuối SQL nếu thiếu */
function ensureSemicolon(sql) {
  const trimmed = sql.trim();
  return trimmed.endsWith(";") ? trimmed : `${trimmed};`;
}

/**
 * Kiểm tra 1 cặp qua lần lượt các luật.
 * Trả về tên luật đầu tiên bị vi phạm, hoặc null nếu cặp đạt.
 */
async function findRejectReason(db, { question, sql }) {
  const result = await tryQuery(db, sql); // Chạy SQL 1 lần, các luật dùng chung kết quả
  const failedRule = FILTER_RULES.find((rule) => rule.test({ question, sql, result }));
  return failedRule ? failedRule.name : null;
}

// =======================================================================
// LUỒNG CHẠY CHÍNH (MAIN)
// =======================================================================

async function main() {
  if (!fs.existsSync(INPUT_FILE)) {
    console.log(`Chưa có file ${INPUT_FILE}\n-> Chạy trước: node 06-improving-accuracy/05-generate-data.js`);
    return;
  }

  const db = new Client({ connectionString: process.env.POSTGRES_URI });
  await db.connect();

  // Chỉ đọc: SQL do model viết được chạy thật, chặn trước mọi lệnh ghi/xóa dữ liệu
  await db.query("SET default_transaction_read_only = on");

  try {
    const records = readJsonl(INPUT_FILE);
    section(`1. Lọc ${records.length} cặp { question, sql }`);

    const seenQuestions = new Set();
    const seenSql = new Set();
    const kept = [];
    const rejectCounts = {}; // Đếm số cặp bị bỏ theo từng lý do

    for (const [index, record] of records.entries()) {
      let reason = null;
      if (seenQuestions.has(record.question) || seenSql.has(record.sql)) {
        reason = "Trùng lặp";
      } else {
        seenQuestions.add(record.question);
        seenSql.add(record.sql);
        reason = await findRejectReason(db, record);
      }

      const verdict = reason ? `BỎ — ${reason}` : "GIỮ";
      console.log(`[${index + 1}/${records.length}] ${verdict}: ${record.question}`);

      if (reason) {
        rejectCounts[reason] = (rejectCounts[reason] || 0) + 1;
      } else {
        kept.push({ question: record.question, sql: ensureSemicolon(record.sql) });
      }
    }

    fs.writeFileSync(OUTPUT_FILE, kept.map((record) => JSON.stringify(record) + "\n").join(""));

    section("2. Tổng kết");
    console.log(`Giữ lại: ${kept.length}/${records.length} cặp`);
    for (const [reason, count] of Object.entries(rejectCounts)) {
      console.log(`  Bỏ vì ${reason.padEnd(26)}: ${count}`);
    }
    console.log(`\nĐã ghi vào: ${OUTPUT_FILE}`);
    console.log("Bước tiếp theo: đọc lướt file trên, sửa tay cặp sai, rồi chạy node 06-improving-accuracy/07-prepare-finetune.js");
  } finally {
    await db.end();
  }
}

main().catch(console.error);
