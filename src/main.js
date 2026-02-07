import { Actor, log } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import { firefox } from 'playwright';

const BASE_URL = 'https://hiring.cafe';
const SEARCH_ENDPOINT = `${BASE_URL}/api/search-jobs`;
const COUNT_ENDPOINT = `${BASE_URL}/api/search-jobs/get-total-count`;

const DEFAULT_RESULTS_WANTED = 20;
const DEFAULT_MAX_PAGES = 10;
const DEFAULT_PAGE_SIZE = 40;
const DEFAULT_DATE_FETCHED_PAST_DAYS = 61;

// CONFIGURATION
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 15.7; rv:147.0) Gecko/20100101 Firefox/147.0',
    'Mozilla/5.0 (X11; Linux x86_64; rv:147.0) Gecko/20100101 Firefox/147.0',
];
const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

const toText = (value) => {
    if (value === null || value === undefined) return null;
    const text = String(value).replace(/\s+/g, ' ').trim();
    return text || null;
};

const toOutputText = (value) => toText(value) ?? '';

const toHtml = (value) => {
    if (value === null || value === undefined) return null;
    const html = String(value).trim();
    return html || null;
};

const toOutputHtml = (value) => toHtml(value) ?? '';

const ALLOWED_DESCRIPTION_TAGS = new Set([
    'p',
    'br',
    'strong',
    'em',
    'ul',
    'ol',
    'li',
    'h2',
    'h3',
    'h4',
    'blockquote',
    'code',
    'pre',
]);

const sanitizeDescriptionHtml = (value) => {
    const rawHtml = toHtml(value);
    if (!rawHtml) return null;

    let sanitized = rawHtml
        .replace(/\u00a0/g, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<(script|style|noscript|iframe|object|embed|svg|math|canvas|template)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<\s*\/?\s*(html|head|body|meta|link|title)\b[^>]*>/gi, ' ')
        .replace(/<\s*(\/?)\s*div\b[^>]*>/gi, (_match, isClosing) => (isClosing ? '</p>' : '<p>'))
        .replace(/<\s*(\/?)\s*b\b[^>]*>/gi, (_match, isClosing) => (isClosing ? '</strong>' : '<strong>'))
        .replace(/<\s*(\/?)\s*i\b[^>]*>/gi, (_match, isClosing) => (isClosing ? '</em>' : '<em>'))
        .replace(/<\s*br\b[^>]*>/gi, '<br>')
        .replace(/<\s*\/?\s*(span|font)\b[^>]*>/gi, '');

    sanitized = sanitized.replace(/<\/?\s*([a-zA-Z0-9:-]+)(?:\s[^>]*)?>/g, (tagMarkup, tagName) => {
        const tag = String(tagName).toLowerCase();
        if (!ALLOWED_DESCRIPTION_TAGS.has(tag)) return '';
        if (tagMarkup.startsWith('</')) return `</${tag}>`;
        return tag === 'br' ? '<br>' : `<${tag}>`;
    });

    sanitized = sanitized
        .replace(/(<br>\s*){3,}/gi, '<br><br>')
        .replace(/<p>\s*(?=<(h2|h3|h4|ul|ol|li|blockquote|pre|p)>)/gi, '')
        .replace(/<\/(h2|h3|h4|ul|ol|li|blockquote|pre|p)>\s*<\/p>/gi, '</$1>')
        .replace(/<(p|li|h2|h3|h4|strong|em|ul|ol|blockquote|code|pre)>\s*<\/\1>/gi, '')
        .trim();

    return toHtml(sanitized);
};

