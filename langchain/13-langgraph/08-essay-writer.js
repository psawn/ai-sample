// =======================================================================
// LANGGRAPH - BƯỚC 8: ESSAY WRITER (VIẾT BÀI LUẬN, TỰ SỬA QUA NHIỀU VÒNG)
//
// LLM viết dàn ý -> tìm tư liệu -> viết bài -> tự chấm -> sửa bài, lặp nhiều vòng.
//
// Luồng cố định, số vòng do code quyết định qua maxRevisions, không để Model tự quyết.
// -> Dùng StateGraph tự dựng, không dùng createAgent (ReAct agent tự chọn bước tiếp theo).
//
// Các node:
// - planner: viết dàn ý (plan) từ đề bài.
// - research_plan / research_critique: Model sinh query, rồi tìm tư liệu.
// - generate: viết hoặc sửa bài (draft) từ dàn ý + tư liệu.
// - reflect: đóng vai giáo viên, chấm bài, viết nhận xét (critique).
//
// Luồng:
// 1. START -> planner -> research_plan -> generate.
// 2. Sau generate: revisionNumber > maxRevisions -> END, ngược lại -> reflect.
// 3. reflect -> research_critique -> quay lại generate (bước 2).
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { z } = require("zod");
const {
  StateGraph,
  END,
  Annotation,
  MemorySaver,
} = require("@langchain/langgraph");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { SystemMessage, HumanMessage } = require("@langchain/core/messages");
const { webSearch } = require("./tool");

// State: dữ liệu chung, các node cùng đọc và ghi.
// Mọi field đều ghi đè: có giá trị mới thì thay, không có thì giữ nguyên.
// - task: đề bài.
// - plan: dàn ý.
// - draft: bản nháp mới nhất.
// - critique: nhận xét của "giáo viên" cho bản nháp.
// - content: danh sách tư liệu tìm được.
// - revisionNumber: đang ở lần viết thứ mấy.
// - maxRevisions: số lần viết tối đa.
const AgentState = Annotation.Root({
  task: Annotation({
    reducer: (current, update) => update ?? current,
    default: () => "",
  }),
  plan: Annotation({
    reducer: (current, update) => update ?? current,
    default: () => "",
  }),
  draft: Annotation({
    reducer: (current, update) => update ?? current,
    default: () => "",
  }),
  critique: Annotation({
    reducer: (current, update) => update ?? current,
    default: () => "",
  }),
  content: Annotation({
    reducer: (current, update) => update ?? current,
    default: () => [],
  }),
  revisionNumber: Annotation({
    reducer: (current, update) => update ?? current,
    default: () => 1,
  }),
  maxRevisions: Annotation({
    reducer: (current, update) => update ?? current,
    default: () => 2,
  }),
});

const model = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Schema bắt Model trả về { queries: string[] }, không trả văn xuôi.
const QueriesSchema = z.object({
  queries: z.array(z.string()).describe("Danh sách câu truy vấn tìm kiếm"),
});
// withStructuredOutput: mỗi lần invoke() trả về object đúng QueriesSchema.
const queryModel = model.withStructuredOutput(QueriesSchema);

// ===== PROMPT CHO TỪNG NODE =====

// planner: viết dàn ý.
const PLAN_PROMPT = `You are an expert writer tasked with writing a high level outline of an essay. \
Write such an outline for the user provided topic. Give an outline of the essay along with any relevant notes \
or instructions for the sections.`;

// reflect: đóng vai giáo viên chấm bài.
const REFLECTION_PROMPT = `You are a teacher grading an essay submission. \
Generate critique and recommendations for the user's submission. \
Provide detailed recommendations, including requests for length, depth, style, etc.`;

// research_plan: sinh query tìm tư liệu cho đề bài.
const RESEARCH_PLAN_PROMPT = `You are a researcher charged with providing information that can \
be used when writing the following essay. Generate a list of search queries that will gather \
any relevant information. Only generate 3 queries max.`;

