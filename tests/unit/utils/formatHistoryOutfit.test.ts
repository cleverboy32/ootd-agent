import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatHistoryAsync } from '@/server/utils/estimate-token';
import { formatStylistResultForHistory } from '@/server/utils/messageContent';
import type { Message } from '@/server/types/message';

describe('formatStylistResultForHistory', () => {
  it('renders compact slots without avoid-repeat orders', () => {
    const text = formatStylistResultForHistory({
      outfits: [
        {
          id: 'outfit_1',
          overall_concept: '利落通勤',
          selected_items: [
            { id: 'new_item', name: '乐福鞋', layer: 'shoes', reason: '' },
            { id: 'w1', name: '长袖针织衫', layer: 'top', reason: '' },
            { id: 'new_item', name: '高腰直筒裤', layer: 'bottom', reason: '' },
          ],
          visual_composition: { model_pose: '', outfit_details: '', background: '' },
        },
      ],
    });
    assert.match(text, /【上轮搭配方案】/);
    assert.match(text, /outfit_1 \| 利落通勤/);
    assert.match(text, /- top: 长袖针织衫 \(wardrobe\)/);
    assert.match(text, /- bottom: 高腰直筒裤 \(new\)/);
    assert.match(text, /- shoes: 乐福鞋 \(new\)/);
    assert.doesNotMatch(text, /必须遵守|禁止同款/);
  });
});

describe('formatHistoryAsync stylist_cache', () => {
  it('replaces assistant prose with compact outfit structure', async () => {
    const messages = [
      {
        id: 'u1',
        role: 'user',
        content: [{ type: 'text', content: '今天上班穿啥' }],
      },
      {
        id: 'a1',
        role: 'assistant',
        content: [
          {
            type: 'text',
            content: '今天这套很适合通勤哦～针织衫配乐福鞋……',
          },
          {
            type: 'stylist_cache',
            stylist_result: {
              outfits: [
                {
                  id: 'outfit_1',
                  overall_concept: '干练灰白',
                  selected_items: [
                    { id: 'new_item', name: '乐福鞋', layer: 'shoes', reason: '' },
                    { id: 'new_item', name: '长袖针织衫', layer: 'top', reason: '' },
                  ],
                  visual_composition: {
                    model_pose: '',
                    outfit_details: '',
                    background: '',
                  },
                },
              ],
            },
            user_profile: {},
            wardrobe_items: [],
          },
        ],
      },
    ] as unknown as Message[];

    const history = await formatHistoryAsync(messages);
    assert.equal(history.length, 2);
    assert.equal(history[0]?.role, 'user');
    assert.equal(history[1]?.role, 'model');
    const modelText = history[1]?.parts?.map((p) => p.text ?? '').join('\n') ?? '';
    assert.match(modelText, /【上轮搭配方案】/);
    assert.match(modelText, /长袖针织衫/);
    assert.match(modelText, /乐福鞋/);
    assert.doesNotMatch(modelText, /很适合通勤哦/);
  });

  it('keeps plain assistant text when no stylist_cache', async () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'text', content: '你想去什么场合呢？' }],
      },
    ] as unknown as Message[];
    const history = await formatHistoryAsync(messages);
    assert.equal(history[0]?.parts?.[0]?.text, '你想去什么场合呢？');
  });
});
