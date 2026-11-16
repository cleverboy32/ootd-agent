import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildPurchaseSandwichWeather,
  buildWeatherMismatchOfferReply,
  historyHasWeatherMismatchOffer,
  inferTempRangeFromGarmentText,
  isWeatherMismatchInsist,
  itemConflictsWithWeatherCelsius,
  specialRequestsLooksLikeHardGarmentConstraint,
  WEATHER_MISMATCH_OFFER_MARKER,
} from '@/server/utils/weatherAnchorFit';
import { finalizeGatekeeperResult } from '@/server/agents/intent/finalize';
import type { GatekeeperIntent } from '@/server/agents/intent';

function baseIntent(partial: Partial<GatekeeperIntent>): GatekeeperIntent {
  return {
    weather: '',
    city: '',
    city_role: '',
    occasion: '日常出行',
    style_preference: '日常休闲',
    special_requests: '',
    request_type: 'wardrobe_outfit',
    anchor_item_summary: '',
    anchor_slot: '',
    session_item_id: '',
    anchor_image_url: '',
    dressing_climate: '',
    ...partial,
  };
}

describe('inferTempRangeFromGarmentText', () => {
  it('marks thin summer pieces as warm-min', () => {
    const range = inferTempRangeFromGarmentText('薄纱吊带短裙');
    assert.ok(range);
    assert.equal(range!.tempMin, 22);
  });

  it('marks 五分裤 as tempMin 20', () => {
    const range = inferTempRangeFromGarmentText('宽松牛仔五分裤');
    assert.ok(range);
    assert.equal(range!.tempMin, 20);
  });
});

describe('itemConflictsWithWeatherCelsius', () => {
  it('thin skirt conflicts with 5℃', () => {
    assert.equal(
      itemConflictsWithWeatherCelsius({ tempMin: 20, tempMax: null }, 5),
      true
    );
  });

  it('thin skirt ok at 24℃', () => {
    assert.equal(
      itemConflictsWithWeatherCelsius({ tempMin: 20, tempMax: null }, 24),
      false
    );
  });
});

describe('purchase sandwich weather', () => {
  it('builds axis from summer dress summary', () => {
    const weather = buildPurchaseSandwichWeather(['浅色薄纱吊带连衣裙']);
    assert.ok(weather);
    assert.match(weather!, /约\d+℃（按待购单品适穿温度）/);
  });
});

describe('insist + offer marker', () => {
  it('detects insist phrases', () => {
    assert.equal(isWeatherMismatchInsist('我坚持要穿这件'), true);
    assert.equal(isWeatherMismatchInsist('那就按天气换吧'), false);
  });

  it('detects offer marker in last model turn', () => {
    assert.equal(
      historyHasWeatherMismatchOffer([
        {
          role: 'model',
          parts: [{ text: `冲突。要不要我${WEATHER_MISMATCH_OFFER_MARKER}？` }],
        },
      ]),
      true
    );
  });
});

describe('finalize weather mismatch', () => {
  it('wardrobe pairing soft-blocks unfit anchor', () => {
    const result = finalizeGatekeeperResult({
      extracted_intent: baseIntent({
        request_type: 'wardrobe_pairing',
        weather: '5℃ 晴',
        occasion: '日常出行',
        anchor_item_summary: '薄纱短裙',
        anchor_wardrobe_id: 'item_1',
        anchor_slot: 'dress',
      }),
      wardrobeAnchorTemp: {
        label: '薄纱短裙',
        tempMin: 22,
        tempMax: null,
      },
      currentMessageText: '就穿这件薄纱短裙出门',
      modelIsComplete: true,
    });
    assert.equal(result.is_complete, false);
    assert.equal(result.extracted_intent.request_type, 'clarify');
    assert.match(result.gatekeeper_reply ?? '', /更合适的单品重新搭一套/);
  });

  it('hard-refuses after insist with prior offer', () => {
    const result = finalizeGatekeeperResult({
      extracted_intent: baseIntent({
        request_type: 'wardrobe_pairing',
        weather: '5℃',
        occasion: '日常',
        anchor_item_summary: '薄纱短裙',
        anchor_wardrobe_id: 'item_1',
        anchor_slot: 'dress',
      }),
      wardrobeAnchorTemp: { label: '薄纱短裙', tempMin: 22, tempMax: null },
      currentMessageText: '我坚持就要穿这件',
      history: [
        {
          role: 'model',
          parts: [{ text: buildWeatherMismatchOfferReply({
            itemLabel: '薄纱短裙',
            weatherCelsius: 5,
            source: 'wardrobe',
          }) }],
        },
      ],
      modelIsComplete: true,
    });
    assert.equal(result.is_complete, false);
    assert.match(result.gatekeeper_reply ?? '', /超出我的搭配原则/);
  });

  it('special_requests hard garment on wardrobe_outfit soft-blocks', () => {
    assert.equal(
      specialRequestsLooksLikeHardGarmentConstraint('必须穿那条薄短裙'),
      true
    );
    const result = finalizeGatekeeperResult({
      extracted_intent: baseIntent({
        request_type: 'wardrobe_outfit',
        weather: '南京，阴，8℃',
        occasion: '日常出行',
        special_requests: '必须穿那条薄短裙',
      }),
      currentMessageText: '帮我搭一套，必须穿那条薄短裙',
      modelIsComplete: true,
    });
    assert.equal(result.is_complete, false);
    assert.match(result.gatekeeper_reply ?? '', /更合适的单品重新搭一套/);
  });

  it('purchase_pairing is not blocked by ambient cold', () => {
    const result = finalizeGatekeeperResult({
      extracted_intent: baseIntent({
        request_type: 'purchase_pairing',
        weather: '5℃',
        occasion: '日常',
        anchor_item_summary: '薄纱吊带裙',
        anchor_slot: 'dress',
        purchase_items: [{ summary: '薄纱吊带裙', slot: 'dress', session_item_id: 'si_1' }],
      }),
      currentMessageText: '用这件待购裙搭一套',
      modelIsComplete: true,
    });
    assert.equal(result.is_complete, true);
    assert.equal(result.extracted_intent.request_type, 'purchase_pairing');
  });
});
