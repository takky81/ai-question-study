// キーワード木: 兄弟順の表示、矢印キーでの展開とフォーカス、追加・改名の検証、並べ替え、移動先候補の除外、削除影響の確認
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/supabase", () => ({ supabase: {} }));
vi.mock("./api", () => ({
  listKeywords: vi.fn(),
  createKeyword: vi.fn(),
  renameKeyword: vi.fn(),
  moveKeyword: vi.fn(),
  reorderKeywords: vi.fn(),
  previewKeywordDeletion: vi.fn(),
  deleteKeyword: vi.fn(),
}));

import * as api from "./api";
import { KeywordTree } from "./KeywordTree";
import type { Keyword } from "./types";

const m = vi.mocked(api);
const k = (
  id: string,
  parentId: string | null,
  name: string,
  sortOrder: number,
): Keyword => ({
  id,
  parentId,
  name,
  sortOrder,
  subjectId: "s1",
});
// a(ネットワーク) > a1(TCP) > a11(ポート)、a2(UDP)。b(データベース) は根の2番目
const KEYWORDS = [
  k("b", null, "データベース", 2),
  k("a2", "a", "UDP", 2),
  k("a", null, "ネットワーク", 1),
  k("a11", "a1", "ポート", 1),
  k("a1", "a", "TCP", 1),
];

function item(name: string) {
  return screen.getByRole("treeitem", { name });
}

async function renderTree(onSelect = vi.fn()) {
  render(<KeywordTree subjectId="s1" selectedId={null} onSelect={onSelect} />);
  await screen.findByRole("treeitem", { name: "ネットワーク" });
  return onSelect;
}

beforeEach(() => {
  vi.resetAllMocks();
  m.listKeywords.mockResolvedValue(KEYWORDS);
});