const toNumber = (value, fallback) => {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const toAbsoluteUrl = (value) => {
    const text = toText(value);
    if (!text) return null;

    try {
        const url = new URL(text, BASE_URL);
        if (!['http:', 'https:'].includes(url.protocol)) return null;
        return url.href;
    } catch {
        return null;
    }
};

const stripHtml = (htmlText) => {
    const text = toText(htmlText);
    if (!text) return null;
    return toText(text.replace(/<[^>]*>/g, ' '));
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isBlockedText = (text) => /security checkpoint|verify(ing)? your browser|enable javascript to continue|access denied|captcha/i.test(text || '');
const encodeSearchState = (searchState) => Buffer.from(
    encodeURIComponent(JSON.stringify(searchState)),
    'utf8',
).toString('base64');

const createSearchState = ({ keyword, location, workplaceType }) => {
    const normalizedLocation = toText(location);
    const workplaceTypes = workplaceType === 'Any' ? ['Remote', 'Hybrid', 'Onsite'] : [workplaceType];

    const searchState = {
        locations: [],
        workplaceTypes,
        defaultToUserLocation: false,
        userLocation: null,
        physicalEnvironments: ['Office', 'Outdoor', 'Vehicle', 'Industrial', 'Customer-Facing'],
        physicalLaborIntensity: ['Low', 'Medium', 'High'],
        physicalPositions: ['Sitting', 'Standing'],
        oralCommunicationLevels: ['Low', 'Medium', 'High'],
        computerUsageLevels: ['Low', 'Medium', 'High'],
        cognitiveDemandLevels: ['Low', 'Medium', 'High'],
        currency: { label: 'Any', value: null },
        frequency: { label: 'Any', value: null },
        minCompensationLowEnd: null,
        minCompensationHighEnd: null,
        maxCompensationLowEnd: null,
        maxCompensationHighEnd: null,
        restrictJobsToTransparentSalaries: false,
        calcFrequency: 'Yearly',
        commitmentTypes: ['Full Time', 'Part Time', 'Contract', 'Internship', 'Temporary', 'Seasonal', 'Volunteer'],
        jobTitleQuery: '',
        jobDescriptionQuery: '',
        associatesDegreeFieldsOfStudy: [],
        excludedAssociatesDegreeFieldsOfStudy: [],
        bachelorsDegreeFieldsOfStudy: [],
        excludedBachelorsDegreeFieldsOfStudy: [],
        mastersDegreeFieldsOfStudy: [],
        excludedMastersDegreeFieldsOfStudy: [],
        doctorateDegreeFieldsOfStudy: [],
        excludedDoctorateDegreeFieldsOfStudy: [],
        associatesDegreeRequirements: [],
        bachelorsDegreeRequirements: [],
        mastersDegreeRequirements: [],
        doctorateDegreeRequirements: [],
        licensesAndCertifications: [],
        excludedLicensesAndCertifications: [],
        excludeAllLicensesAndCertifications: false,
        seniorityLevel: ['No Prior Experience Required', 'Entry Level', 'Mid Level'],
        roleTypes: ['Individual Contributor', 'People Manager'],
        roleYoeRange: [0, 20],
        excludeIfRoleYoeIsNotSpecified: false,
        managementYoeRange: [0, 20],
        excludeIfManagementYoeIsNotSpecified: false,
        securityClearances: ['None', 'Confidential', 'Secret', 'Top Secret', 'Top Secret/SCI', 'Public Trust', 'Interim Clearances', 'Other'],
        languageRequirements: [],
        excludedLanguageRequirements: [],
        languageRequirementsOperator: 'OR',
        excludeJobsWithAdditionalLanguageRequirements: false,
        airTravelRequirement: ['None', 'Minimal', 'Moderate', 'Extensive'],
        landTravelRequirement: ['None', 'Minimal', 'Moderate', 'Extensive'],
        morningShiftWork: [],
        eveningShiftWork: [],
        overnightShiftWork: [],
        weekendAvailabilityRequired: "Doesn't Matter",
        holidayAvailabilityRequired: "Doesn't Matter",
        overtimeRequired: "Doesn't Matter",
        onCallRequirements: ['None', 'Occasional (once a month or less)', 'Regular (once a week or more)'],
        benefitsAndPerks: [],
        applicationFormEase: [],
        companyNames: [],
        excludedCompanyNames: [],
        usaGovPref: null,
        industries: [],
        excludedIndustries: [],
        companyKeywords: [],
        companyKeywordsBooleanOperator: 'OR',
        excludedCompanyKeywords: [],
        hideJobTypes: [],
        encouragedToApply: [],
        searchQuery: keyword || '',
        dateFetchedPastNDays: DEFAULT_DATE_FETCHED_PAST_DAYS,
        hiddenCompanies: [],
        user: null,
        searchModeSelectedCompany: null,
        departments: [],
        restrictedSearchAttributes: [],
        sortBy: 'default',
        technologyKeywordsQuery: '',
        requirementsKeywordsQuery: '',
        companyPublicOrPrivate: 'all',
        latestInvestmentYearRange: [null, null],
        latestInvestmentSeries: [],
        latestInvestmentAmount: null,
        latestInvestmentCurrency: [],
        investors: [],
        excludedInvestors: [],
        isNonProfit: 'all',
        companySizeRanges: [],
        minYearFounded: null,
        maxYearFounded: null,
        excludedLatestInvestmentSeries: [],
    };

    if (normalizedLocation?.toLowerCase() === 'united states') {
        searchState.locations = [{
            formatted_address: 'United States',
            types: ['country'],
            geometry: {
                location: {
                    lat: '39.8283',
                    lon: '-98.5795',
                },
            },
            id: 'user_country',
            address_components: [{
                long_name: 'United States',
                short_name: 'US',
                types: ['country'],
            }],
            options: {
                flexible_regions: ['anywhere_in_continent', 'anywhere_in_world'],
            },
        }];
    }

    return searchState;
};

const extractJobsArray = (responseBody) => {
    if (!responseBody) return [];
    if (Array.isArray(responseBody)) return responseBody;

    if (Array.isArray(responseBody.results)) return responseBody.results;
    if (Array.isArray(responseBody.jobs)) return responseBody.jobs;
    if (Array.isArray(responseBody.items)) return responseBody.items;
    if (Array.isArray(responseBody.data)) return responseBody.data;
    if (Array.isArray(responseBody.content)) return responseBody.content;
    if (Array.isArray(responseBody.hits?.hits)) {
        return responseBody.hits.hits.map((hit) => hit?._source || hit).filter(Boolean);
    }
    if (Array.isArray(responseBody.data?.items)) return responseBody.data.items;
    if (Array.isArray(responseBody.data?.results)) return responseBody.data.results;

    return [];
};

const getCompensationText = (job) => {
    const processed = job?.v5_processed_job_data || {};
    const direct = toText(
        job?.compensation ||
        job?.salary ||
        job?.salaryText ||
        job?.compensationText ||
        job?.payRange ||
        processed?.listed_compensation,
    );
    if (direct) return direct;

    const min = processed?.yearly_min_compensation ?? job?.compensationLowEnd ?? job?.minCompensation ?? null;
    const max = processed?.yearly_max_compensation ?? job?.compensationHighEnd ?? job?.maxCompensation ?? null;
    const currency = processed?.listed_compensation_currency ?? job?.compensationCurrency ?? job?.currency ?? '';
    const frequency = processed?.listed_compensation_frequency ?? job?.compensationFrequency ?? job?.frequency ?? '';

    if (min !== null || max !== null) {
        const left = min !== null ? String(min) : '';
        const right = max !== null ? String(max) : '';
        const range = [left, right].filter(Boolean).join(' - ');
        return toText([currency, range, frequency].filter(Boolean).join(' '));
    }

    return null;
};

const humanizeCompanyToken = (value) => {
    const token = toText(value);
    if (!token) return null;

    const normalized = token
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!normalized) return null;

    return normalized
        .split(' ')
        .map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : '')
        .join(' ');
};

