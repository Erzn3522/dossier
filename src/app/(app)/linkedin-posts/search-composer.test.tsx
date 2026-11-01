import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SearchComposer } from "./search-composer";

describe("dynamic LinkedIn search composer", () => {
  it("defaults to AI, composes countries and exposes round/budget limits", async () => {
    const submit = vi.fn(); const user = userEvent.setup();
    render(<SearchComposer disabled={false} pending={false} onSubmit={submit} />);
    expect(screen.getByLabelText("Optimize with AI")).toBeChecked();
    await user.type(screen.getByLabelText("Keyword 1"), "Computer Vision");
    await user.type(screen.getByLabelText("Target countries"), "Türkiye{Enter}");
    await user.type(screen.getByLabelText("Target countries"), "Slovenia{Enter}");
    expect(screen.getByText(/6 rounds · up to \$0.166666/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start AI search" }));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ mode: "ai", query: expect.objectContaining({ countries: ["Türkiye", "Slovenia"], rounds: 3, budgetUsd: 1 }) }));
  });
  it("pastes rows and provides manual preview and limit correction", async () => {
    const user = userEvent.setup();
    render(<SearchComposer disabled={false} pending={false} onSubmit={vi.fn()} />);
    await user.click(screen.getByLabelText("Optimize with AI"));
    await user.click(screen.getByLabelText("Keyword 1"));
    await user.paste("vision hiring\nperception hiring\nrobotics hiring\napplied ML hiring\ndeep learning hiring");
    expect(screen.getByLabelText("Keyword 5")).toHaveValue("deep learning hiring");
    await user.type(screen.getByLabelText("Target countries"), "Turkey{Enter}");
    await user.type(screen.getByLabelText("Target countries"), "Slovenia{Enter}");
    expect(screen.getByText("vision hiring Slovenia")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Posts per query / author")); await user.type(screen.getByLabelText("Posts per query / author"), "25");
    expect(screen.getByRole("button", { name: "Search LinkedIn posts" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Use 20 posts per query" }));
    expect(screen.getByRole("button", { name: "Search LinkedIn posts" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Remove country Turkey" }));
    expect(screen.queryByText("vision hiring Turkey")).not.toBeInTheDocument();
  });
  it("rejects a paste exceeding the limit without dropping existing rows", async () => {
    const user = userEvent.setup(); render(<SearchComposer disabled={false} pending={false} onSubmit={vi.fn()} />);
    await user.click(screen.getByLabelText("Keyword 1")); await user.paste("one\ntwo\nthree\nfour\nfive\nsix");
    expect(screen.getByRole("alert")).toHaveTextContent("no rows were changed");
    expect(screen.getByLabelText("Keyword 1")).toHaveValue("");
  });
});
