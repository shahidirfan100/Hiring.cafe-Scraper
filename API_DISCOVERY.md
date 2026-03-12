## Selected API
- Endpoint: `https://hiring.cafe/api/search-jobs`
- Method: `GET`
- Auth: No explicit auth token, but protected by anti-bot verification and browser/session context
- Pagination: Supports `page` + `size` query params in actor fallback flow; endpoint also responds without query params
- Companion count endpoint: `https://hiring.cafe/api/search-jobs/get-total-count`
- Request context: current production traffic uses page-level `searchState` URL context (via referrer/session), not only the legacy `s` query format

### Fields available
- Top-level examples: `id`, `board_token`, `source`, `apply_url`, `source_and_board_token`, `job_information`, `v5_processed_job_data`, `v5_processed_company_data`, `_geoloc`, `requisition_id`, `collapse_key`, `is_expired`, `objectID`
- Nested examples include compensation ranges, workplace fields, seniority, commitment type, company metadata, and description/title fields
- Unique field-path count observed from sample scan data: **142**

### Fields currently missing in actor output (examples)
- `board_token`
- `source`
- `job_information.job_title_raw`
- `v5_processed_job_data.technical_tools`
- `v5_processed_job_data.requirements_summary`
- `v5_processed_job_data.workplace_countries`
- `v5_processed_job_data.air_travel_requirement`
- `v5_processed_job_data.land_travel_requirement`
- `v5_processed_job_data.language_requirements`
- `v5_processed_company_data.website`

### Field count comparison
- Existing normalized actor output fields: **11**
- Available API field paths observed: **142**

### Discovery notes
- URLScan evidence (example scan): `019c56ac-67a6-715f-afb7-76e17fda6937`
- Count response example from scan cache: `{"total":116973,"collapsedTotal":4213}`
