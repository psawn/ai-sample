# =======================================================================
# NEMO GUARDRAILS - CUSTOM ACTION: TÌM PII BẰNG REGEX
#
# Custom action = hàm Python do mình viết, luật Colang gọi được.
# rails.co gọi hàm trong file này bằng lệnh:
#   $pii_found = execute detect_pii
# NeMo tự nạp file actions.py trong thư mục config, không cần đăng ký thêm.
#
# Bài này kiểm tra PII qua 2 lớp. Lớp nào phát hiện cũng chặn:
#   Lớp 1 - Regex tự viết (file này)
#           Bắt định dạng riêng: CCCD, API key "sk-...".
#   Lớp 2 - Rail có sẵn của NeMo, dùng Presidio (thư viện tìm PII), bật trong config.yml
#           Bắt kiểu viết mà regex bỏ sót: "+84912345678", "091 234 5678".
#
# Vẫn có thể lọt: cả 2 lớp chỉ bắt được kiểu viết đã biết.
#   VD: API key không bắt đầu bằng "sk-", phía sau chữ "API key" không có ":" hoặc "=".
#
# Bộ regex giống detectPII() trong ../../../01-custom-rails/intent-rails-rag.js,
# chỉ thêm "api_key_sk". Vì vậy bản tự viết vẫn để lọt API key "sk-...".
# =======================================================================

import re
from typing import Optional

from nemoguardrails.actions import action

PII_PATTERNS = {
    "email": r"[\w.+-]+@[\w-]+\.[\w.]+",  # VD an@gmail.com
    "phone": r"\b0\d{9}\b",  # SĐT Việt Nam: 0 + 9 số
    "credit_card": r"\b(?:\d[ -]?){13,16}\b",  # 13–16 số, có thể cách bằng dấu cách/gạch
    "citizen_id": r"\b\d{12}\b",  # CCCD 12 số
    "api_key": r"(api[_\s-]?key|token|secret)\s*[:=]\s*\S{10,}",  # VD "api_key: sk-abc123..."
    "api_key_sk": r"\bsk-[A-Za-z0-9]{10,}\b",  # VD "API key của tôi là sk-abc123..."
}


# is_system_action=True: NeMo tự truyền vào `context`,
# trong đó có tin nhắn của user (context["user_message"])
@action(is_system_action=True)
async def detect_pii(context: Optional[dict] = None):
    """Trả về danh sách loại PII tìm thấy; danh sách rỗng = sạch."""
    message = (context or {}).get("user_message", "")
    return [name for name, pattern in PII_PATTERNS.items() if re.search(pattern, message, re.IGNORECASE)]
