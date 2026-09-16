import { anthropic } from './anthropic.js';
import { openai } from './openai.js';

export const PROVIDERS = { anthropic, openai };
export function getProvider(id) { return PROVIDERS[id] || anthropic; }
