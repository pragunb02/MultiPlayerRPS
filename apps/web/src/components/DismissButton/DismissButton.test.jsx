import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DismissButton } from "./DismissButton.jsx";

describe("DismissButton (CC-323)", () => {
  it("is the shared icon-only ghost button, named by what it closes", async () => {
    const onClick = vi.fn();
    render(<DismissButton control="save.dismiss" label="Close: save your progress" onClick={onClick} />);

    const button = screen.getByRole("button", { name: "Close: save your progress" });
    expect(button).toHaveClass("button", "ghost", "sm", "iconOnly", "dismiss");
    expect(button).toHaveAttribute("data-cc-control", "save.dismiss");
    expect(screen.getByText("×").closest("[aria-hidden]")).toHaveAttribute("aria-hidden", "true");
    await userEvent.setup().click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
