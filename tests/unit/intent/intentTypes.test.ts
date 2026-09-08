import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOutfitSelectionGatekeeperReply,
  adjudicateNewTaskVsRevisionIntent,
  coerceWardrobeBrowseIntent,
  correctAnchorSlot,
  correctDressingClimate,
  extractConfirmedWardrobeId,
  extractOutfitIdFromText,
  finalizeGatekeeperResult,
  inferAnchorSlotFromSummary,
  normalizeGatekeeperIntent,
  resolveWardrobeAnchorIdFromHistory,
} from '@/server/agents/intent';
import type { Content, Part } from '@google/genai';

describe('inferAnchorSlotFromSummary', () => {
  it('classifies earrings and necklaces as accessory', () => {
    assert.equal(inferAnchorSlotFromSummary('金色圆环耳环，带有铆钉装饰细节'), 'accessory');
    assert.equal(inferAnchorSlotFromSummary('金色珠串项链，黑色方形吊坠'), 'accessory');
  });

  it('classifies garments correctly', () => {
    assert.equal(inferAnchorSlotFromSummary('蓝白细条纹棉质衬衫'), 'top');
    assert.equal(inferAnchorSlotFromSummary('高腰阔腿牛仔裤'), 'bottom');
    assert.equal(inferAnchorSlotFromSummary('白色复古德训鞋'), 'shoes');
    assert.equal(inferAnchorSlotFromSummary('绿色裙子'), 'dress');
    assert.equal(inferAnchorSlotFromSummary('冬季灰色长毛呢外套'), 'outerwear');
  });

  it('prioritizes summary over conversation context', () => {
    assert.equal(
      inferAnchorSlotFromSummary('冬季灰色长毛呢外套', '之前聊过连衣裙和裙子'),
      'outerwear'
    );
  });
});

describe('extractConfirmedWardrobeId', () => {
  it('extracts id from picker confirmation message', () => {
    assert.equal(
      extractConfirmedWardrobeId('确认选择这件单品（id=cmqg5ec6b0000pvs8q5kp2358）'),
      'cmqg5ec6b0000pvs8q5kp2358'
    );
  });
});

describe('resolveWardrobeAnchorIdFromHistory', () => {
  const dressId = 'cmqg5edih0002pvs8c3035d6a';
  const wrongTshirtId = 'cmqg5gtn4000bpvs8083yhqfh';

  const historyWithSingletonCandidate: Content[] = [
    {
      role: 'model',
      parts: [
        {
          text: `衣橱里没有找到符合「白色连衣裙」的单品。不过有一件light green的裙子，你看看是不是这件？\n[wardrobe_candidates:id=${dressId}]`,
        },
      ],
    },
  ];

  it('overrides Gatekeeper hallucinated id with last singleton candidate', () => {
    const result = resolveWardrobeAnchorIdFromHistory(
      normalizeGatekeeperIntent({
        request_type: 'wardrobe_pairing',
        anchor_item_summary: '绿色无袖连衣裙',
        anchor_slot: 'dress',
        occasion: '出门吃饭',
        anchor_wardrobe_id: wrongTshirtId,
      }),
      historyWithSingletonCandidate,
      '额 这个也行吧。这个帮我搭配一下 我穿出门吃饭'
    );

    assert.equal(result.anchor_wardrobe_id, dressId);
  });

  it('fills missing id on verbal accept of singleton candidate', () => {
    const result = resolveWardrobeAnchorIdFromHistory(
      normalizeGatekeeperIntent({
        request_type: 'wardrobe_pairing',
        anchor_item_summary: '绿色无袖连衣裙',
        anchor_slot: 'dress',
        occasion: '出门吃饭',
        anchor_wardrobe_id: '',
      }),
      historyWithSingletonCandidate,
      '这个也行吧，帮我搭配一下'
    );

    assert.equal(result.anchor_wardrobe_id, dressId);
  });

  it('prefers explicit confirmation id over history singleton', () => {
    const picked = 'cmqg5aaaaaaaaaaaaaaaaa';
    const result = resolveWardrobeAnchorIdFromHistory(
      normalizeGatekeeperIntent({
        request_type: 'wardrobe_pairing',
        anchor_item_summary: '绿色无袖连衣裙',
        anchor_slot: 'dress',
        occasion: '出门吃饭',
        anchor_wardrobe_id: wrongTshirtId,
      }),
      historyWithSingletonCandidate,
      `确认选择这件单品（id=${picked}）`
    );

    assert.equal(result.anchor_wardrobe_id, picked);
  });

  it('does not guess when multiple candidates were presented', () => {
    const multi: Content[] = [
      {
        role: 'model',
        parts: [{ text: `[wardrobe_candidates:id=${dressId},${wrongTshirtId}]` }],
      },
    ];
    const result = resolveWardrobeAnchorIdFromHistory(
      normalizeGatekeeperIntent({
        request_type: 'wardrobe_pairing',
        anchor_item_summary: '裙子',
        anchor_slot: 'dress',
        occasion: '吃饭',
        anchor_wardrobe_id: wrongTshirtId,
      }),
      multi,
      '这个也行吧'
    );

    assert.equal(result.anchor_wardrobe_id, wrongTshirtId);
  });
});

