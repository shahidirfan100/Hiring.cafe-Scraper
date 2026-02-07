# Hiring.Cafe Jobs Scraper

Extract comprehensive job data from Hiring.Cafe with ease. Collect job listings including titles, companies, locations, and descriptions at scale. Perfect for job market research, recruitment automation, and hiring trend analysis.

## Features

- **Keyword Search** — Find jobs by specific terms and roles
- **Location Filtering** — Target jobs in specific regions
- **Workplace Type Options** — Filter by remote, hybrid, or onsite positions
- **Pagination Control** — Collect data across multiple result pages
- **Structured Output** — Clean, normalized job data for easy processing
- **Anti-Bot Handling** — Reliable extraction with built-in verification flow

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
| `startUrl` | String | No | `"https://hiring.cafe"` | Session bootstrap URL |
| `keyword` | String | No | — | Search keyword (e.g., "software engineer") |
| `location` | String | No | — | Location filter (supports "United States") |
| `workplaceType` | String | No | `"Any"` | Workplace type: "Any", "Remote", "Hybrid", or "Onsite" |
| `results_wanted` | Integer | No | `20` | Maximum jobs to collect |
| `max_pages` | Integer | No | `10` | Maximum API pages to process |
| `proxyConfiguration` | Object | No | — | Proxy settings for reliability |

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
| `description_html` | String | Raw HTML description with tags like p, br, strong, h2, h3 |
| `description_text` | String | Full job description text |
| `url` | String | Direct link to job posting |

---

## Usage Examples

### Basic Job Search

Extract software engineering jobs:

```json
{
    "keyword": "software engineer",
    "results_wanted": 50
}
```

### Remote Jobs Only

Find remote positions in specific locations:

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

Apply multiple filters for targeted results:

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
    "job_id": "abc123",
    "title": "Senior Software Engineer",
    "company": "Example Labs",
    "location": "United States",
    "workplace_type": "Remote",
    "commitment_type": "Full Time",
    "compensation": "USD 140000 - 180000 Yearly",
    "date_posted": "2026-02-06T11:20:00.000Z",
    "description_html": "<h2>About the role</h2><p>Build and maintain production services...</p>",
    "description_text": "Build and maintain production services...",
    "url": "https://hiring.cafe/jobs/abc123"
}
```

---

## Tips for Best Results

### Optimize Search Terms
- Use specific job titles and skills
- Combine multiple keywords for broader results
- Test different variations of the same role

### Choose Appropriate Limits
- Start with smaller result counts for testing
- Increase max_pages for comprehensive collection
- Balance speed with data volume needs

### Handle Location Filtering
- Currently supports "United States" mapping
- Leave empty for global results
- Verify location format matches API expectations

---

## Integrations

Connect your job data with:

- **Google Sheets** — Export for team analysis and sharing
- **Airtable** — Build searchable job databases
- **Slack** — Get notifications for new opportunities
- **Webhooks** — Send data to custom applications
- **Make** — Create automated job monitoring workflows
- **Zapier** — Trigger actions based on new jobs

### Export Formats

Download data in multiple formats:

- **JSON** — For developers and APIs
- **CSV** — For spreadsheet analysis
- **Excel** — For business reporting
- **XML** — For system integrations

---

## Frequently Asked Questions

### How many jobs can I collect?
You can collect all available matching jobs. The practical limit depends on your search criteria and the website's data availability.

### Can I search for jobs in specific locations?
Yes, the actor supports location filtering. Currently optimized for "United States" searches with automatic API mapping.

### What if some job fields are empty?
Some fields may be empty if the source data doesn't provide that information. The actor extracts all available data.

### How does workplace type filtering work?
You can filter by "Remote", "Hybrid", "Onsite", or "Any". This helps narrow results to your preferred work arrangements.

### Can I monitor jobs over time?
Yes, schedule regular runs to track new job postings and hiring trends using Apify's scheduling features.

### What happens if the website blocks requests?
The actor includes anti-bot handling and proxy support to ensure reliable data collection.

---

## Support

For issues or feature requests, contact support through the Apify Console.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [API Reference](https://docs.apify.com/api/v2)
- [Scheduling Runs](https://docs.apify.com/schedules)

---

## Legal Notice

This actor is designed for legitimate data collection purposes. Users are responsible for ensuring compliance with website terms of service and applicable laws. Use data responsibly and respect rate limits.