const getCompanyNameFromWebsite = (websiteValue) => {
    const website = toText(websiteValue);
    if (!website) return null;

    try {
        const url = new URL(website.startsWith('http') ? website : `https://${website}`);
        const labels = url.hostname.toLowerCase().split('.').filter(Boolean);
        if (labels.length === 0) return null;

        let token = labels.length > 1 ? labels[labels.length - 2] : labels[0];
        if (['co', 'com', 'org', 'net', 'gov', 'edu'].includes(token) && labels.length > 2) {
            token = labels[labels.length - 3];
        }

        return humanizeCompanyToken(token);
    } catch {
        return null;
    }
};

const getCompanyName = (job, jobInfo = {}, processed = {}) => {
    return toText(
        jobInfo?.company_info?.name ||
        jobInfo?.companyInfo?.name ||
        jobInfo?.company_name ||
        jobInfo?.companyName ||
        jobInfo?.company ||
        processed?.company_name ||
        processed?.company ||
        job?.v5_processed_company_data?.name ||
        job?.v5_processed_company_data?.company_name ||
        job?.companyName ||
        job?.company_name ||
        job?.company?.name ||
        job?.organization?.name ||
        job?.employer?.name ||
        job?.employerName ||
        getCompanyNameFromWebsite(job?.v5_processed_company_data?.website) ||
        getCompanyNameFromWebsite(job?.website) ||
        job?.company,
    );
};