describe('buildOutfitSelectionGatekeeperReply', () => {
  it('uses short conversational tone', () => {
    const reply = buildOutfitSelectionGatekeeperReply('第一套');
    assert.ok(reply.length < 80);
    assert.doesNotMatch(reply, /衬.*气质/);
  });
});

describe('correctAnchorSlot', () => {
  it('fixes mislabeled earring anchor from top to accessory', () => {
    const intent = normalizeGatekeeperIntent({
      request_type: 'purchase_pairing',
      anchor_item_summary: '金色圆环耳环，带有铆钉装饰细节',
      anchor_slot: 'top',
      occasion: '日常百搭',
    });

    const fixed = correctAnchorSlot(intent, '这副耳环');
    assert.equal(fixed.anchor_slot, 'accessory');
  });

  it('fixes mislabeled outerwear anchor from dress when context mentions 裙子', () => {
    const intent = normalizeGatekeeperIntent({
      request_type: 'wardrobe_pairing',
      anchor_item_summary: '冬季灰色长毛呢外套',
      anchor_slot: 'dress',
      occasion: '日常',
    });

    const fixed = correctAnchorSlot(intent, '之前推荐过连衣裙和绿色裙子');
    assert.equal(fixed.anchor_slot, 'outerwear');
  });
});

describe('correctDressingClimate', () => {
  it('fills cold from winter coat anchor when Gatekeeper left empty', () => {
    const intent = normalizeGatekeeperIntent({
      request_type: 'wardrobe_pairing',
      anchor_item_summary: '冬季灰色长毛呢外套',
      anchor_slot: 'outerwear',
      dressing_climate: '',
    });
    const fixed = correctDressingClimate(intent);
    assert.equal(fixed.dressing_climate, 'cold');
  });

  it('corrects warm to cold when anchor is winter coat', () => {
    const intent = normalizeGatekeeperIntent({
      request_type: 'wardrobe_pairing',
      anchor_item_summary: '灰色长毛呢外套',
      anchor_slot: 'outerwear',
      dressing_climate: 'warm',
    });
    const fixed = correctDressingClimate(intent);
    assert.equal(fixed.dressing_climate, 'cold');
  });
});

