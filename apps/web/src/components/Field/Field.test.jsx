import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { countText, FIELD_KINDS } from "../looks.js";
import { Field } from "./Field.jsx";

function Controlled() {
  const [value, setValue] = useState("hi");
  return (
    <Field label="Name" maxLength={5} showCount value={value} onChange={(e) => setValue(e.target.value)} />
  );
}

describe("Field (CC-323)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("wires the label, hint and error to every kind of control (AC-10)", () => {
    for (const kind of FIELD_KINDS.filter((each) => each !== "copy")) {
      const { unmount } = render(
        <Field label="Year of birth" kind={kind} hint="Only the year." error="Pick a year.">
          {kind === "select" ? <option value="2000">2000</option> : undefined}
        </Field>,
      );
      const control = screen.getByLabelText("Year of birth");
      expect(control).toHaveAttribute("aria-invalid", "true");
      expect(control).toHaveAccessibleDescription("Only the year. Pick a year.");
      expect(control.closest("[data-cc-field]")).toHaveAttribute("data-cc-field", kind);
      unmount();
    }
    expect(FIELD_KINDS).toEqual(["text", "select", "textarea", "date", "copy"]);
  });

  it("draws each kind with its own element", () => {
    render(
      <>
        <Field label="A" kind="select">
          <option>x</option>
        </Field>
        <Field label="B" kind="textarea" />
        <Field label="C" kind="date" />
        <Field label="D" type="email" />
      </>,
    );
    expect(screen.getByLabelText("A").tagName).toBe("SELECT");
    expect(screen.getByLabelText("B").tagName).toBe("TEXTAREA");
    expect(screen.getByLabelText("C")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("D")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("D")).not.toHaveAttribute("aria-describedby");
  });

  it("counts characters in a textarea with a limit, and says when it is full (AC-10)", async () => {
    const onChange = vi.fn();
    render(<Field label="Message" kind="textarea" maxLength={3} onChange={onChange} />);
    const box = screen.getByLabelText("Message");
    expect(box).toHaveAccessibleDescription(countText(0, 3));
    await userEvent.setup().type(box, "abc");
    expect(screen.getByText("3 of 3 characters")).toHaveClass("full");
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("counts a controlled value, and leaves the count off a text input unless asked", async () => {
    render(
      <>
        <Controlled />
        <Field label="Plain" maxLength={9} />
      </>,
    );
    expect(screen.getByText("2 of 5 characters")).toBeInTheDocument();
    await userEvent.setup().type(screen.getByLabelText("Name"), "y");
    expect(screen.getByText("3 of 5 characters")).toBeInTheDocument();
    await userEvent.setup().type(screen.getByLabelText("Plain"), "x");
    expect(screen.queryByText(/of 9 characters/)).not.toBeInTheDocument();
  });

  it("copies a read-only value with its own button, then says Copied (AC-11)", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const onCopied = vi.fn();
    render(
      <Field
        label="Challenge link"
        kind="copy"
        value="https://example.com/c/1"
        control="challenge.copy"
        copyLabel="Copy link"
        onCopied={onCopied}
      />,
    );
    const box = screen.getByLabelText("Challenge link");
    expect(box).toHaveAttribute("readonly");
    await user.click(box);
    expect(box.selectionEnd - box.selectionStart).toBe("https://example.com/c/1".length);
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith("https://example.com/c/1");
    expect(onCopied).toHaveBeenCalledOnce();
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("says what to do when the copy fails", async () => {
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    render(<Field label="Link" kind="copy" value="x" />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't copy. Select the text and copy it");
  });

  it("refuses an unknown kind", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Field label="x" kind="slider" />)).toThrow(/kind "slider"/);
  });
});
