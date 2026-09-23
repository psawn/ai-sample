// =======================================================================
// LANGGRAPH - AGENT CÓ CHECKPOINTER (NHỚ HỘI THOẠI)
//
// Agent ReAct giống agent.js, thêm checkpointer khi compile graph.
// Checkpointer lưu state.messages sau mỗi node, tách riêng theo thread_id.
//
// Nhờ vậy:
// - Hỏi nhiều lượt mà không cần tự gửi lại lịch sử.
// - Chạy nhiều cuộc hội thoại độc lập, mỗi thread_id là 1 cuộc.
//
// Dùng cho 02-persistence-manual-graph.js và 03-streaming-tokens-manual-graph.js.
// =======================================================================

require("../_polyfill");

const { StateGraph, END, MessagesAnnotation } = require("@langchain/langgraph");
const { SystemMessage, ToolMessage } = require("@langchain/core/messages");

// State: dữ liệu chung, các node cùng đọc và ghi. Giống agent.js.
const AgentState = MessagesAnnotation;

// Agent = Model + tools + system prompt + checkpointer, chạy trong 1 graph.
class Agent {
  // checkpointer: nơi lưu state (vd: new MemorySaver()).
  // Bắt buộc để graph nhớ hội thoại giữa các lần .invoke() / .stream().
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

    // Khác agent.js duy nhất ở đây: compile kèm checkpointer.
    // Graph tự lưu và khôi phục state theo thread_id.
    // checkpointer do nơi gọi new Agent(...) tạo và truyền vào.
    this.graph = graph.compile({ checkpointer });
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

  // Node "action": chạy lần lượt từng tool_call trong message cuối.
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

    console.log("  -> Quay lại Node \"llm\" để Model đọc kết quả");
    return { messages: results };
  }
}

module.exports = { Agent, AgentState };