describe('finalizeGatekeeperResult — selection short-circuit', () => {
  it('blocks outfit_selection and returns a gatekeeper reply', () => {
    const result = finalizeGatekeeperResult({
      extracted_intent: normalizeGatekeeperIntent({
        request_type: 'outfit_selection',
        selected_outfit_id: 'outfit_1',
        occasion: '聚餐',
      }),
    });

    assert.equal(result.is_complete, false);
    assert.equal(result.followup_questions.length, 0);
    assert.match(result.gatekeeper_reply ?? '', /第一套/);
  });

  it('blocks clarify intent with a clarifying reply', () => {
    const result = finalizeGatekeeperResult({
      extracted_intent: normalizeGatekeeperIntent({ request_type: 'clarify' }),
    });

    assert.equal(result.is_complete, false);
    assert.ok((result.gatekeeper_reply ?? '').length > 0);
  });

  it('confirms outfit_confirmed without asking for revision', () => {
    const result = finalizeGatekeeperResult({
      extracted_intent: normalizeGatekeeperIntent({
        request_type: 'outfit_confirmed',
        selected_outfit_id: 'outfit_1',
      }),
    });

    assert.equal(result.is_complete, false);
    assert.match(result.gatekeeper_reply ?? '', /定下来/);
    assert.doesNotMatch(result.gatekeeper_reply ?? '', /微调/);
  });
});

describe('finalizeGatekeeperResult — style_advice advice route', () => {
  it('short-circuits to Style Advice Agent even when a concrete occasion is present', () => {
    const result = finalizeGatekeeperResult({
      extracted_intent: normalizeGatekeeperIntent({
        request_type: 'style_advice',
        occasion: '商务通勤',
      }),
      modelIsComplete: true,
    });

    assert.equal(result.is_complete, false);
    assert.equal(result.followup_questions.length, 0);
    assert.equal(result.gatekeeper_reply, undefined);
  });

  it('does not require a Gatekeeper reply when too vague', () => {
    const result = finalizeGatekeeperResult({
      extracted_intent: normalizeGatekeeperIntent({
        request_type: 'style_advice',
        occasion: '',
      }),
      modelIsComplete: false,
    });

    assert.equal(result.is_complete, false);
    assert.equal(result.gatekeeper_reply, undefined);
  });

  it('does not generate when model judged incomplete even if occasion present', () => {
    const result = finalizeGatekeeperResult({
      extracted_intent: normalizeGatekeeperIntent({
        request_type: 'style_advice',
        occasion: '商务通勤',
      }),
      modelIsComplete: false,
    });

    assert.equal(result.is_complete, false);
  });
});

describe('finalizeGatekeeperResult — feedback_revision outfit selection', () => {
  const multiOutfitHistory: Content[] = [
    { role: 'user', parts: [{ text: '这套裙子怎么搭呢' }] },
    {
      role: 'model',
      parts: [{ text: '### 方案一\n通勤风\n### 方案二\n休闲风' }],
    },
  ];

  it('asks which outfit when revision has no outfit mention and multiple outfits exist', () => {
    const result = finalizeGatekeeperResult({
      extracted_intent: normalizeGatekeeperIntent({
        request_type: 'feedback_revision',
        special_requests: '去掉外套，进行单穿搭配',
        selected_outfit_id: 'outfit_1',
      }),
      currentMessageText: '去掉外套，进行单穿搭配',
      history: multiOutfitHistory,
    });

    assert.equal(result.is_complete, false);
    assert.equal(result.extracted_intent.selected_outfit_id, '');
    assert.match(result.gatekeeper_reply ?? '', /第一套还是第二套/);
  });

  it('passes revision when user names outfit in current message', () => {
    const result = finalizeGatekeeperResult({
      extracted_intent: normalizeGatekeeperIntent({
        request_type: 'feedback_revision',
        special_requests: '去掉外套',
        selected_outfit_id: '',
      }),
      currentMessageText: '第一套去掉外套',
      history: multiOutfitHistory,
    });

    assert.equal(result.is_complete, true);
    assert.equal(result.extracted_intent.selected_outfit_id, 'outfit_1');
  });

  it('infers outfit from prior user selection in history', () => {
    const history: Content[] = [
      ...multiOutfitHistory,
      { role: 'user', parts: [{ text: '我更喜欢第二套' }] },
    ];

    const result = finalizeGatekeeperResult({
      extracted_intent: normalizeGatekeeperIntent({
        request_type: 'feedback_revision',
        special_requests: '鞋换成白色',
        selected_outfit_id: 'outfit_1',
      }),
      currentMessageText: '鞋换成白色',
      history,
    });

    assert.equal(result.is_complete, true);
    assert.equal(result.extracted_intent.selected_outfit_id, 'outfit_2');
  });

  it('defaults to outfit_1 when only one outfit was shown', () => {
    const singleOutfitHistory: Content[] = [
      { role: 'user', parts: [{ text: '帮我搭一套' }] },
      { role: 'model', parts: [{ text: '### 方案一\n通勤风' }] },
    ];

    const result = finalizeGatekeeperResult({
      extracted_intent: normalizeGatekeeperIntent({
        request_type: 'feedback_revision',
        special_requests: '鞋换成高跟鞋',
        selected_outfit_id: '',
      }),
      currentMessageText: '鞋换成高跟鞋',
      history: singleOutfitHistory,
    });

    assert.equal(result.is_complete, true);
    assert.equal(result.extracted_intent.selected_outfit_id, 'outfit_1');
  });
});

