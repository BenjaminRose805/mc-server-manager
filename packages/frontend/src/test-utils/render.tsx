import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { ReactElement } from "react";

export function renderWithRouter(
  ui: ReactElement,
  { initialEntries = ["/"] }: { initialEntries?: string[] } = {},
) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>,
  );
}

export { screen, waitFor };
