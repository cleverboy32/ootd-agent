import { END, START, StateGraph } from '@langchain/langgraph';
import { OutfitPipelineAnnotation } from './state';
import {
  ensureMessageNode,
  followupPathNode,
  gatekeeperNode,
  loadProfileNode,
  parallelFromCacheNode,
  parallelOutfitsNode,
  routeAfterGatekeeper,
  styleAdvicePathNode,
  stylistNode,
} from './nodes';

/**
 * 主搭配流水线 Graph。
 * 缓存命中路径由 orchestrator 在 invoke 前选择 entry，或设置 route=from_cache。
 */
function buildFreshPathGraph() {
  return new StateGraph(OutfitPipelineAnnotation)
    .addNode('ensureMessage', ensureMessageNode)
    .addNode('gatekeeper', gatekeeperNode)
    .addNode('styleAdvicePath', styleAdvicePathNode)
    .addNode('followupPath', followupPathNode)
    .addNode('loadProfile', loadProfileNode)
    .addNode('stylist', stylistNode)
    .addNode('parallelOutfits', parallelOutfitsNode)
    .addEdge(START, 'ensureMessage')
    .addEdge('ensureMessage', 'gatekeeper')
    .addConditionalEdges('gatekeeper', routeAfterGatekeeper, {
      styleAdvicePath: 'styleAdvicePath',
      followupPath: 'followupPath',
      loadProfile: 'loadProfile',
    })
    .addEdge('styleAdvicePath', END)
    .addEdge('followupPath', END)
    .addEdge('loadProfile', 'stylist')
    .addEdge('stylist', 'parallelOutfits')
    .addEdge('parallelOutfits', END);
}

function buildCachePathGraph() {
  return new StateGraph(OutfitPipelineAnnotation)
    .addNode('parallelFromCache', parallelFromCacheNode)
    .addEdge(START, 'parallelFromCache')
    .addEdge('parallelFromCache', END);
}

export const outfitFreshPipeline = buildFreshPathGraph().compile({
  name: 'outfit_fresh',
});
export const outfitCachePipeline = buildCachePathGraph().compile({
  name: 'outfit_cache',
});
