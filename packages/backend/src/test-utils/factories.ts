import type { CreateServerRequest } from "@mc-server-manager/shared";

export function buildCreateServerRequest(
  overrides: Partial<CreateServerRequest> = {},
): CreateServerRequest {
  return {
    name: "Test Server",
    type: "vanilla",
    mcVersion: "1.21",
    port: 25565,
    ...overrides,
  };
}