describe('extractOutfitIdFromText', () => {
  it('detects outfit ids in user phrasing', () => {
    assert.equal(extractOutfitIdFromText('第一套去掉外套'), 'outfit_1');
    assert.equal(extractOutfitIdFromText('第二套鞋换一下'), 'outfit_2');
    assert.equal(extractOutfitIdFromText('去掉外套'), '');
  });

  it('accepts short answers like 二套 / 1套 / 2 after clarify', () => {
    assert.equal(extractOutfitIdFromText('二套'), 'outfit_2');
    assert.equal(extractOutfitIdFromText('2套'), 'outfit_2');
    assert.equal(extractOutfitIdFromText('2'), 'outfit_2');
    assert.equal(extractOutfitIdFromText('二'), 'outfit_2');
    assert.equal(extractOutfitIdFromText('1套'), 'outfit_1');
    assert.equal(extractOutfitIdFromText('1'), 'outfit_1');
    assert.equal(extractOutfitIdFromText('方案2'), 'outfit_2');
  });

  it('does not treat 一套 / 两套 / longer digits as outfit selection', () => {
    assert.equal(extractOutfitIdFromText('帮我搭一套'), '');
    assert.equal(extractOutfitIdFromText('两套都不行'), '');
    assert.equal(extractOutfitIdFromText('12'), '');
    assert.equal(extractOutfitIdFromText('20度'), '');
  });
});

describe('finalizeGatekeeperResult — feedback_revision after outfit clarify', () => {
  const multiOutfitHistory: Content[] = [
    { role: 'user', parts: [{ text: '这套裙子怎么搭呢' }] },
    {
      role: 'model',
      parts: [{ text: '### 方案一\n通勤风\n### 方案二\n休闲风' }],
    },
    {
      role: 'model',
      parts: [{ text: '好的～上一轮给您准备了多套方案，请问您想微调第一套还是第二套？' }],
    },
  ];

  it('accepts 二套 as selecting outfit_2 and completes revision', () => {
    const result = finalizeGatekeeperResult({
      extracted_intent: normalizeGatekeeperIntent({
        request_type: 'feedback_revision',
        special_requests: '用户反馈第二套鞋履不太协调，请更换更协调的鞋款',
        selected_outfit_id: 'outfit_2',
      }),
      currentMessageText: '二套',
      history: multiOutfitHistory,
    });

    assert.equal(result.is_complete, true);
    assert.equal(result.extracted_intent.selected_outfit_id, 'outfit_2');
  });

  it('keeps LLM selected_outfit_id when special_requests corroborates it', () => {
    const result = finalizeGatekeeperResult({
      extracted_intent: normalizeGatekeeperIntent({
        request_type: 'feedback_revision',
        special_requests: '在第二套基础上把鞋换成白色运动鞋',
        selected_outfit_id: 'outfit_2',
      }),
      // 极短确认、且未命中历史选套时，靠 LLM + special_requests 印证兜底
      currentMessageText: '嗯改这个',
      history: multiOutfitHistory,
    });

    assert.equal(result.is_complete, true);
    assert.equal(result.extracted_intent.selected_outfit_id, 'outfit_2');
  });
});