describe("KeywordTree", () => {
  it("根を兄弟順に表示し、子は折りたたまれている", async () => {
    await renderTree();
    const roots = screen.getAllByRole("treeitem");
    expect(roots.map((r) => r.getAttribute("aria-label"))).toEqual([
      "ネットワーク",
      "データベース",
    ]);
    expect(item("ネットワーク")).toHaveAttribute("aria-expanded", "false");
    expect(item("データベース")).not.toHaveAttribute("aria-expanded");
  });

  it("矢印キーで展開・フォーカス移動・折りたたみ・親への移動ができる", async () => {
    const user = userEvent.setup();
    await renderTree();
    item("ネットワーク").focus();
    await user.keyboard("{ArrowRight}");
    expect(item("ネットワーク")).toHaveAttribute("aria-expanded", "true");
    expect(item("ネットワーク")).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(item("TCP")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(item("UDP")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(item("データベース")).toHaveFocus();
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(item("TCP")).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(item("ネットワーク")).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(item("ネットワーク")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("treeitem", { name: "TCP" })).toBeNull();
  });

  it("Enter で選択すると onSelect を呼び aria-selected になる", async () => {
    const user = userEvent.setup();
    const onSelect = await renderTree();
    item("データベース").focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("b");
    expect(item("データベース")).toHaveAttribute("aria-selected", "true");
  });

  it("根の追加: 空・兄弟重複は保存せずエラー、正常なら作成して再取得する", async () => {
    const user = userEvent.setup();
    await renderTree();
    const input = screen.getByLabelText("科目の直下に追加するキーワード名");
    await user.type(input, "  ");
    await user.click(screen.getByRole("button", { name: "直下に追加" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "キーワード名を入力してください",
    );
    await user.clear(input);
    await user.type(input, "データベース");
    await user.click(screen.getByRole("button", { name: "直下に追加" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "同じ親の下に同じ名前のキーワードがあります",
    );
    expect(m.createKeyword).not.toHaveBeenCalled();
    m.createKeyword.mockResolvedValue(k("c", null, "セキュリティ", 3));
    await user.clear(input);
    await user.type(input, " セキュリティ ");
    await user.click(screen.getByRole("button", { name: "直下に追加" }));
    expect(m.createKeyword).toHaveBeenCalledWith("s1", null, "セキュリティ");
    await waitFor(() => expect(m.listKeywords).toHaveBeenCalledTimes(2));
  });

  it("選択したキーワードに子を追加し、改名でサーバーのエラーを表示して再取得する", async () => {
    const user = userEvent.setup();
    await renderTree();
    await user.click(item("データベース"));
    m.createKeyword.mockResolvedValue(k("b1", "b", "SQL", 1));
    await user.type(
      screen.getByLabelText("「データベース」の子として追加する名前"),
      "SQL",
    );
    await user.click(screen.getByRole("button", { name: "子を追加" }));
    expect(m.createKeyword).toHaveBeenCalledWith("s1", "b", "SQL");
    await waitFor(() => expect(m.listKeywords).toHaveBeenCalledTimes(2));

    m.renameKeyword.mockRejectedValue(new Error("同じ名前がすでにあります"));
    const rename = screen.getByLabelText("「データベース」の新しい名前");
    await user.clear(rename);
    await user.type(rename, "DB");
    await user.click(screen.getByRole("button", { name: "名前を変更" }));
    expect(m.renameKeyword).toHaveBeenCalledWith("b", "DB");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "同じ名前がすでにあります",
    );
    await waitFor(() => expect(m.listKeywords).toHaveBeenCalledTimes(3));
  });

  it("上へ／下へで兄弟の並びを保存する", async () => {
    const user = userEvent.setup();
    await renderTree();
    await user.click(item("データベース"));
    expect(screen.getByRole("button", { name: "下へ" })).toBeDisabled();
    m.reorderKeywords.mockResolvedValue();
    await user.click(screen.getByRole("button", { name: "上へ" }));
    expect(m.reorderKeywords).toHaveBeenCalledWith("s1", null, ["b", "a"]);
  });

  it("移動先の候補から自分と配下を除外し、選んだ親へ移動する", async () => {
    const user = userEvent.setup();
    await renderTree();
    item("ネットワーク").focus();
    await user.keyboard("{ArrowRight}{ArrowRight}{Enter}");
    expect(item("TCP")).toHaveAttribute("aria-selected", "true");
    const select = screen.getByLabelText("「TCP」の移動先");
    const options = within(select)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual([
      "（科目の直下）",
      "ネットワーク",
      "ネットワーク / UDP",
      "データベース",
    ]);
    m.moveKeyword.mockResolvedValue();
    await user.selectOptions(select, "データベース");
    await user.click(screen.getByRole("button", { name: "移動" }));
    expect(m.moveKeyword).toHaveBeenCalledWith("a1", "b");
  });

  it("削除は影響件数を確認ダイアログに示し、失敗はダイアログ内に出し、確定で削除して再取得する", async () => {
    const user = userEvent.setup();
    await renderTree();
    await user.click(item("ネットワーク"));
    m.previewKeywordDeletion.mockResolvedValue({
      keywordCount: 4,
      unlinkedQuestionCount: 7,
      disabledQuestionCount: 2,
    });
    await user.click(screen.getByRole("button", { name: "削除" }));
    expect(m.previewKeywordDeletion).toHaveBeenCalledWith("a");
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("キーワード 4 件");
    expect(dialog).toHaveTextContent("問題 7 件");
    expect(dialog).toHaveTextContent("無効化される問題 2 件");

    m.deleteKeyword.mockRejectedValueOnce(
      new Error("キーワードの削除に失敗しました: x"),
    );
    await user.click(within(dialog).getByRole("button", { name: "削除する" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "キーワードの削除に失敗しました",
    );

    m.deleteKeyword.mockResolvedValue({
      keywordCount: 4,
      unlinkedQuestionCount: 7,
      disabledQuestionCount: 2,
    });
    m.listKeywords.mockResolvedValue([k("b", null, "データベース", 2)]);
    await user.click(within(dialog).getByRole("button", { name: "削除する" }));
    expect(m.deleteKeyword).toHaveBeenLastCalledWith("a");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(
        screen.queryByRole("treeitem", { name: "ネットワーク" }),
      ).toBeNull(),
    );
  });

  it("取得に失敗したらエラーを表示する", async () => {
    m.listKeywords.mockRejectedValue(
      new Error("キーワードの取得に失敗しました: x"),
    );
    render(<KeywordTree subjectId="s1" selectedId={null} onSelect={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "キーワードの取得に失敗しました",
    );
  });
});
