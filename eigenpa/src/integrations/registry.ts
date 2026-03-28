import type { IntegrationDefinition } from "./types.js";
import { googleCalendar } from "./google-calendar.js";
import { gmail } from "./gmail.js";

/**
 * Global registry of all available integrations.
 * Add new integrations here — they become available to all users.
 */
const ALL_INTEGRATIONS: IntegrationDefinition[] = [googleCalendar, gmail];

const byId = new Map<string, IntegrationDefinition>(
  ALL_INTEGRATIONS.map((i) => [i.id, i])
);

export function getIntegration(id: string): IntegrationDefinition | undefined {
  return byId.get(id);
}

export function listIntegrations(): IntegrationDefinition[] {
  return ALL_INTEGRATIONS;
}
