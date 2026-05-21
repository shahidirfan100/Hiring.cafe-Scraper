## Selected API
- Endpoint: `https://hiring.cafe/_next/data/<buildId>/index.json?searchState=<json>&page=<n>`
- Bootstrap page: `https://hiring.cafe/?searchState=<json>&page=0`
- Method: `GET`
- Auth: None observed for SSR transport
- Pagination: `page` query param in the page URL and Next.js data URL
- Companion metadata in payload: `ssrTotalCount`, `ssrCompanyCount`, `ssrPageSize`, `ssrIsLastPage`, `initialSearchState`

### Fields available
- Top-level examples: `id`, `board_token`, `source`, `apply_url`, `source_and_board_token`, `job_information`, `v5_processed_job_data`, `v5_processed_company_data`, `_geoloc`, `requisition_id`, `collapse_key`, `is_expired`, `objectID`
- Nested examples include compensation ranges, workplace fields, seniority, commitment type, company metadata, and description/title fields
- Unique field-path count observed from SSR sample data: at least **140+**

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
- Available SSR/API field paths observed: **140+**

### Discovery notes
- Live site on 2026-05-21 returns `401 Unauthorized` for `https://hiring.cafe/api/search-jobs`
- Live site on 2026-05-21 returns `404` for `https://hiring.cafe/api/search-jobs/get-total-count`
- SSR page HTML still embeds full job objects in `__NEXT_DATA__` under `props.pageProps.ssrHits`
- `/_next/data/<buildId>/index.json` responds directly with the same rich `ssrHits` structure and honors `searchState` plus `page`
- Required headers for stable replay: browser-like `User-Agent`, `Accept`, `Accept-Language`, and `Referer`
- URLScan historical scan `019c56ac-67a6-715f-afb7-76e17fda6937` still shows the old API, but it is no longer the best live source
- Weaker candidates rejected:
  - `/api/search-jobs`: blocked by `401`
  - `/api/search-jobs/get-total-count`: removed (`404`)
  - JSON-LD on homepage: too shallow for job extraction
  - HTML-only parsing: unnecessary because SSR payload already contains structured job objects
