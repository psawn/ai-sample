// =======================================================================
// AGENT FROM SCRATCH - BƯỚC 1: ReAct AGENT CHẠY TỪNG BƯỚC BẰNG TAY
//
// Chạy tay từng bước để hiểu cơ chế, trước khi tự động hóa ở 02-react-auto-loop.js.
//
// Flow:
// 1. User hỏi -> model trả "Action: ..." rồi dừng (PAUSE).
// 2. Code chạy Action đó, lấy kết quả.
// 3. Gửi kết quả lại cho model dưới dạng "Observation: ...".
// 4. Lặp 1-3 tới khi model trả "Answer: ...".
//
// Ở file này, bước 2 do người viết code làm: đọc log, gọi đúng hàm, hard-code input.
//
// Dựa theo: https://til.simonwillison.net/llms/python-react-pattern
// Agent class + system prompt: agent.js.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { Agent, SYSTEM_PROMPT } = require("./agent");
const { averageDogWeight } = require("./actions");

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  const abot = new Agent(SYSTEM_PROMPT);

  const question =
    "I have 2 dogs, a border collie and a scottish terrier. What is their combined weight";

  // Bước 1: hỏi câu ban đầu -> model trả Thought + Action rồi dừng (PAUSE).
  let result = await abot.call(question);
  console.log(result);

  // Bước 2: tự chạy Action model yêu cầu (average_dog_weight: Border Collie),
  // gửi kết quả lại dưới dạng Observation.
  let nextPrompt = `Observation: ${averageDogWeight("Border Collie")}`;
  console.log(nextPrompt);
  result = await abot.call(nextPrompt);
  console.log(result);

  // Bước 3: model yêu cầu Action cho con chó thứ 2 -> làm tương tự.
  nextPrompt = `Observation: ${averageDogWeight("Scottish Terrier")}`;
  console.log(nextPrompt);
  result = await abot.call(nextPrompt);
  console.log(result);

  // Bước 4: model yêu cầu tính tổng -> tự tính, gửi Observation.
  // Kỳ vọng: model trả "Answer: ..." cuối cùng.
  nextPrompt = `Observation: ${37 + 20}`;
  console.log(nextPrompt);
  result = await abot.call(nextPrompt);
  console.log(result);

  console.log("\n========== Toàn bộ lịch sử hội thoại ==========");
  console.log(abot.messages);
}

main();
