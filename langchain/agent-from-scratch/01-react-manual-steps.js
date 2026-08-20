// Bài 1: ReAct Agent từ đầu - chạy TỪNG BƯỚC bằng tay để hiểu cơ chế bên trong, trước khi
// tự động hoá vòng lặp ở file 02-react-auto-loop.js (cùng nhóm ReAct, khác 03/04 - nhóm
// Native Tool Calling).
//
// Dựa theo: https://til.simonwillison.net/llms/python-react-pattern
//
// Flow:
//   User hỏi -> model trả lời "Action: ..." rồi dừng (PAUSE)
//   -> MÌNH (code) tự chạy Action đó, lấy kết quả
//   -> gửi kết quả về cho model dưới dạng "Observation: ..."
//   -> lặp lại tới khi model trả lời "Answer: ..."
//
// Xem agent.js để biết Agent class + system prompt hoạt động thế nào.
require("../_polyfill");
require("dotenv").config();

const { Agent, SYSTEM_PROMPT } = require("./agent");
const { averageDogWeight } = require("./actions");

async function main() {
  const abot = new Agent(SYSTEM_PROMPT);

  const question =
    "I have 2 dogs, a border collie and a scottish terrier. What is their combined weight";

  // Bước 1: hỏi câu hỏi ban đầu -> model trả lời bằng Thought + Action rồi dừng lại (PAUSE).
  let result = await abot.call(question);
  console.log(result);

  // Bước 2: tự chạy Action model vừa yêu cầu (average_dog_weight: Border Collie),
  // rồi gửi kết quả về cho model dưới dạng Observation.
  let nextPrompt = `Observation: ${averageDogWeight("Border Collie")}`;
  console.log(nextPrompt);
  result = await abot.call(nextPrompt);
  console.log(result);

  // Bước 3: model tiếp tục yêu cầu Action cho con chó thứ 2 -> lặp lại tương tự.
  nextPrompt = `Observation: ${averageDogWeight("Scottish Terrier")}`;
  console.log(nextPrompt);
  result = await abot.call(nextPrompt);
  console.log(result);

  // Bước 4: model yêu cầu tính tổng 2 số cân nặng -> tự tính rồi trả Observation lại.
  nextPrompt = `Observation: ${37 + 20}`;
  console.log(nextPrompt);
  result = await abot.call(nextPrompt);
  console.log(result);

  console.log("\n========== Toàn bộ lịch sử hội thoại ==========");
  console.log(abot.messages);
}

main();
