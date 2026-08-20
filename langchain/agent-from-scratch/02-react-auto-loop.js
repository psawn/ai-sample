// Bài 2: Tự động hoá vòng lặp ReAct - thay vì tự tay đọc kết quả rồi gọi lại như
// 01-react-manual-steps.js, hàm query() bên dưới tự làm hết:
//   1. Gọi model, đọc câu trả lời.
//   2. Tìm dòng "Action: <tên_action>: <input>" bằng regex.
//   3. Tự chạy action tương ứng (xem knownActions ở actions.js), lấy Observation.
//   4. Gửi Observation về cho model, quay lại bước 1.
// Lặp lại tới khi model không còn yêu cầu Action nào nữa (đã ra Answer) hoặc hết maxTurns.
require("../_polyfill");
require("dotenv").config();

const { Agent, SYSTEM_PROMPT } = require("./agent");
const { knownActions } = require("./actions");

// Regex bắt dòng dạng: "Action: <tên_action>: <input>"
const ACTION_REGEX = /^Action: (\w+): (.*)$/;

async function query(question, maxTurns = 5) {
  const bot = new Agent(SYSTEM_PROMPT);
  let nextPrompt = question;

  for (let i = 0; i < maxTurns; i++) {
    console.log(`\n========== Turn ${i + 1}/${maxTurns} ==========`);
    console.log("Prompt:", nextPrompt);

    const result = await bot.call(nextPrompt);
    console.log("\nModel trả lời:");
    console.log(result);

    // Tìm các dòng "Action: ..." trong câu trả lời của model.
    const actions = result
      .split("\n")
      .map((line) => line.match(ACTION_REGEX))
      .filter(Boolean);

    if (actions.length === 0) {
      // Không còn Action nào -> model đã đưa ra Answer cuối cùng, dừng vòng lặp.
      console.log("\n(Không còn Action nào -> đã có Answer, dừng vòng lặp)");
      return;
    }

    // Chỉ chạy action đầu tiên tìm được trong câu trả lời (giống hành vi bản gốc).
    const [, action, actionInput] = actions[0];
    if (!knownActions[action]) {
      throw new Error(`Unknown action: ${action}: ${actionInput}`);
    }

    const observation = knownActions[action](actionInput);
    console.log(`\nĐang chạy action: ${action}("${actionInput}")`);
    console.log("-> Observation:", observation);

    // Đưa Observation này vào biến nextPrompt -> ở vòng lặp kế tiếp, nó sẽ được gửi cho
    // model như 1 tin nhắn mới. Nhờ vậy model biết kết quả Action vừa rồi, để quyết định
    // bước tiếp theo: gọi Action khác, hay đã đủ dữ kiện để trả lời (Answer).
    nextPrompt = `Observation: ${observation}`;
  }
}

async function main() {
  const question =
    "I have 2 dogs, a border collie and a scottish terrier. What is their combined weight";
  await query(question);
}

main();