// research_critique: sinh query tìm tư liệu để sửa bài theo nhận xét.
const RESEARCH_CRITIQUE_PROMPT = `You are a researcher charged with providing information that can \
be used when making any requested revisions (as outlined below). \
Generate a list of search queries that will gather any relevant information. Only generate 3 queries max.`;

// generate: prompt viết bài, kèm toàn bộ tư liệu đã tìm.
function buildWriterPrompt(content) {
  return `You are an essay assistant tasked with writing excellent 5-paragraph essays.\
Generate the best essay possible for the user's request and the initial outline. \
If the user provides critique, respond with a revised version of your previous attempts. \
Utilize all the information below as needed:

------

${content}`;
}

// Model sinh danh sách query -> search từng query -> nối kết quả vào tư liệu đã có.
async function collectResearch(systemPrompt, humanContent, existingContent) {
  const { queries } = await queryModel.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(humanContent),
  ]);

  const content = [...existingContent];
  for (const query of queries) {
    const result = await webSearch.invoke(query);
    content.push(result);
  }
  return content;
}

// ===== CÁC NODE CỦA GRAPH =====

// Node planner: task -> plan.
async function planNode(state) {
  const messages = [
    new SystemMessage(PLAN_PROMPT),
    new HumanMessage(state.task),
  ];
  const response = await model.invoke(messages);
  return { plan: response.content };
}

// Node research_plan: task -> Model sinh query -> search -> nối vào content.
async function researchPlanNode(state) {
  const content = await collectResearch(
    RESEARCH_PLAN_PROMPT,
    state.task,
    state.content,
  );
  return { content };
}

// Node generate: task + plan + content -> draft.
// Viết xong thì tăng revisionNumber thêm 1.
async function generationNode(state) {
  const content = state.content.join("\n\n");
  const humanMessage = new HumanMessage(
    `${state.task}\n\nHere is my plan:\n\n${state.plan}`,
  );
  const messages = [
    new SystemMessage(buildWriterPrompt(content)),
    humanMessage,
  ];
  const response = await model.invoke(messages);
  return {
    draft: response.content,
    revisionNumber: (state.revisionNumber ?? 1) + 1,
  };
}

// Node reflect: draft -> Model đóng vai giáo viên -> critique.
async function reflectionNode(state) {
  const messages = [
    new SystemMessage(REFLECTION_PROMPT),
    new HumanMessage(state.draft),
  ];
  const response = await model.invoke(messages);
  return { critique: response.content };
}

// Node research_critique: critique -> Model sinh query -> search -> nối vào content.
async function researchCritiqueNode(state) {
  const content = await collectResearch(
    RESEARCH_CRITIQUE_PROMPT,
    state.critique,
    state.content,
  );
  return { content };
}

// Rẽ nhánh sau generate: viết đủ maxRevisions bản thì dừng, chưa đủ thì sang reflect.
function shouldContinue(state) {
  if (state.revisionNumber > state.maxRevisions) return END;
  return "reflect";
}

// Dựng graph theo luồng ở đầu file.
const builder = new StateGraph(AgentState);
builder.addNode("planner", planNode);
builder.addNode("generate", generationNode);
builder.addNode("reflect", reflectionNode);
builder.addNode("research_plan", researchPlanNode);
builder.addNode("research_critique", researchCritiqueNode);

builder.addEdge("__start__", "planner");
builder.addEdge("planner", "research_plan");
builder.addEdge("research_plan", "generate");

builder.addConditionalEdges("generate", shouldContinue, {
  [END]: END,
  reflect: "reflect",
});

builder.addEdge("reflect", "research_critique");
builder.addEdge("research_critique", "generate");

const memory = new MemorySaver();
const graph = builder.compile({ checkpointer: memory });

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  const thread = { configurable: { thread_id: "1" } };

  // Stream -> in kết quả mỗi node ngay khi node đó chạy xong.
  const events = await graph.stream(
    {
      task: "what is the difference between langchain and langsmith",
      maxRevisions: 2, // viết đủ 2 bản nháp thì dừng
      revisionNumber: 1,
    },
    thread,
  );

  for await (const event of events) {
    console.log(event);
  }
}

main();