const normalizeJob = (rawJob) => {
    const job = rawJob || {};
    const jobInfo = job?.job_information || {};
    const processed = job?.v5_processed_job_data || {};
    const jobId = toText(job.id || job.jobId || job._id || job.uuid || job.slug);
    const commitment = Array.isArray(processed?.commitment) ? processed.commitment.join(', ') : processed?.commitment;
    const descriptionHtml = toOutputHtml(sanitizeDescriptionHtml(
        jobInfo.description || job.description || job.descriptionHtml || job.jobDescription || job.requirements,
    ));

    const item = {
        job_id: toOutputText(jobId),
        title: toOutputText(jobInfo.title || job.title || job.jobTitle || job.position || job.role || job.name),
        company: toOutputText(getCompanyName(job, jobInfo, processed)),
        location: toOutputText(
            processed?.formatted_workplace_location ||
            job.location ||
            job.locationName ||
            job.city ||
            job.region ||
            job.country ||
            job.workLocation,
        ),
        workplace_type: toOutputText(processed?.workplace_type || job.workplaceType || job.workplace_type || job.workplace?.type),
        commitment_type: toOutputText(
            commitment ||
            job.commitmentType ||
            job.commitment_type ||
            job.employmentType ||
            job.jobType,
        ),
        compensation: toOutputText(getCompensationText(job)),
        date_posted: toOutputText(
            processed?.estimated_publish_date ||
            job.datePosted ||
            job.postedAt ||
            job.publishedAt ||
            job.createdAt ||
            job.dateFetched,
        ),
        description_html: descriptionHtml,
        description_text: toOutputText(stripHtml(descriptionHtml)),
        url: toOutputText(toAbsoluteUrl(
            job.apply_url ||
            job.url ||
            job.jobUrl ||
            job.applicationUrl ||
            job.applyUrl ||
            job.externalUrl,
        )),
    };

    if (!item.url && item.job_id) item.url = `${BASE_URL}/jobs/${encodeURIComponent(item.job_id)}`;

    return item;
};

const callApiInPage = async ({ page, url }) => {
    return page.evaluate(async ({ endpointUrl }) => {
        const response = await fetch(endpointUrl, {
            method: 'GET',
            credentials: 'include',
            headers: {
                Accept: 'application/json, text/plain, */*',
            },
        });

        const text = await response.text();
        let json = null;
        try {
            json = JSON.parse(text);
        } catch {
            json = null;
        }

        return {
            ok: response.ok,
            status: response.status,
            json,
            textSnippet: text.slice(0, 400),
        };
    }, { endpointUrl: url });
};

