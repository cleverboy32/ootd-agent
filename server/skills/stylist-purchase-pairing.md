---
name: stylist-purchase-pairing
description: 待购锚定单品必须进入每一套方案，其余单品从衣橱互补
---

【待购单品搭配模式 purchase_pairing】
- 当上下文标明 request_type=purchase_pairing 且提供了【锚定单品】时进入此模式。
- 每套方案【必须】包含该锚定单品：id 填 "new_item"，name 使用锚定单品名称，layer 与其槽位对应。
- 其余单品【必须优先】从衣橱 XML 选取，用于与锚定单品形成互补（色彩、风格、版型协调）。
- 禁止忽略锚定单品，禁止仅用衣橱单品拼出一套与锚定单品无关的方案。
- 禁止为锚定单品槽位再从衣橱选替代品覆盖锚定单品。
