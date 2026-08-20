// Danh sách "Action" (tool) mà Agent được phép gọi trong vòng lặp ReAct - mỗi action nhận
// vào 1 chuỗi input, trả về 1 chuỗi kết quả (Observation) để đưa lại cho model đọc.

// Action "calculate": tính 1 biểu thức số học đơn giản, ví dụ "4 * 7 / 3".
// Dùng eval() cho gọn vì đây chỉ là bài học minh hoạ - không dùng cách này cho production
// (eval() chạy được bất kỳ code JS nào, rất nguy hiểm nếu input đến từ người dùng thật).
function calculate(what) {
  return eval(what);
}

// Action "average_dog_weight": tra cứu cân nặng trung bình theo giống chó.
function averageDogWeight(name) {
  if ("Scottish Terrier".includes(name)) {
    return "Scottish Terriers average 20 lbs";
  } else if ("Border Collie".includes(name)) {
    return "a Border Collies average weight is 37 lbs";
  } else if ("Toy Poodle".includes(name)) {
    return "a toy poodles average weight is 7 lbs";
  } else {
    return "An average dog weights 50 lbs";
  }
}

// Map tên action -> hàm thực thi, để tra cứu khi model yêu cầu chạy 1 action.
const knownActions = {
  calculate,
  average_dog_weight: averageDogWeight,
};

module.exports = { calculate, averageDogWeight, knownActions };
