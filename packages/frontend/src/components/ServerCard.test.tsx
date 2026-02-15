import { screen } from "@testing-library/react";
import { renderWithRouter } from "../test-utils/render";
import { buildServer } from "../test-utils/factories";
import { ServerCard } from "./ServerCard";

describe("ServerCard", () => {
  it("renders server name", () => {
    const server = buildServer({ name: "My Test Server" });
    renderWithRouter(<ServerCard server={server} />);
    expect(screen.getByText("My Test Server")).toBeInTheDocument();
  });

  it("renders server type and version", () => {
    const server = buildServer({ type: "vanilla", mcVersion: "1.21" });
    renderWithRouter(<ServerCard server={server} />);
    // ServerCard capitalizes the type: "Vanilla"
    expect(screen.getByText(/Vanilla/)).toBeInTheDocument();
    expect(screen.getByText(/1\.21/)).toBeInTheDocument();
  });

  it("renders player count", () => {
    const server = buildServer({ playerCount: 5 });
    renderWithRouter(<ServerCard server={server} />);
    expect(screen.getByText(/5 players/)).toBeInTheDocument();
  });

  it("renders port", () => {
    const server = buildServer({ port: 25566 });
    renderWithRouter(<ServerCard server={server} />);
    expect(screen.getByText(/Port 25566/)).toBeInTheDocument();
  });

  it("renders as a link", () => {
    const server = buildServer({ id: "test-123" });
    renderWithRouter(<ServerCard server={server} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/servers/test-123");
  });
});