describe('adjudicateNewTaskVsRevisionIntent', () => {
  it('coerces a new activity request away from feedback_revision', () => {
    const result = adjudicateNewTaskVsRevisionIntent(
      normalizeGatekeeperIntent({
        request_type: 'feedback_revision',
        occasion: '踢足球',
        special_requests: '在上一轮搭配基础上，针对踢足球场景进行调整',
        selected_outfit_id: '',
      }),
      [{ text: '我还想去踢足球，应该穿啥' }]
    );

    assert.equal(result.request_type, 'wardrobe_outfit');
    assert.equal(result.selected_outfit_id, '');
  });

  it('keeps explicit outfit edits as feedback_revision', () => {
    const result = adjudicateNewTaskVsRevisionIntent(
      normalizeGatekeeperIntent({
        request_type: 'feedback_revision',
        occasion: '运动',
        special_requests: '第一套改成踢足球也能穿的',
        selected_outfit_id: 'outfit_1',
      }),
      [{ text: '第一套改成踢足球也能穿的' }]
    );

    assert.equal(result.request_type, 'feedback_revision');
    assert.equal(result.selected_outfit_id, 'outfit_1');
  });

  it('coerces full regen dissatisfaction away from feedback_revision', () => {
    const result = adjudicateNewTaskVsRevisionIntent(
      normalizeGatekeeperIntent({
        request_type: 'feedback_revision',
        occasion: '国庆青海旅行',
        special_requests: '在上一轮基础上调整',
        selected_outfit_id: '',
      }),
      [{ text: '额 重新搭配，搭配的太烂了' }]
    );

    assert.equal(result.request_type, 'wardrobe_outfit');
    assert.equal(result.selected_outfit_id, '');
  });

  it('coerces explicit regenerate request away from feedback_revision', () => {
    const result = adjudicateNewTaskVsRevisionIntent(
      normalizeGatekeeperIntent({
        request_type: 'feedback_revision',
        occasion: '国庆青海旅行',
        special_requests: '',
        selected_outfit_id: '',
      }),
      [{ text: '都不好，给我重新生成' }]
    );

    assert.equal(result.request_type, 'wardrobe_outfit');
    assert.match(result.special_requests, /重新生成/);
  });

  it('full regen after adjudicate completes wardrobe_outfit without outfit clarify', () => {
    const multiOutfitHistory: Content[] = [
      { role: 'user', parts: [{ text: '国庆去青海' }] },
      {
        role: 'model',
        parts: [{ text: '### 方案一\n白天游览\n### 方案二\n日出' }],
      },
    ];

    const adjudicated = adjudicateNewTaskVsRevisionIntent(
      normalizeGatekeeperIntent({
        request_type: 'feedback_revision',
        occasion: '国庆青海旅行',
        special_requests: '',
      }),
      [{ text: '都不好，给我重新生成' }]
    );

    const result = finalizeGatekeeperResult({
      extracted_intent: adjudicated,
      modelIsComplete: true,
      currentMessageText: '都不好，给我重新生成',
      history: multiOutfitHistory,
    });

    assert.equal(result.is_complete, true);
    assert.equal(result.extracted_intent.request_type, 'wardrobe_outfit');
    assert.equal(result.gatekeeper_reply ?? '', '');
  });
});

