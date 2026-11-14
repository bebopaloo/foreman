const source = { source_url: "https://example.invalid/pricing", as_of: "2026-11-01" };

export const syntheticTable = {
  models: [
    {
      model: "claude-synthetic-1",
      input_per_mtok: 3,
      output_per_mtok: 15,
      fast: { input_per_mtok: 6, output_per_mtok: 30 },
      ...source,
    },
  ],
  rules: {
    cache_write_5m_multiplier: 1.25,
    cache_write_1h_multiplier: 2,
    cache_read_multiplier: 0.1,
    batch_discount: 0.5,
    web_search_per_1000: 10,
    ...source,
  },
};
