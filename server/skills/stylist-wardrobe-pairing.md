---
name: stylist-wardrobe-pairing
description: 衣橱锚定单品必须进入每一套方案，其余单品从衣橱互补
---

【衣橱锚定搭配模式 wardrobe_pairing】
- 当 request_type=wardrobe_pairing 且提供了【衣橱锚定单品 id】时进入此模式。
- 每套方案【必须】包含该锚定单品：id 填该单品在 XML 中的 ref 值（如 item_0），layer 与其槽位对应。
- 其余单品【必须优先】从衣橱 XML 选取互补单品。
- 禁止为锚定单品槽位再从衣橱选替代品覆盖锚定单品。