const getWithRetry = async ({ page, url, attempts, crawlerLog }) => {
    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        const response = await callApiInPage({ page, url });
        if (response.ok) return response;

        lastError = new Error(`API ${url} returned ${response.status}. Body: ${response.textSnippet}`);
        const retryable = [401, 403, 408, 409, 425, 429, 500, 502, 503, 504].includes(response.status);
        if (!retryable || attempt === attempts) break;

        const sleepMs = Math.min(1000 * (2 ** (attempt - 1)), 8000) + Math.floor(Math.random() * 500);
        crawlerLog.warning(`Retrying ${url} after status ${response.status} (attempt ${attempt}/${attempts})`);
        await page.waitForTimeout(sleepMs);
    }

    throw lastError;
};

await Actor.init();

try {
    const input = (await Actor.getInput()) || {};
    const keyword = toText(input.keyword) || '';
    const location = toText(input.location);
    const workplaceTypeInput = toText(input.workplaceType) || 'Any';
    const workplaceType = ['Any', 'Remote', 'Hybrid', 'Onsite'].includes(workplaceTypeInput)
        ? workplaceTypeInput
        : 'Any';

    const resultsWanted = toNumber(input.results_wanted, DEFAULT_RESULTS_WANTED);
    const maxPages = toNumber(input.max_pages, DEFAULT_MAX_PAGES);
    const pageSize = DEFAULT_PAGE_SIZE;
    const startUrl = toAbsoluteUrl(input.startUrl) || BASE_URL;

    const proxyConfigurationInput = input.proxyConfiguration ?? { useApifyProxy: true };
    let proxyConfiguration;
    try {
        proxyConfiguration = await Actor.createProxyConfiguration(proxyConfigurationInput);
    } catch (error) {
        log.warning(`Proxy configuration failed, continuing without proxy: ${error.message}`);
        proxyConfiguration = undefined;
    }

    const searchState = createSearchState({
        keyword,
        location,
        workplaceType,
    });
    const encodedSearchState = encodeSearchState(searchState);

    const state = {
        totalEstimated: null,
        saved: 0,
        seen: new Set(),
    };

    const crawler = new PlaywrightCrawler({
        launchContext: {
            launcher: firefox,
            launchOptions: {
                headless: true,
            },
        },
        proxyConfiguration,
        maxConcurrency: 1,
        maxRequestRetries: 3,
        requestHandlerTimeoutSecs: 180,
        navigationTimeoutSecs: 90,
        useSessionPool: true,
        browserPoolOptions: {
            useFingerprints: true,
        },
        sessionPoolOptions: {
            // Disable built-in 429 hard-fail on initial navigation; we handle retries manually on API calls.
            blockedStatusCodes: [0],
            maxPoolSize: 10,
            sessionOptions: {
                maxUsageCount: 25,
                maxErrorScore: 3,
            },
        },
        preNavigationHooks: [
            async ({ page }, gotoOptions) => {
                gotoOptions.waitUntil = 'domcontentloaded';
                await page.setExtraHTTPHeaders({
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Cache-Control': 'max-age=0',
                    'User-Agent': getRandomUserAgent(),
                });
            },
            async ({ page }) => {
                await page.route('**/*', (route) => {
                    const type = route.request().resourceType();
                    const url = route.request().url();

                    // Block images, fonts, media, stylesheets, and common trackers
                    if (['image', 'font', 'media', 'stylesheet'].includes(type) ||
                        url.includes('google-analytics') ||
                        url.includes('googletagmanager') ||
                        url.includes('facebook') ||
                        url.includes('doubleclick') ||
                        url.includes('adsense')) {
                        return route.abort();
                    }
                    return route.continue();
                });
            },
        ],
        async requestHandler({ page, log: crawlerLog }) {
            await page.waitForTimeout(900);
            const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 800) || '').catch(() => '');
            const pageTitle = await page.title().catch(() => '');
            if (isBlockedText(`${pageTitle} ${bodyText}`)) {
                crawlerLog.info('Waiting for browser verification to finish');
                await page.waitForTimeout(3000);
            }

            const postWaitTitle = await page.title().catch(() => '');
            if (isBlockedText(postWaitTitle)) {
                crawlerLog.warning('Potential anti-bot checkpoint still active after wait');
                const debugHtml = await page.content().catch(() => null);
                if (debugHtml) {
                    await Actor.setValue('DEBUG_BLOCKED_PAGE', debugHtml, { contentType: 'text/html' });
                }
            }

            try {
                const countUrl = `${COUNT_ENDPOINT}?s=${encodeURIComponent(encodedSearchState)}`;
                const countResponse = await getWithRetry({
                    page,
                    url: countUrl,
                    attempts: 4,
                    crawlerLog,
                });
                const totalCount = Number(countResponse?.json?.total);
                if (Number.isFinite(totalCount) && totalCount >= 0) {
                    state.totalEstimated = totalCount;
                }
            } catch (error) {
                crawlerLog.warning(`Count endpoint unavailable: ${error.message}`);
            }

            for (let pageIndex = 0; pageIndex < maxPages && state.saved < resultsWanted; pageIndex++) {
                await delay(120 + Math.floor(Math.random() * 240));

                let response;
                try {
                    const searchUrl = `${SEARCH_ENDPOINT}?s=${encodeURIComponent(encodedSearchState)}&size=${pageSize}&page=${pageIndex}`;
                    response = await getWithRetry({ page, url: searchUrl, attempts: 5, crawlerLog });
                } catch (error) {
                    crawlerLog.error(`Search API failed on page ${pageIndex}: ${error.message}`);
                    await Actor.setValue('DEBUG_SEARCH_STATE', searchState);
                    break;
                }

                const jobs = extractJobsArray(response.json);
                if (jobs.length === 0) {
                    crawlerLog.info(`No jobs returned on page ${pageIndex}. Stopping pagination.`);
                    break;
                }

                const batch = [];
                for (const rawJob of jobs) {
                    if (state.saved + batch.length >= resultsWanted) break;

                    const item = normalizeJob(rawJob);
                    const dedupeKey = item.job_id || item.url;
                    if (!dedupeKey || state.seen.has(dedupeKey)) continue;

                    state.seen.add(dedupeKey);
                    batch.push(item);
                }

                if (batch.length > 0) {
                    await Actor.pushData(batch);
                    state.saved += batch.length;
                    crawlerLog.info(`Saved ${state.saved}/${resultsWanted} jobs`);
                }

                if (jobs.length < pageSize) {
                    crawlerLog.info(`Last page detected on page ${pageIndex}.`);
                    break;
                }
            }
        },
        async failedRequestHandler({ request, log: crawlerLog, error }) {
            if (error.message?.includes('403')) {
                crawlerLog.warning(`Blocked (403): ${request.url} - skipping`);
            } else {
                crawlerLog.error(`Failed: ${request.url}`, { error: error.message });
            }
        },
    });

    log.info('Starting Hiring.Cafe scraping run', {
        startUrl,
        keyword: keyword || null,
        location: location || null,
        workplaceType,
        resultsWanted,
        maxPages,
        pageSize,
    });

    await crawler.run([{ url: startUrl, userData: { label: 'SEARCH' } }]);

    log.info('Hiring.Cafe scraping finished', {
        saved: state.saved,
        totalEstimated: state.totalEstimated,
    });

    if (state.saved === 0) {
        log.warning('No jobs were collected. Enable proxyConfiguration and retry if blocked.');
    }
} catch (error) {
    log.exception(error, 'Actor run failed');
    process.exitCode = 1;
} finally {
    await Actor.exit();
}
