import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvRecords } from "../../src/lib/csv/csv-parse";
import { csvHeader, csvRow, type CsvColumn } from "../../src/lib/csv/csv";
import { menuCsvRowSchema, normalizeMenuCsvRecord } from "../../src/lib/validation/menu-bulk";
import { parseMenuImportCsv } from "../../src/server/services/menu-bulk";

describe("csv-parse", () => {
  it("splits plain comma-separated rows", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields with embedded commas, quotes, and newlines", () => {
    const text = 'name,note\n"Iced, Latte","Says ""hi""\nsecond line"\n';
    expect(parseCsv(text)).toEqual([
      ["name", "note"],
      ["Iced, Latte", 'Says "hi"\nsecond line'],
    ]);
  });

  it("strips a leading UTF-8 BOM", () => {
    expect(parseCsv("﻿a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("tolerates a file with no trailing newline", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("round-trips through the csv encoder for values needing escaping", () => {
    type Row = { name: string; note: string };
    const columns: CsvColumn<Row>[] = [
      { key: "name", label: "name" },
      { key: "note", label: "note" },
    ];
    const rows: Row[] = [{ name: "Iced, Latte", note: 'Says "hi"' }];
    const csv = [csvHeader(columns), ...rows.map((r) => csvRow(r, columns))].join("\r\n");
    const records = parseCsvRecords(csv);
    expect(records).toEqual([{ name: "Iced, Latte", note: 'Says "hi"' }]);
  });

  it("maps records by header, defaulting missing cells to empty strings", () => {
    expect(parseCsvRecords("a,b,c\n1,2\n")).toEqual([{ a: "1", b: "2", c: "" }]);
  });
});

describe("menuCsvRowSchema", () => {
  it("accepts a row with no recipe data", () => {
    const parsed = menuCsvRowSchema.safeParse(
      normalizeMenuCsvRecord({
        item_id: "",
        item_name: "Latte",
        category_name: "Coffee",
        item_active: "TRUE",
        tracks_inventory: "TRUE",
        variant_id: "",
        variant_name: "Regular",
        variant_price: "25000",
        variant_active: "TRUE",
        ingredient_name: "",
        quantity_base_units: "",
        waste_percentage: "",
        recipe_notes: "",
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it("requires a quantity when an ingredient is given", () => {
    const parsed = menuCsvRowSchema.safeParse(
      normalizeMenuCsvRecord({
        item_name: "Latte",
        variant_name: "Regular",
        variant_price: "25000",
        ingredient_name: "Milk",
        quantity_base_units: "",
      }),
    );
    expect(parsed.success).toBe(false);
  });

  it("defaults blank boolean cells to true", () => {
    const parsed = menuCsvRowSchema.parse(
      normalizeMenuCsvRecord({ item_name: "Latte", variant_name: "Regular", variant_price: "25000" }),
    );
    expect(parsed.itemActive).toBe(true);
    expect(parsed.tracksInventory).toBe(true);
    expect(parsed.variantActive).toBe(true);
  });
});

describe("parseMenuImportCsv", () => {
  const header = "item_id,item_name,category_name,item_active,tracks_inventory,variant_id,variant_name,variant_price,variant_active,ingredient_name,quantity_base_units,waste_percentage,recipe_notes";

  it("groups multiple recipe-line rows under one item/variant", () => {
    const csv = [
      header,
      ",Latte,Coffee,TRUE,TRUE,,Regular,25000,TRUE,Milk,200,0,",
      ",Latte,Coffee,TRUE,TRUE,,Regular,25000,TRUE,Espresso,18,5,",
    ].join("\n");
    const result = parseMenuImportCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.itemGroups).toHaveLength(1);
    expect(result.data.itemGroups[0].variants).toHaveLength(1);
    expect(result.data.itemGroups[0].variants[0].recipeLines).toHaveLength(2);
    expect(result.data.hasRecipeRows).toBe(true);
  });

  it("treats a variant row with no ingredient as recipe-untouched", () => {
    const csv = [header, ",Latte,Coffee,TRUE,TRUE,,Regular,25000,TRUE,,,,"].join("\n");
    const result = parseMenuImportCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.itemGroups[0].variants[0].hasRecipeRow).toBe(false);
    expect(result.data.hasRecipeRows).toBe(false);
  });

  it("collects row errors instead of throwing on bad data", () => {
    const csv = [header, ",,,TRUE,TRUE,,Regular,-5,TRUE,,,,"].join("\n");
    const result = parseMenuImportCsv(csv);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rowErrors?.[0].row).toBe(2);
  });

  it("rejects an empty file", () => {
    const result = parseMenuImportCsv(header + "\n");
    expect(result.ok).toBe(false);
  });
});
