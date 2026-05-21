# Hiring.Cafe Jobs Scraper

Extract comprehensive job data from Hiring.Cafe with a stable SSR-backed search flow. Collect job listings including titles, companies, locations, compensation, and descriptions at scale for research, recruiting, and monitoring.

## Features

- **Live Search Payload** — Uses the current Next.js SSR search transport that is working as of 2026-05-21
- **Keyword Search** — Find jobs by specific terms and roles
- **Location Filtering** — Target jobs in specific regions
- **Workplace Type Options** — Filter by remote, hybrid, or onsite positions
- **Pagination Control** — Collect data across multiple result pages
- **Structured Output** — Clean, normalized job data for easy processing
- **Rich Source Data** — Pulls from HiringCafe's structured search payload instead of brittle page scraping

## Use Cases

### Job Market Research
Analyze hiring trends and salary ranges across different industries. Understand demand for specific skills and identify emerging job categories.

### Recruitment Automation
Build automated job monitoring systems to track new opportunities. Feed job data into applicant tracking systems and recruitment pipelines.

### Competitive Intelligence
Monitor competitor hiring patterns and job posting frequency. Track salary trends and benefits offered by different companies.

### Career Planning
Research job opportunities and compensation data for career decisions. Compare offerings across companies and locations.

### Data Analytics
Create comprehensive datasets for labor market analysis and economic research. Combine with other sources for broader market insights.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `startUrl` | String | No | `"https://hiring.cafe"` | Search bootstrap URL |
| `keyword` | String | No | — | Search keyword (e.g., "software engineer") |
| `location` | String | No | — | Location filter (supports "United States") |
| `workplaceType` | String | No | `"Any"` | Workplace type: "Any", "Remote", "Hybrid", or "Onsite" |
| `results_wanted` | Integer | No | `20` | Maximum jobs to collect |
| `max_pages` | Integer | No | `10` | Maximum SSR pages to process |
| `proxyConfiguration` | Object | No | — | Reserved for future fallback strategies |

---

## Output Data

Each item in the dataset contains:

| Field | Type | Description |
|-------|------|-------------|
| `job_id` | String | Unique job identifier |
| `title` | String | Job position title |
| `company` | String | Company name |
| `location` | String | Job location |
| `workplace_type` | String | Remote, Hybrid, or Onsite |
| `commitment_type` | String | Full Time, Part Time, etc. |
| `compensation` | String | Salary/compensation information |
| `date_posted` | String | Job posting date |
| `description_html` | String | Sanitized HTML description |
| `description_text` | String | Full job description text |
| `url` | String | Direct link to job posting |

---

## Usage Examples

### Basic Job Search

```json
{
    "keyword": "software engineer",
    "results_wanted": 50
}
```

### Remote Jobs Only

```json
{
    "keyword": "data analyst",
    "location": "United States",
    "workplaceType": "Remote",
    "results_wanted": 100,
    "max_pages": 5
}
```

### Advanced Filtering

```json
{
    "keyword": "product manager",
    "workplaceType": "Hybrid",
    "results_wanted": 25,
    "max_pages": 3
}
```

---

## Sample Output

```json
{
    "job_id": "grnhse___reltio___5990272004",
    "title": "Software Engineer",
    "company": "Reltio",
    "location": "Bengaluru, Karnataka, India",
    "workplace_type": "Hybrid",
    "commitment_type": "Full Time",
    "date_posted": "2026-05-21T05:55:30.000Z",
    "url": "https://job-boards.greenhouse.io/reltio/jobs/5990272004"
}
```

---

## Notes

- The old `/api/search-jobs` endpoint is no longer reliable. This actor now reads the live SSR search payload that the current site serves.
- HiringCafe's own search relevance can be broad, so some results may be adjacent matches rather than exact title matches.
- For local `npm start` tests, place your input in `storage/key_value_stores/default/INPUT.json` if you want Apify runtime to pick it up automatically.

---

## Integrations

Connect your job data with:

- **Google Sheets** — Export for team analysis and sharing
- **Airtable** — Build searchable job databases
- **Slack** — Get notifications for new opportunities
- **Webhooks** — Send data to custom applications
- **Make** — Create automated job monitoring workflows
- **Zapier** — Trigger actions based on new jobs

---

## Legal Notice

This actor is designed for legitimate data collection purposes. Users are responsible for ensuring compliance with website terms of service and applicable laws. Use data responsibly and respect rate limits.
