-- My Aid can now read tuition calculators and other cost estimates.
-- An upload made only of a cost estimate is saved with document_kind
-- 'cost-estimate'. Nothing else changes: same table, same access rules.
begin;

alter table public.aid_analyses drop constraint aid_analyses_document_kind_check;
alter table public.aid_analyses add constraint aid_analyses_document_kind_check
  check (document_kind in ('fafsa-submission-summary', 'award-letter', 'account-statement', 'cost-estimate'));

commit;
