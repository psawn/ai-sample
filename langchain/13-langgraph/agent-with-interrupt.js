// =======================================================================
// LANGGRAPH - AGENT DỪNG TRƯỚC KHI CHẠY TOOL (HUMAN IN THE LOOP)
//
// Agent ReAct giống agent-with-memory.js, thêm interruptBefore: ["action"] khi compile.
// Mỗi khi Model muốn gọi tool, graph dừng ngay trước node "action".
// -> Chờ người dùng duyệt (hoặc sửa state) rồi mới chạy tiếp.
//
// MessagesAnnotation gộp message theo id:
// - Trùng id -> ghi đè. id mới -> nối thêm.
// - Nhờ vậy sửa được tool_calls trong state mà không sinh message trùng.
//
// Dùng cho 04, 05, 06-*-manual-graph.js.
// =======================================================================

require("../_polyfill");

const { StateGraph, END, MessagesAnnotation } = require("@langchain/langgraph");
const { SystemMessage, ToolMessage } = require("@langchain/core/messages");

// State: dữ liệu chung, các node cùng đọc và ghi. Giống agent.js.
const AgentState = MessagesAnnotation;

// Agent = Model + tools + system prompt + checkpointer + điểm dừng trước node "action".
class Agent {
  constructor(model, tools, checkpointer, system = "") {
    this.system = system;
    this.tools = Object.fromEntries(tools.map((t) => [t.name, t]));
    this.model = model.bindTools(tools);

    // Graph giống agent.js (giải thích từng bước ở đó):
    // START -> llm -> có tool_calls thì action -> llm, không thì END.
    const graph = new StateGraph(AgentState);
    graph.addNode("llm", this.callModel.bind(this));
    graph.addNode("action", this.takeAction.bind(this));
    graph.addEdge("__start__", "llm");
    graph.addConditionalEdges("llm", this.existsAction.bind(this), {
      true: "action",
      false: END,
    });
    graph.addEdge("action", "llm");

    // Khác agent-with-memory.js duy nhất ở đây: interruptBefore: ["action"].
    // Graph dừng trước node "action" ở mọi lần gọi tool, kể cả gọi liên tiếp.
    //
    // Khi nào dùng trong dự án thật:
    // - Nên dùng: tool khó đảo ngược (xóa file, chuyển tiền, gửi email...) hoặc cần kiểm duyệt.
    // - Không nên: tool chỉ đọc (web_search, tra DB...), vì agent phải chờ người, chạy chậm.
    // - Muốn chặn riêng từng tool thay vì chặn hết: dùng humanInTheLoopMiddleware
    //   (xem 04-human-approval-create-agent.js).
    this.graph = graph.compile({ checkpointer, interruptBefore: ["action"] });
  }

  // Rẽ nhánh: message mới nhất của Model có yêu cầu gọi tool không?
  existsAction(state) {
    const lastMessage = state.messages[state.messages.length - 1];
    return lastMessage.tool_calls?.length ? "true" : "false";
  }

  // Node "llm": thêm system prompt vào đầu messages, rồi gọi Model.
  async callModel(state) {
    let messages = state.messages;
    if (this.system) {
      messages = [new SystemMessage(this.system), ...messages];
    }
    const message = await this.model.invoke(messages);
    return { messages: [message] };
  }

  // Node "action": chạy từng tool_call. Chỉ tới được đây khi đã được duyệt.
  async takeAction(state) {
    const toolCalls = state.messages[state.messages.length - 1].tool_calls;
    const results = [];

    for (const call of toolCalls) {
      console.log(`  -> Đang gọi: ${call.name}(${JSON.stringify(call.args)})`);

      // Model gọi tên tool không tồn tại -> báo lại để Model thử lại.
      if (!this.tools[call.name]) {
        results.push(
          new ToolMessage({
            tool_call_id: call.id,
            name: call.name,
            content: "bad tool name, retry",
          }),
        );
        continue;
      }

      const toolMessage = await this.tools[call.name].invoke(call);
      results.push(toolMessage);
    }

    console.log('  -> Quay lại Node "llm" để Model đọc kết quả');
    return { messages: results };
  }
}

module.exports = { Agent, AgentState };
