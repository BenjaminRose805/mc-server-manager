import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it('renders "Running" text for status=running', () => {
    render(<StatusBadge status="running" />);
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it('renders "Stopped" text for status=stopped', () => {
    render(<StatusBadge status="stopped" />);
    expect(screen.getByText("Stopped")).toBeInTheDocument();
  });

  it('renders "Starting" text for status=starting', () => {
    render(<StatusBadge status="starting" />);
    expect(screen.getByText("Starting")).toBeInTheDocument();
  });

  it('renders "Crashed" text for status=crashed', () => {
    render(<StatusBadge status="crashed" />);
    expect(screen.getByText("Crashed")).toBeInTheDocument();
  });

  it('renders "Stopping" text for status=stopping', () => {
    render(<StatusBadge status="stopping" />);
    expect(screen.getByText("Stopping")).toBeInTheDocument();
  });

  it('renders "Provisioning" text for status=provisioning', () => {
    render(<StatusBadge status="provisioning" />);
    expect(screen.getByText("Provisioning")).toBeInTheDocument();
  });
});