describe('coerceWardrobeBrowseIntent', () => {
  const emptyHistory: Content[] = [];

  function currentInput(text: string): Part[] {
    return [{ text }];
  }

  it('coerces clarify to wardrobe_pairing for a browse query', () => {
    const result = coerceWardrobeBrowseIntent(
      normalizeGatekeeperIntent({
        request_type: 'clarify',
        special_requests: '',
      }),
      emptyHistory,
      currentInput('我衣橱里有没有白色裙子')
    );

    assert.equal(result.request_type, 'wardrobe_pairing');
    assert.match(result.anchor_item_summary, /白.{0,4}裙/);
  });

  it('coerces clarify when user corrects a previously shown wrong item', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: '我衣橱里有没有白色裙子' }] },
      { role: 'model', parts: [{ text: '找到了一件绿色的裙子，是这件吗？' }] },
    ];

    const result = coerceWardrobeBrowseIntent(
      normalizeGatekeeperIntent({
        request_type: 'clarify',
        special_requests: '',
      }),
      history,
      currentInput('这不是绿色的裙子吗')
    );

    assert.equal(result.request_type, 'wardrobe_pairing');
    assert.match(result.anchor_item_summary, /白.{0,4}裙/);
  });

  it('does not coerce clarify when the query is unrelated to wardrobe browsing', () => {
    const result = coerceWardrobeBrowseIntent(
      normalizeGatekeeperIntent({
        request_type: 'clarify',
        special_requests: '',
      }),
      emptyHistory,
      currentInput('你好呀')
    );

    assert.equal(result.request_type, 'clarify');
  });

  it('does not touch non-clarify request types', () => {
    const result = coerceWardrobeBrowseIntent(
      normalizeGatekeeperIntent({
        request_type: 'wardrobe_outfit',
        special_requests: '',
      }),
      emptyHistory,
      currentInput('我衣橱里有没有白色裙子')
    );

    assert.equal(result.request_type, 'wardrobe_outfit');
  });
});

describe('finalizeGatekeeperResult — wardrobe_pairing', () => {
  it('returns wardrobe_candidates when resolver is ambiguous', () => {
    const result = finalizeGatekeeperResult({
      extracted_intent: normalizeGatekeeperIntent({
        request_type: 'wardrobe_pairing',
        anchor_item_summary: '绿色裙子',
        anchor_slot: 'dress',
      }),
      wardrobeResolver: {
        status: 'ambiguous',
        candidates: [
          {
            id: 'item1',
            imageUrl: 'https://example.com/1.jpg',
            subCategory: 'dress',
            colors: ['green'],
            similarity: 0.8,
          },
          {
            id: 'item2',
            imageUrl: 'https://example.com/2.jpg',
            subCategory: 'dress',
            colors: ['green'],
            similarity: 0.75,
          },
        ],
      },
    });

    assert.equal(result.is_complete, false);
    assert.equal(result.wardrobe_candidates?.length, 2);
  });

  it('passes when anchor resolved and occasion provided', () => {
    const result = finalizeGatekeeperResult({
      extracted_intent: normalizeGatekeeperIntent({
        request_type: 'wardrobe_pairing',
        anchor_item_summary: '绿色裙子',
        anchor_slot: 'dress',
        occasion: '逛街',
      }),
      wardrobeResolver: {
        status: 'resolved',
        itemId: 'item1',
        item: {
          id: 'item1',
          imageUrl: 'https://example.com/1.jpg',
          subCategory: 'dress',
          colors: ['green'],
          similarity: 0.9,
        },
      },
    });

    assert.equal(result.is_complete, true);
    assert.equal(result.extracted_intent.anchor_wardrobe_id, 'item1');
  });

  it('returns color mismatch candidate when query color conflicts', () => {
    const result = finalizeGatekeeperResult({
      extracted_intent: normalizeGatekeeperIntent({
        request_type: 'wardrobe_pairing',
        anchor_item_summary: '白色裙子',
        anchor_slot: 'dress',
        special_requests: '查询衣橱里有没有白裙子',
      }),
      currentMessageText: '我衣橱里有没有白裙子',
      wardrobeResolver: {
        status: 'color_mismatch',
        queriedSummary: '白色裙子',
        nearMiss: {
          id: 'green-dress',
          imageUrl: 'https://example.com/g.jpg',
          subCategory: 'Sleeveless Shift Dress',
          colors: ['light green'],
          similarity: 0.65,
        },
      },
    });

    assert.equal(result.is_complete, false);
    assert.equal(result.wardrobe_candidates?.length, 1);
    assert.match(result.gatekeeper_reply ?? '', /没有找到符合「白色裙子」/);
    assert.match(result.gatekeeper_reply ?? '', /light green|浅绿/i);
  });
});
