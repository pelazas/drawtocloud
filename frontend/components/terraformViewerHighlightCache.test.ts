import { describe, expect, it } from "vitest";

import {
  getPendingHighlightFile,
  syncHighlightCache,
  syncHighlightFailures,
  type HighlightCache,
  type HighlightFailures,
} from "./terraformViewerHighlightCache";
import type { TerraformFile } from "./TerraformViewer";

describe("terraformViewerHighlightCache", () => {
  const oldMain: TerraformFile = {
    filename: "main.tf",
    content: "resource \"null_resource\" \"app\" {}",
    description: "old",
  };

  const newMain: TerraformFile = {
    filename: "main.tf",
    content: "resource \"aws_vpc\" \"main\" {}",
    description: "new",
  };

  it("drops cached highlight entries when a file keeps the same name but changes content", () => {
    const cache: HighlightCache = {
      "main.tf": {
        content: oldMain.content,
        html: "<pre>old</pre>",
      },
    };

    expect(syncHighlightCache(cache, [newMain])).toEqual({});
  });

  it("retries highlighting when a previously failed file changes content", () => {
    const failures: HighlightFailures = {
      "main.tf": oldMain.content,
    };

    expect(syncHighlightFailures(failures, [newMain])).toEqual({});
    expect(getPendingHighlightFile([newMain], {}, failures)).toEqual(newMain);
  });

  it("keeps cached entries for files whose content did not change", () => {
    const cache: HighlightCache = {
      "main.tf": {
        content: oldMain.content,
        html: "<pre>old</pre>",
      },
    };

    expect(syncHighlightCache(cache, [oldMain])).toEqual(cache);
  });
});
