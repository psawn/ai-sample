// =======================================================================
// AGENT FROM SCRATCH - BƯỚC 2: ReAct AGENT TỰ ĐỘNG HÓA VÒNG LẶP
//
// File 01 chạy tay từng bước. File này để hàm query() tự làm hết.
//
// Flow mỗi vòng:
// 1. Gọi model, đọc câu trả lời.
// 2. Tìm dòng "Action: <tên_action>: <input>" bằng regex.
// 3. Chạy action tương ứng (knownActions ở actions.js), lấy Observation.
// 4. Gửi Observation lại cho model, quay về bước 1.
//
// Dừng khi model không còn Action (đã có Answer), hoặc hết maxTurns.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { Agent, SYSTEM_PROMPT } = require("./agent");
const { knownActions } = require("./actions");

// Bắt dòng "Action: <tên_action>: <input>".
// Vd: "Action: calculate: 37 + 20" -> action = "calculate", input = "37 + 20".
const ACTION_REGEX = /^Action: (\w+): (.*)$/;

// Chạy vòng lặp ReAct cho 1 câu hỏi.
// maxTurns: số lượt tối đa, chống lặp vô hạn. Hết lượt -> dừng, không có Answer.
async function query(question, maxTurns = 5) {
  const bot = new Agent(SYSTEM_PROMPT);
  let nextPrompt = question;

  for (let i = 0; i < maxTurns; i++) {
    console.log(`\n========== Turn ${i + 1}/${maxTurns} ==========`);
    console.log("Prompt:", nextPrompt);

    const result = await bot.call(nextPrompt);
    console.log("\nModel trả lời:");
    console.log(result);

    // Bước 2: tìm các dòng "Action: ..." trong câu trả lời.
    const actions = result
      .split("\n")
      .map((line) => line.match(ACTION_REGEX))
      .filter(Boolean);

    if (actions.length === 0) {
      // Không còn Action -> model đã có Answer.
      console.log("\n(Không còn Action nào -> đã có Answer, dừng vòng lặp)");
      return;
    }

    // Chỉ chạy action đầu tiên, giống bản gốc.
    // Model viết sai tên action -> throw, vì không biết chạy hàm nào.
    const [, action, actionInput] = actions[0];
    if (!knownActions[action]) {
      throw new Error(`Unknown action: ${action}: ${actionInput}`);
    }

    // Bước 3: chạy action.
    const observation = knownActions[action](actionInput);
    console.log(`\nĐang chạy action: ${action}("${actionInput}")`);
    console.log("-> Observation:", observation);

    // Bước 4: Observation thành prompt của vòng sau.
    // Model dựa vào đó: gọi Action khác, hoặc đủ dữ kiện để trả Answer.
    nextPrompt = `Observation: ${observation}`;
  }
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  // Câu hỏi cần 3 Action: cân nặng Border Collie -> cân nặng Scottish Terrier -> tính tổng.
  const question =
    "I have 2 dogs, a border collie and a scottish terrier. What is their combined weight";
  await query(question);
}

main();
