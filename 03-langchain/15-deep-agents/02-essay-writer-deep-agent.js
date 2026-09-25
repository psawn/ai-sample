// =======================================================================
// DEEP AGENTS - BƯỚC 2: ESSAY WRITER (BẢN DEEP AGENT)
//
// Bài toán: Dàn ý -> Tư liệu -> Viết bài -> Chấm điểm -> Sửa bài.
// Khác với bản StateGraph (luồng cố định), bản này dùng `createDeepAgent`:
// Chỉ mô tả quy trình qua prompt, LLM sẽ tự chủ động quyết định các bước tiếp theo.
//
// So sánh nhanh với bản StateGraph:
// - planner         -> Agent chính tự ghi dàn ý vào `/plan.md`.
// - research_*      -> Subagent `researcher` (có tool web_search), gọi qua tool `task`.
// - generate        -> Agent chính tự viết bài vào `/draft.md`.
// - reflect         -> Subagent `critic` đọc `/draft.md`, ghi nhận xét vào `/critique.md`.
// - maxRevisions    -> Quy định bằng prompt ("tối đa 2 bản nháp"), không có code chặn cứng.
// - AgentState (7 field) -> Không cần: Dùng sẵn messages + filesystem ảo (`files`).
//
// Các tính năng sẵn có của Deep Agent:
// - Filesystem ảo (`ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`): Lưu trữ trực tiếp trong state.
// - `task`: Giao việc cho subagent (chạy độc lập, agent chính chỉ nhận kết quả tổng hợp).
// - `write_todos`: Quản lý danh sách việc cần làm (kích hoạt qua `todoListMiddleware`).
//
// Bài học rút ra (khi so sánh 2 bản):
// 1. Chất lượng bài luận tương đương. Khác biệt nằm ở khả năng kiểm soát thay vì chất lượng đầu ra.
// 2. Subagent chạy "trong hộp kín": Log chỉ hiện gọi `task`, không thấy chi tiết quá trình search bên trong.
// 3. Prompt là luật mềm: Model có thể tự ý lấn sân (VD: researcher tự lập dàn ý, critic tự viết lại bài).
// 4. Critic là LLM: Nếu thiếu nguồn đối chiếu khách quan, critic có thể xác nhận nhầm thông tin sai lệch.
// 5. File ảo bị ghi đè: `/draft.md` chỉ lưu bản cuối cùng, không giữ lại lịch sử các bản nháp trước.
// 6. Chi phí token cao hơn: Bản Deep Agent gọi LLM nhiều lần hơn hẳn (todo, subagent...).
//
// Gợi ý lựa chọn kiến trúc:
// -> Quy trình cố định, cần kiểm soát chặt từng bước: Dùng StateGraph.
// -> Quy trình mở, linh hoạt, muốn Model tự điều phối: Dùng Deep Agent (kết hợp stream/LangSmith để debug).
// =======================================================================

require("../../_shared/polyfill");
require("dotenv").config();

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { createDeepAgent } = require("deepagents");
const { todoListMiddleware } = require("langchain");

const { webSearch } = require("../13-langgraph/helpers/tool");

const model = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// ===== PROMPTS ĐIỀU HƯỚNG =====

// Agent chính: Đảm nhận điều phối tổng thể thay cho toàn bộ cấu trúc graph (node + edge).
const MAIN_PROMPT = `You are an essay assistant tasked with writing excellent 5-paragraph essays.

Follow this workflow:
1. Write a high level outline of the essay to /plan.md, with notes for each section.
2. Ask the \`researcher\` subagent to gather information for the essay.
3. Write the essay to /draft.md, using the outline and the research.
4. Ask the \`critic\` subagent to grade /draft.md.
5. Revise /draft.md based on the critique. Ask the \`researcher\` again if the critique needs more information.

Write at most 2 drafts in total. After the last draft, reply with a one-sentence summary.`;

// Researcher: Chuyên gia thu thập thông tin bổ trợ cho việc viết và sửa bài.
const RESEARCHER_PROMPT = `You are a researcher charged with providing information that can \
be used when writing or revising an essay. Run at most 3 searches with web_search. \
Append the useful findings to /research.md, then reply with a short summary of what you found.`;

// Critic: Đóng vai giáo viên chấm bài, đưa ra đánh giá và đề xuất cải thiện.
const CRITIC_PROMPT = `You are a teacher grading an essay submission. \
Read /draft.md, then generate critique and recommendations, including requests for length, depth, style, etc. \
Write the critique to /critique.md and reply with it.`;

// ===== CẤU HÌNH DEEP AGENT =====

// Khai báo subagents: Cung cấp tên, mô tả để agent chính biết thời điểm gọi, kèm theo tool riêng biệt.
const subagents = [
  {
    name: "researcher",
    description:
      "Searches Wikipedia for information needed to write or revise the essay.",
    systemPrompt: RESEARCHER_PROMPT,
    tools: [webSearch],
  },
  {
    name: "critic",
    description:
      "Grades /draft.md like a teacher and writes recommendations to /critique.md.",
    systemPrompt: CRITIC_PROMPT,
    tools: [],
  },
];

const agent = createDeepAgent({
  model,
  systemPrompt: MAIN_PROMPT,
  subagents,
  // Bật middleware quản lý danh sách việc cần làm (bắt buộc từ deepagents v0.7+).
  middleware: [todoListMiddleware()],
});

// ===== HÀM HỖ TRỢ IN ẤN =====

/** Chuẩn hóa nội dung file (hỗ trợ cả dạng mảng dòng lẫn chuỗi thuần). */
function fileText(file) {
  return Array.isArray(file.content) ? file.content.join("\n") : file.content;
}

/** In ra lịch sử gọi tool của agent chính (task = giao việc cho subagent). */
function printToolCalls(update) {
  for (const value of Object.values(update ?? {})) {
    if (!Array.isArray(value?.messages)) continue;
    for (const message of value.messages) {
      for (const call of message.tool_calls ?? []) {
        const args = JSON.stringify(call.args).slice(0, 150);
        console.log(`🔧 ${call.name} ${args}`);
      }
    }
  }
}

// ===== KỊCH BẢN THỰC THI =====
async function main() {
  // Stream 2 mode: "updates" để theo dõi từng bước, "values" để lấy state hoàn chỉnh ở cuối.
  const stream = await agent.stream(
    {
      messages: [
        {
          role: "user",
          content: "what is the difference between langchain and langsmith",
        },
      ],
    },
    { streamMode: ["updates", "values"] },
  );

  let finalState;
  for await (const [mode, chunk] of stream) {
    if (mode === "updates") printToolCalls(chunk);
    else finalState = chunk;
  }

  console.log(`\n>>> TRẢ LỜI CUỐI: ${finalState.messages.at(-1).content}\n`);

  // Duyệt và in toàn bộ nội dung các file ảo được tạo ra trong quá trình chạy.
  for (const [path, file] of Object.entries(finalState.files ?? {})) {
    console.log(`\n========== ${path} ==========\n${fileText(file)}`);
  }
}

main();
