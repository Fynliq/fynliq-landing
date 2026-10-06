// FYNLIQ Intelligence: agent registry (extension point).
//
// Every intelligence agent reuses the same layers: snapshot (data), sanitize
// (what the model may see), providers (which model), schema validation and
// observability. A new agent adds a prompt, an output schema and a validator,
// and registers here. Only the business analyst exists in v1; the rest are
// placeholders so callers and docs have stable ids. Planned agents have no
// code and cannot be run.
import { runAnalyst, ANALYST_ID, ANALYST_VERSION } from './analyst.js';

export const AGENTS = Object.freeze({
  [ANALYST_ID]: { id: ANALYST_ID, name: 'FynliqBusinessAnalyst', status: 'active', version: ANALYST_VERSION, input: 'company snapshot', run: runAnalyst },
  'fynliq-customer-voice': { id: 'fynliq-customer-voice', name: 'FynliqCustomerVoiceAgent', status: 'planned' },
  'fynliq-growth': { id: 'fynliq-growth', name: 'FynliqGrowthAgent', status: 'planned' },
  'fynliq-revenue': { id: 'fynliq-revenue', name: 'FynliqRevenueAgent', status: 'planned' },
  'fynliq-product': { id: 'fynliq-product', name: 'FynliqProductAgent', status: 'planned' },
  'fynliq-knowledge': { id: 'fynliq-knowledge', name: 'FynliqKnowledgeAgent', status: 'planned' },
  'fynliq-qa': { id: 'fynliq-qa', name: 'FynliqQAAgent', status: 'planned' },
  'fynliq-engineering': { id: 'fynliq-engineering', name: 'FynliqEngineeringAgent', status: 'planned' },
});

export function getAgent(id) {
  const agent = AGENTS[id];
  if (!agent || agent.status !== 'active') return null;
  return agent;
}
