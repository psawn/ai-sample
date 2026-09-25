// =======================================================================
// HƯỚNG DẪN: CHUẨN BỊ FILE FINE-TUNE TỪ DATA ĐÃ LỌC
// =======================================================================
//
// ----- FINE-TUNE LÀ GÌ -----
// Train tiếp một model có sẵn trên data riêng của mình.
// Sau khi train, model "thuộc" cách viết SQL cho bảng nba_roster mà không cần nhồi ví dụ vào prompt.
//
// ----- ĐỊNH DẠNG FILE: CHAT MESSAGES -----
// Mỗi dòng là 1 đoạn hội thoại mẫu gồm 3 lượt:
//   system    -> vai trò + schema bảng
//   user      -> câu hỏi
//   assistant -> câu trả lời đúng (SQL) mà ta muốn model học theo
// Model học quy luật: "gặp system + user như thế này thì trả lời như assistant".
// Đây là định dạng chung, các công cụ fine-tune phổ biến (Hugging Face TRL, OpenAI, Together AI...) đều đọc được.
//
// ----- PROMPT LÚC TRAIN PHẢI GIỐNG PROMPT LÚC DÙNG -----
// System prompt và dạng câu trả lời ({ "sql_query": "..." }) ở đây giống hệt 04-evaluation.js.
// Train một kiểu mà chấm một kiểu thì model không nhận ra "tình huống quen" -> fine-tune mất tác dụng.
//
// ----- ÍT DATA THÌ SAO -----
// Vài chục cặp đủ dạy định dạng (VD luôn trả SQL sạch, có ;), nhưng model dễ học thuộc lòng (overfit):
// câu giống data train thì đúng, đổi chữ một chút là sai. Chấm trên bộ đề riêng mới biết thật hay ảo.
//
// Input : data/training_data/generated_queries_filtered.jsonl
// Output: data/training_data/finetune_dataset.jsonl
// Sau khi train xong: đổi MODEL trong 04-evaluation.js sang model mới để chấm điểm.
// =======================================================================

const fs = require("fs");
const path = require("path");

// =======================================================================
// CẤU HÌNH HỆ THỐNG
// =======================================================================

const TRAINING_DIR = path.join(__dirname, "data", "training_data");
const INPUT_FILE = path.join(TRAINING_DIR, "generated_queries_filtered.jsonl");
const OUTPUT_FILE = path.join(TRAINING_DIR, "finetune_dataset.jsonl");

const MIN_RECOMMENDED_EXAMPLES = 50; // Dưới mức này thường chỉ dạy được định dạng, rất dễ overfit

// =======================================================================
// HÀM HỖ TRỢ HIỂN THỊ LOG
// =======================================================================

/** In tiêu đề phân cách từng phần trên console */
function section(title) {
  const line = "=".repeat(60);
  console.log(`\n\n${line}\n ${title}\n${line}`);
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
// KHUÔN MẪU PROMPT (GIỐNG 04-evaluation.js)
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

/** Biến 1 cặp { question, sql } thành 1 đoạn hội thoại mẫu để train */
function toTrainingExample({ question, sql }) {
  return {
    messages: [
      { role: "system", content: makeSqlSystemPrompt() },
      { role: "user", content: question },
      // 04-evaluation.js ép model trả JSON { sql_query } -> câu trả lời mẫu cũng viết đúng dạng đó
      { role: "assistant", content: JSON.stringify({ sql_query: sql }) },
    ],
  };
}

// =======================================================================
// LUỒNG CHẠY CHÍNH (MAIN)
// =======================================================================

function main() {
  if (!fs.existsSync(INPUT_FILE)) {
    console.log(`Chưa có file ${INPUT_FILE}\n-> Chạy trước: node 06-improving-accuracy/06-filter-data.js`);
    return;
  }

  const records = readJsonl(INPUT_FILE);
  const examples = records.map(toTrainingExample);
  fs.writeFileSync(OUTPUT_FILE, examples.map((example) => JSON.stringify(example) + "\n").join(""));

  section("1. Mẫu 1 dòng trong file fine-tune");
  console.log(JSON.stringify(examples[0], null, 2));

  section("2. Tổng kết");
  console.log(`Số đoạn hội thoại mẫu: ${examples.length}`);
  if (examples.length < MIN_RECOMMENDED_EXAMPLES) {
    console.log(
      `Cảnh báo: dưới ${MIN_RECOMMENDED_EXAMPLES} mẫu -> chủ yếu dạy được định dạng, dễ học thuộc lòng. ` +
        "Muốn nhiều hơn: tăng số lượt khi chạy 05-generate-data.js",
    );
  }
  console.log(`\nĐã ghi vào: ${OUTPUT_FILE}`);
}

main();
