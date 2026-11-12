-- +goose Up
-- Baseline categories from the Wix blog. `server seed-posts` upserts the
-- authoritative names/descriptions from web/src/content/posts/posts.json.
INSERT INTO categories (slug, name, name_th, description, sort_order) VALUES
    ('business-growth',      'Business Growth',      'การเติบโตทางธุรกิจ',     '', 10),
    ('brand-insight',        'Brand Insight',        'อินไซต์แบรนด์',          '', 20),
    ('ecomacrobiz-insights', 'ECOMACROBIZ Insights', 'มุมมองจาก ECOMACROBIZ', '', 30),
    ('learning-hub',         'Learning Hub',         'แหล่งเรียนรู้',           '', 40)
ON CONFLICT (slug) DO NOTHING;

-- +goose Down
DELETE FROM categories
WHERE slug IN ('business-growth', 'brand-insight', 'ecomacrobiz-insights', 'learning-hub')
  AND NOT EXISTS (SELECT 1 FROM post_categories pc WHERE pc.category_id = categories.id);
