-- Reporting read model. Every dashboard, trace, export, print, share and impact number is
-- computed from these two views, so each figure definition lives in exactly one place.

-- One row per non-voided collection with the report-status predicates every money figure uses.
CREATE VIEW v_kpi_collections AS
SELECT c.id            AS collection_id,
       c.branch_id,
       c.report_id,
       c.amount,
       c.collected_on,
       to_char(c.collected_on, 'YYYY-MM') AS month,   -- collected_on is a PKT date
       c.routed_at,
       r.status        AS report_status,
       r.week_start,
       (r.status = 'approved')                              AS is_approved,
       (r.status = 'submitted')                             AS is_pending_approval,
       (r.status IN ('draft', 'returned'))                  AS is_in_progress,
       (r.status = 'approved' AND c.routed_at IS NULL)      AS is_not_yet_routed,
       (r.status = 'approved' AND c.routed_at IS NOT NULL)  AS is_routed
FROM collections c
JOIN weekly_reports r ON r.id = c.report_id
WHERE c.status <> 'voided';

-- One row per weekly report: totals frozen at submit beside live totals over active collections.
CREATE VIEW v_report_figures AS
SELECT r.id               AS report_id,
       r.branch_id,
       r.week_start,
       r.status,
       r.total_amount     AS frozen_amount,
       r.collection_count AS frozen_count,
       COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'active'), 0)::numeric(14,2) AS live_amount,
       (COUNT(c.id) FILTER (WHERE c.status = 'active'))::integer                    AS live_count,
       r.submitted_at,
       r.reviewed_at
FROM weekly_reports r
LEFT JOIN collections c ON c.report_id = r.id
GROUP BY r.id;
