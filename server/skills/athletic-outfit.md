---
name: athletic-outfit
description: 篮球、跑步、健身等运动场合的功能装备约束，用于检索 query 和选品
---

# 运动场合穿搭

## 选品
- 这是【功能性优先】场景，不是街头休闲造型。禁止把 Wrap Shorts、Denim Shorts、时装 Sneakers、Hiking Sneakers 描述成适合该运动的装备。
- 若衣橱仅有弱相关休闲单品，对应槽位【必须】用 "new_item" 推荐真正的运动装备（如 athletic shorts、basketball sneakers），并在 reason 中说明衣橱缺口。
- 禁止为不合场景单品编造运动功能理由（如「徒步鞋抓地力适合篮球」）。
- 先阅读 <wardrobe_match_summary>，对 status=weak/none 的核心槽位使用 new_item，禁止硬选时装类单品。

## 检索 query
- query 必须体现 athletic / sports / breathable / training 等功能属性。
- bottom 优先 sports shorts / athletic shorts，shoes 优先 basketball sneakers / athletic sneakers。
- 禁止只搜 casual shorts / fashion sneakers。
