import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  RequestAuditKind,
  RequestAuditOutcome,
  RequestAuditRequestType,
  RequestAuditRoute,
  RequestTrace,
  toRequestAuditRequestType,
  toRequestAuditRoute,
} from '@/server/logging/request';

describe('toRequestAuditRequestType', () => {
  it('maps all 8 OutfitRequestType values', () => {
    assert.equal(toRequestAuditRequestType('wardrobe_outfit'), RequestAuditRequestType.WardrobeOutfit);
    assert.equal(toRequestAuditRequestType('wardrobe_pairing'), RequestAuditRequestType.WardrobePairing);
    assert.equal(toRequestAuditRequestType('purchase_pairing'), RequestAuditRequestType.PurchasePairing);
    assert.equal(toRequestAuditRequestType('feedback_revision'), RequestAuditRequestType.FeedbackRevision);
    assert.equal(toRequestAuditRequestType('outfit_selection'), RequestAuditRequestType.OutfitSelection);
    assert.equal(toRequestAuditRequestType('outfit_confirmed'), RequestAuditRequestType.OutfitConfirmed);
    assert.equal(toRequestAuditRequestType('clarify'), RequestAuditRequestType.Clarify);
    assert.equal(toRequestAuditRequestType('style_advice'), RequestAuditRequestType.StyleAdvice);
  });

  it('returns undefined for invalid values', () => {
    assert.equal(toRequestAuditRequestType('not_a_type'), undefined);
    assert.equal(toRequestAuditRequestType(''), undefined);
    assert.equal(toRequestAuditRequestType(undefined), undefined);
    assert.equal(toRequestAuditRequestType(null), undefined);
  });
});

describe('toRequestAuditRoute', () => {
  it('maps pipeline routes and empty string', () => {
    assert.equal(toRequestAuditRoute('from_cache'), RequestAuditRoute.FromCache);
    assert.equal(toRequestAuditRoute('style_advice'), RequestAuditRoute.StyleAdvice);
    assert.equal(toRequestAuditRoute('incomplete'), RequestAuditRoute.Incomplete);
    assert.equal(toRequestAuditRoute('outfit_main'), RequestAuditRoute.OutfitMain);
    assert.equal(toRequestAuditRoute('image_retry'), RequestAuditRoute.ImageRetry);
    assert.equal(toRequestAuditRoute(''), RequestAuditRoute.Unknown);
    assert.equal(toRequestAuditRoute('garbage'), RequestAuditRoute.Unknown);
  });
});

describe('RequestTrace', () => {
  it('finalize without cancel keeps clientCancelled=false and passes outcome', () => {
    const trace = new RequestTrace({
      kind: RequestAuditKind.Generate,
      conversationId: 'c1',
      messageId: 'm1',
      clientId: 'u1',
    });
    trace.setRoute(RequestAuditRoute.OutfitMain);
    trace.setRequestType('feedback_revision');

    const entry = trace.finalize({
      outcome: RequestAuditOutcome.Completed,
      summary: { outfitCount: 2 },
    });

    assert.equal(entry.clientCancelled, false);
    assert.equal(entry.cancelReason, undefined);
    assert.equal(entry.outcome, RequestAuditOutcome.Completed);
    assert.equal(entry.route, RequestAuditRoute.OutfitMain);
    assert.equal(entry.requestType, RequestAuditRequestType.FeedbackRevision);
    assert.equal(entry.kind, RequestAuditKind.Generate);
    assert.equal(entry.summary.outfitCount, 2);
    assert.ok(entry.durationMs >= 0);
  });

  it('cancel then finalize(completed) keeps outcome completed with clientCancelled=true', () => {
    const trace = new RequestTrace({ kind: RequestAuditKind.Generate });
    trace.setRoute(RequestAuditRoute.Incomplete);
    trace.markCancelled('client closed');

    const entry = trace.finalize({ outcome: RequestAuditOutcome.Completed });

    assert.equal(entry.clientCancelled, true);
    assert.equal(entry.cancelReason, 'client closed');
    assert.equal(entry.outcome, RequestAuditOutcome.Completed);
    assert.equal(entry.route, RequestAuditRoute.Incomplete);
  });

  it('markStage populates stages.*Ms', () => {
    const trace = new RequestTrace({ kind: RequestAuditKind.ImageRetry });
    trace.setRoute(RequestAuditRoute.ImageRetry);
    trace.markStage('gatekeeper', 12.4);
    trace.markStage('imageGen', 100);

    const entry = trace.finalize({ outcome: RequestAuditOutcome.Failed, errorMessage: 'boom' });

    assert.equal(entry.stages.gatekeeperMs, 12);
    assert.equal(entry.stages.imageGenMs, 100);
    assert.equal(entry.outcome, RequestAuditOutcome.Failed);
    assert.equal(entry.errorMessage, 'boom');
    assert.equal(entry.kind, RequestAuditKind.ImageRetry);
  });
});
